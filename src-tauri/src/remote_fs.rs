use crate::local_fs::make_unique_duplicate_name;
use crate::models::{DirectoryListing, FileEntry, SiteConfig};
use std::collections::{HashMap, HashSet};
use std::io::{Cursor, Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;
use suppaftp::list::ListParser;
use suppaftp::native_tls::TlsConnector;
use suppaftp::types::FileType;
use suppaftp::{NativeTlsConnector, NativeTlsFtpStream};

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
        if site.protocol == "ftp" || site.protocol == "ftps" {
            self.sftp_sessions.lock().unwrap().remove(&key);
            let mut map = self.ftp_sessions.lock().unwrap();
            map.insert(key.clone(), site);
        } else {
            self.ftp_sessions.lock().unwrap().remove(&key);
            let mut map = self.sftp_sessions.lock().unwrap();
            map.insert(key.clone(), site);
        }
        key
    }

    pub fn get_site(&self, key: &str) -> Option<SiteConfig> {
        if let Some(s) = self.ftp_sessions.lock().unwrap().get(key).cloned() {
            return Some(s);
        }
        self.sftp_sessions.lock().unwrap().get(key).cloned()
    }
}

pub fn parse_remote_url(url: &str) -> Option<(String, String, String)> {
    // Returns (protocol, site_id, path)
    for proto in ["sftp", "ftps", "ftp"] {
        let prefix = format!("{}://", proto);
        if let Some(rest) = url.strip_prefix(&prefix) {
            let parts: Vec<&str> = rest.splitn(2, '/').collect();
            let site_id = parts[0].to_string();
            let path = if parts.len() > 1 && !parts[1].is_empty() {
                format!("/{}", parts[1])
            } else {
                "/".to_string()
            };
            return Some((proto.to_string(), site_id, path));
        }
    }
    None
}

/// Clean and validate host string (strip accidental scheme prefixes or slashes, reject `@`)
pub fn sanitize_host(raw_host: &str) -> Result<String, String> {
    let mut h = raw_host.trim();
    for prefix in ["sftp://", "ftps://", "ftp://", "ssh://"] {
        if let Some(stripped) = h.strip_prefix(prefix) {
            h = stripped;
        }
    }
    if let Some((before_slash, _)) = h.split_once('/') {
        h = before_slash;
    }
    h = h.trim();

    if h.is_empty() {
        return Err("Il campo Host / IP è vuoto.".to_string());
    }

    if h.contains('@') {
        let suggested = h.rsplit('@').next().unwrap_or("esempio.it");
        return Err(format!(
            "Host non valido '{}': contiene '@'. Nel campo Host/IP inserisci solo il dominio del server (es. 'ftp.{}' o '{}').",
            raw_host, suggested, suggested
        ));
    }

    // Strip accidental :port in host if user wrote host:21
    if let Some((host_only, port_part)) = h.rsplit_once(':') {
        if !host_only.contains(':') && port_part.chars().all(|c| c.is_ascii_digit()) {
            h = host_only;
        }
    }

    Ok(h.to_string())
}

fn connect_tcp_with_timeout(raw_host: &str, port: u16, timeout_secs: u64) -> Result<(TcpStream, String), String> {
    let host = sanitize_host(raw_host)?;
    let addr_str = format!("{}:{}", host, port);
    let addrs: Vec<SocketAddr> = addr_str
        .to_socket_addrs()
        .map_err(|e| format!("Impossibile risolvere l'host '{}': {}", host, e))?
        .collect();

    if addrs.is_empty() {
        return Err(format!("Nessun indirizzo IP trovato per l'host '{}'", host));
    }

    let connect_timeout = Duration::from_secs(timeout_secs);
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
            "Connessione a {}:{} fallita (timeout {}s): {}",
            host,
            port,
            timeout_secs,
            last_err
                .map(|e| e.to_string())
                .unwrap_or_else(|| "Host irraggiungibile o porta chiusa".to_string())
        )
    })?;

    stream.set_read_timeout(Some(Duration::from_secs(12))).ok();
    stream.set_write_timeout(Some(Duration::from_secs(12))).ok();

    Ok((stream, host))
}

/// Peek at the initial greeting banner without consuming bytes from the TCP buffer.
fn peek_server_banner(stream: &TcpStream) -> Option<String> {
    stream.set_read_timeout(Some(Duration::from_secs(3))).ok();
    let mut buf = [0u8; 32];
    let res = match stream.peek(&mut buf) {
        Ok(n) if n > 0 => Some(String::from_utf8_lossy(&buf[..n]).to_string()),
        _ => None,
    };
    stream.set_read_timeout(Some(Duration::from_secs(12))).ok();
    res
}

fn build_tls_connector() -> Result<NativeTlsConnector, String> {
    let tls = TlsConnector::builder()
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .build()
        .map_err(|e| format!("Errore inizializzazione TLS: {}", e))?;
    Ok(NativeTlsConnector::from(tls))
}

fn configure_ftp_passive(ftp: NativeTlsFtpStream) -> NativeTlsFtpStream {
    let mut ftp = ftp;
    // Essential for servers behind NAT: use real peer IP instead of private IP in PASV
    ftp.set_passive_nat_workaround(true);
    ftp.passive_stream_builder(|addr| {
        let s = TcpStream::connect_timeout(&addr, Duration::from_secs(8))
            .map_err(suppaftp::FtpError::ConnectionError)?;
        s.set_read_timeout(Some(Duration::from_secs(15))).ok();
        s.set_write_timeout(Some(Duration::from_secs(15))).ok();
        Ok(s)
    })
}

fn create_ssh_session_on_stream(site: &SiteConfig, tcp: TcpStream, host: &str) -> Result<ssh2::Session, String> {
    let mut sess = ssh2::Session::new().map_err(|e| e.to_string())?;
    // CRITICAL: libssh2 defaults to timeout=0 (infinite). Always set a bounded timeout in ms!
    sess.set_timeout(10_000);
    sess.set_tcp_stream(tcp);
    sess.handshake()
        .map_err(|e| format!("Handshake SSH fallito su {}:{}: {}", host, site.port, e))?;

    if let Some(key_path) = &site.private_key_path {
        if !key_path.trim().is_empty() {
            let p = Path::new(key_path.trim());
            if !p.exists() {
                return Err(format!("File chiave privata '{}' non trovato", key_path));
            }
            sess.userauth_pubkey_file(&site.username, None, p, site.password.as_deref())
                .map_err(|e| format!("Autenticazione con chiave pubblica fallita ('{}'): {}", key_path, e))?;
            return Ok(sess);
        }
    }

    if let Some(pwd) = &site.password {
        if !pwd.is_empty() {
            sess.userauth_password(&site.username, pwd)
                .map_err(|e| format!("Autenticazione SFTP fallita per '{}': {}", site.username, e))?;
        } else {
            sess.userauth_agent(&site.username)
                .or_else(|_| sess.userauth_password(&site.username, ""))
                .map_err(|e| format!("Autenticazione SFTP (nessuna password/agent) fallita per '{}': {}", site.username, e))?;
        }
    } else {
        sess.userauth_agent(&site.username)
            .map_err(|e| format!("Autenticazione SSH Agent fallita per '{}': {}", site.username, e))?;
    }

    if !sess.authenticated() {
        return Err(format!("Autenticazione SSH rifiutata per l'utente '{}'", site.username));
    }

    Ok(sess)
}

pub fn create_ssh_session(site: &SiteConfig) -> Result<ssh2::Session, String> {
    let (tcp, host) = connect_tcp_with_timeout(&site.host, site.port, 8)?;

    if let Some(banner) = peek_server_banner(&tcp) {
        if banner.starts_with("220") {
            return Err(format!(
                "Il server {}:{} ha risposto come server FTP ('{}'), ma il profilo è impostato su SFTP. Imposta il protocollo su FTP.",
                host,
                site.port,
                banner.lines().next().unwrap_or("220 FTP").trim()
            ));
        }
    }

    create_ssh_session_on_stream(site, tcp, &host)
}

fn is_tls_required_error(err_msg: &str) -> bool {
    let lower = err_msg.to_lowercase();
    lower.contains("tls")
        || lower.contains("ssl")
        || lower.contains("cleartext")
        || lower.contains("encryption")
        || lower.contains("534")
        || lower.contains("421")
        || lower.contains("secure")
}

#[allow(deprecated)]
fn create_ftp_session_inner(
    site: &SiteConfig,
    existing_stream: Option<(TcpStream, String)>,
) -> Result<(NativeTlsFtpStream, bool), String> {
    // Returns (ftp_stream, upgraded_to_ftps)
    let host = sanitize_host(&site.host)?;
    let default_pwd = String::new();
    let pwd = site.password.as_deref().unwrap_or(&default_pwd);

    let want_ftps = site.protocol == "ftps" || site.port == 990;

    // Implicit FTPS on port 990
    if site.port == 990 {
        drop(existing_stream);
        let (_, resolved_host) = connect_tcp_with_timeout(&host, site.port, 8)?;
        let tls_ctx = build_tls_connector()?;
        let addr_str = format!("{}:{}", resolved_host, site.port);
        let ftp = NativeTlsFtpStream::connect_secure_implicit(&addr_str, tls_ctx, &resolved_host)
            .map_err(|e| format!("Connessione FTPS Implicita (porta 990) fallita su {}: {}", resolved_host, e))?;
        let mut ftp = configure_ftp_passive(ftp);
        ftp.login(site.username.as_str(), pwd)
            .map_err(|e| format!("Login FTPS fallito per '{}' su {}: {}", site.username, resolved_host, e))?;
        let _ = ftp.transfer_type(FileType::Binary);
        return Ok((ftp, true));
    }

    let (stream, resolved_host) = match existing_stream {
        Some(pair) => pair,
        None => connect_tcp_with_timeout(&host, site.port, 8)?,
    };

    // Explicit FTPS requested explicitly
    if want_ftps {
        let ftp = NativeTlsFtpStream::connect_with_stream(stream)
            .map_err(|e| format!("Handshake FTP fallito su {}:{}: {}", resolved_host, site.port, e))?;
        let ftp = configure_ftp_passive(ftp);
        let tls_ctx = build_tls_connector()?;
        let mut ftp = ftp
            .into_secure(tls_ctx, &resolved_host)
            .map_err(|e| format!("Upgrade AUTH TLS (FTPS) fallito su {}: {}", resolved_host, e))?;
        ftp.login(site.username.as_str(), pwd)
            .map_err(|e| format!("Login FTPS fallito per '{}' su {}: {}", site.username, resolved_host, e))?;
        let _ = ftp.transfer_type(FileType::Binary);
        return Ok((ftp, true));
    }

    // Standard FTP (with automatic fallback to Explicit FTPS if server rejects cleartext!)
    if let Some(banner) = peek_server_banner(&stream) {
        if banner.starts_with("SSH-") {
            return Err(format!(
                "Il server {}:{} è un server SSH/SFTP ('{}'), non FTP. Imposta il protocollo su SFTP.",
                resolved_host,
                site.port,
                banner.lines().next().unwrap_or("SSH-2.0").trim()
            ));
        }
    }

    let ftp = NativeTlsFtpStream::connect_with_stream(stream)
        .map_err(|e| format!("Handshake FTP fallito su {}:{}: {}", resolved_host, site.port, e))?;
    let mut ftp = configure_ftp_passive(ftp);

    match ftp.login(site.username.as_str(), pwd) {
        Ok(()) => {
            let _ = ftp.transfer_type(FileType::Binary);
            Ok((ftp, false))
        }
        Err(plain_err) => {
            let err_str = plain_err.to_string();
            let _ = ftp.quit();
            if is_tls_required_error(&err_str) {
                // Server requires Explicit TLS (AUTH TLS) — automatically reconnect with FTPS!
                let (tls_stream, _) = connect_tcp_with_timeout(&host, site.port, 8)?;
                let ftp_tls = NativeTlsFtpStream::connect_with_stream(tls_stream)
                    .map_err(|e| format!("Riconnessione FTPS fallita: {}", e))?;
                let ftp_tls = configure_ftp_passive(ftp_tls);
                let tls_ctx = build_tls_connector()?;
                let mut ftp_tls = ftp_tls
                    .into_secure(tls_ctx, &resolved_host)
                    .map_err(|e| format!("Il server richiede TLS ma AUTH TLS è fallito: {}", e))?;
                ftp_tls
                    .login(site.username.as_str(), pwd)
                    .map_err(|e| format!("Autenticazione FTPS fallita per '{}' su {}: {}", site.username, resolved_host, e))?;
                let _ = ftp_tls.transfer_type(FileType::Binary);
                Ok((ftp_tls, true))
            } else {
                Err(format!(
                    "Autenticazione FTP fallita per '{}' su {}: {}",
                    site.username, resolved_host, err_str
                ))
            }
        }
    }
}

pub fn create_ftp_session(site: &SiteConfig) -> Result<NativeTlsFtpStream, String> {
    create_ftp_session_inner(site, None).map(|(ftp, _)| ftp)
}

/// Smart connection verifier used by `connect_site`.
/// Also auto-heals protocol mismatches (e.g., if user configured port 21 FTP server with protocol "sftp")
/// and reuses the single TCP connection without dropping/reconnecting!
pub fn verify_and_prepare_site(site: &mut SiteConfig, mutated: &mut bool) -> Result<(), String> {
    let clean_host = sanitize_host(&site.host)?;
    if clean_host != site.host {
        site.host = clean_host;
        *mutated = true;
    }

    if site.port == 990 {
        if site.protocol != "ftps" {
            site.protocol = "ftps".to_string();
            *mutated = true;
        }
        let (mut ftp, _) = create_ftp_session_inner(site, None)?;
        let _ = ftp.pwd().map_err(|e| format!("Comando FTPS PWD fallito: {}", e))?;
        let _ = ftp.quit();
        return Ok(());
    }

    // Open a single TCP stream and peek at the greeting banner without consuming bytes (MSG_PEEK)
    let (probe_stream, resolved_host) = connect_tcp_with_timeout(&site.host, site.port, 8)?;
    if let Some(banner) = peek_server_banner(&probe_stream) {
        if site.protocol == "sftp" && banner.starts_with("220") {
            // Auto-heal: server on this port is actually FTP!
            site.protocol = "ftp".to_string();
            *mutated = true;
        } else if (site.protocol == "ftp" || site.protocol == "ftps") && banner.starts_with("SSH-") {
            // Auto-heal: server on this port is actually SSH/SFTP!
            site.protocol = "sftp".to_string();
            *mutated = true;
        }
    }

    if site.protocol == "ftp" || site.protocol == "ftps" {
        let (mut ftp, upgraded_to_ftps) =
            create_ftp_session_inner(site, Some((probe_stream, resolved_host)))?;
        if upgraded_to_ftps && site.protocol != "ftps" {
            site.protocol = "ftps".to_string();
            *mutated = true;
        }
        let _ = ftp.pwd().map_err(|e| format!("Comando FTP PWD fallito: {}", e))?;
        let _ = ftp.quit();
    } else {
        let sess = create_ssh_session_on_stream(site, probe_stream, &resolved_host)?;
        let sftp = sess
            .sftp()
            .map_err(|e| format!("Inizializzazione sottosistema SFTP fallita: {}", e))?;
        let _ = sftp.readdir(Path::new("/")).ok();
    }

    Ok(())
}

pub fn list_sftp_directory(
    site: &SiteConfig,
    remote_path: &str,
    show_hidden: bool,
) -> Result<DirectoryListing, String> {
    let sess = create_ssh_session(site)?;
    let sftp = sess
        .sftp()
        .map_err(|e| format!("Inizializzazione SFTP fallita: {}", e))?;

    let clean_path = if remote_path.is_empty() { "/" } else { remote_path };
    let path_obj = Path::new(clean_path);

    let mut entries: Vec<FileEntry> = Vec::new();

    if clean_path != "/" {
        let parent = path_obj
            .parent()
            .unwrap_or(Path::new("/"))
            .to_string_lossy()
            .to_string();
        let parent_url = format!(
            "sftp://{}{}",
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

    let dir = sftp
        .readdir(path_obj)
        .map_err(|e| format!("Impossibile leggere la cartella SFTP '{}': {}", clean_path, e))?;

    for (entry_path, stat) in dir {
        let file_name = entry_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        if file_name.is_empty() || file_name == "." || file_name == ".." {
            continue;
        }
        if !show_hidden && file_name.starts_with('.') {
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
        show_hidden,
    })
}

pub fn download_sftp_file(site: &SiteConfig, remote_path: &str) -> Result<Vec<u8>, String> {
    let sess = create_ssh_session(site)?;
    let sftp = sess.sftp().map_err(|e| e.to_string())?;
    let mut file = sftp
        .open(Path::new(remote_path))
        .map_err(|e| format!("Impossibile aprire file remoto '{}': {}", remote_path, e))?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf)
        .map_err(|e| format!("Errore lettura file remoto '{}': {}", remote_path, e))?;
    Ok(buf)
}

pub fn upload_sftp_file(site: &SiteConfig, remote_path: &str, data: &[u8]) -> Result<(), String> {
    let sess = create_ssh_session(site)?;
    let sftp = sess.sftp().map_err(|e| e.to_string())?;
    let mut file = sftp
        .create(Path::new(remote_path))
        .map_err(|e| format!("Impossibile creare file remoto '{}': {}", remote_path, e))?;
    file.write_all(data)
        .map_err(|e| format!("Errore scrittura file remoto '{}': {}", remote_path, e))?;
    Ok(())
}

pub fn delete_sftp_file(site: &SiteConfig, remote_path: &str) -> Result<(), String> {
    let sess = create_ssh_session(site)?;
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
    let sess = create_ssh_session(site)?;
    let sftp = sess.sftp().map_err(|e| e.to_string())?;
    sftp.mkdir(Path::new(remote_path), 0o755)
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_ftp_directory(
    site: &SiteConfig,
    remote_path: &str,
    show_hidden: bool,
) -> Result<DirectoryListing, String> {
    let mut ftp = create_ftp_session(site)?;
    let scheme = if site.protocol == "ftps" { "ftps" } else { "ftp" };

    let clean_path = if remote_path.is_empty() { "/" } else { remote_path };

    if clean_path != "/" && !clean_path.is_empty() && clean_path != "." {
        if let Err(e1) = ftp.cwd(clean_path) {
            let alt_path = clean_path.trim_start_matches('/');
            if let Err(e2) = ftp.cwd(alt_path) {
                let _ = ftp.quit();
                return Err(format!("Impossibile accedere alla cartella FTP '{}': {} ({})", clean_path, e1, e2));
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
            "{}://{}{}",
            scheme,
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

    // Prefer RFC 3659 MLSD (supported by Pure-FTPd, ProFTPD, FileZilla Server) for exact metadata;
    // cleanly fallback to LIST -a / LIST if MLSD is unsupported.
    let (lines, used_mlsd) = match ftp.mlsd(None) {
        Ok(mlsd_lines) => (mlsd_lines, true),
        Err(_) => {
            let list_res = if show_hidden {
                ftp.list(Some("-a")).or_else(|_| ftp.list(None))
            } else {
                ftp.list(None)
            };
            let l = list_res.map_err(|e| {
                let _ = ftp.quit();
                format!("Lettura lista file FTP fallita in '{}': {}", clean_path, e)
            })?;
            (l, false)
        }
    };

    let _ = ftp.quit();

    for raw_line in lines {
        let line = raw_line.trim_end_matches(&['\r', '\n'][..]);
        if line.trim().is_empty() || line.trim().to_lowercase().starts_with("total ") {
            continue;
        }

        let parsed_file = if used_mlsd {
            ListParser::parse_mlsd(line)
        } else {
            suppaftp::list::File::try_from(line.trim())
        };

        if let Ok(file) = parsed_file {
            let file_name = file.name().to_string();
            if file_name == "." || file_name == ".." || file_name.is_empty() {
                continue;
            }
            if !show_hidden && file_name.starts_with('.') {
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

            entries.push(FileEntry {
                name: file_name,
                path: format!("{}://{}{}", scheme, site.id, child_path),
                size,
                is_dir,
                is_symlink,
                is_archive: false,
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

        // Fallback parser for non-standard MLSD facts (e.g., Pure-FTPd `type=OS.unix=slink:...`) or custom LIST lines
        if used_mlsd {
            if let Some(sep_idx) = line.find("; ") {
                let facts = &line[..sep_idx];
                let file_name = line[sep_idx + 2..].to_string();
                if file_name == "." || file_name == ".." || file_name.is_empty() {
                    continue;
                }
                if !show_hidden && file_name.starts_with('.') {
                    continue;
                }
                let facts_lower = facts.to_lowercase();
                if facts_lower.contains("type=cdir") || facts_lower.contains("type=pdir") {
                    continue;
                }
                let is_dir = facts_lower.contains("type=dir");
                let is_symlink = facts_lower.contains("slink") || facts_lower.contains("symlink");
                let size = facts
                    .split(';')
                    .find_map(|kv| {
                        let (k, v) = kv.split_once('=')?;
                        if k.eq_ignore_ascii_case("size") {
                            v.parse::<u64>().ok()
                        } else {
                            None
                        }
                    })
                    .unwrap_or(0);

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
                    path: format!("{}://{}{}", scheme, site.id, child_path),
                    size,
                    is_dir,
                    is_symlink,
                    is_archive: false,
                    modified: "-".to_string(),
                    permissions: if is_dir {
                        "drwxr-xr-x".to_string()
                    } else if is_symlink {
                        "lrwxrwxrwx".to_string()
                    } else {
                        "-rw-r--r--".to_string()
                    },
                    extension: ext,
                });
            }
            continue;
        }

        let trimmed = line.trim();
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }

        let is_dir = trimmed.starts_with('d') || trimmed.contains("<DIR>");
        let mut file_name = if parts.len() >= 9
            && (trimmed.starts_with('-') || trimmed.starts_with('d') || trimmed.starts_with('l'))
        {
            parts[8..].join(" ")
        } else if parts.len() >= 4 && trimmed.contains("<DIR>") {
            parts[3..].join(" ")
        } else {
            parts.last().unwrap_or(&"").to_string()
        };

        // Strip ` -> target` on symlinks
        if trimmed.starts_with('l') {
            if let Some((link_name, _)) = file_name.split_once(" -> ") {
                file_name = link_name.to_string();
            }
        }

        if file_name == "." || file_name == ".." || file_name.is_empty() {
            continue;
        }
        if !show_hidden && file_name.starts_with('.') {
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

        entries.push(FileEntry {
            name: file_name,
            path: format!("{}://{}{}", scheme, site.id, child_path),
            size,
            is_dir,
            is_symlink: trimmed.starts_with('l'),
            is_archive: false,
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
        path: format!("{}://{}{}", scheme, site.id, clean_path),
        display_path: format!("{}://{}:{}{}", scheme, site.host, site.port, clean_path),
        is_virtual: false,
        archive_parent: None,
        volume_name: format!("{} [{}]", scheme.to_uppercase(), site.name),
        total_space: 0,
        free_space: 0,
        entries,
        show_hidden,
    })
}

fn ftp_cwd_to_parent<'a>(ftp: &mut NativeTlsFtpStream, remote_path: &'a str) -> Result<&'a str, String> {
    let p = Path::new(remote_path);
    let file_name = p
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("Percorso remoto non valido: '{}'", remote_path))?;
    if let Some(parent) = p.parent() {
        let parent_str = parent.to_string_lossy();
        if !parent_str.is_empty() && parent_str != "/" {
            ftp.cwd(parent_str.as_ref())
                .or_else(|_| ftp.cwd(parent_str.trim_start_matches('/')))
                .map_err(|e| format!("Impossibile accedere alla directory '{}': {}", parent_str, e))?;
        }
    }
    Ok(file_name)
}

pub fn download_ftp_file(site: &SiteConfig, remote_path: &str) -> Result<Vec<u8>, String> {
    let mut ftp = create_ftp_session(site)?;
    let file_name = ftp_cwd_to_parent(&mut ftp, remote_path)?;
    let cursor = ftp
        .retr_as_buffer(file_name)
        .map_err(|e| format!("Download FTP fallito per '{}': {}", remote_path, e))?;
    let _ = ftp.quit();
    Ok(cursor.into_inner())
}

pub fn upload_ftp_file(site: &SiteConfig, remote_path: &str, data: &[u8]) -> Result<(), String> {
    let mut ftp = create_ftp_session(site)?;
    let file_name = ftp_cwd_to_parent(&mut ftp, remote_path)?;
    let mut cursor = Cursor::new(data);
    ftp.put_file(file_name, &mut cursor)
        .map_err(|e| format!("Upload FTP fallito per '{}': {}", remote_path, e))?;
    let _ = ftp.quit();
    Ok(())
}

pub fn delete_ftp_file(site: &SiteConfig, remote_path: &str) -> Result<(), String> {
    let mut ftp = create_ftp_session(site)?;
    let clean_path = remote_path.trim_start_matches('/');
    if let Err(e1) = ftp.rm(remote_path).or_else(|_| ftp.rm(clean_path)) {
        if let Err(e2) = ftp.rmdir(remote_path).or_else(|_| ftp.rmdir(clean_path)) {
            let _ = ftp.quit();
            return Err(format!("Eliminazione FTP fallita per '{}': {} ({})", remote_path, e1, e2));
        }
    }
    let _ = ftp.quit();
    Ok(())
}

pub fn create_ftp_directory(site: &SiteConfig, remote_path: &str) -> Result<(), String> {
    let mut ftp = create_ftp_session(site)?;
    let clean_path = remote_path.trim_start_matches('/');
    ftp.mkdir(remote_path)
        .or_else(|_| ftp.mkdir(clean_path))
        .map_err(|e| format!("Creazione cartella FTP fallita '{}': {}", remote_path, e))?;
    let _ = ftp.quit();
    Ok(())
}

pub fn calculate_sftp_item_size(site: &SiteConfig, remote_path: &str) -> Result<u64, String> {
    let sess = create_ssh_session(site)?;
    let sftp = sess.sftp().map_err(|e| e.to_string())?;
    fn walk_sftp(sftp: &ssh2::Sftp, path: &Path, depth: usize) -> u64 {
        if depth > 8 {
            return 0;
        }
        if let Ok(stat) = sftp.lstat(path) {
            if stat.file_type().is_symlink() {
                return stat.size.unwrap_or(0);
            }
            if !stat.is_dir() {
                return stat.size.unwrap_or(0);
            }
        }
        let mut sum = 0u64;
        if let Ok(entries) = sftp.readdir(path) {
            for (child_path, stat) in entries {
                let fname = child_path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if fname == "." || fname == ".." || fname.is_empty() {
                    continue;
                }
                if stat.file_type().is_symlink() {
                    sum += stat.size.unwrap_or(0);
                } else if stat.is_dir() {
                    sum += walk_sftp(sftp, &child_path, depth + 1);
                } else {
                    sum += stat.size.unwrap_or(0);
                }
            }
        }
        sum
    }
    Ok(walk_sftp(&sftp, Path::new(remote_path), 0))
}

pub fn calculate_ftp_item_size(site: &SiteConfig, remote_path: &str) -> Result<u64, String> {
    let mut ftp = create_ftp_session(site)?;

    fn walk_ftp(ftp: &mut NativeTlsFtpStream, dir_path: &str, depth: usize) -> u64 {
        if depth > 5 {
            return 0;
        }
        if ftp
            .cwd(dir_path)
            .or_else(|_| ftp.cwd(dir_path.trim_start_matches('/')))
            .is_err()
        {
            return ftp.size(dir_path).unwrap_or(0) as u64;
        }

        let mut total = 0u64;
        let mut subdirs = Vec::new();

        if let Ok(mlsd_lines) = ftp.mlsd(None) {
            for raw in mlsd_lines {
                let line = raw.trim_end_matches(&['\r', '\n'][..]);
                if let Ok(f) = ListParser::parse_mlsd(line) {
                    let name = f.name().to_string();
                    if name == "." || name == ".." || name.is_empty() {
                        continue;
                    }
                    if f.is_directory() {
                        let sub = if dir_path == "/" {
                            format!("/{}", name)
                        } else {
                            format!("{}/{}", dir_path.trim_end_matches('/'), name)
                        };
                        subdirs.push(sub);
                    } else if !f.is_symlink() {
                        total += f.size() as u64;
                    }
                } else if let Some(sep_idx) = line.find("; ") {
                    let facts = &line[..sep_idx].to_lowercase();
                    let name = &line[sep_idx + 2..];
                    if name == "." || name == ".." || name.is_empty() || facts.contains("type=cdir") || facts.contains("type=pdir") {
                        continue;
                    }
                    if facts.contains("type=dir") {
                        let sub = if dir_path == "/" {
                            format!("/{}", name)
                        } else {
                            format!("{}/{}", dir_path.trim_end_matches('/'), name)
                        };
                        subdirs.push(sub);
                    } else if !facts.contains("slink") {
                        let sz = line[..sep_idx]
                            .split(';')
                            .find_map(|kv| {
                                let (k, v) = kv.split_once('=')?;
                                if k.eq_ignore_ascii_case("size") {
                                    v.parse::<u64>().ok()
                                } else {
                                    None
                                }
                            })
                            .unwrap_or(0);
                        total += sz;
                    }
                }
            }
        } else if let Ok(list_lines) = ftp.list(None) {
            for raw in list_lines {
                let line = raw.trim();
                if let Ok(f) = suppaftp::list::File::try_from(line) {
                    let name = f.name().to_string();
                    if name == "." || name == ".." || name.is_empty() {
                        continue;
                    }
                    if f.is_directory() {
                        let sub = if dir_path == "/" {
                            format!("/{}", name)
                        } else {
                            format!("{}/{}", dir_path.trim_end_matches('/'), name)
                        };
                        subdirs.push(sub);
                    } else if !f.is_symlink() {
                        total += f.size() as u64;
                    }
                }
            }
        }

        for sub in subdirs {
            total += walk_ftp(ftp, &sub, depth + 1);
        }
        total
    }

    let size = walk_ftp(&mut ftp, remote_path, 0);
    let _ = ftp.quit();
    Ok(size)
}

fn split_remote_parent_and_name(remote_path: &str) -> Result<(String, String), String> {
    let trimmed = remote_path.trim_end_matches('/');
    if trimmed.is_empty() || trimmed == "/" {
        return Err("Impossibile duplicare la directory radice '/'".to_string());
    }
    let p = Path::new(trimmed);
    let name = p
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("Percorso remoto non valido: '{}'", remote_path))?
        .to_string();
    let parent = p
        .parent()
        .map(|pp| {
            let s = pp.to_string_lossy().to_string();
            if s.is_empty() {
                "/".to_string()
            } else {
                s
            }
        })
        .unwrap_or_else(|| "/".to_string());
    Ok((parent, name))
}

fn join_remote_path(parent: &str, name: &str) -> String {
    if parent == "/" || parent.is_empty() {
        format!("/{}", name.trim_start_matches('/'))
    } else {
        format!(
            "{}/{}",
            parent.trim_end_matches('/'),
            name.trim_start_matches('/')
        )
    }
}

pub fn duplicate_sftp_items_with_progress<F>(
    site: &SiteConfig,
    items: &[(String, Option<String>)],
    on_progress: &mut F,
) -> Result<Vec<String>, String>
where
    F: FnMut(&str, u64, u64, usize, usize, bool),
{
    let sess = create_ssh_session(site)?;
    sess.set_timeout(20_000);
    let sftp = sess
        .sftp()
        .map_err(|e| format!("Inizializzazione SFTP fallita: {}", e))?;

    let mut dirs_to_create: Vec<String> = Vec::new();
    // (src_file, dst_file, display_name, size, mode)
    let mut files_to_copy: Vec<(String, String, String, u64, i32)> = Vec::new();
    let mut created_names: Vec<String> = Vec::new();
    let mut parent_existing_cache: HashMap<String, HashSet<String>> = HashMap::new();

    fn collect_sftp_tree(
        sftp: &ssh2::Sftp,
        src_dir: &str,
        dst_dir: &str,
        depth: usize,
        dirs_out: &mut Vec<String>,
        files_out: &mut Vec<(String, String, String, u64, i32)>,
    ) -> Result<(), String> {
        if depth > 16 {
            return Err("Profondità massima cartelle SFTP superata (16 livelli)".to_string());
        }
        dirs_out.push(dst_dir.to_string());
        let entries = sftp
            .readdir(Path::new(src_dir))
            .map_err(|e| format!("Errore lettura cartella SFTP '{}': {}", src_dir, e))?;

        for (child_path, stat) in entries {
            let fname = child_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            if fname.is_empty() || fname == "." || fname == ".." {
                continue;
            }
            let child_src = join_remote_path(src_dir, &fname);
            let child_dst = join_remote_path(dst_dir, &fname);
            if stat.is_dir() && !stat.file_type().is_symlink() {
                collect_sftp_tree(sftp, &child_src, &child_dst, depth + 1, dirs_out, files_out)?;
            } else if !stat.file_type().is_symlink() {
                let sz = stat.size.unwrap_or(0);
                let mode = stat.perm.unwrap_or(0o644) as i32 & 0o777;
                files_out.push((child_src, child_dst, fname, sz, mode));
            }
        }
        Ok(())
    }

    for (src_raw, explicit_name) in items {
        let (parent_dir, src_name) = split_remote_parent_and_name(src_raw)?;

        if !parent_existing_cache.contains_key(&parent_dir) {
            let mut set = HashSet::new();
            if let Ok(entries) = sftp.readdir(Path::new(&parent_dir)) {
                for (p, _) in entries {
                    if let Some(n) = p.file_name().and_then(|s| s.to_str()) {
                        set.insert(n.to_lowercase());
                    }
                }
            }
            parent_existing_cache.insert(parent_dir.clone(), set);
        }
        let existing_lower = parent_existing_cache.get_mut(&parent_dir).unwrap();

        let stat = sftp
            .stat(Path::new(src_raw))
            .map_err(|e| format!("Elemento SFTP '{}' non trovato: {}", src_raw, e))?;
        let is_dir = stat.is_dir();

        let target_name = match explicit_name {
            Some(raw_custom) if !raw_custom.trim().is_empty() => {
                let clean = raw_custom.trim().trim_matches('/').to_string();
                if clean.contains('/') {
                    return Err("Il nome del duplicato non può contenere '/'".to_string());
                }
                let candidate_dst = join_remote_path(&parent_dir, &clean);
                if sftp.lstat(Path::new(&candidate_dst)).is_ok() {
                    return Err(format!(
                        "Esiste già un elemento chiamato '{}' nella cartella remota",
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

        let dst_path = join_remote_path(&parent_dir, &target_name);
        created_names.push(target_name.clone());

        if is_dir {
            collect_sftp_tree(
                &sftp,
                src_raw,
                &dst_path,
                0,
                &mut dirs_to_create,
                &mut files_to_copy,
            )?;
        } else {
            let sz = stat.size.unwrap_or(0);
            let mode = stat.perm.unwrap_or(0o644) as i32 & 0o777;
            files_to_copy.push((src_raw.clone(), dst_path, target_name, sz, mode));
        }
    }

    let total_files = files_to_copy.len().max(created_names.len().max(1));
    let total_bytes: u64 = files_to_copy.iter().map(|f| f.3).sum();
    let mut bytes_done = 0u64;
    let mut files_done = 0usize;

    let initial_label = files_to_copy
        .first()
        .map(|f| f.2.clone())
        .or_else(|| created_names.first().cloned())
        .unwrap_or_else(|| "remote".to_string());
    on_progress(&initial_label, 0, total_bytes, 0, total_files, true);

    for d in &dirs_to_create {
        sftp.mkdir(Path::new(d), 0o755)
            .map_err(|e| format!("Impossibile creare la cartella SFTP '{}': {}", d, e))?;
    }

    let mut buf = vec![0u8; 128 * 1024];
    for (src_f, dst_f, display_name, _sz, mode) in &files_to_copy {
        on_progress(
            display_name,
            bytes_done,
            total_bytes,
            files_done,
            total_files,
            true,
        );
        let mut reader = sftp
            .open(Path::new(src_f))
            .map_err(|e| format!("Impossibile aprire '{}' su SFTP: {}", src_f, e))?;
        let mut writer = sftp
            .open_mode(
                Path::new(dst_f),
                ssh2::OpenFlags::CREATE | ssh2::OpenFlags::TRUNCATE | ssh2::OpenFlags::WRITE,
                if *mode > 0 { *mode } else { 0o644 },
                ssh2::OpenType::File,
            )
            .map_err(|e| format!("Impossibile creare '{}' su SFTP: {}", dst_f, e))?;

        loop {
            let n = reader
                .read(&mut buf)
                .map_err(|e| format!("Errore lettura SFTP '{}': {}", src_f, e))?;
            if n == 0 {
                break;
            }
            writer
                .write_all(&buf[..n])
                .map_err(|e| format!("Errore scrittura SFTP '{}': {}", dst_f, e))?;
            bytes_done = bytes_done.saturating_add(n as u64);
            on_progress(
                display_name,
                bytes_done,
                total_bytes,
                files_done,
                total_files,
                false,
            );
        }
        writer.flush().ok();
        files_done += 1;
        on_progress(
            display_name,
            bytes_done,
            total_bytes,
            files_done,
            total_files,
            true,
        );
    }

    Ok(created_names)
}

fn ftp_cd_abs(ftp: &mut NativeTlsFtpStream, base_pwd: &str, remote_dir: &str) -> Result<(), String> {
    if remote_dir.is_empty() || remote_dir == "/" {
        return ftp
            .cwd("/")
            .or_else(|_| ftp.cwd(base_pwd))
            .map_err(|e| format!("Impossibile accedere alla radice FTP: {}", e));
    }
    if ftp.cwd(remote_dir).is_ok() {
        return Ok(());
    }
    let _ = ftp.cwd("/").or_else(|_| ftp.cwd(base_pwd));
    ftp.cwd(remote_dir.trim_start_matches('/'))
        .map_err(|e| format!("Impossibile accedere alla cartella FTP '{}': {}", remote_dir, e))
}

fn ftp_mkdir_abs(ftp: &mut NativeTlsFtpStream, base_pwd: &str, remote_dir: &str) -> Result<(), String> {
    let _ = ftp_cd_abs(ftp, base_pwd, "/");
    ftp.mkdir(remote_dir)
        .or_else(|_| ftp.mkdir(remote_dir.trim_start_matches('/')))
        .map_err(|e| format!("Impossibile creare la cartella FTP '{}': {}", remote_dir, e))
}

fn ftp_list_dir_meta(
    ftp: &mut NativeTlsFtpStream,
    base_pwd: &str,
    dir_path: &str,
) -> Result<Vec<(String, bool, u64)>, String> {
    ftp_cd_abs(ftp, base_pwd, dir_path)?;
    let mut out = Vec::new();

    if let Ok(mlsd_lines) = ftp.mlsd(None) {
        for raw in mlsd_lines {
            let line = raw.trim_end_matches(&['\r', '\n'][..]);
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(f) = ListParser::parse_mlsd(line) {
                let name = f.name().to_string();
                if name == "." || name == ".." || name.is_empty() {
                    continue;
                }
                if !f.is_symlink() {
                    out.push((name, f.is_directory(), f.size() as u64));
                }
            } else if let Some(sep_idx) = line.find("; ") {
                let facts = &line[..sep_idx];
                let facts_lower = facts.to_lowercase();
                let name = line[sep_idx + 2..].to_string();
                if name == "."
                    || name == ".."
                    || name.is_empty()
                    || facts_lower.contains("type=cdir")
                    || facts_lower.contains("type=pdir")
                    || facts_lower.contains("slink")
                {
                    continue;
                }
                let is_dir = facts_lower.contains("type=dir");
                let sz = facts
                    .split(';')
                    .find_map(|kv| {
                        let (k, v) = kv.split_once('=')?;
                        if k.eq_ignore_ascii_case("size") {
                            v.parse::<u64>().ok()
                        } else {
                            None
                        }
                    })
                    .unwrap_or(0);
                out.push((name, is_dir, sz));
            }
        }
        return Ok(out);
    }

    let list_lines = ftp
        .list(Some("-a"))
        .or_else(|_| ftp.list(None))
        .map_err(|e| format!("Lettura cartella FTP '{}' fallita: {}", dir_path, e))?;

    for raw in list_lines {
        let trimmed = raw.trim();
        if trimmed.is_empty() || trimmed.to_lowercase().starts_with("total ") {
            continue;
        }
        if let Ok(f) = suppaftp::list::File::try_from(trimmed) {
            let name = f.name().to_string();
            if name == "." || name == ".." || name.is_empty() || f.is_symlink() {
                continue;
            }
            out.push((name, f.is_directory(), f.size() as u64));
            continue;
        }
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.is_empty() || trimmed.starts_with('l') {
            continue;
        }
        let is_dir = trimmed.starts_with('d') || trimmed.contains("<DIR>");
        let fname = if parts.len() >= 9 && (trimmed.starts_with('-') || trimmed.starts_with('d')) {
            parts[8..].join(" ")
        } else if parts.len() >= 4 && trimmed.contains("<DIR>") {
            parts[3..].join(" ")
        } else {
            parts.last().unwrap_or(&"").to_string()
        };
        if fname == "." || fname == ".." || fname.is_empty() {
            continue;
        }
        let sz = if parts.len() >= 5 && !is_dir {
            parts[4].parse::<u64>().unwrap_or(0)
        } else {
            0
        };
        out.push((fname, is_dir, sz));
    }

    Ok(out)
}

pub fn duplicate_ftp_items_with_progress<F>(
    site: &SiteConfig,
    items: &[(String, Option<String>)],
    on_progress: &mut F,
) -> Result<Vec<String>, String>
where
    F: FnMut(&str, u64, u64, usize, usize, bool),
{
    let mut ftp = create_ftp_session(site)?;
    let base_pwd = ftp.pwd().unwrap_or_else(|_| "/".to_string());

    let mut dirs_to_create: Vec<String> = Vec::new();
    // (src_file_path, dst_file_path, display_name, est_size)
    let mut files_to_copy: Vec<(String, String, String, u64)> = Vec::new();
    let mut created_names: Vec<String> = Vec::new();
    let mut parent_meta_cache: HashMap<String, Vec<(String, bool, u64)>> = HashMap::new();
    let mut parent_existing_cache: HashMap<String, HashSet<String>> = HashMap::new();

    fn collect_ftp_tree(
        ftp: &mut NativeTlsFtpStream,
        base_pwd: &str,
        src_dir: &str,
        dst_dir: &str,
        depth: usize,
        dirs_out: &mut Vec<String>,
        files_out: &mut Vec<(String, String, String, u64)>,
    ) -> Result<(), String> {
        if depth > 14 {
            return Err("Profondità massima cartelle FTP superata (14 livelli)".to_string());
        }
        dirs_out.push(dst_dir.to_string());
        let children = ftp_list_dir_meta(ftp, base_pwd, src_dir)?;
        let mut subdirs = Vec::new();
        for (fname, is_dir, sz) in children {
            let child_src = join_remote_path(src_dir, &fname);
            let child_dst = join_remote_path(dst_dir, &fname);
            if is_dir {
                subdirs.push((child_src, child_dst));
            } else {
                files_out.push((child_src, child_dst, fname, sz));
            }
        }
        for (c_src, c_dst) in subdirs {
            collect_ftp_tree(ftp, base_pwd, &c_src, &c_dst, depth + 1, dirs_out, files_out)?;
        }
        Ok(())
    }

    for (src_raw, explicit_name) in items {
        let (parent_dir, src_name) = split_remote_parent_and_name(src_raw)?;

        if !parent_meta_cache.contains_key(&parent_dir) {
            let meta_list = ftp_list_dir_meta(&mut ftp, &base_pwd, &parent_dir)?;
            let existing: HashSet<String> =
                meta_list.iter().map(|(n, _, _)| n.to_lowercase()).collect();
            parent_existing_cache.insert(parent_dir.clone(), existing);
            parent_meta_cache.insert(parent_dir.clone(), meta_list);
        }

        let meta_list = parent_meta_cache.get(&parent_dir).unwrap();
        let (is_dir, est_size) = if let Some((_, d, s)) = meta_list.iter().find(|(n, _, _)| n == &src_name) {
            (*d, *s)
        } else {
            // Fallback probe if item was hidden and LIST didn't return it
            let probe_dir = ftp_cd_abs(&mut ftp, &base_pwd, src_raw).is_ok();
            let sz = if probe_dir {
                0
            } else {
                let _ = ftp_cd_abs(&mut ftp, &base_pwd, &parent_dir);
                ftp.size(&src_name).unwrap_or(0) as u64
            };
            (probe_dir, sz)
        };

        let existing_lower = parent_existing_cache.get_mut(&parent_dir).unwrap();

        let target_name = match explicit_name {
            Some(raw_custom) if !raw_custom.trim().is_empty() => {
                let clean = raw_custom.trim().trim_matches('/').to_string();
                if clean.contains('/') {
                    let _ = ftp.quit();
                    return Err("Il nome del duplicato non può contenere '/'".to_string());
                }
                if existing_lower.contains(&clean.to_lowercase()) {
                    let _ = ftp.quit();
                    return Err(format!(
                        "Esiste già un elemento chiamato '{}' nella cartella FTP",
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

        let dst_path = join_remote_path(&parent_dir, &target_name);
        created_names.push(target_name.clone());

        if is_dir {
            if let Err(e) = collect_ftp_tree(
                &mut ftp,
                &base_pwd,
                src_raw,
                &dst_path,
                0,
                &mut dirs_to_create,
                &mut files_to_copy,
            ) {
                let _ = ftp.quit();
                return Err(e);
            }
        } else {
            files_to_copy.push((src_raw.clone(), dst_path, target_name, est_size));
        }
    }

    let total_files = files_to_copy.len().max(created_names.len().max(1));
    // Count each byte across download + upload so progress moves smoothly at 50% (download) and 100% (upload)
    let total_bytes: u64 = files_to_copy.iter().map(|f| f.3).sum();
    let mut bytes_done = 0u64;
    let mut files_done = 0usize;

    let initial_label = files_to_copy
        .first()
        .map(|f| f.2.clone())
        .or_else(|| created_names.first().cloned())
        .unwrap_or_else(|| "ftp".to_string());
    on_progress(&initial_label, 0, total_bytes, 0, total_files, true);

    for d in &dirs_to_create {
        if let Err(e) = ftp_mkdir_abs(&mut ftp, &base_pwd, d) {
            let _ = ftp.quit();
            return Err(e);
        }
    }

    for (src_f, dst_f, display_name, est_sz) in &files_to_copy {
        on_progress(
            display_name,
            bytes_done,
            total_bytes,
            files_done,
            total_files,
            true,
        );

        let (src_parent, src_fname) = match split_remote_parent_and_name(src_f) {
            Ok(p) => p,
            Err(e) => {
                let _ = ftp.quit();
                return Err(e);
            }
        };
        if let Err(e) = ftp_cd_abs(&mut ftp, &base_pwd, &src_parent) {
            let _ = ftp.quit();
            return Err(e);
        }
        let cursor = match ftp.retr_as_buffer(&src_fname) {
            Ok(c) => c,
            Err(e) => {
                let _ = ftp.quit();
                return Err(format!("Download FTP fallito per '{}': {}", src_f, e));
            }
        };
        let data = cursor.into_inner();
        let file_bytes = if *est_sz > 0 { *est_sz } else { data.len() as u64 };
        let half = file_bytes / 2;
        on_progress(
            display_name,
            bytes_done.saturating_add(half),
            total_bytes.max(bytes_done.saturating_add(file_bytes)),
            files_done,
            total_files,
            true,
        );

        let (dst_parent, dst_fname) = match split_remote_parent_and_name(dst_f) {
            Ok(p) => p,
            Err(e) => {
                let _ = ftp.quit();
                return Err(e);
            }
        };
        if let Err(e) = ftp_cd_abs(&mut ftp, &base_pwd, &dst_parent) {
            let _ = ftp.quit();
            return Err(e);
        }
        let mut upload_cursor = Cursor::new(&data);
        if let Err(e) = ftp.put_file(&dst_fname, &mut upload_cursor) {
            let _ = ftp.quit();
            return Err(format!("Upload FTP fallito per '{}': {}", dst_f, e));
        }

        bytes_done = bytes_done.saturating_add(file_bytes);
        files_done += 1;
        on_progress(
            display_name,
            bytes_done,
            total_bytes.max(bytes_done),
            files_done,
            total_files,
            true,
        );
    }

    let _ = ftp.quit();
    Ok(created_names)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_host() {
        assert_eq!(sanitize_host("ftp.mariosalvucci.com").unwrap(), "ftp.mariosalvucci.com");
        assert_eq!(sanitize_host("ftp://ftp.example.com/public").unwrap(), "ftp.example.com");
        assert_eq!(sanitize_host("ftps://ftp.example.com:21/").unwrap(), "ftp.example.com");
        assert!(sanitize_host("mariuccio_ftp@sandpiperstudio.it").is_err());
        assert!(sanitize_host("   ").is_err());
    }

    #[test]
    fn test_parse_remote_url() {
        assert_eq!(
            parse_remote_url("ftp://site-1/public_html"),
            Some(("ftp".to_string(), "site-1".to_string(), "/public_html".to_string()))
        );
        assert_eq!(
            parse_remote_url("ftps://site-2/"),
            Some(("ftps".to_string(), "site-2".to_string(), "/".to_string()))
        );
        assert_eq!(
            parse_remote_url("sftp://site-3/var/www"),
            Some(("sftp".to_string(), "site-3".to_string(), "/var/www".to_string()))
        );
    }
}
