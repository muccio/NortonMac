use crate::models::SiteConfig;
use base64::prelude::*;
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredSite {
    pub id: String,
    pub source_app: String, // "Cyberduck" | "FileZilla" | "SSH Config" | "Transmit"
    pub file_path: String,
    pub site: SiteConfig,
}

/// Helper to expand `~` in file paths
fn expand_tilde(path: &str) -> String {
    if path.starts_with("~/") || path == "~" {
        if let Some(home) = dirs::home_dir() {
            let home_str = home.to_string_lossy();
            if path == "~" {
                return home_str.to_string();
            } else {
                return format!("{}/{}", home_str, &path[2..]);
            }
        }
    }
    path.to_string()
}

/// Scan standard macOS locations for installed FTP/SFTP configurations
pub fn scan_discovered_sites() -> Vec<DiscoveredSite> {
    let mut results = Vec::new();
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return results,
    };

    // 1. Cyberduck Bookmarks (.duck)
    let duck_dirs = vec![
        home.join("Library/Group Containers/G69SCX94XU.duck/Library/Application Support/duck/Bookmarks"),
        home.join("Library/Application Support/Cyberduck/Bookmarks"),
        home.join("Library/Application Support/duck/Bookmarks"),
        home.join(".duck/bookmarks"),
    ];

    for duck_dir in duck_dirs {
        if duck_dir.exists() && duck_dir.is_dir() {
            if let Ok(entries) = fs::read_dir(&duck_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        let fname = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
                        if fname.ends_with(".duck") || fname.ends_with(".xml") {
                            if let Ok(content) = fs::read_to_string(&path) {
                                if let Some(site) = parse_cyberduck_duck(&content, fname) {
                                    results.push(DiscoveredSite {
                                        id: format!("duck-{}", results.len()),
                                        source_app: "Cyberduck".to_string(),
                                        file_path: path.to_string_lossy().to_string(),
                                        site,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. FileZilla (sitemanager.xml)
    let fz_files = vec![
        home.join(".config/filezilla/sitemanager.xml"),
        home.join("Library/Application Support/FileZilla/sitemanager.xml"),
        home.join(".filezilla/sitemanager.xml"),
        home.join(".config/filezilla/filezilla.xml"),
    ];

    for fz_file in fz_files {
        if fz_file.exists() && fz_file.is_file() {
            if let Ok(content) = fs::read_to_string(&fz_file) {
                let parsed = parse_filezilla_xml(&content);
                for site in parsed {
                    results.push(DiscoveredSite {
                        id: format!("fz-{}", results.len()),
                        source_app: "FileZilla".to_string(),
                        file_path: fz_file.to_string_lossy().to_string(),
                        site,
                    });
                }
            }
        }
    }

    // 3. SSH Config (~/.ssh/config)
    let ssh_config = home.join(".ssh/config");
    if ssh_config.exists() && ssh_config.is_file() {
        if let Ok(content) = fs::read_to_string(&ssh_config) {
            let parsed = parse_ssh_config(&content);
            for site in parsed {
                results.push(DiscoveredSite {
                    id: format!("ssh-{}", results.len()),
                    source_app: "SSH Config".to_string(),
                    file_path: ssh_config.to_string_lossy().to_string(),
                    site,
                });
            }
        }
    }

    // 4. Transmit (Favorites.json)
    let transmit_file = home.join("Library/Application Support/Transmit/Favorites/Favorites.json");
    if transmit_file.exists() && transmit_file.is_file() {
        if let Ok(content) = fs::read_to_string(&transmit_file) {
            let parsed = parse_transmit_json(&content);
            for site in parsed {
                results.push(DiscoveredSite {
                    id: format!("transmit-{}", results.len()),
                    source_app: "Transmit".to_string(),
                    file_path: transmit_file.to_string_lossy().to_string(),
                    site,
                });
            }
        }
    }

    results
}

/// Parse a single Cyberduck `.duck` XML plist file
pub fn parse_cyberduck_duck(xml: &str, fallback_name: &str) -> Option<SiteConfig> {
    // Extract key-value pairs from plist dict
    let protocol = extract_plist_string(xml, "Protocol")
        .or_else(|| extract_plist_string(xml, "protocol"))
        .unwrap_or_else(|| "sftp".to_string())
        .to_lowercase();

    let is_sftp = protocol.contains("sftp") || protocol.contains("ssh");
    let is_ftps = !is_sftp && (protocol.contains("ftps") || protocol.contains("ssl") || protocol.contains("tls"));
    let is_ftp = protocol.contains("ftp");

    if !is_sftp && !is_ftp {
        // Skip non-FTP/SFTP Cyberduck protocols like s3, swift, google drive etc.
        return None;
    }

    let host = extract_plist_string(xml, "Hostname")
        .or_else(|| extract_plist_string(xml, "Server"))
        .or_else(|| extract_plist_string(xml, "hostname"))?;

    let default_port = if is_sftp { 22 } else { 21 };
    let port: u16 = extract_plist_string(xml, "Port")
        .or_else(|| extract_plist_integer(xml, "Port"))
        .and_then(|p| p.parse().ok())
        .unwrap_or(default_port);

    let username = extract_plist_string(xml, "Username")
        .or_else(|| extract_plist_string(xml, "username"))
        .unwrap_or_else(|| "anonymous".to_string());

    let default_path = extract_plist_string(xml, "Path")
        .or_else(|| extract_plist_string(xml, "path"));

    let private_key = extract_plist_string(xml, "Identity")
        .or_else(|| extract_plist_string(xml, "identity"))
        .map(|k| expand_tilde(&k));

    let clean_fallback = fallback_name.trim_end_matches(".duck").trim_end_matches(".xml");
    let proto_str = if is_sftp {
        "sftp"
    } else if is_ftps || port == 990 {
        "ftps"
    } else {
        "ftp"
    };
    let nickname = extract_plist_string(xml, "Nickname")
        .or_else(|| extract_plist_string(xml, "nickname"))
        .unwrap_or_else(|| {
            if !clean_fallback.is_empty() {
                clean_fallback.to_string()
            } else {
                format!("{} ({})", host, proto_str.to_uppercase())
            }
        });

    let site_id = format!("duck-{}", chrono::Utc::now().timestamp_micros() % 1_000_000);

    Some(SiteConfig {
        id: site_id,
        name: nickname,
        protocol: proto_str.to_string(),
        host,
        port,
        username,
        password: None,
        private_key_path: private_key,
        default_path: default_path.or_else(|| Some("/".to_string())),
    })
}

/// Parse FileZilla XML (`sitemanager.xml` or `FileZilla.xml`)
pub fn parse_filezilla_xml(xml: &str) -> Vec<SiteConfig> {
    let mut sites = Vec::new();

    // Iterate over each <Server>...</Server> block
    let mut cursor = 0;
    while let Some(start_idx) = xml[cursor..].find("<Server") {
        let abs_start = cursor + start_idx;
        let end_tag = "</Server>";
        let abs_end = match xml[abs_start..].find(end_tag) {
            Some(e) => abs_start + e + end_tag.len(),
            None => break,
        };

        let server_block = &xml[abs_start..abs_end];
        cursor = abs_end;

        let host = match extract_xml_tag(server_block, "Host") {
            Some(h) if !h.trim().is_empty() => h.trim().to_string(),
            _ => continue,
        };

        let protocol_val = extract_xml_tag(server_block, "Protocol").unwrap_or_else(|| "0".to_string());
        // 0 = FTP, 1 = SFTP (SSH), 2 = FTPS, 3 = FTPES
        let is_sftp = protocol_val == "1" || protocol_val.to_lowercase().contains("sftp") || protocol_val.to_lowercase().contains("ssh");
        let default_port = if is_sftp { 22 } else { 21 };

        let port: u16 = extract_xml_tag(server_block, "Port")
            .and_then(|p| p.parse().ok())
            .unwrap_or(default_port);

        let user = extract_xml_tag(server_block, "User")
            .unwrap_or_else(|| "anonymous".to_string());

        let name = extract_xml_tag(server_block, "Name")
            .unwrap_or_else(|| format!("{} ({})", host, if is_sftp { "SFTP" } else { "FTP" }));

        // Pass (might be base64 encoded if <Pass encoding="base64">)
        let pass = if let Some(pass_val) = extract_xml_tag(server_block, "Pass") {
            if server_block.contains("encoding=\"base64\"") {
                BASE64_STANDARD.decode(pass_val.trim()).ok().and_then(|b| String::from_utf8(b).ok())
            } else {
                Some(pass_val)
            }
        } else {
            None
        };

        let keyfile = extract_xml_tag(server_block, "Keyfile")
            .filter(|k| !k.trim().is_empty())
            .map(|k| expand_tilde(k.trim()));

        // FileZilla RemoteDir format: can be raw "/path" or "1 0 3 var 3 www"
        let remote_dir = extract_xml_tag(server_block, "RemoteDir").map(|rd| {
            clean_filezilla_remotedir(&rd)
        });

        let site_id = format!("fz-{}", chrono::Utc::now().timestamp_micros() % 1_000_000 + sites.len() as i64);

        sites.push(SiteConfig {
            id: site_id,
            name,
            protocol: if is_sftp { "sftp".to_string() } else { "ftp".to_string() },
            host,
            port,
            username: user,
            password: pass,
            private_key_path: keyfile,
            default_path: remote_dir.or_else(|| Some("/".to_string())),
        });
    }

    sites
}

/// Helper to clean FileZilla's internal RemoteDir representation (e.g. "1 0 3 var 3 www" -> "/var/www")
fn clean_filezilla_remotedir(rd: &str) -> String {
    let trimmed = rd.trim();
    if trimmed.starts_with('/') {
        return trimmed.to_string();
    }
    let parts: Vec<&str> = trimmed.split_whitespace().collect();
    // If it follows the "1 0 [len part]..." pattern
    if parts.len() >= 2 && (parts[0] == "1" || parts[0] == "0") {
        let mut segments = Vec::new();
        let mut i = 2;
        while i < parts.len() {
            // parts[i] is length, parts[i+1] is string segment
            if i + 1 < parts.len() {
                segments.push(parts[i + 1]);
                i += 2;
            } else {
                segments.push(parts[i]);
                i += 1;
            }
        }
        if !segments.is_empty() {
            return format!("/{}", segments.join("/"));
        }
    }
    "/".to_string()
}

/// Parse standard OpenSSH configuration (`~/.ssh/config`)
pub fn parse_ssh_config(content: &str) -> Vec<SiteConfig> {
    let mut sites = Vec::new();
    let mut current_hosts: Vec<String> = Vec::new();
    let mut current_hostname: Option<String> = None;
    let mut current_user: Option<String> = None;
    let mut current_port: Option<u16> = None;
    let mut current_identity: Option<String> = None;

    let flush = |hosts: &mut Vec<String>,
                 hostname: &mut Option<String>,
                 user: &mut Option<String>,
                 port: &mut Option<u16>,
                 identity: &mut Option<String>,
                 sites: &mut Vec<SiteConfig>| {
        for host in hosts.drain(..) {
            // Ignore wildcard patterns like "*" or "*.*"
            if host.contains('*') || host.contains('?') {
                continue;
            }
            let resolved_host = hostname.clone().unwrap_or_else(|| host.clone());
            let site_id = format!("ssh-{}", chrono::Utc::now().timestamp_micros() % 1_000_000 + sites.len() as i64);
            sites.push(SiteConfig {
                id: site_id,
                name: format!("{} (SSH)", host),
                protocol: "sftp".to_string(),
                host: resolved_host,
                port: port.unwrap_or(22),
                username: user.clone().unwrap_or_else(|| "root".to_string()),
                password: None,
                private_key_path: identity.clone(),
                default_path: Some("/".to_string()),
            });
        }
        *hostname = None;
        *user = None;
        *port = None;
        *identity = None;
    };

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        // Split by whitespace or '='
        let parts: Vec<&str> = trimmed
            .splitn(2, |c: char| c.is_whitespace() || c == '=')
            .collect();
        if parts.is_empty() {
            continue;
        }

        let key = parts[0].to_lowercase();
        let val = if parts.len() > 1 {
            parts[1].trim().trim_start_matches('=').trim()
        } else {
            ""
        };

        match key.as_str() {
            "host" => {
                flush(
                    &mut current_hosts,
                    &mut current_hostname,
                    &mut current_user,
                    &mut current_port,
                    &mut current_identity,
                    &mut sites,
                );
                current_hosts = val.split_whitespace().map(|s| s.to_string()).collect();
            }
            "hostname" => {
                current_hostname = Some(val.to_string());
            }
            "user" => {
                current_user = Some(val.to_string());
            }
            "port" => {
                if let Ok(p) = val.parse::<u16>() {
                    current_port = Some(p);
                }
            }
            "identityfile" => {
                current_identity = Some(expand_tilde(val));
            }
            _ => {}
        }
    }

    flush(
        &mut current_hosts,
        &mut current_hostname,
        &mut current_user,
        &mut current_port,
        &mut current_identity,
        &mut sites,
    );

    sites
}

/// Parse Transmit Favorites JSON
pub fn parse_transmit_json(json_str: &str) -> Vec<SiteConfig> {
    let mut sites = Vec::new();
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
        let items = if val.is_array() {
            val.as_array().cloned().unwrap_or_default()
        } else if let Some(arr) = val.get("favorites").and_then(|f| f.as_array()) {
            arr.clone()
        } else {
            vec![val]
        };

        for item in items {
            let host = item.get("server").or_else(|| item.get("host")).and_then(|v| v.as_str());
            let host = match host {
                Some(h) if !h.trim().is_empty() => h.trim().to_string(),
                _ => continue,
            };

            let proto_str = item.get("protocol").and_then(|v| v.as_str()).unwrap_or("sftp").to_lowercase();
            let is_sftp = proto_str.contains("sftp") || proto_str.contains("ssh");
            let default_port = if is_sftp { 22 } else { 21 };

            let port = item.get("port")
                .and_then(|v| v.as_u64())
                .map(|p| p as u16)
                .unwrap_or(default_port);

            let username = item.get("username").or_else(|| item.get("user")).and_then(|v| v.as_str()).unwrap_or("anonymous").to_string();
            let name = item.get("name").or_else(|| item.get("nickname")).and_then(|v| v.as_str()).unwrap_or(&host).to_string();
            let default_path = item.get("initialPath").or_else(|| item.get("path")).and_then(|v| v.as_str()).map(|p| p.to_string());

            let site_id = format!("tr-{}", chrono::Utc::now().timestamp_micros() % 1_000_000 + sites.len() as i64);

            sites.push(SiteConfig {
                id: site_id,
                name,
                protocol: if is_sftp { "sftp".to_string() } else { "ftp".to_string() },
                host,
                port,
                username,
                password: None,
                private_key_path: None,
                default_path: default_path.or_else(|| Some("/".to_string())),
            });
        }
    }
    sites
}

/// Parse generic URL format: e.g. sftp://user:password@host:port/path
pub fn parse_url_string(url_str: &str) -> Option<SiteConfig> {
    let trimmed = url_str.trim();
    let (protocol, rest) = if let Some(idx) = trimmed.find("://") {
        (&trimmed[..idx], &trimmed[idx + 3..])
    } else {
        return None;
    };

    let proto_lower = protocol.to_lowercase();
    let is_sftp = proto_lower == "sftp" || proto_lower == "ssh";
    let is_ftp = proto_lower == "ftp" || proto_lower == "ftps";
    if !is_sftp && !is_ftp {
        return None;
    }

    // Split user:pass and host:port/path
    let (user_pass, host_path) = if let Some(at_idx) = rest.find('@') {
        (&rest[..at_idx], &rest[at_idx + 1..])
    } else {
        ("", rest)
    };

    let (username, password) = if let Some(colon_idx) = user_pass.find(':') {
        (&user_pass[..colon_idx], Some(user_pass[colon_idx + 1..].to_string()))
    } else if !user_pass.is_empty() {
        (user_pass, None)
    } else {
        ("anonymous", None)
    };

    let (host_port, path) = if let Some(slash_idx) = host_path.find('/') {
        (&host_path[..slash_idx], &host_path[slash_idx..])
    } else {
        (host_path, "/")
    };

    let (host, port) = if let Some(colon_idx) = host_port.find(':') {
        let p: u16 = host_port[colon_idx + 1..].parse().unwrap_or(if is_sftp { 22 } else { 21 });
        (&host_port[..colon_idx], p)
    } else {
        (host_port, if is_sftp { 22 } else { 21 })
    };

    if host.is_empty() {
        return None;
    }

    let site_id = format!("url-{}", chrono::Utc::now().timestamp_micros() % 1_000_000);

    Some(SiteConfig {
        id: site_id,
        name: format!("{}:{}", host, port),
        protocol: if is_sftp { "sftp".to_string() } else { "ftp".to_string() },
        host: host.to_string(),
        port,
        username: username.to_string(),
        password,
        private_key_path: None,
        default_path: Some(path.to_string()),
    })
}

/// Generic autodetect and parser for any imported text content
pub fn parse_imported_content(content: &str) -> Vec<SiteConfig> {
    let trimmed = content.trim();

    // 1. Try JSON (NortonMac or Transmit)
    if trimmed.starts_with('[') || trimmed.starts_with('{') {
        if let Ok(sites) = serde_json::from_str::<Vec<SiteConfig>>(trimmed) {
            if !sites.is_empty() {
                return sites;
            }
        }
        let transmit_sites = parse_transmit_json(trimmed);
        if !transmit_sites.is_empty() {
            return transmit_sites;
        }
    }

    // 2. Try URL (single or multiple lines)
    if trimmed.starts_with("sftp://") || trimmed.starts_with("ftp://") || trimmed.starts_with("ftps://") {
        let mut list = Vec::new();
        for line in trimmed.lines() {
            if let Some(site) = parse_url_string(line) {
                list.push(site);
            }
        }
        if !list.is_empty() {
            return list;
        }
    }

    // 3. Try Cyberduck Plist
    if trimmed.contains("<plist") && (trimmed.contains("Protocol") || trimmed.contains("Hostname")) {
        if let Some(site) = parse_cyberduck_duck(trimmed, "Imported Cyberduck Bookmark") {
            return vec![site];
        }
    }

    // 4. Try FileZilla XML
    if trimmed.contains("<FileZilla") || trimmed.contains("<Server>") {
        let sites = parse_filezilla_xml(trimmed);
        if !sites.is_empty() {
            return sites;
        }
    }

    // 5. Try OpenSSH config format
    if trimmed.lines().any(|l| l.trim_start().to_lowercase().starts_with("host ") || l.trim_start().to_lowercase().starts_with("hostname ")) {
        let sites = parse_ssh_config(trimmed);
        if !sites.is_empty() {
            return sites;
        }
    }

    Vec::new()
}

// -----------------------------------------------------------------------------
// Plist / XML extraction helpers
// -----------------------------------------------------------------------------

fn extract_plist_string(xml: &str, key: &str) -> Option<String> {
    let key_tag = format!("<key>{}</key>", key);
    let key_pos = xml.find(&key_tag)?;
    let after_key = &xml[key_pos + key_tag.len()..];

    // Find the next <string> tag
    let str_open = after_key.find("<string>")?;
    let str_close = after_key.find("</string>")?;
    if str_close > str_open {
        let val = &after_key[str_open + "<string>".len()..str_close];
        return Some(decode_xml_entities(val));
    }
    None
}

fn extract_plist_integer(xml: &str, key: &str) -> Option<String> {
    let key_tag = format!("<key>{}</key>", key);
    let key_pos = xml.find(&key_tag)?;
    let after_key = &xml[key_pos + key_tag.len()..];

    let int_open = after_key.find("<integer>")?;
    let int_close = after_key.find("</integer>")?;
    if int_close > int_open {
        let val = &after_key[int_open + "<integer>".len()..int_close];
        return Some(val.trim().to_string());
    }
    None
}

fn extract_xml_tag(xml: &str, tag: &str) -> Option<String> {
    let open_tag = format!("<{}", tag);
    let close_tag = format!("</{}>", tag);

    let start = xml.find(&open_tag)?;
    let after_open = &xml[start..];
    let tag_end = after_open.find('>')?;
    let content_start = tag_end + 1;

    let end = after_open.find(&close_tag)?;
    if end >= content_start {
        let val = &after_open[content_start..end];
        return Some(decode_xml_entities(val));
    }
    None
}

fn decode_xml_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_cyberduck() {
        let duck_xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Hostname</key>
    <string>ftp.example.com</string>
    <key>Nickname</key>
    <string>Cyberduck Test</string>
    <key>Port</key>
    <string>22</string>
    <key>Protocol</key>
    <string>sftp</string>
    <key>Username</key>
    <string>testuser</string>
    <key>Path</key>
    <string>/var/www</string>
</dict>
</plist>"#;

        let site = parse_cyberduck_duck(duck_xml, "fallback.duck").expect("Should parse");
        assert_eq!(site.name, "Cyberduck Test");
        assert_eq!(site.protocol, "sftp");
        assert_eq!(site.host, "ftp.example.com");
        assert_eq!(site.port, 22);
        assert_eq!(site.username, "testuser");
        assert_eq!(site.default_path, Some("/var/www".to_string()));
    }

    #[test]
    fn test_parse_filezilla() {
        let fz_xml = r#"<?xml version="1.0"?>
<FileZilla3>
    <Servers>
        <Server>
            <Host>my.filezilla.org</Host>
            <Port>21</Port>
            <Protocol>0</Protocol>
            <Type>0</Type>
            <User>admin</User>
            <Name>FZ Production</Name>
            <RemoteDir>1 0 4 home 4 user</RemoteDir>
        </Server>
    </Servers>
</FileZilla3>"#;

        let sites = parse_filezilla_xml(fz_xml);
        assert_eq!(sites.len(), 1);
        let s = &sites[0];
        assert_eq!(s.name, "FZ Production");
        assert_eq!(s.protocol, "ftp");
        assert_eq!(s.host, "my.filezilla.org");
        assert_eq!(s.port, 21);
        assert_eq!(s.username, "admin");
        assert_eq!(s.default_path, Some("/home/user".to_string()));
    }

    #[test]
    fn test_parse_ssh_config() {
        let ssh_cfg = r#"
Host production-server
    HostName prod.company.com
    User deploy
    Port 2222
    IdentityFile ~/.ssh/id_rsa
"#;
        let sites = parse_ssh_config(ssh_cfg);
        assert_eq!(sites.len(), 1);
        let s = &sites[0];
        assert_eq!(s.host, "prod.company.com");
        assert_eq!(s.username, "deploy");
        assert_eq!(s.port, 2222);
        assert_eq!(s.protocol, "sftp");
        assert!(s.private_key_path.is_some());
    }

    #[test]
    fn test_parse_url() {
        let url = "sftp://root:secret@192.168.1.100:2222/opt/app";
        let site = parse_url_string(url).expect("Should parse URL");
        assert_eq!(site.protocol, "sftp");
        assert_eq!(site.host, "192.168.1.100");
        assert_eq!(site.port, 2222);
        assert_eq!(site.username, "root");
        assert_eq!(site.password, Some("secret".to_string()));
        assert_eq!(site.default_path, Some("/opt/app".to_string()));
    }
}
