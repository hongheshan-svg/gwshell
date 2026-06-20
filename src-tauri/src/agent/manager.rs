use super::types::{AgentSessionInfo, AgentSessionStart, AgentSessionStatus};
use parking_lot::Mutex;
use std::collections::{HashMap, VecDeque};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

#[cfg(not(test))]
const MAX_RETAINED_CANCELLED_SESSIONS: usize = 100;
#[cfg(test)]
const MAX_RETAINED_CANCELLED_SESSIONS: usize = 2;

#[derive(Default)]
pub struct AgentManager {
    sessions: Mutex<HashMap<String, AgentSessionInfo>>,
    cancelled_order: Mutex<VecDeque<String>>,
}

impl AgentManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn event_name(kind: &str, agent_session_id: &str) -> String {
        format!("agent-{}-{}", kind, agent_session_id)
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
        let mut sessions = self.sessions.lock();
        let Some(info) = sessions.get_mut(agent_session_id) else {
            return false;
        };

        let was_cancelled = info.status == AgentSessionStatus::Cancelled;
        info.status = AgentSessionStatus::Cancelled;

        if !was_cancelled {
            let mut cancelled_order = self.cancelled_order.lock();
            cancelled_order.push_back(agent_session_id.to_string());
            prune_cancelled_sessions(&mut sessions, &mut cancelled_order);
        }

        true
    }
}

pub fn event_name(kind: &str, agent_session_id: &str) -> String {
    AgentManager::event_name(kind, agent_session_id)
}

fn prune_cancelled_sessions(
    sessions: &mut HashMap<String, AgentSessionInfo>,
    cancelled_order: &mut VecDeque<String>,
) {
    while cancelled_order.len() > MAX_RETAINED_CANCELLED_SESSIONS {
        let Some(oldest_id) = cancelled_order.pop_front() else {
            break;
        };
        if sessions
            .get(&oldest_id)
            .is_some_and(|info| info.status == AgentSessionStatus::Cancelled)
        {
            sessions.remove(&oldest_id);
        }
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
    }

    #[test]
    fn cancel_marks_stored_session_cancelled_and_repeated_cancel_returns_true() {
        let manager = AgentManager::new();
        let info = manager.start_session(AgentSessionStart {
            target_session_id: "ssh-1".into(),
            objective: "inspect disk".into(),
            autonomy: AgentAutonomyLevel::Observe,
        });

        assert!(manager.cancel_session(&info.id));

        assert_eq!(
            manager
                .sessions
                .lock()
                .get(&info.id)
                .map(|info| info.status),
            Some(AgentSessionStatus::Cancelled)
        );
        assert!(manager.cancel_session(&info.id));
        assert!(!manager.cancel_session("missing"));
    }

    #[test]
    fn cancelled_session_retention_prunes_oldest_cancelled_sessions() {
        let manager = AgentManager::new();
        let mut ids = Vec::new();

        for idx in 0..=MAX_RETAINED_CANCELLED_SESSIONS {
            let info = manager.start_session(AgentSessionStart {
                target_session_id: format!("ssh-{}", idx),
                objective: "inspect disk".into(),
                autonomy: AgentAutonomyLevel::Observe,
            });
            assert!(manager.cancel_session(&info.id));
            ids.push(info.id);
        }

        let sessions = manager.sessions.lock();
        assert!(!sessions.contains_key(&ids[0]));
        assert_eq!(sessions.len(), MAX_RETAINED_CANCELLED_SESSIONS);
        for id in ids.iter().skip(1) {
            assert_eq!(
                sessions.get(id).map(|info| info.status),
                Some(AgentSessionStatus::Cancelled)
            );
        }
    }

    #[test]
    fn event_name_scopes_event_kind_to_agent_session() {
        assert_eq!(
            AgentManager::event_name("evidence", "agent-1"),
            "agent-evidence-agent-1"
        );
        assert_eq!(
            event_name("analysis-delta", "agent-1"),
            "agent-analysis-delta-agent-1"
        );
    }
}
