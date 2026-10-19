import { homedir, tmpdir } from "os"
import { join } from "path"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"

import type { AppConfig } from "./types.js"

const CONFIG_DIR_NAME = ".websearch-via-deepseek"
const CONFIG_FILE_NAME = "settings.json"

const DEFAULT_SEARCH_ENDPOINT = "https://api.deepseek.com/v1/tools/search"
const DEFAULT_FETCH_ENDPOINT = "https://api.deepseek.com/v1/tools/fetch"
const DEFAULT_COUNT = 10
const DEFAULT_FETCH_MAX_CHARS = 50_000
const DEFAULT_TIMEOUT_MS = 30_000

const DEPRECATED_CONFIG_KEYS = ["endpoint", "model", "maxTokens", "systemPrompt"] as const
const DEPRECATED_TOOL_KEYS = ["type", "max_uses"] as const
const DEPRECATED_ENV_KEYS = [
  "WEBSEARCH_ENDPOINT",
  "WEBSEARCH_MODEL",
  "DEEPSEEK_MODEL",
  "WEBSEARCH_MAX_TOKENS",
  "WEBSEARCH_SYSTEM_PROMPT",
  "WEBSEARCH_TOOL_TYPE",
  "WEBSEARCH_MAX_USES",
] as const
const DEPRECATED_CLI_KEYS = new Set([
  "endpoint",
  "model",
  "max-tokens",
  "system-prompt",
  "tool-type",
  "max-uses",
])

interface PartialLoad {
  config: Partial<AppConfig>
  legacyKeys: string[]
}

// Diagnostics go to stderr only. stdout carries the MCP stdio protocol, so writing anything
// there would corrupt the session.
function warnToStderr(message: string): void {
  process.stderr.write(message + "\n")
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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
    searchEndpoint: DEFAULT_SEARCH_ENDPOINT,
    fetchEndpoint: DEFAULT_FETCH_ENDPOINT,
    defaultCount: DEFAULT_COUNT,
    needContent: false,
    fetchMaxChars: DEFAULT_FETCH_MAX_CHARS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    tool: {
      name: "web_search",
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

function loadUserConfig(): PartialLoad {
  const filePath = getConfigFilePath()

  // A missing file is the normal first-run state, not a problem worth reporting.
  if (!existsSync(filePath)) return { config: {}, legacyKeys: [] }

  let raw: string
  try {
    raw = readFileSync(filePath, "utf-8")
  } catch (error) {
    warnToStderr(`[websearch-via-deepseek] Could not read ${filePath}: ${errorMessage(error)}`)
    return { config: {}, legacyKeys: [] }
  }

  let parsed: unknown
  try {
    // A leading UTF-8 BOM is invisible in most editors but makes JSON.parse throw, which would
    // silently discard the entire user configuration layer. Strip it before parsing.
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""))
  } catch (error) {
    warnToStderr(`[websearch-via-deepseek] Ignoring configuration at ${filePath}, it is not valid JSON: ${errorMessage(error)}`)
    return { config: {}, legacyKeys: [] }
  }

  if (!isRecord(parsed)) {
    warnToStderr(`[websearch-via-deepseek] Ignoring configuration at ${filePath}, it must contain a JSON object`)
    return { config: {}, legacyKeys: [] }
  }

  const legacyKeys: string[] = []
  for (const key of DEPRECATED_CONFIG_KEYS) {
    if (key in parsed) legacyKeys.push(key)
  }

  if (isRecord(parsed.tool)) {
    for (const key of DEPRECATED_TOOL_KEYS) {
      if (key in parsed.tool) legacyKeys.push(`tool.${key}`)
    }
  }

  // Deprecated keys are not merely ignored by the readers: they are removed here so the merged
  // configuration object cannot carry values that no longer describe the process.
  for (const key of DEPRECATED_CONFIG_KEYS) {
    delete parsed[key]
  }
  if (isRecord(parsed.tool)) {
    for (const key of DEPRECATED_TOOL_KEYS) {
      delete parsed.tool[key]
    }
  }

  return { config: parsed as Partial<AppConfig>, legacyKeys }
}

function loadEnvConfig(): PartialLoad {
  const config: Partial<AppConfig> = {}
  const legacyKeys: string[] = []

  for (const key of DEPRECATED_ENV_KEYS) {
    if (process.env[key] !== undefined) legacyKeys.push(key)
  }

  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.WEBSEARCH_API_KEY
  if (apiKey) config.apiKey = apiKey

  if (process.env.WEBSEARCH_SEARCH_ENDPOINT) config.searchEndpoint = process.env.WEBSEARCH_SEARCH_ENDPOINT
  if (process.env.WEBSEARCH_FETCH_ENDPOINT) config.fetchEndpoint = process.env.WEBSEARCH_FETCH_ENDPOINT
  if (process.env.WEBSEARCH_DEFAULT_COUNT) config.defaultCount = Number(process.env.WEBSEARCH_DEFAULT_COUNT)
  if (process.env.WEBSEARCH_NEED_CONTENT !== undefined) {
    config.needContent = process.env.WEBSEARCH_NEED_CONTENT === "true" || process.env.WEBSEARCH_NEED_CONTENT === "1"
  }
  if (process.env.WEBSEARCH_FETCH_MAX_CHARS) config.fetchMaxChars = Number(process.env.WEBSEARCH_FETCH_MAX_CHARS)
  if (process.env.WEBSEARCH_TIMEOUT_MS) config.timeoutMs = Number(process.env.WEBSEARCH_TIMEOUT_MS)

  if (process.env.WEBSEARCH_TOOL_NAME) config.tool = { name: process.env.WEBSEARCH_TOOL_NAME }

  if (process.env.WEBSEARCH_LOG_ENABLED !== undefined) {
    config.logEnabled = process.env.WEBSEARCH_LOG_ENABLED === "true" || process.env.WEBSEARCH_LOG_ENABLED === "1"
  }
  if (process.env.WEBSEARCH_LOG_DIR) {
    config.logDir = process.env.WEBSEARCH_LOG_DIR
  }

  if (process.env.WEBSEARCH_SEARCH_STATS_ENABLED !== undefined) {
    config.searchStatsEnabled = process.env.WEBSEARCH_SEARCH_STATS_ENABLED === "true" || process.env.WEBSEARCH_SEARCH_STATS_ENABLED === "1"
  }

  return { config, legacyKeys }
}

function parseCliArgs(argv: string[]): PartialLoad {
  const config: Partial<AppConfig> = {}
  const toolConfig: Partial<AppConfig["tool"]> = {}
  const legacyKeys: string[] = []

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (!arg.startsWith("--")) continue

    const eqIndex = arg.indexOf("=")
    const key = eqIndex === -1 ? arg.slice(2) : arg.slice(2, eqIndex)
    let value = eqIndex === -1 ? "true" : arg.slice(eqIndex + 1)

    if (eqIndex === -1) {
      const next = argv[index + 1]
      if (next !== undefined && !next.startsWith("--")) {
        value = next
        index++
      }
    }

    if (DEPRECATED_CLI_KEYS.has(key)) {
      legacyKeys.push(`--${key}`)
      continue
    }

    switch (key) {
      case "api-key":
        config.apiKey = value
        break
      case "search-endpoint":
        config.searchEndpoint = value
        break
      case "fetch-endpoint":
        config.fetchEndpoint = value
        break
      case "default-count":
        config.defaultCount = Number(value)
        break
      case "need-content":
        config.needContent = value === "true" || value === "1" || value === ""
        break
      case "fetch-max-chars":
        config.fetchMaxChars = Number(value)
        break
      case "timeout-ms":
        config.timeoutMs = Number(value)
        break
      case "tool-name":
        toolConfig.name = value
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

  return { config, legacyKeys }
}

function deepMerge<T extends Record<string, unknown>>(base: T, ...overrides: Partial<T>[]): T {
  const result = { ...base }
  for (const override of overrides) {
    for (const key of Object.keys(override) as (keyof T)[]) {
      const val = override[key]
      // `undefined` is the only value meaning "not specified". An empty string is a deliberate
      // clear, but only where the already-resolved value is a string: that lets string keys be
      // emptied, while numeric and boolean keys keep their previous value instead of receiving
      // an untyped empty string.
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

function warnInvalid(key: string, value: unknown, fallback: string): void {
  warnToStderr(
    `[websearch-via-deepseek] Ignoring invalid ${key} value ${JSON.stringify(value)}; using ${fallback}.`,
  )
}

function parseInteger(value: unknown, min: number, max: number, fallback: number, key: string): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN
  if (!Number.isFinite(numeric)) {
    warnInvalid(key, value, String(fallback))
    return fallback
  }
  const integer = Math.trunc(numeric)
  if (integer < min || integer > max) {
    const clamped = Math.min(Math.max(integer, min), max)
    warnToStderr(`[websearch-via-deepseek] ${key} ${integer} is outside ${min}-${max}; using ${clamped}.`)
    return clamped
  }
  return integer
}

function parseBoolean(value: unknown, fallback: boolean, key: string): boolean {
  if (typeof value === "boolean") return value
  if (value === "true" || value === "1") return true
  if (value === "false" || value === "0") return false
  warnInvalid(key, value, String(fallback))
  return fallback
}

function parseEndpoint(value: unknown, fallback: string, key: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    warnInvalid(key, value, fallback)
    return fallback
  }
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      warnInvalid(key, value, fallback)
      return fallback
    }
    return value
  } catch {
    warnInvalid(key, value, fallback)
    return fallback
  }
}

function parseString(value: unknown, fallback: string, key: string): string {
  if (typeof value !== "string" || value === "") {
    warnInvalid(key, value, fallback)
    return fallback
  }
  return value
}

function normalizeConfig(raw: AppConfig): AppConfig {
  const defaults = getDefaultConfig()
  const tool: Record<string, unknown> = isRecord(raw.tool) ? raw.tool : {}

  return {
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "",
    searchEndpoint: parseEndpoint(raw.searchEndpoint, defaults.searchEndpoint, "searchEndpoint"),
    fetchEndpoint: parseEndpoint(raw.fetchEndpoint, defaults.fetchEndpoint, "fetchEndpoint"),
    defaultCount: parseInteger(raw.defaultCount, 1, 50, defaults.defaultCount, "defaultCount"),
    needContent: parseBoolean(raw.needContent, defaults.needContent, "needContent"),
    fetchMaxChars: parseInteger(raw.fetchMaxChars, 1_000, 200_000, defaults.fetchMaxChars, "fetchMaxChars"),
    timeoutMs: parseInteger(raw.timeoutMs, 1_000, 120_000, defaults.timeoutMs, "timeoutMs"),
    tool: {
      name: parseString(tool.name, defaults.tool.name, "tool.name"),
    },
    logEnabled: parseBoolean(raw.logEnabled, defaults.logEnabled, "logEnabled"),
    logDir: typeof raw.logDir === "string" && raw.logDir !== "" ? raw.logDir : defaults.logDir,
    searchStatsEnabled: parseBoolean(raw.searchStatsEnabled, defaults.searchStatsEnabled, "searchStatsEnabled"),
  }
}

export interface ConfigResult {
  config: AppConfig
  configDir: string
  configFilePath: string
  legacyKeys: string[]
}

export function loadConfig(argv: string[] = process.argv.slice(2)): ConfigResult {
  ensureUserConfig()

  const defaults = getDefaultConfig()
  const user = loadUserConfig()
  const env = loadEnvConfig()
  const cli = parseCliArgs(argv)

  const merged = deepMerge(
    defaults as unknown as Record<string, unknown>,
    user.config as unknown as Record<string, unknown>,
    env.config as unknown as Record<string, unknown>,
    cli.config as unknown as Record<string, unknown>,
  ) as unknown as AppConfig

  const legacyKeys = [...new Set([...user.legacyKeys, ...env.legacyKeys, ...cli.legacyKeys])].sort()

  if (legacyKeys.length > 0) {
    warnToStderr(
      `[websearch-via-deepseek] Ignoring deprecated configuration keys: ${legacyKeys.join(", ")}. ` +
      "The Search/Fetch backend no longer uses them; see the README migration notes.",
    )
  }

  return {
    config: normalizeConfig(merged),
    configDir: getConfigDir(),
    configFilePath: getConfigFilePath(),
    legacyKeys,
  }
}
