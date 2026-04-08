use crate::ai_platform::domain::workspace::WorkspaceFileRecord;
use crate::ai_platform::interfaces::dto::workspace::WorkspaceSnapshotDto;
use std::fs;
use std::path::{Path, PathBuf};

pub fn get_workspace_snapshot(workspace_root: String) -> Result<WorkspaceSnapshotDto, String> {
    let root = normalize_workspace_root(&workspace_root)?;
    let daily_memory_dir = root.join(".ai-platform").join("daily-memory");
    let files = workspace_files(&root, &daily_memory_dir)?;

    Ok(WorkspaceSnapshotDto {
        workspace_root: root.to_string_lossy().to_string(),
        files,
        daily_memory_dir: daily_memory_dir.to_string_lossy().to_string(),
    })
}

pub fn write_workspace_file(file_path: String, content: String) -> Result<(), String> {
    let path = PathBuf::from(file_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, content).map_err(|error| error.to_string())
}

pub fn create_daily_memory(workspace_root: String) -> Result<WorkspaceSnapshotDto, String> {
    let root = normalize_workspace_root(&workspace_root)?;
    let daily_memory_dir = root.join(".ai-platform").join("daily-memory");
    fs::create_dir_all(&daily_memory_dir).map_err(|error| error.to_string())?;
    let today = today_file_name();
    let file_path = daily_memory_dir.join(&today);
    if !file_path.exists() {
        fs::write(&file_path, today_template()).map_err(|error| error.to_string())?;
    }
    get_workspace_snapshot(root.to_string_lossy().to_string())
}

pub fn delete_workspace_file(workspace_root: String, file_path: String) -> Result<WorkspaceSnapshotDto, String> {
    let root = normalize_workspace_root(&workspace_root)?;
    let path = PathBuf::from(file_path);
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    get_workspace_snapshot(root.to_string_lossy().to_string())
}

fn workspace_files(root: &Path, daily_memory_dir: &Path) -> Result<Vec<WorkspaceFileRecord>, String> {
    let mut files = vec![
        file_record("claude", "CLAUDE.md", root.join("CLAUDE.md"))?,
        file_record("codex", "AGENTS.md", root.join("AGENTS.md"))?,
        file_record("gemini", "GEMINI.md", root.join("GEMINI.md"))?,
        file_record(
            "copilot",
            "copilot-instructions.md",
            root.join(".github").join("copilot-instructions.md"),
        )?,
    ];

    if daily_memory_dir.exists() {
        let mut daily_entries = fs::read_dir(daily_memory_dir)
            .map_err(|error| error.to_string())?
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("md"))
            .collect::<Vec<_>>();
        daily_entries.sort();

        for path in daily_entries {
            let title = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("memory.md")
                .to_string();
            files.push(file_record(
                "daily-memory",
                &title,
                path,
            )?);
        }
    }

    Ok(files)
}

fn file_record(kind: &str, title: &str, path: PathBuf) -> Result<WorkspaceFileRecord, String> {
    let exists = path.exists();
    let content = if exists {
        fs::read_to_string(&path).unwrap_or_default()
    } else {
        String::new()
    };
    Ok(WorkspaceFileRecord {
        id: format!("{}:{}", kind, path.to_string_lossy()),
        kind: kind.to_string(),
        title: title.to_string(),
        path: path.to_string_lossy().to_string(),
        exists,
        content,
    })
}

fn normalize_workspace_root(workspace_root: &str) -> Result<PathBuf, String> {
    let trimmed = workspace_root.trim();
    if trimmed.is_empty() {
        return Err("Workspace root is required".to_string());
    }
    let root = PathBuf::from(trimmed);
    if !root.exists() {
        return Err("Workspace root does not exist".to_string());
    }
    if !root.is_dir() {
        return Err("Workspace root must be a folder".to_string());
    }
    Ok(root)
}

fn today_file_name() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let days = now / 86_400;
    let (year, month, day) = epoch_days_to_ymd(days as i32);
    format!("{:04}-{:02}-{:02}.md", year, month, day)
}

fn today_template() -> String {
    "# Daily Memory\n\n## Decisions\n- \n\n## Risks\n- \n\n## Follow-ups\n- \n".to_string()
}

fn epoch_days_to_ymd(days: i32) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i32 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}