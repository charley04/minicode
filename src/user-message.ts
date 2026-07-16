import chalk from "chalk";

/**
 * Render a user message block with a bordered box that adapts to content height.
 *
 * Multi-line text is fully preserved with original formatting — no truncation,
 * no line loss. Long lines are wrapped at terminal width boundaries.
 * Empty content renders nothing.
 *
 * @param content - The user message text (may contain newlines)
 * @returns The rendered string (ready to console.log / stdout.write)
 */
export function renderUserMessageBlock(content: string): string {
  if (!content) return "";

  const termWidth = Math.min(process.stdout.columns || 80, 120);
  const innerWidth = termWidth - 8; // padding: "  │ " left + " │" right + margin
  const lines = content.split("\n");
  const lineCount = lines.length;

  const parts: string[] = [];

  // Header
  const header = chalk.green.bold("  ▶ user");
  if (lineCount > 1) {
    parts.push(header + chalk.gray(`  (${lineCount} lines)`));
  } else {
    parts.push(header);
  }

  // Top border
  parts.push(chalk.gray("  ┌" + "─".repeat(innerWidth + 2) + "┐"));

  // Content lines with wrapping for long lines
  const railLeft = chalk.gray("  │ ");
  const railRight = chalk.gray(" │");
  for (const rawLine of lines) {
    if (stripAnsi(rawLine).length <= innerWidth) {
      parts.push(railLeft + rawLine + " ".repeat(Math.max(0, innerWidth - stripAnsi(rawLine).length)) + railRight);
    } else {
      // Wrap long lines at word or character boundaries
      const wrapped = wrapLine(rawLine, innerWidth);
      for (let i = 0; i < wrapped.length; i++) {
        const segment = wrapped[i];
        const isLast = i === wrapped.length - 1;
        parts.push(
          railLeft + segment + (isLast ? " ".repeat(Math.max(0, innerWidth - stripAnsi(segment).length)) : "") + railRight,
        );
      }
    }
  }

  // Bottom border
  parts.push(chalk.gray("  └" + "─".repeat(innerWidth + 2) + "┘"));

  return parts.join("\n");
}

/**
 * Wrap a single line of text to fit within maxWidth visible characters.
 * Tries to break at word boundaries; falls back to hard break if needed.
 */
function wrapLine(line: string, maxWidth: number): string[] {
  const result: string[] = [];
  let remaining = line;

  while (stripAnsi(remaining).length > maxWidth) {
    // Find the cut position: prefer space, then any char
    let cutAt = maxWidth;
    const visiblePart = remaining.slice(0, maxWidth + 20); // overshoot to account for ANSI codes

    // Look backwards from maxWidth for a word boundary (space)
    const searchStr = stripAnsi(visiblePart);
    const lastSpace = searchStr.lastIndexOf(" ");
    if (lastSpace > Math.max(maxWidth * 0.5, 10)) {
      cutAt = lastSpace;
    }

    // Extract the segment (handling ANSI codes properly)
    let segLen = 0;
    let ansiAccum = "";
    let visibleLen = 0;
    for (const ch of remaining) {
      if (ch === "\x1b") {
        ansiAccum += ch;
        continue;
      }
      if (ansiAccum.length > 0) {
        ansiAccum += ch;
        if (ch === "m") {
          // ANSI sequence complete
          if (visibleLen >= cutAt) break;
        }
        continue;
      }
      if (visibleLen >= cutAt) break;
      ansiAccum += ch;
      visibleLen++;
    }

    result.push(ansiAccum.trimEnd());
    remaining = remaining.slice(ansiAccum.length).trimStart();
  }

  if (remaining.length > 0) {
    result.push(remaining);
  }

  return result;
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}