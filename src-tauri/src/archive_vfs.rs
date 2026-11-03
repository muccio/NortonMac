use crate::models::{DirectoryListing, FileEntry};
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use std::collections::HashSet;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

pub fn parse_archive_url(url: &str) -> Option<(PathBuf, String)> {
    if !url.starts_with("archive://") {
        return None;
    }
    let without_prefix = &url["archive://".len()..];
    let parts: Vec<&str> = without_prefix.split('#').collect();
    let archive_path = PathBuf::from(parts[0]);
    let subpath = if parts.len() > 1 {
        parts[1].trim_matches('/').to_string()
    } else {
        String::new()
    };
    Some((archive_path, subpath))
}

pub fn format_archive_url(archive_path: &Path, subpath: &str) -> String {
    let clean_sub = subpath.trim_matches('/');
    format!("archive://{}#{}", archive_path.to_string_lossy(), clean_sub)
}

pub fn list_archive(archive_path: &Path, subpath: &str) -> Result<DirectoryListing, String> {
    if !archive_path.exists() {
        return Err(format!("Archive file not found: {}", archive_path.display()));
    }

    let file_name = archive_path.file_name().and_then(|n| n.to_str()).unwrap_or("archive").to_string();
    let lower_name = file_name.to_lowercase();
    let clean_sub = subpath.trim_matches('/');

    let mut entries: Vec<FileEntry> = Vec::new();

    // Determine ".." target
    if clean_sub.is_empty() {
        // Exit archive back to parent directory of the archive file
        if let Some(parent) = archive_path.parent() {
            entries.push(FileEntry {
                name: "..".to_string(),
                path: parent.to_string_lossy().to_string(),
                size: 0,
                is_dir: true,
                is_symlink: false,
                is_archive: false,
                modified: "".to_string(),
                permissions: "drwxr-xr-x".to_string(),
                extension: "".to_string(),
            });
        }
    } else {
        // Move up one level inside the archive
        let parent_sub = match Path::new(clean_sub).parent() {
            Some(p) if p.to_string_lossy() != "" => p.to_string_lossy().to_string(),
            _ => String::new(),
        };
        entries.push(FileEntry {
            name: "..".to_string(),
            path: format_archive_url(archive_path, &parent_sub),
            size: 0,
            is_dir: true,
            is_symlink: false,
            is_archive: false,
            modified: "".to_string(),
            permissions: "drwxr-xr-x".to_string(),
            extension: "".to_string(),
        });
    }

    let current_prefix = if clean_sub.is_empty() {
        String::new()
    } else {
        format!("{}/", clean_sub)
    };

    let mut seen_dirs: HashSet<String> = HashSet::new();

    if lower_name.ends_with(".zip") {
        let file = File::open(archive_path).map_err(|e| e.to_string())?;
        let mut zip = ZipArchive::new(file).map_err(|e| e.to_string())?;

        for i in 0..zip.len() {
            let zip_file = match zip.by_index(i) {
                Ok(f) => f,
                Err(_) => continue,
            };

            let full_name = zip_file.name().to_string();
            let trimmed = full_name.trim_matches('/');

            if !current_prefix.is_empty() && !trimmed.starts_with(&current_prefix) {
                continue;
            }

            let rel_to_current = if current_prefix.is_empty() {
                trimmed
            } else {
                &trimmed[current_prefix.len()..]
            };

            if rel_to_current.is_empty() {
                continue;
            }

            let segments: Vec<&str> = rel_to_current.split('/').collect();
            let first_segment = segments[0];

            if segments.len() > 1 || zip_file.is_dir() {
                // Directory in this view
                if seen_dirs.insert(first_segment.to_string()) {
                    let dir_sub = if current_prefix.is_empty() {
                        first_segment.to_string()
                    } else {
                        format!("{}{}", current_prefix, first_segment)
                    };
                    entries.push(FileEntry {
                        name: first_segment.to_string(),
                        path: format_archive_url(archive_path, &dir_sub),
                        size: 0,
                        is_dir: true,
                        is_symlink: false,
                        is_archive: false,
                        modified: "-".to_string(),
                        permissions: "drwxr-xr-x".to_string(),
                        extension: "".to_string(),
                    });
                }
            } else {
                // File
                let file_sub = if current_prefix.is_empty() {
                    first_segment.to_string()
                } else {
                    format!("{}{}", current_prefix, first_segment)
                };
                let ext = Path::new(first_segment)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_lowercase();

                let dt_str = match zip_file.last_modified() {
                    Some(dt) => format!(
                        "{:04}-{:02}-{:02} {:02}:{:02}",
                        dt.year(),
                        dt.month(),
                        dt.day(),
                        dt.hour(),
                        dt.minute()
                    ),
                    None => "-".to_string(),
                };

                entries.push(FileEntry {
                    name: first_segment.to_string(),
                    path: format_archive_url(archive_path, &file_sub),
                    size: zip_file.size(),
                    is_dir: false,
                    is_symlink: false,
                    is_archive: false,
                    modified: dt_str,
                    permissions: "-rw-r--r--".to_string(),
                    extension: ext,
                });
            }
        }
    } else if lower_name.ends_with(".tar") || lower_name.ends_with(".tar.gz") || lower_name.ends_with(".tgz") || lower_name.ends_with(".tar.bz2") {
        let file = File::open(archive_path).map_err(|e| e.to_string())?;
        let reader: Box<dyn Read> = if lower_name.ends_with(".tar.gz") || lower_name.ends_with(".tgz") {
            Box::new(GzDecoder::new(file))
        } else if lower_name.ends_with(".tar.bz2") {
            Box::new(bzip2::read::BzDecoder::new(file))
        } else {
            Box::new(file)
        };

        let mut archive = tar::Archive::new(reader);
        let tar_entries = archive.entries().map_err(|e| e.to_string())?;

        for entry in tar_entries {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };

            let path_buf = match entry.path() {
                Ok(p) => p.to_path_buf(),
                Err(_) => continue,
            };

            let path_str = path_buf.to_string_lossy().to_string();
            let trimmed = path_str.trim_matches('/');

            if !current_prefix.is_empty() && !trimmed.starts_with(&current_prefix) {
                continue;
            }

            let rel_to_current = if current_prefix.is_empty() {
                trimmed
            } else {
                &trimmed[current_prefix.len()..]
            };

            if rel_to_current.is_empty() {
                continue;
            }

            let segments: Vec<&str> = rel_to_current.split('/').collect();
            let first_segment = segments[0];

            let header = entry.header();
            let is_tar_dir = header.entry_type().is_dir();

            if segments.len() > 1 || is_tar_dir {
                if seen_dirs.insert(first_segment.to_string()) {
                    let dir_sub = if current_prefix.is_empty() {
                        first_segment.to_string()
                    } else {
                        format!("{}{}", current_prefix, first_segment)
                    };
                    entries.push(FileEntry {
                        name: first_segment.to_string(),
                        path: format_archive_url(archive_path, &dir_sub),
                        size: 0,
                        is_dir: true,
                        is_symlink: false,
                        is_archive: false,
                        modified: "-".to_string(),
                        permissions: "drwxr-xr-x".to_string(),
                        extension: "".to_string(),
                    });
                }
            } else {
                let file_sub = if current_prefix.is_empty() {
                    first_segment.to_string()
                } else {
                    format!("{}{}", current_prefix, first_segment)
                };
                let ext = Path::new(first_segment)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_lowercase();

                let size = header.size().unwrap_or(0);
                let mode = header.mode().unwrap_or(0o644);
                let perms = crate::local_fs::format_posix_permissions(mode, false);

                entries.push(FileEntry {
                    name: first_segment.to_string(),
                    path: format_archive_url(archive_path, &file_sub),
                    size,
                    is_dir: false,
                    is_symlink: false,
                    is_archive: false,
                    modified: "-".to_string(),
                    permissions: perms,
                    extension: ext,
                });
            }
        }
    } else {
        return Err("Unsupported archive format".to_string());
    }

    entries.sort_by(|a, b| {
        if a.name == ".." {
            return std::cmp::Ordering::Less;
        }
        if b.name == ".." {
            return std::cmp::Ordering::Greater;
        }
        if a.is_dir != b.is_dir {
            return b.is_dir.cmp(&a.is_dir);
        }
        a.name.to_lowercase().cmp(&b.name.to_lowercase())
    });

    let display_path = if clean_sub.is_empty() {
        format!("{}:/", file_name)
    } else {
        format!("{}:/{}", file_name, clean_sub)
    };

    Ok(DirectoryListing {
        path: format_archive_url(archive_path, clean_sub),
        display_path,
        is_virtual: true,
        archive_parent: Some(archive_path.to_string_lossy().to_string()),
        volume_name: format!("ARCHIVE [{}]", file_name),
        total_space: 0,
        free_space: 0,
        entries,
        show_hidden: true,
    })
}

pub fn extract_archive_file_to_bytes(archive_path: &Path, internal_file: &str) -> Result<Vec<u8>, String> {
    let lower_name = archive_path.to_string_lossy().to_lowercase();
    let clean_internal = internal_file.trim_matches('/');

    if lower_name.ends_with(".zip") {
        let file = File::open(archive_path).map_err(|e| e.to_string())?;
        let mut zip = ZipArchive::new(file).map_err(|e| e.to_string())?;
        for i in 0..zip.len() {
            let mut zf = zip.by_index(i).map_err(|e| e.to_string())?;
            if zf.name().trim_matches('/') == clean_internal {
                let mut buf = Vec::new();
                zf.read_to_end(&mut buf).map_err(|e| e.to_string())?;
                return Ok(buf);
            }
        }
        Err(format!("File '{}' not found in zip archive", clean_internal))
    } else if lower_name.ends_with(".tar") || lower_name.ends_with(".tar.gz") || lower_name.ends_with(".tgz") || lower_name.ends_with(".tar.bz2") {
        let file = File::open(archive_path).map_err(|e| e.to_string())?;
        let reader: Box<dyn Read> = if lower_name.ends_with(".tar.gz") || lower_name.ends_with(".tgz") {
            Box::new(GzDecoder::new(file))
        } else if lower_name.ends_with(".tar.bz2") {
            Box::new(bzip2::read::BzDecoder::new(file))
        } else {
            Box::new(file)
        };

        let mut archive = tar::Archive::new(reader);
        for entry in archive.entries().map_err(|e| e.to_string())? {
            let mut entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path().map_err(|e| e.to_string())?;
            if path.to_string_lossy().trim_matches('/') == clean_internal {
                let mut buf = Vec::new();
                entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
                return Ok(buf);
            }
        }
        Err(format!("File '{}' not found in tar archive", clean_internal))
    } else {
        Err("Unsupported archive format".to_string())
    }
}

pub fn extract_selected_from_archive(
    archive_path: &Path,
    subpath_filter: &str,
    dest_dir: &Path,
) -> Result<(), String> {
    let lower_name = archive_path.to_string_lossy().to_lowercase();
    let clean_filter = subpath_filter.trim_matches('/');

    if lower_name.ends_with(".zip") {
        let file = File::open(archive_path).map_err(|e| e.to_string())?;
        let mut zip = ZipArchive::new(file).map_err(|e| e.to_string())?;

        for i in 0..zip.len() {
            let mut zf = zip.by_index(i).map_err(|e| e.to_string())?;
            let name = zf.name().trim_matches('/').to_string();

            if name == clean_filter || name.starts_with(&format!("{}/", clean_filter)) {
                // Calculate relative path inside extraction
                let rel_path = if name == clean_filter {
                    let file_name = Path::new(&name).file_name().unwrap_or(Path::new(&name).as_os_str());
                    PathBuf::from(file_name)
                } else {
                    PathBuf::from(name[clean_filter.len()..].trim_matches('/'))
                };

                let target = dest_dir.join(rel_path);

                if zf.is_dir() {
                    std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
                } else {
                    if let Some(parent) = target.parent() {
                        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }
                    let mut outfile = File::create(&target).map_err(|e| e.to_string())?;
                    std::io::copy(&mut zf, &mut outfile).map_err(|e| e.to_string())?;
                }
            }
        }
        Ok(())
    } else if lower_name.ends_with(".tar") || lower_name.ends_with(".tar.gz") || lower_name.ends_with(".tgz") || lower_name.ends_with(".tar.bz2") {
        let file = File::open(archive_path).map_err(|e| e.to_string())?;
        let reader: Box<dyn Read> = if lower_name.ends_with(".tar.gz") || lower_name.ends_with(".tgz") {
            Box::new(GzDecoder::new(file))
        } else if lower_name.ends_with(".tar.bz2") {
            Box::new(bzip2::read::BzDecoder::new(file))
        } else {
            Box::new(file)
        };

        let mut archive = tar::Archive::new(reader);
        for entry in archive.entries().map_err(|e| e.to_string())? {
            let mut entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path().map_err(|e| e.to_string())?;
            let name = path.to_string_lossy().trim_matches('/').to_string();

            if name == clean_filter || name.starts_with(&format!("{}/", clean_filter)) {
                let rel_path = if name == clean_filter {
                    let file_name = Path::new(&name).file_name().unwrap_or(Path::new(&name).as_os_str());
                    PathBuf::from(file_name)
                } else {
                    PathBuf::from(name[clean_filter.len()..].trim_matches('/'))
                };
                let target = dest_dir.join(rel_path);

                if entry.header().entry_type().is_dir() {
                    std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
                } else {
                    if let Some(parent) = target.parent() {
                        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }
                    entry.unpack(&target).map_err(|e| e.to_string())?;
                }
            }
        }
        Ok(())
    } else {
        Err("Unsupported archive format".to_string())
    }
}

pub fn create_zip_archive(sources: &[PathBuf], output_file: &Path) -> Result<(), String> {
    let file = File::create(output_file).map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    for src in sources {
        if !src.exists() {
            continue;
        }
        let base_name = src.file_name().unwrap_or(src.as_os_str()).to_string_lossy();
        if src.is_file() {
            zip.start_file(base_name.to_string(), options).map_err(|e| e.to_string())?;
            let mut f = File::open(src).map_err(|e| e.to_string())?;
            let mut buffer = Vec::new();
            f.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
            zip.write_all(&buffer).map_err(|e| e.to_string())?;
        } else if src.is_dir() {
            let parent_dir = src.parent().unwrap_or(src);
            for entry in WalkDir::new(src) {
                let entry = entry.map_err(|e| e.to_string())?;
                let path = entry.path();
                let rel_path = path.strip_prefix(parent_dir).map_err(|e| e.to_string())?;
                let path_str = rel_path.to_string_lossy().to_string();

                if entry.file_type().is_dir() {
                    zip.add_directory(format!("{}/", path_str), SimpleFileOptions::default().unix_permissions(0o755))
                        .map_err(|e| e.to_string())?;
                } else {
                    zip.start_file(path_str, options).map_err(|e| e.to_string())?;
                    let mut f = File::open(path).map_err(|e| e.to_string())?;
                    let mut buffer = Vec::new();
                    f.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
                    zip.write_all(&buffer).map_err(|e| e.to_string())?;
                }
            }
        }
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn create_targz_archive(sources: &[PathBuf], output_file: &Path) -> Result<(), String> {
    let tar_gz = File::create(output_file).map_err(|e| e.to_string())?;
    let enc = GzEncoder::new(tar_gz, Compression::default());
    let mut tar = tar::Builder::new(enc);

    for src in sources {
        if !src.exists() {
            continue;
        }
        let base_name = src.file_name().unwrap_or(src.as_os_str()).to_string_lossy();
        if src.is_file() {
            let mut f = File::open(src).map_err(|e| e.to_string())?;
            tar.append_file(base_name.to_string(), &mut f).map_err(|e| e.to_string())?;
        } else if src.is_dir() {
            tar.append_dir_all(base_name.to_string(), src).map_err(|e| e.to_string())?;
        }
    }
    tar.finish().map_err(|e| e.to_string())?;
    Ok(())
}
