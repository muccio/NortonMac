use crate::archive_vfs::{
    create_targz_archive, create_zip_archive, extract_archive_file_to_bytes,
    extract_selected_from_archive, list_archive, parse_archive_url,
};
use crate::local_fs::{
    copy_recursive, get_all_volumes, list_local_directory,
};
use crate::models::{
    DirectoryListing, FilePreview, HexLine, ShellOutput, SiteConfig, VolumeInfo,
};
use crate::remote_fs::{
    create_ftp_directory, create_sftp_directory, delete_ftp_file, delete_sftp_file,
    download_ftp_file, download_sftp_file, list_ftp_directory, list_sftp_directory,
    parse_remote_url, test_ftp_connection, test_sftp_connection, upload_ftp_file,
    upload_sftp_file, RemoteManager,
};
use crate::site_manager::{delete_site, load_sites, save_site};
use base64::prelude::*;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use tauri::State;

pub struct AppState {
    pub remote_manager: Arc<RemoteManager>,
}

#[tauri::command]
pub fn get_home_directory() -> String {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "/".to_string())
}

#[tauri::command]
pub fn get_volumes() -> Vec<VolumeInfo> {
    get_all_volumes()
}

#[tauri::command]
pub async fn list_directory(
    path: String,
    show_hidden: bool,
    state: State<'_, AppState>,
) -> Result<DirectoryListing, String> {
    if let Some((archive_path, subpath)) = parse_archive_url(&path) {
        return list_archive(&archive_path, &subpath);
    }

    if let Some((proto, site_id, remote_path)) = parse_remote_url(&path) {
        if let Some(site) = state.remote_manager.get_site(&site_id) {
            return if proto == "ftp" {
                list_ftp_directory(&site, &remote_path)
            } else {
                list_sftp_directory(&site, &remote_path)
            };
        } else {
            return Err(format!("Remote site session '{}' not found", site_id));
        }
    }

    list_local_directory(&path, show_hidden)
}

fn detect_media_type(filename: &str, bytes: &[u8]) -> (Option<String>, Option<String>) {
    let lower = filename.to_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");

    // Check PDF
    if ext == "pdf" || bytes.starts_with(b"%PDF-") {
        return (Some("pdf".to_string()), Some("application/pdf".to_string()));
    }

    // Images
    match ext {
        "png" => return (Some("image".to_string()), Some("image/png".to_string())),
        "jpg" | "jpeg" => return (Some("image".to_string()), Some("image/jpeg".to_string())),
        "gif" => return (Some("image".to_string()), Some("image/gif".to_string())),
        "webp" => return (Some("image".to_string()), Some("image/webp".to_string())),
        "svg" => return (Some("image".to_string()), Some("image/svg+xml".to_string())),
        "bmp" => return (Some("image".to_string()), Some("image/bmp".to_string())),
        "ico" => return (Some("image".to_string()), Some("image/x-icon".to_string())),
        "tiff" | "tif" => return (Some("image".to_string()), Some("image/tiff".to_string())),
        "avif" => return (Some("image".to_string()), Some("image/avif".to_string())),
        _ => {}
    }

    // Audio
    match ext {
        "mp3" => return (Some("audio".to_string()), Some("audio/mpeg".to_string())),
        "wav" => return (Some("audio".to_string()), Some("audio/wav".to_string())),
        "ogg" | "oga" => return (Some("audio".to_string()), Some("audio/ogg".to_string())),
        "m4a" => return (Some("audio".to_string()), Some("audio/mp4".to_string())),
        "aac" => return (Some("audio".to_string()), Some("audio/aac".to_string())),
        "flac" => return (Some("audio".to_string()), Some("audio/flac".to_string())),
        "aiff" | "aif" => return (Some("audio".to_string()), Some("audio/aiff".to_string())),
        _ => {}
    }

    // Video
    match ext {
        "mp4" => return (Some("video".to_string()), Some("video/mp4".to_string())),
        "webm" => return (Some("video".to_string()), Some("video/webm".to_string())),
        "mov" => return (Some("video".to_string()), Some("video/quicktime".to_string())),
        "m4v" => return (Some("video".to_string()), Some("video/x-m4v".to_string())),
        "ogv" => return (Some("video".to_string()), Some("video/ogg".to_string())),
        _ => {}
    }

    // Magic bytes fallback
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return (Some("image".to_string()), Some("image/png".to_string()));
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return (Some("image".to_string()), Some("image/jpeg".to_string()));
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return (Some("image".to_string()), Some("image/gif".to_string()));
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return (Some("image".to_string()), Some("image/webp".to_string()));
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WAVE" {
        return (Some("audio".to_string()), Some("audio/wav".to_string()));
    }
    if bytes.starts_with(b"fLaC") {
        return (Some("audio".to_string()), Some("audio/flac".to_string()));
    }
    if bytes.starts_with(b"OggS") {
        return (Some("audio".to_string()), Some("audio/ogg".to_string()));
    }
    if bytes.starts_with(b"ID3") {
        return (Some("audio".to_string()), Some("audio/mpeg".to_string()));
    }

    (None, None)
}

#[tauri::command]
pub async fn read_file_preview(
    path: String,
    hex_mode: bool,
    state: State<'_, AppState>,
) -> Result<FilePreview, String> {
    let (filename, bytes) = if let Some((archive_path, subpath)) = parse_archive_url(&path) {
        let fname = Path::new(&subpath)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("preview")
            .to_string();
        let b = extract_archive_file_to_bytes(&archive_path, &subpath)?;
        (fname, b)
    } else if let Some((proto, site_id, remote_path)) = parse_remote_url(&path) {
        let fname = Path::new(&remote_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("remote_file")
            .to_string();
        let site = state
            .remote_manager
            .get_site(&site_id)
            .ok_or_else(|| "Remote site not found".to_string())?;
        let b = if proto == "ftp" {
            download_ftp_file(&site, &remote_path)?
        } else {
            download_sftp_file(&site, &remote_path)?
        };
        (fname, b)
    } else {
        let p = Path::new(&path);
        let fname = p
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file")
            .to_string();
        let b = fs::read(p).map_err(|e| format!("Failed to read file: {}", e))?;
        (fname, b)
    };

    let total_size = bytes.len() as u64;
    let (media_type, mime_type) = detect_media_type(&filename, &bytes);
    let is_pdf = media_type.as_deref() == Some("pdf");

    // Allow media files up to 100MB to be encoded in base64
    let media_data_base64 = if media_type.is_some() && bytes.len() <= 100 * 1024 * 1024 {
        Some(BASE64_STANDARD.encode(&bytes))
    } else {
        None
    };

    let pdf_data_base64 = if is_pdf {
        media_data_base64.clone()
    } else {
        None
    };

    let preview_limit = 256 * 1024; // 256 KB max for preview
    let slice = if bytes.len() > preview_limit {
        &bytes[..preview_limit]
    } else {
        &bytes[..]
    };

    let is_svg = filename.to_lowercase().ends_with(".svg");
    let is_binary = if is_pdf || (media_type.is_some() && !is_svg) {
        true
    } else {
        slice.iter().take(1024).any(|&b| b == 0)
    };

    let text_content = if (!is_binary || is_svg) && !hex_mode {
        match std::str::from_utf8(slice) {
            Ok(s) => Some(s.to_string()),
            Err(_) => None,
        }
    } else {
        None
    };

    // Generate Hex dump lines: 16 bytes per line
    let mut hex_lines = Vec::new();
    let hex_slice = if slice.len() > 16384 {
        &slice[..16384] // limit hex view lines to 16KB for smooth UI scrolling
    } else {
        slice
    };

    for (chunk_idx, chunk) in hex_slice.chunks(16).enumerate() {
        let offset = format!("{:08X}", chunk_idx * 16);
        let mut hex_parts = Vec::new();
        let mut ascii_parts = String::new();

        for (i, &b) in chunk.iter().enumerate() {
            hex_parts.push(format!("{:02X}", b));
            if i == 7 {
                hex_parts.push(" ".to_string());
            }
            if b >= 32 && b <= 126 {
                ascii_parts.push(b as char);
            } else {
                ascii_parts.push('.');
            }
        }

        let hex_bytes = hex_parts.join(" ");

        hex_lines.push(HexLine {
            offset,
            hex_bytes,
            ascii: ascii_parts,
        });
    }

    let encoding = if let Some(ref mtype) = media_type {
        let mime = mime_type.as_deref().unwrap_or("unknown");
        match mtype.as_str() {
            "image" => format!("Image ({})", mime),
            "audio" => format!("Audio ({})", mime),
            "video" => format!("Video ({})", mime),
            "pdf" => "PDF Document".to_string(),
            _ => mime.to_string(),
        }
    } else if is_binary {
        "Binary (Hex)".to_string()
    } else {
        "UTF-8".to_string()
    };

    Ok(FilePreview {
        path,
        filename,
        size: total_size,
        is_binary,
        is_pdf,
        media_type,
        mime_type,
        media_data_base64,
        pdf_data_base64,
        text_content,
        hex_lines,
        encoding,
    })
}

#[tauri::command]
pub async fn save_file_content(
    path: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Some((proto, site_id, remote_path)) = parse_remote_url(&path) {
        let site = state
            .remote_manager
            .get_site(&site_id)
            .ok_or_else(|| "Remote site not found".to_string())?;
        if proto == "ftp" {
            upload_ftp_file(&site, &remote_path, content.as_bytes())?;
        } else {
            upload_sftp_file(&site, &remote_path, content.as_bytes())?;
        }
        return Ok(());
    }

    if path.starts_with("archive://") {
        return Err("Direct editing inside archives is read-only. Please extract first.".to_string());
    }

    fs::write(&path, content).map_err(|e| format!("Failed to save file: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn open_file_native(path: String) -> Result<(), String> {
    if path.starts_with("archive://") || path.starts_with("sftp://") || path.starts_with("ftp://") {
        return Err("Cannot directly open virtual/remote file in external app. Please view (F3) or copy (F5) locally first.".to_string());
    }

    Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open {}: {}", path, e))?;
    Ok(())
}

#[tauri::command]
pub fn create_directory(
    parent_path: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if parent_path.starts_with("archive://") {
        return Err("Cannot create directory inside virtual archive".to_string());
    }

    if let Some((proto, site_id, remote_path)) = parse_remote_url(&parent_path) {
        let site = state
            .remote_manager
            .get_site(&site_id)
            .ok_or_else(|| "Remote site not found".to_string())?;
        let full_remote = if remote_path == "/" {
            format!("/{}", name)
        } else {
            format!("{}/{}", remote_path.trim_end_matches('/'), name)
        };
        if proto == "ftp" {
            create_ftp_directory(&site, &full_remote)?;
        } else {
            create_sftp_directory(&site, &full_remote)?;
        }
        return Ok(());
    }

    let target = Path::new(&parent_path).join(&name);
    fs::create_dir_all(&target).map_err(|e| format!("Failed to create directory: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn delete_items(
    paths: Vec<String>,
    permanent: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    for p in paths {
        if p.starts_with("archive://") {
            continue;
        }

        if let Some((proto, site_id, remote_path)) = parse_remote_url(&p) {
            let site = state
                .remote_manager
                .get_site(&site_id)
                .ok_or_else(|| "Remote site not found".to_string())?;
            if proto == "ftp" {
                delete_ftp_file(&site, &remote_path)?;
            } else {
                delete_sftp_file(&site, &remote_path)?;
            }
            continue;
        }

        if permanent {
            let path_obj = Path::new(&p);
            if path_obj.is_dir() {
                fs::remove_dir_all(path_obj).map_err(|e| format!("Failed to delete directory {}: {}", p, e))?;
            } else {
                fs::remove_file(path_obj).map_err(|e| format!("Failed to delete file {}: {}", p, e))?;
            }
        } else {
            trash::delete(Path::new(&p)).map_err(|e| format!("Failed to trash {}: {}", p, e))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn copy_items(
    sources: Vec<String>,
    dest_dir: String,
    _overwrite: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let dest_path = PathBuf::from(&dest_dir);

    for src in sources {
        if let Some((archive_path, subpath)) = parse_archive_url(&src) {
            extract_selected_from_archive(&archive_path, &subpath, &dest_path)?;
            continue;
        }

        if let Some((proto, site_id, remote_path)) = parse_remote_url(&src) {
            let site = state
                .remote_manager
                .get_site(&site_id)
                .ok_or_else(|| "Remote site not found".to_string())?;
            let data = if proto == "ftp" {
                download_ftp_file(&site, &remote_path)?
            } else {
                download_sftp_file(&site, &remote_path)?
            };
            let file_name = Path::new(&remote_path)
                .file_name()
                .unwrap_or(Path::new("downloaded").as_os_str());
            let target = dest_path.join(file_name);
            fs::write(target, data).map_err(|e| e.to_string())?;
            continue;
        }

        if let Some((proto, site_id, remote_path)) = parse_remote_url(&dest_dir) {
            let site = state
                .remote_manager
                .get_site(&site_id)
                .ok_or_else(|| "Remote site not found".to_string())?;
            let src_path = PathBuf::from(&src);
            if src_path.is_file() {
                let bytes = fs::read(&src_path).map_err(|e| e.to_string())?;
                let file_name = src_path
                    .file_name()
                    .unwrap_or(Path::new("file").as_os_str())
                    .to_string_lossy();
                let remote_target = format!("{}/{}", remote_path.trim_end_matches('/'), file_name);
                if proto == "ftp" {
                    upload_ftp_file(&site, &remote_target, &bytes)?;
                } else {
                    upload_sftp_file(&site, &remote_target, &bytes)?;
                }
            }
            continue;
        }

        // Local to Local
        let src_path = PathBuf::from(&src);
        if !src_path.exists() {
            continue;
        }
        let file_name = src_path
            .file_name()
            .ok_or_else(|| "Invalid source file name".to_string())?;
        let target = dest_path.join(file_name);
        copy_recursive(&src_path, &target).map_err(|e| format!("Copy failed: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn move_items(
    sources: Vec<String>,
    dest_dir: String,
    _overwrite: bool,
) -> Result<(), String> {
    let dest_path = PathBuf::from(&dest_dir);

    for src in sources {
        let src_path = PathBuf::from(&src);
        if !src_path.exists() {
            continue;
        }
        let file_name = src_path
            .file_name()
            .ok_or_else(|| "Invalid source file name".to_string())?;
        let target = dest_path.join(file_name);
        
        // Try atomic rename first
        if fs::rename(&src_path, &target).is_err() {
            // Fallback: copy and remove original
            copy_recursive(&src_path, &target).map_err(|e| format!("Move failed: {}", e))?;
            if src_path.is_dir() {
                fs::remove_dir_all(&src_path).ok();
            } else {
                fs::remove_file(&src_path).ok();
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn create_archive(
    sources: Vec<String>,
    archive_path: String,
    archive_type: String,
) -> Result<(), String> {
    let paths: Vec<PathBuf> = sources.into_iter().map(PathBuf::from).collect();
    let out_path = PathBuf::from(archive_path);

    if archive_type == "targz" || archive_type == "tar.gz" {
        create_targz_archive(&paths, &out_path)
    } else {
        create_zip_archive(&paths, &out_path)
    }
}

#[tauri::command]
pub fn execute_shell_command(working_dir: String, command: String) -> Result<ShellOutput, String> {
    let clean_dir = if working_dir.starts_with("archive://") || working_dir.starts_with("sftp://") || working_dir.starts_with("ftp://") {
        dirs::home_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|| "/".to_string())
    } else {
        working_dir
    };

    let output = Command::new("zsh")
        .arg("-c")
        .arg(&command)
        .current_dir(&clean_dir)
        .output()
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    Ok(ShellOutput {
        stdout,
        stderr,
        exit_code,
        current_dir: clean_dir,
    })
}

#[tauri::command]
pub fn get_saved_sites() -> Vec<SiteConfig> {
    load_sites()
}

#[tauri::command]
pub fn save_site_config(site: SiteConfig) -> Result<(), String> {
    save_site(site)
}

#[tauri::command]
pub fn delete_site_config(id: String) -> Result<(), String> {
    delete_site(&id)
}

#[tauri::command]
pub async fn connect_site(
    site_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let sites = load_sites();
    let site = sites
        .into_iter()
        .find(|s| s.id == site_id)
        .ok_or_else(|| format!("Site with id '{}' not found", site_id))?;

    let default_path = site.default_path.clone().unwrap_or_else(|| "/".to_string());
    let proto = site.protocol.clone();

    // Verify connection so that errors are reported immediately to the user!
    if proto == "ftp" {
        test_ftp_connection(&site)?;
    } else {
        test_sftp_connection(&site)?;
    }

    state.remote_manager.register_session(site);

    Ok(format!("{}://{}{}", proto, site_id, if default_path.starts_with('/') { default_path } else { format!("/{}", default_path) }))
}

#[tauri::command]
pub fn detect_external_sites() -> Result<Vec<crate::importers::DiscoveredSite>, String> {
    Ok(crate::importers::scan_discovered_sites())
}

#[tauri::command]
pub fn parse_imported_sites(content: String) -> Result<Vec<SiteConfig>, String> {
    Ok(crate::importers::parse_imported_content(&content))
}

#[tauri::command]
pub fn import_sites_batch(sites: Vec<SiteConfig>, overwrite: bool) -> Result<usize, String> {
    crate::site_manager::save_multiple_sites(sites, overwrite)
}

#[tauri::command]
pub fn export_sites_to_json() -> Result<String, String> {
    crate::site_manager::export_sites_json()
}
