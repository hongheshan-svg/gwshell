use super::prompt::{build_continuation_prompt, extract_final_analysis_update};
use super::types::{AgentEvidence, AgentToolResult};

pub fn run_mock_agent_e2e(model_response: &str) -> Result<String, String> {
    let evidence = vec![AgentEvidence {
        id: "ev-mock-disk".into(),
        source: "mock".into(),
        label: "Mock disk probe".into(),
        body: "/ is 95% full".into(),
        created_at: 1,
    }];
    let update = extract_final_analysis_update(model_response)
        .ok_or_else(|| "mock model response missing final JSON".to_string())?;
    let result = AgentToolResult {
        call_id: update
            .proposed_actions
            .first()
            .map(|action| action.id.clone())
            .unwrap_or_else(|| "mock-action".into()),
        ok: true,
        output: "Filesystem / now has enough free space".into(),
        error: None,
        verification: None,
    };
    Ok(build_continuation_prompt(
        "mock disk cleanup",
        &evidence,
        Some(&update),
        &[result],
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_agent_e2e_builds_continuation_from_model_action_and_result() {
        let response = r#"
analysis
{"summary":"Root disk is high using ev-mock-disk","findings":[],"proposed_actions":[{"id":"action-1","tool":"run_command","target_session_id":"","payload":{"command":"df -hP /"},"risk":"read_only","reason":"verify disk","expected_result":"disk usage","verify":null}],"questions":[]}
"#;

        let prompt = run_mock_agent_e2e(response).unwrap();

        assert!(prompt.contains("mock disk cleanup"));
        assert!(prompt.contains("Root disk is high"));
        assert!(prompt.contains("Filesystem / now has enough free space"));
    }
}
