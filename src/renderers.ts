import chalk from "chalk";
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
 * Tool result rendering: splits off any diff block emitted by edit/write,
 * shows a bounded preview of the plain text, and prints the diff verbatim
 * (already colorized by computeDiff).
 */
export function renderToolResult(
  name: string,
  output: string,
  error: boolean,
  indent: string = "  ",
): string {
  const icon = error ? chalk.red("✗ ") : chalk.green("✓ ");

  // Split diff block if present
  let mainText = output;
  let diffText = "";
  const markerIdx = output.indexOf(DIFF_MARKER);
  if (markerIdx >= 0) {
    mainText = output.slice(0, markerIdx);
    diffText = output.slice(markerIdx + DIFF_MARKER.length);
  }

  // Bash gets more lines; others are terser.
  const isBash = name === "bash";
  const headMax = isBash ? 25 : 12;
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
  let result = indent + first + (rest ? "\n" + rest : "");

  if (diffText) {
    // Prefix each diff line with indent, keep colors intact
    const diffLines = diffText.split("\n").map((l) => indent + "  " + l);
    result += "\n" + diffLines.join("\n");
  }

  return result;
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
