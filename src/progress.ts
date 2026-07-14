import { stdout } from "node:process";
import chalk from "chalk";
import type { TodoItem } from "./types.js";

export class ProgressRenderer {
  private currentTodos: TodoItem[] = [];
  private renderedLines = 0;
  private active = false;

  update(todos: TodoItem[]): void {
    this.currentTodos = todos;
    if (this.active) {
      this.clear();
    }
    this.render();
  }

  private render(): void {
    if (this.currentTodos.length === 0) {
      this.renderedLines = 0;
      this.active = false;
      return;
    }

    this.active = true;
    const lines: string[] = [];

    const completed = this.currentTodos.filter((t) => t.status === "completed").length;
    const total = this.currentTodos.length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

    // Progress bar
    const barWidth = 24;
    const filled = Math.round((pct / 100) * barWidth);
    const empty = barWidth - filled;
    const bar = chalk.green("█".repeat(filled)) + chalk.gray("░".repeat(empty));
    const header = `  ${chalk.bold("Progress")} ${bar} ${chalk.bold(`${pct}%`)} ${chalk.gray(`(${completed}/${total})`)}`;
    lines.push(header);

    // Task items
    for (const todo of this.currentTodos) {
      let icon: string;
      let text: string;
      switch (todo.status) {
        case "completed":
          icon = chalk.green("✓");
          text = chalk.gray.strikethrough(todo.content);
          break;
        case "in_progress":
          icon = chalk.yellow("►");
          text = chalk.bold.white(todo.content);
          break;
        default:
          icon = chalk.gray("○");
          text = chalk.gray(todo.content);
          break;
      }

      let priorityMark = "";
      switch (todo.priority) {
        case "high":
          priorityMark = chalk.red("!");
          break;
        case "medium":
          priorityMark = chalk.yellow("·");
          break;
        default:
          priorityMark = " ";
      }

      lines.push(`  ${icon} ${priorityMark} ${text}`);
    }

    const output = lines.join("\n");
    stdout.write("\n" + output + "\n\n");
    this.renderedLines = lines.length + 2; // +1 for leading \n, +1 for trailing \n
  }

  clear(): void {
    if (this.renderedLines === 0) return;
    // Move up and clear
    stdout.write(`\x1b[${this.renderedLines}A\x1b[J`);
    this.renderedLines = 0;
    this.active = false;
  }

  clearAll(): void {
    this.clear();
    this.currentTodos = [];
  }

  hasTodos(): boolean {
    return this.currentTodos.length > 0;
  }

  getTodos(): TodoItem[] {
    return this.currentTodos;
  }
}
