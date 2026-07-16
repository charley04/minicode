/**
 * Rough token estimation utilities.
 *
 * Token counting is approximate: 1 token ≈ 4 characters for English text,
 * but code and special characters may vary. These estimates are used for
 * context window management and display, not for billing.
 */
import type { ContextInfo, ChatMessage } from "./types.js";

const CHARS_PER_TOKEN = 4;

/**
 * Estimate the number of tokens in a string.
 * Uses a simple character-based heuristic: length / 4.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate tokens for a ChatMessage object (including role, content, tool_calls, etc.)
 */
export function estimateMessageTokens(msg: ChatMessage): number {
  let total = estimateTokens(msg.role);
  if (msg.content) total += estimateTokens(msg.content);
  if (msg.tool_call_id) total += estimateTokens(msg.tool_call_id);
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      total += estimateTokens(tc.id);
      total += estimateTokens(tc.type);
      total += estimateTokens(tc.function.name);
      total += estimateTokens(tc.function.arguments);
    }
  }
  // JSON structural overhead (~20 chars per message)
  total += 5;
  return total;
}

/**
 * Estimate tokens for an array of messages (conversation history).
 */
export function estimateMessagesTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateMessageTokens(msg);
  }
  return total;
}

/**
 * Truncate a string to fit within a maximum token budget.
 * Returns the truncated string and a note about how many tokens were removed.
 */
export function truncateToTokenBudget(
  text: string,
  maxTokens: number,
): { truncated: string; removedTokens: number; note: string } {
  const estimated = estimateTokens(text);
  if (estimated <= maxTokens) {
    return { truncated: text, removedTokens: 0, note: "" };
  }

  // Target character length
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const truncated = text.slice(0, maxChars) + "\n...(truncated)";
  const removedTokens = estimated - maxTokens;
  return {
    truncated,
    removedTokens,
    note: `[truncated: ~${removedTokens} tokens removed]`,
  };
}

/**
 * Truncate lines to fit within a max token budget.
 * Keeps head and tail, drops middle.
 */
export function truncateLinesToTokenBudget(
  lines: string[],
  maxTokens: number,
  headLines: number = 20,
  tailLines: number = 5,
): { lines: string[]; removedTokens: number; note: string } {
  if (lines.length === 0) {
    return { lines: [], removedTokens: 0, note: "" };
  }

  const fullText = lines.join("\n");
  const estimated = estimateTokens(fullText);
  if (estimated <= maxTokens) {
    return { lines, removedTokens: 0, note: "" };
  }

  // Try head/tail first
  if (lines.length > headLines + tailLines) {
    const head = lines.slice(0, headLines);
    const tail = lines.slice(-tailLines);
    const kept = [...head, `... (${lines.length - headLines - tailLines} lines dropped for context)`, ...tail];
    const keptText = kept.join("\n");
    const keptTokens = estimateTokens(keptText);
    return {
      lines: kept,
      removedTokens: estimated - keptTokens,
      note: `[truncated: ~${estimated - keptTokens} tokens removed]`,
    };
  }

  // Fall back to character-based truncation
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const truncated = fullText.slice(0, maxChars) + "\n...(truncated)";
  const removedTokens = estimated - maxTokens;
  return {
    lines: truncated.split("\n"),
    removedTokens,
    note: `[truncated: ~${removedTokens} tokens removed]`,
  };
}

/**
 * Build a ContextInfo from a set of messages and a max context limit.
 */
export function buildContextInfo(
  messages: ChatMessage[],
  maxContextTokens: number,
  droppedCount: number = 0,
): ContextInfo {
  const estimatedTokens = estimateMessagesTokens(messages);
  const usagePercent = maxContextTokens > 0
    ? Math.round((estimatedTokens / maxContextTokens) * 100)
    : 0;

  return {
    estimatedTokens,
    maxTokens: maxContextTokens,
    usagePercent: Math.min(usagePercent, 100),
    messageCount: messages.length,
    droppedCount,
  };
}

/**
 * Format a ContextInfo into a short human-readable string for the status bar.
 */
export function formatContextInfo(ctx: ContextInfo): string {
  const bar = renderContextBar(ctx.usagePercent);
  return `${bar} ${ctx.estimatedTokens.toLocaleString()}/${ctx.maxTokens.toLocaleString()} (${ctx.usagePercent}%)`;
}

/**
 * Render a small visual context usage bar.
 */
export function renderContextBar(percent: number, width: number = 6): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);

  if (percent >= 90) return `\x1b[91m${bar}\x1b[0m`;     // red
  if (percent >= 70) return `\x1b[93m${bar}\x1b[0m`;     // yellow
  return `\x1b[92m${bar}\x1b[0m`;                         // green
}

/**
 * Format context usage as a compact one-line string for tool results display.
 */
export function formatContextCost(estimatedTokens: number, maxTokens: number): string {
  const pct = maxTokens > 0 ? Math.round((estimatedTokens / maxTokens) * 100) : 0;
  return `\x1b[90m[ctx: ~${estimatedTokens.toLocaleString()}t ${pct}%]\x1b[0m`;
}

/**
 * Compress messages to reduce token usage while preserving recent context.
 * Keeps system message and most recent messages, summarizes or truncates older content.
 * Returns the compressed message array and statistics about the compression.
 */
export function compressContext(
  messages: ChatMessage[],
  maxTargetTokens: number,
  systemPrompt?: string,
): { compressed: ChatMessage[]; originalTokens: number; newTokens: number; removedTokens: number } {
  const originalTokens = estimateMessagesTokens(messages);

  // If already under target, no compression needed
  if (originalTokens <= maxTargetTokens) {
    return { compressed: messages, originalTokens, newTokens: originalTokens, removedTokens: 0 };
  }

  const systemTokens = systemPrompt ? Math.ceil(systemPrompt.length / CHARS_PER_TOKEN) : 0;
  const availableForMessages = maxTargetTokens - systemTokens;

  const result: ChatMessage[] = [];
  let currentTokens = systemTokens;
  let droppedCount = 0;

  // Always keep the first message if it's a system message
  if (messages.length > 0 && messages[0].role === "system") {
    result.push(messages[0]);
    currentTokens += estimateMessageTokens(messages[0]);
  }

  // Work from end to keep recent messages
  const toCompress = result.length > 0 ? messages.slice(1) : messages;
  const kept: ChatMessage[] = [];

  for (let i = toCompress.length - 1; i >= 0; i--) {
    const msg = toCompress[i];
    const msgTokens = estimateMessageTokens(msg);

    if (currentTokens + msgTokens > availableForMessages && kept.length >= 4) {
      droppedCount++;
      continue;
    }

    kept.unshift(msg);
    currentTokens += msgTokens;
  }

  // Add compression notice if we dropped anything
  if (droppedCount > 0) {
    kept.unshift({
      role: "system",
      content: `[compressed] ${droppedCount} older message(s) were compressed to reduce context usage. Original: ~${originalTokens} tokens → Now: ~${currentTokens} tokens.`,
    } as ChatMessage);
  }

  const compressed = [...result, ...kept];
  const newTokens = estimateMessagesTokens(compressed);

  return {
    compressed,
    originalTokens,
    newTokens,
    removedTokens: originalTokens - newTokens,
  };
}