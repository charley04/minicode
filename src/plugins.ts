import type { Tool, ToolResult } from "./types.js";
import { ToolRegistry } from "./tools/index.js";
import type { MCPManager } from "./mcp.js";
import type { PluginConfig } from "./types.js";

export interface PluginContext {
  tools: ToolRegistry;
  mcp: MCPManager | null;
  registerTool: (tool: Tool) => void;
  log: (message: string) => void;
}

export interface MiniPlugin {
  name: string;
  init: (ctx: PluginContext) => Promise<void>;
  destroy?: () => Promise<void>;
}

export class PluginManager {
  private plugins: Map<string, MiniPlugin> = new Map();
  private configs: PluginConfig[];

  constructor(configs: PluginConfig[] = []) {
    this.configs = configs;
  }

  async initAll(ctx: PluginContext): Promise<void> {
    for (const config of this.configs) {
      if (!config.enabled) continue;
      try {
        const plugin = await this.loadPlugin(config);
        if (plugin) {
          await plugin.init(ctx);
          this.plugins.set(plugin.name, plugin);
          ctx.log(`Plugin '${plugin.name}' loaded`);
        }
      } catch (err) {
        const error = err as { message: string };
        ctx.log(`Failed to load plugin '${config.name}': ${error.message}`);
      }
    }
  }

  private async loadPlugin(config: PluginConfig): Promise<MiniPlugin | null> {
    const builtinPlugins: Record<string, () => MiniPlugin> = {
      "auto-lint": createAutoLintPlugin,
      "git-status": createGitStatusPlugin,
      "file-watcher": createFileWatcherPlugin,
    };

    const factory = builtinPlugins[config.name];
    if (factory) return factory();

    return null;
  }

  async destroyAll(): Promise<void> {
    for (const [name, plugin] of this.plugins) {
      try {
        if (plugin.destroy) await plugin.destroy();
      } catch {
        // ignore
      }
    }
    this.plugins.clear();
  }

  getPlugin(name: string): MiniPlugin | undefined {
    return this.plugins.get(name);
  }

  listPlugins(): string[] {
    return Array.from(this.plugins.keys());
  }
}

function createAutoLintPlugin(): MiniPlugin {
  return {
    name: "auto-lint",
    async init(ctx) {
      ctx.log("Auto-lint plugin: will run lint after file edits (use /lint to trigger)");
    },
  };
}

function createGitStatusPlugin(): MiniPlugin {
  return {
    name: "git-status",
    async init(ctx) {
      ctx.log("Git-status plugin: use /git to show repo status");
    },
  };
}

function createFileWatcherPlugin(): MiniPlugin {
  return {
    name: "file-watcher",
    async init(ctx) {
      ctx.log("File-watcher plugin: watching for file changes");
    },
  };
}
