#!/usr/bin/env bun
// Generate / update Persian (fa) i18n files from the English sources.
//
// Usage (from packages/kilo-vscode):
//   FA_LLM_API_KEY=... bun scripts/fa-i18n/generate.ts            # translate new/changed keys
//   FA_LLM_API_KEY=... bun scripts/fa-i18n/generate.ts --force    # re-translate everything
//   bun scripts/fa-i18n/generate.ts --check                       # no LLM; report missing keys only
//   bun scripts/fa-i18n/generate.ts --bootstrap                   # no LLM; create fa.ts mirroring en
//                                                                 #   (English values as placeholder)
//
// Behavior:
//   - For each English dict, keeps existing Persian values for unchanged keys
//     (incremental), so upstream syncs only cost a translation for NEW strings.
//   - Preserves {{placeholders}} and $(icon) tokens; if a translation drops one
//     it is rejected and the English value is kept as a safe fallback.
//   - Writes fa.ts mirroring the exact structure of en.ts.

import path from "node:path"
import { I18N_DIRS, enPath, faPath, PKG_ROOT } from "./config"
import { parseEntries, rebuild, retargetImports } from "./parse"
import { translateBatch, type Item } from "./translate"

const args = new Set(process.argv.slice(2))
const FORCE = args.has("--force")
const CHECK = args.has("--check")
// Bootstrap: create structurally-valid fa.ts files without calling the LLM.
// Untranslated keys keep their English value so the build and tests stay green
// until a real translation run fills them in.
const BOOTSTRAP = args.has("--bootstrap")

function cachePath(dir: string): string {
  return path.join(PKG_ROOT, dir, ".fa-cache.json")
}

function placeholders(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\{\{\s*[^}]+?\s*\}\}/g)) out.push(m[0].replace(/\s+/g, ""))
  for (const m of text.matchAll(/\$\([^)]+\)/g)) out.push(m[0])
  return out.sort()
}

function keepsPlaceholders(src: string, dst: string): boolean {
  const a = placeholders(src)
  const b = new Set(placeholders(dst))
  return a.every((p) => b.has(p))
}

async function readJson(file: string): Promise<Record<string, string>> {
  const f = Bun.file(file)
  if (!(await f.exists())) return {}
  return (await f.json()) as Record<string, string>
}

async function run() {
  let totalNew = 0
  let totalKept = 0
  const report: string[] = []

  for (const dir of I18N_DIRS) {
    const en = enPath(dir)
    const source = await Bun.file(en).text()
    const entries = parseEntries(source)

    // Existing fa values keyed by translation key (from prior fa.ts + cache).
    const cache = await readJson(cachePath(dir)) // key -> english value last translated
    const existingFa = await (async () => {
      const f = Bun.file(faPath(dir))
      if (!(await f.exists())) return new Map<string, string>()
      const faEntries = parseEntries(await f.text())
      return new Map(faEntries.map((e) => [e.key, e.value]))
    })()

    // Decide which keys need (re)translation.
    const need: Item[] = []
    const translations = new Map<string, string>()
    for (const e of entries) {
      const prevEnglish = cache[e.key]
      const priorFa = existingFa.get(e.key)
      const unchanged = !FORCE && priorFa !== undefined && prevEnglish === e.value
      if (unchanged) {
        translations.set(e.key, priorFa)
        totalKept++
        continue
      }
      need.push({ id: e.key, text: e.value })
    }

    if (CHECK) {
      report.push(`${dir}: ${need.length} key(s) need translation, ${translations.size} up-to-date`)
      continue
    }

    if (BOOTSTRAP) {
      // No translation call: fill missing keys with English placeholders.
      for (const item of need) {
        translations.set(item.id, existingFa.get(item.id) ?? item.text)
        totalNew++
      }
      const out = retargetImports(rebuild(source, entries, translations))
      await Bun.write(faPath(dir), out)
      continue
    }

    if (need.length > 0) {
      const fresh = await translateBatch(need)
      const newCache: Record<string, string> = { ...cache }
      for (const item of need) {
        const raw = fresh.get(item.id)
        const en = item.text
        const ok = typeof raw === "string" && raw.length > 0 && keepsPlaceholders(en, raw)
        if (ok) {
          translations.set(item.id, raw)
          newCache[item.id] = en
          totalNew++
        } else {
          // Fallback: keep English so the build/test never breaks.
          translations.set(item.id, existingFa.get(item.id) ?? en)
          report.push(`  ! kept fallback for [${dir}] "${item.id}"`)
        }
      }
      await Bun.write(cachePath(dir), JSON.stringify(newCache, null, 2) + "\n")
    }

    const out = retargetImports(rebuild(source, entries, translations))
    await Bun.write(faPath(dir), out)
  }

  if (CHECK) {
    console.log(report.join("\n"))
    return
  }
  console.log(`fa i18n generated. translated ${totalNew} new, kept ${totalKept} existing.`)
  if (report.length) console.log(report.join("\n"))
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
