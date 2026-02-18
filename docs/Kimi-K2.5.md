### JavaScript SDK TextGeneration

We recommend using our NodeJS client [https://github.com/deepinfra/deepinfra-node](https://github.com/deepinfra/deepinfra-node).

You can install it with

```bash
npm install deepinfra
```

#### Simple prompt

To query this model you need to provide a properly formatted input string.

```javascript
import { TextGeneration } from "deepinfra";

const DEEPINFRA_API_KEY = "$DEEPINFRA_TOKEN";
const MODEL_URL = "https://api.deepinfra.com/v1/inference/moonshotai/Kimi-K2.5";

async function main() {
  const client = new TextGeneration(MODEL_URL, DEEPINFRA_API_KEY);
  const res = await client.generate({
    input:
      "<|im_user|>ChatMessageRole.USER<|im_middle|>Hello!<|im_end|><|im_assistant|>assistant<|im_middle|>**\<think>**",
    stop: ["<|im_end|>", "[EOS]"],
  });
  console.log(res.results[0].generated_text);
}

main();

// Hello! It's nice to meet you. Is there something I can help you with, or would you like to chat?
```

#### Conversations

The OpenAI Chat Completions API is better suited for chat-like conversations, use it instead.

However, you can still do it if you really need to. You have to add each response and each of the user prompts to every request. You need a properly formatted input string to make it understand the current context. See the example below for some of them. You can tweak it even further by providing a system message.

```javascript
import { TextGeneration } from "deepinfra";

const DEEPINFRA_API_KEY = "$DEEPINFRA_TOKEN";
const MODEL_URL = "https://api.deepinfra.com/v1/inference/moonshotai/Kimi-K2.5";

async function main() {
  const client = new TextGeneration(MODEL_URL, DEEPINFRA_API_KEY);
  const res = await client.generate({
    input:
      '<|im_system|>ChatMessageRole.SYSTEM<|im_middle|>Respond like a michelin starred chef.<|im_end|><|im_user|>ChatMessageRole.USER<|im_middle|>Can you name at least two different techniques to cook lamb?<|im_end|><|im_assistant|>assistant<|im_middle|><think>**\</think>**Bonjour! Let me tell you, my friend, cooking lamb is an art form, and I\'m more than happy to share with you not two, but three of my favorite techniques to coax out the rich, unctuous flavors and tender textures of this majestic protein. First, we have the classic "Sous Vide" method. Next, we have the ancient art of "Sous le Sable". And finally, we have the more modern technique of "Hot Smoking."<|im_end|><|im_user|>ChatMessageRole.USER<|im_middle|>Tell me more about the second method.<|im_end|><|im_assistant|>assistant<|im_middle|><think>',
    stop: ["<|im_end|>", "[EOS]"],
  });
  console.log(res.results[0].generated_text);
}

main();

// Sous le Sable! It's an ancient technique that never goes out of style, n'est-ce pas? Literally ...
```

The longer the conversation gets, the more time it takes the model to generate the response. The number of messages that you can have in a conversation is limited by the context size of a model. Larger models also usually take more time to respond.

#### Input format

You can see below the basic format of the input. Bear in mind that newlines often matter.

```text
<|im_user|>ChatMessageRole.USER<|im_middle|>Hello!<|im_end|><|im_assistant|>assistant<|im_middle|><think>
```

Conversation prompts contain the history of the exchanged prompts and responses.

```text
<|im_user|>ChatMessageRole.USER<|im_middle|>First question<|im_end|><|im_assistant|>assistant<|im_middle|><think></think>First answer<|im_end|><|im_user|>ChatMessageRole.USER<|im_middle|>Second question<|im_end|><|im_assistant|>assistant<|im_middle|><think></think>Second answer<|im_end|><|im_user|>ChatMessageRole.USER<|im_middle|>Final question<|im_end|><|im_assistant|>assistant<|im_middle|><think>
```

If you want to add system prompt, it is done like this

```text
<|im_system|>ChatMessageRole.SYSTEM<|im_middle|>System prompt<|im_end|><|im_user|>ChatMessageRole.USER<|im_middle|>First question<|im_end|><|im_assistant|>assistant<|im_middle|><think></think>First answer<|im_end|><|im_user|>ChatMessageRole.USER<|im_middle|>Second question<|im_end|><|im_assistant|>assistant<|im_middle|><think></think>Second answer<|im_end|><|im_user|>ChatMessageRole.USER<|im_middle|>Final question<|im_end|><|im_assistant|>assistant<|im_middle|><think>
```

## Input fields

[

### `input`_string_

](https://deepinfra.com/moonshotai/Kimi-K2.5/api?example=js-text-gen#input-input)

text to generate from

[

### `max_new_tokens`_integer_

](https://deepinfra.com/moonshotai/Kimi-K2.5/api?example=js-text-gen#input-max_new_tokens)

maximum length of the newly generated generated text.If explicitly set to None it will be the model's max context length minus input length or 16384, whichever is smaller

Range: `1 ≤ max_new_tokens ≤ 1000000`

[

### `temperature`_number_

](https://deepinfra.com/moonshotai/Kimi-K2.5/api?example=js-text-gen#input-temperature)

temperature to use for sampling. 0 means the output is deterministic. Values greater than 1 encourage more diversity

Default value: `0.7`

Range: `0 ≤ temperature ≤ 100`

[

### `top_p`_number_

](https://deepinfra.com/moonshotai/Kimi-K2.5/api?example=js-text-gen#input-top_p)

Sample from the set of tokens with highest probability such that sum of probabilies is higher than p. Lower values focus on the most probable tokens.Higher values sample more low-probability tokens

Default value: `0.9`

Range: `0 < top_p ≤ 1`

[

### `min_p`_number_

](https://deepinfra.com/moonshotai/Kimi-K2.5/api?example=js-text-gen#input-min_p)

Float that represents the minimum probability for a token to be considered, relative to the probability of the most likely token. Must be in [0, 1]. Set to 0 to disable this.

Default value: `0`

Range: `0 ≤ min_p ≤ 1`

[

### `top_k`_integer_

](https://deepinfra.com/moonshotai/Kimi-K2.5/api?example=js-text-gen#input-top_k)

Sample from the best k (number of) tokens. 0 means off

Default value: `0`

Range: `0 ≤ top_k < 1000`

[

### `repetition_penalty`_number_

](https://deepinfra.com/moonshotai/Kimi-K2.5/api?example=js-text-gen#input-repetition_penalty)

repetition penalty. Value of 1 means no penalty, values greater than 1 discourage repetition, smaller than 1 encourage repetition.

Default value: `1`

Range: `0.01 ≤ repetition_penalty ≤ 5`

[

### `stop`_array_

](https://deepinfra.com/moonshotai/Kimi-K2.5/api?example=js-text-gen#input-stop)

Up to 16 strings that will terminate generation immediately

[

### `num_responses`_integer_

](https://deepinfra.com/moonshotai/Kimi-K2.5/api?example=js-text-gen#input-num_responses)

Number of output sequences to return. Incompatible with streaming

Default value: `1`

Range: `1 ≤ num_responses ≤ 4`

[

### `response_format`_any_

](https://deepinfra.com/moonshotai/Kimi-K2.5/api?example=js-text-gen#input-response_format)

Optional nested object with "type" set to "json_object"

Default value: `{"type":"text"}`

[

### `presence_penalty`_number_

](https://deepinfra.com/moonshotai/Kimi-K2.5/api?example=js-text-gen#input-presence_penalty)

Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics.

Default value: `0`

Range: `-2 ≤ presence_penalty ≤ 2`

[

### `frequency_penalty`_number_

](https://deepinfra.com/moonshotai/Kimi-K2.5/api?example=js-text-gen#input-frequency_penalty)

Positive values penalize new tokens based on how many times they appear in the text so far, increasing the model's likelihood to talk about new topics.

Default value: `0`

Range: `-2 ≤ frequency_penalty ≤ 2`

[

### `user`_string_

](https://deepinfra.com/moonshotai/Kimi-K2.5/api?example=js-text-gen#input-user)

A unique identifier representing your end-user, which can help monitor and detect abuse. Avoid sending us any identifying information. We recommend hashing user identifiers.

[

### `seed`_integer_

](https://deepinfra.com/moonshotai/Kimi-K2.5/api?example=js-text-gen#input-seed)

Seed for random number generator. If not provided, a random seed is used. Determinism is not guaranteed.

Range: `-9223372036854776000 ≤ seed < 18446744073709552000`

[

### `prompt_cache_key`_string_

](https://deepinfra.com/moonshotai/Kimi-K2.5/api?example=js-text-gen#input-prompt_cache_key)

A key to identify prompt cache for reuse across requests. If provided, the prompt will be cached and can be reused in subsequent requests with the same key.

[

### `webhook`_file_

](https://deepinfra.com/moonshotai/Kimi-K2.5/api?example=js-text-gen#input-webhook)

The webhook to call when inference is done, by default you will get the output in the response of your inference request

[

### `stream`_boolean_

](https://deepinfra.com/moonshotai/Kimi-K2.5/api?example=js-text-gen#input-stream)

Whether to stream tokens, by default it will be false, currently only supported for Llama 2 text generation models, token by token updates will be sent over SSE

Default value: `false`

## Input Schema

This is the detailed description of the input parameters in JSON Schema format

```bash
{
    "definitions": {
        "JsonObjectResponseFormat": {
            "properties": {
                "type": {
                    "const": "json_object",
                    "default": "json_object",
                    "title": "Type",
                    "type": "string"
                }
            },
            "title": "JsonObjectResponseFormat",
            "type": "object"
        },
        "JsonSchema": {
            "properties": {
                "name": {
                    "description": "Name identifier for the JSON schema",
                    "title": "Name",
                    "type": "string"
                },
                "schema": {
                    "additionalProperties": true,
                    "description": "The actual JSON schema definition",
                    "title": "Schema",
                    "type": "object"
                }
            },
            "required": [
                "name",
                "schema"
            ],
            "title": "JsonSchema",
            "type": "object"
        },
        "JsonSchemaResponseFormat": {
            "properties": {
                "type": {
                    "const": "json_schema",
                    "default": "json_schema",
                    "title": "Type",
                    "type": "string"
                },
                "json_schema": {
                    "$ref": "#/definitions/JsonSchema",
                    "description": "JSON schema for structured output when type is 'json_schema'"
                }
            },
            "required": [
                "json_schema"
            ],
            "title": "JsonSchemaResponseFormat",
            "type": "object"
        },
        "RegexResponseFormat": {
            "properties": {
                "type": {
                    "const": "regex",
                    "default": "regex",
                    "title": "Type",
                    "type": "string"
                },
                "regex": {
                    "description": "Regex pattern for structured output when type is 'regex'",
                    "title": "Regex",
                    "type": "string"
                }
            },
            "required": [
                "regex"
            ],
            "title": "RegexResponseFormat",
            "type": "object"
        },
        "TextResponseFormat": {
            "properties": {
                "type": {
                    "const": "text",
                    "default": "text",
                    "title": "Type",
                    "type": "string"
                }
            },
            "title": "TextResponseFormat",
            "type": "object"
        }
    },
    "required": [
        "input"
    ],
    "title": "TextGenerationIn",
    "type": "object",
    "properties": {
        "input": {
            "description": "text to generate from",
            "title": "Input",
            "type": "string",
            "example": "I have this dream"
        },
        "max_new_tokens": {
            "description": "maximum length of the newly generated generated text.If explicitly set to None it will be the model's max context length minus input length or 16384, whichever is smaller",
            "maximum": 1000000,
            "minimum": 1,
            "title": "Max New Tokens",
            "type": "integer",
            "example": 512
        },
        "temperature": {
            "default": 0.7,
            "description": "temperature to use for sampling. 0 means the output is deterministic. Values greater than 1 encourage more diversity",
            "maximum": 100,
            "minimum": 0,
            "title": "Temperature",
            "type": "number",
            "example": 0.7
        },
        "top_p": {
            "default": 0.9,
            "description": "Sample from the set of tokens with highest probability such that sum of probabilies is higher than p. Lower values focus on the most probable tokens.Higher values sample more low-probability tokens",
            "exclusiveMinimum": 0,
            "maximum": 1,
            "title": "Top P",
            "type": "number",
            "example": 0.9
        },
        "min_p": {
            "default": 0,
            "description": "Float that represents the minimum probability for a token to be considered, relative to the probability of the most likely token. Must be in [0, 1]. Set to 0 to disable this.",
            "maximum": 1,
            "minimum": 0,
            "title": "Min P",
            "type": "number",
            "example": 0.1
        },
        "top_k": {
            "default": 0,
            "description": "Sample from the best k (number of) tokens. 0 means off",
            "exclusiveMaximum": 1000,
            "minimum": 0,
            "title": "Top K",
            "type": "integer",
            "example": 50
        },
        "repetition_penalty": {
            "default": 1,
            "description": "repetition penalty. Value of 1 means no penalty, values greater than 1 discourage repetition, smaller than 1 encourage repetition.",
            "maximum": 5,
            "minimum": 0.01,
            "title": "Repetition Penalty",
            "type": "number",
            "example": 1
        },
        "stop": {
            "description": "Up to 16 strings that will terminate generation immediately",
            "items": {
                "type": "string"
            },
            "title": "Stop",
            "type": "array"
        },
        "num_responses": {
            "default": 1,
            "description": "Number of output sequences to return. Incompatible with streaming",
            "maximum": 4,
            "minimum": 1,
            "title": "Num Responses",
            "type": "integer"
        },
        "response_format": {
            "anyOf": [
                {
                    "$ref": "#/definitions/TextResponseFormat"
                },
                {
                    "$ref": "#/definitions/JsonObjectResponseFormat"
                },
                {
                    "$ref": "#/definitions/JsonSchemaResponseFormat"
                },
                {
                    "$ref": "#/definitions/RegexResponseFormat"
                }
            ],
            "default": {
                "type": "text"
            },
            "description": "Optional nested object with \"type\" set to \"json_object\"",
            "title": "Response Format"
        },
        "presence_penalty": {
            "default": 0,
            "description": "Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics.",
            "maximum": 2,
            "minimum": -2,
            "title": "Presence Penalty",
            "type": "number"
        },
        "frequency_penalty": {
            "default": 0,
            "description": "Positive values penalize new tokens based on how many times they appear in the text so far, increasing the model's likelihood to talk about new topics.",
            "maximum": 2,
            "minimum": -2,
            "title": "Frequency Penalty",
            "type": "number"
        },
        "user": {
            "description": "A unique identifier representing your end-user, which can help monitor and detect abuse. Avoid sending us any identifying information. We recommend hashing user identifiers.",
            "title": "User",
            "type": "string"
        },
        "seed": {
            "description": "Seed for random number generator. If not provided, a random seed is used. Determinism is not guaranteed.",
            "exclusiveMaximum": 18446744073709552000,
            "minimum": -9223372036854776000,
            "title": "Seed",
            "type": "integer"
        },
        "prompt_cache_key": {
            "description": "A key to identify prompt cache for reuse across requests. If provided, the prompt will be cached and can be reused in subsequent requests with the same key.",
            "title": "Prompt Cache Key",
            "type": "string"
        },
        "webhook": {
            "description": "The webhook to call when inference is done, by default you will get the output in the response of your inference request",
            "format": "uri",
            "is_base_field": true,
            "maxLength": 2083,
            "minLength": 1,
            "title": "Webhook",
            "type": "string"
        },
        "stream": {
            "default": false,
            "description": "Whether to stream tokens, by default it will be false, currently only supported for Llama 2 text generation models, token by token updates will be sent over SSE",
            "is_base_field": true,
            "title": "Stream",
            "type": "boolean",
            "example": true
        }
    }
}
```

## Output Schema

This is the detailed description of the output parameters in JSON Schema format

```bash
{
    "definitions": {
        "GeneratedText": {
            "properties": {
                "generated_text": {
                    "description": "generated text, including the prompt",
                    "examples": [
                        "I have this dream about the day I got a job at a tech company. I just woke up on a plane. I sat down on the floor and started getting work done. After getting up around 6 p.m., I looked around and"
                    ],
                    "title": "Generated Text",
                    "type": "string"
                }
            },
            "required": [
                "generated_text"
            ],
            "title": "GeneratedText",
            "type": "object"
        },
        "InferenceReplyStatus": {
            "properties": {
                "status": {
                    "choices": [
                        "unknown",
                        "queued",
                        "running",
                        "succeeded",
                        "failed"
                    ],
                    "default": "succeeded",
                    "description": "Inference status",
                    "title": "Status",
                    "type": "string"
                },
                "runtime_ms": {
                    "default": 0,
                    "description": "runtime in milliseconds",
                    "title": "Runtime Ms",
                    "type": "integer"
                },
                "cost": {
                    "description": "estimated cost billed for the request in USD",
                    "title": "Cost",
                    "type": "number"
                },
                "tokens_generated": {
                    "description": "number of tokens generated",
                    "title": "Tokens Generated",
                    "type": "integer"
                },
                "tokens_input": {
                    "description": "number of input tokens",
                    "title": "Tokens Input",
                    "type": "integer"
                },
                "output_length": {
                    "description": "length of the output in seconds",
                    "title": "Output Length",
                    "type": "integer"
                }
            },
            "required": [
                "cost"
            ],
            "title": "InferenceReplyStatus",
            "type": "object"
        }
    },
    "required": [
        "results"
    ],
    "title": "TextGenerationOut",
    "type": "object",
    "properties": {
        "results": {
            "description": "a list of generated texts",
            "items": {
                "$ref": "#/definitions/GeneratedText"
            },
            "title": "Results",
            "type": "array"
        },
        "num_tokens": {
            "description": "number of generated tokens, excluding prompt",
            "title": "Num Tokens",
            "type": "integer",
            "example": 42
        },
        "num_input_tokens": {
            "description": "number of input tokens",
            "title": "Num Input Tokens",
            "type": "integer",
            "example": 100
        },
        "request_id": {
            "description": "The request id",
            "is_base_field": true,
            "title": "Request Id",
            "type": "string"
        },
        "inference_status": {
            "$ref": "#/definitions/InferenceReplyStatus",
            "description": "Object containing the status of the inference request",
            "is_base_field": true,
            "type": "object",
            "title": "InferenceReplyStatus"
        }
    }
}
```

## Streaming Schema

This is the detailed description of the output stream parameters in JSON Schema format

```bash
{
    "definitions": {
        "DICompletionStreamDetails": {
            "properties": {
                "finish_reason": {
                    "$ref": "#/definitions/FinishReason",
                    "description": "the reason the model stopped generating tokens. stop if the model hit a natural stop point or a provided stop sequence, length if the maximum number of tokens specified in the request was reached."
                }
            },
            "title": "DICompletionStreamDetails",
            "type": "object"
        },
        "DICompletionStreamToken": {
            "properties": {
                "id": {
                    "description": "a unique identifier for the token",
                    "title": "Id",
                    "type": "null"
                },
                "text": {
                    "description": "the generated text",
                    "title": "Text",
                    "type": "string"
                },
                "logprob": {
                    "default": 0,
                    "description": "the log probability of the tokens",
                    "title": "Logprob",
                    "type": "number"
                },
                "special": {
                    "default": false,
                    "description": "whether the token is a special token or part of the generated text",
                    "title": "Special",
                    "type": "boolean"
                }
            },
            "required": [
                "text"
            ],
            "title": "DICompletionStreamToken",
            "type": "object"
        },
        "FinishReason": {
            "enum": [
                "stop",
                "length",
                "tool_calls",
                "content_filter",
                "malformed_function_call"
            ],
            "title": "FinishReason",
            "type": "string"
        }
    },
    "required": [
        "token"
    ],
    "title": "DICompletionStreamOut",
    "type": "object",
    "properties": {
        "token": {
            "$ref": "#/definitions/DICompletionStreamToken",
            "description": "the generated token",
            "type": "object",
            "title": "DICompletionStreamToken"
        },
        "request_id": {
            "description": "The request id",
            "title": "Request Id",
            "type": "string"
        },
        "generated_text": {
            "default": "",
            "description": "the entire generated text, only available in the last message chunk",
            "title": "Generated Text",
            "type": "string"
        },
        "details": {
            "$ref": "#/definitions/DICompletionStreamDetails",
            "description": "additional details about the completion",
            "type": "object",
            "title": "DICompletionStreamDetails"
        },
        "num_output_tokens": {
            "description": "number of output tokens in the completion",
            "title": "Num Output Tokens",
            "type": "integer"
        },
        "num_input_tokens": {
            "description": "number of input tokens in the request",
            "title": "Num Input Tokens",
            "type": "integer"
        },
        "estimated_cost": {
            "description": "estimated cost of the completion in USD",
            "title": "Estimated Cost",
            "type": "number"
        }
    }
}
```
