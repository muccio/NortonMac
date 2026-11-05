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
    use std::net::ToSocketAddrs;
    use std::time::Duration;

    let addr_str = format!("{}:{}", site.host, site.port);
    let addrs: Vec<std::net::SocketAddr> = addr_str
        .to_socket_addrs()
        .map_err(|e| format!("Could not resolve SSH server hostname '{}': {}", site.host, e))?
        .collect();

    if addrs.is_empty() {
        return Err(format!("No IP address found for host '{}'", site.host));
    }

    let connect_timeout = Duration::from_secs(8);
    let mut tcp_stream = None;
    let mut last_err = None;

    for addr in addrs {
        match TcpStream::connect_timeout(&addr, connect_timeout) {
            Ok(s) => {
                tcp_stream = Some(s);
                break;
            }
            Err(e) => {
                last_err = Some(e);
            }
        }
    }

    let tcp = tcp_stream.ok_or_else(|| {
        format!(
            "Connection to {}:{} timed out after 8s: {}",
            site.host,
            site.port,
            last_err.map(|e| e.to_string()).unwrap_or_else(|| "Host unreachable".to_string())
        )
    })?;

    tcp.set_read_timeout(Some(Duration::from_secs(15))).ok();
    tcp.set_write_timeout(Some(Duration::from_secs(15))).ok();

    let mut sess = ssh2::Session::new().map_err(|e| e.to_string())?;
    sess.set_tcp_stream(tcp);
    sess.handshake().map_err(|e| format!("SSH handshake failed on {}:{}: {}", site.host, site.port, e))?;

    if let Some(key_path) = &site.private_key_path {
        if !key_path.is_empty() {
            let p = Path::new(key_path);
            if !p.exists() {
                return Err(format!("Private key file '{}' does not exist", key_path));
            }
            sess.userauth_pubkey_file(&site.username, None, p, site.password.as_deref())
                .map_err(|e| format!("Public key authentication failed with key '{}': {}", key_path, e))?;
            return Ok((sess, unsafe { std::mem::zeroed() }));
        }
    }

    if let Some(pwd) = &site.password {
        sess.userauth_password(&site.username, pwd)
            .map_err(|e| format!("Password authentication failed for user '{}': {}", site.username, e))?;
    } else {
        sess.userauth_agent(&site.username)
            .map_err(|e| format!("SSH agent authentication failed for user '{}': {}", site.username, e))?;
    }

    if !sess.authenticated() {
        return Err(format!("SSH authentication failed for user '{}'", site.username));
    }

    Ok((sess, unsafe { std::mem::zeroed() }))
}

pub fn test_sftp_connection(site: &SiteConfig) -> Result<(), String> {
    let (sess, _) = create_ssh_session(site)?;
    let sftp = sess.sftp().map_err(|e| format!("SFTP subsystem initialization failed: {}", e))?;
    let _ = sftp.readdir(Path::new("/")).ok();
    Ok(())
}

pub fn create_ftp_session(site: &SiteConfig) -> Result<FtpStream, String> {
    use std::net::ToSocketAddrs;
    use std::time::Duration;

    let addr_str = format!("{}:{}", site.host, site.port);
    let addrs: Vec<std::net::SocketAddr> = addr_str
        .to_socket_addrs()
        .map_err(|e| format!("Could not resolve FTP server hostname '{}': {}", site.host, e))?
        .collect();

    if addrs.is_empty() {
        return Err(format!("No IP address found for host '{}'", site.host));
    }

    let connect_timeout = Duration::from_secs(8);
    let mut tcp_stream = None;
    let mut last_err = None;

    for addr in addrs {
        match TcpStream::connect_timeout(&addr, connect_timeout) {
            Ok(s) => {
                tcp_stream = Some(s);
                break;
            }
            Err(e) => {
                last_err = Some(e);
            }
        }
    }

    let stream = tcp_stream.ok_or_else(|| {
        format!(
            "Connection to {}:{} timed out after 8s: {}",
            site.host,
            site.port,
            last_err.map(|e| e.to_string()).unwrap_or_else(|| "Host unreachable or port closed".to_string())
        )
    })?;

    stream.set_read_timeout(Some(Duration::from_secs(12))).ok();
    stream.set_write_timeout(Some(Duration::from_secs(12))).ok();

    let mut ftp = FtpStream::connect_with_stream(stream)
        .map_err(|e| format!("FTP handshake failed on {}:{}: {}", site.host, site.port, e))?;

    // Fix for servers behind NAT: replaces internal private IP in PASV with real server IP
    ftp.set_passive_nat_workaround(true);
    let passive_stream = ftp.passive_stream_builder(|addr| {
        TcpStream::connect_timeout(&addr, Duration::from_secs(8))
            .map_err(suppaftp::FtpError::ConnectionError)
    });
    let mut ftp = passive_stream;

    let default_pwd = String::new();
    let pwd = site.password.as_deref().unwrap_or(&default_pwd);
    ftp.login(site.username.as_str(), pwd)
        .map_err(|e| format!("FTP authentication failed for user '{}' on {}: {}", site.username, site.host, e))?;

    Ok(ftp)
}

pub fn test_ftp_connection(site: &SiteConfig) -> Result<(), String> {
    let mut ftp = create_ftp_session(site)?;
    let _ = ftp.pwd().map_err(|e| format!("FTP PWD test command failed: {}", e))?;
    Ok(())
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
    let mut ftp = create_ftp_session(site)?;

    let clean_path = if remote_path.is_empty() { "/" } else { remote_path };

    if clean_path != "/" && !clean_path.is_empty() && clean_path != "." {
        if let Err(e1) = ftp.cwd(clean_path) {
            let alt_path = clean_path.trim_start_matches('/');
            if let Err(e2) = ftp.cwd(alt_path) {
                return Err(format!("FTP cwd to '{}' failed: {} ({})", clean_path, e1, e2));
            }
        }
    }

    let mut entries: Vec<FileEntry> = Vec::new();

    if clean_path != "/" && !clean_path.is_empty() {
        let parent = Path::new(clean_path)
            .parent()
            .unwrap_or(Path::new("/"))
            .to_string_lossy()
            .to_string();
        let parent_url = format!(
            "ftp://{}{}",
            site.id,
            if parent.starts_with('/') {
                parent
            } else {
                format!("/{}", parent)
            }
        );
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

    let lines = ftp
        .list(None)
        .map_err(|e| format!("FTP directory listing failed for '{}': {}", clean_path, e))?;

    for line in lines {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.to_lowercase().starts_with("total ") {
            continue;
        }

        // Try standard suppaftp parser first
        if let Ok(file) = suppaftp::list::File::try_from(trimmed) {
            let file_name = file.name().to_string();
            if file_name == "." || file_name == ".." || file_name.is_empty() {
                continue;
            }

            let is_dir = file.is_directory();
            let is_symlink = file.is_symlink();
            let size = file.size() as u64;

            let mod_time = {
                let dt: chrono::DateTime<chrono::Utc> = file.modified().into();
                dt.format("%Y-%m-%d %H:%M").to_string()
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

            let is_arch = ext == "zip" || ext == "tar" || ext == "gz" || ext == "tgz" || ext == "bz2";

            entries.push(FileEntry {
                name: file_name,
                path: format!("ftp://{}{}", site.id, child_path),
                size,
                is_dir,
                is_symlink,
                is_archive: is_arch,
                modified: mod_time,
                permissions: if is_dir {
                    "drwxr-xr-x".to_string()
                } else {
                    "-rw-r--r--".to_string()
                },
                extension: ext,
            });
            continue;
        }

        // Fallback parser if suppaftp::list::File fails
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }

        let is_dir = trimmed.starts_with('d') || trimmed.contains("<DIR>");
        let file_name = if parts.len() >= 9
            && (trimmed.starts_with('-') || trimmed.starts_with('d') || trimmed.starts_with('l'))
        {
            parts[8..].join(" ")
        } else if parts.len() >= 4 && trimmed.contains("<DIR>") {
            parts[3..].join(" ")
        } else {
            parts.last().unwrap_or(&"").to_string()
        };

        if file_name == "." || file_name == ".." || file_name.is_empty() {
            continue;
        }

        let size: u64 = if parts.len() >= 5 && !trimmed.contains("<DIR>") {
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

        let is_arch = ext == "zip" || ext == "tar" || ext == "gz" || ext == "tgz" || ext == "bz2";

        entries.push(FileEntry {
            name: file_name,
            path: format!("ftp://{}{}", site.id, child_path),
            size,
            is_dir,
            is_symlink: trimmed.starts_with('l'),
            is_archive: is_arch,
            modified: "-".to_string(),
            permissions: if is_dir {
                "drwxr-xr-x".to_string()
            } else {
                "-rw-r--r--".to_string()
            },
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

pub fn download_ftp_file(site: &SiteConfig, remote_path: &str) -> Result<Vec<u8>, String> {
    let mut ftp = create_ftp_session(site)?;
    let clean_path = remote_path.trim_start_matches('/');
    let cursor = ftp
        .retr_as_buffer(clean_path)
        .or_else(|_| ftp.retr_as_buffer(remote_path))
        .map_err(|e| format!("Failed to download FTP file '{}': {}", remote_path, e))?;
    Ok(cursor.into_inner())
}

pub fn upload_ftp_file(site: &SiteConfig, remote_path: &str, data: &[u8]) -> Result<(), String> {
    let mut ftp = create_ftp_session(site)?;
    let clean_path = remote_path.trim_start_matches('/');
    let mut cursor = std::io::Cursor::new(data);
    ftp.put_file(clean_path, &mut cursor)
        .or_else(|_| {
            let mut c2 = std::io::Cursor::new(data);
            ftp.put_file(remote_path, &mut c2)
        })
        .map_err(|e| format!("Failed to upload FTP file '{}': {}", remote_path, e))?;
    Ok(())
}

pub fn delete_ftp_file(site: &SiteConfig, remote_path: &str) -> Result<(), String> {
    let mut ftp = create_ftp_session(site)?;
    let clean_path = remote_path.trim_start_matches('/');
    if let Err(e1) = ftp.rm(clean_path) {
        if let Err(e2) = ftp.rmdir(clean_path) {
            return Err(format!("Failed to delete FTP file/directory '{}': {} ({})", remote_path, e1, e2));
        }
    }
    Ok(())
}

pub fn create_ftp_directory(site: &SiteConfig, remote_path: &str) -> Result<(), String> {
    let mut ftp = create_ftp_session(site)?;
    let clean_path = remote_path.trim_start_matches('/');
    ftp.mkdir(clean_path)
        .or_else(|_| ftp.mkdir(remote_path))
        .map_err(|e| format!("Failed to create FTP directory '{}': {}", remote_path, e))?;
    Ok(())
}
