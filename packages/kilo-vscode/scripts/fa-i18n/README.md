# Persian (fa) i18n generator

Generates and maintains the Persian (Farsi) translation files for the VS Code
extension, staying in sync with the English source on every upstream update.

## How it works

- The English dictionaries under `packages/kilo-vscode/**/i18n/en.ts` are the
  source of truth. For each one there is a sibling `fa.ts` mirroring its exact
  structure (comments, spreads and exports are preserved).
- `generate.ts` reads each `en.ts`, keeps already-translated Persian values for
  unchanged keys (tracked in `.fa-cache.json`), and translates only NEW or
  CHANGED English strings via an OpenAI-compatible LLM.
- `{{placeholders}}` and `$(icon)` tokens are protected. If a translation drops
  one, that value falls back to English so the build/tests never break.

## Covered dictionaries

- `webview-ui/src/i18n` (sidebar)
- `webview-ui/agent-manager/i18n`
- `webview-ui/kiloclaw/i18n`
- `src/services/i18n` and `src/services/i18n/autocomplete`
- `src/services/cli-backend/i18n`

The upstream-shared `ui` / `kilo-i18n` layers are intentionally NOT translated
here (they fall back to English) to keep the diff from upstream small.

## Usage

From `packages/kilo-vscode`:

```bash
# Translate only new/changed strings (normal run)
FA_LLM_API_KEY=sk-... bun scripts/fa-i18n/generate.ts

# Re-translate everything
FA_LLM_API_KEY=sk-... bun scripts/fa-i18n/generate.ts --force

# No LLM: report how many keys need translation
bun scripts/fa-i18n/generate.ts --check

# No LLM: create structurally-valid fa.ts with English placeholders
bun scripts/fa-i18n/generate.ts --bootstrap
```

### Environment

| Var | Required | Default | Meaning |
|---|---|---|---|
| `FA_LLM_API_KEY` | yes | — | Bearer token for the model API |
| `FA_LLM_BASE_URL` | no | `https://api.openai.com/v1` | OpenAI-compatible base URL |
| `FA_LLM_MODEL` | no | `gpt-4o-mini` | Model id |

## Automation

`.github/workflows/fa-sync.yml` runs daily: it merges `upstream/main`, runs this
generator to translate any new strings, verifies typecheck + i18n tests, then
commits and pushes. Set the `FA_LLM_API_KEY` repository secret to enable it.
