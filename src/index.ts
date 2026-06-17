#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

import { loadConfig } from "./config.js"
import { DeepSeekClient } from "./deepseek-client.js"
import { SearchLogger } from "./logger.js"
import { SearchStatsRecorder } from "./stats.js"
import type { SearchResult } from "./types.js"

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

const logger = new SearchLogger(config.logEnabled, config.logDir)

const stats = new SearchStatsRecorder(config.searchStatsEnabled, configResult.configDir)

const server = new McpServer({
  name: "forever-saint-liang-websearch",
  version: "0.1.3",
})

function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No results found."
  }

  return results
    .map(
      (r, i) =>
        `## ${i + 1}. [${r.title}](${r.url})\n${r.content}\n`,
    )
    .join("\n---\n")
}

server.registerTool(
  config.tool.name,
  {
    description:
      "Search the web using DeepSeek's built-in web search. Each search call returns ~10 results. Use max_uses to request additional keyword variations.",
    inputSchema: {
      query: z
        .string()
        .min(1)
        .max(500)
        .describe("Search query"),
      max_uses: z
        .number()
        .int()
        .min(1)
        .max(config.tool.max_uses ?? 20)
        .default(config.tool.max_uses ?? 20)
        .describe("Max number of search calls, each returning ~10 results."),
      allowed_domains: z
        .array(z.string())
        .optional()
        .describe("Only include results from these domains"),
      blocked_domains: z
        .array(z.string())
        .optional()
        .describe("Exclude results from these domains"),
      user_location: z
        .object({
          city: z.string().optional(),
          region: z.string().optional(),
          country: z.string().optional(),
          timezone: z.string().optional(),
        })
        .optional()
        .describe("Location for localized search results"),
    },
  },
  async (args) => {
    const { query, max_uses, allowed_domains, blocked_domains, user_location } = args

    try {
      const response = await client.search({
        query,
        maxUses: max_uses,
        allowedDomains: allowed_domains,
        blockedDomains: blocked_domains,
        userLocation: user_location,
      })

      logger.log(response)

      stats.recordSearch()

      const text = formatSearchResults(response.results)

      return {
        content: [
          {
            type: "text" as const,
            text: `# Search: "${response.query}"\n${response.totalSearchRequests} search call(s), ${response.results.length} result(s)\n\n${text}`,
          },
        ],
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        content: [{ type: "text" as const, text: `Search failed: ${message}` }],
        isError: true,
      }
    }
  },
)

server.registerTool(
  "web_search_stats",
  {
    description:
      "Query hourly search statistics. Returns per-hour search counts within a time range. If no time range is specified, defaults to today (from 00:00 to now).",
    inputSchema: {
      from: z
        .string()
        .datetime()
        .optional()
        .describe("Start of time range (ISO 8601 datetime). Defaults to today at 00:00:00."),
      to: z
        .string()
        .datetime()
        .optional()
        .describe("End of time range (ISO 8601 datetime). Defaults to now."),
    },
  },
  async (args) => {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)

    const from = args.from ? new Date(args.from) : todayStart
    const to = args.to ? new Date(args.to) : now

    try {
      const result = stats.queryStats(from, to)

      if (!result.available) {
        return {
          content: [
            {
              type: "text" as const,
              text: `# Search Stats: Unavailable\n\n${result.unavailableReason}`,
            },
          ],
        }
      }

      const lines: string[] = [
        `# Search Stats`,
        ``,
        `| Year | Month | Day | Hour | DoW | Count |`,
        `|------|-------|-----|------|-----|-------|`,
      ]

      const dowNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

      for (const r of result.records) {
        const pad = (n: number) => String(n).padStart(2, "0")
        lines.push(
          `| ${r.year} | ${pad(r.month)} | ${pad(r.day)} | ${pad(r.hour)} | ${dowNames[r.dayOfWeek]} | ${r.count} |`,
        )
      }

      lines.push(``)
      lines.push(`**Total**: ${result.totalCount} search(es) across ${result.records.length} hour(s)`)
      lines.push(
        `**Range**: ${from.toISOString()} — ${to.toISOString()}`,
      )

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        content: [{ type: "text" as const, text: `Search stats query failed: ${message}` }],
        isError: true,
      }
    }
  },
)

async function main() {
  await stats.init()

  process.on("exit", () => {
    stats.close()
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((error) => {
  console.error("Failed to start server:", error)
  process.exit(1)
})
