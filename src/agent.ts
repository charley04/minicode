import type { AppConfig, ChatMessage, AgentEvent, ToolCall, TokenUsage, ApprovalDecision, ContextInfo, ToolCallLogEntry } from "./types.js";
import { ToolRegistry } from "./tools/index.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { createProvider, type LLMProvider } from "./provider.js";
import { TokenTracker } from "./token-tracker.js";
import { SkillManager } from "./skills.js";
import { getTodoList } from "./tools/todo.js";

/** Configuration for retry behavior */
interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

/** Track consecutive tool errors to detect loops */
interface ToolErrorTracker {
  [key: string]: {
    count: number;
    lastError: string;
    timestamp: number;
  };
}

export interface AgentOptions {
  config: AppConfig;
  tools: ToolRegistry;
  onEvent: (event: AgentEvent) => void;
  shouldApprove?: (name: string, args: Record<string, unknown>) => Promise<ApprovalDecision | boolean>;
  skills?: SkillManager;
  tokenTracker?: TokenTracker;
  maxContextTokens?: number;
  signal?: AbortSignal;
  /** Starting turn number for resume (0 = start from beginning) */
  startTurn?: number;
  /** Custom retry configuration */
  retryConfig?: Partial<RetryConfig>;
}

const DEFAULT_MAX_CONTEXT = 200000;

/** Maximum consecutive errors for the same tool+args before forcing a different approach */
const MAX_CONSECUTIVE_TOOL_ERRORS = 3;

export class Agent {
  private config: AppConfig;
  private tools: ToolRegistry;
  private onEvent: (event: AgentEvent) => void;
  private shouldApprove: (name: string, args: Record<string, unknown>) => Promise<ApprovalDecision | boolean>;
  private provider: LLMProvider;
  private skills: SkillManager | undefined;
  private tokenTracker: TokenTracker;
  private maxContextTokens: number;
  private signal: AbortSignal | undefined;
  private sessionAllowlist: Set<string> = new Set();
  private lastDroppedCount = 0;
  private retryConfig: RetryConfig;
  private toolErrorTracker: ToolErrorTracker = {};
  /** Track total tool calls for progress reporting */
  private totalToolCalls = 0;
  /** Record every tool call (input, output, duration) for the end-of-task summary */
  private toolCallLog: ToolCallLogEntry[] = [];

  constructor(opts: AgentOptions) {
    this.config = opts.config;
    this.tools = opts.tools;
    this.onEvent = opts.onEvent;
    this.shouldApprove = opts.shouldApprove ?? (async () => "once" as ApprovalDecision);
    this.skills = opts.skills;
    this.tokenTracker = opts.tokenTracker ?? new TokenTracker();
    this.maxContextTokens = opts.maxContextTokens ?? DEFAULT_MAX_CONTEXT;
    this.signal = opts.signal;
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...opts.retryConfig };

    // For resume support: track starting turn
    const startTurn = opts.startTurn || 0;
    (this as any)._startTurn = startTurn;
    (this as any)._currentTurn = startTurn;

    this.provider = createProvider(this.config);
  }

 private checkAbort(): void {
 if (this.signal?.aborted) {
 const err: any = new Error("Interrupted by user");
 err.name = "AbortError";
 throw err;
 }
 }

  async run(messages: ChatMessage[]): Promise<ChatMessage[]> {
    const systemPrompt = buildSystemPrompt(this.config, this.skills, messages);

    const fullMessages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    // Support resuming from a specific turn (for breakpoint continuation)
    const startTurn = (this as any)._startTurn || 0;
    let resumed = false;

    try {
      for (let turn = startTurn; turn < this.config.maxTurns; turn++) {
        (this as any)._currentTurn = turn;
        if (!resumed && turn === startTurn && startTurn > 0) {
          this.onEvent({ type: "thinking", content: `[resume] Continuing from turn ${startTurn}...\n` });
          resumed = true;
        }

        this.checkAbort();

        // Emit progress for long-running tasks
        if (turn > 0 && turn % 5 === 0) {
          this.onEvent({
            type: "thinking",
            content: `[progress] Turn ${turn}/${this.config.maxTurns} · ${this.totalToolCalls} tool calls completed\n`,
          });
        }

        // Truncate context if approaching token limit
        const truncated = this.truncateContext(fullMessages, systemPrompt);

        // Call LLM with automatic retry on transient failures
        const result = await this.callLLMWithRetry(truncated);

        fullMessages.push({
          role: "assistant",
          content: result.content,
          tool_calls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
        });

        if (result.usage && this.tokenTracker) {
          this.tokenTracker.addUsage(result.usage);
          this.onEvent({ type: "usage", usage: result.usage });
        }

        if (result.thinking) {
          this.onEvent({ type: "thinking", content: result.thinking });
        }

        if (result.toolCalls.length === 0) {
          this.onEvent({ type: "done" });
          return fullMessages.slice(1);
        }

        for (const call of result.toolCalls) {
          this.checkAbort();

          // Record the start time so we can report how long this tool call took.
          const callStart = Date.now();

          let args: Record<string, unknown>;
          try {
            args = JSON.parse(call.function.arguments || "{}");
          } catch (parseErr) {
            // Enhanced error handling for malformed JSON
            this.onEvent({ type: "error", message: `Failed to parse tool arguments for ${call.function.name}: ${(parseErr as Error).message}` });
            // Try to recover by using empty args or partial parse
            try {
              // Attempt to fix common JSON issues (e.g., unescaped newlines)
              const fixedArgs = (call.function.arguments || "")
                .replace(/\n/g, "\\n")
                .replace(/\r/g, "\\r")
                .replace(/\t/g, "\\t");
              args = JSON.parse(fixedArgs);
              this.onEvent({ type: "thinking", content: `[recovery] Fixed malformed JSON for ${call.function.name}\n` });
            } catch {
              args = {};
              const parseDur = Date.now() - callStart;
              const parseOut = JSON.stringify({ error: "Invalid arguments format. Please retry with valid JSON." });
              this.toolCallLog.push({ name: call.function.name, args: {}, output: parseOut, durationMs: parseDur, error: true });
              this.onEvent({ type: "tool_result", name: call.function.name, output: parseOut, error: true, durationMs: parseDur });
              fullMessages.push({
                role: "tool",
                tool_call_id: call.id,
                content: JSON.stringify({ error: "Invalid arguments format" }),
              });
              continue; // Skip to next tool call
            }
          }

          this.onEvent({ type: "tool_call", name: call.function.name, args });
          this.totalToolCalls++;

          // Check for repeated errors (dead loop detection)
          const errorKey = `${call.function.name}:${JSON.stringify(args).slice(0, 100)}`;
          if (this.shouldSkipToolCall(errorKey)) {
            const guidance = `\n\n[warning] This tool call has failed repeatedly (${this.toolErrorTracker[errorKey].count} times). Try a different approach.`;
            const skipOut = `Repeated failure detected.${guidance}`;
            const skipDur = Date.now() - callStart;
            this.toolCallLog.push({ name: call.function.name, args, output: skipOut, durationMs: skipDur, error: true });
            this.onEvent({
              type: "tool_result",
              name: call.function.name,
              output: skipOut,
              error: true,
              durationMs: skipDur,
            });
            fullMessages.push({
              role: "tool",
              tool_call_id: call.id,
              content: `Repeated failure detected. Last error: ${this.toolErrorTracker[errorKey].lastError}${guidance}`,
            });
            continue;
          }

          const requiresPermission = this.tools.requiresPermission(call.function.name);
          const preApproved = this.sessionAllowlist.has(call.function.name);
          if (requiresPermission && !this.config.autoApprove && !preApproved) {
            this.onEvent({ type: "permission_request", name: call.function.name, args });
            const raw = await this.shouldApprove(call.function.name, args);
            const decision: ApprovalDecision = typeof raw === "boolean"
              ? (raw ? "once" : "deny")
              : raw;

            if (decision === "always") {
              this.sessionAllowlist.add(call.function.name);
            } else if (decision === "deny" || decision === "stop") {
              const output = decision === "stop"
                ? "Permission denied by user (session interrupted)."
                : "Permission denied by user.";
              const denyDur = Date.now() - callStart;
              this.toolCallLog.push({ name: call.function.name, args, output, durationMs: denyDur, error: true });
              this.onEvent({ type: "tool_result", name: call.function.name, output, error: true, durationMs: denyDur });
              fullMessages.push({
                role: "tool",
                tool_call_id: call.id,
                content: output,
              });
              if (decision === "stop") {
                this.onEvent({ type: "done" });
                return fullMessages.slice(1);
              }
              continue;
            }
          }

          // Execute tool with error isolation - single failure won't crash the agent
          const toolResult = await this.executeToolWithErrorHandling(
            call.function.name,
            args,
            call.id,
            errorKey,
          );
          const durationMs = Date.now() - callStart;
          this.toolCallLog.push({
            name: call.function.name,
            args,
            output: toolResult.output,
            display: toolResult.display,
            durationMs,
            error: toolResult.error,
          });
          this.onEvent({
            type: "tool_result",
            name: call.function.name,
            output: toolResult.output,
            display: toolResult.display,
            error: toolResult.error,
            durationMs,
          });

          // If the todo tool was called, emit a todo_update event
          if (call.function.name === "todo") {
            const currentTodos = getTodoList();
            if (currentTodos.length > 0) {
              this.onEvent({ type: "todo_update", todos: currentTodos });
            }
          }

          fullMessages.push({
            role: "tool",
            tool_call_id: call.id,
            content: toolResult.output,
          });
        }

        // Emit context info after each turn
        this.emitContextInfo(fullMessages, systemPrompt);
      }

      this.onEvent({ type: "error", message: `Reached max turns (${this.config.maxTurns})` });
      return fullMessages.slice(1);
    } catch (err: unknown) {
      const error = err as { name?: string; message: string };
      if (error.name === "AbortError" || this.signal?.aborted) {
        const currentTurn = (this as any)._currentTurn || 0;
        this.onEvent({
          type: "error",
          message: `Interrupted at turn ${currentTurn}. Use /continue to resume from breakpoint.`,
        });
        this.onEvent({ type: "done" });
        // Return messages with checkpoint info embedded
        const result = fullMessages.slice(1);
        (result as any)._checkpoint = {
          interruptedAt: Date.now(),
          completedTurns: currentTurn,
          isInterrupted: true,
        };
        return result;
      }
      throw err;
    }
  }

 getTokenTracker(): TokenTracker {
 return this.tokenTracker;
 }

 /** Return the log of all tool calls executed so far (for end-of-task summary). */
 getToolCallLog(): ToolCallLogEntry[] {
 return this.toolCallLog;
 }

 private compressToolOutput(output: string, toolName: string): string {
 const maxBytes = this.config.maxToolOutputSize || 51200;
 if (Buffer.byteLength(output, "utf-8") <= maxBytes) return output;

 // Keep the first half and last quarter of the output, drop the middle
 const half = Math.floor(maxBytes * 0.6);
 const tail = Math.floor(maxBytes * 0.3);
 const head = output.slice(0, half);
 const end = output.slice(output.length - tail);
 const droppedBytes = Buffer.byteLength(output, "utf-8") - half - tail;
 return `${head}\n\n[... ${(droppedBytes / 1024).toFixed(0)}KB of output truncated by MiniCode to save context. The full output was shown to you above. Use the tool again with more specific parameters if needed.]\n\n${end}`;
 }

  private emitContextInfo(messages: ChatMessage[], systemPrompt: string): void {
    const systemTokens = Math.ceil(systemPrompt.length / 4);
    let estimatedTokens = systemTokens;
    const convMessages = messages.slice(1);
    let totalMessages = 1; // system
    let droppedCount = 0;

    for (let i = convMessages.length - 1; i >= 0; i--) {
      const msg = convMessages[i];
      const msgTokens = Math.ceil(JSON.stringify(msg).length / 4);
      if (estimatedTokens + msgTokens > this.maxContextTokens && totalMessages >= 4) {
        droppedCount = i + 1;
        break;
      }
      estimatedTokens += msgTokens;
      totalMessages++;
    }

    const usagePercent = Math.round((estimatedTokens / this.maxContextTokens) * 100);
    
    const context: ContextInfo = {
      estimatedTokens,
      maxTokens: this.maxContextTokens,
      usagePercent: Math.min(usagePercent, 100),
      messageCount: messages.length,
      droppedCount: Math.max(0, droppedCount - this.lastDroppedCount),
    };
    this.lastDroppedCount = Math.max(this.lastDroppedCount, droppedCount);

    this.onEvent({ type: "context_update", context });

    // Emit warning when approaching context limit (aggressive warning at 75%+)
    if (usagePercent >= 90) {
      this.onEvent({
        type: "thinking",
        content: `[warning] Context window at ${usagePercent}% (${estimatedTokens}/${this.maxContextTokens} tokens). Consider using /compress to reduce usage.\n`,
      });
    } else if (usagePercent >= 75) {
      this.onEvent({
        type: "thinking",
        content: `[notice] Context window at ${usagePercent}% (${estimatedTokens}/${this.maxContextTokens} tokens).\n`,
      });
    }
  }

  private truncateContext(messages: ChatMessage[], systemPrompt: string): ChatMessage[] {
    // Estimate total tokens (rough: 1 token ≈ 4 chars)
    const systemTokens = Math.ceil(systemPrompt.length / 4);
    let estimatedTokens = systemTokens;

    const result: ChatMessage[] = [messages[0]]; // always keep system

    // Work backwards from the most recent messages
    const convMessages = messages.slice(1);
    const kept: ChatMessage[] = [];

    // More aggressive truncation: only keep 80% of max to leave room for new content
    const targetLimit = Math.floor(this.maxContextTokens * 0.8);

    for (let i = convMessages.length - 1; i >= 0; i--) {
      const msg = convMessages[i];
      const msgTokens = Math.ceil(JSON.stringify(msg).length / 4);
      
      // Aggressive: stop earlier to prevent hitting the hard limit
      if (estimatedTokens + msgTokens > targetLimit && kept.length >= 3) {
        break;
      }
      kept.unshift(msg);
      estimatedTokens += msgTokens;
    }

    // If we dropped messages, add a detailed summary notice
    const droppedCount = convMessages.length - kept.length;
    if (droppedCount > 0) {
      // Include a more informative truncation notice with stats
      kept.unshift({
        role: "system",
        content: `[context compressed] ${droppedCount} earlier message(s) were truncated to fit the ${this.maxContextTokens.toLocaleString()}-token context window. Current estimate: ~${estimatedTokens.toLocaleString()} tokens used. The most recent messages and conversation flow are preserved.`,
      });
    }

    return [...result, ...kept];
  }

  private async callLLM(
    messages: ChatMessage[],
  ): Promise<{ content: string; toolCalls: ToolCall[]; usage: TokenUsage | null; thinking?: string }> {
    const result = await this.provider.stream(
      messages,
      this.tools.getOpenAITools(),
      {
        onText: (text) => {
          this.onEvent({ type: "text", content: text });
        },
        onThinking: (text) => {
          this.onEvent({ type: "thinking", content: text });
        },
        signal: this.signal,
      },
    );

    return {
      content: result.content,
      toolCalls: result.toolCalls,
      usage: result.usage,
      thinking: result.thinking,
    };
  }

  /**
   * Call LLM with automatic retry on transient failures.
   * Uses exponential backoff to avoid overwhelming a struggling API.
   */
  private async callLLMWithRetry(
    messages: ChatMessage[],
  ): Promise<{ content: string; toolCalls: ToolCall[]; usage: TokenUsage | null; thinking?: string }> {
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        this.checkAbort();
        
        if (attempt > 0) {
          const delay = Math.min(
            this.retryConfig.baseDelayMs * Math.pow(2, attempt - 1),
            this.retryConfig.maxDelayMs,
          );
          this.onEvent({
            type: "thinking",
            content: `[retry] LLM call attempt ${attempt + 1}/${this.retryConfig.maxRetries + 1} after ${delay}ms...\n`,
          });
          await new Promise(resolve => setTimeout(resolve, delay));
          this.checkAbort();
        }
        
        return await this.callLLM(messages);
      } catch (err) {
        lastError = err as Error;
        const isTransient = this.isTransientError(err as { message?: string; code?: string });
        
        // Don't retry abort errors or non-transient errors
        if ((err as { name?: string }).name === "AbortError" || !isTransient) {
          throw err;
        }
        
        this.onEvent({
          type: "error",
          message: `LLM call failed (attempt ${attempt + 1}/${this.retryConfig.maxRetries + 1}): ${(err as Error).message}`,
        });
      }
    }
    
    throw lastError || new Error("Max retries exceeded for LLM call");
  }

  /**
   * Determine if an error is transient and worth retrying.
   * Transient errors include network issues, rate limits, timeouts.
   */
  private isTransientError(err: { message?: string; code?: string }): boolean {
    const msg = (err.message || "").toLowerCase();
    const code = err.code || "";
    
    // Network errors
    if (msg.includes("network") || msg.includes("timeout") || msg.includes("abort") ||
        msg.includes("socket") || msg.includes("connection")) {
      return true;
    }
    
    // Rate limiting
    if (msg.includes("rate limit") || msg.includes("429") || msg.includes("too many requests")) {
      return true;
    }
    
    // Server errors (5xx)
    if (code.startsWith("5") || msg.includes("500") || msg.includes("502") || 
        msg.includes("503") || msg.includes("504")) {
      return true;
    }
    
    // Service unavailable
    if (msg.includes("unavailable") || msg.includes("overloaded") || msg.includes("busy")) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if a tool call should be skipped due to repeated failures.
   * Prevents infinite error loops.
   */
  private shouldSkipToolCall(errorKey: string): boolean {
    const tracker = this.toolErrorTracker[errorKey];
    if (!tracker) return false;
    
    // Only skip if we've hit the max AND the error was recent (within last 10 calls)
    const isRecent = Date.now() - tracker.timestamp < 60000;
    return tracker.count >= MAX_CONSECUTIVE_TOOL_ERRORS && isRecent;
  }

  /**
   * Execute a tool with comprehensive error handling and tracking.
   * Isolates errors so one failure doesn't crash the entire agent.
   */
  private async executeToolWithErrorHandling(
    toolName: string,
    args: Record<string, unknown>,
    toolCallId: string,
    errorKey: string,
  ): Promise<{ output: string; display?: string; error: boolean }> {
    try {
      const toolResult = await this.tools.execute(
        toolName,
        args,
        {
          signal: this.signal,
          maxContextTokens: this.maxContextTokens,
          maxToolOutputSize: this.config.maxToolOutputSize,
        },
      );

      // Track successful execution - clear or decrement error count
      if (this.toolErrorTracker[errorKey]) {
        this.toolErrorTracker[errorKey].count = 0;
      }

      // Apply compression to large outputs
      const compressedOutput = this.compressToolOutput(toolResult.output, toolName);
      
      if (toolResult.error) {
        // Update error tracker
        this.trackToolError(errorKey, compressedOutput.slice(0, 200));
        
        return {
          output: compressedOutput + "\n\n[guidance] The tool returned an error. Analyze the error message, fix your approach, and retry. Do NOT report the failure to the user without attempting to fix it first.",
          display: toolResult.display,
          error: true,
        };
      }

      return {
        output: compressedOutput,
        display: toolResult.display,
        error: false,
      };
    } catch (execErr) {
      // Catch unexpected tool execution errors
      const errorMsg = execErr instanceof Error ? execErr.message : String(execErr);
      
      this.trackToolError(errorKey, errorMsg);
      
      this.onEvent({
        type: "error",
        message: `Tool ${toolName} threw unexpected error: ${errorMsg}`,
      });
      
      return {
        output: `[execution error] Tool ${toolName} failed unexpectedly: ${errorMsg}\n\n[guidance] This tool encountered an internal error. Try an alternative approach.`,
        error: true,
      };
    }
  }

  /**
   * Record a tool error for loop detection.
   */
  private trackToolError(errorKey: string, errorMessage: string): void {
    if (!this.toolErrorTracker[errorKey]) {
      this.toolErrorTracker[errorKey] = { count: 0, lastError: "", timestamp: 0 };
    }
    
    this.toolErrorTracker[errorKey].count++;
    this.toolErrorTracker[errorKey].lastError = errorMessage;
    this.toolErrorTracker[errorKey].timestamp = Date.now();
  }
}
