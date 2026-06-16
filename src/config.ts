import { homedir } from "os"
import { join } from "path"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"

import type { AppConfig } from "./types.js"

const CONFIG_DIR_NAME = ".websearch-via-deepseek"
const CONFIG_FILE_NAME = "settings.json"

function getConfigDir(): string {
  return join(homedir(), CONFIG_DIR_NAME)
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
    messageContent: "web search",
    tool: {
      name: "web_search",
      type: "web_search_20260209",
      max_uses: 20,
    },
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
  if (process.env.WEBSEARCH_MESSAGE_CONTENT) config.messageContent = process.env.WEBSEARCH_MESSAGE_CONTENT

  const tool: Record<string, unknown> = {}
  if (process.env.WEBSEARCH_TOOL_NAME) tool.name = process.env.WEBSEARCH_TOOL_NAME
  if (process.env.WEBSEARCH_TOOL_TYPE) tool.type = process.env.WEBSEARCH_TOOL_TYPE
  if (process.env.WEBSEARCH_MAX_USES) tool.max_uses = Number(process.env.WEBSEARCH_MAX_USES)

  if (Object.keys(tool).length > 0) {
    config.tool = tool as AppConfig["tool"]
  }

  return config
}

function parseCliArgs(argv: string[]): Partial<AppConfig> {
  const config: Partial<AppConfig> = {}

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
      case "message-content":
        config.messageContent = value
        break
      case "tool-name":
        if (!config.tool) config.tool = {}
        config.tool.name = value
        break
      case "tool-type":
        if (!config.tool) config.tool = {}
        config.tool.type = value
        break
      case "max-uses":
        if (!config.tool) config.tool = {}
        config.tool.max_uses = Number(value)
        break
    }
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
