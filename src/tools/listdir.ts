import type { Tool } from "../types.js";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { estimateTokens, truncateToTokenBudget } from "../token-estimator.js";

export const listdirTool: Tool = {
  name: "listdir",
  description:
    "Lists the contents of a directory. Returns entries with type indicators (/ for directories). Useful for understanding project structure. Use glob or grep for more targeted file searches.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The directory path to list. Defaults to current working directory.",
      },
      maxTokens: {
        type: "number",
        description: "Maximum estimated tokens for the output. If set, results will be truncated to fit within this budget. Helps manage context window usage.",
      },
    },
    required: [],
  },
  requirePermission: false,
  async execute(args) {
    const path = (args.path as string | undefined) || process.cwd();
    const maxTokens = args.maxTokens as number | undefined;

    try {
      const stat = statSync(path);
      if (!stat.isDirectory()) {
        return { output: `Error: ${path} is not a directory.`, error: true };
      }

      const entries = readdirSync(path, { withFileTypes: true });
      const formatted = entries
        .map((entry) => {
          const isDir = entry.isDirectory();
          return `${entry.name}${isDir ? "/" : ""}`;
        })
        .sort((a, b) => {
          const aDir = a.endsWith("/");
          const bDir = b.endsWith("/");
          if (aDir !== bDir) return aDir ? -1 : 1;
          return a.localeCompare(b);
        });

      let output = formatted.join("\n") || "(empty directory)";

      // Apply maxTokens truncation if requested
      if (maxTokens && maxTokens > 0) {
        const estimatedTok = estimateTokens(output);
        if (estimatedTok > maxTokens) {
          const { truncated, note } = truncateToTokenBudget(output, maxTokens);
          output = truncated;
          if (note) output += `\n${note}`;
        }
      }

      return { output };
    } catch (err: unknown) {
      const error = err as { code?: string; message: string };
      if (error.code === "ENOENT") {
        return { output: `Error: Directory not found: ${path}`, error: true };
      }
      return { output: `Error: ${error.message}`, error: true };
    }
  },
};
