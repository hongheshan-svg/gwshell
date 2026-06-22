use super::types::AgentPolicySettings;
use crate::database::Database;

const SETTINGS_KEY: &str = "agent_policy_settings";

pub fn load_settings(db: &Database) -> Result<AgentPolicySettings, String> {
    match db.load_app_setting_key(SETTINGS_KEY)? {
        Some(raw) => Ok(serde_json::from_str::<AgentPolicySettings>(&raw).unwrap_or_default()),
        None => Ok(AgentPolicySettings::default()),
    }
}

pub fn save_settings(db: &Database, settings: AgentPolicySettings) -> Result<(), String> {
    let raw = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
    db.save_app_setting_key(SETTINGS_KEY, &raw)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Database {
        Database::new_in_memory_for_tests().unwrap()
    }

    #[test]
    fn load_defaults_when_policy_not_saved() {
        let db = db();

        let settings = load_settings(&db).unwrap();

        assert!(settings.auto_continue_enabled);
        assert!(settings.live_log_auto_analysis);
        assert_eq!(settings.max_auto_continuations, 8);
    }

    #[test]
    fn save_and_load_policy_settings() {
        let db = db();
        let settings = AgentPolicySettings {
            auto_continue_enabled: false,
            live_log_auto_analysis: false,
            max_auto_continuations: 3,
            auto_execute_read_only: true,
            auto_execute_low_risk: false,
            ..AgentPolicySettings::default()
        };

        save_settings(&db, settings).unwrap();
        let loaded = load_settings(&db).unwrap();

        assert!(!loaded.auto_continue_enabled);
        assert!(!loaded.live_log_auto_analysis);
        assert_eq!(loaded.max_auto_continuations, 3);
        assert!(!loaded.auto_execute_low_risk);
    }
}
