import path from "path"

export namespace TestShard {
  export type Info = {
    index: number
    total: number
  }

  export function parse(input?: string) {
    if (!input) return { ok: true as const, value: undefined }
    const match = input.match(/^(\d+)\/(\d+)$/)
    if (!match) return { ok: false as const, error: `Invalid test shard "${input}"; expected N/M` }

    const value = { index: Number(match[1]), total: Number(match[2]) }
    if (
      !Number.isSafeInteger(value.index) ||
      !Number.isSafeInteger(value.total) ||
      value.total < 1 ||
      value.total > 1_000 ||
      value.index < 1 ||
      value.index > value.total
    ) {
      return { ok: false as const, error: `Invalid test shard "${input}"; expected 1 <= N <= M <= 1000` }
    }
    return { ok: true as const, value }
  }

  // Recorded per-file test durations in milliseconds, regenerated from CI junit
  // artifacts with script/kilocode/test-durations.ts. Shards balance far better
  // with real durations than with file size: a small PTY test can run for
  // minutes while a large generated test finishes instantly.
  export type Durations = {
    ms: Map<string, number>
    fallback: number
  }

  export async function durations(dir: string, platform = process.platform): Promise<Durations | undefined> {
    for (const name of [`test-durations.${platform}.json`, "test-durations.linux.json"]) {
      const file = Bun.file(path.join(dir, name))
      if (!(await file.exists())) continue
      const data: Record<string, number> = await file.json()
      const ms = new Map(Object.entries(data))
      const sorted = [...ms.values()].sort((a, b) => a - b)
      return { ms, fallback: sorted[Math.floor(sorted.length / 2)] ?? 1 }
    }
    return undefined
  }

  export function order(files: readonly string[], weight: (file: string) => number) {
    return files.slice().sort((a, b) => weight(b) - weight(a) || a.localeCompare(b))
  }

  export function split(files: readonly string[], weight: (file: string) => number, total: number) {
    const groups = Array.from({ length: total }, () => ({ files: [] as string[], weight: 0 }))
    for (const file of order(files, weight)) {
      const group = groups.reduce((best, item) => {
        if (item.weight < best.weight) return item
        if (item.weight === best.weight && item.files.length < best.files.length) return item
        return best
      })
      group.files.push(file)
      group.weight += weight(file)
    }
    return groups.map((group) => group.files)
  }
}
