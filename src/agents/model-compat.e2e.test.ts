import type { Api, Model } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import { normalizeModelCompat } from "./model-compat.js";

const zaiModel = (): Model<Api> =>
  ({
    id: "glm-4.7",
    name: "GLM-4.7",
    api: "openai-completions",
    provider: "zai",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 1024,
  }) as Model<Api>;

const deepInfraModel = (reasoning = true): Model<Api> =>
  ({
    id: "deepseek-ai/DeepSeek-V3.2",
    name: "DeepSeek V3.2",
    api: "openai-completions",
    provider: "deepinfra",
    baseUrl: "https://api.deepinfra.com/v1/openai",
    reasoning,
    input: ["text"],
    cost: { input: 0.26, output: 0.38, cacheRead: 0.13, cacheWrite: 0.26 },
    contextWindow: 163840,
    maxTokens: 163840,
  }) as Model<Api>;

describe("normalizeModelCompat", () => {
  it("forces supportsDeveloperRole off for z.ai models", () => {
    const model = zaiModel();
    delete (model as { compat?: unknown }).compat;
    const normalized = normalizeModelCompat(model);
    expect(
      (normalized.compat as { supportsDeveloperRole?: boolean } | undefined)?.supportsDeveloperRole,
    ).toBe(false);
  });

  it("leaves non-zai non-deepinfra models untouched", () => {
    const model = {
      ...zaiModel(),
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
    };
    delete (model as { compat?: unknown }).compat;
    const normalized = normalizeModelCompat(model);
    expect(normalized.compat).toBeUndefined();
  });

  it("does not override explicit z.ai compat false", () => {
    const model = zaiModel();
    model.compat = { supportsDeveloperRole: false };
    const normalized = normalizeModelCompat(model);
    expect(
      (normalized.compat as { supportsDeveloperRole?: boolean } | undefined)?.supportsDeveloperRole,
    ).toBe(false);
  });

  it("forces supportsDeveloperRole and supportsReasoningEffort off for deepinfra models", () => {
    const model = deepInfraModel();
    delete (model as { compat?: unknown }).compat;
    const normalized = normalizeModelCompat(model);
    expect(normalized.compat?.supportsDeveloperRole).toBe(false);
    expect(normalized.compat?.supportsReasoningEffort).toBe(false);
  });

  it("applies deepinfra compat to non-reasoning models too", () => {
    const model = deepInfraModel(false);
    delete (model as { compat?: unknown }).compat;
    const normalized = normalizeModelCompat(model);
    expect(normalized.compat?.supportsDeveloperRole).toBe(false);
    expect(normalized.compat?.supportsReasoningEffort).toBe(false);
  });

  it("does not override existing deepinfra compat when already patched", () => {
    const model = deepInfraModel();
    model.compat = {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsStore: false,
    };
    const normalized = normalizeModelCompat(model);
    expect(normalized.compat?.supportsDeveloperRole).toBe(false);
    expect(normalized.compat?.supportsReasoningEffort).toBe(false);
    expect(normalized.compat?.supportsStore).toBe(false);
  });

  it("detects deepinfra by baseUrl when provider differs", () => {
    const model = deepInfraModel();
    (model as { provider: string }).provider = "custom";
    delete (model as { compat?: unknown }).compat;
    const normalized = normalizeModelCompat(model);
    expect(normalized.compat?.supportsDeveloperRole).toBe(false);
    expect(normalized.compat?.supportsReasoningEffort).toBe(false);
  });
});
