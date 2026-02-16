import type { Api, Model } from "@mariozechner/pi-ai";

function isOpenAiCompletionsModel(model: Model<Api>): model is Model<"openai-completions"> {
  return model.api === "openai-completions";
}

function applyZaiCompat(model: Model<Api>): Model<Api> {
  const baseUrl = model.baseUrl ?? "";
  const isZai = model.provider === "zai" || baseUrl.includes("api.z.ai");
  if (!isZai || !isOpenAiCompletionsModel(model)) {
    return model;
  }

  const openaiModel = model;
  const compat = openaiModel.compat ?? undefined;
  if (compat?.supportsDeveloperRole === false) {
    return model;
  }

  openaiModel.compat = compat
    ? { ...compat, supportsDeveloperRole: false }
    : { supportsDeveloperRole: false };
  return openaiModel;
}

/**
 * DeepInfra's OpenAI-compatible API does not support the `developer` role
 * or `reasoning_effort` parameter. Force these off for reasoning models so
 * the request isn't rejected with a 422.
 */
function applyDeepInfraCompat(model: Model<Api>): Model<Api> {
  const baseUrl = model.baseUrl ?? "";
  const isDeepInfra = model.provider === "deepinfra" || baseUrl.includes("api.deepinfra.com");
  if (!isDeepInfra || !isOpenAiCompletionsModel(model)) {
    return model;
  }

  const openaiModel = model;
  const compat = openaiModel.compat ?? undefined;
  const alreadyPatched =
    compat?.supportsDeveloperRole === false && compat?.supportsReasoningEffort === false;
  if (alreadyPatched) {
    return model;
  }

  openaiModel.compat = {
    ...compat,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
  };
  return openaiModel;
}

export function normalizeModelCompat(model: Model<Api>): Model<Api> {
  let result = applyZaiCompat(model);
  result = applyDeepInfraCompat(result);
  return result;
}
