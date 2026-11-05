use crate::models::{DirectoryListing, FileEntry, SiteConfig};
use std::collections::HashMap;
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
