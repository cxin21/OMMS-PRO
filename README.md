# OMMS-PRO

AI Agent 长期记忆管理系统，融合记忆宫殿（Memory Palace）空间化架构，为 AI 提供跨会话、跨 Agent 的持久化记忆能力。

## 核心功能

- **记忆捕获** - 从对话中自动提取结构化记忆，支持 LLM 增强提取
- **语义召回** - 基于向量相似度 + 多维度评分的智能检索
- **作用域管理** - SESSION / AGENT / GLOBAL 三级作用域自动升降级
- **遗忘机制** - 基于重要性、访问频率、时间衰减的智能遗忘
- **梦境整理** - 合并相似记忆、压缩冗余、重建图谱关系
- **用户画像** - 从对话中构建用户身份与偏好模型
- **知识图谱** - 实体与关系的图谱存储与查询
- **MCP 协议** - 支持 stdio / SSE / WebSocket 三种传输模式

## 技术栈

| 层级 | 技术 |
|------|------|
| 语言 | TypeScript (ESM) |
| 运行时 | Node.js >= 20 |
| HTTP | Express.js 4.x |
| 元数据存储 | SQLite (better-sqlite3) |
| 向量存储 | LanceDB |
| 文件存储 | 文件系统 (JSON) |
| 前端 | React 18 + Vite 5 |
| 日志 | Winston |
| 协议 | MCP (Model Context Protocol) |

## 快速开始

```bash
# 安装依赖
npm install

# 启动后端 (端口 3000)
npm start

# 启动前端开发服务器 (端口 5173)
npm run dev:webui
```

后端启动后提供：
- REST API: `http://localhost:3000/api/v1`
- Web UI: `http://localhost:3000/`
- MCP SSE: `http://localhost:3000/mcp/sse`
- MCP WebSocket: `ws://localhost:3000/mcp/ws`

## 项目结构

```
OMMS-PRO/
├── src/
│   ├── index.ts                 # 主入口 (OMMS 类)
│   ├── cli/                     # 命令行 & 统一服务器
│   ├── core/                    # 类型定义、端口接口、领域逻辑
│   ├── infrastructure/          # 存储后端 (SQLite/LanceDB/文件系统)
│   ├── services/                # 业务服务 (记忆/梦境/画像)
│   ├── api/                     # REST API 路由与中间件
│   ├── presentation/
│   │   ├── mcp-server/          # MCP 协议服务器
│   │   ├── plugins/claude/      # Claude Code 插件
│   │   └── web-ui/              # React 前端
│   └── shared/                  # 配置、日志、Embedding、工具库
├── agents/                      # Agent 提示词定义
├── config.default.json          # 默认配置
├── config.json                  # 用户配置 (不入库)
└── package.json
```

## 配置

配置加载优先级：`config.default.json` -> `config.json` -> 环境变量

复制 `config.default.json` 为 `config.json` 进行自定义配置。主要配置项：

```jsonc
{
  "api": { "port": 3000 },                    // API 端口
  "embedding": {                               // 向量化服务
    "model": "BAAI/bge-m3",
    "dimensions": 1024,
    "baseURL": "https://api.siliconflow.cn/v1",
    "apiKey": "your-api-key"
  },
  "llmExtraction": {                           // LLM 记忆提取
    "provider": "openai-compatible",
    "model": "your-model",
    "apiKey": "your-api-key",
    "baseURL": "your-api-endpoint"
  }
}
```

敏感信息建议使用环境变量：`OMMS_LLM_API_KEY`、`OMMS_EMBEDDING_API_KEY`。

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/memories/capture` | 捕获记忆 |
| POST | `/api/v1/memories/recall` | 语义召回 |
| GET | `/api/v1/memories` | 列出记忆 |
| GET | `/api/v1/memories/:id` | 获取记忆详情 |
| PUT | `/api/v1/memories/:id` | 更新记忆 |
| DELETE | `/api/v1/memories/:id` | 删除记忆 |
| POST | `/api/v1/dreaming/organize` | 执行梦境整理 |
| GET | `/api/v1/profile/:userId` | 获取用户画像 |
| GET | `/api/v1/graph/nodes` | 查询图谱节点 |
| GET | `/api/v1/system/health` | 健康检查 |

## 开发

```bash
npm run dev              # 开发模式 (热重载)
npm run build            # 构建
npm run typecheck        # 类型检查
npm run lint             # 代码检查
npm test                 # 运行测试
```

## License

MIT
