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

## Claude Code 插件

OMMS-PRO 提供 Claude Code 插件，支持跨会话记忆自动召回与捕获。

### 安装

```bash
# 克隆仓库
git clone git@github.com:cxin21/OMMS-PRO.git
cd OMMS-PRO

# 安装后端依赖
npm install

# 安装插件到 Claude Code
PLUGIN_SRC="$(pwd)/src/presentation/plugins/claude"
PLUGIN_DATA="$HOME/.claude/plugins/data/omms-pro"

# 复制插件文件
mkdir -p "$PLUGIN_DATA"
rsync -av --exclude='node_modules' "$PLUGIN_SRC/" "$PLUGIN_DATA/"

# 安装插件依赖
cd "$PLUGIN_DATA" && npm install && cd -

# 设置执行权限
chmod +x "$PLUGIN_DATA/hooks/session-start/init-session"
chmod +x "$PLUGIN_DATA/hooks/pre-response/recall-memory"
chmod +x "$PLUGIN_DATA/hooks/session-end/capture-session"
chmod +x "$PLUGIN_DATA/mcp-wrapper.sh"

# 配置项目 hooks (在项目根目录下)
mkdir -p .claude
cat > .claude/settings.json << 'EOF'
{
  "hooks": {
    "SessionStart": [{ "command": "<PLUGIN_DATA>/hooks/session-start/init-session" }],
    "UserPromptSubmit": [{ "command": "<PLUGIN_DATA>/hooks/pre-response/recall-memory" }],
    "SessionEnd": [{ "command": "<PLUGIN_DATA>/hooks/session-end/capture-session" }]
  }
}
EOF
# 将 <PLUGIN_DATA> 替换为实际路径: $HOME/.claude/plugins/data/omms-pro

# 配置 MCP Server
cat > .mcp.json << 'EOF'
{
  "mcpServers": {
    "omms-pro": {
      "command": "bash",
      "args": ["<PLUGIN_DATA>/mcp-wrapper.sh"]
    }
  }
}
EOF
# 同样替换 <PLUGIN_DATA>
```

### 更新

```bash
cd OMMS-PRO

# 拉取最新代码
git pull

# 同步插件文件
PLUGIN_SRC="$(pwd)/src/presentation/plugins/claude"
PLUGIN_DATA="$HOME/.claude/plugins/data/omms-pro"
rsync -av --exclude='node_modules' "$PLUGIN_SRC/" "$PLUGIN_DATA/"

# 更新依赖（如有新增）
cd "$PLUGIN_DATA" && npm install && cd -

# 设置执行权限
chmod +x "$PLUGIN_DATA/hooks/"*/init-session "$PLUGIN_DATA/hooks/"*/recall-memory "$PLUGIN_DATA/hooks/"*/capture-session "$PLUGIN_DATA/mcp-wrapper.sh"

# 重启 Claude Code 会话后执行 /reload-plugins 生效
```

---

## 项目结构

```
OMMS-PRO/
├── src/
│   ├── index.ts                 # 主入口 (OMMS 类)
│   ├── cli/                     # 命令行 & 统一服务器
│   ├── core/                    # 类型定义、端口接口、领域逻辑
│   ├── infrastructure/           # 存储后端 (SQLite/LanceDB/文件系统)
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

### 核心模块说明

#### 记忆服务 (src/services/memory/)

| 模块 | 文件 | 说明 |
|------|------|------|
| MemoryCaptureService | `capture/memory-capture-service.ts` | 从对话提取记忆，LLM 增强提取 |
| MemoryStoreManager | `store/memory-store-manager.ts` | 五层存储编排（Cache/Vector/Meta/Palace/Graph） |
| MemoryRecallManager | `recall/memory-recall-manager.ts` | 渐进式召回，强化机制 |
| MemoryVersionManager | `store/memory-version-manager.ts` | UID-swap 版本管理，版本链 |
| MemoryDegradationManager | `degradation/memory-degradation-manager.ts` | 遗忘、归档、作用域降级 |
| DreamingManager | `dreaming/dreaming-manager.ts` | 三阶段梦境整理 |
| ConsolidationManager | `consolidation/consolidation-manager.ts` | 睡眠时记忆合并 |

#### 用户画像 (src/services/profile/)

| 模块 | 文件 | 说明 |
|------|------|------|
| ProfileManager | `profile-manager.ts` | 主协调器，集成 MemoryService |
| PersonaBuilder | `persona/persona-builder.ts` | LLM 构建用户人格 |
| PreferenceInferer | `preference/preference-inferer.ts` | 行为推断偏好 |
| InteractionRecorder | `interaction/interaction-recorder.ts` | 交互记录存储 |
| TagManager | `interaction/tag-manager.ts` | 用户标签管理 |

#### 存储层 (src/infrastructure/storage/stores/)

| 模块 | 文件 | 说明 |
|------|------|------|
| SQLiteMetaStore | `sqlite-meta-store.ts` | 元数据 SQLite 持久化 |
| VectorStore | `vector-store.ts` | LanceDB 向量存储 |
| PalaceStore | `palace-store.ts` | 文件系统 Palace 存储 |
| GraphStore | `graph-store.ts` | 知识图谱存储 |

---

## 模块依赖关系

```
presentation/
  ├── mcp-server/         # MCP 协议入口
  │   └── tools/          # 工具定义 (27个工具)
  ├── plugins/claude/     # Claude Code 插件
  └── web-ui/             # React 前端

services/ (业务逻辑层)
  ├── memory/
  │   ├── core/           # StorageMemoryService (核心)
  │   ├── capture/        # MemoryCaptureService
  │   ├── store/          # MemoryStoreManager, MemoryVersionManager
  │   ├── recall/         # MemoryRecallManager
  │   ├── degradation/    # MemoryDegradationManager
  │   ├── consolidation/  # ConsolidationManager
  │   ├── llm/           # LLM 提取器
  │   ├── search/        # HybridSearch, AAAKPrescreen
  │   └── aaak/          # AAAK 压缩格式
  ├── profile/
  │   ├── profile-manager.ts
  │   ├── profile-cache.ts
  │   └── interaction/   # TagManager, InteractionRecorder
  └── dreaming/          # DreamingManager

infrastructure/ (存储基础设施)
  └── storage/
      └── stores/        # 五层存储实现
          ├── cache-manager.ts      # L1 Cache
          ├── vector-store.ts      # L2 Vector (LanceDB)
          ├── sqlite-meta-store.ts  # L3 Meta (SQLite)
          ├── palace-store.ts        # L4 Palace (文件系统)
          └── graph-store.ts         # L5 Graph (SQLite)

core/ (核心类型与接口)
  ├── types/              # memory, config, graph, episode 类型
  └── ports/              # 存储层抽象接口

shared/ (共享基础库)
  ├── config/            # 配置管理
  ├── logging/           # 日志 (logger, formatter, error-boundary)
  ├── utils/             # 工具函数
  └── embedding/         # embedding 服务
```

### 层间调用关系

1. **presentation** (MCP Tools) 调用 **services** 层
2. **services** 层调用 **infrastructure** 层的存储抽象
3. **core** 定义类型和接口，被各层引用
4. **shared** 提供通用能力，被各层引用

---

## 配置项清单

配置加载优先级：`config.default.json` -> `config.json` -> 环境变量

敏感信息建议使用环境变量：`OMMS_LLM_API_KEY`、`OMMS_EMBEDDING_API_KEY`。

### 顶层配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `agentId` | string | `default-agent` | Agent 标识符 |
| `capture.confidenceThreshold` | number | `0.5` | 记忆提取置信度阈值 |
| `capture.maxVersions` | number | `5` | 最大版本数 |
| `capture.enableAutoExtraction` | boolean | `false` | 启用自动提取 |
| `capture.extractionTimeout` | number | `30000` | 提取超时(ms) |

### API 配置 (`api`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `api.enabled` | boolean | `false` | 启用 API 服务器 |
| `api.port` | number | `3000` | API 监听端口 |
| `api.host` | string | `0.0.0.0` | API 监听主机 |
| `api.server.timeout` | number | `30000` | 请求超时(ms) |
| `api.cors.enabled` | boolean | `true` | 启用 CORS |
| `api.cors.origin` | string | `*` | CORS 允许来源 |
| `api.logging.level` | string | `info` | 日志级别 |
| `api.logging.enableRequestLogging` | boolean | `true` | 记录请求日志 |
| `api.auth.enabled` | boolean | `false` | 启用认证 |
| `api.security.rateLimit.enabled` | boolean | `false` | 启用限流 |
| `api.security.rateLimit.windowMs` | number | `60000` | 限流窗口(ms) |
| `api.security.rateLimit.maxRequests` | number | `100` | 窗口内最大请求数 |
| `api.performance.enableCompression` | boolean | `true` | 启用压缩 |
| `api.performance.maxRequestBodySize` | string | `10mb` | 最大请求体大小 |

### MCP 配置 (`mcp`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `mcp.server.transport` | string | `stdio` | 传输模式 (stdio/sse/ws) |
| `mcp.server.ssePort` | number | `3100` | SSE 端口 |
| `mcp.server.wsPort` | number | `3200` | WebSocket 端口 |
| `mcp.tools.enableLogging` | boolean | `true` | 启用工具日志 |
| `mcp.tools.timeout` | number | `30000` | 工具调用超时(ms) |
| `mcp.tools.maxResults` | number | `100` | 最大返回结果数 |
| `mcp.performance.enableCache` | boolean | `true` | 启用缓存 |
| `mcp.performance.cacheTTL` | number | `300000` | 缓存 TTL(ms) |
| `mcp.performance.maxConcurrentTools` | number | `10` | 最大并发工具数 |

### 日志配置 (`logging`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `logging.level` | string | `info` | 日志级别 |
| `logging.output` | string | `file` | 输出目标 (console/file) |
| `logging.filePath` | string | `./logs/omms.log` | 日志文件路径 |
| `logging.maxSize` | number | `10485760` | 单个日志文件最大大小(bytes) |
| `logging.maxFiles` | number | `5` | 保留的日志文件数 |

### 记忆服务配置 (`memoryService`)

#### 存储配置 (`memoryService.store`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `memoryService.store.autoExtract` | boolean | `false` | 自动提取记忆 |
| `memoryService.store.autoChunk` | boolean | `true` | 自动分块 |
| `memoryService.store.autoEnrich` | boolean | `true` | 自动丰富元数据 |
| `memoryService.store.chunkThreshold` | number | `500` | 分块阈值 |
| `memoryService.store.defaultType` | string | `event` | 默认记忆类型 |
| `memoryService.store.summaryMaxLength` | number | `200` | 摘要最大长度 |
| `memoryService.store.scopeUpgradeThresholds.sessionToAgentImportance` | number | `5` | Session->Agent 升级阈值 |
| `memoryService.store.scopeUpgradeThresholds.agentToGlobalScopeScore` | number | `10` | Agent->Global 升级阈值 |
| `memoryService.store.scopeUpgradeThresholds.agentToGlobalImportance` | number | `7` | Agent->Global 重要性阈值 |
| `memoryService.store.blockThresholds.coreMinImportance` | number | `7` | 核心记忆最低重要性 |
| `memoryService.store.blockThresholds.sessionMinImportance` | number | `4` | Session 最低重要性 |
| `memoryService.store.blockThresholds.workingMinImportance` | number | `2` | Working 最低重要性 |
| `memoryService.store.blockThresholds.archivedMinImportance` | number | `1` | 归档最低重要性 |

#### 召回配置 (`memoryService.recall`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `memoryService.recall.defaultLimit` | number | `20` | 默认召回数量 |
| `memoryService.recall.maxLimit` | number | `100` | 最大召回数量 |
| `memoryService.recall.minScore` | number | `0.5` | 最低相似度分数 |
| `memoryService.recall.enableVectorSearch` | boolean | `true` | 启用向量搜索 |
| `memoryService.recall.enableKeywordSearch` | boolean | `true` | 启用关键词搜索 |
| `memoryService.recall.vectorWeight` | number | `0.7` | 向量搜索权重 |
| `memoryService.recall.keywordWeight` | number | `0.3` | 关键词搜索权重 |

#### 遗忘配置 (`memoryService.forget`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `memoryService.forget.enabled` | boolean | `true` | 启用遗忘机制 |
| `memoryService.forget.checkInterval` | number | `86400000` | 检查间隔(ms, 24h) |
| `memoryService.forget.archiveThreshold` | number | `3` | 归档阈值 |
| `memoryService.forget.deleteThreshold` | number | `1` | 删除阈值 |
| `memoryService.forget.maxInactiveDays` | number | `90` | 最大不活跃天数 |
| `memoryService.forget.protectLevel` | number | `7` | 保护级别 |
| `memoryService.forget.scoringWeights.importanceWeight` | number | `0.5` | 重要性权重 |
| `memoryService.forget.scoringWeights.accessCountWeight` | number | `0.3` | 访问次数权重 |
| `memoryService.forget.scoringWeights.recencyWeight` | number | `0.2` | 时效性权重 |

#### 作用域降级配置 (`memoryService.scopeDegradation`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `memoryService.scopeDegradation.enabled` | boolean | `true` | 启用作用域降级 |
| `memoryService.scopeDegradation.sessionToAgentDays` | number | `7` | Session->Agent 天数 |
| `memoryService.scopeDegradation.agentToGlobalDays` | number | `30` | Agent->Global 天数 |
| `memoryService.scopeDegradation.sessionUpgradeRecallThreshold` | number | `5` | Session 升级召回阈值 |
| `memoryService.scopeDegradation.agentUpgradeRecallThreshold` | number | `10` | Agent 升级召回阈值 |

#### 强化配置 (`memoryService.reinforcement`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `memoryService.reinforcement.enabled` | boolean | `true` | 启用强化机制 |
| `memoryService.reinforcement.lowBoostThreshold` | number | `3` | 低强化阈值 |
| `memoryService.reinforcement.mediumBoostThreshold` | number | `6` | 中强化阈值 |
| `memoryService.reinforcement.highBoostThreshold` | number | `7` | 高强化阈值 |
| `memoryService.reinforcement.lowBoost` | number | `0.5` | 低强化值 |
| `memoryService.reinforcement.mediumBoost` | number | `0.3` | 中强化值 |
| `memoryService.reinforcement.highBoost` | number | `0.1` | 高强化值 |
| `memoryService.reinforcement.defaultBoost` | number | `0.2` | 默认强化值 |
| `memoryService.reinforcement.maxImportance` | number | `10` | 最大重要性 |
| `memoryService.reinforcement.cooldownMs` | number | `60000` | 冷却时间(ms) |

#### 缓存配置 (`memoryService.cache`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `memoryService.cache.enabled` | boolean | `true` | 启用缓存 |
| `memoryService.cache.maxSize` | number | `1000` | 最大缓存条目数 |
| `memoryService.cache.ttl` | number | `3600000` | 缓存 TTL (1h) |
| `memoryService.cache.evictionPolicy` | string | `lru` | 淘汰策略 |

#### 记忆整合配置 (`memoryService.consolidation`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `memoryService.consolidation.enabled` | boolean | `true` | 启用记忆整合 |
| `memoryService.consolidation.scheduleHour` | number | `3` | 整合执行小时 (凌晨3点) |
| `memoryService.consolidation.maxMemoriesPerCycle` | number | `50` | 每周期最大记忆数 |
| `memoryService.consolidation.minRecallCount` | number | `3` | 最小召回次数 |
| `memoryService.consolidation.llmCompression.enabled` | boolean | `true` | 启用 LLM 压缩 |
| `memoryService.consolidation.llmCompression.temperature` | number | `0.3` | LLM 温度参数 |
| `memoryService.consolidation.llmCompression.maxTokens` | number | `500` | LLM 最大 token 数 |
| `memoryService.consolidation.merge.similarityThreshold` | number | `0.85` | 合并相似度阈值 |
| `memoryService.consolidation.merge.maxGroupSize` | number | `5` | 最大合并组大小 |

#### 空间配置 (`memoryService.spatial`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `memoryService.spatial.enabled` | boolean | `true` | 启用空间化 |
| `memoryService.spatial.dimensions` | number | `3` | 空间维度 |
| `memoryService.spatial.maxNeighbors` | number | `10` | 最大邻居数 |
| `memoryService.spatial.clusteringThreshold` | number | `0.8` | 聚类阈值 |
| `memoryService.spatial.autoLayout` | boolean | `true` | 自动布局 |
| `memoryService.spatial.defaultRadius` | number | `5` | 默认半径 |

#### 版本配置 (`memoryService.version`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `memoryService.version.similarityThreshold` | number | `0.9` | 版本相似度阈值 |
| `memoryService.version.maxVersions` | number | `5` | 最大版本数 |
| `memoryService.version.enableVersioning` | boolean | `true` | 启用版本管理 |

#### 捕获配置 (`memoryService.capture`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `memoryService.capture.maxMemoriesPerCapture` | number | `5` | 每次捕获最大记忆数 |
| `memoryService.capture.similarityThreshold` | number | `0.9` | 捕获相似度阈值 |
| `memoryService.capture.confidenceThreshold` | number | `0.5` | 置信度阈值 |
| `memoryService.capture.enableLLMSummarization` | boolean | `true` | 启用 LLM 摘要 |
| `memoryService.capture.llmModel` | string | `Doubao-Seed-2.0-pro` | LLM 模型 |
| `memoryService.capture.versionLockTTLMs` | number | `30000` | 版本锁 TTL |
| `memoryService.capture.maxVersionLocks` | number | `100` | 最大版本锁数 |
| `memoryService.capture.enableIncrementalCapture` | boolean | `true` | 启用增量捕获 |

#### 索引更新配置 (`memoryService.indexUpdate`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `memoryService.indexUpdate.mode` | string | `batch` | 更新模式 (batch/realtime) |
| `memoryService.indexUpdate.batchSize` | number | `100` | 批量大小 |
| `memoryService.indexUpdate.batchDelayMs` | number | `5000` | 批量延迟(ms) |
| `memoryService.indexUpdate.maxPendingTasks` | number | `10000` | 最大待处理任务数 |
| `memoryService.indexUpdate.scheduledIntervalMs` | number | `60000` | 调度间隔(ms) |
| `memoryService.indexUpdate.maxRetries` | number | `3` | 最大重试次数 |

#### 存储路径配置 (`memoryService.storage`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `memoryService.storage.metaStoreDbPath` | string | `./data/memory_meta.db` | SQLite 元数据库路径 |
| `memoryService.storage.palaceStorePath` | string | `./data/palace` | Palace 文件存储路径 |
| `memoryService.storage.graphStoreDbPath` | string | `./data/graph/knowledge_graph.db` | 图数据库路径 |
| `memoryService.storage.vectorStoreDbPath` | string | `./data/vector` | 向量数据库路径 |
| `memoryService.storage.vectorStoreTableName` | string | `memory_vectors` | 向量表名 |
| `memoryService.storage.episodeStorePath` | string | `./data/graph` | Episode 存储路径 |
| `memoryService.storage.profileDbPath` | string | `./data/profile.db` | 用户画像数据库路径 |
| `memoryService.storage.dreamReportsDbPath` | string | `./data/graph/dream_reports.db` | 梦境报告数据库路径 |
| `memoryService.storage.tagDbPath` | string | `./data/tags.db` | 标签数据库路径 |

### 梦境引擎配置 (`dreamingEngine`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `dreamingEngine.scheduler.autoOrganize` | boolean | `true` | 自动整理 |
| `dreamingEngine.scheduler.organizeInterval` | number | `21600000` | 整理间隔 (6h) |
| `dreamingEngine.scheduler.memoryThreshold` | number | `1000` | 触发阈值 |
| `dreamingEngine.scheduler.fragmentationThreshold` | number | `0.3` | 碎片化阈值 |
| `dreamingEngine.scheduler.stalenessDays` | number | `30` | 陈旧天数 |
| `dreamingEngine.scheduler.maxMemoriesPerCycle` | number | `100` | 每周期最大记忆数 |
| `dreamingEngine.consolidation.similarityThreshold` | number | `0.85` | 合并相似度阈值 |
| `dreamingEngine.consolidation.maxGroupSize` | number | `5` | 最大组大小 |
| `dreamingEngine.consolidation.preserveNewest` | boolean | `true` | 保留最新 |
| `dreamingEngine.consolidation.createNewVersion` | boolean | `true` | 创建新版本 |
| `dreamingEngine.archival.importanceThreshold` | number | `2` | 归档重要性阈值 |
| `dreamingEngine.archival.stalenessDays` | number | `30` | 归档陈旧天数 |
| `dreamingEngine.archival.archiveBlock` | string | `archived` | 归档区块名 |
| `dreamingEngine.archival.retentionDays` | number | `90` | 保留天数 |
| `dreamingEngine.themeExtraction.minThemeStrength` | number | `0.3` | 主题最小强度 |
| `dreamingEngine.themeExtraction.maxThemes` | number | `5` | 最大主题数 |

### Embedding 配置 (`embedding`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `embedding.model` | string | `text-embedding-3-small` | Embedding 模型 |
| `embedding.dimensions` | number | `1536` | 向量维度 |
| `embedding.baseURL` | string | `""` | API 基础 URL |
| `embedding.apiKey` | string | `""` | API 密钥 |
| `embedding.batchSize` | number | `32` | 批处理大小 |
| `embedding.timeout` | number | `30000` | 超时时间(ms) |

### LLM 提取配置 (`llmExtraction`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `llmExtraction.provider` | string | `openai-compatible` | LLM 提供商 |
| `llmExtraction.model` | string | `gpt-4o-mini` | LLM 模型 |
| `llmExtraction.apiKey` | string | `""` | API 密钥 |
| `llmExtraction.baseURL` | string | `""` | API 基础 URL |
| `llmExtraction.temperature` | number | `0.7` | 温度参数 |
| `llmExtraction.maxTokens` | number | `2000` | 最大 token 数 |
| `llmExtraction.timeout` | number | `30000` | 超时时间(ms) |

### 多 Agent 配置 (`multiAgent`)

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `multiAgent.enabled` | boolean | `false` | 启用多 Agent |
| `multiAgent.namespaceIsolation` | boolean | `false` | 命名空间隔离 |
| `multiAgent.federationEnabled` | boolean | `false` | 启用联邦 |
| `multiAgent.agents.heartbeatTimeoutMs` | number | `60000` | 心跳超时 |
| `multiAgent.agents.heartbeatIntervalMs` | number | `15000` | 心跳间隔 |
| `multiAgent.agents.maxMissedHeartbeats` | number | `3` | 最大丢失心跳数 |
| `multiAgent.agents.cleanupIntervalMs` | number | `300000` | 清理间隔 |

---

## CLI 命令

OMMS-PRO 提供命令行工具 `omms`，支持以下命令：

### 用法

```bash
omms <命令> [选项]
```

### 命令列表

| 命令 | 说明 |
|------|------|
| `list` | 列出记忆 |
| `search` | 搜索记忆 |
| `stats` | 显示统计信息 |
| `extract` | 从文本提取记忆 |
| `start` | 启动 All-in-One 服务器 |

### 选项

| 选项 | 说明 |
|------|------|
| `--limit, -n <数量>` | 结果数量限制 (默认: 10) |
| `--type <类型>` | 按类型过滤 (fact/event/decision/error/learning/relation) |
| `--wing <wingId>` | 按 Wing 过滤 |
| `--agent <agentId>` | Agent ID (默认: default) |
| `--help, -h` | 显示帮助 |
| `--version, -v` | 显示版本 |

### 示例

```bash
# 列出记忆
omms list -n 5

# 搜索记忆
omms search "昨天的会议"

# 显示统计
omms stats

# 从文本提取记忆
omms extract "今天学习了 TypeScript"
```

### start 命令

启动统一服务器（API + MCP + Web UI）。

#### 用法

```bash
omms start [选项]
```

#### 选项

| 选项 | 说明 |
|------|------|
| `--port, -p <端口>` | 监听端口 (默认: 3000) |
| `--host <主机>` | 监听主机 (默认: 0.0.0.0) |
| `--api-only` | 仅启动 API 服务器，不启用 MCP 和 Web UI |
| `--with-mcp` | 启用 MCP 服务器 |
| `--development` | 开发模式 |
| `--help, -h` | 显示帮助 |

#### 示例

```bash
# 默认启动
omms start

# 指定端口
omms start --port 8080 --host localhost

# 仅 API 模式
omms start --api-only

# 启用 MCP
omms start --with-mcp --development
```

---

## MCP 工具列表

OMMS-PRO 通过 MCP (Model Context Protocol) 提供 27 个工具，共分为 7 个类别：

### 记忆管理工具 (16 个)

| 工具名 | 说明 |
|--------|------|
| `memory_store` | 存储一条新记忆到记忆宫殿 |
| `memory_get` | 获取单条记忆详情 |
| `memory_update` | 更新记忆的评分、作用域或标签 |
| `memory_delete` | 删除记忆 |
| `memory_archive` | 归档记忆（标记为不活跃，保留数据） |
| `memory_list` | 列出记忆（分页） |
| `memory_recall` | 通过语义相似度召回记忆（带强化效果） |
| `memory_extract` | 从对话文本中使用 LLM 提取并存储记忆 |
| `memory_stats` | 获取记忆系统统计信息 |
| `memory_reinforce_batch` | 批量强化多条记忆的重要性评分 |
| `memory_upgrade_scope` | 检查并执行记忆的作用域升级（SESSION->AGENT->GLOBAL） |
| `memory_forgetting_cycle` | 执行遗忘周期（降级和删除低重要性记忆） |
| `memory_scope_degradation_cycle` | 执行作用域降级周期 |
| `memory_restore` | 恢复记忆（从归档状态恢复） |
| `omms_record_context` | 主动记录对话上下文到本地文件 |
| `omms_capture_session` | 会话结束时自动捕获记忆 |

### 宫殿管理工具 (6 个)

| 工具名 | 说明 |
|--------|------|
| `palace_list_wings` | 列出所有记忆宫殿的 Wings |
| `palace_create_wing` | 查看记忆宫殿结构 |
| `palace_list_rooms` | 列出指定 Wing 内的所有 Rooms |
| `palace_get_taxonomy` | 获取整个记忆宫殿的完整分类树（Wing -> Hall -> Room） |
| `palace_status` | 获取记忆宫殿的存储状态统计 |
| `palace_navigate` | 导航到指定宫殿路径，获取该路径下的记忆内容 |

### 知识图谱工具 (4 个)

| 工具名 | 说明 |
|--------|------|
| `graph_query_entity` | 查询知识图谱中的实体信息及其关联记忆 |
| `graph_get_relations` | 获取实体节点的所有边/关系 |
| `graph_find_tunnels` | 发现连接不同 Wings 的 Tunnels |
| `graph_get_timeline` | 获取图谱中的时间线关系 |

### Dreaming 工具 (2 个)

| 工具名 | 说明 |
|--------|------|
| `dreaming_trigger` | 触发 Dreaming 过程，进行记忆整合、归档和图谱重构 |
| `dreaming_status` | 获取 Dreaming 的当前状态和历史统计 |

### 系统工具 (3 个)

| 工具名 | 说明 |
|--------|------|
| `system_stats` | 获取系统完整统计信息 |
| `system_health` | 检查系统各组件的健康状态 |
| `system_config` | 读取系统配置信息 |

### 评分工具 (2 个)

| 工具名 | 说明 |
|--------|------|
| `scoring_calculate` | 使用 LLM 计算记忆内容的重要性评分和作用域评分 |
| `scoring_reinforce` | 强化记忆的重要性评分（模拟使用该记忆） |

### 用户画像工具 (1 个)

| 工具名 | 说明 |
|--------|------|
| `profile_get` | 获取用户画像信息（包括 Persona、偏好、标签和统计） |

---

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

---

## 开发指南

### 环境要求

- Node.js >= 20.0.0
- npm >= 9.0.0

### 环境搭建

```bash
# 克隆仓库
git clone git@github.com:cxin21/OMMS-PRO.git
cd OMMS-PRO

# 安装依赖
npm install
```

### 编译运行

```bash
# 开发模式 (热重载)
npm run dev

# 构建
npm run build

# 仅构建 CLI
npm run build:cli

# 仅构建 Web UI
npm run build:webui

# 启动后端
npm start

# 开发模式启动 (热重载)
npm run start:dev
```

### 代码质量

```bash
# 类型检查
npm run typecheck

# 代码检查
npm run lint

# 代码修复
npm run lint:fix

# 运行测试
npm test

# UI 测试模式
npm run test:ui

# 测试覆盖率
npm run test:coverage
```

### 配置管理

1. 复制 `config.default.json` 为 `config.json`
2. 根据需要修改配置项
3. 敏感信息建议使用环境变量：
   - `OMMS_LLM_API_KEY` - LLM API 密钥
   - `OMMS_EMBEDDING_API_KEY` - Embedding API 密钥

### 目录结构说明

```
data/                   # 数据存储目录 (自动创建)
  ├── memory_meta.db   # SQLite 元数据库
  ├── palace/          # Palace 文件存储
  ├── vector/          # LanceDB 向量存储
  ├── graph/           # 图数据库
  │   ├── knowledge_graph.db
  │   └── dream_reports.db
  ├── profile.db       # 用户画像数据库
  └── tags.db          # 标签数据库

logs/                   # 日志目录 (自动创建)
  └── omms.log         # 主日志文件
```

---

## License

MIT
