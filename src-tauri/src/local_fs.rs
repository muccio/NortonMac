use crate::models::{DirectoryListing, FileEntry, VolumeInfo};
use chrono::{DateTime, Local};
use std::collections::HashSet;
use std::ffi::CString;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use sysinfo::Disks;

pub fn is_archive_file(path: &Path) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_lowercase();
    name.ends_with(".zip")
        || name.ends_with(".tar")
        || name.ends_with(".tar.gz")
        || name.ends_with(".tgz")
        || name.ends_with(".tar.bz2")
        || name.ends_with(".tbz2")
        || name.ends_with(".tar.xz")
        || name.ends_with(".txz")
}

pub fn format_posix_permissions(mode: u32, is_dir: bool) -> String {
    let mut s = String::with_capacity(10);
    s.push(if is_dir { 'd' } else { '-' });
    
    // User
    s.push(if mode & 0o400 != 0 { 'r' } else { '-' });
    s.push(if mode & 0o200 != 0 { 'w' } else { '-' });
    s.push(if mode & 0o100 != 0 { 'x' } else { '-' });
    
    // Group
    s.push(if mode & 0o040 != 0 { 'r' } else { '-' });
    s.push(if mode & 0o020 != 0 { 'w' } else { '-' });
    s.push(if mode & 0o010 != 0 { 'x' } else { '-' });
    
    // Other
    s.push(if mode & 0o004 != 0 { 'r' } else { '-' });
    s.push(if mode & 0o002 != 0 { 'w' } else { '-' });
    s.push(if mode & 0o001 != 0 { 'x' } else { '-' });
    
    s
}

fn statvfs_space(path: &Path) -> Option<(u64, u64)> {
    let c_path = CString::new(path.as_os_str().as_bytes()).ok()?;
    unsafe {
        let mut stat: libc::statvfs = std::mem::zeroed();
        if libc::statvfs(c_path.as_ptr(), &mut stat) == 0 {
            let frsize = if stat.f_frsize > 0 {
                stat.f_frsize as u64
            } else {
                stat.f_bsize as u64
            };
            let total = (stat.f_blocks as u64).saturating_mul(frsize);
            let avail = (stat.f_bavail as u64).saturating_mul(frsize);
            Some((total, avail))
        } else {
            None
        }
    }
}

fn is_system_internal_mount(mount: &str, name: &str) -> bool {
    if mount == "/dev"
        || mount.starts_with("/System/Volumes/")
        || mount.starts_with("/private/")
        || mount.contains("/Library/Developer/CoreDevice")
        || mount == "/Volumes/Recovery"
        || name == "Recovery"
        || name.starts_with('.')
    {
        return true;
    }
    false
}

fn detect_root_volume_name() -> String {
    if let Ok(entries) = fs::read_dir("/Volumes") {
        for entry in entries.flatten() {
            if let Ok(ft) = entry.file_type() {
                if ft.is_symlink() {
                    if let Ok(target) = fs::read_link(entry.path()) {
                        if target == Path::new("/") {
                            let n = entry.file_name().to_string_lossy().to_string();
                            if !n.is_empty() {
                                return n;
                            }
                        }
                    }
                }
            }
        }
    }
    "Macintosh HD".to_string()
}

pub fn get_all_volumes() -> Vec<VolumeInfo> {
    let mut list: Vec<VolumeInfo> = Vec::new();
    let mut seen_mounts: HashSet<String> = HashSet::new();

    let root_dev = fs::metadata("/").map(|m| m.dev()).ok();
    let data_dev = fs::metadata("/System/Volumes/Data").map(|m| m.dev()).ok();
    let volumes_dir_dev = fs::metadata("/Volumes").map(|m| m.dev()).ok();

    // 1. Primary macOS root volume ("/")
    let root_name = detect_root_volume_name();
    let (root_total, root_avail) = statvfs_space(Path::new("/")).unwrap_or((0, 0));
    seen_mounts.insert("/".to_string());
    list.push(VolumeInfo {
        name: root_name,
        mount_point: "/".to_string(),
        total_space: root_total,
        available_space: root_avail,
        is_removable: false,
    });

    // 2. Scan /Volumes directly for instant, uncached detection of USB, SD, Thunderbolt, DMG, SMB/NFS drives
    if let Ok(entries) = fs::read_dir("/Volumes") {
        let mut ext_vols: Vec<VolumeInfo> = Vec::new();
        for entry in entries.flatten() {
            let fname = entry.file_name().to_string_lossy().to_string();
            if fname.starts_with('.') || fname == "Recovery" {
                continue;
            }
            let syml_meta = match fs::symlink_metadata(entry.path()) {
                Ok(m) => m,
                Err(_) => continue,
            };
            // Skip symlink pointing back to "/" (e.g. "Macintosh HD -> /")
            if syml_meta.file_type().is_symlink() {
                continue;
            }
            let meta = match fs::metadata(entry.path()) {
                Ok(m) if m.is_dir() => m,
                _ => continue,
            };

            // Ensure it is an actual mounted filesystem, not an empty leftover directory on /Volumes
            let dev = meta.dev();
            if Some(dev) == root_dev || Some(dev) == data_dev || Some(dev) == volumes_dir_dev {
                continue;
            }

            let mount_str = entry.path().to_string_lossy().to_string();
            if is_system_internal_mount(&mount_str, &fname) {
                continue;
            }

            let (total, avail) = statvfs_space(&entry.path()).unwrap_or((0, 0));
            if total == 0 && avail == 0 {
                continue;
            }

            if seen_mounts.insert(mount_str.clone()) {
                ext_vols.push(VolumeInfo {
                    name: fname,
                    mount_point: mount_str,
                    total_space: total,
                    available_space: avail,
                    is_removable: true,
                });
            }
        }
        ext_vols.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        list.extend(ext_vols);
    }

    // 3. Supplement with sysinfo::Disks for any custom mount points outside /Volumes
    let disks = Disks::new_with_refreshed_list();
    for disk in disks.list() {
        let mount = disk.mount_point().to_string_lossy().to_string();
        let name = disk.name().to_string_lossy().to_string();
        if seen_mounts.contains(&mount) || is_system_internal_mount(&mount, &name) {
            continue;
        }
        if disk.total_space() == 0 {
            continue;
        }
        let display_name = if name.is_empty() {
            Path::new(&mount)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Disk")
                .to_string()
        } else {
            name
        };
        seen_mounts.insert(mount.clone());
        list.push(VolumeInfo {
            name: display_name,
            mount_point: mount.clone(),
            total_space: disk.total_space(),
            available_space: disk.available_space(),
            is_removable: disk.is_removable() || mount.starts_with("/Volumes/"),
        });
    }

    list
}

pub fn get_volume_for_path(path: &Path) -> (String, u64, u64) {
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let vols = get_all_volumes();

    let mut best_match: Option<&VolumeInfo> = None;
    for v in &vols {
        let mp = Path::new(&v.mount_point);
        if canonical.starts_with(mp) {
            if best_match.is_none() || v.mount_point.len() > best_match.unwrap().mount_point.len() {
                best_match = Some(v);
            }
        }
    }

    if let Some(v) = best_match {
        let (total, avail) = statvfs_space(&canonical).unwrap_or((v.total_space, v.available_space));
        (v.name.clone(), total, avail)
    } else {
        let (total, avail) = statvfs_space(&canonical).unwrap_or((0, 0));
        ("Macintosh HD".to_string(), total, avail)
    }
}

pub fn list_local_directory(path_str: &str, show_hidden: bool) -> Result<DirectoryListing, String> {
    let requested_path = PathBuf::from(path_str);
    let resolved_path = if path_str.starts_with('~') {
        if let Some(home) = dirs::home_dir() {
            home.join(path_str.trim_start_matches("~/"))
        } else {
            requested_path
        }
    } else {
        requested_path
    };

    let canonical_path = resolved_path.canonicalize().map_err(|e| format!("Failed to access {}: {}", path_str, e))?;
    let path_str_clean = canonical_path.to_string_lossy().to_string();
    let (volume_name, total_space, free_space) = get_volume_for_path(&canonical_path);

    let mut entries: Vec<FileEntry> = Vec::new();

    // Add parent directory ".." entry if not at root "/"
    if let Some(parent) = canonical_path.parent() {
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

    let read_dir = fs::read_dir(&canonical_path).map_err(|e| e.to_string())?;

    for item in read_dir {
        if let Ok(entry) = item {
            let file_name = entry.file_name().to_string_lossy().to_string();
            
            // Check hidden file filter
            if !show_hidden && file_name.starts_with('.') {
                continue;
            }

            let entry_path = entry.path();
            let metadata = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };

            let is_symlink = metadata.file_type().is_symlink();
            let is_dir = metadata.is_dir();
            let is_archive = !is_dir && is_archive_file(&entry_path);
            let size = if is_dir { 0 } else { metadata.len() };

            let modified_str = match metadata.modified() {
                Ok(sys_time) => {
                    let dt: DateTime<Local> = sys_time.into();
                    dt.format("%Y-%m-%d %H:%M").to_string()
                }
                Err(_) => "-".to_string(),
            };

            let mode = metadata.permissions().mode();
            let perms = format_posix_permissions(mode, is_dir);

            let extension = entry_path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();

            entries.push(FileEntry {
                name: file_name,
                path: entry_path.to_string_lossy().to_string(),
                size,
                is_dir,
                is_symlink,
                is_archive,
                modified: modified_str,
                permissions: perms,
                extension,
            });
        }
    }

    // Sort: ".." always first, then directories alphabetically, then files alphabetically
    entries.sort_by(|a, b| {
        if a.name == ".." {
            return std::cmp::Ordering::Less;
        }
        if b.name == ".." {
            return std::cmp::Ordering::Greater;
        }
        if a.is_dir != b.is_dir {
            return b.is_dir.cmp(&a.is_dir); // Dirs first
        }
        a.name.to_lowercase().cmp(&b.name.to_lowercase())
    });

    Ok(DirectoryListing {
        path: path_str_clean.clone(),
        display_path: path_str_clean,
        is_virtual: false,
        archive_parent: None,
        volume_name,
        total_space,
        free_space,
        entries,
        show_hidden,
    })
}

pub fn count_local_files_and_bytes(path: &Path) -> (usize, u64) {
    let meta = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(_) => return (0, 0),
    };
    if meta.file_type().is_symlink() || meta.is_file() {
        return (1, meta.len());
    }

    let mut files = 0usize;
    let mut bytes = 0u64;
    for entry in walkdir::WalkDir::new(path).follow_links(false).into_iter().flatten() {
        if let Ok(m) = entry.metadata() {
            if m.file_type().is_symlink() || m.is_file() {
                files += 1;
                bytes = bytes.saturating_add(m.len());
            }
        }
    }
    (files.max(1), bytes)
}

pub fn copy_recursive_with_progress<F>(
    src: &Path,
    dst: &Path,
    on_progress: &mut F,
) -> std::io::Result<()>
where
    F: FnMut(&str, u64, bool),
{
    let syml_meta = fs::symlink_metadata(src)?;
    let display_name = src
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();

    if syml_meta.file_type().is_symlink() {
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent)?;
        }
        if dst.exists() || fs::symlink_metadata(dst).is_ok() {
            let _ = fs::remove_file(dst);
        }
        let target = fs::read_link(src)?;
        std::os::unix::fs::symlink(&target, dst)?;
        on_progress(&display_name, syml_meta.len(), true);
        return Ok(());
    }

    if syml_meta.is_dir() {
        fs::create_dir_all(dst)?;
        let mut had_children = false;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            had_children = true;
            let entry_path = entry.path();
            let dest_child = dst.join(entry.file_name());
            copy_recursive_with_progress(&entry_path, &dest_child, on_progress)?;
        }
        if !had_children {
            on_progress(&display_name, 0, false);
        }
    } else {
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent)?;
        }
        if let (Ok(s_can), Ok(d_can)) = (src.canonicalize(), dst.canonicalize()) {
            if s_can == d_can {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    format!("Origine e destinazione coincidono: {}", display_name),
                ));
            }
        }

        let mut reader = File::open(src)?;
        let mut writer = File::create(dst)?;
        let mut buf = vec![0u8; 256 * 1024];

        loop {
            let n = reader.read(&mut buf)?;
            if n == 0 {
                break;
            }
            writer.write_all(&buf[..n])?;
            on_progress(&display_name, n as u64, false);
        }
        writer.flush()?;

        if let Ok(meta) = src.metadata() {
            let _ = fs::set_permissions(dst, meta.permissions());
        }
        on_progress(&display_name, 0, true);
    }

    Ok(())
}

pub fn copy_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    let mut noop = |_name: &str, _bytes: u64, _done: bool| {};
    copy_recursive_with_progress(src, dst, &mut noop)
}

pub fn make_unique_duplicate_name(
    original_name: &str,
    is_dir: bool,
    existing_lower: &HashSet<String>,
) -> String {
    let (raw_stem, ext) = if is_dir {
        (original_name, "")
    } else {
        let lower = original_name.to_lowercase();
        let compound_exts = [".tar.gz", ".tar.bz2", ".tar.xz"];
        let mut split_pos = None;
        for ce in compound_exts {
            if lower.ends_with(ce) && original_name.len() > ce.len() {
                split_pos = Some(original_name.len() - ce.len());
                break;
            }
        }
        if let Some(pos) = split_pos {
            (&original_name[..pos], &original_name[pos..])
        } else if let Some(dot) = original_name.rfind('.') {
            if dot > 0 {
                (&original_name[..dot], &original_name[dot..])
            } else {
                (original_name, "")
            }
        } else {
            (original_name, "")
        }
    };

    // Strip existing " copia" or " copia N" suffix so duplicating a copy produces "copia 2", "copia 3", etc.
    let base_stem = if let Some(stripped) = raw_stem.strip_suffix(" copia") {
        stripped
    } else if let Some((before_num, num_part)) = raw_stem.rsplit_once(" copia ") {
        if !num_part.is_empty() && num_part.chars().all(|c| c.is_ascii_digit()) {
            before_num
        } else {
            raw_stem
        }
    } else {
        raw_stem
    };

    let first_candidate = format!("{} copia{}", base_stem, ext);
    if !existing_lower.contains(&first_candidate.to_lowercase()) {
        return first_candidate;
    }

    for n in 2..10_000 {
        let candidate = format!("{} copia {}{}", base_stem, n, ext);
        if !existing_lower.contains(&candidate.to_lowercase()) {
            return candidate;
        }
    }

    format!("{}_dup{}", base_stem, ext)
}

pub fn calculate_local_item_size(path: &Path) -> u64 {
    if let Ok(meta) = fs::symlink_metadata(path) {
        if meta.file_type().is_symlink() {
            return meta.len();
        }
        if meta.is_file() {
            return meta.len();
        }
    }
    walkdir::WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter_map(|e| e.metadata().ok())
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_all_volumes_filters_system_partitions() {
        let vols = get_all_volumes();
        assert!(!vols.is_empty());
        assert_eq!(vols[0].mount_point, "/");
        for v in &vols {
            assert!(!v.mount_point.starts_with("/System/Volumes/"));
            assert_ne!(v.name, "Recovery");
            assert!(!v.name.starts_with('.'));
        }
    }

    #[test]
    fn test_copy_recursive_with_progress_reports_exact_bytes() {
        let base = std::env::temp_dir().join(format!("nortonmac_test_{}", std::process::id()));
        let src_dir = base.join("src");
        let dst_dir = base.join("dst");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(src_dir.join("nested")).unwrap();
        fs::create_dir_all(src_dir.join("empty_sub")).unwrap();

        let payload_a = vec![b'A'; 600 * 1024]; // > 2 chunks of 256 KB
        let payload_b = vec![b'B'; 45 * 1024];
        fs::write(src_dir.join("big.bin"), &payload_a).unwrap();
        fs::write(src_dir.join("nested/small.bin"), &payload_b).unwrap();

        let (total_files, total_bytes) = count_local_files_and_bytes(&src_dir);
        assert_eq!(total_files, 2);
        assert_eq!(total_bytes, (payload_a.len() + payload_b.len()) as u64);

        let mut reported_bytes = 0u64;
        let mut completed_files = 0usize;
        let mut chunk_events = 0usize;
        copy_recursive_with_progress(&src_dir, &dst_dir, &mut |_name, delta, done| {
            reported_bytes += delta;
            if delta > 0 {
                chunk_events += 1;
            }
            if done {
                completed_files += 1;
            }
        })
        .unwrap();

        assert_eq!(reported_bytes, total_bytes);
        assert_eq!(completed_files, 2);
        assert!(chunk_events >= 4); // 600KB is at least 3 chunks + 45KB is 1 chunk
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn test_make_unique_duplicate_name() {
        let mut existing = HashSet::new();
        existing.insert("relazione.pdf".to_string());
        assert_eq!(
            make_unique_duplicate_name("relazione.pdf", false, &existing),
            "relazione copia.pdf"
        );

        existing.insert("relazione copia.pdf".to_string());
        assert_eq!(
            make_unique_duplicate_name("relazione.pdf", false, &existing),
            "relazione copia 2.pdf"
        );
        assert_eq!(
            make_unique_duplicate_name("relazione copia.pdf", false, &existing),
            "relazione copia 2.pdf"
        );

        assert_eq!(
            make_unique_duplicate_name("backup.tar.gz", false, &existing),
            "backup copia.tar.gz"
        );
        assert_eq!(
            make_unique_duplicate_name("v1.0.2", true, &existing),
            "v1.0.2 copia"
        );
        assert_eq!(
            make_unique_duplicate_name(".htaccess", false, &existing),
            ".htaccess copia"
        );
    }
}
