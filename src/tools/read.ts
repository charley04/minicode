import type { Tool } from "../types.js";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { estimateTokens, truncateLinesToTokenBudget } from "../token-estimator.js";

export const readTool: Tool = {
  name: "read",
  description:
    "Reads the contents of a file. Returns content with line number prefixes (e.g. '1: code'). IMPORTANT: When using edit/multi_edit after read, strip the 'N: ' prefix — the edit tool expects actual file content without line numbers. Supports offset/limit for large files. Set full=true to read without line number prefixes (useful when you need to copy exact content for edit oldString). Lines longer than 2000 chars are truncated. For large files (>500 lines), use offset/limit to read in chunks. Set maxTokens to automatically truncate output to fit within a token budget.",
  parameters: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "The absolute or relative path to the file to read.",
      },
      offset: {
        type: "number",
        description: "Line number to start reading from (1-indexed). Defaults to 1.",
      },
      limit: {
        type: "number",
        description: "Maximum number of lines to read. Defaults to 2000.",
      },
      full: {
        type: "boolean",
        description: "If true, return raw file content WITHOUT line number prefixes. Useful when you need exact content for edit tool matching. Defaults to false.",
      },
      maxTokens: {
        type: "number",
        description: "Maximum estimated tokens for the output. If set, the output will be truncated (head/tail) to fit within this budget. Helps manage context window usage.",
      },
    },
    required: ["filePath"],
  },
  requirePermission: false,
  async execute(args) {
    const filePath = resolve(args.filePath as string);
    const offset = (args.offset as number | undefined) ?? 1;
    const limit = (args.limit as number | undefined) ?? 2000;
    const full = (args.full as boolean | undefined) ?? false;
    const maxTokens = args.maxTokens as number | undefined;

    try {
      const stat = statSync(filePath);
      if (stat.isDirectory()) {
        return { output: `Error: ${filePath} is a directory, not a file. Use listdir instead.`, error: true };
      }

      let content = readFileSync(filePath, "utf-8");

      // Strip BOM for display
      if (content.charCodeAt(0) === 0xfeff) {
        content = content.slice(1);
      }

      // Normalize line endings
      content = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

      const lines = content.split("\n");

      // Remove trailing empty line from final newline
      if (lines.length > 1 && lines[lines.length - 1] === "") {
        lines.pop();
      }

      const totalLines = lines.length;

      // For very large files, suggest chunked reading
      if (totalLines > 500 && offset === 1 && limit === 2000) {
        // Still return the data, but note the size
      }

      const start = Math.max(0, offset - 1);
      const end = Math.min(totalLines, start + limit);
      const selected = lines.slice(start, end);

      if (full) {
        const truncated = selected.map((line) =>
          line.length > 2000 ? line.slice(0, 2000) + "..." : line,
        );
        const result = truncated.join("\n") || "(empty file)";
        // Append summary for large files
        if (totalLines > end) {
          return { output: result + `\n\n(showing lines ${start + 1}-${end} of ${totalLines}. Use offset=${end + 1} to read more.)` };
        }
        return { output: result };
      }

      const formatted = selected
        .map((line, i) => {
          const lineNum = start + i + 1;
          const truncated = line.length > 2000 ? line.slice(0, 2000) + "..." : line;
          return `${lineNum}: ${truncated}`;
        })
        .join("\n");

      let output = formatted || "(empty file)";
      if (totalLines > end) {
        output += `\n\n(showing lines ${start + 1}-${end} of ${totalLines}. Use offset=${end + 1} to read more.)`;
      }

      // Apply maxTokens truncation if requested
      if (maxTokens && maxTokens > 0) {
        const estimatedTok = estimateTokens(output);
        if (estimatedTok > maxTokens) {
          const lines = output.split("\n");
          const headKeep = Math.max(10, Math.floor(lines.length * 0.6));
          const tailKeep = Math.max(3, Math.floor(lines.length * 0.1));
          const result = truncateLinesToTokenBudget(lines, maxTokens, headKeep, tailKeep);
          output = result.lines.join("\n");
          if (result.note) {
            output += `\n${result.note}`;
          }
        }
      }

      return { output };
    } catch (err: unknown) {
      const error = err as { code?: string; message: string };
      if (error.code === "ENOENT") {
        return { output: `Error: File not found: ${filePath}`, error: true };
      }
      return { output: `Error: ${error.message}`, error: true };
    }
  },
};
