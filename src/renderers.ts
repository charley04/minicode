import chalk from "chalk";
import type { ToolCallLogEntry } from "./types.js";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { computeDiff } from "./tools/diff.js";
import { DIFF_MARKER } from "./tools/write.js";

/**
 * Inline tool_call preview — single line shown when the model calls a tool.
 * Different from the previous 120-byte JSON truncation.
 */
export function renderToolCallInline(name: string, args: Record<string, unknown>): string {
  try {
    switch (name) {
      case "bash": {
        const cmd = String(args.command ?? "");
        const wd = args.workdir ? chalk.gray(` (${args.workdir})`) : "";
        return chalk.cyan("$ ") + truncateOneLine(cmd, 140) + wd;
      }
      case "write": {
        const p = String(args.filePath ?? "");
        const size = typeof args.content === "string" ? Buffer.byteLength(args.content, "utf-8") : 0;
        const kind = existsSync(resolve(p)) ? chalk.yellow("overwrite") : chalk.green("new");
        return chalk.magenta("→ ") + p + chalk.gray(` (${kind}, ${size} bytes)`);
      }
      case "edit": {
        const p = String(args.filePath ?? "");
        const old = String(args.oldString ?? "").split("\n")[0];
        return chalk.magenta("~ ") + p + chalk.gray(" @ ") + truncateOneLine(old, 60);
      }
      case "multi_edit": {
        const p = String(args.filePath ?? "");
        const edits = Array.isArray(args.edits) ? args.edits.length : 0;
        return chalk.magenta("~ ") + p + chalk.gray(` (${edits} edits)`);
      }
      case "read": {
        const p = String(args.filePath ?? "");
        return chalk.blue("📖 ") + p;
      }
      case "grep": {
        const pat = String(args.pattern ?? "");
        const path = args.path ? chalk.gray(` in ${args.path}`) : "";
        return chalk.blue("🔍 ") + truncateOneLine(pat, 80) + path;
      }
      case "glob": {
        const pat = String(args.pattern ?? "");
        return chalk.blue("🗂  ") + pat;
      }
      case "listdir": {
        const p = String(args.path ?? ".");
        return chalk.blue("📁 ") + p;
      }
      case "todo": {
        return chalk.yellow("✎ ") + "update todo list";
      }
      default: {
        const s = JSON.stringify(args);
        return chalk.gray(truncateOneLine(s, 140));
      }
    }
  } catch {
    return chalk.gray(truncateOneLine(JSON.stringify(args), 140));
  }
}

/**
 * Tool result rendering: keeps output terse. The full result is already sent
 * to the LLM; the terminal only needs a compact confirmation for the human.
 * Exceptions: bash (real command output matters), errors (show diagnostics),
 * and edit/write diffs (which the user usually wants to eyeball).
 */
export function renderToolResult(
  name: string,
  output: string,
  error: boolean,
  indent: string = "  ",
  durationMs?: number,
): string {
  const icon = error ? chalk.red("✗ ") : chalk.green("✓ ");
  const dur = typeof durationMs === "number" ? chalk.gray(` ${formatDuration(durationMs)}`) : "";

  // Split diff block if present
  let mainText = output;
  let diffText = "";
  const markerIdx = output.indexOf(DIFF_MARKER);
  if (markerIdx >= 0) {
    mainText = output.slice(0, markerIdx);
    diffText = output.slice(markerIdx + DIFF_MARKER.length);
  }

  // Errors always show full body so the model (and user) can diagnose.
  // Non-error results get a one-line summary for most tools.
  if (!error) {
    const summary = summarizeToolResult(name, mainText);
    if (summary !== null) {
      let result = indent + icon + summary + dur;
      if (diffText) {
        const diffLines = diffText.split("\n").map((l) => indent + "  " + l);
        result += "\n" + diffLines.join("\n");
      }
      return result;
    }
  }

  // Fallback: head/tail preview. Bash gets more lines than the rest.
  const isBash = name === "bash";
  const headMax = isBash ? 25 : 6;
  const tailMax = isBash ? 5 : 0;

  const lines = mainText.split("\n");
  let body: string;
  if (lines.length <= headMax + tailMax + 1) {
    body = lines.join("\n");
  } else {
    const head = lines.slice(0, headMax).join("\n");
    const tail = tailMax > 0 ? "\n" + lines.slice(-tailMax).join("\n") : "";
    const skipped = lines.length - headMax - tailMax;
    body = head + chalk.gray(`\n... (${skipped} more lines)`) + tail;
  }

  // Colorize exit-code markers for bash
  if (isBash) {
    body = body.replace(/\[exit code: (\d+)\]/g, (_m, c) => {
      const n = Number(c);
      return n === 0 ? chalk.green(`[exit ${n}]`) : chalk.red(`[exit ${n}]`);
    });
    body = body.replace(/\[aborted by user\]/g, chalk.yellow("[aborted]"));
    body = body.replace(/\[timeout: (\d+)ms\]/g, (_m, t) => chalk.yellow(`[timeout: ${t}ms]`));
  }

  const bodyLines = body.split("\n").map((l) => indent + chalk.gray(l));
  const first = icon + bodyLines[0].replace(/^\s+/, "");
  const rest = bodyLines.slice(1).join("\n");
  let result = indent + first + dur + (rest ? "\n" + rest : "");

  if (diffText) {
    // Prefix each diff line with indent, keep colors intact
    const diffLines = diffText.split("\n").map((l) => indent + "  " + l);
    result += "\n" + diffLines.join("\n");
  }

  return result;
}

/**
 * One-line summaries for successful tool calls. Returning null means
 * "fall back to the head/tail preview".
 */
function summarizeToolResult(name: string, output: string): string | null {
  const lines = output.split("\n");
  switch (name) {
    case "read": {
      // read output is "N: content" per line. Just report line count.
      const first = lines[0] ?? "";
      const m = /^(\d+):/.exec(first);
      const startsAt = m ? Number(m[1]) : 1;
      const last = [...lines].reverse().find((l) => /^\d+:/.test(l)) ?? "";
      const em = /^(\d+):/.exec(last);
      const endsAt = em ? Number(em[1]) : startsAt + lines.length - 1;
      return chalk.gray(`read ${endsAt - startsAt + 1} lines (${startsAt}-${endsAt})`);
    }
    case "listdir": {
      const entries = lines.filter((l) => l.trim().length > 0);
      const dirs = entries.filter((l) => l.trim().endsWith("/")).length;
      const files = entries.length - dirs;
      return chalk.gray(`${entries.length} entries (${dirs} dirs, ${files} files)`);
    }
    case "glob": {
      const entries = lines.filter((l) => l.trim().length > 0);
      if (entries.length === 0) return chalk.gray("no matches");
      const preview = entries.slice(0, 3).join(chalk.gray(", "));
      const more = entries.length > 3 ? chalk.gray(` (+${entries.length - 3} more)`) : "";
      return chalk.gray(`${entries.length} match${entries.length === 1 ? "" : "es"}: `) + preview + more;
    }
    case "grep": {
      const entries = lines.filter((l) => l.trim().length > 0);
      return chalk.gray(`${entries.length} match${entries.length === 1 ? "" : "es"}`);
    }
    case "todo": {
      // Keep the first line (progress summary) but drop the noisy list.
      const first = lines.find((l) => l.trim().length > 0) ?? "";
      return chalk.gray(first.trim());
    }
    case "write":
    case "edit":
    case "multi_edit": {
      // Keep the concise header line the tool already emits; drop file dumps.
      const first = lines.find((l) => l.trim().length > 0) ?? "done";
      return chalk.gray(first.trim());
    }
    default:
      return null;
  }
}

/**
 * Approval preview — richer than plain JSON. Called before asking y/a/n/s.
 */
export function renderApprovalPreview(name: string, args: Record<string, unknown>): string {
  const bullet = chalk.gray("  ");
  try {
    switch (name) {
      case "bash": {
        const cmd = String(args.command ?? "");
        const wd = args.workdir ? String(args.workdir) : process.cwd();
        return (
          bullet + chalk.cyan("$ ") + cmd + "\n" +
          bullet + chalk.gray("workdir: ") + chalk.gray(wd)
        );
      }
      case "write": {
        const p = resolve(String(args.filePath ?? ""));
        const content = String(args.content ?? "");
        const newBytes = Buffer.byteLength(content, "utf-8");
        const existed = existsSync(p);
        const header = existed
          ? bullet + chalk.magenta("→ ") + p + chalk.yellow(" [overwrite]") + chalk.gray(` ${newBytes} bytes`)
          : bullet + chalk.magenta("→ ") + p + chalk.green(" [new]") + chalk.gray(` ${newBytes} bytes`);
        let diff = "";
        if (existed) {
          try {
            const oldContent = readFileSync(p, "utf-8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
            const newContent = content.replace(/\r\n/g, "\n");
            const dl = computeDiff(oldContent.split("\n"), newContent.split("\n"), 3);
            if (dl.length > 0) {
              diff = "\n" + dl.map((l) => bullet + l).join("\n");
            } else {
              diff = "\n" + bullet + chalk.gray("(no textual change)");
            }
          } catch { /* ignore */ }
        } else {
          // Show first N lines of new content as +
          const preview = content.replace(/\r\n/g, "\n").split("\n").slice(0, 30);
          diff = "\n" + preview.map((l) => bullet + chalk.green(`+ ${l}`)).join("\n");
          if (content.split("\n").length > 30) {
            diff += "\n" + bullet + chalk.gray(`... (${content.split("\n").length - 30} more lines)`);
          }
        }
        return header + diff;
      }
      case "edit": {
        const p = String(args.filePath ?? "");
        const oldS = String(args.oldString ?? "").split("\n");
        const newS = String(args.newString ?? "").split("\n");
        const dl = computeDiff(oldS, newS, 2);
        return (
          bullet + chalk.magenta("~ ") + p + "\n" +
          dl.map((l) => bullet + l).join("\n")
        );
      }
      case "multi_edit": {
        const p = String(args.filePath ?? "");
        const edits = Array.isArray(args.edits) ? args.edits as Array<Record<string, unknown>> : [];
        const parts = [bullet + chalk.magenta("~ ") + p + chalk.gray(` (${edits.length} edits)`)];
        edits.slice(0, 5).forEach((e, i) => {
          const oldS = String(e.oldString ?? "").split("\n");
          const newS = String(e.newString ?? "").split("\n");
          const dl = computeDiff(oldS, newS, 1);
          parts.push(bullet + chalk.cyan(`--- edit ${i + 1} ---`));
          parts.push(dl.map((l) => bullet + l).join("\n"));
        });
        if (edits.length > 5) {
          parts.push(bullet + chalk.gray(`... (${edits.length - 5} more edits)`));
        }
        return parts.join("\n");
      }
      default: {
        const raw = JSON.stringify(args, null, 2);
        const capped = raw.length > 2000 ? raw.slice(0, 2000) + "\n... (truncated)" : raw;
        return capped
          .split("\n")
          .map((l) => bullet + chalk.gray(l))
          .join("\n");
      }
    }
  } catch (err) {
    return bullet + chalk.gray(JSON.stringify(args).slice(0, 500));
  }
}

function truncateOneLine(s: string, max: number): string {
  const oneLine = s.replace(/\r?\n/g, " ↵ ");
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max - 1) + "…";
}

/** Human-friendly duration label. */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** Collapse to a single line and cap the length for summary previews. */
function truncatePreview(s: string, max = 200): string {
  const oneLine = s.replace(/\r?\n/g, " ↵ ").trim();
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max - 1) + "…";
}

/**
 * End-of-task report listing every tool call with its input, output and the
 * time it took. Shown once after a task finishes so the user gets a compact
 * recap of what the agent did.
 */
export function renderTaskSummary(tools: ToolCallLogEntry[]): string {
  if (!tools || tools.length === 0) return "";
  const lines: string[] = [];
  lines.push("");
  lines.push(chalk.bold.cyan("── Task summary ──"));
  let totalMs = 0;
  tools.forEach((t, i) => {
    totalMs += t.durationMs;
    const icon = t.error ? chalk.red("✗") : chalk.green("✓");
    const dur = chalk.gray(formatDuration(t.durationMs));
    lines.push(`  ${chalk.gray(String(i + 1) + ".")} ${icon} ${chalk.bold(t.name)}  ${dur}`);
    const argsJson = truncatePreview(JSON.stringify(t.args), 200);
    lines.push(chalk.gray(`     in:  ${argsJson}`));
    const outText = truncatePreview(t.display ?? t.output, 200);
    lines.push(chalk.gray(`     out: ${outText}`));
  });
  lines.push(chalk.gray(`  ${tools.length} tool call(s) · total ${formatDuration(totalMs)}`));
  return lines.join("\n");
}
