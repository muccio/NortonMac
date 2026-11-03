use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub is_archive: bool,
    pub modified: String,
    pub permissions: String,
    pub extension: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryListing {
    pub path: String,
    pub display_path: String,
    pub is_virtual: bool,
    pub archive_parent: Option<String>,
    pub volume_name: String,
    pub total_space: u64,
    pub free_space: u64,
    pub entries: Vec<FileEntry>,
    pub show_hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VolumeInfo {
    pub name: String,
    pub mount_point: String,
    pub total_space: u64,
    pub available_space: u64,
    pub is_removable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilePreview {
    pub path: String,
    pub filename: String,
    pub size: u64,
    pub is_binary: bool,
    pub text_content: Option<String>,
    pub hex_lines: Vec<HexLine>,
    pub encoding: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HexLine {
    pub offset: String,
    pub hex_bytes: String,
    pub ascii: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub current_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SiteConfig {
    pub id: String,
    pub name: String,
    pub protocol: String, // "sftp" | "ftp"
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub default_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopyProgress {
    pub current_file: String,
    pub files_copied: usize,
    pub total_files: usize,
    pub bytes_copied: u64,
    pub total_bytes: u64,
    pub done: bool,
}
