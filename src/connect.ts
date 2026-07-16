import type { Interface } from "node:readline";
import chalk from "chalk";
import {
  loadOpencodeConfig,
  saveOpencodeConfig,
  type OpencodeConfig,
  type OpencodeProviderDef,
} from "./opencode-config.js";

function ask(rl: Interface, promptText: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(promptText, (answer) => resolve(answer.trim()));
  });
}

/**
 * Interactively add a new third-party API provider to opencode.json.
 */
export async function runConnect(rl: Interface): Promise<void> {
  const providerId = await ask(rl, chalk.gray("Provider ID (e.g. deepseek): "));
  const baseURL = await ask(rl, chalk.gray("API base URL: "));
  const apiKey = await ask(rl, chalk.gray("API key: "));
  const modelId = await ask(rl, chalk.gray("Model ID (e.g. deepseek-chat): "));

  if (!providerId || !baseURL || !apiKey || !modelId) {
    console.log(chalk.gray("Cancelled."));
    return;
  }

  const config: OpencodeConfig = loadOpencodeConfig() || { provider: {} };
  config.provider = config.provider || {};

  const providerDef: OpencodeProviderDef = {
    name: providerId,
    npm: "@ai-sdk/openai-compatible",
    options: { apiKey, baseURL },
    models: { [modelId]: { name: modelId } },
  };

  config.provider[providerId] = providerDef;
  saveOpencodeConfig(config);

  console.log(
    chalk.green(
      `✓ Connected ${providerId}. Use /model ${providerId}/${modelId} to switch.`,
    ),
  );
}
