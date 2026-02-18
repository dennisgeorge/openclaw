# DeepInfra Kimi-K2.5 Tool Calling Fix

## Date: 2026-02-16 (Phase 1), 2026-02-18 (Phase 2)

## Problem

Kimi-K2.5 (`moonshotai/Kimi-K2.5`) tool calling was completely broken. The model could handle regular text conversations but failed silently on any tool call because the stream handler had zero tool support. After the initial fix (Phase 1), a second issue surfaced: the TUI would show "streaming" but no response text appeared until the entire response finished, because the handler emitted only a single `done` event at the end instead of incremental streaming events.

## Root Cause (Phase 1 - Tool Calling)

The routing in `src/agents/pi-embedded-runner/run/attempt.ts` dispatches models based on their `api` field:

- `api: "ollama"` -> `createOllamaStreamFn()` (supports tools)
- `api: "deepinfra-inference"` -> `createDeepInfraInferenceStreamFn()` (**NO tool support**)
- Everything else -> `streamSimple()` from `@mariozechner/pi-ai` (supports tools via OpenAI format)

Kimi-K2.5 is configured with `api: "deepinfra-inference"` for lower latency via the native inference endpoint (`/v1/inference/{model}`). However, this endpoint is a **raw text completion API** that:

1. Takes a single `input` string with chat template tokens, not structured messages
2. Has no concept of tool definitions, tool_calls, or tool results
3. Returns raw generated text only

## Root Cause (Phase 2 - Streaming Stalls)

Both the native inference path and the OpenAI chat path accumulated text into local strings, then built a final `AssistantMessage` and emitted a single `done` event. The agent-loop and TUI expect the full streaming lifecycle (`start` -> `thinking_start/delta/end` -> `text_start/delta/end` -> `toolcall_start/delta/end` -> `done`) so they can render tokens incrementally. Without these intermediate events, the TUI appeared stuck until the entire response was buffered.

Additionally, the OpenAI SSE parser split on single `\n` instead of `\n\n`, which could mis-frame events when the server sent multi-line SSE payloads.

## What Was Missing (Phase 1)

| Feature                            | ollama-stream.ts                                              | deepinfra-inference (before fix) |
| ---------------------------------- | ------------------------------------------------------------- | -------------------------------- |
| Extract tools from `context.tools` | `extractOllamaTools()`                                        | Not implemented                  |
| Pass tools in request body         | `{ tools: ollamaTools }`                                      | Not implemented                  |
| Convert tool messages              | `convertToOllamaMessages()` handles `tool`/`toolResult` roles | Skipped entirely                 |
| Parse tool_calls from response     | Accumulates `tool_calls` from chunks                          | Not implemented                  |
| Set `stopReason: "toolUse"`        | Yes, when tool calls present                                  | Always returns `"stop"`          |
| `ToolCall` in content array        | Yes                                                           | Not imported or used             |

## What Was Missing (Phase 2)

| Feature                           | Expected behavior                                   | Before Phase 2 fix                           |
| --------------------------------- | --------------------------------------------------- | -------------------------------------------- |
| `start` event                     | Emitted at beginning of response                    | Not emitted                                  |
| `thinking_start/delta/end` events | Emitted for `<think>` blocks in native path         | Not implemented (raw text accumulated)       |
| `text_start/delta/end` events     | Emitted for text content tokens                     | Not implemented (single `done` at end)       |
| `toolcall_start/delta/end` events | Emitted for each tool call in OpenAI chat path      | Not implemented (accumulated then built)     |
| SSE event framing                 | Split on `\n\n` boundaries                          | OpenAI parser split on single `\n`           |
| `stream_options`                  | `include_usage: true` for token counts              | Not sent (usage could be missing)            |
| Shared SSE data-line extractor    | Single `extractSseDataLines()` generator            | Duplicated inline logic in two parsers       |
| Shared helpers                    | `makeEmptyUsage()`, `makePartialAssistantMessage()` | Separate `buildNative...`/`buildChat...` fns |

## Fix: Phase 1 - Hybrid Dual-Path Approach

Modified `src/agents/deepinfra-inference-stream.ts` to use a **dual-path strategy**:

### When tools ARE present (`context.tools` has entries):

- Uses the DeepInfra **OpenAI-compatible chat endpoint** (`/v1/openai/chat/completions`)
- Converts messages to OpenAI chat format with proper `tool`/`assistant` role handling
- Converts tool definitions to OpenAI function calling format
- Parses streaming `tool_calls` from response deltas (accumulated by index)
- Sets `stopReason: "toolUse"` when tool calls are detected
- Creates `ToolCall` content items with proper `id`, `name`, `arguments`

### When NO tools are present:

- Continues using the native inference endpoint (`/v1/inference/{model}`)
- Preserves the lower-latency path for simple text conversations

## Fix: Phase 2 - Full Incremental Streaming

Rewrote both paths to emit the full streaming event lifecycle so the TUI renders tokens as they arrive.

### Native inference path (`runNativeInferencePath`):

- Emits `start` event immediately after establishing the connection
- Tracks `<think>` block boundaries: emits `thinking_start` / `thinking_delta` / `thinking_end` as thinking tokens arrive, then transitions to `text_start` / `text_delta` / `text_end` after the closing `</think>` tag
- Builds a `ThinkingContent` block and a `TextContent` block on the `AssistantMessage.content` array incrementally
- Closes any open blocks at stream end and emits `done` with finalized usage

### OpenAI chat path (`runOpenAIChatPath`):

- Emits `start` event immediately after establishing the connection
- Tracks a `currentBlock` (either `TextContent` or `ToolCall`) and emits `text_start` / `text_delta` or `toolcall_start` / `toolcall_delta` per SSE delta
- When switching block types (text -> tool call, or between tool calls), emits `*_end` for the prior block and `*_start` for the new one
- Accumulates tool call arguments as raw strings (`partialArgs`), then parses JSON at `toolcall_end`
- Handles parallel tool calls via an index map from SSE tool_call index to content array position
- Sends `stream_options: { include_usage: true }` so the final usage chunk includes token counts

### SSE parser improvements:

- Extracted `extractSseDataLines()` generator shared by both `parseSseStream` (native) and `parseOpenAISseStream` (OpenAI)
- Fixed `parseOpenAISseStream` to split on `\n\n` (event boundaries) instead of single `\n`
- Both parsers now follow the same framing logic

### Shared helpers:

- `makeEmptyUsage()` - Creates a zero-valued `Usage` object (used for error fallback and initial state)
- `makePartialAssistantMessage()` - Creates a skeleton `AssistantMessage` with empty content array
- `finalizeUsage()` - Sets final token counts on the `AssistantMessage`
- Removed `buildNativeAssistantMessage()` and `buildChatAssistantMessage()` (no longer needed; messages are built incrementally)

## Files Changed

1. `src/agents/deepinfra-inference-stream.ts` - Complete rewrite of streaming lifecycle

## No Config Changes Needed

The model configuration in `openclaw.json` remains unchanged:

- `api: "deepinfra-inference"` still routes to our handler
- The handler dynamically chooses the right endpoint based on whether tools are present
- All other DeepInfra models using `api: "openai-completions"` are unaffected

## Testing

After rebuilding (`pnpm build`), restart OpenClaw. Both tool calls and incremental streaming with Kimi-K2.5 should now work:

- Thinking tokens appear in real-time in the TUI
- Text tokens stream incrementally after thinking completes
- Tool calls stream argument fragments and finalize on completion
- MCP tools, built-in tools, and custom skills all function correctly

## Why Not Just Change `api` to `openai-completions`?

That would work but would lose the performance benefit of native inference for regular conversations. The hybrid approach gives:

- **Fast native inference** for tool-free messages (lower latency, thinking block support)
- **Full OpenAI-compatible tool calling** when tools are needed
- **Incremental streaming** across both paths for responsive TUI rendering
- **No config changes** required for existing deployments
