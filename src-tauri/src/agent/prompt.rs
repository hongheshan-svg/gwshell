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
        "Objective:\n{}\n\nEvidence JSON:\n{}\n\nLocal rule findings JSON:\n{}\n\nReturn concise streamed analysis and a final JSON update.",
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
        assert!(prompt.contains("final JSON update"));
    }
}
