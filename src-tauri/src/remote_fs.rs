use crate::models::{DirectoryListing, FileEntry, SiteConfig};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::sync::Mutex;
use suppaftp::FtpStream;

pub struct RemoteManager {
    pub sftp_sessions: Mutex<HashMap<String, SiteConfig>>,
    pub ftp_sessions: Mutex<HashMap<String, SiteConfig>>,
}

impl RemoteManager {
    pub fn new() -> Self {
        Self {
            sftp_sessions: Mutex::new(HashMap::new()),
            ftp_sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn register_session(&self, site: SiteConfig) -> String {
        let key = site.id.clone();
        if site.protocol == "ftp" {
            let mut map = self.ftp_sessions.lock().unwrap();
            map.insert(key.clone(), site);
        } else {
            let mut map = self.sftp_sessions.lock().unwrap();
            map.insert(key.clone(), site);
        }
        key
    }

    pub fn get_site(&self, key: &str) -> Option<SiteConfig> {
        if let Some(s) = self.sftp_sessions.lock().unwrap().get(key).cloned() {
            return Some(s);
        }
        self.ftp_sessions.lock().unwrap().get(key).cloned()
    }
}

pub fn parse_remote_url(url: &str) -> Option<(String, String, String)> {
    // Returns (protocol, site_id, path)
    if url.starts_with("sftp://") {
        let rest = &url["sftp://".len()..];
        let parts: Vec<&str> = rest.splitn(2, '/').collect();
        let site_id = parts[0].to_string();
        let path = if parts.len() > 1 {
            format!("/{}", parts[1])
        } else {
            "/".to_string()
        };
        Some(("sftp".to_string(), site_id, path))
    } else if url.starts_with("ftp://") {
        let rest = &url["ftp://".len()..];
        let parts: Vec<&str> = rest.splitn(2, '/').collect();
        let site_id = parts[0].to_string();
        let path = if parts.len() > 1 {
            format!("/{}", parts[1])
        } else {
            "/".to_string()
        };
        Some(("ftp".to_string(), site_id, path))
    } else {
        None
    }
}

pub fn create_ssh_session(site: &SiteConfig) -> Result<(ssh2::Session, TcpStream), String> {
    let addr = format!("{}:{}", site.host, site.port);
    let tcp = TcpStream::connect(&addr).map_err(|e| format!("Failed to connect to {}: {}", addr, e))?;
    
    let mut sess = ssh2::Session::new().map_err(|e| e.to_string())?;
    sess.set_tcp_stream(tcp);
    sess.handshake().map_err(|e| format!("SSH handshake failed: {}", e))?;

    if let Some(key_path) = &site.private_key_path {
        if !key_path.is_empty() {
            let p = Path::new(key_path);
            sess.userauth_pubkey_file(&site.username, None, p, site.password.as_deref())
                .map_err(|e| format!("Public key authentication failed: {}", e))?;
            return Ok((sess, unsafe { std::mem::zeroed() }));
        }
    }

    if let Some(pwd) = &site.password {
        sess.userauth_password(&site.username, pwd)
            .map_err(|e| format!("Password authentication failed: {}", e))?;
    } else {
        sess.userauth_agent(&site.username)
            .map_err(|e| format!("Agent authentication failed: {}", e))?;
    }

    if !sess.authenticated() {
        return Err("SSH authentication failed".to_string());
    }

    Ok((sess, unsafe { std::mem::zeroed() }))
}

pub fn list_sftp_directory(site: &SiteConfig, remote_path: &str) -> Result<DirectoryListing, String> {
    let (sess, _) = create_ssh_session(site)?;
    let sftp = sess.sftp().map_err(|e| format!("SFTP initialization failed: {}", e))?;

    let clean_path = if remote_path.is_empty() { "/" } else { remote_path };
    let path_obj = Path::new(clean_path);

    let mut entries: Vec<FileEntry> = Vec::new();

    // Add parent entry if not root
    if clean_path != "/" {
        let parent = path_obj.parent().unwrap_or(Path::new("/")).to_string_lossy().to_string();
        let parent_url = format!("sftp://{}{}", site.id, if parent.starts_with('/') { parent } else { format!("/{}", parent) });
        entries.push(FileEntry {
            name: "..".to_string(),
            path: parent_url,
            size: 0,
            is_dir: true,
            is_symlink: false,
            is_archive: false,
            modified: "".to_string(),
            permissions: "drwxr-xr-x".to_string(),
            extension: "".to_string(),
        });
    }

    let dir = sftp.readdir(path_obj).map_err(|e| format!("Failed to read SFTP directory {}: {}", clean_path, e))?;

    for (entry_path, stat) in dir {
        let file_name = entry_path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        if file_name == "." || file_name == ".." {
            continue;
        }

        let is_dir = stat.is_dir();
        let is_symlink = stat.file_type().is_symlink();
        let size = stat.size.unwrap_or(0);
        let mtime = stat.mtime.unwrap_or(0);
        let modified = chrono::DateTime::from_timestamp(mtime as i64, 0)
            .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
            .unwrap_or_else(|| "-".to_string());

        let mode = stat.perm.unwrap_or(0o644);
        let perms = crate::local_fs::format_posix_permissions(mode, is_dir);

        let ext = Path::new(&file_name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        let child_path = if clean_path == "/" {
            format!("/{}", file_name)
        } else {
            format!("{}/{}", clean_path.trim_end_matches('/'), file_name)
        };

        entries.push(FileEntry {
            name: file_name,
            path: format!("sftp://{}{}", site.id, child_path),
            size,
            is_dir,
            is_symlink,
            is_archive: false,
            modified,
            permissions: perms,
            extension: ext,
        });
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

    Ok(DirectoryListing {
        path: format!("sftp://{}{}", site.id, clean_path),
        display_path: format!("sftp://{}:{}{}", site.host, site.port, clean_path),
        is_virtual: false,
        archive_parent: None,
        volume_name: format!("SFTP [{}]", site.name),
        total_space: 0,
        free_space: 0,
        entries,
        show_hidden: true,
    })
}

pub fn download_sftp_file(site: &SiteConfig, remote_path: &str) -> Result<Vec<u8>, String> {
    let (sess, _) = create_ssh_session(site)?;
    let sftp = sess.sftp().map_err(|e| e.to_string())?;
    let mut file = sftp.open(Path::new(remote_path)).map_err(|e| format!("Failed to open remote file: {}", e))?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).map_err(|e| format!("Failed to read remote file: {}", e))?;
    Ok(buf)
}

pub fn upload_sftp_file(site: &SiteConfig, remote_path: &str, data: &[u8]) -> Result<(), String> {
    let (sess, _) = create_ssh_session(site)?;
    let sftp = sess.sftp().map_err(|e| e.to_string())?;
    let mut file = sftp.create(Path::new(remote_path)).map_err(|e| format!("Failed to create remote file: {}", e))?;
    file.write_all(data).map_err(|e| format!("Failed to write remote file: {}", e))?;
    Ok(())
}

pub fn delete_sftp_file(site: &SiteConfig, remote_path: &str) -> Result<(), String> {
    let (sess, _) = create_ssh_session(site)?;
    let sftp = sess.sftp().map_err(|e| e.to_string())?;
    let path = Path::new(remote_path);
    if let Ok(stat) = sftp.stat(path) {
        if stat.is_dir() {
            sftp.rmdir(path).map_err(|e| e.to_string())?;
        } else {
            sftp.unlink(path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn create_sftp_directory(site: &SiteConfig, remote_path: &str) -> Result<(), String> {
    let (sess, _) = create_ssh_session(site)?;
    let sftp = sess.sftp().map_err(|e| e.to_string())?;
    sftp.mkdir(Path::new(remote_path), 0o755).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_ftp_directory(site: &SiteConfig, remote_path: &str) -> Result<DirectoryListing, String> {
    let addr = format!("{}:{}", site.host, site.port);
    let mut ftp = FtpStream::connect(&addr).map_err(|e| format!("FTP connection error: {}", e))?;
    
    let default_pwd = String::new();
    let pwd = site.password.as_ref().unwrap_or(&default_pwd);
    ftp.login(&site.username, pwd).map_err(|e| format!("FTP login failed: {}", e))?;

    let clean_path = if remote_path.is_empty() { "/" } else { remote_path };
    if clean_path != "/" {
        ftp.cwd(clean_path).map_err(|e| format!("FTP cwd failed: {}", e))?;
    }

    let mut entries: Vec<FileEntry> = Vec::new();

    if clean_path != "/" {
        let parent = Path::new(clean_path).parent().unwrap_or(Path::new("/")).to_string_lossy().to_string();
        let parent_url = format!("ftp://{}{}", site.id, if parent.starts_with('/') { parent } else { format!("/{}", parent) });
        entries.push(FileEntry {
            name: "..".to_string(),
            path: parent_url,
            size: 0,
            is_dir: true,
            is_symlink: false,
            is_archive: false,
            modified: "".to_string(),
            permissions: "drwxr-xr-x".to_string(),
            extension: "".to_string(),
        });
    }

    let lines = ftp.list(None).map_err(|e| format!("FTP list failed: {}", e))?;
    for line in lines {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }

        let is_dir = line.starts_with('d');
        let file_name = parts.last().unwrap_or(&"").to_string();
        if file_name == "." || file_name == ".." {
            continue;
        }

        let size: u64 = if parts.len() >= 5 {
            parts[4].parse().unwrap_or(0)
        } else {
            0
        };

        let child_path = if clean_path == "/" {
            format!("/{}", file_name)
        } else {
            format!("{}/{}", clean_path.trim_end_matches('/'), file_name)
        };

        let ext = Path::new(&file_name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        entries.push(FileEntry {
            name: file_name,
            path: format!("ftp://{}{}", site.id, child_path),
            size,
            is_dir,
            is_symlink: false,
            is_archive: false,
            modified: "-".to_string(),
            permissions: if is_dir { "drwxr-xr-x".to_string() } else { "-rw-r--r--".to_string() },
            extension: ext,
        });
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

    Ok(DirectoryListing {
        path: format!("ftp://{}{}", site.id, clean_path),
        display_path: format!("ftp://{}:{}{}", site.host, site.port, clean_path),
        is_virtual: false,
        archive_parent: None,
        volume_name: format!("FTP [{}]", site.name),
        total_space: 0,
        free_space: 0,
        entries,
        show_hidden: true,
    })
}
