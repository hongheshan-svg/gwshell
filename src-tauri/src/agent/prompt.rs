use super::types::{
    AgentAnalysisUpdate, AgentEvidence, AgentFinding, AgentToolResult, TerminalAiChatRequest,
};

pub const AGENT_SYSTEM_PROMPT: &str = r#"You are operating inside GWShell Agent.
You cannot execute commands directly.
Every factual claim must cite evidence IDs.
Separate confirmed findings from hypotheses.
Ask for missing evidence instead of guessing.
Propose tool calls only from the allowed schema.
Prefer reversible, low-risk actions.
For high-risk actions, explain risk and ask for human approval.
Never request secrets, private keys, tokens, shell history, or full config dumps."#;

const TOOL_SCHEMA_PROMPT: &str = r#"Allowed tool calls:
- run_command payload: {"command":"df -hP /"} for read-only or low/medium maintenance commands.
- stream_log payload: {"path":"/var/log/app.log","lines":200} or {"unit":"nginx.service","lines":200} for log snapshots.
- read_file payload: {"path":"/var/log/app.conf","lines":200} for non-secret files only.
- docker_logs payload: {"container":"name-or-id","lines":200}.
- restart_service payload: {"service":"nginx.service"} only when restart is justified.

Final JSON schema:
{
  "summary": "short summary with evidence ids",
  "findings": [{"id":"finding-1","title":"...","severity":"low|medium|high","confidence":"confirmed|likely|hypothesis","evidence_ids":["..."]}],
  "proposed_actions": [{"id":"action-1","tool":"run_command","target_session_id":"","payload":{},"risk":"read_only","reason":"...","expected_result":"...","verify":null}],
  "questions": ["only ask if more evidence or approval is required"]
}
GWShell will overwrite target_session_id and recompute risk locally."#;

pub fn build_user_prompt(
    objective: &str,
    evidence: &[AgentEvidence],
    findings: &[AgentFinding],
) -> String {
    let evidence_json = serde_json::to_string(evidence).unwrap_or_else(|_| "[]".to_string());
    let findings_json = serde_json::to_string(findings).unwrap_or_else(|_| "[]".to_string());
    format!(
        "Objective:\n{}\n\nEvidence JSON:\n{}\n\nLocal rule findings JSON:\n{}\n\n{}\n\nReturn concise streamed analysis, then one final JSON object with exactly these keys: summary, findings, proposed_actions, questions.",
        objective, evidence_json, findings_json, TOOL_SCHEMA_PROMPT
    )
}

pub fn build_continuation_prompt(
    objective: &str,
    evidence: &[AgentEvidence],
    previous_update: Option<&AgentAnalysisUpdate>,
    results: &[AgentToolResult],
) -> String {
    let evidence_json = serde_json::to_string(evidence).unwrap_or_else(|_| "[]".to_string());
    let previous_json = previous_update
        .and_then(|update| serde_json::to_string(update).ok())
        .unwrap_or_else(|| "null".to_string());
    let results_json = serde_json::to_string(results).unwrap_or_else(|_| "[]".to_string());
    format!(
        "Continuation objective:\n{}\n\nEvidence JSON:\n{}\n\nPrevious analysis JSON:\n{}\n\nTool results JSON:\n{}\n\n{}\n\nContinue analysis from the new tool results. Return concise streamed analysis, then one final JSON object with exactly these keys: summary, findings, proposed_actions, questions.",
        objective, evidence_json, previous_json, results_json, TOOL_SCHEMA_PROMPT
    )
}

pub fn build_terminal_ai_chat_prompt(request: &TerminalAiChatRequest) -> String {
    let cwd = request.cwd.as_deref().unwrap_or("unknown");
    let prompt = request.prompt.as_deref().unwrap_or("unknown");
    let selected_text = request.selected_text.as_deref().unwrap_or("").trim();
    let recent_output = request.recent_output.as_deref().unwrap_or("").trim();
    format!(
        "You are helping a user troubleshoot a terminal session in GWShell.\n\
Do not execute commands. Do not claim that you changed the server. Do not ask for secrets, private keys, tokens, or full shell history.\n\
Explain likely causes, suggest safe verification commands, and mark risky commands clearly.\n\
When you suggest commands, put each command in a bash fenced code block so GWShell can offer one-click insertion.\n\n\
Terminal tab: {}\n\
Target session id: {}\n\
Current working directory: {}\n\
Shell prompt: {}\n\n\
Selected terminal text:\n{}\n\n\
Recent terminal output:\n{}\n\n\
User question:\n{}\n\n\
Answer in the user's language. Be concise, practical, and command-line focused.",
        request.tab_title,
        request.target_session_id,
        cwd,
        prompt,
        if selected_text.is_empty() {
            "(none)"
        } else {
            selected_text
        },
        if recent_output.is_empty() {
            "(none)"
        } else {
            recent_output
        },
        request.question.trim()
    )
}

pub fn extract_final_analysis_update(text: &str) -> Option<AgentAnalysisUpdate> {
    extract_json_object_candidates(text)
        .into_iter()
        .rev()
        .find_map(|candidate| serde_json::from_str::<AgentAnalysisUpdate>(candidate).ok())
}

fn extract_json_object_candidates(text: &str) -> Vec<&str> {
    let mut candidates = Vec::new();
    let mut start: Option<usize> = None;
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;

    for (idx, ch) in text.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '{' => {
                if depth == 0 {
                    start = Some(idx);
                }
                depth += 1;
            }
            '}' if depth > 0 => {
                depth -= 1;
                if depth == 0 {
                    if let Some(start_idx) = start.take() {
                        candidates.push(&text[start_idx..idx + ch.len_utf8()]);
                    }
                }
            }
            _ => {}
        }
    }

    candidates
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::types::{
        AgentEvidence, AgentFinding, AgentRisk, AgentToolCall, AgentToolName, AgentToolResult,
    };

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
        assert!(prompt.contains("Allowed tool calls"));
        assert!(prompt.contains("stream_log payload"));
    }

    #[test]
    fn extracts_last_valid_analysis_update_from_streamed_text() {
        let action = AgentToolCall {
            id: "action-1".into(),
            tool: AgentToolName::RunCommand,
            target_session_id: "ssh-1".into(),
            payload: serde_json::json!({ "command": "df -hP /" }),
            risk: AgentRisk::ReadOnly,
            reason: "inspect disk".into(),
            expected_result: None,
            verify: None,
        };
        let update = AgentAnalysisUpdate {
            summary: "Disk looks healthy".into(),
            findings: vec![],
            proposed_actions: vec![action],
            questions: vec![],
        };
        let text = format!(
            "analysis before JSON\n```json\n{}\n```\n",
            serde_json::to_string(&update).unwrap()
        );

        let parsed = extract_final_analysis_update(&text).unwrap();

        assert_eq!(parsed.summary, "Disk looks healthy");
        assert_eq!(parsed.proposed_actions.len(), 1);
    }

    #[test]
    fn ignores_braces_inside_json_strings_when_extracting_update() {
        let text = r#"notes {not json}
{"summary":"contains { braces } in string","findings":[],"proposed_actions":[],"questions":[]}"#;

        let parsed = extract_final_analysis_update(text).unwrap();

        assert_eq!(parsed.summary, "contains { braces } in string");
    }

    #[test]
    fn continuation_prompt_includes_action_results_and_previous_summary() {
        let result = AgentToolResult {
            call_id: "action-1".into(),
            ok: true,
            output: "nginx is active".into(),
            error: None,
            verification: None,
        };
        let update = AgentAnalysisUpdate {
            summary: "Need to verify nginx".into(),
            findings: vec![],
            proposed_actions: vec![],
            questions: vec![],
        };

        let prompt = build_continuation_prompt("Fix 502", &[], Some(&update), &[result]);

        assert!(prompt.contains("Continuation objective:\nFix 502"));
        assert!(prompt.contains("Previous analysis JSON:"));
        assert!(prompt.contains("Need to verify nginx"));
        assert!(prompt.contains("Tool results JSON:"));
        assert!(prompt.contains("nginx is active"));
        assert!(prompt.contains("Continue analysis"));
    }

    #[test]
    fn terminal_ai_chat_prompt_includes_context_and_blocks_auto_execution() {
        let request = crate::agent::types::TerminalAiChatRequest {
            request_id: "terminal-ai-1".into(),
            tab_id: "tab-1".into(),
            target_session_id: "ssh-1".into(),
            tab_title: "prod-api".into(),
            question: "Why did this command fail?".into(),
            cwd: Some("/root".into()),
            prompt: Some("root@gw-link:~#".into()),
            selected_text: Some("systemctl status nginx\nfailed".into()),
            recent_output: Some("nginx.service failed with exit-code".into()),
        };

        let prompt = build_terminal_ai_chat_prompt(&request);

        assert!(prompt.contains("User question:\nWhy did this command fail?"));
        assert!(prompt.contains("Current working directory: /root"));
        assert!(prompt.contains("Shell prompt: root@gw-link:~#"));
        assert!(prompt.contains("Selected terminal text:"));
        assert!(prompt.contains("nginx.service failed with exit-code"));
        assert!(prompt.contains("Do not execute commands"));
        assert!(prompt.contains("bash fenced code block"));
    }
}
