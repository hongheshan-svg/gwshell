export type AgentAutonomyLevel = 'observe' | 'recommend' | 'confirmed_act' | 'policy_auto_maintain';
export type AgentRisk = 'read_only' | 'low' | 'medium' | 'high' | 'blocked';
export type AgentToolName = 'run_command' | 'stream_log' | 'read_file' | 'docker_logs' | 'restart_service';
export type AgentSessionStatus = 'running' | 'completed' | 'cancelled' | 'failed';

export interface AiProviderSettings {
  enabled: boolean;
  provider: 'openai_compatible' | 'anthropic_compatible' | 'ollama';
  base_url: string;
  model: string;
  api_key_configured: boolean;
  temperature: number;
  max_input_chars: number;
  request_timeout_secs: number;
}

export interface AgentPolicySettings {
  auto_continue_enabled: boolean;
  live_log_auto_analysis: boolean;
  max_auto_continuations: number;
  auto_execute_read_only: boolean;
  auto_execute_low_risk: boolean;
  auto_execute_command_allowlist: string[];
  auto_execute_service_denylist: string[];
  maintenance_window_enabled: boolean;
  maintenance_window_start: string;
  maintenance_window_end: string;
  log_filter_enabled: boolean;
  log_interest_keywords: string[];
  disk_alert_percent: number;
  memory_alert_percent: number;
  alert_auto_start_agent: boolean;
}

export interface AgentSessionStart {
  target_session_id: string;
  objective: string;
  autonomy: AgentAutonomyLevel;
}

export interface AgentSessionInfo extends AgentSessionStart {
  id: string;
  started_at: number;
  status: AgentSessionStatus;
}

export interface AgentEvidence {
  id: string;
  source: string;
  label: string;
  body: string;
  created_at: number;
}

export interface AgentFinding {
  id: string;
  title: string;
  severity: string;
  confidence: string;
  evidence_ids: string[];
}

export interface AgentToolCall {
  id: string;
  tool: AgentToolName;
  target_session_id: string;
  payload: Record<string, unknown>;
  risk: AgentRisk;
  reason: string;
  expected_result?: string | null;
  verify?: AgentToolCall | null;
}

export interface AgentToolResult {
  call_id: string;
  ok: boolean;
  output: string;
  error?: string | null;
  verification?: AgentToolResult | null;
}

export interface AgentAnalysisUpdate {
  summary: string;
  findings: AgentFinding[];
  proposed_actions: AgentToolCall[];
  questions: string[];
}

export interface AgentContinuationRequest {
  agent_session_id: string;
  evidence: AgentEvidence[];
  latest_update?: AgentAnalysisUpdate | null;
  results: AgentToolResult[];
}

export interface TerminalAiChatRequest {
  request_id: string;
  tab_id: string;
  target_session_id: string;
  tab_title: string;
  question: string;
  cwd?: string | null;
  prompt?: string | null;
  selected_text?: string | null;
  recent_output?: string | null;
}

export interface AgentAuditRecord {
  id: string;
  agent_session_id: string;
  target_session_id: string;
  started_at: number;
  finished_at?: number | null;
  objective: string;
  status: AgentSessionStatus;
  report_json: string;
}
