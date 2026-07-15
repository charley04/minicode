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
import type { AppConfig, AgentEvent, Session, ApprovalDecision } from "./types.js";
import { renderToolCallInline, renderToolResult, renderApprovalPreview } from "./renderers.js";
import { DIFF_MARKER } from "./tools/write.js";

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
          stdout.write(renderAssistantBlock(textBuffer));
          textBuffer = "";
          hasBufferedText = false;
        }
        console.log(
          chalk.yellow("  ⚡ ") + chalk.bold(event.name) + "  " +
          renderToolCallInline(event.name, event.args),
        );
      } else if (event.type === "tool_result") {
        console.log(renderToolResult(event.name, event.display ?? event.output, event.error === true, "  "));
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
      stdout.write(renderAssistantBlock(textBuffer));
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

  renderBanner(config, { skills: skillCount, mcpServers: mcpServerCount, mcpTools: mcpToolCount });
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
        console.log(chalk.green.bold("  ▶ user"));
        const content = msg.content ?? "";
        console.log(chalk.gray("  │ ") + content.split("\n").join("\n" + chalk.gray("  │ ")));
      } else if (msg.role === "assistant" && msg.content) {
        stdout.write(renderAssistantBlock(msg.content));
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
    prompt: buildPrompt(config),
    completer: createCompleter(),
  });

  // Enable bracketed paste mode: multi-line clipboard input arrives wrapped in
  // ESC[200~ ... ESC[201~. We intercept stdin BEFORE readline sees it: paste
  // bytes are captured (never forwarded to readline, so they can't trigger
  // premature line submits), while non-paste bytes are passed through
  // untouched. When a paste finishes we inject a short placeholder into
  // readline's buffer and store the real payload for later.
  stdout.write("\x1b[?2004h");
  const PASTE_START = "\x1b[200~";
  const PASTE_END = "\x1b[201~";
  let pasting = false;
  let pasteBuf = "";
  const pendingPastes: Array<{ token: string; text: string }> = [];

  // Snapshot the data listeners readline already installed on stdin, then
  // remove them. Our proxy will forward filtered chunks to those listeners.
  const rlDataListeners = stdin.listeners("data").slice() as Array<(chunk: Buffer) => void>;
  for (const fn of rlDataListeners) stdin.removeListener("data", fn as any);

  const forwardToReadline = (bytes: Buffer) => {
    if (bytes.length === 0) return;
    for (const fn of rlDataListeners) fn(bytes);
  };

  const insertPasteToken = (payload: string) => {
    const token = `[paste#${pendingPastes.length + 1}:${payload.split("\n").length}L]`;
    pendingPastes.push({ token, text: payload });
    // Feed the placeholder into readline so it appears on the current line.
    forwardToReadline(Buffer.from(token, "utf-8"));
  };

  const pasteProxy = (buf: Buffer) => {
    const s = buf.toString("utf-8");
    let i = 0;
    let passthrough = "";
    while (i < s.length) {
      if (!pasting) {
        const idx = s.indexOf(PASTE_START, i);
        if (idx < 0) {
          passthrough += s.slice(i);
          break;
        }
        passthrough += s.slice(i, idx);
        i = idx + PASTE_START.length;
        pasting = true;
        pasteBuf = "";
      } else {
        const idx = s.indexOf(PASTE_END, i);
        if (idx < 0) {
          pasteBuf += s.slice(i);
          break;
        }
        pasteBuf += s.slice(i, idx);
        i = idx + PASTE_END.length;
        pasting = false;
        // Flush any accumulated passthrough BEFORE injecting the token so
        // characters typed around the paste keep their order.
        if (passthrough.length > 0) {
          forwardToReadline(Buffer.from(passthrough, "utf-8"));
          passthrough = "";
        }
        const payload = pasteBuf.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        pasteBuf = "";
        insertPasteToken(payload);
      }
    }
    if (passthrough.length > 0) {
      forwardToReadline(Buffer.from(passthrough, "utf-8"));
    }
  };
  stdin.on("data", pasteProxy);

  let isProcessing = false;
  let activeController: AbortController | null = null;
  let interruptRequested = false;
  let lastCtrlCTime = 0;

  rl.prompt();

  process.stdin.on("keypress", (char: string, key: { name?: string; ctrl?: boolean; meta?: boolean } | undefined) => {
    if (!isProcessing) {
      handleKeyPress(char, key, rl.line);
      return;
    }

    // While the agent is running, capture ESC and Ctrl+C for interrupt.
    if (key?.name === "escape") {
      if (!interruptRequested && activeController) {
        interruptRequested = true;
        activeController.abort();
        stdout.write("\r\x1b[2K");
        console.log(chalk.yellow("  ⏸  Interrupt requested (ESC) — stopping..."));
      }
      return;
    }
    if (key?.ctrl && key.name === "c") {
      const now = Date.now();
      if (activeController && !interruptRequested) {
        interruptRequested = true;
        activeController.abort();
        stdout.write("\r\x1b[2K");
        console.log(chalk.yellow("  ⏸  Interrupt requested (Ctrl+C) — press again to exit."));
        lastCtrlCTime = now;
      } else if (now - lastCtrlCTime < 2000) {
        // Double Ctrl+C → exit
        console.log(chalk.gray("\n  Exiting..."));
        process.exit(130);
      }
      return;
    }
  });

  rl.on("line", async (input) => {
    clearHint();

    // Splice any paste tokens back into their real multi-line text.
    let expanded = input;
    if (pendingPastes.length > 0) {
      for (const p of pendingPastes) {
        expanded = expanded.split(p.token).join(p.text);
      }
      pendingPastes.length = 0;
    }
    const trimmed = expanded.trim();

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
    interruptRequested = false;
    activeController = new AbortController();
    session.messages.push({ role: "user", content: trimmed });

    const tools = new ToolRegistry();
    if (mcp) {
      tools.registerMany(mcp.getTools());
    }

    const spinner = new Spinner("Contacting model...");
    let spinnerActive = false;
    let textBuffer = "";
    let hasBufferedText = false;
    let sessionTotalTokens = tokenTracker.getSessionUsage().total.totalTokens;
    const progress = new ProgressRenderer();

    const updateSpinner = (base: string) => {
      const tokenTag = sessionTotalTokens > 0
        ? chalk.gray(` · ${formatTokens(sessionTotalTokens)} tokens`)
        : "";
      spinner.update(base + tokenTag);
    };

    const agent = new Agent({
      config,
      tools,
      skills,
      tokenTracker,
      signal: activeController.signal,
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
            stdout.write(renderAssistantBlock(textBuffer));
            textBuffer = "";
            hasBufferedText = false;
          } else if (hasBufferedText) {
            stdout.write(textBuffer);
            textBuffer = "";
            hasBufferedText = false;
          }
          if (spinnerActive) {
            spinner.stop();
            spinnerActive = false;
          }
          stdout.write("\n");
          console.log(
            chalk.yellow("  ⚡ ") + chalk.bold(event.name) + "  " +
            renderToolCallInline(event.name, event.args),
          );
          // Restart spinner to show "Running <name>..." until result arrives
          updateSpinner(`Running ${event.name}...`);
          spinner.start();
          spinnerActive = true;
        } else if (event.type === "tool_result") {
          if (spinnerActive) {
            spinner.stop();
            spinnerActive = false;
          }
          console.log(renderToolResult(event.name, event.display ?? event.output, event.error === true, "  "));
          // After tool result, we're waiting for the next model call
          updateSpinner("Thinking...");
          spinner.start();
          spinnerActive = true;
        } else if (event.type === "usage") {
          sessionTotalTokens = tokenTracker.getSessionUsage().total.totalTokens;
          if (spinnerActive) {
            // Refresh the spinner message with new token count
            const currentMsg = (spinner as any).message?.split(" · ")[0] ?? "Thinking...";
            updateSpinner(currentMsg);
          }
        } else if (event.type === "todo_update") {
          progress.update(event.todos);
        } else if (event.type === "thinking") {
          // Show reasoning as dim text (interactive mode used to swallow this)
          if (spinnerActive) {
            spinner.stop();
            spinnerActive = false;
          }
          stdout.write(chalk.gray.dim(event.content));
        } else if (event.type === "error") {
          if (spinnerActive) {
            spinner.stop();
            spinnerActive = false;
          }
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
          stdout.write(renderAssistantBlock(textBuffer));
          textBuffer = "";
          hasBufferedText = false;
        }
        // Pause the main readline while we take over stdin for the key prompt.
        rl.pause();
        try {
          const decision = await promptApproval(name, args);
          return decision;
        } finally {
          rl.resume();
        }
      },
    });

    updateSpinner("Contacting model...");
    spinner.start();
    spinnerActive = true;

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
      const error = err as { message: string; name?: string };
      if (error.name === "AbortError" || interruptRequested) {
        console.log(chalk.yellow(`\n  ⏸  Interrupted.`));
      } else {
        console.error(chalk.red(`\n  Error: ${error.message}`));
      }
    }

    if (spinnerActive) {
      spinner.stop();
      spinnerActive = false;
    }

    // Clear progress bar before final text output
    progress.clear();

    // Flush any remaining buffered text as rendered markdown
    if (hasBufferedText && textBuffer.trim()) {
      stdout.write(renderAssistantBlock(textBuffer));
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
    activeController = null;
    interruptRequested = false;
    isProcessing = false;
    rl.prompt();
  });

  rl.on("close", async () => {
    clearHint();
    stdout.write("\x1b[?2004l"); // disable bracketed paste
    stdin.removeListener("data", pasteProxy);
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
        chalk.yellow("  ⚡ ") + chalk.bold(event.name) + "  " +
        renderToolCallInline(event.name, event.args),
      );
      break;
    case "tool_result": {
      console.log(renderToolResult(event.name, event.display ?? event.output, event.error === true, "  "));
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

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

/**
 * Extract a short model label like "ark-code-latest" or the last "/"-segment
 * for the prompt line. Full path stays in /status.
 */
function shortModelName(model: string): string {
  const s = model.split("/").pop() || model;
  return s.length > 32 ? s.slice(0, 29) + "…" : s;
}

function buildPrompt(config: AppConfig): string {
  const model = chalk.gray(`[${shortModelName(config.model)}]`);
  return `\n${model} ${chalk.green.bold("❯ ")}`;
}

function renderBanner(
  config: AppConfig,
  extras: { skills: number; mcpServers: number; mcpTools: number },
): void {
  const width = Math.min(process.stdout.columns || 80, 78);
  const inner = width - 4;
  const line = (s: string) => chalk.cyan("  │ ") + s + " ".repeat(Math.max(0, inner - stripAnsi(s).length)) + chalk.cyan(" │");
  const bar = chalk.cyan("  ╭" + "─".repeat(inner + 2) + "╮");
  const bot = chalk.cyan("  ╰" + "─".repeat(inner + 2) + "╯");
  const title = chalk.bold.cyan("MiniCode") + chalk.gray(`  v${VERSION}`);
  const rightHint = chalk.gray("terminal AI coding agent");
  const spaces = Math.max(1, inner - stripAnsiVisibleLen(title) - stripAnsiVisibleLen(rightHint));
  const titleRow = title + " ".repeat(spaces) + rightHint;

  const modelRow = chalk.gray("model  ") + chalk.white(config.model);
  const sdkRow = chalk.gray("sdk    ") + chalk.white(config.provider);
  const urlRow = config.baseUrl ? chalk.gray("url    ") + chalk.gray(config.baseUrl) : "";
  const cwdRow = chalk.gray("cwd    ") + chalk.gray(compressPath(process.cwd(), inner - 8));
  const extraBits: string[] = [];
  if (extras.skills > 0) extraBits.push(chalk.green(`skills:${extras.skills}`));
  if (extras.mcpServers > 0) extraBits.push(chalk.green(`mcp:${extras.mcpServers}/${extras.mcpTools}`));
  if (config.sandbox) extraBits.push(chalk.yellow("sandbox"));
  if (config.autoApprove) extraBits.push(chalk.red.bold("auto-approve"));
  const extrasRow = extraBits.length > 0 ? chalk.gray("plugins") + " " + extraBits.join(" ") : "";

  console.log();
  console.log(bar);
  console.log(line(titleRow));
  console.log(chalk.cyan("  │ ") + chalk.gray("─".repeat(inner)) + chalk.cyan(" │"));
  console.log(line(modelRow));
  console.log(line(sdkRow));
  if (urlRow) console.log(line(urlRow));
  console.log(line(cwdRow));
  if (extrasRow) console.log(line(extrasRow));
  console.log(bot);
}

function compressPath(p: string, max: number): string {
  if (p.length <= max) return p;
  const parts = p.replace(/\\/g, "/").split("/");
  if (parts.length <= 2) return "…" + p.slice(-max + 1);
  return parts[0] + "/…/" + parts.slice(-2).join("/");
}

function renderAssistantBlock(text: string): string {
  const rendered = renderMarkdown(text);
  // Prefix a subtle left rail so assistant output is visually distinct from
  // user input and tool blocks. Each line gets "│ " on the left.
  const lines = rendered.split("\n");
  const rail = chalk.gray("  │ ");
  const header = chalk.blue.bold("  ● assistant");
  return "\n" + header + "\n" + lines.map((l) => rail + l).join("\n") + "\n";
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}
function stripAnsiVisibleLen(s: string): number {
  return stripAnsi(s).length;
}

/**
 * Ask the user for permission using raw stdin. Returns a decision:
 *   y / Enter → once
 *   a → always allow this tool this session
 *   n → deny once
 *   s → deny and stop the agent
 * Any other key defaults to deny.
 *
 * NOTE: This function takes over stdin from readline for the duration of the
 * prompt. It saves and restores every existing stdin listener so that keys
 * pressed here (like "y") do NOT leak into the main readline buffer.
 */
async function promptApproval(
  name: string,
  args: Record<string, unknown>,
): Promise<ApprovalDecision> {
  console.log(chalk.yellow(`\n  ⚡ Permission required: ${chalk.bold(name)}`));
  console.log(renderApprovalPreview(name, args));
  const prompt =
    chalk.yellow("  Approve? ") +
    chalk.bold("[y]") + chalk.gray("es / ") +
    chalk.bold("[a]") + chalk.gray("lways / ") +
    chalk.bold("[n]") + chalk.gray("o / ") +
    chalk.bold("[s]") + chalk.gray("top ") +
    chalk.yellow("> ");

  return new Promise((resolve) => {
    const wasRaw = stdin.isTTY ? stdin.isRaw : false;

    // Snapshot every existing listener on stdin — readline, our own keypress
    // watcher, etc. — and detach them so single keypresses can't leak into the
    // main input buffer. We restore them all before resolving.
    const savedData = stdin.listeners("data").slice() as Array<(...a: any[]) => void>;
    const savedKeypress = stdin.listeners("keypress").slice() as Array<(...a: any[]) => void>;
    const savedReadable = stdin.listeners("readable").slice() as Array<(...a: any[]) => void>;
    for (const fn of savedData) stdin.removeListener("data", fn);
    for (const fn of savedKeypress) stdin.removeListener("keypress", fn);
    for (const fn of savedReadable) stdin.removeListener("readable", fn);

    if (stdin.isTTY) {
      try { stdin.setRawMode(true); } catch { /* ignore */ }
    }
    stdin.resume();
    stdout.write(prompt);

    const finish = (decision: ApprovalDecision, label: string) => {
      stdin.removeListener("data", onData);
      if (stdin.isTTY) {
        try { stdin.setRawMode(wasRaw); } catch { /* ignore */ }
      }
      // Restore prior listeners
      for (const fn of savedData) stdin.on("data", fn as any);
      for (const fn of savedKeypress) stdin.on("keypress", fn as any);
      for (const fn of savedReadable) stdin.on("readable", fn as any);
      stdout.write(label + "\n");
      resolve(decision);
    };

    const onData = (buf: Buffer) => {
      // Only consider the FIRST byte of whatever arrived. A paste of "yyy\n"
      // should count as a single "yes" — the rest is discarded so it can't
      // spill into the next prompt or into the readline buffer.
      const code = buf[0];
      const ch = String.fromCharCode(code);
      let decision: ApprovalDecision | null = null;
      let isStop = false;
      if (ch === "y" || ch === "Y" || code === 0x0d /* CR */ || code === 0x0a /* LF */) decision = "once";
      else if (ch === "a" || ch === "A") decision = "always";
      else if (ch === "n" || ch === "N") decision = "deny";
      else if (ch === "s" || ch === "S") { decision = "deny"; isStop = true; }
      else if (code === 0x03) decision = "deny"; // Ctrl+C
      else if (code === 0x1b) decision = "deny"; // ESC

      if (decision === null) {
        return; // wait for a valid key
      }

      const label = isStop
        ? chalk.red("stop")
        : decision === "once" ? chalk.green("allow once")
        : decision === "always" ? chalk.green("allow always")
        : chalk.red("deny");
      finish(isStop ? "stop" : decision, label);
    };

    stdin.on("data", onData);
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
    /status        Show current model, provider, session state
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

  ${chalk.bold("Shortcuts:")}
    ESC / Ctrl+C   Interrupt current turn (press Ctrl+C twice to exit)
    Multi-line     Paste multi-line text — it will be sent as one message
`));
      break;

    case "status": {
      const usage = tokenTracker.getSessionUsage();
      console.log();
      console.log(chalk.bold.cyan("  Status"));
      console.log(chalk.gray("  ─────────────────────────────────────────"));
      console.log(chalk.gray("  model      ") + chalk.white(config.model));
      console.log(chalk.gray("  sdk        ") + chalk.white(config.provider));
      if (config.baseUrl) console.log(chalk.gray("  url        ") + chalk.gray(config.baseUrl));
      console.log(chalk.gray("  session    ") + chalk.white(session.id));
      console.log(chalk.gray("  cwd        ") + chalk.gray(process.cwd()));
      console.log(chalk.gray("  messages   ") + chalk.white(String(session.messages.length)));
      console.log(chalk.gray("  turns      ") + chalk.white(String(usage.turns)));
      console.log(chalk.gray("  tokens     ") + chalk.yellow(`${usage.total.promptTokens}p`) + " + " + chalk.green(`${usage.total.completionTokens}c`) + " = " + chalk.bold(String(usage.total.totalTokens)));
      console.log(chalk.gray("  sandbox    ") + (config.sandbox ? chalk.yellow("on") : chalk.gray("off")));
      console.log(chalk.gray("  auto-approve ") + (config.autoApprove ? chalk.red.bold("ON") : chalk.gray("off")));
      if (skills) console.log(chalk.gray("  skills     ") + chalk.white(String(skills.getAll().length)));
      if (mcp) console.log(chalk.gray("  mcp        ") + chalk.white(`${mcp.getServerNames().length} servers · ${mcp.getTools().length} tools`));
      console.log();
      break;
    }

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
        rl.setPrompt(buildPrompt(config));
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
            rl.setPrompt(buildPrompt(config));
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
