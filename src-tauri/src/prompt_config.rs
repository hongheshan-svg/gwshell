use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

// ============================================================================
// Prompt file management for AI CLI tools
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptFile {
    pub tool: String,        // "claude" | "codex" | "gemini"
    pub filename: String,    // "CLAUDE.md" | "AGENTS.md" | "GEMINI.md"
    pub content: String,
    pub exists: bool,
    pub path: String,
}

/// Get the standard prompt file path for a given tool in a project directory
fn prompt_file_for_tool(tool: &str, project_dir: &str) -> Option<(String, PathBuf)> {
    let dir = PathBuf::from(project_dir);
    match tool {
        "claude" => Some(("CLAUDE.md".to_string(), dir.join("CLAUDE.md"))),
        "codex" => Some(("AGENTS.md".to_string(), dir.join("AGENTS.md"))),
        "gemini" => Some(("GEMINI.md".to_string(), dir.join("GEMINI.md"))),
        _ => None,
    }
}

// ============================================================================
// Tauri commands
// ============================================================================

/// List prompt files in a project directory
#[tauri::command]
pub fn list_prompt_files(project_dir: String) -> Result<Vec<PromptFile>, String> {
    let tools = ["claude", "codex", "gemini"];
    let mut results = Vec::new();

    for tool in &tools {
        if let Some((filename, path)) = prompt_file_for_tool(tool, &project_dir) {
            let exists = path.exists();
            let content = if exists {
                fs::read_to_string(&path).unwrap_or_default()
            } else {
                String::new()
            };
            results.push(PromptFile {
                tool: tool.to_string(),
                filename,
                content,
                exists,
                path: path.to_string_lossy().to_string(),
            });
        }
    }

    Ok(results)
}

/// Read a specific prompt file
#[tauri::command]
pub fn read_prompt_file(file_path: String) -> Result<String, String> {
    fs::read_to_string(&file_path).map_err(|e| format!("Read failed: {}", e))
}

/// Write a prompt file
#[tauri::command]
pub fn write_prompt_file(file_path: String, content: String) -> Result<(), String> {
    fs::write(&file_path, &content).map_err(|e| format!("Write failed: {}", e))
}

/// Sync prompt content from one tool to others in the same project directory
#[tauri::command]
pub fn sync_prompt_files(
    project_dir: String,
    source_tool: String,
    target_tools: Vec<String>,
    content: String,
) -> Result<Vec<String>, String> {
    let mut synced = Vec::new();

    for tool in &target_tools {
        if tool == &source_tool { continue; }
        if let Some((filename, path)) = prompt_file_for_tool(tool, &project_dir) {
            fs::write(&path, &content)
                .map_err(|e| format!("Write {} failed: {}", filename, e))?;
            synced.push(filename);
        }
    }

    Ok(synced)
}

/// Get prompt templates
#[tauri::command]
pub fn get_prompt_templates() -> Vec<(String, String, String)> {
    vec![
        (
            "general".to_string(),
            "General Project Instructions".to_string(),
            r#"# Project Instructions

## Code Style
- Use TypeScript for all frontend code
- Follow existing naming conventions
- Keep functions small and focused

## Architecture
- React functional components with hooks
- Zustand for state management
- Tauri for backend/system calls

## Testing
- Write tests for critical business logic
- Use descriptive test names
"#.to_string(),
        ),
        (
            "rust-project".to_string(),
            "Rust Project Instructions".to_string(),
            r#"# Rust Project Instructions

## Style
- Follow Rust 2021 edition conventions
- Use `thiserror` for error types
- Prefer `Result<T, E>` over panics
- Document public APIs with doc comments

## Architecture
- Keep modules focused and small
- Use traits for abstraction
- Prefer composition over inheritance
"#.to_string(),
        ),
        (
            "fullstack".to_string(),
            "Full-Stack Instructions".to_string(),
            r#"# Full-Stack Project

## Frontend
- React 19 with TypeScript
- Functional components, hooks only
- CSS Modules or CSS-in-JS

## Backend
- Rust with Tauri 2
- SQLite for persistence
- Async where possible

## General
- Keep PRs small and focused
- Write meaningful commit messages
"#.to_string(),
        ),
    ]
}
