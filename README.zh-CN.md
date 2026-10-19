[English](README.md) | [中文](README.zh-CN.md)

# 梁圣的恩情还不完: Websearch MCP via Deepseek

一个把 DeepSeek Search 与 Fetch API 暴露给 AI Agent 的 MCP 服务端，同时提供独立 CLI。

梁圣的恩情还不完。

> "梁圣"指 DeepSeek 创始人梁文峰，以此致敬梁文峰与 DeepSeek 对世界的贡献。

## 它做什么

服务端提供两个原语：

- **`web_search`** 返回排序后的证据：标题、URL、摘要、面向模型的长摘要、发布时间、权威度、
  相关性分数，以及可选的页面正文。
- **`web_fetch`** 把一个 URL 转成 Markdown，让模型读取全文。

服务端不生成答案。宿主模型本来就在做这件事；让服务端保持为快速、确定的搜索与抓取适配器，
可以避免每次搜索都多一次模型调用。

## 前置条件

- Node.js >= 22
- DeepSeek API Key，从 https://platform.deepseek.com 获取

## 安装

```bash
npm install -g forever-saint-liang-websearch
```

首次运行时会自动创建用户配置文件，路径因平台而异：

- **Linux / macOS**：`~/.config/.websearch-via-deepseek/settings.json`
- **Windows**：`%USERPROFILE%\.config\.websearch-via-deepseek\settings.json`

## 快速开始

设置 API Key 有两种方式，任选其一：

### 方式 A：用户配置文件（推荐）

编辑用户配置文件，填入 `apiKey`：

```json
{
  "apiKey": "sk-your-api-key"
}
```

然后配置 MCP 客户端，无需设置环境变量：

**OpenCode** (`opencode.json`)：

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

**Claude Code** (`claude_desktop_config.json` / `.mcp.json`)：

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

### 方式 B：MCP 配置中设置环境变量

直接在 MCP 客户端配置中传入 API Key：

**OpenCode** (`opencode.json`)：

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

**Claude Code** (`claude_desktop_config.json` / `.mcp.json`)：

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

服务端支持 MCP `2026-07-28`，同时通过 SDK 的 legacy 握手继续服务旧客户端。

## 配置

配置加载优先级（从高到低）：

1. **命令行参数** — `--api-key=sk-... --default-count=10`
2. **环境变量** — `WEBSEARCH_DEFAULT_COUNT`、`WEBSEARCH_SEARCH_ENDPOINT` 等
3. **用户配置文件** — `settings.json`（路径见安装说明）
4. **默认值** — 内置于服务端

### 配置文件 (`settings.json`)

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

| 键 | 默认值 | 说明 |
|---|--------|------|
| `apiKey` | (留空) | DeepSeek API 密钥 |
| `searchEndpoint` | `https://api.deepseek.com/v1/tools/search` | DeepSeek Search API 端点 |
| `fetchEndpoint` | `https://api.deepseek.com/v1/tools/fetch` | DeepSeek Fetch API 端点 |
| `defaultCount` | `10` | 默认搜索结果条数（1–50） |
| `needContent` | `false` | 搜索的默认 `need_content` 开关 |
| `fetchMaxChars` | `50000` | `web_fetch` 返回的最大字符数（1000–200000） |
| `timeoutMs` | `30000` | 单次请求超时毫秒数（1000–120000） |
| `tool.name` | `"web_search"` | 搜索工具的 MCP 名称 |
| `logEnabled` | `false` | 是否启用 JSONL 工具日志 |
| `logDir` | 系统临时目录 | 日志目录（启用日志时）；留空使用系统临时目录 |
| `searchStatsEnabled` | `false` | 是否启用按小时的搜索/抓取统计 |

数值越界会被收敛到合法范围；无效端点会回退到默认值。两种情况都会向 **stderr** 输出警告。
stdout 专供 MCP stdio 协议使用。

### 已废弃的键（0.3.x 及更早）

旧版服务端调用 DeepSeek 的 Anthropic 兼容 `messages` 端点，并在请求里注入服务端 `web_search`
工具。`0.5.0` 已移除这条路径。以下键仍会被读取和解析，但不再影响行为：

| 废弃键 | 旧含义 |
| --- | --- |
| `endpoint` | Anthropic messages 端点 |
| `model` | 模型标识符 |
| `maxTokens` | 输出 token 上限 |
| `systemPrompt` | 研究提示词 |
| `tool.type` | 服务端工具类型（`web_search_20260209`） |
| `tool.max_uses` | 每次请求最大搜索次数 |

只要其中任意一个存在，服务端就会在 stderr 输出一行警告，点名被忽略的键，然后继续运行。
**你的 `settings.json` 永远不会被改写或迁移**——方便时自行删除这些键。旧环境变量
（`WEBSEARCH_ENDPOINT`、`WEBSEARCH_MODEL`、`DEEPSEEK_MODEL`、`WEBSEARCH_MAX_TOKENS`、
`WEBSEARCH_SYSTEM_PROMPT`、`WEBSEARCH_TOOL_TYPE`、`WEBSEARCH_MAX_USES`）与旧命令行参数
（`--endpoint`、`--model`、`--max-tokens`、`--system-prompt`、`--tool-type`、`--max-uses`）
同理。

### 环境变量

| 变量 | 对应配置项 |
|------|-----------|
| `DEEPSEEK_API_KEY` | `apiKey` |
| `WEBSEARCH_API_KEY` | `apiKey`（备选） |
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

### 命令行参数

```bash
forever-saint-liang-websearch --api-key=sk-... --default-count=10
```

| 参数 | 配置项 |
|------|--------|
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

## CLI 模式

本包也支持独立 CLI。提供子命令时不会启动 MCP 服务端：

```bash
# 搜索并输出 JSON 证据
forever-saint-liang-websearch search "TypeScript最新版本"

# 带过滤条件搜索
forever-saint-liang-websearch search "MCP spec" --allowed-domains=modelcontextprotocol.io --count=5

# 抓取页面并输出 Markdown
forever-saint-liang-websearch fetch "https://modelcontextprotocol.io/specification/2026-07-28"

# 查看工具统计
forever-saint-liang-websearch stats
forever-saint-liang-websearch stats 2026-06-01 2026-06-24

# 查看版本与帮助
forever-saint-liang-websearch --version
forever-saint-liang-websearch --help
```

所有配置参数在 CLI 模式下与 MCP 模式一致可用。输出为 stdout 上的 JSON；错误为 stderr 上的 JSON。

### CLI 子命令

| 命令 | 说明 |
|------|------|
| `search <query>` | 搜索网络，输出 JSON 证据 |
| `fetch <url>` | 抓取单个页面，输出 Markdown 内容的 JSON |
| `stats [from] [to]` | 查看按小时的搜索与抓取统计 |
| `version` | 显示版本号 |
| `help` | 显示帮助信息 |

## 工具：`web_search`

使用 DeepSeek Search API 搜索网络。结果是证据，不是答案。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `query` | string (1–128) | 是 | — | 搜索词 |
| `count` | number (1–50) | 否 | `defaultCount` | 返回结果条数 |
| `need_content` | boolean | 否 | `needContent` | 是否在每条结果中返回正文 |
| `allowed_domains` | string[] | 否 | — | 仅这些裸域名（翻译为 `site:` 运算符） |
| `blocked_domains` | string[] | 否 | — | 排除这些域名（翻译为 `-site:` 运算符） |
| `lang` | string | 否 | — | 逗号分隔的语言代码，如 `zh,en` |
| `after` | string | 否 | — | 仅 `YYYY` 或 `YYYY-MM-DD` 之后的页面 |
| `before` | string | 否 | — | 仅 `YYYY` 或 `YYYY-MM-DD` 之前的页面 |
| `ori_question` | string (1–128) | 否 | — | 触发搜索的原始问题，帮助查询理解 |
| `localization` | string | 否 | — | IPv4/IPv6 地址，用于本地化结果 |

查询词加上生成的运算符必须不超过 **128 字符**。超过时工具返回解释上限的错误，绝不静默截断。

输出：

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

只有当 `need_content` 为 true 且 DeepSeek 返回了正文时，结果里才会出现 `content`。

## 工具：`web_fetch`

使用 DeepSeek Fetch API 抓取单个页面，并把主要内容作为 Markdown 返回。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `url` | string | 是 | — | 绝对 HTTP/HTTPS URL，最长 8192 字符 |
| `max_chars` | number (1000–200000) | 否 | `fetchMaxChars` | 返回的最大字符数 |

输出：

```json
{
  "url": "https://…",
  "title": "…",
  "content": "# Markdown…",
  "content_length": 12345,
  "truncated": false
}
```

`content_length` 是截断前的原始长度。

## 工具：`web_search_stats`

查询本地 SQLite 数据库中的按小时工具统计。需要 `searchStatsEnabled` 为 `true`。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `from` | string (ISO 8601) | 否 | 今天 00:00 | 时间范围起点 |
| `to` | string (ISO 8601) | 否 | 当前时间 | 时间范围终点 |

输出包含 `total_count`、`search_count`、`fetch_count`、`record_count`，以及同时带两类计数的
按小时记录。既有的 `search_stats` 数据库会在首次使用时自动迁移。

## 从 0.3.x 升级

`0.5.0` 是破坏性版本：

- `answer` 字段已移除。`web_search` 返回证据；答案由宿主模型生成。
- `thinking`、`model`、`stop_reason`、`turns` 与 token 用量字段已移除。
- `max_uses` 被 `count` 取代，不再属于工具 schema。`count` 是结果条数，不是搜索次数；旧键不会被
  重新解释。
- `user_location` 被 `localization` 取代，后者接受 IP 地址。
- `query` 限制为 128 字符。
- 最低 Node.js 版本为 22。
- MCP 服务端现在支持 `2026-07-28`，同时继续服务旧客户端。
- 旧的 `messages` 后端及其配置键已废弃；见上文。

## 开发

```bash
git clone https://github.com/chengx-coding/forever-saint-liang-websearch.git
cd forever-saint-liang-websearch
npm install
npm run dev
```

验证门是 `npm run build` 与 `npm test`。`npm test` 可能报告零个测试却仍以退出码 0 结束，
因此请检查打印出的通过数量。

## 致谢

本项目受 [websearch-deepseek](https://github.com/lyumeng/websearch-deepseek)（作者 [lyumeng](https://github.com/lyumeng)）启发。两个项目均以 MIT 许可证开源。

## 许可证

MIT
