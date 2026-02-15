# DeepInfra Integration - Testing Guide

## Quick Test Checklist

### 1. Interactive Onboarding Test
```bash
cd openclaw
npm run build  # or your build command

# Test interactive onboarding
openclaw onboard --auth-choice deepinfra-api-key
```

Expected behavior:
- Should show "DeepInfra" information message with API key URL
- Should prompt for API key input
- Should set up provider configuration
- Should set default model to `deepinfra/deepseek-ai/DeepSeek-V3`

### 2. Non-Interactive Test
```bash
# Set your API key
export DEEPINFRA_API_KEY="your-test-key-here"

# Test non-interactive mode
openclaw onboard --non-interactive \
  --mode local \
  --auth-choice deepinfra-api-key \
  --token "$DEEPINFRA_API_KEY" \
  --token-provider deepinfra
```

Expected behavior:
- Should complete without prompts
- Should configure DeepInfra provider
- Should store API key in auth profile

### 3. Environment Variable Detection Test
```bash
# Set environment variable
export DEEPINFRA_API_KEY="test-key-123"

# Run onboarding (should detect existing key)
openclaw onboard --auth-choice deepinfra-api-key
```

Expected behavior:
- Should detect `DEEPINFRA_API_KEY` from environment
- Should prompt to use existing key
- Should show key preview (e.g., "test...123")

### 4. Configuration Test

Check your OpenClaw config file (usually `~/.clawdbot/config.json` or similar):

```bash
# View configuration
openclaw config get
```

Should show:
```json5
{
  "models": {
    "providers": {
      "deepinfra": {
        "baseUrl": "https://api.deepinfra.com/v1/openai",
        "api": "openai-completions",
        "models": [ /* ... model list ... */ ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "deepinfra/deepseek-ai/DeepSeek-V3"
      }
    }
  }
}
```

### 5. API Call Test

Once configured, test an actual API call:

```bash
# Test a simple query
openclaw chat "What is 2+2?"
```

Expected behavior:
- Should use DeepInfra API
- Should get response from DeepSeek V3 model
- Check logs for API endpoint (should be api.deepinfra.com)

### 6. Model Selection Test

Test switching between DeepInfra models:

```bash
# Change model in config or via command
openclaw config set agents.defaults.model.primary "deepinfra/meta-llama/Llama-3.3-70B-Instruct"

# Test with new model
openclaw chat "Hello from Llama!"
```

### 7. Verify Available Models

Check that all 10 models are available:

```bash
# List available models (if OpenClaw has this command)
openclaw models list | grep deepinfra
```

Should show:
- deepseek-ai/DeepSeek-V3
- deepseek-ai/DeepSeek-R1
- meta-llama/Meta-Llama-3.1-70B-Instruct
- meta-llama/Llama-3.3-70B-Instruct
- Qwen/Qwen2.5-72B-Instruct
- Qwen/QwQ-32B-Preview
- nvidia/Llama-3.1-Nemotron-70B-Instruct
- google/gemma-2-27b-it
- mistralai/Mixtral-8x22B-Instruct-v0.1
- microsoft/WizardLM-2-8x22B

## Build & Compilation Test

```bash
cd openclaw
npm run build
# or
npm run typecheck
# or whatever build command is used
```

Expected: No errors, clean build

## Documentation Test

Verify documentation is accessible:

```bash
# Check if docs are generated/accessible
ls openclaw/docs/providers/deepinfra.md
cat openclaw/docs/providers/deepinfra.md
```

## Integration Test Scenarios

### Scenario 1: Fresh Installation
1. New user onboards with DeepInfra
2. Sets up API key
3. Makes first API call
4. Success ✓

### Scenario 2: Existing User Adding Provider
1. User already has Anthropic configured
2. Adds DeepInfra as additional provider
3. Switches between providers
4. Both work correctly ✓

### Scenario 3: Environment Variable Usage
1. User sets DEEPINFRA_API_KEY in .env
2. Starts OpenClaw gateway
3. DeepInfra works without explicit onboarding
4. Success ✓

## Common Issues & Troubleshooting

### Issue: "Provider not found"
Solution: Make sure you rebuilt after adding the new provider:
```bash
npm run build
```

### Issue: "API key invalid"
Solution: Verify your API key at https://deepinfra.com/dash/api_keys

### Issue: "Model not available"
Solution: Check model catalog is properly imported and models are defined

### Issue: Import errors
Solution: Verify all exports in `onboard-auth.ts` include DeepInfra functions

## Success Criteria

✅ Interactive onboarding works
✅ Non-interactive onboarding works  
✅ Environment variable detection works
✅ API calls succeed with DeepInfra
✅ All 10 models are accessible
✅ Configuration is properly saved
✅ Documentation is complete
✅ No TypeScript/linter errors
✅ No build errors

## Getting a Test API Key

1. Visit https://deepinfra.com
2. Sign up for a free account
3. Go to Dashboard → API Keys: https://deepinfra.com/dash/api_keys
4. Create a new API key
5. DeepInfra offers free credits for testing

## Performance Testing

Test latency improvement over OpenAI compatibility layer:

```bash
# Time a request with DeepInfra native API
time openclaw chat "Write a hello world in Python"

# Compare with another provider (if applicable)
```

Expected: Should be 20-50ms faster than compatibility wrappers

## Next Steps After Testing

1. Update main CHANGELOG.md with new provider addition
2. Announce to users in release notes
3. Consider adding DeepInfra-specific examples/skills
4. Monitor for any user-reported issues
5. Update model catalog as DeepInfra adds new models
