use super::types::{AgentSessionInfo, AgentSessionStart, AgentSessionStatus};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

#[derive(Default)]
pub struct AgentManager {
    sessions: Mutex<HashMap<String, AgentSessionInfo>>,
}

impl AgentManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn start_session(&self, req: AgentSessionStart) -> AgentSessionInfo {
        let info = AgentSessionInfo {
            id: Uuid::new_v4().to_string(),
            target_session_id: req.target_session_id,
            objective: req.objective,
            autonomy: req.autonomy,
            started_at: now_secs(),
            status: AgentSessionStatus::Running,
        };
        self.sessions.lock().insert(info.id.clone(), info.clone());
        info
    }

    pub fn cancel_session(&self, agent_session_id: &str) -> bool {
        self.sessions.lock().remove(agent_session_id).is_some()
    }
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::types::{AgentAutonomyLevel, AgentSessionStart, AgentSessionStatus};

    #[test]
    fn manager_starts_and_cancels_session() {
        let manager = AgentManager::new();
        let request = AgentSessionStart {
            target_session_id: "ssh-1".into(),
            objective: "inspect disk".into(),
            autonomy: AgentAutonomyLevel::Observe,
        };

        let info = manager.start_session(request);

        assert!(!info.id.is_empty());
        assert_eq!(info.target_session_id, "ssh-1");
        assert_eq!(info.objective, "inspect disk");
        assert_eq!(info.autonomy, AgentAutonomyLevel::Observe);
        assert!(info.started_at > 0);
        assert_eq!(info.status, AgentSessionStatus::Running);
        assert!(manager.cancel_session(&info.id));
        assert!(!manager.cancel_session(&info.id));
        assert!(!manager.cancel_session("missing"));
    }
}
