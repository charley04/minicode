import { readdirSync, statSync, existsSync } from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import { stdout } from "node:process";
import chalk from "chalk";
import { getAllModelStrings, listOpencodeProviders } from "./opencode-config.js";

export interface CommandDef {
  name: string;
  description: string;
  zhDescription: string;
  argHint?: string;
  argCompleter?: (line: string) => string[];
}

export function getSlashCommands(): CommandDef[] {
  return [
    { name: "/help", description: "Show help", zhDescription: "显示帮助信息" },
    { name: "/status", description: "Show current model & session state", zhDescription: "显示当前模型与会话状态" },
    { name: "/exit", description: "Exit (saves session)", zhDescription: "退出（保存会话）" },
    { name: "/quit", description: "Exit (saves session)", zhDescription: "退出（保存会话）" },
    { name: "/clear", description: "Clear conversation", zhDescription: "清空对话历史" },
    {
      name: "/model",
      description: "Switch model",
      zhDescription: "切换模型",
      argHint: "<provider/model>",
      argCompleter: () => getAllModelStrings(),
    },
    {
      name: "/provider",
      description: "List providers",
      zhDescription: "列出所有模型提供商",
      argHint: "",
      argCompleter: () => listOpencodeProviders().map((p) => p.id),
    },
    { name: "/save", description: "Save session", zhDescription: "手动保存会话" },
    { name: "/session", description: "Show session ID", zhDescription: "显示会话ID" },
    { name: "/history", description: "Message count", zhDescription: "显示消息数量" },
    { name: "/tokens", description: "Token usage", zhDescription: "显示Token用量统计" },
    { name: "/skills", description: "List skills", zhDescription: "列出已加载的技能" },
    { name: "/connect", description: "Connect a third-party API provider", zhDescription: "接入第三方API" },
    { name: "/mcp", description: "MCP servers", zhDescription: "列出MCP服务器与工具" },
    { name: "/tools", description: "List tools", zhDescription: "列出所有可用工具" },
    { name: "/cost", description: "Cost estimate", zhDescription: "估算会话费用" },
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
let lastHintLine = "";

export function clearHint(): void {
  if (hintLineCount === 0) return;
  stdout.write("\x1b7");            // save cursor
  stdout.write("\x1b[B\x1b[G\x1b[J"); // move down one line, go to start of line, clear to end of screen
  stdout.write("\x1b8");             // restore cursor
  hintLineCount = 0;
  lastHintLine = "";
}

export function showHint(line: string): void {
  // Always clear previous hint first to ensure sync
  clearHint();

  if (!line.startsWith("/")) return;

  // Placeholder tokens (e.g. [📋 ...]) should not trigger command hints.
  if (line.includes("[📋") || line.includes("[paste#")) return;

  const commands = getSlashCommands();
  const parts = line.split(/\s+/);

  let matches: CommandDef[] = [];

  if (parts.length === 1) {
    // Show all slash commands as soon as user types "/".
    matches = commands.filter((c) => c.name.startsWith(line));
  }

  if (matches.length === 0) return;

  const maxShow = 20;
  const visible = matches.slice(0, maxShow);

  // Build a single-line inline hint to avoid breaking input
  const hintParts = visible.map((c) => {
    const name = chalk.cyan(c.name);
    const desc = c.zhDescription;
    return `${name}:${desc}`;
  });

  const hint = hintParts.join("  ");
  lastHintLine = hint;

  // Use inline display: save cursor, move down one line, write hint, restore cursor
  // This keeps the input on its original line
  stdout.write("\x1b7");
  stdout.write("\n");
  stdout.write(chalk.gray("  " + hint));
  stdout.write("\x1b8");

  hintLineCount = 1; // Always use 1 line for cleaner display
}

export function handleKeyPress(
  char: string | undefined,
  key: { name?: string; ctrl?: boolean; meta?: boolean; sequence?: string } | undefined,
  currentLine: string,
): void {
  // Handle backspace/delete: update hint dynamically
  if (key?.name === "backspace" || key?.name === "delete") {
    // After backspace, re-evaluate and show appropriate hint or clear
    // Use a small delay to let readline update the line buffer
    setTimeout(() => showHint(currentLine), 10);
    return;
  }

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

  // For printable characters, show the hint for the line including the
  // just-typed character. If readline already updated rl.line, currentLine
  // already ends with char, so we must avoid doubling it.
  if (char && char.length > 0 && !key?.ctrl && !key?.meta) {
    const line = currentLine.endsWith(char) ? currentLine : currentLine + char;
    showHint(line);
  } else {
    showHint(currentLine);
  }
}
