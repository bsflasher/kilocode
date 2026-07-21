// Structure-preserving parser for the i18n dict .ts files.
//
// Every dict file is a hand-written TypeScript module of the shape:
//
//   export const dict = {
//     "some.key": "English value",
//     "multi.line": "value that continues"
//       + "on the next line",  // (rare)
//     ...spreadDict,
//   } as const
//
// Some files also declare extra named dicts (e.g. anacondaDesktopDict) and
// spread them. We do NOT try to fully parse TS. Instead we locate every
// string-keyed entry `"<key>": <string-literal>` and record the exact byte
// span of its VALUE so we can substitute a translated string back into the
// original source, preserving comments, spreads, exports and ordering.

export interface Entry {
  key: string
  value: string
  // Byte span (in the source) of the raw value literal, quotes included.
  start: number
  end: number
}

// Match:  "key" : "value"   where value is a normal double-quoted JS string.
// We only translate simple single-literal values. Concatenations and template
// literals are skipped (left verbatim) to stay safe.
const ENTRY = /("(?:[^"\\]|\\.)*")\s*:\s*("(?:[^"\\]|\\.)*")/g

function unquote(literal: string): string {
  // literal includes surrounding quotes; decode JS escapes.
  return JSON.parse(literal) as string
}

/** Extract every translatable entry from a dict source file. */
export function parseEntries(source: string): Entry[] {
  const out: Entry[] = []
  ENTRY.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ENTRY.exec(source)) !== null) {
    const keyLit = m[1]
    const valLit = m[2]
    if (!keyLit || !valLit) continue
    const key = unquote(keyLit)
    const value = unquote(valLit)
    const valStart = m.index + m[0].length - valLit.length
    out.push({ key, value, start: valStart, end: valStart + valLit.length })
  }
  return out
}

/** Encode a JS string value as a double-quoted literal (same escaping as source). */
export function encode(value: string): string {
  return JSON.stringify(value)
}

/**
 * Retarget relative imports of sibling dict files from the English variant to
 * the Persian one, e.g. `from "./autocomplete/en"` → `from "./autocomplete/fa"`.
 * Only rewrites paths that end in `/en` (a dict module), never bare words.
 */
export function retargetImports(source: string): string {
  return source.replace(/(from\s+["'])(\.\.?\/[^"']*\/)en(["'])/g, "$1$2fa$3")
}

/**
 * Rebuild a target-language file from the English source, substituting the
 * translated value for each key. Any key missing from `translations` keeps its
 * English value (safe fallback). Structure/comments/spreads are untouched.
 */
export function rebuild(source: string, entries: Entry[], translations: Map<string, string>): string {
  let out = ""
  let cursor = 0
  for (const e of entries) {
    out += source.slice(cursor, e.start)
    const translated = translations.get(e.key)
    out += translated === undefined ? source.slice(e.start, e.end) : encode(translated)
    cursor = e.end
  }
  out += source.slice(cursor)
  return out
}
