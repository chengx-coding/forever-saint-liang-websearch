export interface ToolConfig {
  /** MCP tool name exposed for web search. */
  name: string
}

export interface AppConfig {
  apiKey: string
  /** Full URL of the DeepSeek Search endpoint. */
  searchEndpoint: string
  /** Full URL of the DeepSeek Fetch endpoint. */
  fetchEndpoint: string
  /** Default number of search results (1-50). */
  defaultCount: number
  /** Default value for the need_content search flag. */
  needContent: boolean
  /** Maximum characters returned by web_fetch (1000-200000). */
  fetchMaxChars: number
  /** Per-request timeout in milliseconds (1000-120000). */
  timeoutMs: number
  tool: ToolConfig
  logEnabled: boolean
  logDir: string
  searchStatsEnabled: boolean
}

export interface SearchOptions {
  query: string
  count?: number
  needContent?: boolean
  allowedDomains?: string[]
  blockedDomains?: string[]
  lang?: string
  after?: string
  before?: string
  oriQuestion?: string
  localization?: string
}

export interface SearchResultItem {
  index: number
  title: string
  url: string
  snippet: string
  summary: string
  content?: string
  siteName: string | null
  siteIcon: string | null
  date: string | null
  authority: number
  rerankScore: number
}

export interface SearchResponse {
  query: string
  effectiveQuery: string
  count: number
  needContent: boolean
  results: SearchResultItem[]
}

export interface FetchResponse {
  url: string
  title: string
  content: string
  /** Original content length before any max_chars truncation. */
  contentLength: number
  truncated: boolean
}

export type ToolKind = "search" | "fetch"
