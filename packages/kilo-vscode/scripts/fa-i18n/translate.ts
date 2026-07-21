// LLM-backed batch translator: English → Persian (Farsi).
//
// Provider-agnostic: talks to any OpenAI-compatible Chat Completions endpoint
// (OpenAI, OpenRouter, Azure, local, etc). Configure via env:
//
//   FA_LLM_API_KEY   (required) API key / bearer token
//   FA_LLM_BASE_URL  (optional) default https://api.openai.com/v1
//   FA_LLM_MODEL     (optional) default gpt-4o-mini
//
// Translation rules enforced in the prompt:
//   - Preserve every {{placeholder}} exactly (do not translate or reorder names).
//   - Preserve VS Code icon/markup tokens like $(kilo-logo), $(warning).
//   - Preserve markdown/link syntax and leading/trailing whitespace.
//   - Keep brand names (Kilo, Anaconda Desktop, GitHub, ...) untranslated.
//   - Return natural, professional software Persian.

const API_KEY = process.env.FA_LLM_API_KEY ?? ""
const BASE_URL = (process.env.FA_LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "")
const MODEL = process.env.FA_LLM_MODEL ?? "gpt-4o-mini"
// Some gateways (e.g. Claude-backed) reject the OpenAI json_object response
// format. Enable it only when the model is known to support it.
const JSON_MODE = /^(gpt|o[0-9]|openai)/i.test(MODEL)

const SYSTEM = [
  "You are a professional software localization engine.",
  "Translate UI strings from English to Persian (Farsi, fa-IR).",
  "Rules:",
  "1. Preserve every {{placeholder}} token verbatim — same name, same braces, do not translate or drop them.",
  "2. Preserve VS Code icon tokens like $(kilo-logo), $(warning) verbatim.",
  "3. Preserve markdown, links [text](url), backticks, newlines (\\n), and leading/trailing whitespace.",
  "4. Do NOT translate brand/product names: Kilo, Kilo Code, Anaconda Desktop, GitHub, VS Code, MCP, LSP, URL.",
  "5. Use natural, concise, professional Persian used in real software UIs.",
  "6. Return ONLY a JSON object mapping each input id to its Persian translation. No prose.",
].join("\n")

interface Item {
  id: string
  text: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** POST to the chat endpoint, retrying on 429/5xx with exponential backoff. */
async function request(payload: unknown, attempt = 0): Promise<Response> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(payload),
  })
  if (res.ok) return res
  const retryable = res.status === 429 || res.status >= 500
  if (retryable && attempt < 8) {
    const header = Number(res.headers.get("retry-after"))
    const wait = Number.isFinite(header) && header > 0 ? header * 1000 : Math.min(60000, 2000 * 2 ** attempt)
    await res.body?.cancel()
    console.log(`  rate/again ${res.status}; waiting ${Math.round(wait / 1000)}s (attempt ${attempt + 1})`)
    await sleep(wait)
    return request(payload, attempt + 1)
  }
  const body = await res.text()
  throw new Error(`LLM request failed ${res.status}: ${body.slice(0, 500)}`)
}

/** Parse a JSON object from a model reply, tolerating code fences or prose. */
function extractJson(content: string): Record<string, string> {
  const trimmed = content.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1]! : trimmed
  const start = candidate.indexOf("{")
  const end = candidate.lastIndexOf("}")
  const slice = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate
  return JSON.parse(slice) as Record<string, string>
}

async function callModel(items: Item[]): Promise<Map<string, string>> {
  const payload = {
    model: MODEL,
    temperature: 0,
    ...(JSON_MODE ? { response_format: { type: "json_object" } } : {}),
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content:
          "Translate each value to Persian. Input is a JSON object {id: english}. " +
          "Return a JSON object {id: persian} with the same ids.\n\n" +
          JSON.stringify(Object.fromEntries(items.map((i) => [i.id, i.text]))),
      },
    ],
  }
  const res = await request(payload)
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error("LLM returned empty content")
  const parsed = extractJson(content)
  const out = new Map<string, string>()
  for (const item of items) {
    const val = parsed[item.id]
    if (typeof val === "string") out.set(item.id, val)
  }
  return out
}

const BATCH = Number(process.env.FA_LLM_BATCH ?? 15)
const DELAY = Number(process.env.FA_LLM_DELAY_MS ?? 1500)

/**
 * Translate items in small batches. `onBatch` is invoked after every successful
 * batch with the cumulative results so callers can persist progress and survive
 * interruptions / rate limits.
 */
export async function translateBatch(
  items: Item[],
  onBatch?: (all: Map<string, string>) => Promise<void> | void,
): Promise<Map<string, string>> {
  if (!API_KEY) throw new Error("FA_LLM_API_KEY is not set")
  const result = new Map<string, string>()
  const total = Math.ceil(items.length / BATCH)
  for (let i = 0; i < items.length; i += BATCH) {
    const slice = items.slice(i, i + BATCH)
    const translated = await callModel(slice)
    for (const [k, v] of translated) result.set(k, v)
    console.log(`  batch ${Math.floor(i / BATCH) + 1}/${total} (${result.size}/${items.length})`)
    if (onBatch) await onBatch(result)
    if (i + BATCH < items.length) await sleep(DELAY)
  }
  return result
}

export type { Item }
