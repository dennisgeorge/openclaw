import type { ModelDefinitionConfig } from "../config/types.models.js";

export const DEEPINFRA_BASE_URL = "https://api.deepinfra.com/v1/openai";

export const DEEPINFRA_MODEL_CATALOG: ModelDefinitionConfig[] = [
  {
    id: "deepseek-ai/DeepSeek-V3.2",
    name: "DeepSeek V3.2",
    reasoning: true,
    input: ["text"],
    contextWindow: 163840,
    maxTokens: 163840,
    cost: {
      input: 0.26,
      output: 0.38,
      cacheRead: 0.13,
      cacheWrite: 0.26,
    },
  },
  {
    id: "deepseek-ai/DeepSeek-R1",
    name: "DeepSeek R1",
    reasoning: true,
    input: ["text"],
    contextWindow: 65536,
    maxTokens: 8192,
    cost: {
      input: 0.55,
      output: 2.19,
      cacheRead: 0.55,
      cacheWrite: 0.55,
    },
  },
  {
    id: "meta-llama/Meta-Llama-3.1-70B-Instruct",
    name: "Meta Llama 3.1 70B Instruct",
    reasoning: false,
    input: ["text"],
    contextWindow: 128000,
    maxTokens: 4096,
    cost: {
      input: 0.35,
      output: 0.4,
      cacheRead: 0.35,
      cacheWrite: 0.35,
    },
  },
  {
    id: "meta-llama/Llama-3.3-70B-Instruct",
    name: "Llama 3.3 70B Instruct",
    reasoning: false,
    input: ["text"],
    contextWindow: 131072,
    maxTokens: 32768,
    cost: {
      input: 0.35,
      output: 0.4,
      cacheRead: 0.35,
      cacheWrite: 0.35,
    },
  },
  {
    id: "Qwen/Qwen2.5-72B-Instruct",
    name: "Qwen 2.5 72B Instruct",
    reasoning: false,
    input: ["text"],
    contextWindow: 131072,
    maxTokens: 8192,
    cost: {
      input: 0.35,
      output: 0.4,
      cacheRead: 0.35,
      cacheWrite: 0.35,
    },
  },
  {
    id: "Qwen/QwQ-32B-Preview",
    name: "QwQ 32B Preview",
    reasoning: true,
    input: ["text"],
    contextWindow: 32768,
    maxTokens: 8192,
    cost: {
      input: 0.35,
      output: 0.4,
      cacheRead: 0.35,
      cacheWrite: 0.35,
    },
  },
  {
    id: "nvidia/Llama-3.1-Nemotron-70B-Instruct",
    name: "Nvidia Llama 3.1 Nemotron 70B Instruct",
    reasoning: false,
    input: ["text"],
    contextWindow: 131072,
    maxTokens: 4096,
    cost: {
      input: 0.35,
      output: 0.4,
      cacheRead: 0.35,
      cacheWrite: 0.35,
    },
  },
  {
    id: "google/gemma-2-27b-it",
    name: "Google Gemma 2 27B IT",
    reasoning: false,
    input: ["text"],
    contextWindow: 8192,
    maxTokens: 8192,
    cost: {
      input: 0.27,
      output: 0.27,
      cacheRead: 0.27,
      cacheWrite: 0.27,
    },
  },
  {
    id: "mistralai/Mixtral-8x22B-Instruct-v0.1",
    name: "Mistral Mixtral 8x22B Instruct",
    reasoning: false,
    input: ["text"],
    contextWindow: 65536,
    maxTokens: 8192,
    cost: {
      input: 0.65,
      output: 0.65,
      cacheRead: 0.65,
      cacheWrite: 0.65,
    },
  },
  {
    id: "microsoft/WizardLM-2-8x22B",
    name: "Microsoft WizardLM 2 8x22B",
    reasoning: false,
    input: ["text"],
    contextWindow: 65536,
    maxTokens: 8192,
    cost: {
      input: 0.63,
      output: 0.63,
      cacheRead: 0.63,
      cacheWrite: 0.63,
    },
  },
];

export function buildDeepInfraModelDefinition(
  model: (typeof DEEPINFRA_MODEL_CATALOG)[number],
): ModelDefinitionConfig {
  return {
    id: model.id,
    name: model.name,
    api: "openai-completions",
    reasoning: model.reasoning,
    input: model.input,
    cost: model.cost,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    },
  };
}
