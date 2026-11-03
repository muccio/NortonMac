use crate::models::{DirectoryListing, FileEntry, VolumeInfo};
use chrono::{DateTime, Local};
use std::fs;
use std::os::unix::fs::PermissionsExt;
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

pub fn get_volume_for_path(path: &Path) -> (String, u64, u64) {
    let disks = Disks::new_with_refreshed_list();
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    
    let mut best_match: Option<(&sysinfo::Disk, usize)> = None;
    for disk in disks.list() {
        let mount_str = disk.mount_point().to_str().unwrap_or("");
        if canonical.starts_with(disk.mount_point()) {
            let len = mount_str.len();
            if best_match.is_none() || len > best_match.unwrap().1 {
                best_match = Some((disk, len));
            }
        }
    }

    if let Some((disk, _)) = best_match {
        let name = disk.name().to_str().unwrap_or("Macintosh HD").to_string();
        (name, disk.total_space(), disk.available_space())
    } else {
        ("Macintosh HD".to_string(), 0, 0)
    }
}

pub fn get_all_volumes() -> Vec<VolumeInfo> {
    let disks = Disks::new_with_refreshed_list();
    let mut list = Vec::new();
    
    for disk in disks.list() {
        let mount = disk.mount_point().to_string_lossy().to_string();
        let name = disk.name().to_string_lossy().to_string();
        let display_name = if name.is_empty() || name == "/" {
            "Macintosh HD".to_string()
        } else {
            name
        };
        
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

pub fn copy_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    if src.is_dir() {
        fs::create_dir_all(dst)?;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            let entry_path = entry.path();
            let dest_child = dst.join(entry.file_name());
            copy_recursive(&entry_path, &dest_child)?;
        }
    } else {
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(src, dst)?;
    }
    Ok(())
}
