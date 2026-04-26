# OMMS-PRO 完整架构文档

## 第一部分：模块与文件总结

---

### 模块 1：core（核心类型与端口）

| 文件 | 职责 | 关键定义 |
|------|------|----------|
| `core/types/memory.ts` | 记忆核心类型定义 | `Memory`, `MemoryType`(11种), `MemoryScope`(3级), `MemoryBlock`(5级), `PalaceLocation`, `VersionInfo`, `RecallOptions`, `CaptureInput`, `InclusionResult` |
| `core/types/config.ts` | 全系统配置类型 | `OMMSConfig`, `MemoryServiceConfig`, `DreamingEngineConfig`, `EmbeddingConfig`, `LLMConfig` 等 40+ 接口 |
| `core/types/graph.ts` | 图谱类型 | `GraphNode`, `GraphEdge`, `RelationshipType`(9种), `TemporalRelation`, `EntitySnapshot` |
| `core/types/episode.ts` | 情景记忆类型 | `Episode`, `EpisodeCreate`, `EpisodeDetection`, `EpisodeTimeline` |
| `core/ports/storage/index.ts` | 存储层抽象接口 | `ICacheManager`, `IVectorStore`, `IMetaStore`, `IPalaceStore`, `IGraphStore`, `IEpisodeStore` |
| `core/ports/memory/index.ts` | 记忆域抽象接口 | `IMemoryRepository`, `IMemoryRecallService`, `IMemoryVersionService`, `IMemoryConsolidationService` |
| `core/ports/dreaming/index.ts` | 梦境引擎接口 | `IDreamingService`, `DreamOptions`, `DreamReport`, `ConsolidationGroup` |
| `core/domain/memory/recall-strategy.ts` | 多维召回策略 | `RecallStrategy` 类：时间衰减、多样性感知、反馈学习 |

---

### 模块 2：infrastructure（存储基础设施）

| 文件/类 | 存储后端 | 职责 |
|---------|---------|------|
| `stores/cache-manager.ts` | **内存 Map** | LRU/LFU 缓存，TTL，默认 1000 条/1小时 |
| `stores/vector-store.ts` | **LanceDB** | 向量存储与相似度搜索，降级到内存模式 |
| `stores/sqlite-meta-store.ts` | **SQLite** | 记忆元数据（22列），版本链，索引 |
| `stores/palace-store.ts` | **文件系统 JSON** | 记忆原始内容，格式 `{wingId}/{hallId}/{roomId}/closet_{uid}_v{version}.json` |
| `stores/graph-store.ts` | **SQLite** | 图谱节点/边，`graph_nodes` + `graph_edges` 表 |
| `stores/episode-store.ts` | **SQLite** | 情景记忆 + `episode_memories` 连接表 |
| `stores/room-manager.ts` | **内存+委托** | 房间管理，委托 DynamicRoomManager + MemoryRoomMapping |
| `stores/dynamic-room-manager.ts` | **内存** | 向量相似度房间聚类 |
| `stores/memory-room-mapping.ts` | **内存** | 记忆-房间多对多关联 |
| `stores/spatial-index.ts` | **内存** | 3D 空间索引，PCA 降维+位置分配 |
| `stores/storage-service.ts` | **三层组合** | HOT/WARM/COLD 三层存储门面 |
| `backends/sqlite-backend.ts` | SQLite | 实现 `IStorageBackend` |
| `backends/filesystem-backend.ts` | 文件系统 | 实现冷存储 `IStorageBackend` |
| `backends/lancedb-backend.ts` | LanceDB | 实现 `IVectorStorageBackend` |
| `adapters/vector-store-adapter.ts` | 适配器 | VectorStore → `IVectorStorageBackend` 适配 |
| `adapters/sqlite-meta-store-adapter.ts` | 适配器 | SQLiteMetaStore → `IStorageBackend` 适配 |
| `core/migration.ts` | 迁移工具 | 从旧存储迁移到新架构 |
| `security/memory-access-control.ts` | **内存** | 策略型访问控制，审计日志 |
| `indexing/index-update-strategy.ts` | **内存** | 索引更新队列（immediate/batch/scheduled），但 `executeTask` 是空实现 |

---

### 模块 3：services（业务服务）

#### 3.1 记忆服务 `services/memory/`

| 文件 | 核心功能 |
|------|---------|
| `core/storage-memory-service.ts` | **记忆服务主入口**，协调 5 层存储 (Cache/Vector/Meta/Palace/Graph) |
| `core/transaction-manager.ts` | 事务管理器，两阶段提交支持回滚 |
| `core/block-utils.ts` | Block 推导、`shouldUpgradeScope` 逻辑 |
| `llm/llm-extractor.ts` | LLM 提取摘要/标签/重要性评分 |
| `store/memory-store-manager.ts` | 记忆存储入口，协调 5 层写入 |
| `store/memory-version-manager.ts` | **版本管理**，UID swap 机制，0.9 阈值检测相似版本 |
| `degradation/memory-degradation-manager.ts` | **遗忘管理**，双评分衰减算法，24h 定时 |
| `recall/memory-recall-manager.ts` | **召回管理**，渐进式 scope 扩展 (SESSION→AGENT→GLOBAL) |
| `capture/memory-capture-service.ts` | **捕获服务**，LLM 提取+三级版本检测 |
| `aaak/aaak-dialect.ts` | AAAK 压缩格式（见下） |
| `aaak/index.ts` | AAAK 导出 |
| `search/hybrid-search.ts` | BM25 + Vector 混合搜索 |
| `consolidation/memory-consolidation-manager.ts` | 记忆整合（睡梦整理） |

**AAAK 格式**：`ENTITY|TOPICS|"key_quote"|EMOTIONS|FLAGS`
- 示例：`CHN|ai_memory+optimization|"we decided to use vector search"|determ|DECISION+TECHNICAL`
- 情感代码：25 种（determ, anx, joy 等）
- 标记：DECISION, ORIGIN, CORE, PIVOT, TECHNICAL 等

#### 3.2 梦境服务 `services/dreaming/`

| 文件 | 职责 |
|------|------|
| `dreaming-manager.ts` | 梦境引擎主管理器，定时调度 |
| `storage/dream-storage.ts` | **SQLite** 梦境报告持久化 |
| `storage/storage-optimizer.ts` | 存储优化：碎片计算 + 归档候选 + 孤儿文件检测 |

#### 3.3 用户画像服务 `services/profile/`

| 文件 | 存储后端 | 职责 |
|------|---------|------|
| `profile-manager.ts` | **5层存储 + 内存** | 用户画像管理，协调 LLM 构建 |
| `profile-cache.ts` | **内存 Map** | 画像缓存（persona/preferences/tags/stats），TTL 5分钟 |
| `interaction/tag-manager.ts` | **内存 Map** | 标签管理，最大 50 tags/user |
| `interaction/interaction-recorder.ts` | **内存 Map** | 交互记录，无持久化 |

#### 3.4 LLM 服务 `services/memory/llm/`

| 文件 | 职责 |
|------|------|
| `llm-extractor.ts` | LLM 提取：摘要、标签、重要性、类型判断 |
| `llm-factory.ts` | LLM 提供商工厂（OpenAI/Anthropic/Ollama/Mock） |

---

### 模块 4：presentation（对外接口层）

#### 4.1 MCP Server

| 文件 | 工具数 | 暴露方法 |
|------|-------|---------|
| `tools/memory-tools.ts` | 16 | store/get/update/delete/archive/list/recall/extract/stats/reinforce_batch/upgrade_scope/forgetting_cycle/scope_degradation_cycle/restore/omms_record_context/omms_capture_session |
| `tools/palace-tools.ts` | 6 | list_wings/create_wing/list_rooms/get_taxonomy/status/navigate |
| `tools/graph-tools.ts` | 4 | query_entity/get_relations/find_tunnels/get_timeline |
| `tools/dreaming-tools.ts` | 2 | trigger/status |
| `tools/system-tools.ts` | 3 | stats/health/config |
| `tools/scoring-tools.ts` | 2 | calculate/reinforce |
| `tools/profile-tools.ts` | 1 | get |

**传输方式**：stdio（标准输入/输出）、SSE（HTTP 3100）、WebSocket（3200）

#### 4.2 REST API `api/`

- `routes/memory.ts` — 记忆 CRUD + capture/recall/upgrade/forgetting
- `routes/dreaming.ts` — 梦境触发/状态/配置
- `routes/profile.ts` — 画像/persona/preferences/tags
- `routes/system.ts` — 健康/统计/日志/配置
- `routes/graph.ts` — 图谱节点/边查询
- `server.ts` — Express HTTP 服务器
- `router.ts` — 路由依赖注入配置
- `middleware/` — 认证、CORS、限流、错误处理、日志
- `webhook-manager.ts` — Webhook 订阅/触发
- `streaming-manager.ts` — SSE 流管理
- `chatml-adapter.ts` — ChatML 格式适配器

#### 4.3 Web UI

React 应用（src/presentation/web-ui/），8 个页面：Dashboard/Memories/Recall/Palace/Dreaming/Graph/Profile/Settings

---

### 模块 5：shared（共享基础库）

| 子模块 | 核心文件 |
|--------|---------|
| **config** | `config-manager.ts`（单例）、`loader.ts`、`validator.ts` |
| **logging** | `logger.ts`（同步/异步）、`formatter.ts`（JSON/Text）、`transport.ts`（Console/File/Multi）、`error-boundary.ts`（装饰器）、`service-logger.ts` |
| **utils** | `id-generator.ts`（UUID/ULID/Snowflake）、`time.ts`、`string.ts`、`crypto.ts`、`math.ts`、`batch.ts`、`retry.ts`、`file.ts`、`object.ts`、`array.ts`、`json-parser.ts`、`keyword-extractor.ts`、`line-logger.ts` |
| **agents** | `agent-registry.ts`（加载 Agent.md）、`agent-context.ts`（LLM 上下文提供者）、`utils.ts` |
| **embedding** | `embedding-service.ts`（远程 embedding API） |
| **prompts** | `prompt-loader.ts`（模板加载） |

---

### 模块 6：cli

| 文件 | 职责 |
|------|------|
| `index.ts` | 命令行入口：list/search/stats/extract/start |
| `start-command.ts` | `omms start` 命令，支持 --port/--host/--api-only/--with-mcp |
| `unified-server.ts` | 统一服务器：API + MCP + Web UI 组合 |

---

### 模块 7：src/index.ts（主入口）

`OMMS` 类实现 10 步初始化：
1. ConfigManager 加载配置
2. EmbeddingService 创建
3. 5 个存储实例化（Cache/Vector/Meta/Palace/Graph）
4. embedder 函数创建（含 fallback hash）
5. MemoryService 创建（注入 5 层存储）
6. ProfileManager 创建
7. DreamingManager 创建
8. LLM Extractor 创建并注入 3 个服务
9. MemoryCaptureService 创建
10. 定时器启动（Degradation + Dreaming）

---

## 第二部分：记忆存储架构

---

### 2.1 五层存储架构

```
┌─────────────────────────────────────────────────────────────┐
│                    MemoryService                             │
│              (StorageMemoryService协调层)                    │
└──────────┬──────────┬──────────┬──────────┬────────────────┘
           │          │          │          │
    ┌──────▼──┐ ┌─────▼────┐ ┌──▼───┐ ┌──▼──────┐ ┌────────┐
    │  L1     │ │  L2      │ │ L3    │ │  L4      │ │  L5    │
    │ Cache   │ │ Vector   │ │ Meta  │ │ Palace   │ │ Graph  │
    │ Manager │ │ Store    │ │Store  │ │ Store    │ │ Store  │
    └─────────┘ └──────────┘ └───────┘ └──────────┘ └────────┘

    内存Map    LanceDB     SQLite   文件系统    SQLite
    (LRU)     (向量)     (元数据)   (JSON)    (图谱)
```

### 2.2 记忆数据结构

**完整 Memory 对象**（存储在 Cache 和 Palace）：
```typescript
{
  uid: string;                    // 永久 ID（lifelong）
  version: number;                // 版本号
  content: string;                // 完整内容
  summary: string;                // LLM 生成摘要
  type: MemoryType;               // 11 种类型
  agentId: string;
  importance: number;             // 0-10
  scopeScore: number;              // 0-10
  scope: MemoryScope;              // SESSION/AGENT/GLOBAL
  block: MemoryBlock;             // WORKING/SESSION/CORE/ARCHIVED/DELETED
  palace: PalaceLocation;        // wing/hall/room/closet 四级路径
  versionChain: VersionInfo[];    // 版本历史
  isLatestVersion: boolean;
  accessCount: number;
  recallCount: number;
  lastAccessedAt: number;
  usedByAgents: string[];
  createdAt: number;
  updatedAt: number;
  metadata: MemoryMetadata;
  tags: string[];
  lifecycle: { createdAt, events[] };
}
```

**SQLite Meta 记录**（`memory_meta` 表，22列）：
```typescript
{
  uid PK, version, agentId, sessionId, type, topicId,
  importanceScore, scopeScore, scope,
  wingId, hallId, roomId, closetId,    // Palace 路径分解
  versionChain (JSON), isLatestVersion (int), versionGroupId,
  tags (JSON), createdAt, updatedAt,
  lastRecalledAt, recallCount,
  usedByAgents (JSON),
  currentPalaceRef
}
```

**Palace 文件**：`{storagePath}/{wingId}/{hallId}/{roomId}/closet_{uid}_v{version}.json`

**Graph 节点**：`graph_nodes`（id, entity, type, uid, memoryIds JSON, properties JSON）
**Graph 边**：`graph_edges`（id, sourceId, targetId, relation, weight, temporal）

### 2.3 记忆写入流程（store）

```
用户输入 content
       │
       ▼
┌─────────────────┐
│ MemoryCapture   │ ← LLM 提取摘要/标签/重要性
│   Service       │
└────────┬────────┘
         │ ExtractedMemory
         ▼
┌─────────────────┐
│ MemoryVersion    │ ← 版本检测（0.9 阈值）
│   Manager       │ ← UID swap 机制
└────────┬────────┘
         │ 5 层协调写入
         ▼
┌─────────────────────────────────────────┐
│          MemoryStoreManager              │
│  L1: CacheManager.set()                 │
│  L2: VectorStore.storeBatch()           │
│  L3: SQLiteMetaStore.insert()            │
│  L4: PalaceStore.store()                │
│  L5: GraphStore.addMemory()             │
└─────────────────────────────────────────┘
```

### 2.4 记忆召回流程（recall）

```
RecallInput { query, agentId, sessionId, ... }
       │
       ▼
┌─────────────────────────────────────────┐
│       MemoryRecallManager.recall()        │
│                                          │
│  渐进式 Scope 扩展：                      │
│  Step 1: SESSION (agentId + sessionId)   │
│  Step 2: AGENT (agentId only)            │
│  Step 3: GLOBAL                          │
│  Step 4: OTHER_AGENTS                    │
└────────┬────────────────────────────────┘
         │ SQLite 过滤
         ▼
┌─────────────────────────────────────────┐
│  Vector Search (LanceDB)                │
│  + 可选 HybridSearch (BM25)             │
└────────┬────────────────────────────────┘
         │ 获取候选 UIDs
         ▼
┌─────────────────────────────────────────┐
│  MemoryStoreManager.getMany()           │
│  → L1 Cache hit → L3 Meta → L4 Palace   │
│  → 图谱关系丰富                          │
│  → LLM 排序/Profile 上下文注入          │
└─────────────────────────────────────────┘
```

### 2.5 版本管理机制

**UID Swap 算法**（v2.1.0）：
- 新版本生成新 UID_B，分配新 palace_B
- 旧版本 UID_A 与新版本交换
- 新版本继承 UID_A（isLatest=true），旧版本获得 UID_B（isLatest=false）

```
创建版本前的状态：
  Memory-A: uid=A, palace=A, isLatest=true
  New Content → 检测为同一记忆的更新

创建版本后：
  Memory-A' (新版本): uid=A, palace=B, isLatest=true
  Memory-B' (旧版本): uid=B, palace=A, isLatest=false
```

### 2.6 遗忘管理（Degradation）

**双评分衰减公式**：
```
effectiveImportance = max(importance - daysSinceRecalled × decayRate × archivedDecayMultiplier, 0)
effectiveScope = max(scopeScore - daysSinceRecalled × decayRate × archivedDecayMultiplier, 0)
forgetScore = effectiveImportance × 0.7 + effectiveScope × 0.3

阈值：
  deleteThreshold = 1.5  → 删除
  archiveThreshold = 3.0 → 归档
  protectLevel = 7       → 保护不降级
```

**Scope 降级**：
- SESSION → AGENT：30 天无召回 + recallCount < 3
- AGENT → GLOBAL：需人工升级

### 2.7 AAAK 压缩索引

```
格式：ENTITY|TOPICS|"key_quote"|EMOTIONS|FLAGS
示例：CHN|ai_memory+optimization|"we decided to use vector search"|determ|DECISION+TECHNICAL

用途：
1. LLM 高效扫描大量记忆（无需加载完整内容）
2. Recall 初筛（AAA 索引快速匹配）
3. Degradation 辅助计算
4. Profile 构建加速
```

---

## 第三部分：关键问题汇总

### 数据持久化风险（无重启保护）

| 组件 | 存储 | 问题 |
|------|------|------|
| InteractionRecorder | 内存 Map | 进程重启数据丢失 |
| TagManager | 内存 Map | 进程重启数据丢失 |
| ProfileCache | 内存 Map | 进程重启数据丢失 |
| DegradationManager | 内存 Map（operationLocks, scopeChangedThisCycle） | 进程重启状态丢失 |
| MemoryCaptureService | 内存 Map（versionLocks，30s TTL） | 锁仅本地有效 |
| DynamicRoomManager | 内存 Map | 房间聚类状态重启丢失 |
| MemoryRoomMapping | 内存 Map | 关联关系重启丢失 |
| SpatialIndex | 内存 Map | 空间位置重启丢失 |
| IndexUpdateStrategy | 内存 | **executeTask 是空实现**，无实际索引更新 |

### 性能问题

| 位置 | 问题 |
|------|------|
| GraphStore | `memoryIds LIKE '%uid%'` 全表扫描，无索引 |
| PalaceStore | JSON 内嵌元数据，无内容去重 |
| Capture 流程 | LLM 调用（摘要/标签/重要性）串行执行 |
| SQLiteMetaStore | 无连接池，每次操作新建连接 |
| VectorStore | fallback 内存模式无批量 API |

### 架构问题

| 位置 | 问题 |
|------|------|
| Profile 双重存储 | ProfileCache(内存) + MemoryService(SQLite) 同步复杂 |
| AAAK 未集成 | AAAK 模块存在但未在任何流程中使用 |
| 异常流控制 | `ORPHAN_VECTOR:${id}` 字符串匹配检测错误 |
| 孤儿向量 | 向量存在但元数据已删除时静默失败 |
| 两套启动路径 | `OMMS.initialize()` + `startServer()` 逻辑重复 |
