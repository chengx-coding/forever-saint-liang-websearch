import type {
  DeepSeekApiResponse,
  SearchResult,
  SearchResponse,
} from "./types.js"

const DEEPSEEK_API_BASE = "https://api.deepseek.com/anthropic/v1/messages"

export interface SearchOptions {
  query: string
  maxUses?: number
  timeRange?: string
  allowedDomains?: string[]
  blockedDomains?: string[]
  userLocation?: {
    city?: string
    region?: string
    country?: string
    timezone?: string
  }
  model?: string
}

export class DeepSeekClient {
  private apiKey: string
  private model: string

  constructor(apiKey: string, model = "deepseek-v4-flash") {
    this.apiKey = apiKey
    this.model = model
  }

  async search(options: SearchOptions): Promise<SearchResponse> {
    const {
      query,
      maxUses = 5,
      allowedDomains,
      blockedDomains,
      userLocation,
    } = options

    const toolDef: Record<string, unknown> = {
      type: "web_search_20260209",
      name: "web_search",
      max_uses: Math.min(Math.max(maxUses, 1), 20),
    }

    if (allowedDomains?.length) {
      toolDef.allowed_domains = allowedDomains
    }
    if (blockedDomains?.length) {
      toolDef.blocked_domains = blockedDomains
    }
    if (userLocation) {
      toolDef.user_location = {
        type: "approximate",
        ...userLocation,
      }
    }

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 4096,
      messages: [{ role: "user", content: query }],
      tools: [toolDef],
      tool_choice: { type: "auto" },
    }

    const response = await fetch(DEEPSEEK_API_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(
        `DeepSeek API error: ${response.status} ${response.statusText}`,
      )
    }

    const data = (await response.json()) as DeepSeekApiResponse

    return this.parseResponse(query, data)
  }

  private parseResponse(
    query: string,
    data: DeepSeekApiResponse,
  ): SearchResponse {
    const results: SearchResult[] = []
    let totalSearchRequests = 0

    if (data.usage?.server_tool_use?.web_search_requests) {
      totalSearchRequests = data.usage.server_tool_use.web_search_requests
    }

    for (const block of data.content) {
      if (block.type === "web_search_tool_result") {
        for (const item of block.content) {
          if (item.type === "web_search_result") {
            results.push({
              title: item.title,
              url: item.url,
              content: item.encrypted_content,
              pageAge: item.page_age,
            })
          }
        }
      }
    }

    return { query, results, totalSearchRequests }
  }
}
