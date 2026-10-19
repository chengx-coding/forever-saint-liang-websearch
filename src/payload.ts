import type { FetchResponse, SearchResponse } from "./types.js"

/** Public JSON shape shared by the MCP tools and the CLI. */
export function searchPayload(response: SearchResponse): Record<string, unknown> {
  return {
    query: response.query,
    effective_query: response.effectiveQuery,
    count: response.count,
    need_content: response.needContent,
    result_count: response.results.length,
    results: response.results.map((result) => ({
      index: result.index,
      title: result.title,
      url: result.url,
      snippet: result.snippet,
      summary: result.summary,
      ...(result.content !== undefined ? { content: result.content } : {}),
      site_name: result.siteName,
      site_icon: result.siteIcon,
      date: result.date,
      authority: result.authority,
      rerank_score: result.rerankScore,
    })),
  }
}

export function fetchPayload(response: FetchResponse): Record<string, unknown> {
  return {
    url: response.url,
    title: response.title,
    content: response.content,
    content_length: response.contentLength,
    truncated: response.truncated,
  }
}
