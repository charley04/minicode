import type { Tool } from "../types.js";
import { glob as globFn } from "glob";

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
    },
    required: ["pattern"],
  },
  requirePermission: false,
  async execute(args) {
    const pattern = args.pattern as string;
    const path = (args.path as string | undefined) || process.cwd();

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
      const output = matches.slice(0, 200).join("\n");
      const suffix = matches.length > 200 ? `\n... and ${matches.length - 200} more` : "";
      return { output: output + suffix };
    } catch (err: unknown) {
      const error = err as { message: string };
      return { output: `Error: ${error.message}`, error: true };
    }
  },
};
