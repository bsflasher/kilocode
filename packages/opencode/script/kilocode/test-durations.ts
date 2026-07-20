// Regenerates test-durations.<platform>.json from merged junit.xml artifacts
// produced by the CI unit shards. The runner uses these durations instead of
// file size to balance test shards, so shards stay even as tests are added.
//
// Usage:
//   bun run script/kilocode/test-durations.ts <platform> <junit.xml>...
//
// Example (refresh from a recent main run of the test workflow):
//   gh run download <run-id> -R Kilo-Org/kilocode -n unit-linux-1-1 -D /tmp/u/linux1
//   gh run download <run-id> -R Kilo-Org/kilocode -n unit-linux-2-1 -D /tmp/u/linux2
//   bun run script/kilocode/test-durations.ts linux /tmp/u/linux*/opencode/.artifacts/unit/junit.xml
//
// Platforms: linux, win32, darwin. Pass every shard artifact of that platform
// so the merged file covers the full suite.

import path from "path"

const [platform, ...inputs] = process.argv.slice(2)

if (!platform || !["linux", "win32", "darwin"].includes(platform) || inputs.length === 0) {
  console.error("Usage: bun run script/kilocode/test-durations.ts <linux|win32|darwin> <junit.xml>...")
  process.exit(2)
}

const ms = new Map<string, number>()

for (const input of inputs) {
  const xml = await Bun.file(input).text()
  // Split on per-file suite markers (Windows emits backslash paths). Each chunk
  // runs to the next file's suite, so it contains all of that file's nested
  // describe-level suites; summing every testcase in the chunk is the file total.
  for (const chunk of xml.split(/<testsuite name="test[/\\]/).slice(1)) {
    const name = chunk.slice(0, chunk.indexOf('"')).replaceAll("\\", "/")
    const sum = [...chunk.matchAll(/<testcase [^>]*time="([\d.]+)"/g)].reduce((s, m) => s + parseFloat(m[1]), 0)
    ms.set(name, Math.max(ms.get(name) ?? 0, Math.round(sum * 1000)))
  }
}

if (ms.size === 0) {
  console.error("No test suites found in the given junit.xml files")
  process.exit(1)
}

const out = Object.fromEntries([...ms.entries()].sort(([a], [b]) => a.localeCompare(b)))
const target = path.join(import.meta.dir, `test-durations.${platform}.json`)
await Bun.write(target, JSON.stringify(out, null, 2) + "\n")
console.log(`wrote ${ms.size} durations to ${path.relative(process.cwd(), target)}`)
