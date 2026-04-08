use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPlatformHealthDto {
    pub status: String,
    pub frontend_root: String,
    pub backend_root: String,
    pub bridge_mode: String,
}