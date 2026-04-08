use crate::ai_platform::domain::skill::{SkillRecord, SkillRootRecord};
use crate::ai_platform::infrastructure::fs::skills_store::{load_store, save_store, SkillsStore};
use crate::ai_platform::interfaces::dto::skills::SkillsSnapshotDto;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

pub fn get_skills_snapshot() -> Result<SkillsSnapshotDto, String> {
    let store = load_store()?;
    build_snapshot(store)
}

pub fn add_skill_root(path: String) -> Result<SkillsSnapshotDto, String> {
    let normalized = normalize_root(&path)?;
    let mut store = load_store()?;

    if !store
        .roots
        .iter()
        .any(|root| PathBuf::from(&root.path) == normalized)
    {
        let label = normalized
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("skills-root")
            .to_string();
        store.roots.push(SkillRootRecord {
            id: stable_id(&normalized.to_string_lossy()),
            path: normalized.to_string_lossy().to_string(),
            label,
        });
        save_store(&store)?;
    }

    build_snapshot(store)
}

pub fn remove_skill_root(root_id: String) -> Result<SkillsSnapshotDto, String> {
    let mut store = load_store()?;
    store.roots.retain(|root| root.id != root_id);
    let root_prefixes = store.roots.iter().map(|root| root.id.clone()).collect::<Vec<_>>();
    store.disabled_skill_ids.retain(|skill_id| {
        root_prefixes
            .iter()
            .any(|root_prefix| skill_id.starts_with(root_prefix))
    });
    save_store(&store)?;
    build_snapshot(store)
}

pub fn set_skill_enabled(skill_id: String, enabled: bool) -> Result<SkillsSnapshotDto, String> {
    let mut store = load_store()?;
    if enabled {
        store.disabled_skill_ids.retain(|current| current != &skill_id);
    } else if !store.disabled_skill_ids.iter().any(|current| current == &skill_id) {
        store.disabled_skill_ids.push(skill_id);
    }
    save_store(&store)?;
    build_snapshot(store)
}

fn build_snapshot(store: SkillsStore) -> Result<SkillsSnapshotDto, String> {
    let mut skills = Vec::new();
    for root in &store.roots {
        let root_path = PathBuf::from(&root.path);
        if !root_path.exists() || !root_path.is_dir() {
            continue;
        }
        scan_skills_in_dir(&root_path, root, &store.disabled_skill_ids, &mut skills)?;
    }

    skills.sort_by(|left, right| left.name.cmp(&right.name).then(left.path.cmp(&right.path)));

    Ok(SkillsSnapshotDto {
        roots: store.roots,
        skills,
        source: "filesystem-scan".to_string(),
    })
}

fn scan_skills_in_dir(
    dir: &Path,
    root: &SkillRootRecord,
    disabled_skill_ids: &[String],
    skills: &mut Vec<SkillRecord>,
) -> Result<(), String> {
    if is_ignored_dir(dir) {
        return Ok(());
    }

    let entries = fs::read_dir(dir).map_err(|error| error.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            scan_skills_in_dir(&path, root, disabled_skill_ids, skills)?;
            continue;
        }

        if path.file_name().and_then(|value| value.to_str()) != Some("SKILL.md") {
            continue;
        }

        let content = fs::read_to_string(&path).unwrap_or_default();
        let directory = path.parent().unwrap_or(dir);
        let relative = directory
            .strip_prefix(PathBuf::from(&root.path))
            .ok()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .replace('\\', "/");
        let name = extract_title(&content)
            .or_else(|| directory.file_name().and_then(|value| value.to_str()).map(|value| value.to_string()))
            .unwrap_or_else(|| "Unnamed Skill".to_string());
        let skill_id = format!("{}:{}", root.id, relative);
        skills.push(SkillRecord {
            id: skill_id.clone(),
            root_id: root.id.clone(),
            name,
            description: extract_description(&content),
            path: directory.to_string_lossy().to_string(),
            skill_file: path.to_string_lossy().to_string(),
            enabled: !disabled_skill_ids.iter().any(|current| current == &skill_id),
        });
    }

    Ok(())
}

fn normalize_root(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Skills root path is required".to_string());
    }
    let normalized = PathBuf::from(trimmed);
    if !normalized.exists() {
        return Err("Skills root path does not exist".to_string());
    }
    if !normalized.is_dir() {
        return Err("Skills root path must be a folder".to_string());
    }
    Ok(normalized)
}

fn is_ignored_dir(path: &Path) -> bool {
    matches!(
        path.file_name().and_then(|value| value.to_str()),
        Some(".git" | "node_modules" | "target" | "dist" | "build" | ".next" | ".turbo")
    )
}

fn extract_title(content: &str) -> Option<String> {
    content.lines().find_map(|line| {
        let trimmed = line.trim();
        trimmed
            .strip_prefix("# ")
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

fn extract_description(content: &str) -> String {
    content
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with('#'))
        .unwrap_or("No description available")
        .to_string()
}

fn stable_id(value: &str) -> String {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    format!("root-{:x}", hasher.finish())
}