import { tmpdir } from "os"
import { join } from "path"
import { appendFileSync, existsSync, mkdirSync } from "fs"
import { randomBytes } from "crypto"

import type { FetchResponse, SearchResponse } from "./types.js"

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0")
}

function generateFileName(): string {
  const now = new Date()
  const datePart = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join("-") +
    "T" +
    [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join("-") +
    "-" + pad(now.getMilliseconds(), 3)

  const hash = randomBytes(4).toString("hex")

  return `${datePart}_${hash}.jsonl`
}

/**
 * Writes one JSONL file per tool call. Search summaries and fetched page bodies are deliberately
 * not written: the log is for operational metadata, and duplicating full pages would turn it into
 * an uncontrolled copy of arbitrary web content.
 */
export class ToolLogger {
  private enabled: boolean
  private logDir: string

  constructor(enabled: boolean, logDir: string) {
    this.enabled = enabled
    this.logDir = logDir
  }

  logSearch(response: SearchResponse): void {
    this.write({
      type: "search",
      timestamp: new Date().toISOString(),
      query: response.query,
      effectiveQuery: response.effectiveQuery,
      count: response.count,
      needContent: response.needContent,
      resultCount: response.results.length,
      results: response.results.map((result) => ({
        index: result.index,
        title: result.title,
        url: result.url,
        date: result.date,
        authority: result.authority,
        rerankScore: result.rerankScore,
      })),
    })
  }

  logFetch(response: FetchResponse): void {
    this.write({
      type: "fetch",
      timestamp: new Date().toISOString(),
      url: response.url,
      title: response.title,
      contentLength: response.contentLength,
      truncated: response.truncated,
    })
  }

  static defaultLogDir(): string {
    return join(tmpdir(), "websearch-via-deepseek-logs")
  }

  private write(entry: Record<string, unknown>): void {
    if (!this.enabled) return

    try {
      if (!existsSync(this.logDir)) {
        mkdirSync(this.logDir, { recursive: true })
      }
      appendFileSync(join(this.logDir, generateFileName()), JSON.stringify(entry) + "\n", "utf-8")
    } catch {
      // Logging must never affect the main flow.
    }
  }
}
