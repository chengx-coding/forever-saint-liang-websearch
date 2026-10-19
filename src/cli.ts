import { Command } from "commander"
import { readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

import { loadConfig } from "./config.js"
import { DeepSeekClient } from "./deepseek-client.js"
import { fetchPayload, searchPayload } from "./payload.js"
import { SearchStatsRecorder } from "./stats.js"

function getVersion(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  return (
    JSON.parse(
      readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
    ) as { version: string }
  ).version
}

function splitList(value: unknown): string[] | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined
  const items = value.split(",").map((item) => item.trim()).filter((item) => item !== "")
  return items.length > 0 ? items : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined
  if (value === true || value === "true" || value === "1" || value === "") return true
  if (value === false || value === "false" || value === "0") return false
  throw new Error(`Expected a boolean value, received ${JSON.stringify(value)}.`)
}

function requireApiKey(apiKey: string): void {
  if (apiKey) return
  console.error("API key required. Set DEEPSEEK_API_KEY, WEBSEARCH_API_KEY, or use --api-key=sk-...")
  process.exit(1)
}

export function createCli(): Command {
  const version = getVersion()

  const program = new Command()
  program
    .name("forever-saint-liang-websearch")
    .version(version)
    .description("Web search and page fetch via DeepSeek — MCP server with CLI mode")
    .allowUnknownOption()

  program
    .option("--api-key <key>", "DeepSeek API key")
    .option("--search-endpoint <url>", "DeepSeek Search API endpoint")
    .option("--fetch-endpoint <url>", "DeepSeek Fetch API endpoint")
    .option("--default-count <n>", "Default number of search results (1-50)")
    .option("--need-content [value]", "Default need_content flag for searches")
    .option("--fetch-max-chars <n>", "Maximum characters returned by fetch (1000-200000)")
    .option("--timeout-ms <n>", "Per-request timeout in milliseconds")
    .option("--tool-name <name>", "MCP tool name for web search")
    .option("--log-enabled", "Enable tool logging")
    .option("--log-dir <dir>", "Log directory")
    .option("--search-stats-enabled", "Enable search and fetch statistics")
    .option("--endpoint <url>", "[deprecated] old Anthropic messages endpoint")
    .option("--model <model>", "[deprecated] old model identifier")
    .option("--max-tokens <n>", "[deprecated] old output token limit")
    .option("--system-prompt <text>", "[deprecated] old research prompt")
    .option("--tool-type <type>", "[deprecated] old server-side tool type")
    .option("--max-uses <n>", "[deprecated] old search-call limit")

  program
    .command("search <query>")
    .allowUnknownOption()
    .allowExcessArguments()
    .description("Search the web and print JSON evidence")
    .option("--count <n>", "Number of results (1-50)")
    .option("--need-content [value]", "Return page content with each result")
    .option("--allowed-domains <domains>", "Comma-separated domains to include")
    .option("--blocked-domains <domains>", "Comma-separated domains to exclude")
    .option("--lang <codes>", "Comma-separated language codes, for example zh,en")
    .option("--after <date>", "Only pages after YYYY or YYYY-MM-DD")
    .option("--before <date>", "Only pages before YYYY or YYYY-MM-DD")
    .option("--ori-question <question>", "Original user question for query understanding")
    .option("--localization <ip>", "IPv4 or IPv6 address used to localize results")
    .action(async (query: string, opts: Record<string, unknown>) => {
      const configResult = loadConfig()
      const config = configResult.config
      requireApiKey(config.apiKey)

      const client = new DeepSeekClient(config)
      const stats = new SearchStatsRecorder(config.searchStatsEnabled, configResult.configDir)
      await stats.init()

      try {
        const response = await client.search({
          query,
          count: opts.count !== undefined ? Number(opts.count) : undefined,
          needContent: optionalBoolean(opts.needContent),
          allowedDomains: splitList(opts.allowedDomains),
          blockedDomains: splitList(opts.blockedDomains),
          lang: typeof opts.lang === "string" ? opts.lang : undefined,
          after: typeof opts.after === "string" ? opts.after : undefined,
          before: typeof opts.before === "string" ? opts.before : undefined,
          oriQuestion: typeof opts.oriQuestion === "string" ? opts.oriQuestion : undefined,
          localization: typeof opts.localization === "string" ? opts.localization : undefined,
        })
        stats.record("search")
        console.log(JSON.stringify(searchPayload(response), null, 2))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(JSON.stringify({ ok: false, error: { message } }))
        process.exit(1)
      } finally {
        stats.close()
      }
    })

  program
    .command("fetch <url>")
    .allowUnknownOption()
    .allowExcessArguments()
    .description("Fetch a page and print its Markdown content as JSON")
    .option("--max-chars <n>", "Maximum characters to return (1000-200000)")
    .action(async (url: string, opts: Record<string, unknown>) => {
      const configResult = loadConfig()
      const config = configResult.config
      requireApiKey(config.apiKey)

      const client = new DeepSeekClient(config)
      const stats = new SearchStatsRecorder(config.searchStatsEnabled, configResult.configDir)
      await stats.init()

      try {
        const response = await client.fetch(
          url,
          opts.maxChars !== undefined ? Number(opts.maxChars) : undefined,
        )
        stats.record("fetch")
        console.log(JSON.stringify(fetchPayload(response), null, 2))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(JSON.stringify({ ok: false, error: { message } }))
        process.exit(1)
      } finally {
        stats.close()
      }
    })

  program
    .command("stats [from] [to]")
    .allowUnknownOption()
    .allowExcessArguments()
    .description("Show hourly search and fetch statistics")
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

      if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
        console.error(
          `Invalid date(s): from="${from ?? "today"}", to="${to ?? "now"}"`,
        )
        process.exit(1)
      }

      try {
        const result = stats.queryStats(fromDate, toDate)

        if (!result.available) {
          console.error(result.unavailableReason ?? "Stats unavailable")
          process.exit(1)
        }

        console.log(
          JSON.stringify(
            {
              total_count: result.totalCount,
              search_count: result.searchCount,
              fetch_count: result.fetchCount,
              hours: result.records.length,
              range: `${fromDate.toISOString()} — ${toDate.toISOString()}`,
              records: result.records,
            },
            null,
            2,
          ),
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`Stats query failed: ${message}`)
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

export async function runCli(): Promise<void> {
  await createCli().parseAsync(process.argv)
}
