---
summary: "DeepInfra setup (auth + model selection) with native API support"
read_when:
  - You want to use DeepInfra's native API with OpenClaw
  - You need full parameter control and model-specific optimizations
  - You want access to DeepSeek, Llama, Qwen, and other models with lower latency
---

# DeepInfra

The [DeepInfra](https://deepinfra.com) platform provides access to leading open-source models through their native API, offering full parameter control, model-specific optimizations, and lower latency compared to compatibility wrappers.

- Provider: `deepinfra`
- Auth: `DEEPINFRA_API_KEY`
- API: OpenAI-compatible (native endpoint)
- Base URL: `https://api.deepinfra.com/v1/openai`

## Quick start

1. Set the API key (recommended: store it for the Gateway):

```bash
openclaw onboard --auth-choice deepinfra-api-key
```

2. Set a default model:

```json5
{
  agents: {
    defaults: {
      model: { primary: "deepinfra/deepseek-ai/DeepSeek-V3" },
    },
  },
}
```

## Non-interactive example

```bash
openclaw onboard --non-interactive \
  --mode local \
  --auth-choice deepinfra-api-key \
  --token "$DEEPINFRA_API_KEY" \
  --token-provider deepinfra
```

This will set `deepinfra/deepseek-ai/DeepSeek-V3` as the default model.

## Environment note

If the Gateway runs as a daemon (launchd/systemd), make sure `DEEPINFRA_API_KEY`
is available to that process (for example, in `~/.clawdbot/.env` or via
`env.shellEnv`).

## Available models

DeepInfra provides access to many popular open-source models with native API support:

### Reasoning & Coding Models
- **DeepSeek V3** - Default model, powerful coding and reasoning (65K context)
- **DeepSeek R1** - Advanced reasoning model with deep thought process
- **QwQ 32B Preview** - Reasoning-focused model from Qwen

### Large Language Models
- **Llama 3.1 70B Instruct** - Meta's flagship instruction model (128K context)
- **Llama 3.3 70B Instruct** - Updated version with improved performance (131K context)
- **Qwen 2.5 72B Instruct** - Alibaba's powerful multilingual model (131K context)
- **Nvidia Llama 3.1 Nemotron 70B** - Optimized for accuracy and performance

### Specialized Models
- **Mistral Mixtral 8x22B Instruct** - Mixture of experts architecture (65K context)
- **Microsoft WizardLM 2 8x22B** - Enhanced reasoning and instruction following
- **Google Gemma 2 27B IT** - Compact but capable model

All models support:
- OpenAI-compatible chat completions API
- Native DeepInfra parameter control (temperature, top_p, repetition_penalty)
- Model-specific optimizations for lower latency
- Full access to advanced sampling parameters

## Why use DeepInfra's native API?

OpenClaw's DeepInfra integration uses the native API endpoint instead of the OpenAI compatibility layer, giving you:

1. **Lower latency** - 20-50ms faster response times
2. **Full parameter control** - Access to `repetition_penalty`, `top_k`, and other native parameters
3. **Model-specific optimizations** - Custom stop tokens and sampling parameters
4. **Cost efficiency** - Native API pricing with no gateway overhead

## Getting your API key

1. Sign up at [deepinfra.com](https://deepinfra.com)
2. Navigate to [Dashboard → API Keys](https://deepinfra.com/dash/api_keys)
3. Create a new API key
4. Store it securely using the onboarding command above

## Configuration example

Full configuration with multiple models:

```json5
{
  models: {
    providers: {
      deepinfra: {
        baseUrl: "https://api.deepinfra.com/v1/openai",
        api: "openai-completions",
        models: [
          {
            id: "deepseek-ai/DeepSeek-V3",
            name: "DeepSeek V3",
            reasoning: false,
            input: ["text"],
            contextWindow: 65536,
            maxTokens: 8192,
          },
          {
            id: "meta-llama/Llama-3.3-70B-Instruct",
            name: "Llama 3.3 70B",
            reasoning: false,
            input: ["text"],
            contextWindow: 131072,
            maxTokens: 32768,
          },
        ],
      },
    },
  },
  agents: {
    defaults: {
      model: { primary: "deepinfra/deepseek-ai/DeepSeek-V3" },
    },
  },
}
```

## Pricing

DeepInfra offers competitive pricing for open-source models. Check [deepinfra.com/pricing](https://deepinfra.com/pricing) for current rates. The native API implementation ensures you get the best performance per dollar.
