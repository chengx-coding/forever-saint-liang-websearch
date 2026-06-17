# Forever Saint Liang: Websearch MCP via Deepseek — 项目上下文

## 项目概述

一个本地运行的 MCP 服务端，封装 DeepSeek 的 Anthropic 兼容 API（`web_search_20260209`），为 LLM 客户端提供网络搜索能力。

- **仓库**: `github.com/chengx-coding/forever-saint-liang-websearch`
- **版本**: `0.1.0`
- **许可证**: MIT
- **发布**: npm（`forever-saint-liang-websearch`），待首次发布

## 技术栈

| 类别 | 选择 |
|------|------|
| 运行时 | Node.js >= 18 |
| 语言 | TypeScript (ESM, NodeNext) |
| MCP SDK | `@modelcontextprotocol/sdk` ^1.29.0 (StdioServerTransport) |
| 校验 | `zod` ^3.24.5 |
| 构建 | `tsc` → `dist/` |
| 开发运行 | `tsx` (dev only) |

## 架构

```
src/
├── index.ts           MCP 服务入口：注册 web_search 工具，stdio 传输
├── deepseek-client.ts DeepSeek API 客户端：构建请求、pause_turn 续搜、结果解析
├── config.ts          多层配置加载（CLI > 环境变量 > 用户配置 > 默认值）
├── logger.ts          搜索日志：每次搜索生成 JSONL 文件
├── stats.ts           搜索统计：按小时聚合搜索次数存入 SQLite（可选，需 Node >= 22）
└── types.ts           TypeScript 类型定义

default-config.json    默认配置模板
```

## 配置系统

优先级从高到低：

1. **CLI 参数** — `--api-key=xxx --model=deepseek-v4-pro --log-enabled --log-dir=/path`
2. **环境变量** — `DEEPSEEK_API_KEY`, `WEBSEARCH_MODEL`, `WEBSEARCH_LOG_ENABLED` 等
3. **用户配置文件** — `~/.config/.websearch-via-deepseek/settings.json`（首次运行自动创建）
4. **库默认值** — 内置于 `getDefaultConfig()`

### 全部配置项

| 键 | 默认值 | CLI | 环境变量 | 说明 |
|---|--------|-----|---------|------|
| `apiKey` | (空) | `--api-key` | `DEEPSEEK_API_KEY` / `WEBSEARCH_API_KEY` | DeepSeek API 密钥 |
| `endpoint` | `https://api.deepseek.com/anthropic/v1/messages` | `--endpoint` | `WEBSEARCH_ENDPOINT` | API 端点 |
| `model` | `deepseek-v4-flash` | `--model` | `WEBSEARCH_MODEL` | deepseek-v4-flash 或 v4-pro |
| `maxTokens` | 32768 | `--max-tokens` | `WEBSEARCH_MAX_TOKENS` | 最大输出 token |
| `systemPrompt` | 默认英文提示词 | `--system-prompt` | `WEBSEARCH_SYSTEM_PROMPT` | 注入 DeepSeek 的系统消息 |
| `tool.name` | `web_search` | `--tool-name` | `WEBSEARCH_TOOL_NAME` | MCP 工具名 |
| `tool.type` | `web_search_20260209` | `--tool-type` | `WEBSEARCH_TOOL_TYPE` | DeepSeek 工具版本 |
| `tool.max_uses` | 20 | `--max-uses` | `WEBSEARCH_MAX_USES` | 每次请求最大搜索次数 |
| `logEnabled` | false | `--log-enabled` | `WEBSEARCH_LOG_ENABLED` | 是否开启搜索日志 |
| `logDir` | `os.tmpdir()/websearch-via-deepseek-logs` | `--log-dir` | `WEBSEARCH_LOG_DIR` | 日志保存目录 |
| `searchStatsEnabled` | false | `--search-stats-enabled` | `WEBSEARCH_SEARCH_STATS_ENABLED` | 搜索统计开关（需 Node >= 22） |

默认 systemPrompt：
> Use multiple keyword variations to conduct thorough research. Prioritize authoritative, verifiable sources. Provide comprehensive, well-cited answers.

## MCP 工具: `web_search`

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `query` | string(1-500) | 是 | — | 搜索查询 |
| `max_uses` | number(1-20) | 否 | `config.tool.max_uses ?? 20` | 最大搜索调用次数 |
| `allowed_domains` | string[] | 否 | — | 域名白名单 |
| `blocked_domains` | string[] | 否 | — | 域名黑名单 |
| `user_location` | object | 否 | — | 本地化：`{city, region, country, timezone}` |

## DeepSeek API 使用要点

- **端点**: `https://api.deepseek.com/anthropic/v1/messages`（Anthropic 兼容）
- **工具版本**: 默认 `web_search_20260209`，也支持 `web_search_20250305`
- **max_uses**: 限制搜索调用次数（非结果数），deep research 建议 15-20
- **pause_turn 续搜**: 当 `stop_reason === "pause_turn"` 时，自动将返回内容作为 assistant message 继续请求，最多 5 轮
- **服务端行为**: 搜索→网页抓取→内容解密→答案生成全在服务端完成

## 日志功能

- 每次搜索生成一个 JSONL 文件，命名格式：`YYYY-MM-DDTHH-mm-ss-SSS_随机哈希.jsonl`
- 第一行：`{"type":"search", "timestamp":"...", "query":"...", "requestBody":{...}}`（不含 apiKey）
- 后续行：`{"type":"result", "index":0, "title":"...", "url":"...", "content":"...", "pageAge":"..."}`
- 默认禁用，需要 `--log-enabled` 或 `WEBSEARCH_LOG_ENABLED=true`

## 开发命令

```bash
npm install              # 安装依赖 + 构建
npm run build            # tsc 编译到 dist/
npm run dev              # tsx 直接运行 src/index.ts（开发模式）
npm run start            # node dist/index.js（生产模式）
```

## 本地测试

测试脚本在 `.local/` 目录（gitignored）：

```bash
# 配置测试（不调 API）
TEST_DEEPSEEK_API_KEY="sk-xxx" npx tsx .local/test-config.ts

# MCP 协议 + 真实搜索测试
TEST_DEEPSEEK_API_KEY="sk-xxx" npx tsx .local/test-mcp.ts

# 深度搜索 + pause_turn 测试
TEST_DEEPSEEK_API_KEY="sk-xxx" npx tsx .local/test-pause-turn.ts

# 边缘情况测试
TEST_DEEPSEEK_API_KEY="sk-xxx" npx tsx .local/test-edge.ts

# 日志功能测试
TEST_DEEPSEEK_API_KEY="sk-xxx" npx tsx .local/test-log-full.ts

# 搜索统计测试
npx tsx .local/test-stats.ts
```

## OpenCode 本地 MCP 配置

```json
    "forever-saint-liang-websearch": {
      "type": "local",
      "enabled": true,
      "command": ["node", "C:/dev/myproj/forever-saint-liang/dist/index.js"],
      "environment": {
        "DEEPSEEK_API_KEY": "sk-xxx"
      }
    }
```

> 注意: 环境变量字段名为 `environment`（不是 `env`）。`--api-key=` CLI 参数也可作为替代方式传 API key。

## 当前状态 & 待办

### 已完成
- [x] MCP web_search 工具，单一入口设计
- [x] 多层配置优先级系统
- [x] DeepSeek API 封装（模型、令牌、端点均可配）
- [x] pause_turn 续搜循环（最多 5 轮）
- [x] JSONL 搜索日志（可开关）
- [x] 用户配置文件自动创建
- [x] 双语 README

### 待办
- [ ] npm 首次发布
- [ ] CI/CD 自动构建与发布
- [ ] 单元测试覆盖
- [ ] 响应中包含模型生成的文本回答（当前只提取搜索结果列表）
