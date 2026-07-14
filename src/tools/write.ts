import type { Tool } from "../types.js";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const writeTool: Tool = {
  name: "write",
  description:
    "Writes content to a file, creating it if it doesn't exist or overwriting it if it does. Creates parent directories if needed. Use this for new files or complete rewrites. For targeted edits to existing files, use the edit tool instead. When overwriting an existing file, the previous content size is reported. Does NOT add a BOM or trailing newline.",
  parameters: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "The path to the file to write.",
      },
      content: {
        type: "string",
        description: "The full content to write to the file.",
      },
    },
    required: ["filePath", "content"],
  },
  requirePermission: true,
  async execute(args) {
    const filePath = resolve(args.filePath as string);
    const content = args.content as string;

    try {
      const dir = dirname(filePath);
      mkdirSync(dir, { recursive: true });

      let overwriteInfo = "";
      if (existsSync(filePath)) {
        const oldContent = readFileSync(filePath, "utf-8");
        const oldSize = Buffer.byteLength(oldContent, "utf-8");
        const newSize = Buffer.byteLength(content, "utf-8");
        overwriteInfo = ` (overwrote existing file: ${oldSize} -> ${newSize} bytes)`;
      }

      writeFileSync(filePath, content, "utf-8");
      return { output: `Successfully wrote ${Buffer.byteLength(content, "utf-8")} bytes to ${filePath}${overwriteInfo}` };
    } catch (err: unknown) {
      const error = err as { message: string };
      return { output: `Error: ${error.message}`, error: true };
    }
  },
};
