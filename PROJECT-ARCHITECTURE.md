# OMMS-PRO 项目架构说明文档

## 一、项目概述

**OMMS-PRO** (Optimized Memory Management System) 是一款融合记忆宫殿架构的记忆管理系统，为 AI Agent 提供持久化记忆存储、语义召回、智能归纳整理能力。

### 1.1 核心特性

- **记忆生命周期管理**: 捕获 → 存储 → 召回 → 强化 → 遗忘
- **分层存储架构**: Cache + Vector + SQLite + Palace + Graph
- **语义向量化**: 支持语义相似度搜索
- **梦境整理引擎**: 自动归纳、碎片整理、图谱重构
- **用户画像系统**: L0 身份、L1 偏好自动推断
- **MCP 协议支持**: 可接入 Claude Code 等 AI 工具

### 1.2 技术栈

- **运行时**: Node.js >= 20.0.0
- **语言**: TypeScript 5.x
- **数据库**: SQLite (元数据/图谱), LanceDB (向量)
- **AI 集成**: OpenAI Compatible API, Anthropic
- **协议**: REST API, MCP (Model Context Protocol)

---

## 二、架构设计

### 2.1 分层架构

```
┌──────────────────────────────────────────────────────┐
│                   Presentation Layer                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │  REST API  │  │ MCP Server  │  │   Web UI    │   │
│  └─────────────┘  └─────────────┘  └─────────────┘   │
│  ┌─────────────────────────────────────────────────┐  │
│  │              Plugin System (Claude)              │  │
│  └─────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────┐
│                    Services Layer                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │   Memory    │  │   Dreaming  │  │   Profile   │  │
│  │   Service   │  │   Manager   │  │   Manager   │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
└──────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────┐
│                 Infrastructure Layer                  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │ Vector  │ │  Meta   │ │ Palace  │ │  Graph  │   │
│  │  Store  │ │  Store  │ │  Store  │ │  Store  │   │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘   │
│  ┌─────────────────────────────────────────────────┐ │
│  │           Storage Service (统一调度)              │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────┐
│                     Shared Layer                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │  Config  │ │  Logging  │ │  Utils   │           │
│  └──────────┘ └──────────┘ └──────────┘           │
│  ┌──────────┐ ┌──────────┐                         │
│  │Embedding │ │  Agents  │                         │
│  └──────────┘ └──────────┘                         │
└──────────────────────────────────────────────────────┘
```

### 2.2 核心模块关系

```
                    ┌──────────────────┐
                    │   OMMS (Main)    │
                    └────────┬─────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌───────────────┐ ┌─────────────────┐
│ MemoryService   │ │DreamingManager│ │ ProfileManager  │
│                 │ │               │ │                 │
│ - store()       │ │ - dream()     │ │ - buildPersona()│
│ - recall()      │ │ - consolidate │ │ - inferPrefs()  │
│ - update()      │ │ - reorganize  │ │ - recordInteract│
│ - delete()      │ │ - archive     │ │                 │
└────────┬────────┘ └───────┬───────┘ └────────┬────────┘
         │                  │                    │
         └──────────────────┼────────────────────┘
                            │
                            ▼
              ┌─────────────────────────┐
              │   Storage Service       │
              │  (Transaction Manager)  │
              └────────────┬────────────┘
                           │
    ┌──────────────┬───────┴───────┬──────────────┐
    │              │               │              │
    ▼              ▼               ▼              ▼
┌───────┐    ┌─────────┐    ┌──────────┐   ┌─────────┐
│Cache  │    │ Vector  │    │   Meta   │   │ Palace  │
│Manager│    │  Store  │    │  Store   │   │  Store  │
│ (LRU) │    │(LanceDB)│    │(SQLite)  │   │ (File)  │
└───────┘    └─────────┘    └──────────┘   └─────────┘
                                           ┌─────────┐
                                           │  Graph  │
                                           │  Store  │
                                           └─────────┘
```

---

## 三、核心数据类型

### 3.1 记忆类型 (MemoryType)

```typescript
enum MemoryType {
  FACT = 'fact',        // 客观事实
  EVENT = 'event',       // 事件记录
  DECISION = 'decision', // 决策记录
  ERROR = 'error',       // 错误记录
  LEARNING = 'learning', // 学习心得
  RELATION = 'relation',  // 关系信息
  IDENTITY = 'identity', // 身份信息
  PREFERENCE = 'preference', // 偏好设置
  PERSONA = 'persona',   // 人格特征
}
```

### 3.2 记忆作用域 (MemoryScope)

```typescript
enum MemoryScope {
  SESSION = 'session', // 仅当前会话有效
  AGENT = 'agent',     // Agent 级别有效
  GLOBAL = 'global',    // 全局有效
}
```

### 3.3 记忆区块 (MemoryBlock)

```typescript
enum MemoryBlock {
  WORKING = 'working',   // 工作记忆区 (临时)
  SESSION = 'session',  // 会话记忆区
  CORE = 'core',        // 核心记忆区 (重要)
  ARCHIVED = 'archived', // 归档区 (低重要性)
  DELETED = 'deleted',   // 删除区 (待清理)
}
```

---

## 四、配置管理

### 4.1 配置层次

```
config.default.json (默认配置)
        │
        ▼
config.json (用户配置，覆盖默认)
        │
        ▼
环境变量 (最高优先级)
```

### 4.2 关键配置项

| 配置路径 | 说明 | 默认值 |
|----------|------|--------|
| `memoryService.store.defaultImportance` | 默认重要性 | 5 |
| `memoryService.recall.defaultLimit` | 默认召回数量 | 20 |
| `memoryService.forget.protectLevel` | 遗忘保护等级 | 7 |
| `memoryService.cache.maxSize` | 缓存最大条数 | 1000 |
| `dreamingEngine.scheduler.organizeInterval` | 整理间隔 | 6小时 |
| `embedding.dimensions` | 向量维度 | 1536 |

---

## 五、存储设计

### 5.1 存储分层

| 存储层 | 介质 | 用途 | 容量 |
|--------|------|------|------|
| Cache | 内存 | 热数据缓存 | 1000 条 |
| Vector | LanceDB | 语义搜索索引 | 无限制 |
| Meta | SQLite | 元数据/索引 | 无限制 |
| Palace | JSON 文件 | 原始内容存储 | 无限制 |
| Graph | SQLite | 知识图谱 | 无限制 |

### 5.2 数据一致性保证

- **Write-Through**: 所有写操作先写入 SQLite 元数据，再同步其他存储
- **事务机制**: 关键操作使用 TransactionManager 保证原子性
- **版本链**: 每次更新创建新版本，保留完整历史

### 5.3 Palace 存储结构

```
palace/
├── agent_{agentId}/
│   ├── fact/
│   │   └── room_default/
│   │       └── closet_{memoryId}_v{version}.json
│   ├── event/
│   ├── decision/
│   └── ...
└── session_{sessionId}/
    └── ...
```

---

## 六、API 路由

### 6.1 记忆路由 (`/api/memories`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 获取记忆列表 |
| POST | `/capture` | 捕获记忆 |
| POST | `/recall` | 召回记忆 |
| GET | `/:id` | 获取单条记忆 |
| PUT | `/:id` | 更新记忆 |
| DELETE | `/:id` | 删除记忆 |
| POST | `/reinforce/:id` | 强化记忆 |
| POST | `/forgetting-cycle` | 执行遗忘周期 |

### 6.2 梦境路由 (`/api/dreaming`)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/organize` | 执行记忆整理 |
| POST | `/consolidate` | 记忆归纳整理 |
| GET | `/stats` | 获取整理统计 |
| GET | `/fragmentation` | 获取碎片化指标 |

### 6.3 画像路由 (`/api/profile`)

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/:userId` | 获取用户画像 |
| PUT | `/:userId` | 更新画像 |
| POST | `/:userId/context` | 获取 L0/L1 上下文 |

---

## 七、部署架构

### 7.1 单机部署

```
┌─────────────────────────────────────┐
│           OMMS-PRO Server           │
│                                     │
│  ┌─────────┐  ┌─────────────────┐   │
│  │ REST   │  │     MCP        │   │
│  │ API    │  │   Server       │   │
│  │ :3000  │  │   (stdio)      │   │
│  └─────────┘  └─────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │      Data Directory         │   │
│  │  ./data/memory_meta.db     │   │
│  │  ./data/vector/             │   │
│  │  ./data/palace/            │   │
│  │  ./data/graph/             │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

### 7.2 Claude Code 集成

```
┌──────────────┐     MCP      ┌──────────────┐
│  Claude Code │◄───────────►│ OMMS-PRO     │
│              │   (stdio)   │  MCP Server  │
└──────────────┘             └──────────────┘
                                          │
                                          ▼
                                 ┌──────────────┐
                                 │ OMMS Backend │
                                 │  (REST API)  │
                                 └──────────────┘
```

---

## 八、目录结构

```
OMMS-PRO/
├── src/
│   ├── api/                    # API 层
│   │   ├── routes/             # API 路由
│   │   ├── middleware/         # 中间件
│   │   ├── dto/                 # DTO
│   │   ├── server.ts           # 服务器
│   │   └── index.ts
│   ├── cli/                    # CLI
│   │   ├── index.ts
│   │   ├── start-command.ts
│   │   └── unified-server.ts
│   ├── core/                   # 核心域
│   │   ├── domain/memory/      # 记忆域
│   │   ├── ports/              # 接口定义
│   │   └── types/              # 类型
│   ├── services/               # 业务服务
│   │   ├── memory/            # 记忆服务
│   │   ├── dreaming/          # 梦境服务
│   │   └── profile/           # 画像服务
│   ├── infrastructure/         # 基础设施
│   │   ├── storage/           # 存储实现
│   │   ├── indexing/          # 索引
│   │   └── security/          # 安全
│   ├── presentation/          # 展示层
│   │   ├── mcp-server/       # MCP 服务器
│   │   ├── plugins/          # 插件
│   │   └── web-ui/          # Web UI
│   └── shared/               # 共享
│       ├── config/          # 配置
│       ├── logging/        # 日志
│       ├── utils/          # 工具
│       └── embedding/      # 向量化
├── data/                    # 数据目录
│   ├── memory_meta.db      # SQLite 元数据库
│   ├── vector/            # LanceDB 向量存储
│   ├── palace/            # Palace 内容存储
│   └── graph/             # 知识图谱
├── logs/                   # 日志目录
├── agents/                 # Agent 配置
│   └── prompts/           # 提示词模板
├── config.json            # 用户配置
├── config.default.json    # 默认配置
└── package.json
```

---

## 九、开发指南

### 9.1 开发环境

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 类型检查
npm run typecheck

# 测试
npm test
```

### 9.2 构建

```bash
# 构建所有
npm run build

# 仅构建核心
npm run build:cli
```

### 9.3 启动服务

```bash
# 启动统一服务器
omms start

# 仅启动 API
omms start --api-only

# 带 MCP
omms start --with-mcp
```

---

## 十、扩展指南

### 10.1 添加新的记忆类型

1. 在 `MemoryType` 枚举中添加新类型
2. 在 `config.default.json` 中添加默认配置
3. 在 Palace 存储中创建对应目录结构

### 10.2 自定义存储后端

1. 实现 `IPalaceStore` 或 `IVectorStore` 接口
2. 在 `StorageService` 中注册新后端
3. 配置使用新后端

### 10.3 添加 MCP 工具

1. 在 `presentation/mcp-server/tools/` 中创建工具文件
2. 实现 `Tool` 接口
3. 在 `tool-registry.ts` 中注册工具

---

**文档版本**: v0.1.0
**最后更新**: 2026-04-28
