import type { Tool, TodoItem } from "../types.js";

let todoList: TodoItem[] = [];

export function getTodoList(): TodoItem[] {
  return todoList;
}

export function clearTodoList(): void {
  todoList = [];
}

export const todoTool: Tool = {
  name: "todo",
  description:
    "Manages a task list for tracking multi-step work. Use this when a task has 3+ distinct steps to plan and track progress. Pass a 'todos' array to set/replace the entire list. Each todo has content (description), status (pending/in_progress/completed), and priority (high/medium/low). Keep exactly one item as in_progress at a time. Update the list as you complete each step — mark completed items and move the next one to in_progress.",
  parameters: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            content: { type: "string", description: "Brief description of the task" },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "completed"],
              description: "Current status of the task",
            },
            priority: {
              type: "string",
              enum: ["high", "medium", "low"],
              description: "Priority level",
            },
          },
          required: ["content", "status", "priority"],
        },
        description: "The complete todo list. Replaces the existing list.",
      },
    },
    required: ["todos"],
  },
  requirePermission: false,
  async execute(args) {
    const todos = args.todos as TodoItem[] | undefined;

    if (!Array.isArray(todos)) {
      return { output: "Error: 'todos' must be an array.", error: true };
    }

    todoList = todos;

    if (todoList.length === 0) {
      return { output: "Task list cleared." };
    }

    const statusIcons: Record<string, string> = {
      pending: "[ ]",
      in_progress: "[~]",
      completed: "[x]",
    };

    const lines = todoList.map(
      (t) => `${statusIcons[t.status] || "[?]"} (${t.priority}) ${t.content}`,
    );

    const completed = todoList.filter((t) => t.status === "completed").length;
    const total = todoList.length;
    const pct = Math.round((completed / total) * 100);

    return {
      output: `Task list updated (${completed}/${total} done, ${pct}%):\n` + lines.join("\n"),
    };
  },
};
