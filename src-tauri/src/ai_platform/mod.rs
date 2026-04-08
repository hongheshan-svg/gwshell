//! Canonical AI platform namespace.
//! The legacy `ai_config`, `mcp_config`, `prompt_config`, and `usage_tracker`
//! modules are migration inputs only and should not be expanded further.

pub mod application;
pub mod domain;
pub mod infrastructure;
pub mod interfaces;
pub mod runtime {
    pub mod bootstrap;
    pub mod background_jobs;
    pub mod state;
}