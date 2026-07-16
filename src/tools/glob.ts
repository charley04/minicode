import type { Tool } from "../types.js";
import { glob as globFn } from "glob";
import { estimateTokens, truncateToTokenBudget } from "../token-estimator.js";

export const globTool: Tool = {
  name: "glob",
  description:
    "Finds files matching a glob pattern (e.g. '**/*.ts', 'src/**/*.js', '*.json'). Returns matching file paths. Use this to find files by name pattern. Supports ** for recursive matching.",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "The glob pattern to match files against (e.g. '**/*.ts', 'src/**/*.{js,ts}').",
      },
      path: {
        type: "string",
        description: "The directory to search in. Defaults to current working directory.",
      },
      maxTokens: {
        type: "number",
        description: "Maximum estimated tokens for the output. If set, results will be truncated to fit within this budget. Helps manage context window usage.",
      },
    },
    required: ["pattern"],
  },
  requirePermission: false,
  async execute(args) {
    const pattern = args.pattern as string;
    const path = (args.path as string | undefined) || process.cwd();
    const maxTokens = args.maxTokens as number | undefined;

    try {
      const matches = await globFn(pattern, {
        cwd: path,
        ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
        nodir: true,
      });

      if (matches.length === 0) {
        return { output: "No files found matching the pattern." };
      }

      matches.sort();
      let output = matches.slice(0, 200).join("\n");
      const suffix = matches.length > 200 ? `\n... and ${matches.length - 200} more` : "";

      // Apply maxTokens truncation if requested
      if (maxTokens && maxTokens > 0) {
        const estimatedTok = estimateTokens(output + suffix);
        if (estimatedTok > maxTokens) {
          const { truncated, note } = truncateToTokenBudget(output + suffix, maxTokens);
          output = truncated;
          if (note) output += `\n${note}`;
        } else {
          output = output + suffix;
        }
      } else {
        output = output + suffix;
      }

      return { output };
    } catch (err: unknown) {
      const error = err as { message: string };
      return { output: `Error: ${error.message}`, error: true };
    }
  },
};
