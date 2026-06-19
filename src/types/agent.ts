export type AgentAutonomyLevel = 'observe' | 'recommend' | 'confirmed_act' | 'policy_auto_maintain';
export type AgentRisk = 'read_only' | 'low' | 'medium' | 'high' | 'blocked';
export type AgentToolName = 'run_command' | 'stream_log' | 'read_file' | 'docker_logs' | 'restart_service';
export type AgentSessionStatus = 'running' | 'completed' | 'cancelled' | 'failed';

export interface AiProviderSettings {
  enabled: boolean;
  provider: 'openai_compatible';
  base_url: string;
  model: string;
  api_key_configured: boolean;
  temperature: number;
  max_input_chars: number;
  request_timeout_secs: number;
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
  expected_result?: string;
  verify?: AgentToolCall;
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
