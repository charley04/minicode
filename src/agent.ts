import type { AppConfig, ChatMessage, AgentEvent, ToolCall, TokenUsage } from "./types.js";
import { ToolRegistry } from "./tools/index.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { createProvider, type LLMProvider } from "./provider.js";
import { TokenTracker } from "./token-tracker.js";
import { SkillManager } from "./skills.js";
import { getTodoList } from "./tools/todo.js";

export interface AgentOptions {
  config: AppConfig;
  tools: ToolRegistry;
  onEvent: (event: AgentEvent) => void;
  shouldApprove?: (name: string, args: Record<string, unknown>) => Promise<boolean>;
  skills?: SkillManager;
  tokenTracker?: TokenTracker;
  maxContextTokens?: number;
}

const DEFAULT_MAX_CONTEXT = 100000;

export class Agent {
  private config: AppConfig;
  private tools: ToolRegistry;
  private onEvent: (event: AgentEvent) => void;
  private shouldApprove: (name: string, args: Record<string, unknown>) => Promise<boolean>;
  private provider: LLMProvider;
  private skills: SkillManager | undefined;
  private tokenTracker: TokenTracker;
  private maxContextTokens: number;

  constructor(opts: AgentOptions) {
    this.config = opts.config;
    this.tools = opts.tools;
    this.onEvent = opts.onEvent;
    this.shouldApprove = opts.shouldApprove ?? (async () => true);
    this.skills = opts.skills;
    this.tokenTracker = opts.tokenTracker ?? new TokenTracker();
    this.maxContextTokens = opts.maxContextTokens ?? DEFAULT_MAX_CONTEXT;

    this.provider = createProvider(this.config);
  }

  async run(messages: ChatMessage[]): Promise<ChatMessage[]> {
    const systemPrompt = buildSystemPrompt(this.config, this.skills, messages);

    const fullMessages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...messages,
    ];

    for (let turn = 0; turn < this.config.maxTurns; turn++) {
      // Truncate context if approaching token limit
      const truncated = this.truncateContext(fullMessages, systemPrompt);

      const result = await this.callLLM(truncated);

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
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          args = {};
        }

        this.onEvent({ type: "tool_call", name: call.function.name, args });

        const requiresPermission = this.tools.requiresPermission(call.function.name);
        if (requiresPermission && !this.config.autoApprove) {
          this.onEvent({ type: "permission_request", name: call.function.name, args });
          const approved = await this.shouldApprove(call.function.name, args);
          if (!approved) {
            const output = "Permission denied by user.";
            this.onEvent({ type: "tool_result", name: call.function.name, output, error: true });
            fullMessages.push({
              role: "tool",
              tool_call_id: call.id,
              content: output,
            });
            continue;
          }
        }

        const toolResult = await this.tools.execute(call.function.name, args);
        this.onEvent({
          type: "tool_result",
          name: call.function.name,
          output: toolResult.output,
          error: toolResult.error,
        });

        // If the todo tool was called, emit a todo_update event
        if (call.function.name === "todo") {
          const currentTodos = getTodoList();
          if (currentTodos.length > 0) {
            this.onEvent({ type: "todo_update", todos: currentTodos });
          }
        }

        // On error, append guidance to help the LLM self-correct
        let resultContent = toolResult.output;
        if (toolResult.error) {
          resultContent += "\n\n[guidance] The tool returned an error. Analyze the error message, fix your approach, and retry. Do NOT report the failure to the user without attempting to fix it first.";
        }

        fullMessages.push({
          role: "tool",
          tool_call_id: call.id,
          content: resultContent,
        });
      }
    }

    this.onEvent({ type: "error", message: `Reached max turns (${this.config.maxTurns})` });
    return fullMessages.slice(1);
  }

  getTokenTracker(): TokenTracker {
    return this.tokenTracker;
  }

  private truncateContext(messages: ChatMessage[], systemPrompt: string): ChatMessage[] {
    // Estimate total tokens (rough: 1 token ≈ 4 chars)
    const systemTokens = Math.ceil(systemPrompt.length / 4);
    let estimatedTokens = systemTokens;

    const result: ChatMessage[] = [messages[0]]; // always keep system

    // Work backwards from the most recent messages
    const convMessages = messages.slice(1);
    const kept: ChatMessage[] = [];

    for (let i = convMessages.length - 1; i >= 0; i--) {
      const msg = convMessages[i];
      const msgTokens = Math.ceil(JSON.stringify(msg).length / 4);
      if (estimatedTokens + msgTokens > this.maxContextTokens && kept.length >= 4) {
        break;
      }
      kept.unshift(msg);
      estimatedTokens += msgTokens;
    }

    // If we dropped messages, add a summary notice
    const droppedCount = convMessages.length - kept.length;
    if (droppedCount > 0) {
      kept.unshift({
        role: "system",
        content: `[context] ${droppedCount} earlier message(s) were truncated to fit the context window. The most recent messages are preserved.`,
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
      },
    );

    return {
      content: result.content,
      toolCalls: result.toolCalls,
      usage: result.usage,
      thinking: result.thinking,
    };
  }
}
