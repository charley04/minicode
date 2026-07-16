import type { Tool } from "../types.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { computeDiff } from "./diff.js";
import { DIFF_MARKER } from "./write.js";

export const editTool: Tool = {
  name: "edit",
  description:
    "Edits a file by replacing an exact text match (oldString) with new text (newString). The oldString must appear exactly once in the file (use replaceAll=true for multiple). Always read the file first. The oldString must be the ACTUAL file content WITHOUT line number prefixes — if you used the read tool with default mode, strip the 'N: ' prefix. Or use read with full=true to get raw content without line numbers. If exact match fails, the tool will attempt a whitespace-normalized fuzzy match and report the closest match.",
  parameters: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "The path to the file to edit.",
      },
      oldString: {
        type: "string",
        description: "The exact text to find. Must match exactly including whitespace. Do NOT include line number prefixes from the read tool.",
      },
      newString: {
        type: "string",
        description: "The replacement text. Must be different from oldString.",
      },
      replaceAll: {
        type: "boolean",
        description: "If true, replace all occurrences. Defaults to false.",
      },
    },
    required: ["filePath", "oldString", "newString"],
  },
  requirePermission: true,
  async execute(args) {
    const filePath = resolve(args.filePath as string);
    const oldString = args.oldString as string;
    const newString = args.newString as string;
    const replaceAll = (args.replaceAll as boolean | undefined) ?? false;

    try {
      let content = readFileSync(filePath, "utf-8");

      const hasBOM = content.charCodeAt(0) === 0xfeff;
      if (hasBOM) content = content.slice(1);

      if (oldString === newString) {
        return { output: "Error: oldString and newString are identical.", error: true };
      }

      let occurrences = content.split(oldString).length - 1;

      // Fallback: try whitespace-normalized matching if exact match fails
      let usedFuzzy = false;
      let normalizedContent = content;

      if (occurrences === 0) {
        const fuzzyResult = tryFuzzyMatch(content, oldString);
        if (fuzzyResult) {
          normalizedContent = fuzzyResult.normalizedContent;
          occurrences = fuzzyResult.count;
          usedFuzzy = true;
        }
      }

      if (occurrences === 0) {
        const hint = findSimilarContent(content, oldString);
        return {
          output: `Error: oldString not found in ${filePath}.\n${hint}`,
          error: true,
        };
      }

      if (occurrences > 1 && !replaceAll) {
        return {
          output: `Error: Found ${occurrences} matches for oldString. Provide more surrounding context to make it unique, or set replaceAll=true.`,
          error: true,
        };
      }

      // Compute line numbers for summary
      const workingContent = usedFuzzy ? normalizedContent : content;
      const matchIdx = workingContent.indexOf(usedFuzzy ? normalizeWhitespace(oldString) : oldString);
      const beforeMatch = workingContent.slice(0, matchIdx >= 0 ? matchIdx : 0);
      const startLine = beforeMatch.split("\n").length;
      const oldNumLines = oldString.split("\n").length;
      const newNumLines = newString.split("\n").length;
      const endLine = startLine + oldNumLines - 1;

      let newContent: string;
      if (usedFuzzy) {
        // For fuzzy matches, replace the normalized oldString
        const normalizedOld = normalizeWhitespace(oldString);
        if (replaceAll) {
          newContent = workingContent.split(normalizedOld).join(newString);
        } else {
          const idx = workingContent.indexOf(normalizedOld);
          newContent = workingContent.slice(0, idx) + newString + workingContent.slice(idx + normalizedOld.length);
        }
      } else if (replaceAll) {
        newContent = content.split(oldString).join(newString);
      } else {
        const idx = content.indexOf(oldString);
        newContent = content.slice(0, idx) + newString + content.slice(idx + oldString.length);
      }

      if (hasBOM) {
        newContent = "\uFEFF" + newContent;
      }

      writeFileSync(filePath, newContent, "utf-8");

      const count = replaceAll ? occurrences : 1;
      const lineInfo = replaceAll
        ? `${count} replacements`
        : `lines ${startLine}-${endLine}`;
      const fuzzyNote = usedFuzzy ? " (matched via whitespace-normalized fallback)" : "";

      // Build a small colored diff for the UI. NOT sent to the LLM — otherwise
      // the model tends to echo the diff back in its next reply.
      const oldSnippet = oldString.split("\n");
      const newSnippet = newString.split("\n");
      const diffLines = computeDiff(oldSnippet, newSnippet, 2);
      const summary = `Edited ${filePath} (${lineInfo}). Changed ${oldNumLines} line(s) to ${newNumLines} line(s)${fuzzyNote}.`;
      const display = diffLines.length > 0
        ? summary + DIFF_MARKER + `\x1b[36m@@ ${filePath} (${lineInfo}) @@\x1b[0m\n` + diffLines.join("\n")
        : summary;

      return { output: summary, display };
    } catch (err: unknown) {
      const error = err as { code?: string; message: string };
      if (error.code === "ENOENT") {
        return { output: `Error: File not found: ${filePath}`, error: true };
      }
      return { output: `Error: ${error.message}`, error: true };
    }
  },
};

function normalizeWhitespace(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[ \t]+/g, " ").trim();
}

function tryFuzzyMatch(content: string, oldString: string): { normalizedContent: string; count: number } | null {
  const normalizedContent = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const normalizedOld = normalizeWhitespace(oldString);

  if (!normalizedOld || normalizedOld.length < 5) return null;

  // Also try normalizing the content's whitespace for matching
  const wsNormalizedContent = normalizedContent.replace(/[ \t]+/g, " ");
  const count = wsNormalizedContent.split(normalizedOld).length - 1;

  if (count > 0) {
    return { normalizedContent: wsNormalizedContent, count };
  }
  return null;
}

function findSimilarContent(content: string, oldString: string): string {
  const lines = oldString.split("\n");
  if (lines.length === 0) return "";

  const firstLine = lines[0].trim();
  if (firstLine.length < 3) return "";

  const contentLines = content.split("\n");
  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].includes(firstLine)) {
      const start = Math.max(0, i - 1);
      const end = Math.min(contentLines.length, i + lines.length + 1);
      const context = contentLines
        .slice(start, end)
        .map((l, j) => `${start + j + 1}: ${l}`)
        .join("\n");
      return `Hint: Similar line found at line ${i + 1}. Surrounding content:\n${context}\n\nMake sure oldString matches exactly (no line number prefixes). Consider using read with full=true to get raw content.`;
    }
  }
  return "";
}
