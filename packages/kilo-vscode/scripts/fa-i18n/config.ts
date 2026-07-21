// Persian (fa) i18n generation — shared config.
// Kilo Code fork addition: generates Farsi translation files from the English
// source dictionaries inside packages/kilo-vscode.
//
// This file lists every English source dictionary that must have a matching
// fa.ts sibling. The generator reads each en.ts, keeps already-translated fa
// values, translates only new/changed English strings via an LLM, and writes
// fa.ts preserving the exact structure of en.ts.

import path from "node:path"

// Repo-relative to packages/kilo-vscode.
export const PKG_ROOT = path.resolve(import.meta.dir, "../..")

/** Every i18n directory inside kilo-vscode that has an en.ts we mirror to fa.ts. */
export const I18N_DIRS: readonly string[] = [
  "webview-ui/src/i18n",
  "webview-ui/agent-manager/i18n",
  "webview-ui/kiloclaw/i18n",
  "src/services/i18n",
  "src/services/i18n/autocomplete",
  "src/services/cli-backend/i18n",
]

export function enPath(dir: string): string {
  return path.join(PKG_ROOT, dir, "en.ts")
}

export function faPath(dir: string): string {
  return path.join(PKG_ROOT, dir, "fa.ts")
}
