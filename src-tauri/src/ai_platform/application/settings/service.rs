use crate::ai_platform::domain::settings::AiPlatformSettingsRecord;
use crate::ai_platform::infrastructure::fs::settings_store::{load_store, save_store};
use crate::ai_platform::interfaces::dto::settings::{
    SettingsSnapshotDto, SettingsStatusItemDto,
};
use std::path::Path;

pub fn get_settings_snapshot() -> Result<SettingsSnapshotDto, String> {
    let settings = load_store()?;
    Ok(build_snapshot(settings))
}

pub fn save_settings(settings: AiPlatformSettingsRecord) -> Result<SettingsSnapshotDto, String> {
    validate_settings(&settings)?;
    save_store(&settings)?;
    Ok(build_snapshot(settings))
}

fn build_snapshot(settings: AiPlatformSettingsRecord) -> SettingsSnapshotDto {
    let statuses = vec![
        directory_status(
            "workspace",
            "Default Workspace",
            &settings.directories.default_workspace_root,
            true,
        ),
        directory_status(
            "claude",
            "Claude Config",
            &settings.directories.claude_config_dir,
            false,
        ),
        directory_status(
            "codex",
            "Codex Config",
            &settings.directories.codex_config_dir,
            false,
        ),
        directory_status(
            "gemini",
            "Gemini Config",
            &settings.directories.gemini_config_dir,
            false,
        ),
        directory_status(
            "opencode",
            "OpenCode Config",
            &settings.directories.opencode_config_dir,
            false,
        ),
        directory_status(
            "openclaw",
            "OpenClaw Config",
            &settings.directories.openclaw_config_dir,
            false,
        ),
        proxy_status(&settings.outbound_proxy.url),
        webdav_status(&settings),
        backup_status(&settings),
    ];

    SettingsSnapshotDto {
        settings,
        statuses,
        source: "settings-store".to_string(),
    }
}

fn validate_settings(settings: &AiPlatformSettingsRecord) -> Result<(), String> {
    validate_optional_directory(&settings.directories.default_workspace_root, true)?;
    validate_optional_directory(&settings.directories.claude_config_dir, false)?;
    validate_optional_directory(&settings.directories.codex_config_dir, false)?;
    validate_optional_directory(&settings.directories.gemini_config_dir, false)?;
    validate_optional_directory(&settings.directories.opencode_config_dir, false)?;
    validate_optional_directory(&settings.directories.openclaw_config_dir, false)?;

    if settings.backup.interval_hours == 0 {
        return Err("Backup interval must be at least 1 hour".to_string());
    }
    if settings.backup.retention_count == 0 {
        return Err("Backup retention must be at least 1 snapshot".to_string());
    }
    if settings.webdav.enabled && settings.webdav.base_url.trim().is_empty() {
        return Err("WebDAV base URL is required when WebDAV is enabled".to_string());
    }
    if !matches!(settings.appearance.theme.as_str(), "dark" | "light") {
        return Err("Theme must be dark or light".to_string());
    }
    if !matches!(settings.appearance.language.as_str(), "zh" | "en") {
        return Err("Language must be zh or en".to_string());
    }

    Ok(())
}

fn validate_optional_directory(path: &str, required: bool) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        if required {
            return Err("Default workspace root is required".to_string());
        }
        return Ok(());
    }

    let target = Path::new(trimmed);
    if !target.exists() {
        return Err(format!("Directory does not exist: {trimmed}"));
    }
    if !target.is_dir() {
        return Err(format!("Path must be a directory: {trimmed}"));
    }

    Ok(())
}

fn directory_status(id: &str, label: &str, path: &str, required: bool) -> SettingsStatusItemDto {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return SettingsStatusItemDto {
            id: id.to_string(),
            label: label.to_string(),
            level: if required { "warning".to_string() } else { "neutral".to_string() },
            detail: if required {
                "需要设置默认工作区以供 Workspace / Prompts 复用。".to_string()
            } else {
                "未覆盖，后续将回退到工具默认目录。".to_string()
            },
        };
    }

    let target = Path::new(trimmed);
    let (level, detail) = if target.is_dir() {
        ("success", trimmed.to_string())
    } else if target.exists() {
        ("danger", "路径存在但不是目录。".to_string())
    } else {
        ("warning", "目录不存在。".to_string())
    };

    SettingsStatusItemDto {
        id: id.to_string(),
        label: label.to_string(),
        level: level.to_string(),
        detail,
    }
}

fn proxy_status(url: &str) -> SettingsStatusItemDto {
    let trimmed = url.trim();
    let (level, detail) = if trimmed.is_empty() {
        ("neutral", "未设置，默认直连。".to_string())
    } else if trimmed.starts_with("http://") || trimmed.starts_with("https://") || trimmed.starts_with("socks5://") {
        ("success", trimmed.to_string())
    } else {
        ("warning", "建议使用 http(s):// 或 socks5:// 前缀。".to_string())
    };

    SettingsStatusItemDto {
        id: "proxy".to_string(),
        label: "Outbound Proxy".to_string(),
        level: level.to_string(),
        detail,
    }
}

fn webdav_status(settings: &AiPlatformSettingsRecord) -> SettingsStatusItemDto {
    let (level, detail) = if !settings.webdav.enabled {
        ("neutral", "未启用 WebDAV。".to_string())
    } else if settings.webdav.base_url.trim().is_empty() {
        ("warning", "已启用但缺少服务地址。".to_string())
    } else {
        ("success", format!("{}{}", settings.webdav.base_url.trim(), settings.webdav.remote_path))
    };

    SettingsStatusItemDto {
        id: "webdav".to_string(),
        label: "WebDAV".to_string(),
        level: level.to_string(),
        detail,
    }
}

fn backup_status(settings: &AiPlatformSettingsRecord) -> SettingsStatusItemDto {
    let detail = if settings.backup.enabled {
        format!(
            "每 {} 小时备份一次，保留 {} 份。",
            settings.backup.interval_hours, settings.backup.retention_count
        )
    } else {
        "自动备份已关闭。".to_string()
    };

    SettingsStatusItemDto {
        id: "backup".to_string(),
        label: "Backup Policy".to_string(),
        level: if settings.backup.enabled {
            "success".to_string()
        } else {
            "neutral".to_string()
        },
        detail,
    }
}