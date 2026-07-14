import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir, ensureConfigDir } from "./config.js";
import type { Session } from "./types.js";

function getSessionsDir(): string {
  return join(getConfigDir(), "sessions");
}

export function createSession(cwd: string, model: string): Session {
  ensureConfigDir();
  const id = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const session: Session = {
    id,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    cwd,
    model,
  };
  saveSession(session);
  return session;
}

export function saveSession(session: Session): void {
  ensureConfigDir();
  const filePath = join(getSessionsDir(), `${session.id}.json`);
  session.updatedAt = Date.now();
  writeFileSync(filePath, JSON.stringify(session, null, 2), "utf-8");
}

export function loadSession(id: string): Session | null {
  const filePath = join(getSessionsDir(), `${id}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function listSessions(): Session[] {
  const dir = getSessionsDir();
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const sessions: Session[] = [];

  for (const file of files) {
    try {
      const raw = readFileSync(join(dir, file), "utf-8");
      const session = JSON.parse(raw) as Session;
      sessions.push(session);
    } catch {
      // skip malformed
    }
  }

  sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  return sessions;
}

export function deleteSession(id: string): boolean {
  const filePath = join(getSessionsDir(), `${id}.json`);
  if (!existsSync(filePath)) return false;
  try {
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

export function getSessionMessages(session: Session): import("./types.js").ChatMessage[] {
  return session.messages;
}
