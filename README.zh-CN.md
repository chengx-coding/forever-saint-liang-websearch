[English](README.md) | [中文](README.zh-CN.md)

# forever-saint-liang

一个基于 DeepSeek Anthropic 兼容 API 提供网络搜索能力的 MCP 服务端。

梁圣的恩情还不完。

## 前置条件

- Node.js >= 18
- DeepSeek API Key，从 https://platform.deepseek.com 获取

## 安装

```bash
npm install -g forever-saint-liang
```

## 配置

设置 `DEEPSEEK_API_KEY` 环境变量：

```bash
export DEEPSEEK_API_KEY="sk-your-api-key"
```

可选：设置 `DEEPSEEK_MODEL` 切换模型（默认 `deepseek-v4-flash`）：

```bash
export DEEPSEEK_MODEL="deepseek-v4-pro"
```

## MCP 客户端配置

在 MCP 客户端配置中添加：

```json
{
  "mcpServers": {
    "forever-saint-liang": {
      "command": "npx",
      "args": ["forever-saint-liang"],
      "env": {
        "DEEPSEEK_API_KEY": "sk-your-api-key"
      }
    }
  }
}
```

## 工具：`web_search`

使用 DeepSeek 内置网络搜索进行搜索。

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `query` | string | 是 | — | 搜索关键词（1-500 字符） |
| `max_uses` | number | 否 | 5 | 最大搜索调用次数（1-20），每次返回约 10 条结果 |
| `time_range` | enum | 否 | — | 时间过滤：`OneDay`、`OneWeek`、`OneMonth`、`OneYear` |
| `allowed_domains` | string[] | 否 | — | 仅返回指定域名的结果 |
| `blocked_domains` | string[] | 否 | — | 排除指定域名的结果 |
| `user_location` | object | 否 | — | 本地化结果：`{ city?, region?, country?, timezone? }` |

## 开发

```bash
git clone https://github.com/chengxin/forever-saint-liang.git
cd forever-saint-liang
npm install
npm run dev
```

## 许可证

MIT
