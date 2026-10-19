#!/usr/bin/env node

import { readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

import { serveStdio } from "@modelcontextprotocol/server/stdio"

import { loadConfig } from "./config.js"
import { DeepSeekClient } from "./deepseek-client.js"
import { ToolLogger } from "./logger.js"
import { buildServer } from "./server.js"
import { SearchStatsRecorder } from "./stats.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
) as { version: string }

function assertNodeVersion(): void {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10)
  if (!Number.isFinite(major) || major < 22) {
    console.error(
      `forever-saint-liang-websearch requires Node.js >= 22 (current: ${process.versions.node}). ` +
      "Upgrade Node.js and try again.",
    )
    process.exit(1)
  }
}

function detectCliMode(args: string[]): boolean {
  if (args.length === 0) return false

  const cliCommands = ["search", "fetch", "stats", "version", "help"]
  const cliFlags = ["--version", "--help", "-V", "-h"]

  return args.some(
    (arg) => cliCommands.includes(arg) || cliFlags.includes(arg),
  )
}

async function startMcpServer(): Promise<void> {
  const configResult = loadConfig()
  const config = configResult.config

  if (!config.apiKey) {
    console.error(
      "DEEPSEEK_API_KEY is required. Set it via:\n" +
      `  - User config file: ${configResult.configFilePath}\n` +
      "  - Environment variable: DEEPSEEK_API_KEY or WEBSEARCH_API_KEY\n" +
      "  - CLI argument: --api-key=sk-...",
    )
    process.exit(1)
  }

  const client = new DeepSeekClient(config)
  const logger = new ToolLogger(config.logEnabled, config.logDir)
  const stats = new SearchStatsRecorder(config.searchStatsEnabled, configResult.configDir)
  await stats.init()

  let closing = false
  const handle = serveStdio(() => buildServer({ config, client, logger, stats, version: pkg.version }))

  const shutdown = async (): Promise<void> => {
    if (closing) return
    closing = true
    try {
      await handle.close()
    } finally {
      stats.close()
    }
  }

  process.on("SIGINT", () => {
    void shutdown().finally(() => process.exit(0))
  })
  process.on("SIGTERM", () => {
    void shutdown().finally(() => process.exit(0))
  })
  process.on("exit", () => {
    stats.close()
  })
}

async function main(): Promise<void> {
  assertNodeVersion()

  const args = process.argv.slice(2)

  // CLI subcommands are dispatched before the API-key check so --version and --help work without
  // a configured key, exactly as a user expects from a command-line tool.
  if (detectCliMode(args)) {
    const { runCli } = await import("./cli.js")
    await runCli()
    return
  }

  await startMcpServer()
}

main().catch((error) => {
  console.error("Fatal error:", error)
  process.exit(1)
})
