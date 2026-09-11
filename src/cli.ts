import { Command } from "commander"
import { readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

import { loadConfig } from "./config.js"
import { DeepSeekClient } from "./deepseek-client.js"
import { SearchStatsRecorder } from "./stats.js"
import type { SearchResponse } from "./types.js"
import type { StatsQueryResult } from "./stats.js"

function getVersion(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  return (
    JSON.parse(
      readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
    ) as { version: string }
  ).version
}

export function createCli() {
  const version = getVersion()

  const program = new Command()
  program
    .name("forever-saint-liang-websearch")
    .version(version)
    .description(
      "Web search via DeepSeek — MCP server with CLI mode",
    )
    .allowUnknownOption()

  program
    .option("--api-key <key>", "DeepSeek API key")
    .option("--endpoint <url>", "API endpoint URL")
    .option("--model <model>", "Model name (default: deepseek-flash)")
    .option("--max-tokens <n>", "Max output tokens")
    .option("--system-prompt <text>", "System prompt")
    .option("--tool-name <name>", "MCP tool name")
    .option("--tool-type <type>", "DeepSeek tool type")
    .option("--max-uses <n>", "Max search calls per request")
    .option("--log-enabled", "Enable search logging")
    .option("--log-dir <dir>", "Log directory")
    .option("--search-stats-enabled", "Enable search statistics")

  program
    .command("search <query>")
    .allowUnknownOption()
    .allowExcessArguments()
    .description("Perform a web search")
    .action(async (query: string, _opts: unknown, _cmd: Command) => {
      const configResult = loadConfig()
      const config = configResult.config
      if (!config.apiKey) {
        console.error(
          "API key required. Set DEEPSEEK_API_KEY env var or use --api-key=sk-...",
        )
        process.exit(1)
      }

      const client = new DeepSeekClient(config)
      const stats = new SearchStatsRecorder(
        config.searchStatsEnabled,
        configResult.configDir,
      )
      await stats.init()

      try {
        const response: SearchResponse = await client.search({ query })
        stats.recordSearch()
        stats.close()
        const payload = {
          query: response.query,
          answer: response.answer,
          ...(response.thinking ? { thinking: response.thinking } : {}),
          search_queries: response.searchQueries,
          total_search_requests: response.totalSearchRequests,
          result_count: response.results.length,
          results: response.results.map((r) => ({
            index: r.index,
            title: r.title,
            url: r.url,
            page_age: r.pageAge,
            search_query: r.searchQuery ?? null,
            tool_use_id: r.toolUseId ?? null,
          })),
          model: response.model,
          stop_reason: response.stopReason,
          turns: response.turns,
          usage: {
            input_tokens: response.usage.inputTokens,
            output_tokens: response.usage.outputTokens,
            web_search_requests: response.usage.webSearchRequests,
          },
        }
        console.log(JSON.stringify(payload, null, 2))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(JSON.stringify({ ok: false, error: msg }))
        process.exit(1)
      }
    })

  program
    .command("stats [from] [to]")
    .allowUnknownOption()
    .allowExcessArguments()
    .description("Show search statistics")
    .action(async (from?: string, to?: string) => {
      const configResult = loadConfig()

      const stats = new SearchStatsRecorder(
        configResult.config.searchStatsEnabled,
        configResult.configDir,
      )
      await stats.init()

      const now = new Date()
      const todayStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        0,
        0,
        0,
      )
      const fromDate = from ? new Date(from) : todayStart
      const toDate = to ? new Date(to) : now

      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        console.error(
          `Invalid date(s): from="${from ?? "today"}", to="${to ?? "now"}"`,
        )
        process.exit(1)
      }

      try {
        const result: StatsQueryResult = stats.queryStats(fromDate, toDate)

        if (!result.available) {
          console.error(result.unavailableReason ?? "Stats unavailable")
          process.exit(1)
        }

        console.log(
          JSON.stringify(
            {
              totalCount: result.totalCount,
              hours: result.records.length,
              range: `${fromDate.toISOString()} — ${toDate.toISOString()}`,
              records: result.records,
            },
            null,
            2,
          ),
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`Stats query failed: ${msg}`)
        process.exit(1)
      } finally {
        stats.close()
      }
    })

  program.command("version").description("Show version number").action(() => {
    console.log(version)
  })

  program.command("help").description("Show help information").action(() => {
    program.outputHelp()
  })

  return program
}

export function runCli(): void {
  createCli().parse(process.argv)
}
