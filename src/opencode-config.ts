import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface OpencodeModelDef {
  name?: string;
  limit?: { context?: number; output?: number };
  modalities?: { input?: string[]; output?: string[] };
}

export interface OpencodeProviderDef {
  name?: string;
  npm?: string;
  options?: {
    apiKey?: string;
    baseURL?: string;
    [key: string]: unknown;
  };
  models?: Record<string, OpencodeModelDef>;
}

export interface OpencodeConfig {
  $schema?: string;
  model?: string;
  provider?: Record<string, OpencodeProviderDef>;
}

export interface ResolvedModel {
  providerId: string;
  modelId: string;
  apiKey: string;
  baseURL: string;
  npm: string;
  providerName: string;
  modelName: string;
  contextLimit?: number;
  outputLimit?: number;
}

function findOpencodeConfigPath(): string | null {
  const candidates = [
    join(process.cwd(), "opencode.json"),
    join(process.cwd(), "opencode.jsonc"),
    join(homedir(), ".config", "opencode", "opencode.json"),
    join(homedir(), ".config", "opencode", "opencode.jsonc"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function loadOpencodeConfig(): OpencodeConfig | null {
  const path = findOpencodeConfigPath();
  if (!path) return null;

  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as OpencodeConfig;
  } catch {
    return null;
  }
}

export function getOpencodeConfigPath(): string | null {
  return findOpencodeConfigPath();
}

export function listOpencodeProviders(): Array<{
  id: string;
  name: string;
  npm: string;
  baseURL: string;
  hasApiKey: boolean;
  models: Array<{ id: string; name: string; context?: number }>;
}> {
  const config = loadOpencodeConfig();
  if (!config?.provider) return [];

  return Object.entries(config.provider).map(([id, def]) => ({
    id,
    name: def.name || id,
    npm: def.npm || "@ai-sdk/openai-compatible",
    baseURL: def.options?.baseURL || "",
    hasApiKey: !!def.options?.apiKey,
    models: Object.entries(def.models || {}).map(([mid, mdef]) => ({
      id: mid,
      name: mdef.name || mid,
      context: mdef.limit?.context,
    })),
  }));
}

export function resolveModel(modelStr?: string): ResolvedModel | null {
  const config = loadOpencodeConfig();
  if (!config) return null;

  const model = modelStr || config.model;
  if (!model) return null;

  let providerId: string;
  let modelId: string;

  if (model.includes("/")) {
    const parts = model.split("/");
    providerId = parts[0];
    modelId = parts.slice(1).join("/");
  } else {
    const providers = Object.keys(config.provider || {});
    if (providers.length === 0) return null;
    providerId = providers[0];
    modelId = model;
  }

  const providerDef = config.provider?.[providerId];
  if (!providerDef) return null;

  const modelDef = providerDef.models?.[modelId];

  return {
    providerId,
    modelId,
    apiKey: providerDef.options?.apiKey || "",
    baseURL: providerDef.options?.baseURL || "",
    npm: providerDef.npm || "@ai-sdk/openai-compatible",
    providerName: providerDef.name || providerId,
    modelName: modelDef?.name || modelId,
    contextLimit: modelDef?.limit?.context,
    outputLimit: modelDef?.limit?.output,
  };
}

export function getAllModelStrings(): string[] {
  const config = loadOpencodeConfig();
  if (!config?.provider) return [];

  const models: string[] = [];
  for (const [providerId, def] of Object.entries(config.provider)) {
    for (const modelId of Object.keys(def.models || {})) {
      models.push(`${providerId}/${modelId}`);
    }
  }
  return models;
}

export function getProviderModelStrings(providerId: string): string[] {
  const config = loadOpencodeConfig();
  if (!config?.provider?.[providerId]) return [];

  const def = config.provider[providerId];
  return Object.keys(def.models || {}).map((mid) => `${providerId}/${mid}`);
}
