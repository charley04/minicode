import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "./types.js";
import { loadOpencodeConfig, resolveModel, getOpencodeConfigPath } from "./opencode-config.js";

const CONFIG_DIR = join(homedir(), ".minicode");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: AppConfig = {
  model: "",
  apiKey: "",
  baseUrl: "",
  provider: "",
  opencodeModel: "",
  maxTurns: 50,
  autoApprove: false,
  systemPromptExtra: "",
  sandbox: false,
  sandboxImage: "node:22-slim",
  mcpServers: [],
  skillsPaths: [],
  plugins: [],
};

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function loadConfig(overrides?: Partial<AppConfig>): AppConfig {
  let config: AppConfig = { ...DEFAULT_CONFIG };

  // Load minicode config file for non-model settings
  if (existsSync(CONFIG_FILE)) {
    try {
      const raw = readFileSync(CONFIG_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      config = { ...config, ...parsed };
    } catch {
      // ignore
    }
  }

  // Resolve model from opencode config
  const ocConfig = loadOpencodeConfig();
  if (ocConfig) {
    if (!config.opencodeModel && ocConfig.model) {
      config.opencodeModel = ocConfig.model;
    }
    const resolved = resolveModel(config.opencodeModel);
    if (resolved) {
      config.model = `${resolved.providerId}/${resolved.modelId}`;
      config.apiKey = resolved.apiKey;
      config.baseUrl = resolved.baseURL;
      config.provider = resolved.npm;
    }
  }

  // Environment variable overrides (highest priority for model)
  if (process.env.MINICODE_MODEL) {
    config.opencodeModel = process.env.MINICODE_MODEL;
    const resolved = resolveModel(config.opencodeModel);
    if (resolved) {
      config.model = `${resolved.providerId}/${resolved.modelId}`;
      config.apiKey = resolved.apiKey;
      config.baseUrl = resolved.baseURL;
      config.provider = resolved.npm;
    }
  }

  // Legacy env var fallbacks (when no opencode config)
  if (!config.apiKey) {
    if (process.env.OPENAI_API_KEY || process.env.MINICODE_API_KEY) {
      config.apiKey = process.env.OPENAI_API_KEY || process.env.MINICODE_API_KEY!;
    }
  }
  if (!config.baseUrl) {
    if (process.env.OPENAI_BASE_URL || process.env.MINICODE_BASE_URL) {
      config.baseUrl = process.env.OPENAI_BASE_URL || process.env.MINICODE_BASE_URL!;
    }
  }

  if (overrides) {
    config = { ...config, ...overrides };
  }

  return config;
}

export function saveConfig(config: Partial<AppConfig>): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  const existing = existsSync(CONFIG_FILE)
    ? JSON.parse(readFileSync(CONFIG_FILE, "utf-8"))
    : {};
  const toSave = { ...config };
  // Don't persist fields that come from opencode config
  delete toSave.apiKey;
  delete toSave.baseUrl;
  delete toSave.model;
  delete toSave.provider;
  const merged = { ...existing, ...toSave };
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
}

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  const sessionsDir = join(CONFIG_DIR, "sessions");
  if (!existsSync(sessionsDir)) {
    mkdirSync(sessionsDir, { recursive: true });
  }
}

export function getOpencodePath(): string | null {
  return getOpencodeConfigPath();
}
