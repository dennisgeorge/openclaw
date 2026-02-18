# DeepInfra/Kimi-K2.5 API Implementation Investigation

**Date:** 2026-02-18
**Reporter:** Dennis George (User)
**Investigating Agent:** Genesis Stone (OpenClaw)
**Model Affected:** `moonshotai/Kimi-K2.5` via DeepInfra provider
**OpenClaw Version:** 2026.2.15 (46e7868)

---

## Symptom Summary

User reports: "I send a prompt, TUI shows 'connected | idle' or 'streaming', but no response returns. Issue persists across gateway reboots and host reboots."

**Triggers:**

- Longer multi-tool operations (>30-60 seconds)
- Sequential tool calls in a single turn
- Large response payloads

**Workaround:**

- Sending follow-up message ("are you still there?") unsticks the response pipeline and delivers queued response

---

## Investigation Timeline (All Times America/Chicago CST)

### Last Host Reboot

- **Feb 16, 10:55:39 PM CST**

### Post-Reboot Activity

- 22:53 - 23:02: Multiple rapid gateway restarts (troubleshooting)
- 23:02: Gateway stabilized (pid 3308, still running)

### Log Findings

#### 1. DeepInfra API Errors (Feb 17)

```
Feb 17 07:46:14 [openclaw] Non-fatal unhandled rejection: TypeError: fetch failed
Feb 17 12:29:23 [openclaw] Non-fatal unhandled rejection: TypeError: fetch failed
Feb 17 12:29:34 [openclaw] Non-fatal unhandled rejection: TypeError: fetch failed
Feb 17 12:29:42 [openclaw] Non-fatal unhandled rejection: TypeError: fetch failed
```

**Context:** These were during ClawVault cron jobs, not user interactions. All 61+ sessions on Feb 17 were cron-generated.

#### 2. TUI Session States

- Multiple zombie TUI processes running simultaneously:
  - pts/0 (Feb 16, 23:01) - zombie
  - pts/1 (Feb 16, 23:01) - zombie
  - pts/2 (Feb 18, 09:51) - active

#### 3. Gateway Status

```
Gateway: ws://127.0.0.1:18789 (local loopback) · unreachable (timeout)
```

WebSocket connection diagnostic shows timeout despite service running.

---

## Hypothesis: DeepInfra API Implementation Issues

### Possibility A: Kimi-K2.5 Streaming/Non-Streaming Mismatch

**Current Configuration:**

```json
{
  "id": "moonshotai/Kimi-K2.5",
  "name": "Kimi K2.5",
  "api": "deepinfra-inference",
  "reasoning": true,
  "input": ["text", "image"],
  "contextWindow": 262144,
  "maxTokens": 262144
}
```

**Key Clue:** Uses `"api": "deepinfra-inference"` (not standard OpenAI completions)

**Potential Issues:**

1. **Response format mismatch** - Kimi-K2.5 may return data differently than standard DeepInfra models
2. **Streaming flag handling** - TUI may expect streaming deltas but receive complete responses
3. **Timeout defaults** - Large context window (262k) may trigger different timeout behavior

### Possibility B: Tool Result Delivery Bug

**Observed Behavior:**

- Tool calls execute ("running" state shown)
- Tool results return successfully (visible in logs)
- Final assistant response hangs in queue
- User message triggers flush/delivery

**This suggests:** Response delivery mechanism stalled, not API call itself.

### Possibility C: DeepInfra Rate Limiting / Model Availability

**Evidence For:**

- `fetch failed` errors at specific times (7:46 AM, 12:29 PM on Feb 17)
- Pattern suggests intermittent API failures, not continuous

**Evidence Against:**

- Simple queries respond immediately
- No rate limit error messages in logs
- Changing models within DeepInfra didn't resolve issue

---

## Recommendations for Implementation Fix

### 1. Check DeepInfra Inference API Response Parsing

**Code Location:** `/home/dennisg/.npm-global/lib/node_modules/openclaw/dist/` (likely in provider-specific module)

**What to Check:**

```javascript
// Verify Kimi-K2.5 response structure matches expected format
// DeepInfra-inference API may return:
// - Different SSE event formatting
// - Non-standard JSON structures
// - Missing 'done' event markers
// - Different error payload structure
```

**Diagnostic:** Add verbose logging to capture raw response chunks from Kimi-K2.5 vs other DeepInfra models.

### 2. Implement Response Timeout & Retry

**Current Behavior:** Connection hangs indefinitely on failed/incomplete responses

**Recommended:**

```javascript
// Add 30s timeout with 2 retries for tool-augmented responses
const responseTimeout = 30000; // ms
const maxRetries = 2;
```

### 3. Flush Mechanism Investigation

**Core Question:** Why does user message "unstick" the queue?

**Potential Causes:**

- WebSocket buffer flush on new inbound message
- Event loop starvation in gateway
- Promise resolution chain breakage

**Diagnostic Steps:**

1. Add gateway-level logging for message queue depth
2. Trace WebSocket message ACK/NACK flow
3. Check if `fetch failed` swallowed without rejecting promise

### 4. Tool Concurrency Limiter

**Current:** Multiple tools can run in parallel (observed 2-3 simultaneous exec calls)

**Recommendation:** Serialize tool execution for Kimi-K2.5:

```javascript
// Sequential vs parallel execution
const results = [];
for (const tool of tools) {
  results.push(await executeTool(tool)); // Sequential
}
// vs
const results = await Promise.all(tools.map(executeTool)); // Parallel (current?)
```

### 5. DeepInfra Provider Fallback

**Current Config:** Single primary model (Kimi-K2.5), falls back to DeepSeek V3.2 (same provider)

**Suggestion:** Test with non-DeepInfra fallback:

```json
{
  "fallback": {
    "provider": "openai",
    "model": "gpt-4o-mini"
  }
}
```

If issue persists across providers → OpenClaw core bug.
If issue disappears → DeepInfra-specific implementation issue.

---

## Diagnostic Commands for Claude

### Check 1: Verify Kimi-K2.5 API Response Format

```bash
# Direct API call bypassing OpenClaw
curl -X POST https://api.deepinfra.com/v1/openai/chat/completions \
  -H "Authorization: Bearer $DEEPINFRA_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "moonshotai/Kimi-K2.5",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

Compare output with:

```bash
# Standard DeepInfra model (works)
curl -X POST https://api.deepinfra.com/v1/openai/chat/completions \
  -H "Authorization: Bearer $DEEPINFRA_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "meta-llama/Llama-3.3-70B-Instruct",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": true
  }'
```

### Check 2: Gateway Queue State During Hang

```bash
# When TUI shows "streaming" but no response:
openclaw status --all
# Check for: queued messages, active runs, provider health
```

### Check 3: Network-level API Health

```bash
# During hang, test if DeepInfra responds:
curl -s -o /dev/null -w "%{http_code} %{time_total}s" \
  https://api.deepinfra.com/v1/openai/models
```

---

## Key Questions for Claude

1. **How does the DeepInfra-inference API differ from OpenAI-compatible endpoints?**
   - Kimi-K2.5 uses custom endpoint vs standard OpenAI format

2. **Are tool results properly awaited before generating response?**
   - Race condition in tool result → response generation pipeline?

3. **Is the WebSocket connection to TUI duplexed correctly?**
   - Can gateway push responses, or does it require client poll?

4. **What's the EventSource/SSE timeout for streaming responses?**
   - Large context models may take longer to start streaming

5. **Are `fetch failed` errors properly propagated to fail the run?**
   - Current: "Non-fatal unhandled rejection" → swallowed error?

---

## User Workarounds Until Fixed

1. **Keep queries tool-light** - Split multi-tool operations into separate turns
2. **30-second rule** - If no response in 30s, send "?" or "continue" to flush
3. **Restart TUI daily** - Clear zombie sessions: `pkill openclaw-tui; openclaw chat`
4. **Use backup channel** - Telegram when TUI stuck (if configured)

---

## Files to Inspect

1. `~/.npm-global/lib/node_modules/openclaw/dist/subsystem-BbhgPUzd.js:898` - Diagnostic logging
2. `/tmp/openclaw/openclaw-2026-02-16.log` - Full gateway logs (4MB)
3. `~/.openclaw/openclaw.json` - Provider config
4. `~/.openclaw/agents/main/sessions/76b7bee0-05cd-45f2-bf68-576d4699dd85.jsonl` - Session transcript

---

## Conclusion

**Most Likely:** OpenClaw response delivery bug triggered by long tool operations, **not** DeepInfra API failure. However, Kimi-K2.5's custom API implementation may be exposing edge case in core.

**Recommended Fix Priority:**

1. Add timeout + retry to DeepInfra provider calls
2. Fix response queue flush mechanism
3. Add provider-specific handling for `deepinfra-inference` API
4. Test with non-DeepInfra fallback to isolate provider vs core issue

---

_Generated by Genesis Stone for Claude Code analysis._
