import { isIP } from "node:net"

import type {
  AppConfig,
  FetchResponse,
  SearchOptions,
  SearchResponse,
  SearchResultItem,
} from "./types.js"

const MAX_QUERY_LENGTH = 128
const MAX_ORI_QUESTION_LENGTH = 128
const MAX_FETCH_URL_LENGTH = 8_192
const MIN_FETCH_CHARS = 1_000
const MAX_FETCH_CHARS = 200_000
const MAX_RETRIES = 2
const RETRY_BASE_DELAY_MS = 500
const MAX_RETRY_DELAY_MS = 5_000

const USER_AGENT = "forever-saint-liang-websearch"

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504])

export interface SearchApiErrorOptions {
  status?: number
  code?: string
  retryable?: boolean
}

export class SearchApiError extends Error {
  readonly status: number | undefined
  readonly code: string
  readonly retryable: boolean

  constructor(message: string, options: SearchApiErrorOptions = {}) {
    super(message)
    this.name = "SearchApiError"
    this.status = options.status
    this.code = options.code ?? "request_failed"
    this.retryable = options.retryable ?? false
  }
}

interface SearchApiResult {
  rerank_score: number
  title: string
  url: string
  snippet: string
  summary: string
  content: string
  site_name: string | null
  site_icon: string | null
  date: string | null
  authority: number
}

interface SearchApiPayload {
  results: SearchApiResult[]
}

interface FetchApiPayload {
  title: string
  content: string
}

export interface DeepSeekClientDependencies {
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch
  /** Injected for tests; defaults to a real timer. */
  sleep?: (milliseconds: number) => Promise<void>
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function statusCodeFor(status: number): string {
  switch (status) {
    case 400:
      return "invalid_request"
    case 401:
      return "unauthorized"
    case 402:
      return "insufficient_balance"
    case 403:
      return "forbidden"
    case 404:
      return "not_found"
    case 408:
      return "timeout"
    case 413:
      return "payload_too_large"
    case 429:
      return "rate_limited"
    default:
      return status >= 500 ? "server_error" : "request_failed"
  }
}

function assertNonEmptyString(value: string, field: string): string {
  const trimmed = value.trim()
  if (trimmed === "") {
    throw new SearchApiError(`${field} must not be empty.`, { code: "invalid_request" })
  }
  return trimmed
}

function assertDomain(domain: string): string {
  const trimmed = domain.trim().toLowerCase()
  if (!/^[a-z0-9.-]+$/.test(trimmed) || trimmed.startsWith(".") || trimmed.endsWith(".")) {
    throw new SearchApiError(
      `allowed_domains/blocked_domains entry ${JSON.stringify(domain)} is not a bare domain (for example "example.com").`,
      { code: "invalid_request" },
    )
  }
  return trimmed
}

function assertLanguage(language: string): string {
  const trimmed = language.trim()
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]+)?(?:,[A-Za-z]{2,3}(?:-[A-Za-z0-9]+)?)*$/.test(trimmed)) {
    throw new SearchApiError(
      `lang must be comma-separated language codes such as "zh,en", received ${JSON.stringify(language)}.`,
      { code: "invalid_request" },
    )
  }
  return trimmed
}

function assertDate(value: string, field: string): string {
  const trimmed = value.trim()
  if (!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(trimmed)) {
    throw new SearchApiError(
      `${field} must be YYYY or YYYY-MM-DD, received ${JSON.stringify(value)}.`,
      { code: "invalid_request" },
    )
  }
  return trimmed
}

function assertCount(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 50) {
    throw new SearchApiError("count must be an integer between 1 and 50.", { code: "invalid_request" })
  }
  return value
}

function assertMaxChars(value: number): number {
  if (!Number.isInteger(value) || value < MIN_FETCH_CHARS || value > MAX_FETCH_CHARS) {
    throw new SearchApiError(
      `max_chars must be an integer between ${MIN_FETCH_CHARS} and ${MAX_FETCH_CHARS}.`,
      { code: "invalid_request" },
    )
  }
  return value
}

function assertFetchUrl(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length > MAX_FETCH_URL_LENGTH) {
    throw new SearchApiError(`url must be at most ${MAX_FETCH_URL_LENGTH} characters.`, { code: "invalid_request" })
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new SearchApiError("url must be a valid absolute HTTP or HTTPS URL.", { code: "invalid_request" })
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SearchApiError("url must use the http or https scheme.", { code: "invalid_request" })
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new SearchApiError("url must not contain a username or password.", { code: "invalid_request" })
  }
  return trimmed
}

export class DeepSeekClient {
  private readonly config: AppConfig
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (milliseconds: number) => Promise<void>

  constructor(config: AppConfig, dependencies: DeepSeekClientDependencies = {}) {
    this.config = config
    this.fetchImpl = dependencies.fetchImpl ?? fetch
    this.sleep = dependencies.sleep ?? defaultSleep
  }

  /**
   * Build the single query string the Search API receives. DeepSeek forwards the operators intact,
   * so structured filters are translated here rather than sent as separate request fields.
   */
  buildEffectiveQuery(options: SearchOptions): string {
    const base = assertNonEmptyString(options.query, "query")
    const parts: string[] = [base]

    if (options.allowedDomains?.length) {
      const sites = options.allowedDomains.map(assertDomain).map((domain) => `site:${domain}`)
      parts.push(sites.length === 1 ? sites[0] : sites.join(" OR "))
    }
    if (options.blockedDomains?.length) {
      parts.push(options.blockedDomains.map(assertDomain).map((domain) => `-site:${domain}`).join(" "))
    }
    if (options.lang) {
      parts.push(`lang:${assertLanguage(options.lang)}`)
    }
    if (options.after) {
      parts.push(`after:${assertDate(options.after, "after")}`)
    }
    if (options.before) {
      parts.push(`before:${assertDate(options.before, "before")}`)
    }

    const effective = parts.join(" ")
    if (effective.length > MAX_QUERY_LENGTH) {
      throw new SearchApiError(
        `The effective query is ${effective.length} characters, but DeepSeek accepts at most ${MAX_QUERY_LENGTH}. ` +
        "Shorten the query or remove some domain/language/date filters.",
        { code: "invalid_request" },
      )
    }
    return effective
  }

  async search(options: SearchOptions): Promise<SearchResponse> {
    const effectiveQuery = this.buildEffectiveQuery(options)
    const count = assertCount(options.count ?? this.config.defaultCount)
    const needContent = options.needContent ?? this.config.needContent

    let oriQuestion: string | undefined
    if (options.oriQuestion !== undefined) {
      oriQuestion = assertNonEmptyString(options.oriQuestion, "ori_question")
      if (oriQuestion.length > MAX_ORI_QUESTION_LENGTH) {
        throw new SearchApiError(
          `ori_question must be at most ${MAX_ORI_QUESTION_LENGTH} characters.`,
          { code: "invalid_request" },
        )
      }
    }

    let localization: string | undefined
    if (options.localization !== undefined) {
      localization = options.localization.trim()
      if (isIP(localization) === 0) {
        throw new SearchApiError(
          `localization must be an IPv4 or IPv6 address, received ${JSON.stringify(options.localization)}.`,
          { code: "invalid_request" },
        )
      }
    }

    const body: Record<string, unknown> = {
      query: effectiveQuery,
      count,
      need_content: needContent,
    }
    if (oriQuestion !== undefined) body.ori_question = oriQuestion
    if (localization !== undefined) body.localization = localization

    const payload = await this.post<SearchApiPayload>(this.config.searchEndpoint, body)
    if (!Array.isArray(payload.results)) {
      throw new SearchApiError("DeepSeek returned a search response without a results array.", {
        code: "invalid_response",
      })
    }

    const results: SearchResultItem[] = payload.results.map((item, index) => ({
      index,
      title: typeof item.title === "string" ? item.title : "",
      url: typeof item.url === "string" ? item.url : "",
      snippet: typeof item.snippet === "string" ? item.snippet : "",
      summary: typeof item.summary === "string" ? item.summary : "",
      ...(needContent && typeof item.content === "string" && item.content !== "" ? { content: item.content } : {}),
      siteName: typeof item.site_name === "string" ? item.site_name : null,
      siteIcon: typeof item.site_icon === "string" ? item.site_icon : null,
      date: typeof item.date === "string" ? item.date : null,
      authority: typeof item.authority === "number" ? item.authority : -1,
      rerankScore: typeof item.rerank_score === "number" ? item.rerank_score : 0,
    }))

    return {
      query: options.query,
      effectiveQuery,
      count,
      needContent,
      results,
    }
  }

  async fetch(url: string, maxChars: number = this.config.fetchMaxChars): Promise<FetchResponse> {
    const normalizedUrl = assertFetchUrl(url)
    const limit = assertMaxChars(maxChars)

    const payload = await this.post<FetchApiPayload>(this.config.fetchEndpoint, { url: normalizedUrl })
    if (typeof payload.content !== "string") {
      throw new SearchApiError("DeepSeek returned a fetch response without page content.", {
        code: "invalid_response",
      })
    }

    const contentLength = payload.content.length
    const truncated = contentLength > limit
    return {
      url: normalizedUrl,
      title: typeof payload.title === "string" ? payload.title : "",
      content: truncated ? payload.content.slice(0, limit) : payload.content,
      contentLength,
      truncated,
    }
  }

  private async post<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    let lastError: SearchApiError | undefined

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let response: Response
      try {
        response = await this.fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.config.timeoutMs),
        })
      } catch (error) {
        const timedOut = error instanceof Error && error.name === "TimeoutError"
        lastError = new SearchApiError(
          timedOut
            ? `DeepSeek request timed out after ${this.config.timeoutMs} ms.`
            : `Could not reach DeepSeek: ${error instanceof Error ? error.message : String(error)}`,
          { code: timedOut ? "timeout" : "network_error", retryable: true },
        )
        if (attempt < MAX_RETRIES) {
          await this.sleep(RETRY_BASE_DELAY_MS * 2 ** attempt)
          continue
        }
        throw lastError
      }

      if (response.ok) {
        try {
          return (await response.json()) as T
        } catch (error) {
          throw new SearchApiError(
            `DeepSeek returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
            { status: response.status, code: "invalid_response" },
          )
        }
      }

      const message = await this.readErrorMessage(response)
      const retryable = RETRYABLE_STATUSES.has(response.status)
      lastError = new SearchApiError(message, {
        status: response.status,
        code: statusCodeFor(response.status),
        retryable,
      })

      if (retryable && attempt < MAX_RETRIES) {
        await this.sleep(this.retryDelayMs(response, attempt))
        continue
      }
      throw lastError
    }

    throw lastError ?? new SearchApiError("DeepSeek request failed.", { code: "request_failed" })
  }

  private retryDelayMs(response: Response, attempt: number): number {
    const header = response.headers.get("retry-after")
    if (header) {
      const seconds = Number(header)
      if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(seconds * 1_000, MAX_RETRY_DELAY_MS)
      }
      const date = Date.parse(header)
      if (!Number.isNaN(date)) {
        return Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_DELAY_MS)
      }
    }
    return RETRY_BASE_DELAY_MS * 2 ** attempt
  }

  private async readErrorMessage(response: Response): Promise<string> {
    const fallback = `DeepSeek API error: ${response.status} ${response.statusText}`.trim()
    let text: string
    try {
      text = await response.text()
    } catch {
      return fallback
    }
    if (text === "") return fallback
    try {
      const parsed = JSON.parse(text) as { error?: { message?: unknown } }
      if (typeof parsed.error?.message === "string" && parsed.error.message !== "") {
        return parsed.error.message
      }
    } catch {
      // Not JSON: fall through to the raw body, bounded below.
    }
    return text.slice(0, 500)
  }
}
