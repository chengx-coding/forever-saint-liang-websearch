import { McpServer } from "@modelcontextprotocol/server"
import * as z from "zod/v4"

import { DeepSeekClient, SearchApiError } from "./deepseek-client.js"
import type { ToolLogger } from "./logger.js"
import { fetchPayload, searchPayload } from "./payload.js"
import type { SearchStatsRecorder } from "./stats.js"
import type { AppConfig } from "./types.js"

export interface ServerDependencies {
  config: AppConfig
  client: DeepSeekClient
  logger: ToolLogger
  stats: SearchStatsRecorder
  version: string
}

function errorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof SearchApiError) {
    return {
      ok: false,
      error: {
        message: error.message,
        ...(error.status !== undefined ? { status: error.status } : {}),
        code: error.code,
        retryable: error.retryable,
      },
    }
  }
  return {
    ok: false,
    error: {
      message: error instanceof Error ? error.message : String(error),
      code: "internal_error",
      retryable: false,
    },
  }
}

function textResult(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  }
}

function errorResult(error: unknown): { content: Array<{ type: "text"; text: string }>; isError: true } {
  return {
    content: [{ type: "text", text: JSON.stringify(errorPayload(error), null, 2) }],
    isError: true,
  }
}

export function buildServer(dependencies: ServerDependencies): McpServer {
  const { config, client, logger, stats, version } = dependencies
  const server = new McpServer({
    name: "forever-saint-liang-websearch",
    version,
  })

  server.registerTool(
    config.tool.name,
    {
      title: "Web search",
      description:
        "Search the web with DeepSeek's Search API. Returns ranked, structured evidence: title, URL, " +
        "snippet, a long summary written for models, publication date, authority tier, and a relevance " +
        "score. Results are evidence, not an answer: synthesize and cite them yourself. Use web_fetch " +
        "when you need the full text of a specific result. The query plus any domain/language/date " +
        "filters must fit in 128 characters.",
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .max(128)
          .describe("Search query (1-128 characters). Prefer a few precise keywords."),
        count: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(config.defaultCount)
          .describe("Number of results to return (1-50). Defaults to the server configuration."),
        need_content: z
          .boolean()
          .default(config.needContent)
          .describe("Return page content with each result. Increases response size and latency."),
        allowed_domains: z
          .array(z.string())
          .optional()
          .describe("Only include results from these bare domains, for example [\"github.com\"]."),
        blocked_domains: z
          .array(z.string())
          .optional()
          .describe("Exclude results from these bare domains."),
        lang: z
          .string()
          .optional()
          .describe("Comma-separated language codes, for example \"zh,en\"."),
        after: z
          .string()
          .optional()
          .describe("Only pages published after this date: YYYY or YYYY-MM-DD."),
        before: z
          .string()
          .optional()
          .describe("Only pages published before this date: YYYY or YYYY-MM-DD."),
        ori_question: z
          .string()
          .min(1)
          .max(128)
          .optional()
          .describe("The original user question that triggered this search, for query understanding."),
        localization: z
          .string()
          .optional()
          .describe("IPv4 or IPv6 address used to localize results. Omit for neutral results."),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const response = await client.search({
          query: args.query,
          count: args.count,
          needContent: args.need_content,
          allowedDomains: args.allowed_domains,
          blockedDomains: args.blocked_domains,
          lang: args.lang,
          after: args.after,
          before: args.before,
          oriQuestion: args.ori_question,
          localization: args.localization,
        })
        logger.logSearch(response)
        stats.record("search")
        return textResult(searchPayload(response))
      } catch (error) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    "web_fetch",
    {
      title: "Fetch a web page",
      description:
        "Fetch one web page with DeepSeek's Fetch API and return its main content as Markdown. Use it " +
        "after web_search when a result needs full-text reading. The URL must be absolute HTTP or " +
        "HTTPS, at most 8192 characters, and must not contain a username or password. Content longer " +
        "than max_chars is truncated; content_length reports the original size.",
      inputSchema: z.object({
        url: z
          .string()
          .min(1)
          .max(8_192)
          .describe("Absolute HTTP or HTTPS URL of the page to fetch."),
        max_chars: z
          .number()
          .int()
          .min(1_000)
          .max(200_000)
          .default(config.fetchMaxChars)
          .describe("Maximum characters of Markdown to return (1000-200000)."),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const response = await client.fetch(args.url, args.max_chars)
        logger.logFetch(response)
        stats.record("fetch")
        return textResult(fetchPayload(response))
      } catch (error) {
        return errorResult(error)
      }
    },
  )

  server.registerTool(
    "web_search_stats",
    {
      title: "Search and fetch statistics",
      description:
        "Query hourly tool statistics from the local SQLite database. Returns per-hour search and " +
        "fetch counts within a time range. Defaults to today (from 00:00 to now). Available only when " +
        "searchStatsEnabled is true.",
      inputSchema: z.object({
        from: z
          .string()
          .optional()
          .describe("Start of the time range as an ISO 8601 date-time. Defaults to today at 00:00."),
        to: z
          .string()
          .optional()
          .describe("End of the time range as an ISO 8601 date-time. Defaults to now."),
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const now = new Date()
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
      const from = args.from ? new Date(args.from) : todayStart
      const to = args.to ? new Date(args.to) : now

      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        return errorResult(new SearchApiError("from/to must be valid ISO 8601 date-times.", { code: "invalid_request" }))
      }

      try {
        const result = stats.queryStats(from, to)
        if (!result.available) {
          return textResult({
            available: false,
            unavailable_reason: result.unavailableReason,
            range: { from: from.toISOString(), to: to.toISOString() },
          })
        }

        const dayOfWeekNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        return textResult({
          available: true,
          range: { from: from.toISOString(), to: to.toISOString() },
          total_count: result.totalCount,
          search_count: result.searchCount,
          fetch_count: result.fetchCount,
          record_count: result.records.length,
          records: result.records.map((record) => ({
            year: record.year,
            month: record.month,
            day: record.day,
            hour: record.hour,
            day_of_week: record.dayOfWeek,
            day_of_week_name: dayOfWeekNames[record.dayOfWeek],
            search_count: record.searchCount,
            fetch_count: record.fetchCount,
            total_count: record.totalCount,
          })),
        })
      } catch (error) {
        return errorResult(error)
      }
    },
  )

  return server
}
