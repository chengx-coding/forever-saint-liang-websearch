[English](README.md) | [中文](README.zh-CN.md)

# Forever Saint Liang: Websearch MCP via Deepseek

An MCP server that exposes DeepSeek's Search and Fetch APIs to AI agents, plus a standalone CLI.

Forever indebted to Saint Liang.

> "Saint Liang" refers to Liang Wenfeng, founder of DeepSeek — named in honor of his work and DeepSeek's impact on the world.

## What it does

The server gives a model two primitives:

- **`web_search`** returns ranked evidence — title, URL, snippet, a long summary written for models,
  publication date, authority tier, relevance score, and optionally the page content.
- **`web_fetch`** turns one URL into Markdown so the model can read the full page.

The server does not generate an answer. The host model already does that; keeping the server as a
fast, deterministic search and fetch adapter avoids a second model call on every search.

## Prerequisites

- Node.js >= 22
- A DeepSeek API key from https://platform.deepseek.com

## Installation

```bash
npm install -g forever-saint-liang-websearch
```

On first run, a user config file is automatically created. The location depends on your platform:

- **Linux / macOS**: `~/.config/.websearch-via-deepseek/settings.json`
- **Windows**: `%USERPROFILE%\.config\.websearch-via-deepseek\settings.json`

## Quick Start

There are two ways to set your API key. Choose one:

### Option A: User config file (recommended)

Edit the user config file and fill in `apiKey`:

```json
{
  "apiKey": "sk-your-api-key"
}
```

Then configure your MCP client — no environment variable needed:

**OpenCode** (`opencode.json`):

```json
{
  "mcp": {
    "fsl-websearch": {
      "type": "local",
      "enabled": true,
      "command": ["npx", "forever-saint-liang-websearch"]
    }
  }
}
```

**Claude Code** (`claude_desktop_config.json` / `.mcp.json`):

```json
{
  "mcpServers": {
    "fsl-websearch": {
      "command": "npx",
      "args": ["forever-saint-liang-websearch"]
    }
  }
}
```

### Option B: Environment variable in MCP config

Set the API key directly in your MCP client configuration:

**OpenCode** (`opencode.json`):

```json
{
  "mcp": {
    "fsl-websearch": {
      "type": "local",
      "enabled": true,
      "command": ["npx", "forever-saint-liang-websearch"],
      "environment": {
        "DEEPSEEK_API_KEY": "sk-your-api-key"
      }
    }
  }
}
```

**Claude Code** (`claude_desktop_config.json` / `.mcp.json`):

```json
{
  "mcpServers": {
    "fsl-websearch": {
      "command": "npx",
      "args": ["forever-saint-liang-websearch"],
      "env": {
        "DEEPSEEK_API_KEY": "sk-your-api-key"
      }
    }
  }
}
```

The server speaks MCP `2026-07-28` and also serves older clients through the SDK's legacy handshake.

## Configuration

Configuration is loaded with the following priority (highest first):

1. **CLI arguments** — `--api-key=sk-... --default-count=10`
2. **Environment variables** — `WEBSEARCH_DEFAULT_COUNT`, `WEBSEARCH_SEARCH_ENDPOINT`, etc.
3. **User config file** — `settings.json` (see Installation for path per platform)
4. **Defaults** — built into the server

### Config file (`settings.json`)

```json
{
  "apiKey": "",
  "searchEndpoint": "https://api.deepseek.com/v1/tools/search",
  "fetchEndpoint": "https://api.deepseek.com/v1/tools/fetch",
  "defaultCount": 10,
  "needContent": false,
  "fetchMaxChars": 50000,
  "timeoutMs": 30000,
  "tool": {
    "name": "web_search"
  },
  "logEnabled": false,
  "logDir": "",
  "searchStatsEnabled": false
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `apiKey` | (empty) | DeepSeek API key |
| `searchEndpoint` | `https://api.deepseek.com/v1/tools/search` | DeepSeek Search API endpoint |
| `fetchEndpoint` | `https://api.deepseek.com/v1/tools/fetch` | DeepSeek Fetch API endpoint |
| `defaultCount` | `10` | Default number of search results (1–50) |
| `needContent` | `false` | Default `need_content` flag for searches |
| `fetchMaxChars` | `50000` | Maximum characters returned by `web_fetch` (1000–200000) |
| `timeoutMs` | `30000` | Per-request timeout in milliseconds (1000–120000) |
| `tool.name` | `"web_search"` | MCP tool name for search |
| `logEnabled` | `false` | Enable JSONL tool logging |
| `logDir` | OS temp directory | Log directory when logging is enabled; empty uses the OS temp directory |
| `searchStatsEnabled` | `false` | Enable hourly search/fetch statistics |

Out-of-range numbers are clamped, and invalid endpoint values fall back to the default; both
events produce a warning on **stderr**. stdout is reserved for the MCP stdio protocol.

### Deprecated keys (0.3.x and earlier)

The old server called DeepSeek's Anthropic-compatible `messages` endpoint with a server-side
`web_search` tool. That path is gone in `0.5.0`. These keys are still read and parsed, but they no
longer affect behavior:

| Deprecated key | Old meaning |
| --- | --- |
| `endpoint` | Anthropic messages endpoint |
| `model` | Model identifier |
| `maxTokens` | Output token limit |
| `systemPrompt` | Research prompt |
| `tool.type` | Server-side tool type (`web_search_20260209`) |
| `tool.max_uses` | Maximum searches per request |

When any of them is present, the server prints one warning naming the ignored keys and continues.
**Your `settings.json` is never rewritten or migrated** — remove the keys yourself when convenient.
The same applies to the old environment variables (`WEBSEARCH_ENDPOINT`, `WEBSEARCH_MODEL`,
`DEEPSEEK_MODEL`, `WEBSEARCH_MAX_TOKENS`, `WEBSEARCH_SYSTEM_PROMPT`, `WEBSEARCH_TOOL_TYPE`,
`WEBSEARCH_MAX_USES`) and CLI flags (`--endpoint`, `--model`, `--max-tokens`, `--system-prompt`,
`--tool-type`, `--max-uses`).

### Environment variables

| Variable | Equivalent config key |
|----------|----------------------|
| `DEEPSEEK_API_KEY` | `apiKey` |
| `WEBSEARCH_API_KEY` | `apiKey` (alternative) |
| `WEBSEARCH_SEARCH_ENDPOINT` | `searchEndpoint` |
| `WEBSEARCH_FETCH_ENDPOINT` | `fetchEndpoint` |
| `WEBSEARCH_DEFAULT_COUNT` | `defaultCount` |
| `WEBSEARCH_NEED_CONTENT` | `needContent` |
| `WEBSEARCH_FETCH_MAX_CHARS` | `fetchMaxChars` |
| `WEBSEARCH_TIMEOUT_MS` | `timeoutMs` |
| `WEBSEARCH_TOOL_NAME` | `tool.name` |
| `WEBSEARCH_LOG_ENABLED` | `logEnabled` |
| `WEBSEARCH_LOG_DIR` | `logDir` |
| `WEBSEARCH_SEARCH_STATS_ENABLED` | `searchStatsEnabled` |

### CLI arguments

```bash
forever-saint-liang-websearch --api-key=sk-... --default-count=10
```

| Argument | Config key |
|----------|-----------|
| `--api-key` | `apiKey` |
| `--search-endpoint` | `searchEndpoint` |
| `--fetch-endpoint` | `fetchEndpoint` |
| `--default-count` | `defaultCount` |
| `--need-content` | `needContent` |
| `--fetch-max-chars` | `fetchMaxChars` |
| `--timeout-ms` | `timeoutMs` |
| `--tool-name` | `tool.name` |
| `--log-enabled` | `logEnabled` |
| `--log-dir` | `logDir` |
| `--search-stats-enabled` | `searchStatsEnabled` |

## CLI Mode

The package also runs as a standalone CLI. When a subcommand is provided, it does not start the MCP
server:

```bash
# Search and print JSON evidence
forever-saint-liang-websearch search "TypeScript latest version"

# Search with filters
forever-saint-liang-websearch search "MCP spec" --allowed-domains=modelcontextprotocol.io --count=5

# Fetch a page as Markdown
forever-saint-liang-websearch fetch "https://modelcontextprotocol.io/specification/2026-07-28"

# View tool statistics
forever-saint-liang-websearch stats
forever-saint-liang-websearch stats 2026-06-01 2026-06-24

# Show version and help
forever-saint-liang-websearch --version
forever-saint-liang-websearch --help
```

All configuration flags work in CLI mode. Output is JSON on stdout; errors are JSON on stderr.

### CLI subcommands

| Command | Description |
|---------|-------------|
| `search <query>` | Search the web, output JSON evidence |
| `fetch <url>` | Fetch one page, output Markdown content as JSON |
| `stats [from] [to]` | Show hourly search and fetch statistics |
| `version` | Show version number |
| `help` | Show help information |

## Tool: `web_search`

Search the web with DeepSeek's Search API. Results are evidence, not an answer.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string (1–128) | Yes | — | Search query |
| `count` | number (1–50) | No | `defaultCount` | Number of results |
| `need_content` | boolean | No | `needContent` | Include page content in each result |
| `allowed_domains` | string[] | No | — | Only these bare domains (translated to `site:` operators) |
| `blocked_domains` | string[] | No | — | Exclude these domains (translated to `-site:` operators) |
| `lang` | string | No | — | Comma-separated language codes, e.g. `zh,en` |
| `after` | string | No | — | Only pages after `YYYY` or `YYYY-MM-DD` |
| `before` | string | No | — | Only pages before `YYYY` or `YYYY-MM-DD` |
| `ori_question` | string (1–128) | No | — | Original user question, for query understanding |
| `localization` | string | No | — | IPv4/IPv6 address used to localize results |

The query plus any generated operators must fit in **128 characters**. If it does not, the tool
returns an error explaining the limit; it never truncates silently.

Output:

```json
{
  "query": "DeepSeek V4",
  "effective_query": "DeepSeek V4 site:github.com",
  "count": 10,
  "need_content": false,
  "result_count": 1,
  "results": [
    {
      "index": 0,
      "title": "…",
      "url": "https://…",
      "snippet": "…",
      "summary": "…",
      "site_name": "…",
      "site_icon": "https://…",
      "date": "2026-10-17T00:00:00+00:00",
      "authority": 3,
      "rerank_score": 2.4
    }
  ]
}
```

`content` appears inside a result only when `need_content` is true and DeepSeek returned content.

## Tool: `web_fetch`

Fetch one page with DeepSeek's Fetch API and return its main content as Markdown.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | Yes | — | Absolute HTTP/HTTPS URL, at most 8192 characters |
| `max_chars` | number (1000–200000) | No | `fetchMaxChars` | Maximum characters to return |

Output:

```json
{
  "url": "https://…",
  "title": "…",
  "content": "# Markdown…",
  "content_length": 12345,
  "truncated": false
}
```

`content_length` is the original length before truncation.

## Tool: `web_search_stats`

Query hourly tool statistics from the local SQLite database. Available when
`searchStatsEnabled` is `true`.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `from` | string (ISO 8601) | No | Today 00:00 | Start of time range |
| `to` | string (ISO 8601) | No | Now | End of time range |

Output includes `total_count`, `search_count`, `fetch_count`, `record_count`, and per-hour records
with both counts. Existing `search_stats` databases are migrated automatically on first use.

## Upgrading from 0.3.x

`0.5.0` is a breaking release:

- The `answer` field is gone. `web_search` returns evidence; the host model writes the answer.
- `thinking`, `model`, `stop_reason`, `turns`, and token usage fields are gone.
- `max_uses` is replaced by `count` and is no longer part of the tool schema. `count` is a number of
  results, not a number of search calls; the old key is not repurposed.
- `user_location` is replaced by `localization`, which accepts an IP address.
- `query` is limited to 128 characters.
- The minimum Node.js version is 22.
- The MCP server now speaks `2026-07-28` and still serves legacy clients.
- The old `messages` backend and its config keys are deprecated; see above.

## Development

```bash
git clone https://github.com/chengx-coding/forever-saint-liang-websearch.git
cd forever-saint-liang-websearch
npm install
npm run dev
```

The verification gate is `npm run build` and `npm test`. `npm test` can report zero tests and still
exit zero, so check the printed pass count.

## Acknowledgments

This project is inspired by [websearch-deepseek](https://github.com/lyumeng/websearch-deepseek) by [lyumeng](https://github.com/lyumeng). Both projects are licensed under MIT.

## License

MIT
