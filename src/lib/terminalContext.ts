export interface TerminalAiContext {
  tabId: string;
  cwd?: string;
  prompt?: string;
  selectedText?: string;
  recentOutput?: string;
}

const MAX_RECENT_OUTPUT_CHARS = 12000;
const contexts = new Map<string, TerminalAiContext>();

const ensureContext = (tabId: string): TerminalAiContext => {
  const existing = contexts.get(tabId);
  if (existing) return existing;
  const created: TerminalAiContext = { tabId };
  contexts.set(tabId, created);
  return created;
};

const stripAnsi = (text: string) =>
  text.replace(/\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g, '');

export const setTerminalCwd = (tabId: string, cwd: string) => {
  ensureContext(tabId).cwd = cwd;
};

export const setTerminalPrompt = (tabId: string, prompt: string) => {
  ensureContext(tabId).prompt = prompt;
};

export const setTerminalSelection = (tabId: string, selectedText: string) => {
  ensureContext(tabId).selectedText = selectedText;
};

export const appendTerminalOutput = (tabId: string, payload: string) => {
  const clean = stripAnsi(payload).replace(/\r/g, '');
  if (!clean) return;
  const context = ensureContext(tabId);
  const next = `${context.recentOutput ?? ''}${clean}`;
  context.recentOutput =
    next.length > MAX_RECENT_OUTPUT_CHARS ? next.slice(next.length - MAX_RECENT_OUTPUT_CHARS) : next;
  const lines = context.recentOutput.split('\n').map((line) => line.trim()).filter(Boolean);
  const maybePrompt = [...lines].reverse().find((line) => /[$#>]\s*$/.test(line));
  if (maybePrompt) context.prompt = maybePrompt.slice(-120);
};

export const getTerminalAiContext = (tabId: string): TerminalAiContext => ({
  tabId,
  ...(contexts.get(tabId) ?? {}),
});

export const clearTerminalAiContext = (tabId: string) => {
  contexts.delete(tabId);
};
