# TurnMap AI Provider Guide

TurnMap uses OpenAI-compatible Chat Completions providers for node summaries, automatic summaries, suggested links, connection tests, and AI-generated UI translations. Analyze Topics is different: it runs locally from existing node metadata and does not call a provider in the 0.6.0 MVP.

## API Key Format

Paste only the raw API key or OAuth bearer token value into TurnMap.

- Do not add the `Bearer ` prefix. TurnMap creates the `Authorization: Bearer ...` header itself.
- TurnMap does not validate provider-specific key prefixes because providers use different formats and can change them without notice.
- TurnMap only checks that required settings are not empty and redacts keys in task logs and debug reports.

TurnMap keeps three fields separate because providers often use them differently:

- API key: the secret used for authentication.
- Model: usually a model ID, but some platforms, such as Volcano Ark, may require an endpoint ID in the model field.
- Base URL: the request entry point, such as `https://api.openai.com/v1`. It should not be pasted into the API key field.

## Provider Presets

Presets are convenience defaults, not a promise that every account, region, or future provider version will support the same model forever.

| Provider | Default base URL | Default model | JSON mode |
| --- | --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-5.4-nano` | Yes |
| DeepSeek | `https://api.deepseek.com` | `deepseek-v4-flash` | Yes |
| OpenRouter | `https://openrouter.ai/api/v1` | `qwen/qwen3.5-flash-02-23` | Yes |
| Qwen / DashScope | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | `qwen3.5-flash` | Yes |
| Kimi / Moonshot | `https://api.moonshot.ai/v1` | `kimi-k2.6` | No |
| Doubao / Volcano Ark | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-seed-1-6-flash-250828` | No |
| Zhipu / GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4.7-flash` | Yes |
| Mistral | `https://api.mistral.ai/v1` | `mistral-small-2603` | Yes |
| Gemini compatible | empty by default | `gemini-2.5-flash-lite` | No |
| Custom OpenAI-compatible | empty by default | empty by default | Yes |

The default model choices favor lower token cost, fast responses, and enough context for summarization, translation, and link recommendation. TurnMap avoids making reasoning-depth parameters part of the default request so hidden reasoning tokens do not unexpectedly consume the user's budget.

Gemini compatible is special: Vertex AI OpenAI compatibility depends on a Google Cloud project/location path and OAuth bearer token, so it is not the same static API key experience as most other presets.

Reference docs used for the 0.5.0 preset choices:

- [OpenAI GPT-5.4 nano](https://developers.openai.com/api/docs/models/gpt-5.4-nano/)
- [DeepSeek V4 pricing/models](https://api-docs.deepseek.com/quick_start/pricing/)
- [Alibaba Model Studio models](https://www.alibabacloud.com/help/en/model-studio/models)
- [Kimi API platform](https://platform.kimi.ai/)
- [Mistral Small 4](https://docs.mistral.ai/models/model-cards/mistral-small-4-0-26-03)
- [Gemini Vertex OpenAI compatibility](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/openai)
- [Zhipu GLM-4.7-Flash](https://docs.bigmodel.cn/cn/guide/models/free/glm-4.7-flash)
- [OpenRouter Qwen3.5-Flash](https://openrouter.ai/qwen/qwen3.5-flash-02-23/api)

## Required Endpoint

TurnMap builds the request URL as:

```text
stripTrailingSlash(baseUrl) + chatPath
```

All built-in presets currently use:

```text
/chat/completions
```

The provider should accept:

```json
{
  "model": "model-or-endpoint-id",
  "temperature": 0.1,
  "max_tokens": 1200,
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ]
}
```

For JSON-producing tasks, TurnMap sends `response_format` only when the selected provider metadata marks JSON mode as supported:

```json
{
  "response_format": { "type": "json_object" }
}
```

If a provider rejects `response_format`, TurnMap retries without it.

## Context And Token Budget

The context window is decided by the model. `max_tokens` is the output cap, not the input context size.

TurnMap keeps `maxTokens` user-configurable up to 24000 and applies task-level minimum output budgets:

- Test Connection: at least 256
- Summarize / Auto summarize: at least 6000
- Suggest Links: at least 2400
- AI UI translation: at least 6000

If a provider returns an empty answer, TurnMap retries once with a higher output budget.

## Local Topic Analysis

Analyze Topics preclassifies candidate links from node titles, summaries, tags, node distance, and existing links. It is not provider embeddings and does not send conversation text to `/embeddings` or `/chat/completions`.

The output is a small set of reviewable candidate links. Users must accept a candidate before it becomes part of the graph. Future versions may use the configured provider to refine labels or relationship types for this small candidate set, but the 0.6.0 MVP keeps the analysis local.

## AI UI Translation Language Packs

AI UI translation sends only TurnMap interface labels from the built-in English dictionary. It does not send user conversations, node text, graph content, or exports.

Generated and imported language packs use this JSON shape:

```json
{
  "schemaVersion": 1,
  "app": "TurnMap",
  "languageCode": "fr-FR",
  "languageName": "Français",
  "sourceLocale": "en",
  "createdAt": "2026-05-20T00:00:00.000Z",
  "translations": {
    "app.action.refresh": "Actualiser"
  }
}
```

Rules:

- AI-generated packs only ask the user for a target language name. TurnMap derives a safe internal `languageCode` automatically.
- Imported packs still need a BCP-47 style `languageCode` such as `fr-FR`, `ja-JP`, or `de-DE`.
- Imported packs cannot replace the built-in English or Chinese options.
- Missing labels are allowed and fall back to English at runtime.
- Placeholders such as `{count}`, `{current}`, `{total}`, `{steps}`, and `{source}` must be preserved exactly.
- Extra unknown translation keys are ignored by TurnMap.

If a model returns malformed JSON during AI translation, TurnMap first tries to extract a JSON object from fenced or explanatory text. If parsing or validation still fails, TurnMap makes one extra repair request to the same provider asking for a valid language pack JSON object. If repair fails, no partial language pack is saved.

## Expected Response

Preferred response shape:

```json
{
  "choices": [
    {
      "message": {
        "content": "{\"title\":\"...\",\"summary\":\"...\"}"
      }
    }
  ]
}
```

TurnMap can also read a wide range of compatible response shapes, but `choices[0].message.content` is recommended.

Accepted response sources include:

- Chat Completions: `choices[].message.content`
- Stream-like chunks returned as text/event-stream `data:` lines
- OpenAI Responses-style text: `output_text` and `output[].content[].text`
- Plain text bodies
- Direct task JSON bodies, such as `{ "title": "...", "summary": "..." }`
- Content arrays, such as `content: [{ "type": "text", "text": "..." }]`
- Tool/function arguments: `message.function_call.arguments` and `message.tool_calls[].function.arguments`
- Common proxy/local fields: `text`, `response`, `message.content`, and `candidates[].content.parts[].text`

Empty strings are ignored. Reasoning-only fields such as `reasoning_content`, `thinking`, or analysis text are not treated as user-visible answers.

## Summarize Output

The model should return strict JSON:

```json
{
  "title": "short specific title",
  "summary": "2-3 sentence concise summary"
}
```

## Suggest Links Output

The model should return:

```json
{
  "edges": [
    {
      "source": "node-id",
      "target": "node-id",
      "relationship": "extends",
      "label": "short label",
      "important": false,
      "confidence": 0.86,
      "reason": "short reason"
    }
  ]
}
```

Supported relationships:

- `related`
- `depends_on`
- `extends`
- `supports`
- `contradicts`
- `duplicates`
- `references`
- `todo`

## Troubleshooting

- Invalid API key: confirm that the key is raw and does not include `Bearer `.
- Model not found: confirm the model ID, or endpoint ID for providers that use endpoint-style routing.
- Permission or CORS errors: confirm the base URL host is allowed by the extension and that the provider supports browser extension requests.
- Empty output: raise `maxTokens` or choose a model with a larger output cap.

## Privacy

AI features send selected node and conversation text to the provider configured by the user. Analyze Topics runs locally and does not send node text to a provider. API keys are stored locally in the browser extension profile and are redacted from task logs and debug reports.
