import { stdin, stdout } from "node:process";
import type { Interface } from "node:readline";
import chalk from "chalk";
import { listOpencodeProviders } from "./opencode-config.js";

interface ModelEntry {
  fullId: string;
  providerId: string;
  modelId: string;
  providerName: string;
  modelName: string;
  context?: number;
  hasKey: boolean;
}

export async function showModelPicker(currentModel: string, rl?: Interface): Promise<string | null> {
  const entries = collectModels();
  if (entries.length === 0) {
    console.log(chalk.gray("\n  No models found in opencode config.\n"));
    return null;
  }

  if (!stdin.isTTY) {
    console.log(chalk.gray("\n  Available models:\n"));
    for (const e of entries) {
      const active = e.fullId === currentModel ? chalk.green("← ") : "  ";
      const ctx = e.context ? chalk.gray(` (${Math.round(e.context / 1000)}K)`) : "";
      console.log(`  ${active}${e.fullId}${ctx}`);
    }
    console.log(chalk.gray("\n  Use /model <provider/model> to switch\n"));
    return null;
  }

  // Pause readline so it doesn't interfere with our raw stdin handling
  if (rl) {
    rl.pause();
  }

  const result = await runPicker(entries, currentModel);

  // Resume readline
  if (rl) {
    rl.resume();
    rl.prompt();
  }

  return result;
}

function runPicker(entries: ModelEntry[], currentModel: string): Promise<string | null> {
  return new Promise((resolve) => {
    let filter = "";
    let selectedIdx = 0;
    let scrollOffset = 0;
    const maxVisible = Math.min(15, entries.length);

    const sorted = [...entries].sort((a, b) => {
      if (a.fullId === currentModel) return -1;
      if (b.fullId === currentModel) return 1;
      return a.fullId.localeCompare(b.fullId);
    });

    function getFiltered(): ModelEntry[] {
      if (!filter) return sorted;
      const f = filter.toLowerCase();
      return sorted.filter(
        (e) =>
          e.fullId.toLowerCase().includes(f) ||
          e.modelName.toLowerCase().includes(f) ||
          e.providerId.toLowerCase().includes(f),
      );
    }

    // Save original raw mode state
    const wasRaw = stdin.isRaw ?? false;
    stdin.setRawMode(true);
    stdin.pause();
    stdin.resume();

    // Enable mouse tracking (SGR mode)
    stdout.write("\x1b[?1000h\x1b[?1006h\x1b[?1015h");
    stdout.write("\x1b[?25l"); // hide cursor

    function restore(): void {
      stdout.write("\x1b[?25h"); // show cursor
      stdout.write("\x1b[?1000l\x1b[?1006l\x1b[?1015l"); // disable mouse
      if (!wasRaw) stdin.setRawMode(false);
    }

    function finish(result: string | null): void {
      // CRITICAL: remove our data listener before restoring
      stdin.removeListener("data", onData);
      restore();
      // Clear the picker area
      const filtered = getFiltered();
      const totalLines = 5 + Math.min(filtered.length, maxVisible) + 1;
      stdout.write(`\x1b[${totalLines}A\x1b[J`);
      resolve(result);
    }

    function render(): void {
      const filtered = getFiltered();
      const total = filtered.length;

      if (selectedIdx < scrollOffset) scrollOffset = selectedIdx;
      if (selectedIdx >= scrollOffset + maxVisible) scrollOffset = selectedIdx - maxVisible + 1;

      const visible = filtered.slice(scrollOffset, scrollOffset + maxVisible);
      const width = 58;

      // Move cursor to top of picker and clear
      const lineCount = 5 + maxVisible + 1;
      stdout.write(`\x1b[${lineCount}A\x1b[J`);

      // Box top
      const title = " Select Model ";
      const titleLine = chalk.cyan("  ┌") + chalk.cyan.bold(title) + chalk.cyan("─".repeat(Math.max(0, width - title.length - 1)) + "┐");

      // Search line
      const searchLabel = chalk.gray("  │ ") + chalk.gray("Search: ");
      const searchVal = filter ? chalk.yellow(filter) : chalk.gray.dim("type to filter...");
      const searchPad = " ".repeat(Math.max(0, width - 10 - filter.length - 2));
      const searchLine = searchLabel + searchVal + chalk.gray(searchPad + "│");

      // Separator
      const sepLine = chalk.cyan("  ├") + chalk.cyan("─".repeat(width) + "┤");

      stdout.write(titleLine + "\n");
      stdout.write(searchLine + "\n");
      stdout.write(sepLine + "\n");

      // Model lines
      for (let i = 0; i < maxVisible; i++) {
        if (i < visible.length) {
          const entry = visible[i];
          const realIdx = scrollOffset + i;
          const isSelected = realIdx === selectedIdx;
          const isCurrent = entry.fullId === currentModel;

          const prefix = isSelected ? chalk.cyan("► ") : "  ";
          const modelPart = isCurrent
            ? chalk.green.bold(entry.fullId)
            : isSelected
              ? chalk.white(entry.fullId)
              : chalk.gray(entry.fullId);

          let ctx = "";
          if (entry.context) {
            const ctxStr = entry.context >= 1000000
              ? `${(entry.context / 1000000).toFixed(0)}M`
              : `${Math.round(entry.context / 1000)}K`;
            ctx = chalk.gray(` ${ctxStr} ctx`);
          }

          const keyIcon = entry.hasKey ? "" : chalk.red(" ✗");

          const contentLen = entry.fullId.length + ctx.length + keyIcon.length + 3;
          const padLen = Math.max(0, width - contentLen - 2);
          const pad = " ".repeat(padLen);

          const bg = isSelected ? "\x1b[48;2;40;50;80m" : "";
          const reset = isSelected ? "\x1b[49m" : "";

          stdout.write(chalk.cyan("  │ ") + bg + prefix + modelPart + ctx + keyIcon + pad + reset + chalk.cyan(" │") + "\n");
        } else {
          stdout.write(chalk.cyan("  │") + " ".repeat(width) + chalk.cyan("│") + "\n");
        }
      }

      // Box bottom
      const footer = chalk.cyan("  └") + chalk.cyan("─".repeat(width) + "┘");

      // Help line
      const scrollInfo = total > maxVisible ? chalk.gray(` ${scrollOffset + 1}-${Math.min(scrollOffset + maxVisible, total)}/${total} `) : chalk.gray(` ${total} models `);
      const help = chalk.gray(" ↑↓/click navigate · Enter select · Esc cancel · type to filter");
      const helpLine = chalk.cyan("  ") + scrollInfo + help;

      stdout.write(footer + "\n");
      stdout.write(helpLine + "\n");
    }

    function moveSelection(delta: number): void {
      const filtered = getFiltered();
      if (filtered.length === 0) return;
      selectedIdx = Math.max(0, Math.min(filtered.length - 1, selectedIdx + delta));
      render();
    }

    function selectCurrent(): void {
      const filtered = getFiltered();
      if (filtered.length === 0) return;
      const entry = filtered[selectedIdx];
      finish(entry.fullId);
    }

    // The data handler — will be removed on finish
    const onData = (data: Buffer) => {
      const str = data.toString("utf-8");

      // Parse mouse events (SGR format)
      const mouseMatch = str.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
      if (mouseMatch) {
        const button = parseInt(mouseMatch[1], 10);
        const y = parseInt(mouseMatch[3], 10);
        const isRelease = mouseMatch[4] === "m";

        if (!isRelease) {
          const filtered = getFiltered();
          if (filtered.length === 0) return;

          if (button === 64) {
            moveSelection(-3);
          } else if (button === 65) {
            moveSelection(3);
          } else if (button === 0) {
            const relRow = y - pickerStartRow;
            if (relRow >= 3 && relRow < 3 + maxVisible) {
              const idx = scrollOffset + (relRow - 3);
              if (idx >= 0 && idx < filtered.length) {
                selectedIdx = idx;
                render();
                selectCurrent();
              }
            }
          }
        }
        return;
      }

      // Escape
      if (str === "\x1b" || str === "\x1b\x1b") {
        finish(null);
        return;
      }

      // Enter
      if (str === "\r" || str === "\n") {
        selectCurrent();
        return;
      }

      // Arrow keys
      if (str === "\x1b[A") { moveSelection(-1); return; }
      if (str === "\x1b[B") { moveSelection(1); return; }
      if (str === "\x1b[5~") { moveSelection(-maxVisible); return; }
      if (str === "\x1b[6~") { moveSelection(maxVisible); return; }
      if (str === "\x1b[H" || str === "\x1b[1~") {
        selectedIdx = 0; render(); return;
      }
      if (str === "\x1b[F" || str === "\x1b[4~") {
        const filtered = getFiltered();
        selectedIdx = Math.max(0, filtered.length - 1); render(); return;
      }

      // Ctrl+C
      if (str === "\x03") { finish(null); return; }

      // Backspace
      if (str === "\x7f" || str === "\x08") {
        if (filter.length > 0) {
          filter = filter.slice(0, -1);
          selectedIdx = 0;
          scrollOffset = 0;
          render();
        }
        return;
      }

      // Printable characters
      if (str.length === 1 && str >= " " && str <= "~") {
        filter += str;
        selectedIdx = 0;
        scrollOffset = 0;
        render();
        return;
      }
    };

    // Track the starting row for mouse coordinate mapping
    let pickerStartRow = 0;

    // Render the picker and start listening
    stdout.write("\n");

    // Get cursor position for mouse mapping, then render and start listening
    const posHandler = (data: Buffer) => {
      const match = data.toString().match(/\x1b\[(\d+);(\d+)R/);
      if (match) {
        pickerStartRow = parseInt(match[1], 10) + 1;
        stdin.removeListener("data", posHandler);
        render();
        stdin.on("data", onData);
      }
    };

    stdin.on("data", posHandler);
    stdout.write("\x1b[6n");

    // Safety: if position report doesn't come in 500ms, just render and listen
    setTimeout(() => {
      if (pickerStartRow === 0) {
        stdin.removeListener("data", posHandler);
        render();
        stdin.on("data", onData);
      }
    }, 500);

    // Cleanup on stdin end
    stdin.once("end", () => {
      stdin.removeListener("data", onData);
      restore();
      resolve(null);
    });
  });
}

function collectModels(): ModelEntry[] {
  const providers = listOpencodeProviders();
  const entries: ModelEntry[] = [];

  for (const p of providers) {
    for (const m of p.models) {
      entries.push({
        fullId: `${p.id}/${m.id}`,
        providerId: p.id,
        modelId: m.id,
        providerName: p.name,
        modelName: m.name,
        context: m.context,
        hasKey: p.hasApiKey,
      });
    }
  }

  return entries;
}
