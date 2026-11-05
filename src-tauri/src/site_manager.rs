use crate::models::SiteConfig;
use std::fs;
use std::path::PathBuf;

fn get_config_path() -> PathBuf {
    let base = dirs::config_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")))
        .join("norton-mac");
    fs::create_dir_all(&base).ok();
    base.join("sites.json")
}

pub fn load_sites() -> Vec<SiteConfig> {
    let path = get_config_path();
    if !path.exists() {
        return vec![
            SiteConfig {
                id: "demo-test".to_string(),
                name: "Public SFTP / SSH (Example)".to_string(),
                protocol: "sftp".to_string(),
                host: "test.rebex.net".to_string(),
                port: 22,
                username: "demo".to_string(),
                password: Some("password".to_string()),
                private_key_path: None,
                default_path: Some("/".to_string()),
            }
        ];
    }

    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

pub fn save_site(site: SiteConfig) -> Result<(), String> {
    let mut sites = load_sites();
    if let Some(idx) = sites.iter().position(|s| s.id == site.id) {
        sites[idx] = site;
    } else {
        sites.push(site);
    }

    let path = get_config_path();
    let json = serde_json::to_string_pretty(&sites).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_site(id: &str) -> Result<(), String> {
    let mut sites = load_sites();
    sites.retain(|s| s.id != id);

    let path = get_config_path();
    let json = serde_json::to_string_pretty(&sites).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn save_multiple_sites(new_sites: Vec<SiteConfig>, overwrite: bool) -> Result<usize, String> {
    let mut sites = load_sites();
    let mut imported_count = 0;

    for new_site in new_sites {
        let existing_idx = sites.iter().position(|s| {
            s.id == new_site.id
                || (s.protocol == new_site.protocol
                    && s.host.eq_ignore_ascii_case(&new_site.host)
                    && s.port == new_site.port
                    && s.username == new_site.username)
        });

        if let Some(idx) = existing_idx {
            if overwrite {
                sites[idx] = new_site;
                imported_count += 1;
            }
        } else {
            sites.push(new_site);
            imported_count += 1;
        }
    }

    let path = get_config_path();
    let json = serde_json::to_string_pretty(&sites).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())?;
    Ok(imported_count)
}

pub fn export_sites_json() -> Result<String, String> {
    let sites = load_sites();
    serde_json::to_string_pretty(&sites).map_err(|e| e.to_string())
}
