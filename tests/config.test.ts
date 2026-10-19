// Tests for the configuration layer.
//
// Every case runs the real loader in a CHILD PROCESS through `tests/config-driver.ts`. That is not
// incidental: `loadConfig()` reads `os.homedir()` and creates `settings.json` on first run, so an
// in-process call would read and write the developer's real configuration at
// `%USERPROFILE%\.config\.websearch-via-deepseek\settings.json`. The child instead gets `USERPROFILE`
// and `HOME` pointed at a throwaway directory, every `WEBSEARCH_*` / `DEEPSEEK_*` variable cleared
// (unless the case sets one deliberately), and the temporary tree is removed afterwards.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const testsDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = dirname(testsDir)
const driverPath = join(testsDir, "config-driver.ts")

const CONFIG_DIR_NAME = ".websearch-via-deepseek"
const CONFIG_FILE_NAME = "settings.json"

const DEFAULT_SEARCH_ENDPOINT = "https://api.deepseek.com/v1/tools/search"
const DEFAULT_FETCH_ENDPOINT = "https://api.deepseek.com/v1/tools/fetch"
const DEFAULT_COUNT = 10
const DEFAULT_FETCH_MAX_CHARS = 50_000
const DEFAULT_TIMEOUT_MS = 30_000

const cleanupCallbacks: Array<() => void> = []

test.after(() => {
  for (const cleanup of cleanupCallbacks.reverse()) {
    try {
      cleanup()
    } catch {
      // A failed cleanup of a temporary directory must never fail the suite.
    }
  }
})

/**
 * Fresh throwaway home directory. Anything the loader writes for this test lands under it and is
 * deleted in `test.after`, so no state leaks between cases or into the real user profile.
 */
function createTempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "fsl-config-test-"))
  cleanupCallbacks.push(() => rmSync(home, { recursive: true, force: true }))
  return home
}

function settingsPathFor(home: string): string {
  return join(home, ".config", CONFIG_DIR_NAME, CONFIG_FILE_NAME)
}

/**
 * Writes a `settings.json` under the temporary home. `raw` is written verbatim, which is what lets a
 * case prepend a UTF-8 BOM or write a truncated document.
 */
function writeSettingsFile(home: string, raw: string): string {
  const filePath = settingsPathFor(home)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, raw, "utf-8")
  return filePath
}

function writeSettingsJson(home: string, value: unknown): string {
  return writeSettingsFile(home, JSON.stringify(value, null, 2) + "\n")
}

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex")
}

/**
 * Child environment. `WEBSEARCH_*` and `DEEPSEEK_*` are removed wholesale so a variable exported in
 * the developer's shell can never decide the outcome of a case; `overrides` re-adds exactly the ones
 * a case is about. `XDG_CONFIG_HOME` is cleared too because `os.homedir()` honours it on Linux.
 */
function childEnv(home: string, overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, USERPROFILE: home, HOME: home }
  for (const key of Object.keys(env)) {
    if (key.startsWith("WEBSEARCH_") || key.startsWith("DEEPSEEK_")) delete env[key]
  }
  delete env.XDG_CONFIG_HOME
  delete env.NODE_OPTIONS
  return { ...env, ...overrides }
}

interface DriverRun {
  status: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  stdoutLines: string[]
  stderrLines: string[]
}

function runDriver(home: string, args: string[] = [], overrides: Record<string, string> = {}): DriverRun {
  const result = spawnSync(process.execPath, ["--import", "tsx", driverPath, ...args], {
    cwd: projectRoot,
    env: childEnv(home, overrides),
    encoding: "utf-8",
  })
  const stdout = result.stdout ?? ""
  const stderr = result.stderr ?? ""
  return {
    status: result.status,
    signal: result.signal,
    stdout,
    stderr,
    stdoutLines: stdout.split(/\r?\n/).filter((line) => line !== ""),
    stderrLines: stderr.split(/\r?\n/).filter((line) => line !== ""),
  }
}

/**
 * The driver's single stdout line, parsed. Fails loudly when the child did not produce exactly one
 * JSON object: stdout purity is part of what these tests protect, so an extra line is a defect and
 * must not be silently trimmed away.
 */
function parseConfig(run: DriverRun, label: string): Record<string, unknown> {
  assert.equal(
    run.status,
    0,
    label + ": the driver must exit 0, because a configuration problem is reported and survived, never fatal",
  )
  assert.equal(
    run.stdoutLines.length,
    1,
    label + ": stdout must carry exactly the driver's JSON line and nothing else, because stdout is the MCP stdio channel",
  )
  const parsed: unknown = JSON.parse(run.stdoutLines[0])
  assert.ok(
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed),
    label + ": the driver's stdout line must be the resolved configuration as a JSON object",
  )
  return parsed as Record<string, unknown>
}

function assertKeyType(config: Record<string, unknown>, key: string, expected: "string" | "number" | "boolean"): void {
  assert.equal(
    typeof config[key],
    expected,
    key + " must keep type " + expected + ": an empty string must never overwrite a non-string key with an untyped value",
  )
}

function generatedSettings(home: string): Record<string, unknown> {
  return JSON.parse(readFileSync(settingsPathFor(home), "utf-8")) as Record<string, unknown>
}

test("1. a fresh home resolves the new built-in defaults and writes only new keys", () => {
  const home = createTempHome()
  const run = runDriver(home)
  const config = parseConfig(run, "fresh home")

  assert.equal(config.searchEndpoint, DEFAULT_SEARCH_ENDPOINT)
  assert.equal(config.fetchEndpoint, DEFAULT_FETCH_ENDPOINT)
  assert.equal(config.defaultCount, DEFAULT_COUNT)
  assert.equal(config.needContent, false)
  assert.equal(config.fetchMaxChars, DEFAULT_FETCH_MAX_CHARS)
  assert.equal(config.timeoutMs, DEFAULT_TIMEOUT_MS)
  assert.deepEqual(config.tool, { name: "web_search" })
  assert.equal(run.stderrLines.length, 0, "a first run with no settings file is normal and must not warn")

  const generated = generatedSettings(home)
  assert.ok(existsSync(settingsPathFor(home)))
  assert.ok("searchEndpoint" in generated, "the auto-generated file must contain the new search endpoint key")
  assert.ok(!("endpoint" in generated), "the auto-generated file must not contain the retired messages endpoint")
  assert.ok(!("model" in generated), "the auto-generated file must not contain the retired model key")
  assert.deepEqual(generated.tool, { name: "web_search" }, "the auto-generated tool object must not carry retired keys")
})

test("2. settings.json overrides the built-in defaults", () => {
  const home = createTempHome()
  writeSettingsJson(home, {
    searchEndpoint: "https://proxy.example/search",
    fetchEndpoint: "https://proxy.example/fetch",
    defaultCount: 25,
    needContent: true,
    fetchMaxChars: 12_000,
    timeoutMs: 5_000,
    tool: { name: "search_custom" },
  })
  const config = parseConfig(runDriver(home), "settings layer")

  assert.equal(config.searchEndpoint, "https://proxy.example/search")
  assert.equal(config.fetchEndpoint, "https://proxy.example/fetch")
  assert.equal(config.defaultCount, 25)
  assert.equal(config.needContent, true)
  assert.equal(config.fetchMaxChars, 12_000)
  assert.equal(config.timeoutMs, 5_000)
  assert.deepEqual(config.tool, { name: "search_custom" })
})

test("3. environment variables override settings.json", () => {
  const home = createTempHome()
  writeSettingsJson(home, { searchEndpoint: "https://settings.example/search", defaultCount: 25 })
  const run = runDriver(home, [], {
    WEBSEARCH_SEARCH_ENDPOINT: "https://env.example/search",
    WEBSEARCH_DEFAULT_COUNT: "7",
    WEBSEARCH_NEED_CONTENT: "true",
  })
  const config = parseConfig(run, "env layer")

  assert.equal(config.searchEndpoint, "https://env.example/search")
  assert.equal(config.defaultCount, 7)
  assert.equal(config.needContent, true)
})

test("4. CLI arguments win over environment variables, in both value forms", () => {
  const home = createTempHome()
  const run = runDriver(
    home,
    ["--search-endpoint=https://cli.example/search", "--default-count", "3", "--need-content"],
    {
      WEBSEARCH_SEARCH_ENDPOINT: "https://env.example/search",
      WEBSEARCH_DEFAULT_COUNT: "7",
      WEBSEARCH_NEED_CONTENT: "false",
    },
  )
  const config = parseConfig(run, "cli layer")

  assert.equal(config.searchEndpoint, "https://cli.example/search")
  assert.equal(config.defaultCount, 3)
  assert.equal(config.needContent, true)
})

test("5. a settings.json prefixed with a UTF-8 BOM is genuinely read", () => {
  const home = createTempHome()
  const filePath = writeSettingsFile(home, "\uFEFF" + JSON.stringify({ searchEndpoint: "https://bom.example/search" }) + "\n")
  const head = readFileSync(filePath).subarray(0, 3)

  assert.deepEqual([...head], [0xef, 0xbb, 0xbf], "the fixture must really start with the UTF-8 BOM bytes EF BB BF")
  const config = parseConfig(runDriver(home), "bom file")
  assert.equal(config.searchEndpoint, "https://bom.example/search")
})

test("6. an unparseable settings.json warns, exits zero and falls back to defaults", () => {
  const home = createTempHome()
  const filePath = writeSettingsFile(home, '{\n  "searchEndpoint": "https://truncated.example/search",\n  "apiKey": "unterminated\n')

  const run = runDriver(home)
  const config = parseConfig(run, "unparseable file")

  assert.equal(config.searchEndpoint, DEFAULT_SEARCH_ENDPOINT)
  assert.ok(
    run.stderrLines.some((line) => line.includes(filePath)),
    "the parse failure must be reported on stderr naming the file, because a silently swallowed parse error would be a defect",
  )
  assert.equal(run.stdoutLines.length, 1)
})

test("7. deprecated settings keys warn, are ignored, and leave the user file byte-identical", () => {
  const home = createTempHome()
  const filePath = writeSettingsJson(home, {
    endpoint: "https://api.deepseek.com/anthropic/v1/messages",
    model: "deepseek-flash",
    maxTokens: 32768,
    systemPrompt: "old prompt",
    tool: { name: "web_search", type: "web_search_20260209", max_uses: 20 },
  })
  const bytesBefore = readFileSync(filePath)
  const hashBefore = sha256(filePath)

  const run = runDriver(home)
  const config = parseConfig(run, "deprecated keys")

  assert.equal(config.searchEndpoint, DEFAULT_SEARCH_ENDPOINT)
  assert.deepEqual(config.tool, { name: "web_search" })
  assert.ok(!("endpoint" in config), "the resolved configuration must not carry a retired endpoint key")
  assert.ok(!("model" in config), "the resolved configuration must not carry a retired model key")

  const warning = run.stderrLines.find((line) => line.includes("deprecated"))
  assert.ok(warning !== undefined, "deprecated keys must be announced on stderr rather than silently ignored")
  assert.ok(warning.includes("endpoint"), "the warning must name at least one of the keys it ignored")
  assert.ok(warning.includes("tool.max_uses"), "the warning must name nested deprecated tool keys")

  assert.ok(bytesBefore.equals(readFileSync(filePath)), "the user's settings.json bytes must be identical after a run")
  assert.equal(sha256(filePath), hashBefore, "the settings.json digest must be unchanged after a run")
})

test("8. deprecated environment variables and CLI flags warn without affecting the result", () => {
  const home = createTempHome()
  const run = runDriver(home, ["--model=deepseek-flash", "--max-uses", "20"], {
    WEBSEARCH_ENDPOINT: "https://api.deepseek.com/anthropic/v1/messages",
    WEBSEARCH_MAX_USES: "9",
  })
  const config = parseConfig(run, "deprecated env and cli")

  assert.equal(config.searchEndpoint, DEFAULT_SEARCH_ENDPOINT)
  const warning = run.stderrLines.find((line) => line.includes("deprecated"))
  assert.ok(warning !== undefined)
  assert.ok(warning.includes("WEBSEARCH_ENDPOINT"))
  assert.ok(warning.includes("WEBSEARCH_MAX_USES"))
  assert.ok(warning.includes("--model"))
  assert.ok(warning.includes("--max-uses"))
})

test("9. numeric values outside their range are clamped rather than sent to the API", () => {
  const home = createTempHome()
  writeSettingsJson(home, { defaultCount: 999, fetchMaxChars: 10, timeoutMs: 0 })
  const run = runDriver(home)
  const config = parseConfig(run, "clamped numbers")

  assert.equal(config.defaultCount, 50)
  assert.equal(config.fetchMaxChars, 1_000)
  assert.equal(config.timeoutMs, 1_000)
  assert.ok(run.stderrLines.some((line) => line.includes("outside")), "clamping must be visible on stderr")
})

test("10. an invalid endpoint falls back to the built-in default with a warning", () => {
  const home = createTempHome()
  writeSettingsJson(home, { searchEndpoint: "not a url" })
  const run = runDriver(home)
  const config = parseConfig(run, "invalid endpoint")

  assert.equal(config.searchEndpoint, DEFAULT_SEARCH_ENDPOINT)
  assert.ok(run.stderrLines.some((line) => line.includes("invalid searchEndpoint")))
})

test("11. empty strings do not overwrite numeric or boolean keys", () => {
  const home = createTempHome()
  writeSettingsJson(home, { defaultCount: "", needContent: "", fetchMaxChars: "" })
  const config = parseConfig(runDriver(home), "empty values")

  assert.equal(config.defaultCount, DEFAULT_COUNT)
  assert.equal(config.needContent, false)
  assert.equal(config.fetchMaxChars, DEFAULT_FETCH_MAX_CHARS)
  assertKeyType(config, "defaultCount", "number")
  assertKeyType(config, "needContent", "boolean")
})

test("12. a boolean CLI flag can explicitly turn an environment value off", () => {
  const home = createTempHome()
  const config = parseConfig(
    runDriver(home, ["--need-content=false"], { WEBSEARCH_NEED_CONTENT: "true" }),
    "explicit false",
  )

  assert.equal(config.needContent, false)
})
