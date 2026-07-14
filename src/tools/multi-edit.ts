import type { Tool } from "../types.js";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface SingleEdit {
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

export const multiEditTool: Tool = {
  name: "multi_edit",
  description:
    "Applies multiple edits to a single file in one call. Each edit replaces an exact text match. Edits are applied sequentially (top to bottom), so earlier edits can affect the text that later edits match. Use this when you need to make several changes to the same file — it's more efficient than calling edit multiple times. Always read the file first.",
  parameters: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "The path to the file to edit.",
      },
      edits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            oldString: {
              type: "string",
              description: "The exact text to find. Must match file content without line number prefixes from the read tool.",
            },
            newString: {
              type: "string",
              description: "The replacement text.",
            },
            replaceAll: {
              type: "boolean",
              description: "If true, replace all occurrences of oldString. Defaults to false.",
            },
          },
          required: ["oldString", "newString"],
        },
        description: "Array of edits to apply sequentially.",
      },
    },
    required: ["filePath", "edits"],
  },
  requirePermission: true,
  async execute(args) {
    const filePath = resolve(args.filePath as string);
    const edits = args.edits as SingleEdit[] | undefined;

    if (!Array.isArray(edits) || edits.length === 0) {
      return { output: "Error: 'edits' must be a non-empty array.", error: true };
    }

    try {
      let content = readFileSync(filePath, "utf-8");
      const hasBOM = content.charCodeAt(0) === 0xfeff;
      if (hasBOM) content = content.slice(1);

      const results: string[] = [];
      let totalReplacements = 0;

      for (let i = 0; i < edits.length; i++) {
        const edit = edits[i];
        const oldStr = edit.oldString;
        const newStr = edit.newString;
        const replaceAll = edit.replaceAll ?? false;

        if (oldStr === newStr) {
          results.push(`  Edit ${i + 1}: skipped (oldString === newString)`);
          continue;
        }

        const occurrences = content.split(oldStr).length - 1;

        if (occurrences === 0) {
          results.push(`  Edit ${i + 1}: FAILED — oldString not found`);
          return {
            output: `Error: Edit ${i + 1} failed — oldString not found in file. No changes were written.\n${results.join("\n")}`,
            error: true,
          };
        }

        if (occurrences > 1 && !replaceAll) {
          results.push(`  Edit ${i + 1}: FAILED — ${occurrences} matches found (need unique match or replaceAll)`);
          return {
            output: `Error: Edit ${i + 1} failed — ${occurrences} matches found. No changes were written.\n${results.join("\n")}`,
            error: true,
          };
        }

        if (replaceAll) {
          content = content.split(oldStr).join(newStr);
          results.push(`  Edit ${i + 1}: ${occurrences} replacement(s)`);
          totalReplacements += occurrences;
        } else {
          const idx = content.indexOf(oldStr);
          content = content.slice(0, idx) + newStr + content.slice(idx + oldStr.length);
          results.push(`  Edit ${i + 1}: 1 replacement`);
          totalReplacements += 1;
        }
      }

      if (hasBOM) content = "\uFEFF" + content;
      writeFileSync(filePath, content, "utf-8");

      return {
        output: `Successfully applied ${edits.length} edit(s) (${totalReplacements} total replacements) to ${filePath}.\n${results.join("\n")}`,
      };
    } catch (err: unknown) {
      const error = err as { code?: string; message: string };
      if (error.code === "ENOENT") {
        return { output: `Error: File not found: ${filePath}`, error: true };
      }
      return { output: `Error: ${error.message}`, error: true };
    }
  },
};
