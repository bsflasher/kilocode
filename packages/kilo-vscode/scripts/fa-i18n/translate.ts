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

async function callModel(items: Item[]): Promise<Map<string, string>> {
  const payload = {
    model: MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
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
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`LLM request failed ${res.status}: ${body.slice(0, 500)}`)
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error("LLM returned empty content")
  const parsed = JSON.parse(content) as Record<string, string>
  const out = new Map<string, string>()
  for (const item of items) {
    const val = parsed[item.id]
    if (typeof val === "string") out.set(item.id, val)
  }
  return out
}

/** Translate a list of {id,text} in batches, returning id → Persian. */
export async function translateBatch(items: Item[], batchSize = 40): Promise<Map<string, string>> {
  if (!API_KEY) throw new Error("FA_LLM_API_KEY is not set")
  const result = new Map<string, string>()
  for (let i = 0; i < items.length; i += batchSize) {
    const slice = items.slice(i, i + batchSize)
    const translated = await callModel(slice)
    for (const [k, v] of translated) result.set(k, v)
    // Basic backoff between batches to be gentle on rate limits.
    if (i + batchSize < items.length) await new Promise((r) => setTimeout(r, 300))
  }
  return result
}

export type { Item }
