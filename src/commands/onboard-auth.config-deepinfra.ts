import type { OpenClawConfig } from "../config/config.js";
import type { AgentModelEntryConfig } from "../config/types.agent-defaults.js";
import {
  buildDeepInfraModelDefinition,
  DEEPINFRA_BASE_URL,
  DEEPINFRA_MODEL_CATALOG,
} from "../agents/deepinfra-models.js";
import {
  applyAgentDefaultModelPrimary,
  applyProviderConfigWithModelCatalog,
} from "./onboard-auth.config-shared.js";

export { DEEPINFRA_BASE_URL };

export const DEEPINFRA_DEFAULT_MODEL_ID = "deepseek-ai/DeepSeek-V3.2";
export const DEEPINFRA_DEFAULT_MODEL_REF = `deepinfra/${DEEPINFRA_DEFAULT_MODEL_ID}`;

/**
 * Apply DeepInfra provider configuration without changing the default model.
 * Registers DeepInfra models and sets up the provider, but preserves existing model selection.
 */
export function applyDeepInfraProviderConfig(cfg: OpenClawConfig): OpenClawConfig {
  const models: Record<string, AgentModelEntryConfig> = { ...cfg.agents?.defaults?.models };
  models[DEEPINFRA_DEFAULT_MODEL_REF] = {
    ...models[DEEPINFRA_DEFAULT_MODEL_REF],
    alias: models[DEEPINFRA_DEFAULT_MODEL_REF]?.alias ?? "DeepSeek V3.2",
  };

  const deepInfraModels = DEEPINFRA_MODEL_CATALOG.map(buildDeepInfraModelDefinition);
  return applyProviderConfigWithModelCatalog(cfg, {
    agentModels: models,
    providerId: "deepinfra",
    api: "openai-completions",
    baseUrl: DEEPINFRA_BASE_URL,
    catalogModels: deepInfraModels,
  });
}

/**
 * Apply DeepInfra provider configuration AND set DeepInfra as the default model.
 * Use this when DeepInfra is the primary provider choice during onboarding.
 */
export function applyDeepInfraConfig(cfg: OpenClawConfig): OpenClawConfig {
  const next = applyDeepInfraProviderConfig(cfg);
  return applyAgentDefaultModelPrimary(next, DEEPINFRA_DEFAULT_MODEL_REF);
}
