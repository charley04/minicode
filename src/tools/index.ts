import type { Tool, ToolResult, ToolContext } from "../types.js";
import { bashTool } from "./bash.js";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";
import { editTool } from "./edit.js";
import { multiEditTool } from "./multi-edit.js";
import { diffTool } from "./diff.js";
import { globTool } from "./glob.js";
import { grepTool } from "./grep.js";
import { listdirTool } from "./listdir.js";
import { todoTool } from "./todo.js";
import { estimateTokens, formatContextCost } from "../token-estimator.js";

export type { Tool, ToolResult };

const builtinTools: Tool[] = [
 bashTool,
 readTool,
 writeTool,
 editTool,
 multiEditTool,
 diffTool,
 globTool,
 grepTool,
 listdirTool,
 todoTool,
];

export class ToolRegistry {
 private tools: Map<string, Tool> = new Map();
 private mcpToolCount = 0;

 constructor() {
 for (const tool of builtinTools) {
 this.register(tool);
 }
 }

 register(tool: Tool): void {
 this.tools.set(tool.name, tool);
 if (tool.name.includes("__")) {
 this.mcpToolCount++;
 }
 }

 registerMany(tools: Tool[]): void {
 for (const tool of tools) {
 this.register(tool);
 }
 }

 unregister(name: string): void {
 if (this.tools.delete(name) && name.includes("__")) {
 this.mcpToolCount--;
 }
 }

 get(name: string): Tool | undefined {
 return this.tools.get(name);
 }

 getAll(): Tool[] {
 return Array.from(this.tools.values());
 }

 getBuiltinToolNames(): string[] {
 return builtinTools.map((t) => t.name);
 }

 getMCPToolCount(): number {
 return this.mcpToolCount;
 }

 getOpenAITools(): Array<{
 type: "function";
 function: { name: string; description: string; parameters: Record<string, unknown> };
 }> {
 return this.getAll().map((tool) => ({
 type: "function" as const,
 function: {
 name: tool.name,
 description: tool.description,
 parameters: tool.parameters,
 },
 }));
 }

 async execute(
    name: string,
    args: Record<string, unknown>,
    ctx?: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { output: `Error: Unknown tool '${name}'`, error: true };
    }

    let parsedArgs: Record<string, unknown>;
    try {
      parsedArgs = typeof args === "string" ? JSON.parse(args) : args;
    } catch {
      parsedArgs = args;
    }

    try {
      const result = await tool.execute(parsedArgs, ctx);

      // Estimate output token cost and attach context hint to display
      const outputTokens = estimateTokens(result.output);
      const maxCtx = ctx?.maxContextTokens ?? 200000;
      const ctxCost = outputTokens > 0
        ? `${formatContextCost(outputTokens, maxCtx)}`
        : "";

      // Truncate output if it exceeds maxToolOutputSize
      const maxSize = ctx?.maxToolOutputSize ?? 51200;
      let finalOutput = result.output;
      let finalDisplay = result.display;

      if (finalOutput.length > maxSize) {
        finalOutput = finalOutput.slice(0, maxSize) + `\n... (output truncated: ~${estimateTokens(finalOutput.slice(maxSize))} tokens removed)`;
      }

      // Append context cost to display
      const contextHint = ctxCost ? `\n${ctxCost}` : "";
      if (finalDisplay && finalDisplay !== result.output) {
        finalDisplay = finalDisplay + contextHint;
      } else {
        finalDisplay = finalOutput + contextHint;
      }

      return { output: finalOutput, display: finalDisplay, error: result.error };
    } catch (err: unknown) {
      const error = err as { message: string; name?: string };
      if (error.name === "AbortError" || ctx?.signal?.aborted) {
        return { output: `Aborted: ${name} was cancelled by user.`, error: true };
      }
      return { output: `Error executing ${name}: ${error.message}`, error: true };
    }
  }

 requiresPermission(name: string): boolean {
 const tool = this.tools.get(name);
 return tool?.requirePermission ?? false;
 }
}
