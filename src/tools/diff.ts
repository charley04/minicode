import type { Tool } from "../types.js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export const diffTool: Tool = {
  name: "diff",
  description:
    "Shows the difference between two files, or between a file and a string of content. Useful for reviewing changes before applying them, or comparing two versions of a file. Returns a unified diff format with line numbers.",
  parameters: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "The path to the file to compare.",
      },
      content: {
        type: "string",
        description: "The new content to compare against the file. If omitted, compares filePath against oldFilePath.",
      },
      oldFilePath: {
        type: "string",
        description: "A second file to compare against. Use this to compare two files. If 'content' is provided, this is ignored.",
      },
      contextLines: {
        type: "number",
        description: "Number of context lines to show around each change. Defaults to 3.",
      },
    },
    required: ["filePath"],
  },
  requirePermission: false,
  async execute(args) {
    const filePath = resolve(args.filePath as string);
    const contextLines = (args.contextLines as number | undefined) ?? 3;

    try {
      if (!existsSync(filePath)) {
        return { output: `Error: File not found: ${filePath}`, error: true };
      }

      const oldContent = readFileSync(filePath, "utf-8")
        .replace(/^\uFEFF/, "")
        .replace(/\r\n/g, "\n");
      const oldLines = oldContent.split("\n");

      let newLines: string[];

      if (args.content !== undefined) {
        const newContent = (args.content as string).replace(/\r\n/g, "\n");
        newLines = newContent.split("\n");
      } else if (args.oldFilePath) {
        const oldPath2 = resolve(args.oldFilePath as string);
        if (!existsSync(oldPath2)) {
          return { output: `Error: File not found: ${oldPath2}`, error: true };
        }
        const content2 = readFileSync(oldPath2, "utf-8")
          .replace(/^\uFEFF/, "")
          .replace(/\r\n/g, "\n");
        newLines = content2.split("\n");
      } else {
        return { output: "Error: Provide either 'content' or 'oldFilePath' to compare against.", error: true };
      }

      const diff = computeDiff(oldLines, newLines, contextLines);

      if (diff.length === 0) {
        return { output: "Files are identical — no differences found." };
      }

      return { output: diff.join("\n") };
    } catch (err: unknown) {
      const error = err as { message: string };
      return { output: `Error: ${error.message}`, error: true };
    }
  },
};

function computeDiff(oldLines: string[], newLines: string[], context: number): string[] {
  // Simple LCS-based diff
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS table
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Backtrack to find diff entries
  interface DiffEntry {
    type: "context" | "add" | "del";
    oldLine: number;
    newLine: number;
    content: string;
  }

  const entries: DiffEntry[] = [];
  let i = 0;
  let j = 0;

  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      entries.push({ type: "context", oldLine: i + 1, newLine: j + 1, content: oldLines[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      entries.push({ type: "del", oldLine: i + 1, newLine: j, content: oldLines[i] });
      i++;
    } else {
      entries.push({ type: "add", oldLine: i, newLine: j + 1, content: newLines[j] });
      j++;
    }
  }

  while (i < m) {
    entries.push({ type: "del", oldLine: i + 1, newLine: n, content: oldLines[i] });
    i++;
  }

  while (j < n) {
    entries.push({ type: "add", oldLine: m, newLine: j + 1, content: newLines[j] });
    j++;
  }

  // Find change hunks (consecutive non-context lines)
  const hunks: Array<{ start: number; end: number }> = [];
  let inHunk = false;
  let hunkStart = 0;

  for (let k = 0; k < entries.length; k++) {
    if (entries[k].type !== "context") {
      if (!inHunk) {
        hunkStart = Math.max(0, k - context);
        inHunk = true;
      }
    } else {
      if (inHunk) {
        // Check if we've had enough context
        let contextCount = 0;
        let end = k;
        for (let l = k; l < entries.length; l++) {
          if (entries[l].type === "context") {
            contextCount++;
            if (contextCount >= context) {
              end = l + 1;
              break;
            }
          } else {
            contextCount = 0;
            end = l + 1;
          }
        }
        hunks.push({ start: hunkStart, end });
        inHunk = false;
      }
    }
  }

  if (inHunk) {
    hunks.push({ start: hunkStart, end: entries.length });
  }

  // Render hunks
  const output: string[] = [];
  const colors = {
    add: (s: string) => `\x1b[32m${s}\x1b[0m`,
    del: (s: string) => `\x1b[31m${s}\x1b[0m`,
    context: (s: string) => `\x1b[90m${s}\x1b[0m`,
    hunkHeader: (s: string) => `\x1b[36m${s}\x1b[0m`,
  };

  for (const hunk of hunks) {
    const hunkEntries = entries.slice(hunk.start, hunk.end);
    if (hunkEntries.length === 0) continue;

    // Skip if all context
    if (hunkEntries.every((e) => e.type === "context")) continue;

    const firstOld = hunkEntries[0].oldLine || 1;
    const firstNew = hunkEntries[0].newLine || 1;
    const oldCount = hunkEntries.filter((e) => e.type !== "add").length;
    const newCount = hunkEntries.filter((e) => e.type !== "del").length;

    output.push(colors.hunkHeader(`@@ -${firstOld},${oldCount} +${firstNew},${newCount} @@`));

    for (const entry of hunkEntries) {
      const prefix = entry.type === "add" ? "+" : entry.type === "del" ? "-" : " ";
      const line = `${prefix} ${entry.content}`;

      if (entry.type === "add") {
        output.push(colors.add(line));
      } else if (entry.type === "del") {
        output.push(colors.del(line));
      } else {
        output.push(colors.context(line));
      }
    }
  }

  return output;
}
