// Tests for the configuration layer (solution unit U2).
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
const BUILT_IN_DEFAULT_MODEL = "deepseek-flash"
const BUILT_IN_DEFAULT_MAX_TOKENS = 32768

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

function assertKeyType(config: Record<string, unknown>, key: string, expected: "string" | "number"): void {
  assert.equal(
    typeof config[key],
    expected,
    key + " must keep type " + expected + ": an empty string must never overwrite a non-string key with an untyped value",
  )
}

test("1. a fresh home with no model environment variables and no arguments resolves the built-in default", () => {
  const home = createTempHome()
  const run = runDriver(home)
  const config = parseConfig(run, "fresh home")

  assert.equal(
    config.model,
    BUILT_IN_DEFAULT_MODEL,
    "with no environment variable, no argument and no settings.json the built-in default model must be " + BUILT_IN_DEFAULT_MODEL,
  )
  assert.equal(
    run.stderrLines.length,
    0,
    "a first run with no configuration file is normal and must not warn, because warnings are reserved for real problems",
  )
  assert.ok(
    existsSync(settingsPathFor(home)),
    "the first run must generate settings.json inside the redirected home, which also proves the child never touches the real user profile",
  )
})

test("2. a settings.json model overrides the built-in default", () => {
  const home = createTempHome()
  writeSettingsJson(home, { model: "settings-layer-model" })
  const run = runDriver(home)
  const config = parseConfig(run, "settings layer")

  assert.equal(
    config.model,
    "settings-layer-model",
    "the user settings.json layer must win over the built-in default, otherwise every persisted user choice would be ignored",
  )
})

test("3. DEEPSEEK_MODEL alone is honoured as the accepted legacy alias", () => {
  const home = createTempHome()
  const run = runDriver(home, [], { DEEPSEEK_MODEL: "legacy-env-model" })
  const config = parseConfig(run, "legacy alias")

  assert.equal(
    config.model,
    "legacy-env-model",
    "DEEPSEEK_MODEL must keep working as the documented legacy alias, because removing a published variable name would break existing setups",
  )
})

test("4. WEBSEARCH_MODEL wins over DEEPSEEK_MODEL", () => {
  const home = createTempHome()
  const run = runDriver(home, [], {
    WEBSEARCH_MODEL: "canonical-env-model",
    DEEPSEEK_MODEL: "legacy-env-model",
  })
  const config = parseConfig(run, "canonical over legacy")

  assert.equal(
    config.model,
    "canonical-env-model",
    "the canonical WEBSEARCH_MODEL must win over the legacy DEEPSEEK_MODEL, so the documented precedence order holds",
  )
})

test("5. --model on the command line wins over both environment variables", () => {
  const home = createTempHome()
  const run = runDriver(home, ["--model=cli-layer-model"], {
    WEBSEARCH_MODEL: "canonical-env-model",
    DEEPSEEK_MODEL: "legacy-env-model",
  })
  const config = parseConfig(run, "cli layer")

  assert.equal(
    config.model,
    "cli-layer-model",
    "the --model argument must win over every environment variable, otherwise an explicit per-invocation choice could not be made",
  )
})

test("6. a persisted retired alias falls back to the default, warns on stderr, and never rewrites the file", () => {
  const home = createTempHome()
  const filePath = writeSettingsJson(home, { model: "deepseek-v4-flash" })
  const bytesBefore = readFileSync(filePath)
  const hashBefore = sha256(filePath)

  const run = runDriver(home)
  const config = parseConfig(run, "retired alias")

  assert.equal(
    config.model,
    BUILT_IN_DEFAULT_MODEL,
    "a persisted retired alias must be treated as unset so resolution falls through to the built-in default, which is the whole point of this migration",
  )

  const warning = run.stderrLines.find((line) => line.includes("deepseek-v4-flash"))
  assert.ok(
    warning !== undefined,
    "the retired alias must be announced on stderr, because the user's file is never rewritten and this warning is the only visible surface of the migration",
  )
  assert.ok(
    warning.includes(filePath),
    "the warning must name the configuration file it ignored, so the user can find the stale value",
  )
  assert.ok(
    warning.includes("falling back to the built-in default"),
    "the warning must state that this layer falls back to the built-in default, because the user's file is never rewritten and this warning is where they learn the stale value was dropped",
  )
  assert.ok(
    !warning.includes("using " + BUILT_IN_DEFAULT_MODEL),
    "the warning must not claim the process will use " + BUILT_IN_DEFAULT_MODEL + ", because it is emitted before the environment and CLI layers are merged and WEBSEARCH_MODEL or --model can still override the model",
  )

  assert.equal(
    run.stdoutLines.length,
    1,
    "stdout must stay protocol-clean even when a warning is emitted, because the warning belongs on stderr only",
  )

  const bytesAfter = readFileSync(filePath)
  assert.ok(
    bytesBefore.equals(bytesAfter),
    "the user's settings.json bytes must be identical after a run, because the documented promise is that the file persists across upgrades and is only ever written on first run",
  )
  assert.equal(
    sha256(filePath),
    hashBefore,
    "the settings.json SHA-256 must be unchanged after a run, which is the same never-rewrite promise stated as a digest",
  )
})

test("7. a settings.json prefixed with a UTF-8 BOM is genuinely read", () => {
  const home = createTempHome()
  const filePath = writeSettingsFile(home, "\uFEFF" + JSON.stringify({ model: "bom-layer-model" }) + "\n")
  const head = readFileSync(filePath).subarray(0, 3)

  assert.deepEqual(
    [...head],
    [0xef, 0xbb, 0xbf],
    "the fixture must really start with the UTF-8 BOM bytes EF BB BF, otherwise this case would not test BOM tolerance at all",
  )

  const run = runDriver(home)
  const config = parseConfig(run, "bom file")

  assert.equal(
    config.model,
    "bom-layer-model",
    "a BOM-prefixed file must be parsed rather than silently discarded, because losing the whole user layer to an invisible byte was the reported defect",
  )
})

test("8. an unparseable settings.json warns, exits zero and falls back to the default", () => {
  const home = createTempHome()
  const filePath = writeSettingsFile(home, '{\n  "model": "truncated-model",\n  "apiKey": "unterminated\n')

  const run = runDriver(home)
  const config = parseConfig(run, "unparseable file")

  assert.equal(
    run.status,
    0,
    "a parse failure must never be fatal, because a crash on startup is worse than the degraded run it replaces",
  )
  assert.equal(
    config.model,
    BUILT_IN_DEFAULT_MODEL,
    "an unparseable file must fall back to the built-in default rather than leaving the model undefined",
  )
  assert.ok(
    run.stderrLines.some((line) => line.includes(filePath)),
    "the parse failure must be reported on stderr naming the file, because a silently swallowed parse error was the reported defect",
  )
  assert.equal(
    run.stdoutLines.length,
    1,
    "stdout must stay protocol-clean when a parse failure is reported, because the report belongs on stderr only",
  )
})

test('9. WEBSEARCH_MODEL="" clears the model instead of letting the settings layer survive', () => {
  const home = createTempHome()
  writeSettingsJson(home, { model: "settings-layer-model" })
  const run = runDriver(home, [], { WEBSEARCH_MODEL: "" })
  const config = parseConfig(run, "empty canonical variable")

  assert.equal(
    config.model,
    "",
    "an explicitly empty WEBSEARCH_MODEL must clear the lower layer, which requires reading the model variable with an undefined check rather than a truthiness guard",
  )
  assertKeyType(config, "model", "string")
})

test('10. "maxTokens": "" in settings.json leaves the numeric default intact', () => {
  const home = createTempHome()
  writeSettingsJson(home, { maxTokens: "" })
  const run = runDriver(home)
  const config = parseConfig(run, "empty string for a numeric key")

  assert.equal(
    config.maxTokens,
    BUILT_IN_DEFAULT_MAX_TOKENS,
    "an empty string must not overwrite a numeric key, because an untyped empty string would be sent as max_tokens and break the request",
  )
  assertKeyType(config, "maxTokens", "number")
})

test('11. WEBSEARCH_MAX_TOKENS="" leaves the numeric default intact and never becomes 0', () => {
  const home = createTempHome()
  const run = runDriver(home, [], { WEBSEARCH_MAX_TOKENS: "" })
  const config = parseConfig(run, "empty numeric variable")

  assert.equal(
    config.maxTokens,
    BUILT_IN_DEFAULT_MAX_TOKENS,
    "an empty numeric variable must not become 0, which is exactly what Number(\"\") would produce if the numeric guard were relaxed like the model guard",
  )
  assert.notEqual(
    config.maxTokens,
    0,
    "an empty WEBSEARCH_MAX_TOKENS must not be coerced to zero, because zero is a valid-looking value that would silently break requests",
  )
  assertKeyType(config, "maxTokens", "number")
})
