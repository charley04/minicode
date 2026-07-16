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
  /** Maximum tool output size in bytes before truncation. Default 51200. */
  maxToolOutputSize?: number;
  /** Maximum context tokens for the session. Used for context display. */
  maxContextTokens?: number;
}

export type ApprovalDecision = "once" | "always" | "deny" | "stop";

export interface ToolResult {
  /** Text sent back to the LLM. Should be plain (no ANSI, no huge diffs). */
  output: string;
  /** Optional richer text shown to the human (e.g. colored diff). Falls back to output. */
  display?: string;
  error?: boolean;
}

/** A single recorded tool execution, used for the end-of-task summary. */
export interface ToolCallLogEntry {
  name: string;
  args: Record<string, unknown>;
  output: string;
  display?: string;
  /** Wall-clock time the tool call took, in milliseconds. */
  durationMs: number;
  error: boolean;
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

export interface ContextInfo {
 /** Estimated current prompt tokens (including system prompt and conversation history) */
 estimatedTokens: number;
 /** Maximum context tokens allowed */
 maxTokens: number;
 /** Percentage of context used (0-100) */
 usagePercent: number;
 /** Number of messages in the current context window */
 messageCount: number;
 /** Number of messages dropped due to truncation */
 droppedCount: number;
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
  /** Maximum context tokens before truncation. Default 100000. */
  maxContextTokens: number;
  /** Maximum tool output size in bytes before compression. Default 51200. */
  maxToolOutputSize: number;
}

export interface Session {
 id: string;
 messages: ChatMessage[];
 createdAt: number;
 updatedAt: number;
 cwd: string;
 model: string;
 usage?: SessionUsage;
 /** Checkpoint for resuming interrupted tasks */
 checkpoint?: TaskCheckpoint;
}

/** Saved state when a task is interrupted, allowing resume from breakpoint */
export interface TaskCheckpoint {
 /** Timestamp when interrupted */
 interruptedAt: number;
 /** Number of turns completed before interruption */
 completedTurns: number;
 /** The user's original input that triggered the task */
 userInput: string;
 /** Whether the task was interrupted (vs completed normally) */
 isInterrupted: boolean;
 /** Optional status message about what was being done */
 status?: string;
}

export interface TodoItem {
 content: string;
 status: "pending" | "in_progress" | "completed";
 priority: "high" | "medium" | "low";
}

export type AgentEvent =
 | { type: "text"; content: string }
 | { type: "tool_call"; name: string; args: Record<string, unknown> }
 | { type: "tool_result"; name: string; output: string; display?: string; error?: boolean; durationMs?: number }
 | { type: "permission_request"; name: string; args: Record<string, unknown> }
 | { type: "usage"; usage: TokenUsage }
 | { type: "thinking"; content: string }
 | { type: "todo_update"; todos: TodoItem[] }
 | { type: "context_update"; context: ContextInfo }
 | { type: "done" }
 | { type: "error"; message: string };
