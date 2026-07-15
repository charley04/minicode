export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>, ctx?: ToolContext) => Promise<ToolResult>;
  requirePermission: boolean;
}

export interface ToolContext {
  signal?: AbortSignal;
}

export type ApprovalDecision = "once" | "always" | "deny" | "stop";

export interface ToolResult {
  /** Text sent back to the LLM. Should be plain (no ANSI, no huge diffs). */
  output: string;
  /** Optional richer text shown to the human (e.g. colored diff). Falls back to output. */
  display?: string;
  error?: boolean;
}

export interface ToolCallDelta {
  index: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface SessionUsage {
  total: TokenUsage;
  turns: number;
  byTurn: TokenUsage[];
}

export interface MCPServerConfig {
  name: string;
  transport: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface SkillConfig {
  name: string;
  description: string;
  instructions: string;
  path: string;
}

export interface PluginConfig {
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface ProviderProfile {
  name: string;
  type: "openai" | "anthropic" | "google" | "custom";
  apiKey: string;
  baseUrl: string;
  model: string;
  models?: string[];
  description?: string;
}

export interface ProviderConfig {
  type: "openai" | "anthropic" | "google" | "custom";
  apiKey: string;
  baseUrl?: string;
  model: string;
}

export interface AppConfig {
  model: string;
  apiKey: string;
  baseUrl: string;
  provider: string;
  opencodeModel: string;
  maxTurns: number;
  autoApprove: boolean;
  systemPromptExtra: string;
  sandbox: boolean;
  sandboxImage: string;
  mcpServers: MCPServerConfig[];
  skillsPaths: string[];
  plugins: PluginConfig[];
}

export interface Session {
  id: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  cwd: string;
  model: string;
  usage?: SessionUsage;
}

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  priority: "high" | "medium" | "low";
}

export type AgentEvent =
  | { type: "text"; content: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; output: string; display?: string; error?: boolean }
  | { type: "permission_request"; name: string; args: Record<string, unknown> }
  | { type: "usage"; usage: TokenUsage }
  | { type: "thinking"; content: string }
  | { type: "todo_update"; todos: TodoItem[] }
  | { type: "done" }
  | { type: "error"; message: string };
