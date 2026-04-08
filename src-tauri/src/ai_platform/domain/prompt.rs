use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptFileRecord {
	pub tool: String,
	pub filename: String,
	pub content: String,
	pub exists: bool,
	pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptTemplateRecord {
	pub id: String,
	pub name: String,
	pub content: String,
}