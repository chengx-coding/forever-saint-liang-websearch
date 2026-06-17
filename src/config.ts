import { homedir, tmpdir } from "os"
import { join } from "path"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"

import type { AppConfig } from "./types.js"

const CONFIG_DIR_NAME = ".websearch-via-deepseek"
const CONFIG_FILE_NAME = "settings.json"

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
    model: "deepseek-v4-flash",
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
  try {
    const filePath = getConfigFilePath()
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf-8")
      return JSON.parse(raw) as Partial<AppConfig>
    }
  } catch {
  }
  return {}
}

function loadEnvConfig(): Partial<AppConfig> {
  const config: Partial<AppConfig> = {}

  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.WEBSEARCH_API_KEY
  if (apiKey) config.apiKey = apiKey

  if (process.env.WEBSEARCH_ENDPOINT) config.endpoint = process.env.WEBSEARCH_ENDPOINT
  if (process.env.WEBSEARCH_MODEL) config.model = process.env.WEBSEARCH_MODEL
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
      if (val === undefined || val === "") continue
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
