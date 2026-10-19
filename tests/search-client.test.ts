import assert from "node:assert/strict"
import test from "node:test"

import { DeepSeekClient, SearchApiError } from "../src/deepseek-client.js"
import type { AppConfig } from "../src/types.js"

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    apiKey: "sk-test",
    searchEndpoint: "https://api.example.test/v1/tools/search",
    fetchEndpoint: "https://api.example.test/v1/tools/fetch",
    defaultCount: 10,
    needContent: false,
    fetchMaxChars: 50_000,
    timeoutMs: 30_000,
    tool: { name: "web_search" },
    logEnabled: false,
    logDir: "/tmp/logs",
    searchStatsEnabled: false,
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  })
}

interface FetchCall {
  url: string
  body: Record<string, unknown>
}

function recordingFetch(responses: Array<() => Response>): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  let index = 0
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    })
    const next = responses[Math.min(index, responses.length - 1)]
    index++
    return next()
  }) as typeof fetch
  return { fetchImpl, calls }
}

const sampleResult = {
  rerank_score: 2.4,
  title: "DeepSeek Search",
  url: "https://example.com/search",
  snippet: "short",
  summary: "long summary",
  content: "full page content",
  site_name: "Example",
  site_icon: "https://example.com/favicon.ico",
  date: "2026-10-17T00:00:00+00:00",
  authority: 3,
}

test("buildEffectiveQuery translates structured filters into DeepSeek operators", () => {
  const client = new DeepSeekClient(makeConfig())

  const query = client.buildEffectiveQuery({
    query: "deepseek",
    allowedDomains: ["github.com", "huggingface.co"],
    blockedDomains: ["example.com"],
    lang: "zh,en",
    after: "2025",
    before: "2026-06-01",
  })

  assert.equal(
    query,
    "deepseek site:github.com OR site:huggingface.co -site:example.com lang:zh,en after:2025 before:2026-06-01",
  )
})

test("buildEffectiveQuery rejects an effective query longer than 128 characters", () => {
  const client = new DeepSeekClient(makeConfig())

  assert.throws(
    () => client.buildEffectiveQuery({ query: "x".repeat(120), lang: "zh,en" }),
    (error: unknown) => error instanceof SearchApiError && error.code === "invalid_request" && /128/.test(error.message),
  )
})

test("buildEffectiveQuery rejects malformed domain filters instead of sending them", () => {
  const client = new DeepSeekClient(makeConfig())

  assert.throws(
    () => client.buildEffectiveQuery({ query: "deepseek", allowedDomains: ["not a domain"] }),
    (error: unknown) => error instanceof SearchApiError && error.code === "invalid_request",
  )
})

test("search sends the documented request body and maps the response", async () => {
  const { fetchImpl, calls } = recordingFetch([() => jsonResponse({ results: [sampleResult] })])
  const client = new DeepSeekClient(makeConfig(), { fetchImpl })

  const response = await client.search({ query: "deepseek", count: 3, needContent: false })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, "https://api.example.test/v1/tools/search")
  assert.deepEqual(calls[0].body, { query: "deepseek", count: 3, need_content: false })
  assert.equal(response.effectiveQuery, "deepseek")
  assert.equal(response.count, 3)
  assert.equal(response.needContent, false)
  assert.equal(response.results.length, 1)
  assert.equal(response.results[0].title, "DeepSeek Search")
  assert.equal(response.results[0].authority, 3)
  assert.equal(response.results[0].rerankScore, 2.4)
  assert.equal(response.results[0].siteName, "Example")
  assert.equal("content" in response.results[0], false, "content is omitted unless need_content is true")
})

test("search includes content when need_content is true", async () => {
  const { fetchImpl } = recordingFetch([() => jsonResponse({ results: [sampleResult] })])
  const client = new DeepSeekClient(makeConfig({ needContent: true }), { fetchImpl })

  const response = await client.search({ query: "deepseek" })

  assert.equal(response.needContent, true)
  assert.equal(response.results[0].content, "full page content")
})

test("search forwards ori_question and an IPv4 localization", async () => {
  const { fetchImpl, calls } = recordingFetch([() => jsonResponse({ results: [] })])
  const client = new DeepSeekClient(makeConfig(), { fetchImpl })

  await client.search({
    query: "deepseek",
    oriQuestion: "What is DeepSeek?",
    localization: "203.0.113.7",
  })

  assert.equal(calls[0].body.ori_question, "What is DeepSeek?")
  assert.equal(calls[0].body.localization, "203.0.113.7")
})

test("search rejects a localization that is not an IP address", async () => {
  const client = new DeepSeekClient(makeConfig())

  await assert.rejects(
    () => client.search({ query: "deepseek", localization: "Shanghai" }),
    (error: unknown) => error instanceof SearchApiError && error.code === "invalid_request",
  )
})

test("fetch maps title and content", async () => {
  const { fetchImpl, calls } = recordingFetch([
    () => jsonResponse({ title: "Example", content: "# Hello\n\nWorld" }),
  ])
  const client = new DeepSeekClient(makeConfig(), { fetchImpl })

  const response = await client.fetch("https://example.com/article", 10_000)

  assert.equal(calls[0].url, "https://api.example.test/v1/tools/fetch")
  assert.deepEqual(calls[0].body, { url: "https://example.com/article" })
  assert.equal(response.title, "Example")
  assert.equal(response.content, "# Hello\n\nWorld")
  assert.equal(response.contentLength, 14)
  assert.equal(response.truncated, false)
})

test("fetch truncates at max_chars and reports the original length", async () => {
  const content = "a".repeat(1_200)
  const { fetchImpl } = recordingFetch([() => jsonResponse({ title: "Long", content })])
  const client = new DeepSeekClient(makeConfig(), { fetchImpl })

  const response = await client.fetch("https://example.com/long", 1_000)

  assert.equal(response.content.length, 1_000)
  assert.equal(response.contentLength, 1_200)
  assert.equal(response.truncated, true)
})

test("fetch rejects a non-HTTP URL before making a request", async () => {
  const { fetchImpl, calls } = recordingFetch([() => jsonResponse({ title: "", content: "" })])
  const client = new DeepSeekClient(makeConfig(), { fetchImpl })

  await assert.rejects(
    () => client.fetch("file:///etc/passwd"),
    (error: unknown) => error instanceof SearchApiError && error.code === "invalid_request",
  )
  assert.equal(calls.length, 0)
})

test("a 401 is not retried and carries the API error message", async () => {
  const { fetchImpl, calls } = recordingFetch([
    () => jsonResponse({ error: { message: "invalid api key" } }, 401),
  ])
  const client = new DeepSeekClient(makeConfig(), { fetchImpl, sleep: async () => {} })

  await assert.rejects(
    () => client.search({ query: "deepseek" }),
    (error: unknown) =>
      error instanceof SearchApiError &&
      error.status === 401 &&
      error.code === "unauthorized" &&
      error.retryable === false &&
      /invalid api key/.test(error.message),
  )
  assert.equal(calls.length, 1)
})

test("a 500 is retried and can succeed on the next attempt", async () => {
  const { fetchImpl, calls } = recordingFetch([
    () => jsonResponse({ error: { message: "server error" } }, 500),
    () => jsonResponse({ results: [sampleResult] }),
  ])
  const client = new DeepSeekClient(makeConfig(), { fetchImpl, sleep: async () => {} })

  const response = await client.search({ query: "deepseek" })

  assert.equal(calls.length, 2)
  assert.equal(response.results.length, 1)
})

test("a 429 honours Retry-After before the retry", async () => {
  const delays: number[] = []
  const { fetchImpl } = recordingFetch([
    () => jsonResponse({ error: { message: "slow down" } }, 429, { "retry-after": "2" }),
    () => jsonResponse({ results: [] }),
  ])
  const client = new DeepSeekClient(makeConfig(), {
    fetchImpl,
    sleep: async (milliseconds) => {
      delays.push(milliseconds)
    },
  })

  await client.search({ query: "deepseek" })

  assert.deepEqual(delays, [2_000])
})

test("a request that stays 500 after retries fails with a retryable server error", async () => {
  const { fetchImpl, calls } = recordingFetch([
    () => jsonResponse({ error: { message: "server error" } }, 500),
    () => jsonResponse({ error: { message: "server error" } }, 500),
    () => jsonResponse({ error: { message: "server error" } }, 500),
  ])
  const client = new DeepSeekClient(makeConfig(), { fetchImpl, sleep: async () => {} })

  await assert.rejects(
    () => client.search({ query: "deepseek" }),
    (error: unknown) =>
      error instanceof SearchApiError && error.status === 500 && error.code === "server_error" && error.retryable,
  )
  assert.equal(calls.length, 3)
})
