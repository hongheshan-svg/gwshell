use super::types::{AgentEvidence, AgentFinding};

pub const AGENT_SYSTEM_PROMPT: &str = r#"You are operating inside GWShell Agent.
You cannot execute commands directly.
Every factual claim must cite evidence IDs.
Separate confirmed findings from hypotheses.
Ask for missing evidence instead of guessing.
Propose tool calls only from the allowed schema.
Prefer reversible, low-risk actions.
For high-risk actions, explain risk and ask for human approval.
Never request secrets, private keys, tokens, shell history, or full config dumps."#;

pub fn build_user_prompt(
    objective: &str,
    evidence: &[AgentEvidence],
    findings: &[AgentFinding],
) -> String {
    let evidence_json = serde_json::to_string(evidence).unwrap_or_else(|_| "[]".to_string());
    let findings_json = serde_json::to_string(findings).unwrap_or_else(|_| "[]".to_string());
    format!(
        "Objective:\n{}\n\nEvidence JSON:\n{}\n\nLocal rule findings JSON:\n{}\n\nReturn concise streamed analysis, then a final JSON object with exactly these keys: summary, findings, proposed_actions, questions.",
        objective, evidence_json, findings_json
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::types::{AgentEvidence, AgentFinding};

    #[test]
    fn system_prompt_blocks_direct_execution() {
        assert!(AGENT_SYSTEM_PROMPT.contains("cannot execute commands directly"));
        assert!(AGENT_SYSTEM_PROMPT.contains("evidence IDs"));
    }

    #[test]
    fn system_prompt_requires_approval_and_blocks_sensitive_requests() {
        assert!(AGENT_SYSTEM_PROMPT.contains("high-risk actions"));
        assert!(AGENT_SYSTEM_PROMPT.contains("human approval"));
        assert!(AGENT_SYSTEM_PROMPT.contains("Never request secrets"));
        assert!(AGENT_SYSTEM_PROMPT.contains("shell history"));
        assert!(AGENT_SYSTEM_PROMPT.contains("full config dumps"));
    }

    #[test]
    fn user_prompt_includes_objective_evidence_and_findings() {
        let evidence = vec![AgentEvidence {
            id: "ev-1".to_string(),
            source: "terminal".to_string(),
            label: "Disk usage".to_string(),
            body: "/ is 90% full".to_string(),
            created_at: 1_718_000_000,
        }];
        let findings = vec![AgentFinding {
            id: "finding-1".to_string(),
            title: "Root disk is nearly full".to_string(),
            severity: "medium".to_string(),
            confidence: "confirmed".to_string(),
            evidence_ids: vec!["ev-1".to_string()],
        }];

        let prompt = build_user_prompt("Investigate disk pressure", &evidence, &findings);

        assert!(prompt.contains("Objective:\nInvestigate disk pressure"));
        assert!(prompt.contains("Evidence JSON:"));
        assert!(prompt.contains("\"id\":\"ev-1\""));
        assert!(prompt.contains("Local rule findings JSON:"));
        assert!(prompt.contains("\"evidence_ids\":[\"ev-1\"]"));
        assert!(prompt.contains("final JSON object"));
    }

    #[test]
    fn user_prompt_defines_final_update_json_keys() {
        let prompt = build_user_prompt("Investigate disk pressure", &[], &[]);

        assert!(prompt.contains("final JSON object"));
        assert!(prompt.contains("summary"));
        assert!(prompt.contains("findings"));
        assert!(prompt.contains("proposed_actions"));
        assert!(prompt.contains("questions"));
    }
}
