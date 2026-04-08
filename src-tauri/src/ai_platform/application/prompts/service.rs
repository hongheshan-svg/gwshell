use crate::ai_platform::domain::prompt::{PromptFileRecord, PromptTemplateRecord};
use crate::ai_platform::interfaces::dto::prompts::{PromptSnapshotDto, PromptSyncResultDto};
use std::fs;
use std::path::{Path, PathBuf};

pub fn get_prompt_snapshot(project_dir: String) -> Result<PromptSnapshotDto, String> {
    let normalized = normalize_project_dir(&project_dir)?;
    let files = list_prompt_files(&normalized)?;

    Ok(PromptSnapshotDto {
        project_dir: normalized.to_string_lossy().to_string(),
        files,
        templates: prompt_templates(),
    })
}

pub fn write_prompt_file(file_path: String, content: String) -> Result<(), String> {
    let path = PathBuf::from(file_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, content).map_err(|error| error.to_string())
}

pub fn sync_prompt_files(
    project_dir: String,
    source_tool: String,
    target_tools: Vec<String>,
    content: String,
) -> Result<PromptSyncResultDto, String> {
    let normalized = normalize_project_dir(&project_dir)?;
    let mut synced_tools = Vec::new();
    let mut synced_files = Vec::new();

    for tool in target_tools {
        if tool == source_tool {
            continue;
        }

        let (filename, path) = prompt_file_for_tool(&tool, &normalized)
            .ok_or_else(|| format!("Unsupported prompt tool: {tool}"))?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(&path, &content).map_err(|error| format!("Write {filename} failed: {error}"))?;
        synced_tools.push(tool);
        synced_files.push(filename);
    }

    let synced_count = synced_files.len();

    Ok(PromptSyncResultDto {
        source_tool,
        synced_tools,
        synced_files,
        message: format!("Synced {} prompt file(s)", synced_count),
    })
}

fn list_prompt_files(project_dir: &Path) -> Result<Vec<PromptFileRecord>, String> {
    let tools = ["claude", "codex", "gemini"];
    let mut results = Vec::new();

    for tool in tools {
        let Some((filename, path)) = prompt_file_for_tool(tool, project_dir) else {
            continue;
        };
        let exists = path.exists();
        let content = if exists {
            fs::read_to_string(&path).unwrap_or_default()
        } else {
            String::new()
        };

        results.push(PromptFileRecord {
            tool: tool.to_string(),
            filename,
            content,
            exists,
            path: path.to_string_lossy().to_string(),
        });
    }

    Ok(results)
}

fn normalize_project_dir(project_dir: &str) -> Result<PathBuf, String> {
    let trimmed = project_dir.trim();
    if trimmed.is_empty() {
        return Err("Project directory is required".to_string());
    }

    let path = PathBuf::from(trimmed);
    if !path.exists() {
        return Err("Project directory does not exist".to_string());
    }
    if !path.is_dir() {
        return Err("Project directory must be a folder".to_string());
    }
    Ok(path)
}

fn prompt_file_for_tool(tool: &str, project_dir: &Path) -> Option<(String, PathBuf)> {
    match tool {
        "claude" => Some(("CLAUDE.md".to_string(), project_dir.join("CLAUDE.md"))),
        "codex" => Some(("AGENTS.md".to_string(), project_dir.join("AGENTS.md"))),
        "gemini" => Some(("GEMINI.md".to_string(), project_dir.join("GEMINI.md"))),
        _ => None,
    }
}

fn prompt_templates() -> Vec<PromptTemplateRecord> {
    vec![
        PromptTemplateRecord {
            id: "general".to_string(),
            name: "General Project Instructions".to_string(),
            content: r#"# Project Instructions

## Code Style
- Keep changes focused and minimal
- Follow the repository's existing conventions
- Prefer clear names over clever abstractions

## Architecture
- Preserve current module boundaries
- Fix root causes instead of adding compatibility patches
- Keep UI state and persisted state clearly separated

## Quality
- Run the smallest useful validation after each change
- Avoid unrelated refactors while implementing a feature
"#
            .to_string(),
        },
        PromptTemplateRecord {
            id: "rust-tauri".to_string(),
            name: "Rust + Tauri Workspace".to_string(),
            content: r#"# Rust + Tauri Instructions

## Backend
- Prefer application/domain/infrastructure separation
- Use serde DTOs at the interface layer
- Return actionable error messages from Tauri commands

## Frontend
- Use React function components and typed command wrappers
- Keep feature code inside the domain boundary
- Reuse existing AI platform styles before adding new ones
"#
            .to_string(),
        },
        PromptTemplateRecord {
            id: "review-mode".to_string(),
            name: "Review and Safety".to_string(),
            content: r#"# Review Mode

## Priority
- Identify regressions and risky edge cases first
- Call out missing validation and sync behavior
- Keep summaries brief and focused on impact

## Constraints
- Do not revert unrelated local changes
- Prefer precise edits over large rewrites
"#
            .to_string(),
        },
    ]
}