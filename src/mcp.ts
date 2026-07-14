import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { MCPServerConfig, Tool, ToolResult } from "./types.js";

export class MCPManager {
  private clients: Map<string, Client> = new Map();
  private tools: Map<string, Tool> = new Map();
  private serverConfigs: MCPServerConfig[];

  constructor(configs: MCPServerConfig[] = []) {
    this.serverConfigs = configs;
  }

  async connectAll(): Promise<void> {
    for (const config of this.serverConfigs) {
      try {
        await this.connect(config);
      } catch (err) {
        const error = err as { message: string };
        console.error(`MCP server '${config.name}' failed to connect: ${error.message}`);
      }
    }
  }

  async connect(config: MCPServerConfig): Promise<void> {
    let transport;

    if (config.transport === "stdio") {
      transport = new StdioClientTransport({
        command: config.command || "npx",
        args: config.args || [],
        env: config.env
          ? { ...process.env, ...config.env } as Record<string, string>
          : { ...process.env } as Record<string, string>,
      });
    } else if (config.transport === "sse") {
      transport = new SSEClientTransport(new URL(config.url || ""));
    } else if (config.transport === "http") {
      transport = new StreamableHTTPClientTransport(new URL(config.url || ""));
    } else {
      throw new Error(`Unknown transport: ${config.transport}`);
    }

    const client = new Client(
      { name: "minicode", version: "0.2.0" },
      { capabilities: {} },
    );

    await client.connect(transport);
    this.clients.set(config.name, client);

    await this.discoverTools(config.name, client);
  }

  private async discoverTools(serverName: string, client: Client): Promise<void> {
    try {
      const toolsList = await client.listTools();

      for (const mcpTool of toolsList.tools) {
        const toolName = `${serverName}__${mcpTool.name}`;
        const tool: Tool = {
          name: toolName,
          description: `[MCP:${serverName}] ${mcpTool.description || mcpTool.name}`,
          parameters: (mcpTool.inputSchema as Record<string, unknown>) || {
            type: "object",
            properties: {},
          },
          requirePermission: true,
          execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
            try {
              const result = await client.callTool({
                name: mcpTool.name,
                arguments: args,
              });
              const textParts = (result.content as any[] || [])
                .filter((c) => c.type === "text")
                .map((c) => c.text || "")
                .join("\n");
              return { output: textParts || "(no output)" };
            } catch (err) {
              const error = err as { message: string };
              return { output: `MCP error: ${error.message}`, error: true };
            }
          },
        };
        this.tools.set(toolName, tool);
      }
    } catch (err) {
      const error = err as { message: string };
      console.error(`Failed to discover tools from MCP server '${serverName}': ${error.message}`);
    }
  }

  getTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  async disconnectAll(): Promise<void> {
    for (const [name, client] of this.clients) {
      try {
        await client.close();
      } catch {
        // ignore
      }
    }
    this.clients.clear();
    this.tools.clear();
  }

  getServerNames(): string[] {
    return Array.from(this.clients.keys());
  }

  formatServersList(): string {
    const names = this.getServerNames();
    if (names.length === 0) return "No MCP servers connected.";
    return names.map((n) => {
      const toolCount = Array.from(this.tools.keys()).filter((t) => t.startsWith(`${n}__`)).length;
      return `  ${n} (${toolCount} tools)`;
    }).join("\n");
  }
}
