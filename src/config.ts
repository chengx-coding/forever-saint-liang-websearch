import { homedir, tmpdir } from "os"
import { join } from "path"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"

import type { AppConfig } from "./types.js"

const CONFIG_DIR_NAME = ".websearch-via-deepseek"
const CONFIG_FILE_NAME = "settings.json"

// DeepSeek's current model name is deliberately version-free (`deepseek-flash` is the documented
// name for DeepSeek-V4.1-Flash), so the constant does not have to track every model release.
const DEFAULT_MODEL = "deepseek-flash"

// DeepSeek has retired the models these names refer to. Requests that still use them are only
// temporarily routed to the current model, so a persisted value must be treated as "unset" and
// resolution must fall through to the built-in default. The user's configuration file is never
// rewritten to make that happen.
const RETIRED_MODEL_ALIASES = new Set([
  "deepseek-v4-flash",
  "deepseek-v4-flash-vision-exp",
])

// Diagnostics go to stderr only. stdout carries the MCP stdio protocol, so writing anything
// there would corrupt the session.
function warnToStderr(message: string): void {
  process.stderr.write(message + "\n")
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function getConfigDir(): string {
  return join(homedir(), ".config", CONFIG_DIR_NAME)
}

function getConfigFilePath(): string {
  return join(getConfigDir(), CONFIG_FILE_NAME)
}

function getDefaultConfig(): AppConfig {
  return {
    apiKey: "",
    endpoint: "https://api.deepseek.com/anthropic/v1/messages",
    model: DEFAULT_MODEL,
    maxTokens: 32768,
    systemPrompt: "Use multiple keyword variations to conduct thorough research. Prioritize authoritative, verifiable sources. Provide comprehensive, well-cited answers.",
    tool: {
      name: "web_search",
      type: "web_search_20260209",
      max_uses: 20,
    },
    logEnabled: false,
    logDir: join(tmpdir(), "websearch-via-deepseek-logs"),
    searchStatsEnabled: false,
  }
}

function ensureUserConfig(): void {
  const dir = getConfigDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const filePath = getConfigFilePath()
  if (!existsSync(filePath)) {
    const defaults = getDefaultConfig()
    writeFileSync(filePath, JSON.stringify(defaults, null, 2) + "\n", "utf-8")
  }
}

function loadUserConfig(): Partial<AppConfig> {
  const filePath = getConfigFilePath()

  // A missing file is the normal first-run state, not a problem worth reporting.
  if (!existsSync(filePath)) return {}

  let raw: string
  try {
    raw = readFileSync(filePath, "utf-8")
  } catch (error) {
    warnToStderr(`[websearch-via-deepseek] Could not read ${filePath}: ${errorMessage(error)}`)
    return {}
  }

  let parsed: unknown
  try {
    // A leading UTF-8 BOM is invisible in most editors but makes JSON.parse throw, which would
    // silently discard the entire user configuration layer. Strip it before parsing.
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""))
  } catch (error) {
    warnToStderr(`[websearch-via-deepseek] Ignoring configuration at ${filePath}, it is not valid JSON: ${errorMessage(error)}`)
    return {}
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    warnToStderr(`[websearch-via-deepseek] Ignoring configuration at ${filePath}, it must contain a JSON object`)
    return {}
  }

  const config = parsed as Partial<AppConfig>

  // Normalisation runs after the BOM-tolerant parse on purpose: run first, a BOM-prefixed file
  // still holding a retired alias would be dropped wholesale and keep ignoring the new default.
  if (typeof config.model === "string" && RETIRED_MODEL_ALIASES.has(config.model.trim().toLowerCase())) {
    const ignored = config.model
    delete config.model
    warnToStderr(`[websearch-via-deepseek] Ignoring retired model "${ignored}" from ${filePath}; falling back to the built-in default instead. The file is left unchanged.`)
  }

  return config
}

function loadEnvConfig(): Partial<AppConfig> {
  const config: Partial<AppConfig> = {}

  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.WEBSEARCH_API_KEY
  if (apiKey) config.apiKey = apiKey

  if (process.env.WEBSEARCH_ENDPOINT) config.endpoint = process.env.WEBSEARCH_ENDPOINT

  // The model is the one variable read with `!== undefined`, so an explicitly empty
  // WEBSEARCH_MODEL propagates and clears the lower layer. `WEBSEARCH_MODEL` is canonical and
  // stays authoritative via `??`; `DEEPSEEK_MODEL` is the accepted legacy alias. Every other
  // read below keeps its truthiness guard, because `Number("")` is 0 and an empty numeric
  // variable must not silently become zero.
  const model = process.env.WEBSEARCH_MODEL ?? process.env.DEEPSEEK_MODEL
  if (model !== undefined) config.model = model

  if (process.env.WEBSEARCH_MAX_TOKENS) config.maxTokens = Number(process.env.WEBSEARCH_MAX_TOKENS)
  if (process.env.WEBSEARCH_SYSTEM_PROMPT) config.systemPrompt = process.env.WEBSEARCH_SYSTEM_PROMPT

  const tool: Record<string, unknown> = {}
  if (process.env.WEBSEARCH_TOOL_NAME) tool.name = process.env.WEBSEARCH_TOOL_NAME
  if (process.env.WEBSEARCH_TOOL_TYPE) tool.type = process.env.WEBSEARCH_TOOL_TYPE
  if (process.env.WEBSEARCH_MAX_USES) tool.max_uses = Number(process.env.WEBSEARCH_MAX_USES)

  if (Object.keys(tool).length > 0) {
    config.tool = tool as unknown as AppConfig["tool"]
  }

  if (process.env.WEBSEARCH_LOG_ENABLED !== undefined) {
    config.logEnabled = process.env.WEBSEARCH_LOG_ENABLED === "true" || process.env.WEBSEARCH_LOG_ENABLED === "1"
  }
  if (process.env.WEBSEARCH_LOG_DIR) {
    config.logDir = process.env.WEBSEARCH_LOG_DIR
  }

  if (process.env.WEBSEARCH_SEARCH_STATS_ENABLED !== undefined) {
    config.searchStatsEnabled = process.env.WEBSEARCH_SEARCH_STATS_ENABLED === "true" || process.env.WEBSEARCH_SEARCH_STATS_ENABLED === "1"
  }

  return config
}

function parseCliArgs(argv: string[]): Partial<AppConfig> {
  const config: Partial<AppConfig> = {}

  const toolConfig: Partial<AppConfig["tool"]> = {}

  for (const arg of argv) {
    if (!arg.startsWith("--")) continue

    const eqIndex = arg.indexOf("=")
    const key = eqIndex === -1 ? arg.slice(2) : arg.slice(2, eqIndex)
    const value = eqIndex === -1 ? "true" : arg.slice(eqIndex + 1)

    switch (key) {
      case "api-key":
        config.apiKey = value
        break
      case "endpoint":
        config.endpoint = value
        break
      case "model":
        config.model = value
        break
      case "max-tokens":
        config.maxTokens = Number(value)
        break
      case "system-prompt":
        config.systemPrompt = value
        break
      case "tool-name":
        toolConfig.name = value
        break
      case "tool-type":
        toolConfig.type = value
        break
      case "max-uses":
        toolConfig.max_uses = Number(value)
        break
      case "log-enabled":
        config.logEnabled = value === "true" || value === "1" || value === ""
        break
      case "log-dir":
        config.logDir = value
        break
      case "search-stats-enabled":
        config.searchStatsEnabled = value === "true" || value === "1" || value === ""
        break
    }
  }

  if (Object.keys(toolConfig).length > 0) {
    config.tool = toolConfig as AppConfig["tool"]
  }

  return config
}

function deepMerge<T extends Record<string, unknown>>(base: T, ...overrides: Partial<T>[]): T {
  const result = { ...base }
  for (const override of overrides) {
    for (const key of Object.keys(override) as (keyof T)[]) {
      const val = override[key]
      // `undefined` is the only value meaning "not specified". An empty string is a deliberate
      // clear, but only where the already-resolved value is a string: that lets `model`,
      // `endpoint`, `systemPrompt`, `apiKey` and `logDir` be emptied, while `maxTokens` (number)
      // and `logEnabled`/`searchStatsEnabled` (boolean) keep their previous value instead of
      // receiving an untyped empty string.
      if (val === undefined) continue
      if (val === "" && typeof result[key] !== "string") continue
      if (typeof val === "object" && val !== null && !Array.isArray(val)) {
        result[key] = deepMerge(
          (result[key] || {}) as Record<string, unknown>,
          val as Record<string, unknown>,
        ) as T[keyof T]
      } else {
        result[key] = val as T[keyof T]
      }
    }
  }
  return result
}

export interface ConfigResult {
  config: AppConfig
  configDir: string
  configFilePath: string
}

export function loadConfig(argv: string[] = process.argv.slice(2)): ConfigResult {
  ensureUserConfig()

  const defaults = getDefaultConfig()
  const userConfig = loadUserConfig()
  const envConfig = loadEnvConfig()
  const cliConfig = parseCliArgs(argv)

  const config = deepMerge(
    defaults as unknown as Record<string, unknown>,
    userConfig as unknown as Record<string, unknown>,
    envConfig as unknown as Record<string, unknown>,
    cliConfig as unknown as Record<string, unknown>,
  ) as unknown as AppConfig

  return {
    config,
    configDir: getConfigDir(),
    configFilePath: getConfigFilePath(),
  }
}
