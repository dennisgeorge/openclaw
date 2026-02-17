import type { StreamFn } from "@mariozechner/pi-agent-core";
import type {
  AssistantMessage,
  StopReason,
  TextContent,
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
      for (const line of event.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
          continue;
        }
        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr || jsonStr === "[DONE]") {
          continue;
        }
        try {
          yield JSON.parse(jsonStr) as DeepInfraStreamChunk;
        } catch {
          console.warn("[deepinfra-inference] Skipping malformed SSE data:", jsonStr.slice(0, 120));
        }
      }
    }
  }

  if (buffer.trim()) {
    for (const line of buffer.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }
      const jsonStr = trimmed.slice(5).trim();
      if (!jsonStr || jsonStr === "[DONE]") {
        continue;
      }
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

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }
      const jsonStr = trimmed.slice(5).trim();
      if (!jsonStr || jsonStr === "[DONE]") {
        continue;
      }
      try {
        yield JSON.parse(jsonStr) as OpenAIChatStreamDelta;
      } catch {
        console.warn("[deepinfra-chat] Skipping malformed SSE data:", jsonStr.slice(0, 120));
      }
    }
  }

  if (buffer.trim()) {
    for (const line of buffer.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }
      const jsonStr = trimmed.slice(5).trim();
      if (!jsonStr || jsonStr === "[DONE]") {
        continue;
      }
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

// ── Response conversion ─────────────────────────────────────────────────────

function buildNativeAssistantMessage(params: {
  text: string;
  inputTokens: number;
  outputTokens: number;
  finishReason?: string;
  modelInfo: { api: string; provider: string; id: string };
}): AssistantMessage {
  const content: TextContent[] = [];
  if (params.text) {
    content.push({ type: "text", text: params.text });
  }

  const stopReason: StopReason = "stop";

  const usage: Usage = {
    input: params.inputTokens,
    output: params.outputTokens,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: params.inputTokens + params.outputTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };

  return {
    role: "assistant",
    content,
    stopReason,
    api: params.modelInfo.api,
    provider: params.modelInfo.provider,
    model: params.modelInfo.id,
    usage,
    timestamp: Date.now(),
  };
}

function buildChatAssistantMessage(params: {
  text: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  inputTokens: number;
  outputTokens: number;
  finishReason?: string;
  modelInfo: { api: string; provider: string; id: string };
}): AssistantMessage {
  const content: (TextContent | ToolCall)[] = [];

  if (params.text) {
    content.push({ type: "text", text: params.text });
  }

  for (const tc of params.toolCalls) {
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(tc.arguments) as Record<string, unknown>;
    } catch {
      args = {};
    }
    content.push({
      type: "toolCall",
      id: tc.id || `deepinfra_call_${randomUUID()}`,
      name: tc.name,
      arguments: args,
    });
  }

  const hasToolCalls = params.toolCalls.length > 0;
  const stopReason: StopReason = hasToolCalls ? "toolUse" : "stop";

  const usage: Usage = {
    input: params.inputTokens,
    output: params.outputTokens,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: params.inputTokens + params.outputTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };

  return {
    role: "assistant",
    content,
    stopReason,
    api: params.modelInfo.api,
    provider: params.modelInfo.provider,
    model: params.modelInfo.id,
    usage,
    timestamp: Date.now(),
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
          // ── OpenAI-compatible chat path (tool calling supported) ───
          await runOpenAIChatPath(stream, model, context, options, tools);
        } else {
          // ── Native inference path (lower latency, no tools) ────────
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
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
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

// ── Native inference path (original, no tool support) ───────────────────────

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

  const reader = response.body.getReader();
  let accumulatedText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let finishReason: string | undefined;

  for await (const chunk of parseSseStream(reader)) {
    if (chunk.token?.text && !chunk.token.special) {
      accumulatedText += chunk.token.text;
    }

    if (chunk.details?.finish_reason) {
      finishReason = chunk.details.finish_reason;
    }
    if (typeof chunk.num_input_tokens === "number") {
      inputTokens = chunk.num_input_tokens;
    }
    if (typeof chunk.num_output_tokens === "number") {
      outputTokens = chunk.num_output_tokens;
    }
  }

  const fullText = `${THINK_OPEN}${accumulatedText}`;

  const assistantMessage = buildNativeAssistantMessage({
    text: fullText,
    inputTokens,
    outputTokens,
    finishReason,
    modelInfo: {
      api: model.api,
      provider: model.provider,
      id: model.id,
    },
  });

  stream.push({
    type: "done",
    reason: "stop",
    message: assistantMessage,
  });
}

// ── OpenAI-compatible chat path (tool calling supported) ────────────────────

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

  const reader = response.body.getReader();
  let accumulatedContent = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let finishReason: string | undefined;

  // Accumulate streaming tool_calls: keyed by index
  const toolCallAccumulator = new Map<number, { id: string; name: string; arguments: string }>();

  for await (const chunk of parseOpenAISseStream(reader)) {
    if (!chunk.choices || chunk.choices.length === 0) {
      // Usage-only chunk (sent at end with stream_options)
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
        outputTokens = chunk.usage.completion_tokens ?? outputTokens;
      }
      continue;
    }

    const choice = chunk.choices[0];
    const delta = choice.delta;

    if (delta.content) {
      accumulatedContent += delta.content;
    }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index;
        const existing = toolCallAccumulator.get(idx);
        if (!existing) {
          toolCallAccumulator.set(idx, {
            id: tc.id ?? `deepinfra_call_${randomUUID()}`,
            name: tc.function?.name ?? "",
            arguments: tc.function?.arguments ?? "",
          });
        } else {
          if (tc.function?.name) {
            existing.name += tc.function.name;
          }
          if (tc.function?.arguments) {
            existing.arguments += tc.function.arguments;
          }
        }
      }
    }

    if (choice.finish_reason) {
      finishReason = choice.finish_reason;
    }

    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
      outputTokens = chunk.usage.completion_tokens ?? outputTokens;
    }
  }

  const collectedToolCalls = Array.from(toolCallAccumulator.values());

  const assistantMessage = buildChatAssistantMessage({
    text: accumulatedContent,
    toolCalls: collectedToolCalls,
    inputTokens,
    outputTokens,
    finishReason,
    modelInfo: {
      api: model.api,
      provider: model.provider,
      id: model.id,
    },
  });

  const reason: Extract<StopReason, "stop" | "toolUse"> =
    assistantMessage.stopReason === "toolUse" ? "toolUse" : "stop";

  stream.push({
    type: "done",
    reason,
    message: assistantMessage,
  });
}
