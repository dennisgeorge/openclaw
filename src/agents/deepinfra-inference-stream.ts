import type { StreamFn } from "@mariozechner/pi-agent-core";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  StopReason,
  TextContent,
  ThinkingContent,
  ToolCall,
  Tool,
  Usage,
} from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import { randomUUID } from "node:crypto";

export const DEEPINFRA_INFERENCE_BASE_URL = "https://api.deepinfra.com/v1/inference";
const DEEPINFRA_OPENAI_CHAT_URL = "https://api.deepinfra.com/v1/openai/chat/completions";

// ── Kimi-K2.5 chat template tokens ─────────────────────────────────────────

const IM_SYSTEM_OPEN = "<|im_system|>ChatMessageRole.SYSTEM<|im_middle|>";
const IM_USER_OPEN = "<|im_user|>ChatMessageRole.USER<|im_middle|>";
const IM_ASSISTANT_OPEN = "<|im_assistant|>assistant<|im_middle|>";
const IM_END = "<|im_end|>";
const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

const KIMI_STOP_TOKENS = [IM_END, "[EOS]"];

// ── DeepInfra native inference request types ────────────────────────────────

interface DeepInfraInferenceRequest {
  input: string;
  stream: boolean;
  stop?: string[];
  max_new_tokens?: number;
  temperature?: number;
  top_p?: number;
}

// ── DeepInfra native inference streaming response types ─────────────────────

interface DeepInfraStreamChunk {
  token?: {
    text?: string;
    special?: boolean;
  };
  generated_text?: string;
  details?: {
    finish_reason?: "stop" | "length" | "tool_calls" | "content_filter";
  };
  num_output_tokens?: number;
  num_input_tokens?: number;
  estimated_cost?: number;
}

// ── OpenAI-compatible chat types (for tool calling) ─────────────────────────

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAIToolCallChunk[];
  tool_call_id?: string;
  name?: string;
}

interface OpenAIToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenAIToolCallChunk {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIChatRequest {
  model: string;
  messages: OpenAIChatMessage[];
  stream: boolean;
  stream_options?: { include_usage: boolean };
  tools?: OpenAIToolDef[];
  tool_choice?: "auto" | "none";
  temperature?: number;
  max_tokens?: number;
}

interface OpenAIChatStreamDelta {
  id?: string;
  object?: string;
  choices?: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: "function";
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

// ── Message conversion (shared) ─────────────────────────────────────────────

type InputContentPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return (content as InputContentPart[])
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function extractToolCallParts(
  content: unknown,
): Array<{ id: string; name: string; arguments: Record<string, unknown> }> {
  if (!Array.isArray(content)) {
    return [];
  }
  const parts = content as InputContentPart[];
  const result: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
  for (const part of parts) {
    if (part.type === "toolCall") {
      result.push({ id: part.id, name: part.name, arguments: part.arguments });
    } else if (part.type === "tool_use") {
      result.push({ id: part.id, name: part.name, arguments: part.input });
    }
  }
  return result;
}

// ── Native inference prompt builder ─────────────────────────────────────────

/**
 * Convert pi-ai messages into the Kimi-K2.5 chat template format.
 *
 * Template reference (from DeepInfra Kimi-K2.5 native API docs):
 *   System:    <|im_system|>ChatMessageRole.SYSTEM<|im_middle|>{text}<|im_end|>
 *   User:      <|im_user|>ChatMessageRole.USER<|im_middle|>{text}<|im_end|>
 *   Assistant: <|im_assistant|>assistant<|im_middle|><think>{thinking}</think>{text}<|im_end|>
 *   Final:     <|im_assistant|>assistant<|im_middle|><think>
 */
export function buildKimiPrompt(
  messages: Array<{ role: string; content: unknown }>,
  system?: string,
): string {
  let prompt = "";

  if (system) {
    prompt += `${IM_SYSTEM_OPEN}${system}${IM_END}`;
  }

  for (const msg of messages) {
    const text = extractTextContent(msg.content);
    const { role } = msg;

    if (role === "user") {
      prompt += `${IM_USER_OPEN}${text}${IM_END}`;
    } else if (role === "assistant") {
      if (text.includes(THINK_OPEN)) {
        prompt += `${IM_ASSISTANT_OPEN}${text}${IM_END}`;
      } else {
        prompt += `${IM_ASSISTANT_OPEN}${THINK_CLOSE}${text}${IM_END}`;
      }
    }
  }

  prompt += `${IM_ASSISTANT_OPEN}${THINK_OPEN}`;

  return prompt;
}

// ── OpenAI-compatible message builder ───────────────────────────────────────

function convertToOpenAIChatMessages(
  messages: Array<{ role: string; content: unknown; toolName?: unknown; toolCallId?: unknown }>,
  system?: string,
): OpenAIChatMessage[] {
  const result: OpenAIChatMessage[] = [];

  if (system) {
    result.push({ role: "system", content: system });
  }

  for (const msg of messages) {
    const { role } = msg;

    if (role === "user") {
      result.push({ role: "user", content: extractTextContent(msg.content) });
    } else if (role === "assistant") {
      const text = extractTextContent(msg.content);
      const toolCallParts = extractToolCallParts(msg.content);

      if (toolCallParts.length > 0) {
        const toolCalls: OpenAIToolCallChunk[] = toolCallParts.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));
        result.push({
          role: "assistant",
          content: text || null,
          tool_calls: toolCalls,
        });
      } else {
        result.push({ role: "assistant", content: text });
      }
    } else if (role === "tool" || role === "toolResult") {
      const text = extractTextContent(msg.content);
      const toolCallId =
        typeof (msg as { toolCallId?: unknown }).toolCallId === "string"
          ? (msg as { toolCallId?: string }).toolCallId!
          : `call_${randomUUID()}`;
      result.push({
        role: "tool",
        content: text,
        tool_call_id: toolCallId,
      });
    }
  }

  return result;
}

function extractOpenAIToolDefs(tools: Tool[] | undefined): OpenAIToolDef[] {
  if (!tools || !Array.isArray(tools)) {
    return [];
  }
  const result: OpenAIToolDef[] = [];
  for (const tool of tools) {
    if (typeof tool.name !== "string" || !tool.name) {
      continue;
    }
    result.push({
      type: "function",
      function: {
        name: tool.name,
        description: typeof tool.description === "string" ? tool.description : "",
        parameters: (tool.parameters ?? {}) as Record<string, unknown>,
      },
    });
  }
  return result;
}

// ── SSE streaming parser ────────────────────────────────────────────────────

function* extractSseDataLines(rawBuffer: string): Generator<string> {
  for (const line of rawBuffer.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    const jsonStr = trimmed.slice(5).trim();
    if (jsonStr && jsonStr !== "[DONE]") {
      yield jsonStr;
    }
  }
}

export async function* parseSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<DeepInfraStreamChunk> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const event of events) {
      for (const jsonStr of extractSseDataLines(event)) {
        try {
          yield JSON.parse(jsonStr) as DeepInfraStreamChunk;
        } catch {
          console.warn("[deepinfra-inference] Skipping malformed SSE data:", jsonStr.slice(0, 120));
        }
      }
    }
  }

  if (buffer.trim()) {
    for (const jsonStr of extractSseDataLines(buffer)) {
      try {
        yield JSON.parse(jsonStr) as DeepInfraStreamChunk;
      } catch {
        console.warn(
          "[deepinfra-inference] Skipping malformed trailing SSE data:",
          jsonStr.slice(0, 120),
        );
      }
    }
  }
}

// ── OpenAI SSE streaming parser ─────────────────────────────────────────────
// SSE events are delimited by double newlines; split on \n\n first,
// then extract data: lines from each event (matching the native parser).

async function* parseOpenAISseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<OpenAIChatStreamDelta> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const event of events) {
      for (const jsonStr of extractSseDataLines(event)) {
        try {
          yield JSON.parse(jsonStr) as OpenAIChatStreamDelta;
        } catch {
          console.warn("[deepinfra-chat] Skipping malformed SSE data:", jsonStr.slice(0, 120));
        }
      }
    }
  }

  if (buffer.trim()) {
    for (const jsonStr of extractSseDataLines(buffer)) {
      try {
        yield JSON.parse(jsonStr) as OpenAIChatStreamDelta;
      } catch {
        console.warn(
          "[deepinfra-chat] Skipping malformed trailing SSE data:",
          jsonStr.slice(0, 120),
        );
      }
    }
  }
}

// ── Shared helpers for building the partial AssistantMessage ─────────────────

function makeEmptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function makePartialAssistantMessage(modelInfo: {
  api: string;
  provider: string;
  id: string;
}): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    stopReason: "stop",
    api: modelInfo.api,
    provider: modelInfo.provider,
    model: modelInfo.id,
    usage: makeEmptyUsage(),
    timestamp: Date.now(),
  };
}

function finalizeUsage(output: AssistantMessage, inputTokens: number, outputTokens: number): void {
  output.usage = {
    input: inputTokens,
    output: outputTokens,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: inputTokens + outputTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

// ── Main StreamFn factory ───────────────────────────────────────────────────

function resolveInferenceUrl(baseUrl: string, modelId: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.includes("/v1/inference/")) {
    return trimmed;
  }
  const base = trimmed || DEEPINFRA_INFERENCE_BASE_URL;
  return `${base}/${modelId}`;
}

export function createDeepInfraInferenceStreamFn(baseUrl: string): StreamFn {
  return (model, context, options) => {
    const stream = createAssistantMessageEventStream();

    const tools = extractOpenAIToolDefs(context.tools);
    const hasTools = tools.length > 0;

    const run = async () => {
      try {
        if (hasTools) {
          await runOpenAIChatPath(stream, model, context, options, tools);
        } else {
          await runNativeInferencePath(stream, model, context, options, baseUrl);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        stream.push({
          type: "error",
          reason: "error",
          error: {
            role: "assistant" as const,
            content: [],
            stopReason: "error" as StopReason,
            errorMessage,
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: makeEmptyUsage(),
            timestamp: Date.now(),
          },
        });
      } finally {
        stream.end();
      }
    };

    queueMicrotask(() => void run());
    return stream;
  };
}

// ── Native inference path (no tool support) ─────────────────────────────────
// Emits full streaming lifecycle: start → thinking_start/delta/end →
// text_start/delta/end → done so the agent-loop and TUI receive events
// incrementally instead of only a single "done" at the end.

async function runNativeInferencePath(
  stream: ReturnType<typeof createAssistantMessageEventStream>,
  model: Parameters<StreamFn>[0],
  context: Parameters<StreamFn>[1],
  options: Parameters<StreamFn>[2],
  baseUrl: string,
): Promise<void> {
  const prompt = buildKimiPrompt(context.messages ?? [], context.systemPrompt);

  const body: DeepInfraInferenceRequest = {
    input: prompt,
    stream: true,
    stop: KIMI_STOP_TOKENS,
  };
  if (typeof options?.temperature === "number") {
    body.temperature = options.temperature;
  }
  if (typeof options?.maxTokens === "number") {
    body.max_new_tokens = options.maxTokens;
  }

  const inferenceUrl = resolveInferenceUrl(baseUrl, model.id);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options?.headers,
  };
  if (options?.apiKey) {
    headers.Authorization = `Bearer ${options.apiKey}`;
  }

  const response = await fetch(inferenceUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown error");
    throw new Error(`DeepInfra inference API error ${response.status}: ${errorText}`);
  }

  if (!response.body) {
    throw new Error("DeepInfra inference API returned empty response body");
  }

  const modelInfo = { api: model.api, provider: model.provider, id: model.id };
  const output = makePartialAssistantMessage(modelInfo);

  stream.push({ type: "start", partial: output });

  const reader = response.body.getReader();
  let inputTokens = 0;
  let outputTokens = 0;

  // Kimi-K2.5 native inference returns raw token stream that starts inside
  // a <think> block (the prompt ends with "<think>"). We track whether
  // we're still in the thinking section and split into thinking + text
  // content blocks accordingly.
  let inThinking = true;
  let thinkingBlock: ThinkingContent | null = null;
  let textBlock: TextContent | null = null;

  for await (const chunk of parseSseStream(reader)) {
    if (chunk.token?.text && !chunk.token.special) {
      let tokenText = chunk.token.text;

      if (inThinking) {
        const closeIdx = tokenText.indexOf(THINK_CLOSE);
        if (closeIdx !== -1) {
          // Transition: end of thinking, start of text
          const thinkPart = tokenText.slice(0, closeIdx);
          const textPart = tokenText.slice(closeIdx + THINK_CLOSE.length);

          if (thinkPart) {
            if (!thinkingBlock) {
              thinkingBlock = { type: "thinking", thinking: "" };
              output.content.push(thinkingBlock);
              stream.push({
                type: "thinking_start",
                contentIndex: output.content.length - 1,
                partial: output,
              });
            }
            thinkingBlock.thinking += thinkPart;
            stream.push({
              type: "thinking_delta",
              contentIndex: output.content.length - 1,
              delta: thinkPart,
              partial: output,
            });
          }

          if (thinkingBlock) {
            stream.push({
              type: "thinking_end",
              contentIndex: output.content.indexOf(thinkingBlock),
              content: thinkingBlock.thinking,
              partial: output,
            });
          }

          inThinking = false;
          tokenText = textPart;
          // fall through to handle remaining text below
        } else {
          // Still in thinking
          if (!thinkingBlock) {
            thinkingBlock = { type: "thinking", thinking: "" };
            output.content.push(thinkingBlock);
            stream.push({
              type: "thinking_start",
              contentIndex: output.content.length - 1,
              partial: output,
            });
          }
          thinkingBlock.thinking += tokenText;
          stream.push({
            type: "thinking_delta",
            contentIndex: output.content.length - 1,
            delta: tokenText,
            partial: output,
          });
          continue;
        }
      }

      // Text content (post-thinking or no thinking)
      if (tokenText) {
        if (!textBlock) {
          textBlock = { type: "text", text: "" };
          output.content.push(textBlock);
          stream.push({
            type: "text_start",
            contentIndex: output.content.length - 1,
            partial: output,
          });
        }
        textBlock.text += tokenText;
        stream.push({
          type: "text_delta",
          contentIndex: output.content.length - 1,
          delta: tokenText,
          partial: output,
        });
      }
    }

    if (chunk.details?.finish_reason) {
      output.stopReason = "stop";
    }
    if (typeof chunk.num_input_tokens === "number") {
      inputTokens = chunk.num_input_tokens;
    }
    if (typeof chunk.num_output_tokens === "number") {
      outputTokens = chunk.num_output_tokens;
    }
  }

  // Close any open blocks
  if (inThinking && thinkingBlock) {
    stream.push({
      type: "thinking_end",
      contentIndex: output.content.indexOf(thinkingBlock),
      content: thinkingBlock.thinking,
      partial: output,
    });
  }
  if (textBlock) {
    stream.push({
      type: "text_end",
      contentIndex: output.content.indexOf(textBlock),
      content: textBlock.text,
      partial: output,
    });
  }

  finalizeUsage(output, inputTokens, outputTokens);

  stream.push({
    type: "done",
    reason: "stop",
    message: output,
  });
}

// ── OpenAI-compatible chat path (tool calling supported) ────────────────────
// Emits full streaming lifecycle: start → text/toolcall start/delta/end →
// done so the agent-loop and TUI receive events incrementally.

async function runOpenAIChatPath(
  stream: ReturnType<typeof createAssistantMessageEventStream>,
  model: Parameters<StreamFn>[0],
  context: Parameters<StreamFn>[1],
  options: Parameters<StreamFn>[2],
  tools: OpenAIToolDef[],
): Promise<void> {
  const chatMessages = convertToOpenAIChatMessages(context.messages ?? [], context.systemPrompt);

  const body: OpenAIChatRequest = {
    model: model.id,
    messages: chatMessages,
    stream: true,
    stream_options: { include_usage: true },
    tools,
    tool_choice: "auto",
  };
  if (typeof options?.temperature === "number") {
    body.temperature = options.temperature;
  }
  if (typeof options?.maxTokens === "number") {
    body.max_tokens = options.maxTokens;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options?.headers,
  };
  if (options?.apiKey) {
    headers.Authorization = `Bearer ${options.apiKey}`;
  }

  const response = await fetch(DEEPINFRA_OPENAI_CHAT_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown error");
    throw new Error(`DeepInfra chat API error ${response.status}: ${errorText}`);
  }

  if (!response.body) {
    throw new Error("DeepInfra chat API returned empty response body");
  }

  const modelInfo = { api: model.api, provider: model.provider, id: model.id };
  const output = makePartialAssistantMessage(modelInfo);

  stream.push({ type: "start", partial: output });

  const reader = response.body.getReader();
  let inputTokens = 0;
  let outputTokens = 0;

  // Track the current open block so we can emit start/delta/end properly.
  let currentBlock: (TextContent | (ToolCall & { partialArgs: string })) | null = null;
  const blockIndex = () => output.content.length - 1;

  const finishCurrentBlock = () => {
    if (!currentBlock) {
      return;
    }
    if (currentBlock.type === "text") {
      stream.push({
        type: "text_end",
        contentIndex: blockIndex(),
        content: currentBlock.text,
        partial: output,
      });
    } else if (currentBlock.type === "toolCall") {
      const tc = currentBlock as ToolCall & { partialArgs: string };
      try {
        tc.arguments = JSON.parse(tc.partialArgs) as Record<string, unknown>;
      } catch {
        tc.arguments = {};
      }
      delete (tc as unknown as Record<string, unknown>).partialArgs;
      stream.push({
        type: "toolcall_end",
        contentIndex: blockIndex(),
        toolCall: tc,
        partial: output,
      });
    }
    currentBlock = null;
  };

  // Map from SSE tool_call index → output content index
  const toolCallIndexMap = new Map<number, number>();

  for await (const chunk of parseOpenAISseStream(reader)) {
    if (!chunk.choices || chunk.choices.length === 0) {
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
        outputTokens = chunk.usage.completion_tokens ?? outputTokens;
      }
      continue;
    }

    const choice = chunk.choices[0];
    const delta = choice.delta;

    // Text content deltas
    if (delta.content) {
      if (!currentBlock || currentBlock.type !== "text") {
        finishCurrentBlock();
        const block: TextContent = { type: "text", text: "" };
        currentBlock = block;
        output.content.push(block);
        stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
      }
      currentBlock.text += delta.content;
      stream.push({
        type: "text_delta",
        contentIndex: blockIndex(),
        delta: delta.content,
        partial: output,
      });
    }

    // Tool call deltas
    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const sseIdx = tc.index;
        let contentIdx = toolCallIndexMap.get(sseIdx);

        if (contentIdx === undefined) {
          // New tool call — finish any open block first
          finishCurrentBlock();

          const toolBlock: ToolCall & { partialArgs: string } = {
            type: "toolCall",
            id: tc.id ?? `deepinfra_call_${randomUUID()}`,
            name: tc.function?.name ?? "",
            arguments: {},
            partialArgs: tc.function?.arguments ?? "",
          };
          output.content.push(toolBlock);
          contentIdx = output.content.length - 1;
          toolCallIndexMap.set(sseIdx, contentIdx);
          currentBlock = toolBlock;

          stream.push({ type: "toolcall_start", contentIndex: contentIdx, partial: output });
        } else {
          // Continuation of an existing tool call
          const existing = output.content[contentIdx] as ToolCall & { partialArgs: string };
          if (tc.function?.name) {
            existing.name += tc.function.name;
          }
          if (tc.function?.arguments) {
            existing.partialArgs += tc.function.arguments;
          }
          // Keep currentBlock pointing at this tool call for proper finishCurrentBlock
          currentBlock = existing;
        }

        const argDelta = tc.function?.arguments ?? "";
        stream.push({
          type: "toolcall_delta",
          contentIndex: contentIdx,
          delta: argDelta,
          partial: output,
        } as AssistantMessageEvent);
      }
    }

    if (choice.finish_reason) {
      output.stopReason =
        choice.finish_reason === "tool_calls" ? "toolUse" : ("stop" as StopReason);
    }

    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
      outputTokens = chunk.usage.completion_tokens ?? outputTokens;
    }
  }

  // Close any remaining open block
  finishCurrentBlock();

  // Finalize all tool call arguments for any tool blocks that weren't the
  // "currentBlock" when the stream ended (parallel tool calls).
  for (const [, contentIdx] of toolCallIndexMap) {
    const block = output.content[contentIdx];
    if (block && block.type === "toolCall" && "partialArgs" in block) {
      const tc = block as ToolCall & { partialArgs: string };
      try {
        tc.arguments = JSON.parse(tc.partialArgs) as Record<string, unknown>;
      } catch {
        tc.arguments = {};
      }
      delete (tc as unknown as Record<string, unknown>).partialArgs;
    }
  }

  // Determine stop reason from content if not already set by finish_reason
  const hasToolCalls = output.content.some((b) => b.type === "toolCall");
  if (hasToolCalls) {
    output.stopReason = "toolUse";
  }

  finalizeUsage(output, inputTokens, outputTokens);

  const reason: Extract<StopReason, "stop" | "toolUse"> =
    output.stopReason === "toolUse" ? "toolUse" : "stop";

  stream.push({
    type: "done",
    reason,
    message: output,
  });
}
