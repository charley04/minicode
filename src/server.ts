import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import chalk from "chalk";
import type { AppConfig, AgentEvent } from "./types.js";
import { ToolRegistry } from "./tools/index.js";
import { Agent } from "./agent.js";
import { createSession, saveSession, loadSession } from "./session.js";
import { SkillManager } from "./skills.js";
import { MCPManager } from "./mcp.js";
import { TokenTracker } from "./token-tracker.js";
import { setSandbox } from "./tools/bash.js";
import { Sandbox } from "./sandbox.js";

export interface ServerOptions {
  port: number;
  host: string;
  config: AppConfig;
}

export async function startServer(opts: ServerOptions): Promise<void> {
  const { port, host, config } = opts;

  const skills = new SkillManager(config.skillsPaths);
  skills.discover();

  const mcp = new MCPManager(config.mcpServers);
  await mcp.connectAll();
  const mcpTools = mcp.getTools();

  const sandbox = new Sandbox(config.sandbox, config.sandboxImage);
  if (sandbox.isEnabled()) {
    const dockerOk = await Sandbox.isDockerAvailable();
    if (!dockerOk) {
      console.error(chalk.yellow("Warning: Docker not available, sandbox disabled"));
    } else {
      setSandbox(sandbox);
    }
  }

  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${host}:${port}`);

    if (url.pathname === "/health" && req.method === "GET") {
      sendJson(res, 200, { status: "ok", version: "0.2.0" });
      return;
    }

    if (url.pathname === "/api/sessions" && req.method === "GET") {
      const { listSessions } = await import("./session.js");
      const sessions = listSessions();
      sendJson(res, 200, sessions);
      return;
    }

    if (url.pathname === "/api/chat" && req.method === "POST") {
      const body = await readBody(req);
      const { message, sessionId } = JSON.parse(body);

      const tools = new ToolRegistry();
      tools.registerMany(mcpTools);

      let session = sessionId ? loadSession(sessionId) : null;
      if (!session) {
        session = createSession(process.cwd(), config.model);
      }
      session.messages.push({ role: "user", content: message });

      const tokenTracker = new TokenTracker();
      const events: AgentEvent[] = [];

      const agent = new Agent({
        config,
        tools,
        skills,
        tokenTracker,
        onEvent: (event) => {
          events.push(event);
        },
        shouldApprove: async () => config.autoApprove,
      });

      const updated = await agent.run(session.messages);
      session.messages = updated;
      session.usage = tokenTracker.getSessionUsage();
      saveSession(session);

      const textParts = events
        .filter((e) => e.type === "text")
        .map((e) => (e as { content: string }).content)
        .join("");

      const usage = tokenTracker.getSessionUsage();

      sendJson(res, 200, {
        sessionId: session.id,
        response: textParts,
        usage,
        events,
      });
      return;
    }

    if (url.pathname === "/api/tools" && req.method === "GET") {
      const tools = new ToolRegistry();
      tools.registerMany(mcpTools);
      sendJson(res, 200, tools.getAll().map((t) => ({
        name: t.name,
        description: t.description,
        requirePermission: t.requirePermission,
      })));
      return;
    }

    if (url.pathname === "/api/skills" && req.method === "GET") {
      sendJson(res, 200, skills.getAll());
      return;
    }

    if (url.pathname === "/api/mcp" && req.method === "GET") {
      sendJson(res, 200, {
        servers: mcp.getServerNames(),
        toolCount: mcp.getTools().length,
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: WebSocket) => {
    ws.on("message", async (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        const { type, payload } = msg;

        if (type === "chat") {
          const { message, sessionId } = payload;

          const tools = new ToolRegistry();
          tools.registerMany(mcpTools);

          let session = sessionId ? loadSession(sessionId) : null;
          if (!session) {
            session = createSession(process.cwd(), config.model);
          }
          session.messages.push({ role: "user", content: message });

          const tokenTracker = new TokenTracker();

          const agent = new Agent({
            config,
            tools,
            skills,
            tokenTracker,
            onEvent: (event) => {
              ws.send(JSON.stringify({ type: "event", payload: event }));
            },
            shouldApprove: async () => config.autoApprove,
          });

          const updated = await agent.run(session.messages);
          session.messages = updated;
          session.usage = tokenTracker.getSessionUsage();
          saveSession(session);

          ws.send(JSON.stringify({
            type: "done",
            payload: {
              sessionId: session.id,
              usage: tokenTracker.getSessionUsage(),
            },
          }));
        }
      } catch (err) {
        ws.send(JSON.stringify({
          type: "error",
          payload: { message: (err as Error).message },
        }));
      }
    });

    ws.send(JSON.stringify({ type: "connected", payload: { version: "0.2.0" } }));
  });

  server.listen(port, host, () => {
    console.log(chalk.bold.cyan(`\n  MiniCode Server v0.2.0`));
    console.log(chalk.gray(`  HTTP:  http://${host}:${port}`));
    console.log(chalk.gray(`  WS:    ws://${host}:${port}/ws`));
    console.log(chalk.gray(`  Skills: ${skills.getAll().length} loaded`));
    console.log(chalk.gray(`  MCP:    ${mcp.getServerNames().length} servers, ${mcpTools.length} tools`));
    console.log(chalk.gray(`  Press Ctrl+C to stop.\n`));
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
