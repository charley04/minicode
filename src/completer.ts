import { readdirSync, statSync, existsSync } from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import { stdout } from "node:process";
import chalk from "chalk";
import { getAllModelStrings, listOpencodeProviders } from "./opencode-config.js";

export interface CommandDef {
  name: string;
  description: string;
  argHint?: string;
  argCompleter?: (line: string) => string[];
}

export function getSlashCommands(): CommandDef[] {
  return [
    { name: "/help", description: "Show help" },
    { name: "/exit", description: "Exit (saves session)" },
    { name: "/quit", description: "Exit (saves session)" },
    { name: "/clear", description: "Clear conversation" },
    {
      name: "/model",
      description: "Switch model",
      argHint: "<provider/model>",
      argCompleter: () => getAllModelStrings(),
    },
    {
      name: "/provider",
      description: "List providers",
      argHint: "",
      argCompleter: () => listOpencodeProviders().map((p) => p.id),
    },
    { name: "/save", description: "Save session" },
    { name: "/session", description: "Show session ID" },
    { name: "/history", description: "Message count" },
    { name: "/tokens", description: "Token usage" },
    { name: "/skills", description: "List skills" },
    { name: "/mcp", description: "MCP servers" },
    { name: "/tools", description: "List tools" },
    { name: "/cost", description: "Cost estimate" },
  ];
}

function completeFilePath(partial: string): string[] {
  if (!partial) return [];

  const dir = dirname(partial);
  const file = basename(partial);

  let searchDir: string;
  try {
    if (
      partial.startsWith("/") ||
      partial.startsWith("./") ||
      partial.startsWith("../")
    ) {
      searchDir = resolve(dir);
    } else if (dir === "." && !partial.includes("/")) {
      return [];
    } else {
      searchDir = resolve(process.cwd(), dir);
    }
  } catch {
    return [];
  }

  if (!existsSync(searchDir)) return [];

  try {
    const entries = readdirSync(searchDir);
    return entries
      .filter((e) => e.toLowerCase().startsWith(file.toLowerCase()))
      .map((e) => {
        const fullPath = dir === "." ? e : join(dir, e);
        try {
          return statSync(join(searchDir, e)).isDirectory()
            ? fullPath + "/"
            : fullPath;
        } catch {
          return fullPath;
        }
      });
  } catch {
    return [];
  }
}

export function createCompleter() {
  const commands = getSlashCommands();

  return function completer(line: string): [string[], string] {
    if (line.startsWith("/")) {
      const parts = line.split(/\s+/);

      if (parts.length === 1) {
        const hits = commands
          .map((c) => c.name)
          .filter((name) => name.startsWith(line));
        return [hits.length ? hits : commands.map((c) => c.name), line];
      }

      const cmd = parts[0];
      const cmdDef = commands.find((c) => c.name === cmd);

      if (cmdDef?.argCompleter) {
        const argLine = parts.slice(1).join(" ");
        const argHits = cmdDef.argCompleter(argLine);
        const fullHits = argHits
          .filter((a) => a.startsWith(argLine))
          .map((a) => `${cmd} ${a}`);
        return [fullHits, line];
      }

      return [[], line];
    }

    const words = line.split(/\s+/);
    const lastWord = words[words.length - 1];

    if (
      lastWord &&
      (lastWord.includes("/") ||
        lastWord.includes("\\") ||
        lastWord.startsWith("./") ||
        lastWord.startsWith("../"))
    ) {
      const pathHits = completeFilePath(lastWord);
      if (pathHits.length > 0) {
        const prefix = words.slice(0, -1).join(" ");
        const fullHits = pathHits.map((p) =>
          prefix ? `${prefix} ${p}` : p,
        );
        return [fullHits, line];
      }
    }

    return [[], line];
  };
}

let hintLineCount = 0;

export function clearHint(): void {
  if (hintLineCount === 0) return;
  stdout.write("\x1b7");
  stdout.write("\x1b[B\x1b[J");
  stdout.write("\x1b8");
  hintLineCount = 0;
}

export function showHint(line: string): void {
  clearHint();

  if (!line.startsWith("/")) return;

  const commands = getSlashCommands();
  const parts = line.split(/\s+/);

  let matches: CommandDef[] = [];

  if (parts.length === 1) {
    matches = commands.filter((c) => c.name.startsWith(line));
    if (matches.length === commands.length) {
      matches = [];
    }
  }

  if (matches.length === 0) return;

  const maxShow = Math.min(matches.length, 10);
  const visible = matches.slice(0, maxShow);

  const hintLines = visible.map((c) => {
    const name = chalk.cyan(c.name.padEnd(14));
    const arg = c.argHint ? chalk.yellow(c.argHint.padEnd(8)) : "        ";
    const desc = chalk.gray(c.description);
    return `  ${name} ${arg} ${desc}`;
  });

  if (matches.length > maxShow) {
    hintLines.push(chalk.gray(`  ... and ${matches.length - maxShow} more`));
  }

  const hint = hintLines.join("\n");

  stdout.write("\x1b7");
  stdout.write("\n" + hint + "\n");
  stdout.write("\x1b8");

  hintLineCount = hintLines.length + 1;
}

export function handleKeyPress(
  _char: string,
  key: { name?: string; ctrl?: boolean; meta?: boolean } | undefined,
  currentLine: string,
): void {
  if (key?.ctrl && key.name === "c") {
    clearHint();
    return;
  }

  if (key?.name === "return" || key?.name === "enter") {
    clearHint();
    return;
  }

  if (key?.name === "tab") {
    clearHint();
    return;
  }

  showHint(currentLine);
}
