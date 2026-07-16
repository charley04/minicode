import { marked } from "marked";
import { highlight } from "cli-highlight";
import chalk from "chalk";

marked.setOptions({
  gfm: true,
  breaks: false,
});

const TERMINAL_WIDTH = Math.min(process.stdout.columns || 80, 100);

export function renderMarkdown(text: string): string {
  if (!text) return "";

  const tokens = marked.lexer(text) as any[];
  const parts: string[] = [];

  for (const token of tokens) {
    const rendered = renderToken(token);
    if (rendered) parts.push(rendered);
  }

  return parts.join("\n").trimEnd();
}

function renderToken(token: any): string {
  switch (token.type) {
    case "heading":
      return renderHeading(token);
    case "code":
      return renderCodeBlock(token);
    case "paragraph":
      return renderInline(token.tokens || [], token.text);
    case "list":
      return renderList(token);
    case "blockquote":
      return renderBlockquote(token);
    case "hr":
      return chalk.gray("─".repeat(TERMINAL_WIDTH - 4));
    case "space":
      return "";
    case "table":
      return renderTable(token);
    default:
      if (token.text && typeof token.text === "string") return token.text;
      if (token.raw && typeof token.raw === "string") return token.raw;
      return "";
  }
}

function renderHeading(token: any): string {
  const text = renderInline(token.tokens || [], token.text);
  switch (token.depth) {
    case 1:
      return `\n${chalk.bold.cyan(text)}\n${chalk.cyan("═".repeat(Math.min(text.length * 2, TERMINAL_WIDTH - 4)))}`;
    case 2:
      return `\n${chalk.bold.cyan(text)}\n${chalk.gray("─".repeat(Math.min(text.length * 2, TERMINAL_WIDTH - 4)))}`;
    case 3:
      return `\n${chalk.bold.white(text)}`;
    default:
      return `\n${chalk.bold(text)}`;
  }
}

const THEME = {
  keyword: (s: string) => chalk.magenta(s),
  string: (s: string) => chalk.green(s),
  number: (s: string) => chalk.yellow(s),
  comment: (s: string) => chalk.gray.italic(s),
  function: (s: string) => chalk.blue(s),
  tag: (s: string) => chalk.cyan(s),
  attr: (s: string) => chalk.yellow(s),
  class: (s: string) => chalk.blue.bold(s),
  punctuation: (s: string) => chalk.gray(s),
  operator: (s: string) => chalk.gray(s),
  variable: (s: string) => chalk.white(s),
  builtin: (s: string) => chalk.cyan(s),
  property: (s: string) => chalk.white(s),
  symbol: (s: string) => chalk.yellow(s),
};

const LANG_ALIASES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  sh: "bash",
  shell: "bash",
  yml: "yaml",
  md: "markdown",
  rs: "rust",
  go: "go",
  kt: "kotlin",
};

function renderCodeBlock(token: any): string {
  const langRaw = token.lang || "";
  const lang = LANG_ALIASES[langRaw.toLowerCase()] || langRaw || "text";
  const code = String(token.text ?? "");

  let highlighted: string;
  try {
    if (lang === "text" || lang === "plain") {
      highlighted = code;
    } else {
      highlighted = highlight(code, {
        language: lang,
        theme: THEME,
      });
    }
  } catch {
    highlighted = code;
  }

  const lines = highlighted.replace(/\n$/, "").split("\n");
  const numWidth = String(lines.length).length;
  const innerWidth = Math.max(20, TERMINAL_WIDTH - numWidth - 6);

  // Header with language label; footer just closes it. No hard right border,
  // so wrapped long lines stay readable in narrow terminals.
  const langLabel = langRaw || (lang === "text" ? "" : lang);
  const headerTag = langLabel ? chalk.bgBlue.white.bold(` ${langLabel} `) : chalk.bgGray.white.bold(" code ");
  const headerRule = chalk.gray("─".repeat(Math.max(0, innerWidth - langLabel.length - 4)));
  const header = "  " + headerTag + " " + headerRule;
  const footer = "  " + chalk.gray("─".repeat(innerWidth + numWidth + 2));

  const body = lines
    .map((line: string, i: number) => {
      const num = chalk.gray(String(i + 1).padStart(numWidth) + " │ ");
      // Truncate the raw visible line if crazy long, but keep colors intact
      // by slicing the highlighted string only when the plain length exceeds
      // innerWidth. Approximate — most lines fit.
      const plain = stripAnsi(line);
      const rendered = plain.length > innerWidth
        ? line.slice(0, innerWidth + 20) + chalk.gray("…")
        : line;
      return "  " + num + rendered;
    })
    .join("\n");

  return `\n${header}\n${body}\n${footer}`;
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function renderInline(tokens: any[], fallback: string): string {
  if (!tokens || tokens.length === 0) return fallback;

  return tokens
    .map((t: any) => {
      switch (t.type) {
        case "text":
          if (t.tokens) return renderInline(t.tokens, t.text);
          return t.text;
        case "strong":
          return chalk.bold(t.text);
        case "em":
          return chalk.italic.yellow(t.text);
        case "codespan":
          return chalk.bgBlack.white(` ${t.text} `);
        case "link":
          return chalk.blue.underline(t.text) + (t.href ? chalk.gray(` (${t.href})`) : "");
        case "del":
          return chalk.gray.strikethrough(t.text);
        case "br":
          return "\n";
        case "escape":
          return t.text;
        case "image":
          return chalk.gray(`[image: ${t.href || t.text}]`);
        default:
          if (t.text && typeof t.text === "string") return t.text;
          if (t.raw && typeof t.raw === "string") return t.raw;
          return "";
      }
    })
    .join("");
}

function renderList(token: any): string {
  const items = token.items || [];
  return items
    .map((item: any, i: number) => {
      const marker = token.ordered
        ? chalk.cyan(`${i + 1}. `)
        : chalk.gray("• ");
      const content = renderListItem(item);
      const indent = " ".repeat(String(i + 1).length + 2);

      const contentLines = content.split("\n");
      if (contentLines.length > 1) {
        return marker + contentLines[0] + "\n" +
          contentLines.slice(1).map((l: string) => indent + l).join("\n");
      }
      return marker + content;
    })
    .join("\n");
}

function renderListItem(item: any): string {
  const parts: string[] = [];
  if (item.tokens) {
    for (const t of item.tokens) {
      if (t.type === "text") {
        if (t.tokens) {
          parts.push(renderInline(t.tokens, t.text));
        } else {
          parts.push(t.text);
        }
      } else if (t.type === "paragraph") {
        parts.push(renderInline(t.tokens || [], t.text));
      } else if (t.type === "list") {
        parts.push("\n" + renderList(t));
      } else if (t.type === "code") {
        parts.push("\n" + renderCodeBlock(t));
      } else {
        if (t.text && typeof t.text === "string") {
          parts.push(t.text);
        }
      }
    }
  }
  return parts.join(" ");
}

function renderBlockquote(token: any): string {
  const body = (token.tokens || [])
    .map((t: any) => {
      if (t.type === "paragraph") {
        return renderInline(t.tokens || [], t.text);
      }
      if (t.text && typeof t.text === "string") return t.text;
      return "";
    })
    .join("\n");

  return body
    .split("\n")
    .map((line: string) => chalk.gray("  ▎ ") + chalk.gray.italic(line))
    .join("\n");
}

function renderTable(token: any): string {
  const header = (token.header || []).map((h: any) => renderInline(h.tokens || [], h.text));
  const rows = (token.rows || []).map((row: any[]) =>
    row.map((cell: any) => renderInline(cell.tokens || [], cell.text)),
  );

  // Calculate column widths based on visible (non-ANSI) text
  const colWidths = header.map((h: string, i: number) => {
    const maxLen = Math.max(
      stripAnsi(h).length,
      ...rows.map((r: string[]) => stripAnsi(r[i] || "").length),
    );
    return Math.min(maxLen, 40);
  });

  const headerLine = chalk.bold.cyan(
    "  " +
      header.map((h: string, i: number) => h.padEnd(colWidths[i] + (h.length - stripAnsi(h).length))).join(chalk.gray(" │ ")),
  );
  const sepLine = chalk.gray(
    "  " + colWidths.map((w: number) => "─".repeat(w)).join("─┼─"),
  );
  const dataLines = rows.map(
    (row: string[]) => "  " + row.map((c: string, i: number) => {
      const pad = colWidths[i] - stripAnsi(c).length;
      return (c || "") + " ".repeat(Math.max(0, pad));
    }).join(chalk.gray(" │ ")),
  );

  return [headerLine, sepLine, ...dataLines].join("\n");
}

export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, "").replace(/```$/g, ""))
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/^>\s+/gm, "");
}
