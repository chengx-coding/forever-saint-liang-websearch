#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

import { DeepSeekClient } from "./deepseek-client.js"
import type { SearchResult } from "./types.js"

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY
if (!DEEPSEEK_API_KEY) {
  console.error("DEEPSEEK_API_KEY environment variable is required")
  process.exit(1)
}

const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash"

const client = new DeepSeekClient(DEEPSEEK_API_KEY, DEEPSEEK_MODEL)

const server = new McpServer({
  name: "forever-saint-liang",
  version: "1.0.0",
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
  "web_search",
  {
    description:
      "Search the web using DeepSeek's built-in web search. Each search call returns ~10 results. Use max_uses to increase result count via multiple keyword variations.",
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
        .max(20)
        .default(5)
        .describe("Max number of search calls, each returning ~10 results"),
      time_range: z
        .enum(["OneDay", "OneWeek", "OneMonth", "OneYear"])
        .optional()
        .describe("Filter results by time range"),
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
    const {
      query,
      max_uses,
      time_range,
      allowed_domains,
      blocked_domains,
      user_location,
    } = args

    try {
      const response = await client.search({
        query,
        maxUses: max_uses,
        timeRange: time_range,
        allowedDomains: allowed_domains,
        blockedDomains: blocked_domains,
        userLocation: user_location,
      })

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

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((error) => {
  console.error("Failed to start server:", error)
  process.exit(1)
})
