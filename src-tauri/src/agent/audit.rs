use super::types::AgentAuditRecord;
use crate::database::Database;

pub fn save_audit(db: &Database, record: &AgentAuditRecord) -> Result<(), String> {
    let raw = serde_json::to_string(record).map_err(|e| e.to_string())?;
    db.save_agent_audit_raw(
        &record.id,
        &record.agent_session_id,
        &record.target_session_id,
        record.started_at,
        record.finished_at,
        &record.objective,
        &format!("{:?}", record.status),
        &raw,
    )
}
