[English](README.md) | [中文](README.zh-CN.md)

# Forever Saint Liang: Websearch MCP via Deepseek

An MCP server that provides web search capabilities using DeepSeek's Anthropic-compatible API.

Forever indebted to Saint Liang.

> "Saint Liang" refers to Liang Wenfeng, founder of DeepSeek — named in honor of his work and DeepSeek's impact on the world.

## Prerequisites

- Node.js >= 18
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

## Configuration

Configuration is loaded with the following priority (highest first):

1. **CLI arguments** — `--api-key=sk-... --model=deepseek-flash`
2. **Environment variables** — `WEBSEARCH_MODEL` (canonical) or `DEEPSEEK_MODEL` (legacy alias), `WEBSEARCH_ENDPOINT`, etc.
3. **User config file** — `settings.json` (see Installation for path per platform)
4. **Defaults** — built into the server

For the model specifically, the full resolution order is:

`--model` > `WEBSEARCH_MODEL` > `DEEPSEEK_MODEL` > `settings.json` > built-in default (`deepseek-flash`)

**Retired model aliases.** `deepseek-v4-flash` and `deepseek-v4-flash-vision-exp` name models that
DeepSeek has retired. If your `settings.json` still pins one of them, the value is ignored and
resolution continues down the list above — the built-in default `deepseek-flash`, unless a
higher-precedence layer supplies a model. Your config file is **not** rewritten: it stays exactly as
you saved it. A warning naming the file and the ignored alias, stating that resolution falls back to
the built-in default and that the file is left unchanged, is written to **stderr**, because stdout is
reserved for the MCP stdio protocol. The warning is emitted before the environment and command-line
layers are merged, so it does not name the model the process will actually use.

### Config file (`settings.json`)

```json
{
  "apiKey": "",
  "endpoint": "https://api.deepseek.com/anthropic/v1/messages",
  "model": "deepseek-flash",
  "maxTokens": 32768,
  "systemPrompt": "Use multiple keyword variations to conduct thorough research. Prioritize authoritative, verifiable sources. Provide comprehensive, well-cited answers.",
  "tool": {
    "name": "web_search",
    "type": "web_search_20260209",
    "max_uses": 20
  }
}
```

| Key | Default | Description |
|-----|---------|-------------|
| `apiKey` | (empty) | DeepSeek API key |
| `endpoint` | `https://api.deepseek.com/anthropic/v1/messages` | API endpoint URL |
| `model` | `deepseek-flash` | Model identifier. `deepseek-flash` is the current DeepSeek model name. |
|| `maxTokens` | `32768` | Max output tokens |
| `systemPrompt` | (see default) | System prompt guiding search behavior |
| `tool.name` | `"web_search"` | Tool name registered in MCP |
| `tool.type` | `"web_search_20260209"` | DeepSeek tool type |
| `tool.max_uses` | `20` | Max search calls per request |
| `searchStatsEnabled` | `false` | Enable hourly search statistics (requires Node >= 22) |

### Environment variables

| Variable | Equivalent config key |
|----------|----------------------|
| `DEEPSEEK_API_KEY` | `apiKey` |
| `WEBSEARCH_API_KEY` | `apiKey` (alternative) |
| `WEBSEARCH_ENDPOINT` | `endpoint` |
| `WEBSEARCH_MODEL` | `model` (canonical) |
| `DEEPSEEK_MODEL` | `model` (legacy alias, consulted only when `WEBSEARCH_MODEL` is unset) |
| `WEBSEARCH_MAX_TOKENS` | `maxTokens` |
| `WEBSEARCH_SYSTEM_PROMPT` | `systemPrompt` |
| `WEBSEARCH_TOOL_NAME` | `tool.name` |
| `WEBSEARCH_TOOL_TYPE` | `tool.type` |
| `WEBSEARCH_MAX_USES` | `tool.max_uses` |
| `WEBSEARCH_LOG_ENABLED` | `logEnabled` |
| `WEBSEARCH_LOG_DIR` | `logDir` |
| `WEBSEARCH_SEARCH_STATS_ENABLED` | `searchStatsEnabled` |

### CLI arguments

```bash
forever-saint-liang-websearch --api-key=sk-... --model=deepseek-flash
```

| Argument | Config key |
|----------|-----------|
| `--api-key` | `apiKey` |
| `--endpoint` | `endpoint` |
| `--model` | `model` (default `deepseek-flash`) |
| `--max-tokens` | `maxTokens` |
| `--system-prompt` | `systemPrompt` |
| `--tool-name` | `tool.name` |
| `--tool-type` | `tool.type` |
| `--max-uses` | `tool.max_uses` |
| `--log-enabled` | `logEnabled` |
| `--log-dir` | `logDir` |
| `--search-stats-enabled` | `searchStatsEnabled` |

## CLI Mode

The server also supports a standalone CLI mode. When a subcommand is provided, it runs as a CLI tool instead of an MCP server:

```bash
# Perform a web search
forever-saint-liang-websearch search "TypeScript latest version"

# Search with config options
forever-saint-liang-websearch search "hello world" --model=deepseek-flash

# View search statistics
forever-saint-liang-websearch stats

# Stats with a date range
forever-saint-liang-websearch stats 2026-06-01 2026-06-24

# Show version and help
forever-saint-liang-websearch --version
forever-saint-liang-websearch --help
```

All configuration flags (`--api-key`, `--model`, `--max-uses`, etc.) work in CLI mode just like MCP mode. Output is in JSON format.

### CLI Subcommands

| Command | Description |
|---------|-------------|
| `search <query>` | Perform a web search, output JSON |
| `stats [from] [to]` | Show search statistics, output JSON |
| `version` | Show version number |
| `help` | Show help information |

## Tool: `web_search`

Search the web using DeepSeek's built-in web search.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | — | Search query (1-500 chars) |
| `max_uses` | number | No | `config.tool.max_uses ?? 20` | Max search calls (capped by server config `tool.max_uses`) |
| `allowed_domains` | string[] | No | — | Only include results from these domains |
| `blocked_domains` | string[] | No | — | Exclude results from these domains |
| `user_location` | object | No | — | Localized results: `{ city?, region?, country?, timezone? }` |

## Tool: `web_search_stats`

Query hourly search statistics from the local SQLite database. This tool is only available when `searchStatsEnabled` is `true` **and** Node.js >= 22.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `from` | string (ISO 8601) | No | Today 00:00 | Start of time range |
| `to` | string (ISO 8601) | No | Now | End of time range |

**When the stats feature is unavailable**, the tool returns a specific reason: configuration disabled, Node.js version too low, or database error. See `searchStatsEnabled` in the Configuration section.

## Development

```bash
git clone https://github.com/chengx-coding/forever-saint-liang-websearch.git
cd forever-saint-liang-websearch
npm install
npm run dev
```

## Acknowledgments

This project is inspired by [websearch-deepseek](https://github.com/lyumeng/websearch-deepseek) by [lyumeng](https://github.com/lyumeng). Both projects are licensed under MIT.

## License

MIT
