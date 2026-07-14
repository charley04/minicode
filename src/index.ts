#!/usr/bin/env node

import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import chalk from "chalk";
import { Command } from "commander";
import { loadConfig, saveConfig, getOpencodePath } from "./config.js";
import { listOpencodeProviders, resolveModel, getAllModelStrings, getProviderModelStrings, loadOpencodeConfig, getOpencodeConfigPath } from "./opencode-config.js";
import { ToolRegistry } from "./tools/index.js";
import { Agent } from "./agent.js";
import { TokenTracker } from "./token-tracker.js";
import { Spinner } from "./spinner.js";
import { renderMarkdown } from "./markdown.js";
import {
  createCompleter,
  showHint,
  clearHint,
  handleKeyPress,
} from "./completer.js";
import { showModelPicker } from "./model-picker.js";
import { ProgressRenderer } from "./progress.js";
import { clearTodoList } from "./tools/todo.js";
import {
  createSession,
  saveSession,
  loadSession,
  listSessions,
} from "./session.js";
import { SkillManager } from "./skills.js";
import { MCPManager } from "./mcp.js";
import { PluginManager } from "./plugins.js";
import { Sandbox } from "./sandbox.js";
import { setSandbox } from "./tools/bash.js";
import { startServer } from "./server.js";
import type { AppConfig, AgentEvent, Session } from "./types.js";

const VERSION = "0.3.0";

const program = new Command();

program
  .name("minicode")
  .description("A lightweight AI coding agent for the terminal")
  .version(VERSION)
  .option("-m, --model <model>", "Model to use (provider/model format, e.g. volcengine-plan/ark-code-latest)")
  .option("--auto-approve", "Auto-approve all tool calls (dangerous)")
  .option("--sandbox", "Run bash commands in Docker sandbox")
  .option("-r, --resume <id>", "Resume a session by ID")
  .option("--one-shot <prompt>", "Run a single prompt and exit (non-interactive)")
  .option("--no-skills", "Disable skill auto-discovery")
  .option("--no-mcp", "Disable MCP server connections")
  .action(async (opts) => {
    const overrides: Partial<AppConfig> = {};
    if (opts.model) overrides.opencodeModel = opts.model;
    if (opts.autoApprove) overrides.autoApprove = true;
    if (opts.sandbox) overrides.sandbox = true;

    const config = loadConfig(overrides);

    if (!config.apiKey) {
      const ocPath = getOpencodePath();
      console.error(chalk.red("Error: No API key found."));
      if (ocPath) {
        console.error(chalk.gray(`Read opencode config from: ${ocPath}`));
        console.error(chalk.gray("Check that your provider has 'options.apiKey' set in the opencode config."));
      } else {
        console.error(chalk.gray("No opencode config found. Create one at:"));
        console.error(chalk.gray("  ~/.config/opencode/opencode.json"));
        console.error(chalk.gray("  or ./opencode.json in your project"));
      }
      process.exit(1);
    }

    const useSkills = opts.skills !== false;
    const useMcp = opts.mcp !== false;

    if (opts.oneShot) {
      await runOneShot(config, useSkills, useMcp, opts.oneShot);
    } else {
      await runInteractive(config, useSkills, useMcp, opts.resume);
    }
  });

program
  .command("server")
  .description("Start HTTP/WebSocket API server")
  .option("-p, --port <port>", "Port number", "3170")
  .option("-h, --host <host>", "Host to bind", "127.0.0.1")
  .action(async (opts) => {
    const config = loadConfig();
    if (!config.apiKey) {
      console.error(chalk.red("Error: No API key found in opencode config."));
      process.exit(1);
    }
    await startServer({
      port: parseInt(opts.port, 10),
      host: opts.host,
      config,
    });
  });

program
  .command("config")
  .description("Manage configuration")
  .argument("<action>", "get | set | list")
  .argument("[key]", "config key")
  .argument("[value]", "config value")
  .action(async (action, key, value) => {
    if (action === "get" || action === "list") {
      const config = loadConfig();
      const ocPath = getOpencodeConfigPath();
      console.log(chalk.bold.cyan("\n  MiniCode Configuration\n"));
      if (ocPath) {
        console.log(chalk.gray(`  opencode config: ${ocPath}`));
      }
      console.log(chalk.gray(`  active model:    ${config.model || "(none)"}`));
      if (config.apiKey) {
        console.log(chalk.gray(`  api key:         ${config.apiKey.slice(0, 6)}...${config.apiKey.slice(-4)}`));
      }
      console.log(chalk.gray(`  base url:        ${config.baseUrl || "(default)"}`));
      console.log(chalk.gray(`  npm:             ${config.provider}`));
      console.log(chalk.gray(`  auto-approve:    ${config.autoApprove}`));
      console.log(chalk.gray(`  sandbox:         ${config.sandbox}`));
      console.log(chalk.gray(`  max turns:       ${config.maxTurns}`));
      if (config.mcpServers.length > 0) {
        console.log(chalk.gray(`  mcp servers:     ${config.mcpServers.length}`));
      }
      console.log();
    } else if (action === "set") {
      if (!key || value === undefined) {
        console.error(chalk.red("Usage: minicode config set <key> <value>"));
        process.exit(1);
      }
      const parsed = parseConfigValue(key, value);
      saveConfig(parsed);
      console.log(chalk.green(`✓ Set ${key}`));
    }
  });

program
  .command("provider")
  .description("List and switch providers/models from opencode config")
  .argument("[model]", "provider/model to switch to (e.g. volcengine-plan/ark-code-latest)")
  .option("-t, --test", "Test the current or specified model")
  .action(async (modelArg, opts) => {
    if (opts.test) {
      await testProvider(modelArg);
    } else if (modelArg) {
      switchModel(modelArg);
    } else {
      listProviders();
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red(`Fatal: ${err.message}`));
  process.exit(1);
});

function listProviders(): void {
  const providers = listOpencodeProviders();
  const config = loadConfig();
  const ocPath = getOpencodeConfigPath();

  if (providers.length === 0) {
    console.log(chalk.gray("\n  No providers found."));
    if (ocPath) {
      console.log(chalk.gray(`  Read from: ${ocPath}`));
    } else {
      console.log(chalk.gray("  No opencode config found. Create one at:"));
      console.log(chalk.gray("    ~/.config/opencode/opencode.json"));
      console.log(chalk.gray("    or ./opencode.json"));
    }
    console.log();
    return;
  }

  console.log(chalk.bold.cyan("\n  Providers (from opencode config)\n"));
  if (ocPath) {
    console.log(chalk.gray(`  Config: ${ocPath}\n`));
  }

  const currentModel = config.model;

  for (const p of providers) {
    const isActive = currentModel.startsWith(p.id + "/");
    const marker = isActive ? chalk.green(" ← active") : "";
    const keyDisplay = p.hasApiKey ? chalk.green("✓ key") : chalk.red("✗ no key");
    console.log(`  ${chalk.bold(p.id)}${marker}  ${chalk.gray(p.npm)}  ${keyDisplay}`);
    if (p.name && p.name !== p.id) {
      console.log(chalk.gray(`    name: ${p.name}`));
    }
    if (p.baseURL) {
      console.log(chalk.gray(`    url:  ${p.baseURL}`));
    }
    for (const m of p.models) {
      const modelStr = `${p.id}/${m.id}`;
      const active = modelStr === currentModel;
      const mMarker = active ? chalk.green(" ← ") : "    ";
      const ctx = m.context ? chalk.gray(` (${(m.context / 1000).toFixed(0)}K ctx)`) : "";
      console.log(`  ${mMarker}${modelStr}${ctx}`);
    }
    console.log();
  }

  console.log(chalk.gray("  Use: minicode provider <provider/model> to switch"));
  console.log(chalk.gray("  Or:  /model <provider/model> in interactive mode"));
  console.log();
}

function switchModel(modelStr: string): void {
  const resolved = resolveModel(modelStr);
  if (!resolved) {
    console.error(chalk.red(`Model '${modelStr}' not found in opencode config.`));
    const all = getAllModelStrings();
    if (all.length > 0) {
      console.error(chalk.gray("Available models:"));
      for (const m of all.slice(0, 20)) {
        console.error(chalk.gray(`  ${m}`));
      }
      if (all.length > 20) console.error(chalk.gray(`  ... and ${all.length - 20} more`));
    }
    process.exit(1);
  }

  const config = loadConfig();
  config.opencodeModel = modelStr;
  saveConfig({ opencodeModel: modelStr });

  console.log(chalk.green(`✓ Switched to: ${resolved.providerId}/${resolved.modelId}`));
  console.log(chalk.gray(`  Provider: ${resolved.providerName}`));
  console.log(chalk.gray(`  Model:    ${resolved.modelName}`));
  console.log(chalk.gray(`  NPM:      ${resolved.npm}`));
  console.log(chalk.gray(`  URL:      ${resolved.baseURL || "(default)"}`));
  if (resolved.contextLimit) {
    console.log(chalk.gray(`  Context:  ${(resolved.contextLimit / 1000).toFixed(0)}K`));
  }
}

async function testProvider(modelStr?: string): Promise<void> {
  const config = loadConfig({ ...(modelStr ? { opencodeModel: modelStr } : {}) });
  const resolved = resolveModel(modelStr || config.opencodeModel);

  if (!resolved) {
    console.error(chalk.red("No model resolved. Check your opencode config."));
    process.exit(1);
  }

  console.log(chalk.gray(`  Testing ${resolved.providerId}/${resolved.modelId}...`));
  console.log(chalk.gray(`  URL: ${resolved.baseURL || "(default)"}`));
  console.log(chalk.gray(`  NPM: ${resolved.npm}`));

  try {
    const { createProvider } = await import("./provider.js");
    const provider = createProvider(config);
    const result = await provider.stream(
      [
        { role: "system", content: "Reply with exactly: OK" },
        { role: "user", content: "ping", tool_call_id: undefined as any },
      ],
      [],
      { onText: () => {} },
    );
    console.log(chalk.green(`✓ Response: "${result.content.slice(0, 60)}"`));
    if (result.usage) {
      console.log(chalk.gray(`  Tokens: ${result.usage.promptTokens}p + ${result.usage.completionTokens}c`));
    }
  } catch (err) {
    const error = err as { message: string };
    console.error(chalk.red(`✗ Failed: ${error.message}`));
    process.exit(1);
  }
}

program
  .command("sessions")
  .description("List saved sessions")
  .action(() => {
    const sessions = listSessions();
    if (sessions.length === 0) {
      console.log(chalk.gray("No sessions found."));
      return;
    }
    console.log(chalk.bold.cyan("\n  Sessions\n"));
    for (const s of sessions.slice(0, 20)) {
      const date = new Date(s.updatedAt).toLocaleString();
      const preview = s.messages.find((m) => m.role === "user")?.content?.slice(0, 50) || "(empty)";
      const usage = s.usage ? chalk.gray(` [${s.usage.total.totalTokens}t]`) : "";
      console.log(`  ${chalk.cyan(s.id)}  ${chalk.gray(date)}${usage}  ${preview}`);
    }
    console.log();
  });

program
  .command("skills")
  .description("List discovered skills")
  .action(() => {
    const config = loadConfig();
    const skills = new SkillManager(config.skillsPaths);
    skills.discover();
    const all = skills.getAll();
    if (all.length === 0) {
      console.log(chalk.gray("\n  No skills found."));
      console.log(chalk.gray("  Skills are auto-discovered from:"));
      console.log(chalk.gray("    ~/.claude/skills/"));
      console.log(chalk.gray("    ~/.config/opencode/skills/"));
      console.log(chalk.gray("    ./.claude/skills/"));
      console.log(chalk.gray("    ./.minicode/skills/\n"));
      return;
    }
    console.log(chalk.bold.cyan(`\n  Discovered Skills (${all.length})\n`));
    for (const s of all) {
      console.log(`  ${chalk.bold(s.name)}`);
      console.log(`    ${chalk.gray(s.description.slice(0, 80))}`);
      console.log(`    ${chalk.gray(s.path)}\n`);
    }
  });

async function initExtensions(config: AppConfig, useSkills: boolean, useMcp: boolean) {
  let skills: SkillManager | undefined;
  if (useSkills) {
    skills = new SkillManager(config.skillsPaths);
    skills.discover();
  }

  let mcp: MCPManager | undefined;
  if (useMcp && config.mcpServers.length > 0) {
    mcp = new MCPManager(config.mcpServers);
    await mcp.connectAll();
  }

  if (config.sandbox) {
    const dockerOk = await Sandbox.isDockerAvailable();
    if (dockerOk) {
      setSandbox(new Sandbox(true, config.sandboxImage));
    }
  }

  const plugins = new PluginManager(config.plugins);
  await plugins.initAll({
    tools: new ToolRegistry(),
    mcp: mcp ?? null,
    registerTool: () => {},
    log: (msg) => console.error(chalk.gray(`  ${msg}`)),
  });

  return { skills, mcp, plugins };
}

async function runOneShot(config: AppConfig, useSkills: boolean, useMcp: boolean, prompt: string) {
  const { skills, mcp } = await initExtensions(config, useSkills, useMcp);

  const tools = new ToolRegistry();
  if (mcp) {
    tools.registerMany(mcp.getTools());
  }

  const session = createSession(process.cwd(), config.model);
  session.messages.push({ role: "user", content: prompt });

  const tokenTracker = new TokenTracker();
  let textBuffer = "";
  let hasBufferedText = false;
  const progress = new ProgressRenderer();

  const agent = new Agent({
    config,
    tools,
    skills,
    tokenTracker,
    onEvent: (event) => {
      if (event.type === "text") {
        hasBufferedText = true;
        textBuffer += event.content;
      } else if (event.type === "tool_call") {
        if (hasBufferedText && textBuffer.trim()) {
          const rendered = renderMarkdown(textBuffer);
          stdout.write("\n  " + rendered + "\n");
          textBuffer = "";
          hasBufferedText = false;
        }
        console.log(
          chalk.yellow("  ⚡ ") + chalk.bold(event.name) +
          chalk.gray(" " + truncateArgs(event.args)),
        );
      } else if (event.type === "tool_result") {
        const lines = event.output.split("\n");
        const maxLines = 15;
        const preview = lines.slice(0, maxLines).join("\n");
        const truncation = lines.length > maxLines
          ? chalk.gray(`\n  ... (${lines.length - maxLines} more lines)`)
          : "";
        const icon = event.error ? chalk.red("  ✗ ") : chalk.green("  ✓ ");
        console.log(icon + chalk.gray(preview) + truncation);
      } else if (event.type === "todo_update") {
        progress.update(event.todos);
      } else if (event.type === "error") {
        console.error(chalk.red(`\n  [error] ${event.message}`));
      }
    },
    shouldApprove: async () => config.autoApprove,
  });

  try {
    const updated = await agent.run(session.messages);
    session.messages = updated;
    session.usage = tokenTracker.getSessionUsage();
    saveSession(session);

    progress.clear();

    if (hasBufferedText && textBuffer.trim()) {
      const rendered = renderMarkdown(textBuffer);
      stdout.write("\n  " + rendered + "\n");
    }

    if (progress.hasTodos()) {
      progress.update(progress.getTodos());
    }

    const usage = tokenTracker.getSessionUsage();
    console.error(chalk.gray(`\n  Tokens: ${usage.total.promptTokens}p + ${usage.total.completionTokens}c = ${usage.total.totalTokens}t (${usage.turns} turns)`));
  } finally {
    if (mcp) await mcp.disconnectAll();
  }
}

async function runInteractive(config: AppConfig, useSkills: boolean, useMcp: boolean, resumeId?: string) {
  const { skills, mcp, plugins } = await initExtensions(config, useSkills, useMcp);

  const skillCount = skills?.getAll().length || 0;
  const mcpServerCount = mcp?.getServerNames().length || 0;
  const mcpToolCount = mcp?.getTools().length || 0;

  console.log(chalk.bold.cyan(`\n  ╭──────────────────────────────────────╮`));
  console.log(chalk.bold.cyan(`  │          MiniCode v${VERSION}              │`));
  console.log(chalk.bold.cyan(`  ╰──────────────────────────────────────╯`));
  console.log(chalk.gray(`  Model: ${config.model}`));
  console.log(chalk.gray(`  SDK:   ${config.provider}`));
  if (config.baseUrl) console.log(chalk.gray(`  URL:   ${config.baseUrl}`));
  if (skillCount > 0) console.log(chalk.gray(`  Skills: ${skillCount} loaded`));
  if (mcpServerCount > 0) console.log(chalk.gray(`  MCP: ${mcpServerCount} servers, ${mcpToolCount} tools`));
  if (config.sandbox) console.log(chalk.gray(`  Sandbox: enabled`));
  if (config.autoApprove) console.log(chalk.yellow(`  Auto-approve: ON`));
  console.log(chalk.gray(`  Type /help for commands, /exit to quit.\n`));

  let session: Session;
  if (resumeId) {
    const loaded = loadSession(resumeId);
    if (!loaded) {
      console.error(chalk.red(`Session not found: ${resumeId}`));
      process.exit(1);
    }
    session = loaded;
    console.log(chalk.gray(`  Resumed: ${session.id}\n`));
    for (const msg of session.messages) {
      if (msg.role === "user") {
        console.log(chalk.green("  user> ") + msg.content);
      } else if (msg.role === "assistant" && msg.content) {
        console.log(chalk.blue("  assistant> ") + msg.content);
      }
    }
  } else {
    session = createSession(process.cwd(), config.model);
  }

  const tokenTracker = new TokenTracker();
  if (session.usage) {
    for (const turn of session.usage.byTurn) {
      tokenTracker.addUsage(turn);
    }
  }

  const rl = createInterface({
    input: stdin,
    output: stdout,
    prompt: chalk.green("\n  user> "),
    completer: createCompleter(),
  });

  let isProcessing = false;

  rl.prompt();

  process.stdin.on("keypress", (char: string, key: { name?: string; ctrl?: boolean; meta?: boolean } | undefined) => {
    if (isProcessing) return;
    handleKeyPress(char, key, rl.line);
  });

  rl.on("line", async (input) => {
    clearHint();
    const trimmed = input.trim();

    if (!trimmed) {
      rl.prompt();
      return;
    }

    if (trimmed.startsWith("/")) {
      const result = await handleSlashCommand(trimmed, config, session, tokenTracker, skills, mcp, rl);
      if (result === "exit") {
        await cleanup(mcp, plugins, session);
        process.exit(0);
      }
      rl.prompt();
      return;
    }

    isProcessing = true;
    session.messages.push({ role: "user", content: trimmed });

    const tools = new ToolRegistry();
    if (mcp) {
      tools.registerMany(mcp.getTools());
    }

    const spinner = new Spinner("Thinking");
    let spinnerActive = false;
    let textBuffer = "";
    let hasBufferedText = false;
    const progress = new ProgressRenderer();

    const agent = new Agent({
      config,
      tools,
      skills,
      tokenTracker,
      onEvent: (event) => {
        if (event.type === "text") {
          if (!hasBufferedText) {
            hasBufferedText = true;
            if (spinnerActive) {
              spinner.stop();
              spinnerActive = false;
            }
          }
          textBuffer += event.content;
        } else if (event.type === "tool_call") {
          if (hasBufferedText && textBuffer.trim()) {
            const rendered = renderMarkdown(textBuffer);
            stdout.write("\n  " + rendered + "\n");
            textBuffer = "";
            hasBufferedText = false;
          } else if (hasBufferedText) {
            stdout.write(textBuffer);
            textBuffer = "";
            hasBufferedText = false;
          }
          stdout.write("\n");
          console.log(
            chalk.yellow("  ⚡ ") + chalk.bold(event.name) +
            chalk.gray(" " + truncateArgs(event.args)),
          );
        } else if (event.type === "tool_result") {
          const lines = event.output.split("\n");
          const maxLines = 15;
          const preview = lines.slice(0, maxLines).join("\n");
          const truncation = lines.length > maxLines
            ? chalk.gray(`\n  ... (${lines.length - maxLines} more lines)`)
            : "";
          const icon = event.error ? chalk.red("  ✗ ") : chalk.green("  ✓ ");
          console.log(icon + chalk.gray(preview) + truncation);
        } else if (event.type === "todo_update") {
          progress.update(event.todos);
        } else if (event.type === "thinking") {
        } else if (event.type === "error") {
          console.error(chalk.red(`\n  [error] ${event.message}`));
        }
      },
      shouldApprove: async (name, args) => {
        if (spinnerActive) {
          spinner.stop();
          spinnerActive = false;
        }
        // Flush any buffered text before showing approval prompt
        if (hasBufferedText && textBuffer.trim()) {
          const rendered = renderMarkdown(textBuffer);
          stdout.write("\n  " + rendered + "\n");
          textBuffer = "";
          hasBufferedText = false;
        }
        return await promptApproval(name, args);
      },
    });

    if (!hasBufferedText) {
      spinner.start();
      spinnerActive = true;
    }

    try {
      const updated = await agent.run(session.messages);
      session.messages = updated;
      session.usage = tokenTracker.getSessionUsage();
      saveSession(session);
    } catch (err: unknown) {
      if (spinnerActive) {
        spinner.stop();
        spinnerActive = false;
      }
      const error = err as { message: string };
      console.error(chalk.red(`\n  Error: ${error.message}`));
    }

    if (spinnerActive) {
      spinner.stop();
      spinnerActive = false;
    }

    // Clear progress bar before final text output
    progress.clear();

    // Flush any remaining buffered text as rendered markdown
    if (hasBufferedText && textBuffer.trim()) {
      const rendered = renderMarkdown(textBuffer);
      stdout.write("\n  " + rendered + "\n");
      textBuffer = "";
      hasBufferedText = false;
    } else if (hasBufferedText) {
      stdout.write(textBuffer);
      textBuffer = "";
      hasBufferedText = false;
    }

    // Re-render final progress state (completed or in-progress)
    if (progress.hasTodos()) {
      progress.update(progress.getTodos());
    }

    // Clear todo list for next user input
    clearTodoList();

    const lastTurn = tokenTracker.getLastTurn();
    if (lastTurn) {
      console.log(chalk.gray(`\n  ── ${lastTurn.promptTokens}p + ${lastTurn.completionTokens}c = ${lastTurn.totalTokens}t | session: ${tokenTracker.getSessionUsage().total.totalTokens}t ──`));
    }

    console.log();
    isProcessing = false;
    rl.prompt();
  });

  rl.on("close", async () => {
    clearHint();
    session.usage = tokenTracker.getSessionUsage();
    saveSession(session);
    await cleanup(mcp, plugins, session);
    console.log(chalk.gray("\n  Session saved. Goodbye!\n"));
    process.exit(0);
  });
}

async function cleanup(mcp: MCPManager | undefined, plugins: PluginManager, session: Session) {
  saveSession(session);
  if (mcp) await mcp.disconnectAll();
  await plugins.destroyAll();
}

function handleEvent(event: AgentEvent, interactive: boolean) {
  switch (event.type) {
    case "text":
      // Text is buffered by the caller and rendered on done
      // This case is unused when using bufferText mode
      stdout.write(event.content);
      break;
    case "thinking":
      if (interactive) {
        stdout.write(chalk.gray.dim(event.content));
      }
      break;
    case "tool_call":
      if (interactive) stdout.write("\n");
      console.log(
        chalk.yellow("  ⚡ ") + chalk.bold(event.name) +
        chalk.gray(" " + truncateArgs(event.args)),
      );
      break;
    case "tool_result": {
      const lines = event.output.split("\n");
      const maxLines = 15;
      const preview = lines.slice(0, maxLines).join("\n");
      const truncation = lines.length > maxLines
        ? chalk.gray(`\n  ... (${lines.length - maxLines} more lines)`)
        : "";
      const icon = event.error ? chalk.red("  ✗ ") : chalk.green("  ✓ ");
      console.log(icon + chalk.gray(preview) + truncation);
      break;
    }
    case "permission_request":
      break;
    case "usage":
      break;
    case "done":
      break;
    case "error":
      console.error(chalk.red(`\n  [error] ${event.message}`));
      break;
  }
}

function truncateArgs(args: Record<string, unknown>): string {
  const str = JSON.stringify(args);
  return str.length > 120 ? str.slice(0, 117) + "..." : str;
}

async function promptApproval(
  name: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  return new Promise((resolve) => {
    const detail = JSON.stringify(args, null, 2).slice(0, 500);
    console.log(chalk.yellow(`\n  ⚡ Permission required: ${chalk.bold(name)}`));
    console.log(chalk.gray(`  ${detail}`));

    const rl = createInterface({ input: stdin, output: stdout });
    rl.question(chalk.yellow("  Approve? [y/N] "), (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes");
    });
  });
}

async function handleSlashCommand(
  input: string,
  config: AppConfig,
  session: Session,
  tokenTracker: TokenTracker,
  skills: SkillManager | undefined,
  mcp: MCPManager | undefined,
  rl: ReturnType<typeof createInterface>,
): Promise<string | void> {
  const [cmd, ...rest] = input.slice(1).split(" ");

  switch (cmd) {
    case "exit":
    case "quit":
      return "exit";

    case "clear":
      session.messages = [];
      tokenTracker.reset();
      saveSession(session);
      console.log(chalk.gray("  ✓ Session cleared."));
      break;

    case "help":
      console.log(chalk.gray(`
  ${chalk.bold("Commands:")}
    /help          Show this help
    /exit          Exit (saves session)
    /clear         Clear conversation history
    /model         Open interactive model picker (mouse + keyboard)
    /model <p/m>   Switch to specific model (e.g. volcengine-plan/glm-5.2)
    /provider      List all providers from opencode config
    /save          Save session manually
    /session       Show session ID
    /history       Show message count
    /tokens        Show token usage stats
    /skills        List active skills
    /mcp           List MCP servers and tools
    /tools         List available tools
    /cost          Estimate session cost
`));
      break;

    case "model": {
      if (rest.length > 0) {
        const modelStr = rest.join(" ");
        const resolved = resolveModel(modelStr);
        if (!resolved) {
          console.log(chalk.red(`  Model '${modelStr}' not found in opencode config.`));
          const all = getAllModelStrings();
          if (all.length > 0) {
            console.log(chalk.gray("  Available:"));
            for (const m of all.slice(0, 15)) {
              console.log(chalk.gray(`    ${m}`));
            }
          }
          break;
        }
        config.opencodeModel = modelStr;
        config.model = `${resolved.providerId}/${resolved.modelId}`;
        config.apiKey = resolved.apiKey;
        config.baseUrl = resolved.baseURL;
        config.provider = resolved.npm;
        session.model = config.model;
        saveConfig({ opencodeModel: modelStr });
        console.log(chalk.green(`  ✓ Model: ${resolved.providerId}/${resolved.modelId}`));
        console.log(chalk.gray(`    Provider: ${resolved.providerName}`));
      } else {
        // Interactive model picker
        const selected = await showModelPicker(config.model, rl);
        if (selected) {
          const resolved = resolveModel(selected);
          if (resolved) {
            config.opencodeModel = selected;
            config.model = `${resolved.providerId}/${resolved.modelId}`;
            config.apiKey = resolved.apiKey;
            config.baseUrl = resolved.baseURL;
            config.provider = resolved.npm;
            session.model = config.model;
            saveConfig({ opencodeModel: selected });
            console.log(chalk.green(`  ✓ Model: ${resolved.providerId}/${resolved.modelId}`));
            console.log(chalk.gray(`    Provider: ${resolved.providerName}`));
          }
        }
      }
      break;
    }

    case "provider": {
      const providers = listOpencodeProviders();
      if (providers.length === 0) {
        console.log(chalk.gray("  No providers found in opencode config."));
        break;
      }
      console.log(chalk.bold.cyan("\n  Providers (opencode config)\n"));
      for (const p of providers) {
        const isActive = config.model.startsWith(p.id + "/");
        const marker = isActive ? chalk.green(" ← active") : "";
        const keyDisplay = p.hasApiKey ? chalk.green("✓") : chalk.red("✗");
        console.log(`  ${chalk.bold(p.id)}${marker}  ${keyDisplay}  ${chalk.gray(p.npm)}`);
        for (const m of p.models) {
          const modelStr = `${p.id}/${m.id}`;
          const active = modelStr === config.model;
          const mMarker = active ? chalk.green("  ← ") : "    ";
          console.log(`  ${mMarker}${modelStr}`);
        }
      }
      console.log(chalk.gray(`\n  Use /model <provider/model> to switch`));
      console.log();
      break;
    }

    case "save":
      saveSession(session);
      console.log(chalk.gray(`  ✓ Saved: ${session.id}`));
      break;

    case "session":
      console.log(chalk.gray(`  Session: ${session.id}`));
      break;

    case "history":
      console.log(chalk.gray(`  Messages: ${session.messages.length}`));
      break;

    case "tokens": {
      const usage = tokenTracker.getSessionUsage();
      console.log(chalk.bold.cyan("\n  Token Usage\n"));
      console.log(`  Turns:           ${usage.turns}`);
      console.log(`  Prompt tokens:   ${chalk.yellow(usage.total.promptTokens)}`);
      console.log(`  Output tokens:   ${chalk.green(usage.total.completionTokens)}`);
      console.log(`  Total tokens:    ${chalk.bold(usage.total.totalTokens)}`);
      console.log();
      break;
    }

    case "skills": {
      const all = skills?.getAll() || [];
      if (all.length === 0) {
        console.log(chalk.gray("  No skills loaded."));
      } else {
        console.log(chalk.bold.cyan(`\n  Skills (${all.length})\n`));
        for (const s of all) {
          console.log(`  ${chalk.bold(s.name)}  ${chalk.gray(s.description.slice(0, 60))}`);
        }
        console.log();
      }
      break;
    }

    case "mcp": {
      if (!mcp || mcp.getServerNames().length === 0) {
        console.log(chalk.gray("  No MCP servers connected."));
      } else {
        console.log(chalk.bold.cyan("\n  MCP Servers\n"));
        console.log(mcp.formatServersList());
        console.log();
      }
      break;
    }

    case "tools": {
      const tools = new ToolRegistry();
      if (mcp) tools.registerMany(mcp.getTools());
      const all = tools.getAll();
      console.log(chalk.bold.cyan(`\n  Tools (${all.length})\n`));
      for (const t of all) {
        const perm = t.requirePermission ? chalk.yellow(" ⚡") : "";
        console.log(`  ${chalk.bold(t.name)}${perm}  ${chalk.gray(t.description.slice(0, 60))}`);
      }
      console.log();
      break;
    }

    case "cost": {
      const usage = tokenTracker.getSessionUsage();
      const inputCost = (usage.total.promptTokens / 1_000_000) * 3;
      const outputCost = (usage.total.completionTokens / 1_000_000) * 15;
      console.log(chalk.bold.cyan("\n  Cost Estimate (GPT-4o pricing)\n"));
      console.log(`  Input:  $${inputCost.toFixed(4)} (${usage.total.promptTokens} tokens)`);
      console.log(`  Output: $${outputCost.toFixed(4)} (${usage.total.completionTokens} tokens)`);
      console.log(`  Total:  ${chalk.bold.green("$" + (inputCost + outputCost).toFixed(4))}`);
      console.log();
      break;
    }

    default:
      console.log(chalk.red(`  Unknown command: /${cmd}. Type /help for available commands.`));
  }
}

function parseConfigValue(key: string, value: string): Partial<AppConfig> {
  const result: Partial<AppConfig> = {};
  switch (key) {
    case "maxTurns":
      result.maxTurns = parseInt(value, 10);
      break;
    case "autoApprove":
      result.autoApprove = value === "true" || value === "1";
      break;
    case "sandbox":
      result.sandbox = value === "true" || value === "1";
      break;
    case "mcpServers":
    case "skillsPaths":
    case "plugins":
      try {
        (result as Record<string, unknown>)[key] = JSON.parse(value);
      } catch {
        (result as Record<string, unknown>)[key] = value;
      }
      break;
    default:
      (result as Record<string, unknown>)[key] = value;
  }
  return result;
}
