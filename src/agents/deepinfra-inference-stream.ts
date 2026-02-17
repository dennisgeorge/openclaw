import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, StopReason, TextContent, Usage } from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";

export const DEEPINFRA_INFERENCE_BASE_URL = "https://api.deepinfra.com/v1/inference";

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

// ── Message conversion ──────────────────────────────────────────────────────

type InputContentPart = { type: "text"; text: string } | { type: "image"; data: string };

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
      // Wrap assistant content with thinking tags for template consistency.
      // If the text already contains <think>...</think>, pass it through.
      if (text.includes(THINK_OPEN)) {
        prompt += `${IM_ASSISTANT_OPEN}${text}${IM_END}`;
      } else {
        prompt += `${IM_ASSISTANT_OPEN}${THINK_CLOSE}${text}${IM_END}`;
      }
    }
    // tool/toolResult roles are not supported by the native inference API;
    // they would require the OpenAI-compatible endpoint instead.
  }

  // End with the assistant open tag + <think> to prompt the model to respond
  prompt += `${IM_ASSISTANT_OPEN}${THINK_OPEN}`;

  return prompt;
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

    // SSE events are separated by double newlines
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

  // Process remaining buffer
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

// ── Response conversion ─────────────────────────────────────────────────────

function buildAssistantMessage(params: {
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

// ── Main StreamFn factory ───────────────────────────────────────────────────

function resolveInferenceUrl(baseUrl: string, modelId: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  // If the baseUrl already contains the model path, use it directly
  if (trimmed.includes("/v1/inference/")) {
    return trimmed;
  }
  // Otherwise construct the full inference URL
  const base = trimmed || DEEPINFRA_INFERENCE_BASE_URL;
  return `${base}/${modelId}`;
}

export function createDeepInfraInferenceStreamFn(baseUrl: string): StreamFn {
  return (model, context, options) => {
    const stream = createAssistantMessageEventStream();

    const run = async () => {
      try {
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

        // The prompt ends with <think>, so the model output starts inside
        // the thinking block. Prepend <think> so the reasoning pipeline
        // sees a complete <think>...</think> wrapper.
        const fullText = `${THINK_OPEN}${accumulatedText}`;

        const assistantMessage = buildAssistantMessage({
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

        const reason = "stop" as const;

        stream.push({
          type: "done",
          reason,
          message: assistantMessage,
        });
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
