use crate::ai_platform::interfaces::dto::health::AiPlatformHealthDto;

#[tauri::command]
pub fn ai_platform_health() -> AiPlatformHealthDto {
    AiPlatformHealthDto {
        status: "ok".to_string(),
        frontend_root: "src/features/ai-platform".to_string(),
        backend_root: "src-tauri/src/ai_platform".to_string(),
        bridge_mode: "single-cutover-root".to_string(),
    }
}