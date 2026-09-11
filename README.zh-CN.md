[English](README.md) | [中文](README.zh-CN.md)

# 梁圣的恩情还不完: Websearch MCP via Deepseek

一个基于 DeepSeek Anthropic 兼容 API 提供网络搜索能力的 MCP 服务端。

梁圣的恩情还不完。

> "梁圣"指 DeepSeek 创始人梁文峰，以此致敬梁文峰与 DeepSeek 对世界的贡献。

## 前置条件

- Node.js >= 18
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

## 配置

配置加载优先级（从高到低）：

1. **命令行参数** — `--api-key=sk-... --model=deepseek-flash`
2. **环境变量** — `WEBSEARCH_MODEL`（规范变量）或 `DEEPSEEK_MODEL`（旧别名）、`WEBSEARCH_ENDPOINT` 等
3. **用户配置文件** — `settings.json`（路径见安装说明）
4. **默认值** — 内置于服务端

就模型而言，完整的取值顺序为：

`--model` > `WEBSEARCH_MODEL` > `DEEPSEEK_MODEL` > `settings.json` > 内置默认值（`deepseek-flash`）

**已退役的模型别名。** `deepseek-v4-flash` 与 `deepseek-v4-flash-vision-exp` 所指的模型已被 DeepSeek 退役。
若 `settings.json` 中仍然写着其中之一，该值会被忽略，取值继续沿上面的顺序向下传递：除非更高优先级的层给出了
模型，否则最终落到内置默认值 `deepseek-flash`。配置文件**不会**被改写，仍与你保存时完全一致；同时会向
**stderr** 输出一行警告，指明配置文件路径与被忽略的别名，并说明将回退到内置默认值、文件保持原样。该警告在
环境变量与命令行参数合并之前发出，因此不会给出进程最终实际使用的模型——stdout 专供 MCP stdio 协议使用，
必须保持干净。

### 配置文件 (`settings.json`)

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

| 键 | 默认值 | 说明 |
|---|--------|------|
| `apiKey` | (留空) | DeepSeek API 密钥 |
| `endpoint` | `https://api.deepseek.com/anthropic/v1/messages` | API 端点 URL |
| `model` | `deepseek-flash` | 模型标识符，`deepseek-flash` 是 DeepSeek 当前的模型名称 |
| `maxTokens` | `32768` | 最大输出 token 数 |
| `systemPrompt` | (见默认值) | 引导搜索行为的系统提示词 |
| `tool.name` | `"web_search"` | MCP 中注册的工具名称 |
| `tool.type` | `"web_search_20260209"` | DeepSeek 工具类型 |
| `tool.max_uses` | `20` | 每次请求最大搜索调用次数 |
| `searchStatsEnabled` | `false` | 搜索统计开关（需 Node >= 22） |

### 环境变量

| 变量 | 对应配置项 |
|------|-----------|
| `DEEPSEEK_API_KEY` | `apiKey` |
| `WEBSEARCH_API_KEY` | `apiKey`（备选） |
| `WEBSEARCH_ENDPOINT` | `endpoint` |
| `WEBSEARCH_MODEL` | `model`（规范变量） |
| `DEEPSEEK_MODEL` | `model`（旧别名，仅在未设置 `WEBSEARCH_MODEL` 时生效） |
| `WEBSEARCH_MAX_TOKENS` | `maxTokens` |
| `WEBSEARCH_SYSTEM_PROMPT` | `systemPrompt` |
| `WEBSEARCH_TOOL_NAME` | `tool.name` |
| `WEBSEARCH_TOOL_TYPE` | `tool.type` |
| `WEBSEARCH_MAX_USES` | `tool.max_uses` |
| `WEBSEARCH_LOG_ENABLED` | `logEnabled` |
| `WEBSEARCH_LOG_DIR` | `logDir` |
| `WEBSEARCH_SEARCH_STATS_ENABLED` | `searchStatsEnabled` |

### 命令行参数

```bash
forever-saint-liang-websearch --api-key=sk-... --model=deepseek-flash
```

| 参数 | 配置项 |
|------|--------|
| `--api-key` | `apiKey` |
| `--endpoint` | `endpoint` |
| `--model` | `model`（默认 `deepseek-flash`） |
| `--max-tokens` | `maxTokens` |
| `--system-prompt` | `systemPrompt` |
| `--tool-name` | `tool.name` |
| `--tool-type` | `tool.type` |
| `--max-uses` | `tool.max_uses` |
| `--log-enabled` | `logEnabled` |
| `--log-dir` | `logDir` |
| `--search-stats-enabled` | `searchStatsEnabled` |

## CLI 模式

本工具也支持独立的 CLI 模式。提供子命令时，以 CLI 工具方式运行，而非 MCP 服务端：

```bash
# 终端直接搜索
forever-saint-liang-websearch search "TypeScript最新版本"

# 带配置选项搜索
forever-saint-liang-websearch search "你好世界" --model=deepseek-flash

# 查看搜索统计
forever-saint-liang-websearch stats

# 指定日期范围的统计
forever-saint-liang-websearch stats 2026-06-01 2026-06-24

# 查看版本与帮助
forever-saint-liang-websearch --version
forever-saint-liang-websearch --help
```

所有配置参数（`--api-key`、`--model`、`--max-uses` 等）在 CLI 模式下与 MCP 模式一致可用。输出为 JSON 格式。

### CLI 子命令

| 命令 | 说明 |
|------|------|
| `search <query>` | 执行网络搜索，输出 JSON |
| `stats [from] [to]` | 查看搜索统计，输出 JSON |
| `version` | 显示版本号 |
| `help` | 显示帮助信息 |

## 工具：`web_search`

使用 DeepSeek 内置网络搜索进行搜索。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `query` | string | 是 | — | 搜索关键词（1-500 字符） |
| `max_uses` | number | 否 | `config.tool.max_uses ?? 20` | 最大搜索调用次数（受服务端 `tool.max_uses` 限制） |
| `allowed_domains` | string[] | 否 | — | 仅返回指定域名的结果 |
| `blocked_domains` | string[] | 否 | — | 排除指定域名的结果 |
| `user_location` | object | 否 | — | 本地化结果：`{ city?, region?, country?, timezone? }` |

## 工具：`web_search_stats`

查询本地 SQLite 数据库中的按小时搜索统计。此工具仅在 `searchStatsEnabled` 为 `true` **且** Node.js >= 22 时可用。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `from` | string (ISO 8601) | 否 | 今天 00:00 | 时间范围起点 |
| `to` | string (ISO 8601) | 否 | 当前时间 | 时间范围终点 |

**当统计功能不可用时**，工具会返回具体原因：配置未开启、Node.js 版本过低、或数据库异常。配置开关见 `searchStatsEnabled`。

## 开发

```bash
git clone https://github.com/chengx-coding/forever-saint-liang-websearch.git
cd forever-saint-liang-websearch
npm install
npm run dev
```

## 致谢

本项目受 [websearch-deepseek](https://github.com/lyumeng/websearch-deepseek)（作者 [lyumeng](https://github.com/lyumeng)）启发。两个项目均以 MIT 许可证开源。

## 许可证

MIT
