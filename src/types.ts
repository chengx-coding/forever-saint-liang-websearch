export interface ToolConfig {
  name: string
  type: string
  max_uses?: number
  allowed_domains?: string[]
  blocked_domains?: string[]
  user_location?: {
    city?: string
    region?: string
    country?: string
    timezone?: string
  }
}

export interface AppConfig {
  apiKey: string
  endpoint: string
  model: string
  maxTokens: number
  systemPrompt: string
  tool: ToolConfig
  logEnabled: boolean
  logDir: string
  searchStatsEnabled: boolean
}

export interface DeepSeekWebSearchInput {
  query: string
}

export interface DeepSeekWebSearchToolResult {
  type: "web_search_tool_result"
  tool_use_id: string
  content: WebSearchResultItem[]
}

export interface WebSearchResultItem {
  type: "web_search_result"
  title: string
  url: string
  encrypted_content: string
  page_age: string | null
}

export interface DeepSeekApiResponse {
  id: string
  type: "message"
  role: "assistant"
  model: string
  content: DeepSeekContentBlock[]
  stop_reason: string
  usage: {
    input_tokens: number
    output_tokens: number
    server_tool_use?: {
      web_search_requests: number
    }
  }
}

export type DeepSeekContentBlock =
  | { type: "thinking"; thinking: string }
  | { type: "server_tool_use"; id: string; name: string; input: DeepSeekWebSearchInput }
  | DeepSeekWebSearchToolResult
  | { type: "text"; text: string }

export interface SearchResult {
  title: string
  url: string
  content: string
  pageAge: string | null
}

export interface SearchResponse {
  query: string
  results: SearchResult[]
  totalSearchRequests: number
  requestBody: Record<string, unknown>
}
