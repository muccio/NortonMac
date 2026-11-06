use crate::archive_vfs::{
    calculate_archive_subpath_size, create_targz_archive, create_zip_archive,
    extract_archive_file_to_bytes, extract_selected_from_archive, list_archive, parse_archive_url,
};
use crate::local_fs::{
    calculate_local_item_size, copy_recursive_with_progress, count_local_files_and_bytes,
    get_all_volumes, list_local_directory, make_unique_duplicate_name,
};
use crate::models::{
    DirectoryListing, FilePreview, HexLine, ShellOutput, SiteConfig, TransferProgress, VolumeInfo,
};
use crate::remote_fs::{
    calculate_ftp_item_size, calculate_sftp_item_size, create_ftp_directory,
    create_sftp_directory, delete_ftp_file, delete_sftp_file, download_ftp_file,
    download_sftp_file, duplicate_ftp_items_with_progress, duplicate_sftp_items_with_progress,
    list_ftp_directory, list_sftp_directory, parse_remote_url, upload_ftp_file,
    upload_sftp_file, verify_and_prepare_site, RemoteManager,
};
use crate::site_manager::{delete_site, load_sites, save_site};
use base64::prelude::*;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

pub struct AppState {
    pub remote_manager: Arc<RemoteManager>,
}

fn is_ftp_proto(proto: &str) -> bool {
    proto == "ftp" || proto == "ftps"
}

async fn run_remote_blocking<T, F>(timeout_secs: u64, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    match tokio::time::timeout(
        Duration::from_secs(timeout_secs),
        tokio::task::spawn_blocking(f),
    )
    .await
    {
        Ok(Ok(res)) => res,
        Ok(Err(join_err)) => Err(format!("Errore task di rete: {}", join_err)),
        Err(_) => Err(format!(
            "Timeout operazione remota ({}s): il server non risponde o la connessione dati passiva è bloccata.",
            timeout_secs
        )),
    }
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
            return run_remote_blocking(20, move || {
                if is_ftp_proto(&proto) {
                    list_ftp_directory(&site, &remote_path, show_hidden)
                } else {
                    list_sftp_directory(&site, &remote_path, show_hidden)
                }
            })
            .await;
        } else {
            return Err(format!("Sessione remota '{}' non trovata. Riconnettiti con F9.", site_id));
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
        let b = run_remote_blocking(30, move || {
            if is_ftp_proto(&proto) {
                download_ftp_file(&site, &remote_path)
            } else {
                download_sftp_file(&site, &remote_path)
            }
        })
        .await?;
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
        let bytes = content.into_bytes();
        run_remote_blocking(30, move || {
            if is_ftp_proto(&proto) {
                upload_ftp_file(&site, &remote_path, &bytes)
            } else {
                upload_sftp_file(&site, &remote_path, &bytes)
            }
        })
        .await?;
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
    if path.starts_with("archive://")
        || path.starts_with("sftp://")
        || path.starts_with("ftp://")
        || path.starts_with("ftps://")
    {
        return Err("Cannot directly open virtual/remote file in external app. Please view (F3) or copy (F5) locally first.".to_string());
    }

    Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open {}: {}", path, e))?;
    Ok(())
}

#[tauri::command]
pub async fn create_directory(
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
        run_remote_blocking(15, move || {
            if is_ftp_proto(&proto) {
                create_ftp_directory(&site, &full_remote)
            } else {
                create_sftp_directory(&site, &full_remote)
            }
        })
        .await?;
        return Ok(());
    }

    let target = Path::new(&parent_path).join(&name);
    fs::create_dir_all(&target).map_err(|e| format!("Failed to create directory: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn delete_items(
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
            run_remote_blocking(20, move || {
                if is_ftp_proto(&proto) {
                    delete_ftp_file(&site, &remote_path)
                } else {
                    delete_sftp_file(&site, &remote_path)
                }
            })
            .await?;
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

struct ProgressReporter {
    app: AppHandle,
    operation: String,
    total_files: usize,
    total_bytes: u64,
    files_done: usize,
    bytes_done: u64,
    last_emit: Instant,
}

impl ProgressReporter {
    fn new(app: AppHandle, operation: &str, total_files: usize, total_bytes: u64) -> Self {
        Self {
            app,
            operation: operation.to_string(),
            total_files: total_files.max(1),
            total_bytes,
            files_done: 0,
            bytes_done: 0,
            last_emit: Instant::now()
                .checked_sub(Duration::from_secs(1))
                .unwrap_or_else(Instant::now),
        }
    }

    fn compute_percent(&self) -> f64 {
        if self.total_bytes > 0 {
            ((self.bytes_done as f64 / self.total_bytes as f64) * 100.0).clamp(0.0, 100.0)
        } else if self.total_files > 0 {
            ((self.files_done as f64 / self.total_files as f64) * 100.0).clamp(0.0, 100.0)
        } else {
            100.0
        }
    }

    fn emit(&mut self, current_file: &str, force: bool) {
        if !force && self.last_emit.elapsed() < Duration::from_millis(35) {
            return;
        }
        self.last_emit = Instant::now();
        let payload = TransferProgress {
            operation: self.operation.clone(),
            current_file: current_file.to_string(),
            files_done: self.files_done.min(self.total_files),
            total_files: self.total_files,
            bytes_done: if self.total_bytes > 0 {
                self.bytes_done.min(self.total_bytes)
            } else {
                self.bytes_done
            },
            total_bytes: self.total_bytes,
            percent: self.compute_percent(),
        };
        let _ = self.app.emit("transfer-progress", &payload);
    }

    fn emit_complete(&mut self, last_file: &str) {
        self.files_done = self.total_files;
        if self.total_bytes > 0 {
            self.bytes_done = self.total_bytes;
        }
        let payload = TransferProgress {
            operation: self.operation.clone(),
            current_file: last_file.to_string(),
            files_done: self.total_files,
            total_files: self.total_files,
            bytes_done: self.bytes_done,
            total_bytes: self.total_bytes,
            percent: 100.0,
        };
        let _ = self.app.emit("transfer-progress", &payload);
    }
}

fn item_display_label(src: &str) -> String {
    if let Some((_, subpath)) = parse_archive_url(src) {
        return Path::new(subpath.trim_matches('/'))
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("archive_item")
            .to_string();
    }
    if let Some((_, _, remote_path)) = parse_remote_url(src) {
        return Path::new(remote_path.trim_matches('/'))
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("remote_item")
            .to_string();
    }
    Path::new(src)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(src)
        .to_string()
}

#[tauri::command]
pub async fn copy_items(
    sources: Vec<String>,
    dest_dir: String,
    _overwrite: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if sources.is_empty() {
        return Ok(());
    }

    let is_remote_dest = parse_remote_url(&dest_dir).is_some();
    let has_remote_src = sources.iter().any(|s| parse_remote_url(s).is_some());

    // Pure local/archive copy -> run inside a single spawn_blocking task with chunked byte progress
    if !is_remote_dest && !has_remote_src {
        let app_clone = app.clone();
        return tokio::task::spawn_blocking(move || {
            let dest_path = PathBuf::from(&dest_dir);

            let mut total_files = 0usize;
            let mut total_bytes = 0u64;
            for src in &sources {
                if let Some((archive_path, subpath)) = parse_archive_url(src) {
                    total_files += 1;
                    total_bytes = total_bytes
                        .saturating_add(calculate_archive_subpath_size(&archive_path, &subpath).unwrap_or(0));
                } else {
                    let p = PathBuf::from(src);
                    if p.exists() || fs::symlink_metadata(&p).is_ok() {
                        let (f, b) = count_local_files_and_bytes(&p);
                        total_files += f.max(1);
                        total_bytes = total_bytes.saturating_add(b);
                    }
                }
            }

            let first_label = item_display_label(&sources[0]);
            let mut reporter = ProgressReporter::new(app_clone, "copy", total_files, total_bytes);
            reporter.emit(&first_label, true);

            let mut last_label = first_label;

            for src in sources {
                if let Some((archive_path, subpath)) = parse_archive_url(&src) {
                    let label = item_display_label(&src);
                    last_label = label.clone();
                    reporter.emit(&label, true);
                    let est_size = calculate_archive_subpath_size(&archive_path, &subpath).unwrap_or(0);
                    extract_selected_from_archive(&archive_path, &subpath, &dest_path)?;
                    reporter.bytes_done = reporter.bytes_done.saturating_add(est_size);
                    reporter.files_done += 1;
                    reporter.emit(&label, true);
                    continue;
                }

                let src_path = PathBuf::from(&src);
                if !src_path.exists() && fs::symlink_metadata(&src_path).is_err() {
                    continue;
                }

                let file_name = src_path
                    .file_name()
                    .ok_or_else(|| "Invalid source file name".to_string())?;
                let target = dest_path.join(file_name);

                let mut files_in_this_item = 0usize;
                copy_recursive_with_progress(&src_path, &target, &mut |name, delta, file_done| {
                    last_label = name.to_string();
                    reporter.bytes_done = reporter.bytes_done.saturating_add(delta);
                    if file_done {
                        files_in_this_item += 1;
                        reporter.files_done += 1;
                    }
                    reporter.emit(name, file_done);
                })
                .map_err(|e| format!("Copy failed: {}", e))?;

                if files_in_this_item == 0 {
                    // Empty top-level directory
                    reporter.files_done += 1;
                    reporter.emit(&last_label, true);
                }
            }

            reporter.emit_complete(&last_label);
            Ok(())
        })
        .await
        .map_err(|e| format!("Task join error: {}", e))?;
    }

    // Remote involved (FTP / FTPS / SFTP upload or download)
    let dest_path = PathBuf::from(&dest_dir);
    let mut total_bytes = 0u64;
    let total_files = sources.len().max(1);
    if is_remote_dest {
        for src in &sources {
            let p = PathBuf::from(src);
            if p.is_file() {
                if let Ok(m) = p.metadata() {
                    total_bytes = total_bytes.saturating_add(m.len());
                }
            }
        }
    }

    let first_label = item_display_label(&sources[0]);
    let mut reporter = ProgressReporter::new(app.clone(), "copy", total_files, total_bytes);
    reporter.emit(&first_label, true);
    let mut last_label = first_label;

    for src in sources {
        let label = item_display_label(&src);
        last_label = label.clone();
        reporter.emit(&label, true);

        if let Some((proto, site_id, remote_path)) = parse_remote_url(&src) {
            let site = state
                .remote_manager
                .get_site(&site_id)
                .ok_or_else(|| "Remote site not found".to_string())?;
            let rp_clone = remote_path.clone();
            let data = run_remote_blocking(90, move || {
                if is_ftp_proto(&proto) {
                    download_ftp_file(&site, &rp_clone)
                } else {
                    download_sftp_file(&site, &rp_clone)
                }
            })
            .await?;
            let dl_len = data.len() as u64;
            let file_name = Path::new(&remote_path)
                .file_name()
                .unwrap_or(Path::new("downloaded").as_os_str());
            let target = dest_path.join(file_name);
            fs::write(target, data).map_err(|e| e.to_string())?;
            reporter.bytes_done = reporter.bytes_done.saturating_add(dl_len);
            reporter.files_done += 1;
            reporter.emit(&label, true);
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
                let up_len = bytes.len() as u64;
                let file_name = src_path
                    .file_name()
                    .unwrap_or(Path::new("file").as_os_str())
                    .to_string_lossy()
                    .to_string();
                let remote_target = format!("{}/{}", remote_path.trim_end_matches('/'), file_name);
                run_remote_blocking(90, move || {
                    if is_ftp_proto(&proto) {
                        upload_ftp_file(&site, &remote_target, &bytes)
                    } else {
                        upload_sftp_file(&site, &remote_target, &bytes)
                    }
                })
                .await?;
                reporter.bytes_done = reporter.bytes_done.saturating_add(up_len);
            }
            reporter.files_done += 1;
            reporter.emit(&label, true);
            continue;
        }
    }

    reporter.emit_complete(&last_label);
    Ok(())
}

#[tauri::command]
pub async fn move_items(
    sources: Vec<String>,
    dest_dir: String,
    _overwrite: bool,
    app: AppHandle,
) -> Result<(), String> {
    if sources.is_empty() {
        return Ok(());
    }

    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        let raw_dest = PathBuf::from(&dest_dir);

        let mut total_files = 0usize;
        let mut total_bytes = 0u64;
        let mut per_item_stats: Vec<(usize, u64)> = Vec::with_capacity(sources.len());

        for src in &sources {
            let p = PathBuf::from(src);
            if p.exists() || fs::symlink_metadata(&p).is_ok() {
                let (f, b) = count_local_files_and_bytes(&p);
                let f_norm = f.max(1);
                total_files += f_norm;
                total_bytes = total_bytes.saturating_add(b);
                per_item_stats.push((f_norm, b));
            } else {
                per_item_stats.push((0, 0));
            }
        }

        let first_label = item_display_label(&sources[0]);
        let mut reporter = ProgressReporter::new(app_clone, "move", total_files, total_bytes);
        reporter.emit(&first_label, true);
        let mut last_label = first_label;

        let single_item = sources.len() == 1;

        for (idx, src) in sources.into_iter().enumerate() {
            let src_path = PathBuf::from(&src);
            if !src_path.exists() && fs::symlink_metadata(&src_path).is_err() {
                continue;
            }
            let file_name = src_path
                .file_name()
                .ok_or_else(|| "Invalid source file name".to_string())?;
            let label = file_name.to_string_lossy().to_string();
            last_label = label.clone();
            reporter.emit(&label, true);

            // Resolve target path: supports moving into an existing folder OR single-item rename
            let resolved_dest = if raw_dest.is_relative() {
                src_path
                    .parent()
                    .unwrap_or_else(|| Path::new("/"))
                    .join(&raw_dest)
            } else {
                raw_dest.clone()
            };

            let target = if resolved_dest.is_dir() || !single_item {
                if !resolved_dest.exists() {
                    fs::create_dir_all(&resolved_dest)
                        .map_err(|e| format!("Failed to create destination directory: {}", e))?;
                }
                resolved_dest.join(file_name)
            } else if dest_dir.ends_with('/') {
                fs::create_dir_all(&resolved_dest)
                    .map_err(|e| format!("Failed to create destination directory: {}", e))?;
                resolved_dest.join(file_name)
            } else {
                resolved_dest
            };

            let (item_files, item_bytes) = per_item_stats.get(idx).copied().unwrap_or((1, 0));

            // Try fast same-volume atomic rename first
            if fs::rename(&src_path, &target).is_ok() {
                reporter.bytes_done = reporter.bytes_done.saturating_add(item_bytes);
                reporter.files_done += item_files;
                reporter.emit(&label, true);
            } else {
                // Cross-volume move (e.g. Mac SSD <-> external USB/SD drive): chunked copy + delete source
                let mut files_copied_here = 0usize;
                copy_recursive_with_progress(&src_path, &target, &mut |name, delta, file_done| {
                    last_label = name.to_string();
                    reporter.bytes_done = reporter.bytes_done.saturating_add(delta);
                    if file_done {
                        files_copied_here += 1;
                        reporter.files_done += 1;
                    }
                    reporter.emit(name, file_done);
                })
                .map_err(|e| format!("Move failed: {}", e))?;

                if files_copied_here == 0 {
                    reporter.files_done += 1;
                }

                let is_dir = fs::symlink_metadata(&src_path)
                    .map(|m| m.is_dir() && !m.file_type().is_symlink())
                    .unwrap_or(false);
                if is_dir {
                    fs::remove_dir_all(&src_path)
                        .map_err(|e| format!("Copied, but failed to remove source folder: {}", e))?;
                } else {
                    fs::remove_file(&src_path)
                        .map_err(|e| format!("Copied, but failed to remove source file: {}", e))?;
                }
                reporter.emit(&last_label, true);
            }
        }

        reporter.emit_complete(&last_label);
        Ok(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

#[tauri::command]
pub async fn duplicate_items(
    sources: Vec<String>,
    new_name: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    if sources.is_empty() {
        return Ok(Vec::new());
    }

    if sources.iter().any(|s| s.starts_with("archive://")) {
        return Err(
            "Gli archivi virtuali sono in sola lettura: estrai prima i file con F5 per duplicarli."
                .to_string(),
        );
    }

    // Remote FTP / FTPS / SFTP duplication (files & recursive folders)
    if let Some((proto, site_id, _)) = parse_remote_url(&sources[0]) {
        let site = state
            .remote_manager
            .get_site(&site_id)
            .ok_or_else(|| format!("Sessione remota '{}' non trovata. Riconnettiti con F9.", site_id))?;

        let single = sources.len() == 1;
        let mut remote_items: Vec<(String, Option<String>)> = Vec::with_capacity(sources.len());
        for s in &sources {
            let (_, sid, rpath) = parse_remote_url(s)
                .ok_or_else(|| "Selezione mista locale/remota non supportata per Duplica.".to_string())?;
            if sid != site_id {
                return Err("Tutti gli elementi remoti devono appartenere allo stesso server.".to_string());
            }
            remote_items.push((rpath, if single { new_name.clone() } else { None }));
        }

        let app_clone = app.clone();
        return run_remote_blocking(600, move || {
            let mut last_emit = Instant::now()
                .checked_sub(Duration::from_secs(1))
                .unwrap_or_else(Instant::now);
            let mut last_file = String::from("remote");

            let mut progress_cb =
                |cur: &str, b_done: u64, b_total: u64, f_done: usize, f_total: usize, force: bool| {
                    last_file = cur.to_string();
                    if !force && last_emit.elapsed() < Duration::from_millis(35) {
                        return;
                    }
                    last_emit = Instant::now();
                    let pct = if b_total > 0 {
                        ((b_done as f64 / b_total as f64) * 100.0).clamp(0.0, 100.0)
                    } else if f_total > 0 {
                        ((f_done as f64 / f_total as f64) * 100.0).clamp(0.0, 100.0)
                    } else {
                        100.0
                    };
                    let _ = app_clone.emit(
                        "transfer-progress",
                        &TransferProgress {
                            operation: "duplicate".to_string(),
                            current_file: cur.to_string(),
                            files_done: f_done.min(f_total.max(1)),
                            total_files: f_total.max(1),
                            bytes_done: b_done,
                            total_bytes: b_total,
                            percent: pct,
                        },
                    );
                };

            let created = if is_ftp_proto(&proto) {
                duplicate_ftp_items_with_progress(&site, &remote_items, &mut progress_cb)?
            } else {
                duplicate_sftp_items_with_progress(&site, &remote_items, &mut progress_cb)?
            };

            let _ = app_clone.emit(
                "transfer-progress",
                &TransferProgress {
                    operation: "duplicate".to_string(),
                    current_file: last_file,
                    files_done: created.len().max(1),
                    total_files: created.len().max(1),
                    bytes_done: 0,
                    total_bytes: 0,
                    percent: 100.0,
                },
            );

            Ok(created)
        })
        .await;
    }

    // Local filesystem duplication (files & recursive folders)
    let app_clone = app.clone();
    tokio::task::spawn_blocking(move || {
        let single = sources.len() == 1;
        let mut parent_existing_cache: HashMap<PathBuf, HashSet<String>> = HashMap::new();
        let mut plan: Vec<(PathBuf, PathBuf, String)> = Vec::with_capacity(sources.len());
        let mut total_files = 0usize;
        let mut total_bytes = 0u64;

        for src in &sources {
            let src_path = PathBuf::from(src);
            let meta = fs::symlink_metadata(&src_path)
                .map_err(|e| format!("Elemento '{}' non trovato: {}", src, e))?;
            let is_dir = meta.is_dir() && !meta.file_type().is_symlink();
            let src_name = src_path
                .file_name()
                .and_then(|n| n.to_str())
                .ok_or_else(|| format!("Nome elemento non valido: '{}'", src))?
                .to_string();
            let parent_dir = src_path
                .parent()
                .ok_or_else(|| format!("Impossibile determinare la cartella padre di '{}'", src))?
                .to_path_buf();

            if !parent_existing_cache.contains_key(&parent_dir) {
                let mut set = HashSet::new();
                if let Ok(rd) = fs::read_dir(&parent_dir) {
                    for entry in rd.flatten() {
                        set.insert(entry.file_name().to_string_lossy().to_lowercase());
                    }
                }
                parent_existing_cache.insert(parent_dir.clone(), set);
            }
            let existing_lower = parent_existing_cache.get_mut(&parent_dir).unwrap();

            let target_name = match (&new_name, single) {
                (Some(raw_custom), true) if !raw_custom.trim().is_empty() => {
                    let clean = raw_custom.trim().trim_matches('/').to_string();
                    if clean.contains('/') || clean.contains('\\') {
                        return Err("Il nome del duplicato non può contenere '/'".to_string());
                    }
                    let candidate_path = parent_dir.join(&clean);
                    if candidate_path.exists() || fs::symlink_metadata(&candidate_path).is_ok() {
                        return Err(format!(
                            "Esiste già un elemento chiamato '{}' in questa cartella",
                            clean
                        ));
                    }
                    existing_lower.insert(clean.to_lowercase());
                    clean
                }
                _ => {
                    let generated = make_unique_duplicate_name(&src_name, is_dir, existing_lower);
                    existing_lower.insert(generated.to_lowercase());
                    generated
                }
            };

            let target_path = parent_dir.join(&target_name);
            let (f, b) = count_local_files_and_bytes(&src_path);
            total_files += f.max(1);
            total_bytes = total_bytes.saturating_add(b);
            plan.push((src_path, target_path, target_name));
        }

        let first_label = plan
            .first()
            .map(|(_, _, n)| n.clone())
            .unwrap_or_else(|| "duplicate".to_string());
        let mut reporter = ProgressReporter::new(app_clone, "duplicate", total_files, total_bytes);
        reporter.emit(&first_label, true);
        let mut last_label = first_label;
        let mut created_names = Vec::with_capacity(plan.len());

        for (src_path, target_path, target_name) in plan {
            let mut files_in_this_item = 0usize;
            copy_recursive_with_progress(&src_path, &target_path, &mut |name, delta, file_done| {
                last_label = name.to_string();
                reporter.bytes_done = reporter.bytes_done.saturating_add(delta);
                if file_done {
                    files_in_this_item += 1;
                    reporter.files_done += 1;
                }
                reporter.emit(name, file_done);
            })
            .map_err(|e| format!("Duplicazione fallita: {}", e))?;

            if files_in_this_item == 0 {
                reporter.files_done += 1;
                reporter.emit(&target_name, true);
            }
            created_names.push(target_name);
        }

        reporter.emit_complete(&last_label);
        Ok(created_names)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
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
    let clean_dir = if working_dir.starts_with("archive://")
        || working_dir.starts_with("sftp://")
        || working_dir.starts_with("ftp://")
        || working_dir.starts_with("ftps://")
    {
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
    let mut site = sites
        .into_iter()
        .find(|s| s.id == site_id)
        .ok_or_else(|| format!("Profilo '{}' non trovato", site_id))?;

    // Run TCP + protocol banner inspection + handshake/login inside bounded blocking task (max 18s)
    let (verify_res, verified_site, was_mutated) = run_remote_blocking(18, move || {
        let mut mutated = false;
        let res = verify_and_prepare_site(&mut site, &mut mutated);
        Ok((res, site, mutated))
    })
    .await?;

    // Persist auto-healed protocol/host back to sites.json even if auth subsequently failed!
    if was_mutated {
        let _ = save_site(verified_site.clone());
    }

    verify_res?;

    let default_path = verified_site
        .default_path
        .clone()
        .unwrap_or_else(|| "/".to_string());
    let proto = verified_site.protocol.clone();

    state.remote_manager.register_session(verified_site);

    Ok(format!(
        "{}://{}{}",
        proto,
        site_id,
        if default_path.starts_with('/') {
            default_path
        } else {
            format!("/{}", default_path)
        }
    ))
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

#[tauri::command]
pub async fn calculate_item_size(
    path: String,
    state: State<'_, AppState>,
) -> Result<u64, String> {
    if let Some((archive_path, subpath)) = parse_archive_url(&path) {
        return tokio::task::spawn_blocking(move || {
            calculate_archive_subpath_size(&archive_path, &subpath)
        })
        .await
        .map_err(|e| e.to_string())?;
    }

    if let Some((proto, site_id, remote_path)) = parse_remote_url(&path) {
        let site = state
            .remote_manager
            .get_site(&site_id)
            .ok_or_else(|| format!("Sessione remota '{}' non trovata", site_id))?;
        return run_remote_blocking(25, move || {
            if is_ftp_proto(&proto) {
                calculate_ftp_item_size(&site, &remote_path)
            } else {
                calculate_sftp_item_size(&site, &remote_path)
            }
        })
        .await;
    }

    tokio::task::spawn_blocking(move || Ok(calculate_local_item_size(Path::new(&path))))
        .await
        .map_err(|e| e.to_string())?
}
