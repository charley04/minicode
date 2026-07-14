import type { Tool } from "../types.js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".svg",
  ".pdf", ".zip", ".tar", ".gz", ".rar", ".7z",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".dat",
  ".mp3", ".mp4", ".avi", ".mov", ".wav", ".flv",
  ".ttf", ".otf", ".woff", ".woff2", ".eot",
  ".lock", ".sum", ".node",
]);

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", ".next", "__pycache__",
  ".cache", ".turbo", "coverage", ".nyc_output",
  ".gradle", "build", "out", ".venv", "venv",
]);

function getExtension(name: string): string {
  const dotIdx = name.lastIndexOf(".");
  if (dotIdx <= 0) return "";
  return name.substring(dotIdx).toLowerCase();
}

export const grepTool: Tool = {
  name: "grep",
  description:
    "Searches file contents using a regular expression. Returns matching file paths and line numbers with the matching lines. Searches recursively, skipping node_modules, .git, dist, and other common ignore dirs. Use 'include' to filter by extension (e.g. '*.ts'). Binary files are automatically skipped. Case-insensitive by default.",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "The regular expression pattern to search for.",
      },
      path: {
        type: "string",
        description: "The directory to search in. Defaults to current working directory.",
      },
      include: {
        type: "string",
        description: "File extension to include (e.g. '*.ts', '*.js'). If omitted, searches all text file types.",
      },
    },
    required: ["pattern"],
  },
  requirePermission: false,
  async execute(args) {
    const pattern = args.pattern as string;
    const searchPath = (args.path as string | undefined) || process.cwd();
    const include = args.include as string | undefined;

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, "i");
    } catch {
      return { output: `Error: Invalid regex pattern: ${pattern}`, error: true };
    }

    const results: string[] = [];
    const maxResults = 200;

    function searchDir(dir: string, depth: number) {
      if (depth > 15 || results.length >= maxResults) return;

      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }

      for (const entry of entries) {
        if (results.length >= maxResults) return;

        const fullPath = join(dir, entry);
        let stat;
        try {
          stat = statSync(fullPath);
        } catch {
          continue;
        }

        if (stat.isDirectory()) {
          if (!IGNORE_DIRS.has(entry)) {
            searchDir(fullPath, depth + 1);
          }
        } else {
          // Skip binary files by extension
          const ext = getExtension(entry);
          if (ext && BINARY_EXTENSIONS.has(ext)) continue;

          // Filter by include pattern
          if (include) {
            const filterExt = include.replace(/^\*\./, "");
            if (!entry.toLowerCase().endsWith("." + filterExt)) continue;
          }

          let content: string;
          try {
            const buf = readFileSync(fullPath);
            // Check for binary content (null bytes in first 8KB)
            const checkLen = Math.min(buf.length, 8192);
            let isBinary = false;
            for (let i = 0; i < checkLen; i++) {
              if (buf[i] === 0) { isBinary = true; break; }
            }
            if (isBinary) continue;
            content = buf.toString("utf-8");
          } catch {
            continue;
          }

          const lines = content.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              const relPath = relative(searchPath, fullPath) || fullPath;
              const truncated = lines[i].length > 200 ? lines[i].slice(0, 200) + "..." : lines[i];
              results.push(`${relPath}:${i + 1}: ${truncated.trim()}`);
              if (results.length >= maxResults) return;
            }
          }
        }
      }
    }

    searchDir(searchPath, 0);

    if (results.length === 0) {
      return { output: "No matches found." };
    }

    let output = results.join("\n");
    if (results.length >= maxResults) {
      output += `\n... (results truncated at ${maxResults})`;
    }
    return { output };
  },
};
