import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AppConfig, ChatMessage, ToolCall, TokenUsage } from "./types.js";
import { resolveModel } from "./opencode-config.js";

export interface LLMResponse {
  content: string;
  toolCalls: ToolCall[];
  usage: TokenUsage | null;
  thinking?: string;
}

export interface LLMStreamCallbacks {
  onText: (text: string) => void;
  onThinking?: (text: string) => void;
  onToolCallDelta?: (index: number, id: string, name: string, argsDelta: string) => void;
}

export interface LLMProvider {
  stream(
    messages: ChatMessage[],
    tools: Array<{
      type: "function";
      function: { name: string; description: string; parameters: Record<string, unknown> };
    }>,
    callbacks: LLMStreamCallbacks,
  ): Promise<LLMResponse>;
}

interface ProviderParams {
  apiKey: string;
  baseURL: string;
  model: string;
  npm: string;
}

function resolveProviderParams(config: AppConfig): ProviderParams {
  // Try opencode config resolution first
  const resolved = resolveModel(config.opencodeModel || config.model);
  if (resolved) {
    return {
      apiKey: resolved.apiKey || config.apiKey,
      baseURL: resolved.baseURL || config.baseUrl,
      model: resolved.modelId,
      npm: resolved.npm,
    };
  }

  // Fallback to flat config
  return {
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    model: config.model.includes("/") ? config.model.split("/").slice(1).join("/") : config.model,
    npm: config.provider || "@ai-sdk/openai-compatible",
  };
}

export function createProvider(config: AppConfig): LLMProvider {
  const params = resolveProviderParams(config);
  const npm = params.npm.toLowerCase();

  if (npm.includes("anthropic")) {
    return new AnthropicProvider(params);
  }
  if (npm.includes("google") || npm.includes("gemini") || npm.includes("vertex")) {
    return new GoogleProvider(params);
  }
  // @ai-sdk/openai and @ai-sdk/openai-compatible both use OpenAI SDK
  return new OpenAIProvider(params);
}

class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(params: ProviderParams) {
    this.client = new OpenAI({
      apiKey: params.apiKey || "dummy",
      baseURL: params.baseURL || undefined,
    });
    this.model = params.model;
  }

  async stream(
    messages: ChatMessage[],
    tools: Array<{
      type: "function";
      function: { name: string; description: string; parameters: Record<string, unknown> };
    }>,
    callbacks: LLMStreamCallbacks,
  ): Promise<LLMResponse> {
    const openaiMessages = messages.map((m) => {
      if (m.role === "tool") {
        return {
          role: "tool" as const,
          content: m.content || "",
          tool_call_id: m.tool_call_id || "",
        };
      }
      if (m.role === "assistant" && m.tool_calls) {
        return {
          role: "assistant" as const,
          content: m.content,
          tool_calls: m.tool_calls,
        };
      }
      return {
        role: m.role as "system" | "user" | "assistant",
        content: m.content || "",
      };
    }) as OpenAI.Chat.Completions.ChatCompletionMessageParam[];

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      tools: tools.length > 0 ? tools : undefined,
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0,
    });

    let content = "";
    let usage: TokenUsage | null = null;
    const toolCallMap = new Map<number, ToolCall>();

    for await (const chunk of stream) {
      if (chunk.usage) {
        usage = {
          promptTokens: chunk.usage.prompt_tokens || 0,
          completionTokens: chunk.usage.completion_tokens || 0,
          totalTokens: chunk.usage.total_tokens || 0,
        };
      }

      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        content += delta.content;
        callbacks.onText(delta.content);
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallMap.has(idx)) {
            toolCallMap.set(idx, {
              id: tc.id || `call_${idx}`,
              type: "function",
              function: {
                name: tc.function?.name || "",
                arguments: tc.function?.arguments || "",
              },
            });
          } else {
            const existing = toolCallMap.get(idx)!;
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.function.name += tc.function.name;
            if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
          }

          if (callbacks.onToolCallDelta) {
            const existing = toolCallMap.get(idx)!;
            callbacks.onToolCallDelta(
              idx,
              existing.id,
              existing.function.name,
              tc.function?.arguments || "",
            );
          }
        }
      }
    }

    const toolCalls = Array.from(toolCallMap.values());

    if (!usage) {
      const approxPrompt = JSON.stringify(openaiMessages).length / 4;
      const approxCompletion = content.length / 4;
      usage = {
        promptTokens: Math.round(approxPrompt),
        completionTokens: Math.round(approxCompletion),
        totalTokens: Math.round(approxPrompt + approxCompletion),
      };
    }

    return { content, toolCalls, usage };
  }
}

class AnthropicProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;

  constructor(params: ProviderParams) {
    this.client = new Anthropic({
      apiKey: params.apiKey,
      baseURL: params.baseURL || undefined,
    });
    this.model = params.model;
  }

  async stream(
    messages: ChatMessage[],
    tools: Array<{
      type: "function";
      function: { name: string; description: string; parameters: Record<string, unknown> };
    }>,
    callbacks: LLMStreamCallbacks,
  ): Promise<LLMResponse> {
    const systemMsg = messages.find((m) => m.role === "system");
    const systemPrompt = systemMsg?.content || "";

    const convMessages = messages.filter((m) => m.role !== "system");

    const anthropicMessages: any[] = [];
    for (const m of convMessages) {
      if (m.role === "tool") {
        anthropicMessages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: m.tool_call_id || "",
              content: m.content || "",
            },
          ],
        });
      } else if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
        const content: any[] = [];
        if (m.content) {
          content.push({ type: "text", text: m.content });
        }
        for (const tc of m.tool_calls) {
          content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments || "{}"),
          });
        }
        anthropicMessages.push({ role: "assistant", content });
      } else {
        anthropicMessages.push({
          role: m.role as "user" | "assistant",
          content: m.content || "",
        });
      }
    }

    const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
    }));

    const stream = await this.client.messages.stream({
      model: this.model,
      max_tokens: 8192,
      system: systemPrompt,
      messages: anthropicMessages,
      tools: anthropicTools.length > 0 ? anthropicTools : undefined,
    });

    let content = "";
    let thinking = "";
    const toolCalls: ToolCall[] = [];

    for await (const event of stream) {
      switch (event.type) {
        case "content_block_delta":
          if (event.delta.type === "text_delta") {
            content += event.delta.text;
            callbacks.onText(event.delta.text);
          } else if (event.delta.type === "thinking_delta" && callbacks.onThinking) {
            thinking += event.delta.thinking;
            callbacks.onThinking(event.delta.thinking);
          }
          break;
        case "content_block_start":
          if (event.content_block.type === "tool_use") {
            const block = event.content_block as Anthropic.ToolUseBlock;
            toolCalls[event.index] = {
              id: block.id,
              type: "function",
              function: {
                name: block.name,
                arguments: "",
              },
            };
          }
          break;
      }
    }

    const finalMessage = await stream.finalMessage();

    for (const block of finalMessage.content) {
      if (block.type === "tool_use") {
        const idx = toolCalls.findIndex((tc) => tc.id === block.id);
        if (idx >= 0) {
          toolCalls[idx].function.arguments = JSON.stringify(block.input);
        } else {
          toolCalls.push({
            id: block.id,
            type: "function",
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input),
            },
          });
        }
      }
    }

    const usage: TokenUsage = {
      promptTokens: finalMessage.usage.input_tokens,
      completionTokens: finalMessage.usage.output_tokens,
      totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
    };

    return { content, toolCalls, usage, thinking: thinking || undefined };
  }
}

class GoogleProvider implements LLMProvider {
  private genAI: GoogleGenerativeAI;
  private model: string;

  constructor(params: ProviderParams) {
    this.genAI = new GoogleGenerativeAI(params.apiKey);
    this.model = params.model;
  }

  async stream(
    messages: ChatMessage[],
    tools: Array<{
      type: "function";
      function: { name: string; description: string; parameters: Record<string, unknown> };
    }>,
    callbacks: LLMStreamCallbacks,
  ): Promise<LLMResponse> {
    const systemMsg = messages.find((m) => m.role === "system");
    const convMessages = messages.filter((m) => m.role !== "system");

    const model = this.genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: systemMsg?.content || undefined,
    });

    const history = convMessages.map((m) => {
      if (m.role === "tool") {
        return {
          role: "function" as const,
          parts: [{ text: m.content || "" }],
        };
      }
      return {
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content || "" }],
      };
    });

    const googleTools = tools.length > 0
      ? [{
          functionDeclarations: tools.map((t) => ({
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters as any,
          })),
        } as any]
      : undefined;

    const result = await model.generateContentStream({
      contents: history as any,
      tools: googleTools,
    });

    let content = "";
    const toolCalls: ToolCall[] = [];
    let promptTokens = 0;
    let completionTokens = 0;

    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        content += chunkText;
        callbacks.onText(chunkText);
      }

      const functionCalls = chunk.functionCalls();
      if (functionCalls && functionCalls.length > 0) {
        for (let i = 0; i < functionCalls.length; i++) {
          const fc = functionCalls[i];
          toolCalls.push({
            id: `call_${i}`,
            type: "function",
            function: {
              name: fc.name,
              arguments: JSON.stringify(fc.args || {}),
            },
          });
        }
      }

      const usage = chunk.usageMetadata;
      if (usage) {
        promptTokens = usage.promptTokenCount || promptTokens;
        completionTokens = (usage.candidatesTokenCount || 0);
      }
    }

    const usage: TokenUsage = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };

    return { content, toolCalls, usage };
  }
}
