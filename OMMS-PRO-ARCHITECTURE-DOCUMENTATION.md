# OMMS-PRO 全域架构 & 业务全量文档

> 版本: v2.2.0
> 生成时间: 2026-04-28
> 用途: 断点调试、功能测试、多Agent分场景测试、项目架构重构、代码解耦优化

---

## 目录

1. [项目整体概述](#1-项目整体概述)
2. [完整项目目录&文件结构说明](#2-完整项目目录文件结构说明)
3. [全模块详细说明](#3-全模块详细说明)
4. [核心业务全流程梳理](#4-核心业务全流程梳理)
5. [关键技术与核心逻辑说明](#5-关键技术与核心逻辑说明)
6. [配置体系说明](#6-配置体系说明)
7. [LLM调用体系说明](#7-llm调用体系说明)
8. [日志&异常体系说明](#8-日志异常体系说明)
9. [全业务场景清单](#9-全业务场景清单)
10. [现有代码问题汇总](#10-现有代码问题汇总)
11. [重构&解耦前置建议](#11-重构解耦前置建议)

---

## 1. 项目整体概述

### 1.1 系统定位

**OMMS-PRO (Open Memory Management System Professional)** 是一款融合记忆宫殿架构的记忆管理系统，采用多层次存储架构实现记忆的捕获、存储、召回、升级、降级、梦境整理、遗忘等完整生命周期管理。

### 1.2 核心能力

| 能力模块 | 描述 |
|---------|------|
| 记忆捕获 | 支持短内容直接存储、长内容/对话 LLM 智能提取 |
| 记忆存储 | 5层存储架构：Cache + VectorStore + SQLite + Palace + Graph |
| 记忆召回 | 递进式作用域扩大召回（SESSION → AGENT → GLOBAL → OTHER_AGENTS） |
| 记忆升级 | 基于 importance/scopeScore 双评分的自动作用域升级 |
| 记忆降级 | 定时遗忘检查、低价值记忆归档与删除 |
| 梦境整理 | 三阶段整理：SCAN → ANALYZE → EXECUTE |
| 用户画像 | IDENTITY/PREFERENCE/PERSONA 类型的自动分析与构建 |
| 知识图谱 | 记忆关联、实体提取、关系建模 |

### 1.3 设计目标

- **高内聚低耦合**：采用 Ports & Adapters 架构，核心业务与基础设施分离
- **可配置化**：所有行为通过 ConfigManager 统一配置，禁止硬编码
- **版本化管理**：支持记忆版本链追溯
- **事务一致性**：多层存储操作的事务回滚支持

### 1.4 记忆管理核心生命周期

```
捕获 → 存储 → 召回 → 强化 → (升级/降级) → 遗忘 → 梦境整理
```

---

## 2. 完整项目目录&文件结构说明

### 2.1 顶层目录结构

```
/home/hechen/OMMS-PRO/
├── src/                          # 源代码主目录
│   ├── api/                      # REST API 层
│   ├── cli/                      # CLI 命令行入口
│   ├── config/                   # 配置管理（默认配置）
│   ├── core/                     # 核心类型与端口定义
│   ├── infrastructure/           # 基础设施层（存储、安全）
│   ├── llm/                      # LLM 调用封装
│   ├── presentation/             # 展示层（MCP Server, Web UI）
│   ├── services/                 # 业务服务层（核心逻辑）
│   ├── shared/                   # 共享模块（日志、工具、配置）
│   └── types/                    # 类型定义导出
├── data/                         # 数据存储目录
├── dist/                         # 编译输出目录
├── agents/                       # Agent 配置文件目录
├── logs/                         # 日志目录
├── config.default.json            # 默认配置文件
├── config.json                   # 用户配置文件
└── package.json
```

### 2.2 核心模块目录详情

#### `src/services/` - 业务服务层

| 目录 | 职责 | 关键文件 |
|------|------|---------|
| `memory/` | 记忆服务核心 | `index.ts`, `core/storage-memory-service.ts` |
| `memory/capture/` | 记忆捕获服务 | `memory-capture-service.ts` |
| `memory/recall/` | 记忆召回管理 | `memory-recall-manager.ts` |
| `memory/store/` | 存储协调管理 | `memory-store-manager.ts`, `memory-version-manager.ts` |
| `memory/degradation/` | 遗忘降级管理 | `memory-degradation-manager.ts` |
| `memory/llm/` | LLM 提取器兼容层 | `llm-extractor.ts` |
| `memory/analysis/` | 分析组件 | `topic-detector.ts`, `sentiment-analyzer.ts` |
| `dreaming/` | 梦境整理服务 | `dreaming-manager.ts`, `types.ts` |
| `dreaming/consolidation/` | 记忆合并 | `memory-merger.ts` |
| `dreaming/graph/` | 图谱重构 | `graph-reorganizer.ts` |
| `dreaming/storage/` | 存储优化 | `storage-optimizer.ts` |
| `profile/` | 用户画像服务 | `profile-manager.ts` |

#### `src/infrastructure/` - 基础设施层

| 目录 | 职责 | 关键文件 |
|------|------|---------|
| `storage/stores/` | 存储实现 | `cache-manager.ts`, `vector-store.ts`, `sqlite-meta-store.ts`, `palace-store.ts`, `graph-store.ts` |
| `storage/core/` | 存储核心类型 | `types.ts` |
| `storage/adapters/` | 存储适配器 | `sqlite-meta-store-adapter.ts`, `vector-store-adapter.ts` |
| `security/` | 安全控制 | `memory-access-control.ts` |
| `indexing/` | 索引更新策略 | `index-update-strategy.ts` |

#### `src/core/` - 核心定义层

| 目录 | 职责 |
|------|------|
| `ports/storage/` | 存储端口接口定义 |
| `ports/memory/` | 记忆领域端口接口定义 |
| `ports/dreaming/` | 梦境服务端口接口定义 |
| `domain/memory/` | 记忆领域策略（召回策略） |
| `types/` | 核心类型定义 |

#### `src/api/` - API 层

| 目录/文件 | 职责 |
|----------|------|
| `server.ts` | REST API 服务器主入口 |
| `router.ts` | 路由聚合 |
| `routes/memory.ts` | 记忆接口路由 |
| `routes/dreaming.ts` | 梦境接口路由 |
| `routes/profile.ts` | 画像接口路由 |
| `routes/system.ts` | 系统接口路由 |
| `routes/graph.ts` | 图谱接口路由 |
| `middleware/` | 中间件（认证、CORS、日志、限流） |
| `dto/` | 数据传输对象 |

#### `src/shared/` - 共享模块

| 目录 | 职责 |
|------|------|
| `config/` | 配置管理器核心实现 |
| `logging/` | 日志系统 |
| `utils/` | 工具函数 |
| `embedding/` | Embedding 服务 |
| `prompts/` | Prompt 模板加载 |
| `agents/` | Agent 上下文管理 |

---

## 3. 全模块详细说明

### 3.1 记忆服务模块 (Memory Service)

#### 3.1.1 StorageMemoryService (`services/memory/core/storage-memory-service.ts`)

**职责**: 记忆服务核心Facade，协调各子服务完成记忆的存取、召回、更新、删除、遗忘等操作。

**核心方法**:
| 方法 | 输入 | 输出 | 职责 |
|------|------|------|------|
| `store()` | `MemoryInput`, scores | `Memory` | 存储新记忆 |
| `recall()` | `RecallOptions` | `RecallOutput` | 递进式召回 |
| `get()` | `memoryId` | `RecallMemory` | 获取单条记忆 |
| `listMemories()` | 分页过滤选项 | `{memories, total}` | 列表记忆 |
| `update()` | `memoryId`, `MemoryUpdate` | `RecallMemory` | 更新记忆 |
| `delete()` | `memoryId` | void | 删除记忆 |
| `reinforce()` | `memoryId`, boostAmount | `RecallMemory` | 强化记忆 |
| `checkAndUpgradeScope()` | `memoryId` | boolean | 检查并升级作用域 |
| `runForgettingCycle()` | - | `ForgetReport` | 执行遗忘周期 |
| `consolidate()` | memoryId, data, options | 归纳结果 | 归纳整理记忆 |

**耦合问题**:
- 混合了存储协调、访问控制、索引更新等多重职责
- 直接依赖多个子服务实例（storeManager, recallManager, degradationManager）

#### 3.1.2 MemoryStoreManager (`services/memory/store/memory-store-manager.ts`)

**职责**: 协调各存储层（Cache、VectorStore、SQLite、Palace、Graph），将记忆写入多层存储。

**核心方法**:
| 方法 | 职责 |
|------|------|
| `store()` | 协调写入5层存储 |
| `get()` | 从缓存/元数据/内容恢复记忆 |
| `getMany()` | 批量获取记忆 |
| `delete()` | 删除记忆 |
| `update()` | 更新记忆元数据 |
| `getVersionManager()` | 获取版本管理器 |

**事务管理**: 使用 `TransactionManager` 实现多存储层事务回滚。

**耦合问题**:
- 包含 Graph 数据准备逻辑（`_prepareGraphData`），与图谱服务耦合
- 混合了版本检测、Palace位置计算、摘要生成等职责

#### 3.1.3 MemoryRecallManager (`services/memory/recall/memory-recall-manager.ts`)

**职责**: 实现递进式多作用域召回。

**召回流程**:
```
Step 1: 当前会话记忆 (SESSION + agentId + sessionId)
Step 2: 当前Agent记忆 (AGENT 或 SESSION + agentId)
Step 3: 全局记忆 (GLOBAL)
Step 4: 其他Agent记忆 (agentId != currentAgentId)
```

**核心方法**:
| 方法 | 职责 |
|------|------|
| `recall()` | 递进式召回主入口 |
| `recallByScope()` | 按作用域召回 |
| `enrichMemories()` | 补全记忆信息（Palace + Graph + VersionChain） |
| `applyReinforcement()` | 召回后强化评分 |
| `warmupCache()` | 缓存预热 |

**搜索优化**:
- AAAK 预筛选 (`prescreenByAAAK`)
- BM25 混合重排序 (`rerankWithBM25`)

**耦合问题**:
- 直接操作多个存储层（vectorStore, metaStore, palaceStore, graphStore, cacheManager）

#### 3.1.4 MemoryDegradationManager (`services/memory/degradation/memory-degradation-manager.ts`)

**职责**: 记忆遗忘与降级管理。

**核心职责**:
- 定时遗忘检查（基于访问时间、重要性衰减）
- 作用域降级（SESSION→AGENT→GLOBAL）
- 归档与删除操作
- Palace 文件迁移

**AAAK Flag 保护**: 特殊标签（`aaak:DECISION`, `aaak:CORE`等）提供遗忘保护。

#### 3.1.5 MemoryVersionManager (`services/memory/store/memory-version-manager.ts`)

**职责**: 记忆版本管理。

**版本创建流程**:
- 检测相似版本（>90% 相似度）
- 创建新版：UID 互换机制
- 归档旧版本

#### 3.1.6 MemoryCaptureService (`services/memory/capture/memory-capture-service.ts`)

**职责**: 对话内容的智能记忆捕获。

**捕获策略**:
- 短内容（<500字符）：直接存储
- 长内容/对话：使用 LLM 提取关键记忆

**包含检测**: `MemoryInclusionDetector` 避免重复捕获。

---

### 3.2 梦境整理服务模块 (Dreaming Service)

#### 3.2.1 DreamingManager (`services/dreaming/dreaming-manager.ts`)

**职责**: 记忆整理主入口，编排三阶段整理流程。

**三阶段流程**:
```
Phase 1: SCAN  - 扫描计算碎片化指标
Phase 2: ANALYZE - 分析生成处理任务
Phase 3: EXECUTE - 执行合并/归档/图谱重建
```

**核心方法**:
| 方法 | 职责 |
|------|------|
| `dream()` | 记忆整理主入口 |
| `consolidateMemories()` | 记忆归纳整理 |
| `performActiveLearning()` | 主动学习（模式发现、薄弱识别） |
| `performIncrementalGraphUpdate()` | 增量图谱更新 |

**调度器**: 基于碎片化指标触发的定时整理。

#### 3.2.2 MemoryMerger (`services/dreaming/consolidation/memory-merger.ts`)

**职责**: 相似记忆合并。

#### 3.2.3 GraphReorganizer (`services/dreaming/graph/graph-reorganizer.ts`)

**职责**: 图谱关联重建。

#### 3.2.4 StorageOptimizer (`services/dreaming/storage/storage-optimizer.ts`)

**职责**: 存储碎片整理与归档。

---

### 3.3 用户画像服务模块 (Profile Service)

#### 3.3.1 ProfileManager (`services/profile/profile-manager.ts`)

**职责**: 用户画像管理与构建。

**核心组件**:
- `PersonaBuilder`: 性格特征构建
- `PreferenceInferer`: 偏好推断
- `InteractionRecorder`: 交互记录
- `TagManager`: 标签管理
- `PrivacyManager`: 隐私管理

**画像类型**:
- IDENTITY: 身份特征
- PREFERENCE: 偏好特征
- PERSONA: 性格特征

---

### 3.4 存储服务模块 (Storage Infrastructure)

#### 3.4.1 CacheManager (`infrastructure/storage/stores/cache-manager.ts`)

**职责**: LRU/LFU 内存缓存。

**存储接口**: `ICacheManager`

#### 3.4.2 VectorStore (`infrastructure/storage/stores/vector-store.ts`)

**职责**: 基于 LanceDB 的向量存储。

**存储接口**: `IVectorStore`

**功能**: 向量存储、相似度搜索、元数据更新

#### 3.4.3 SQLiteMetaStore (`infrastructure/storage/stores/sqlite-meta-store.ts`)

**职责**: SQLite 元数据索引存储。

**存储接口**: `ISQLiteMetaStore`

**表结构**:
- `memories`: 主元数据表
- `memory_versions`: 版本历史表

#### 3.4.4 PalaceStore (`infrastructure/storage/stores/palace-store.ts`)

**职责**: 记忆宫殿文件系统存储。

**存储接口**: `IPalaceStore`

**PalaceRef 格式**: `wing/hall/room/closet_uid_v{version}.json`

#### 3.4.5 GraphStore (`infrastructure/storage/stores/graph-store.ts`)

**职责**: 知识图谱存储。

**存储接口**: `IGraphStore`

---

### 3.5 LLM 服务模块

#### 3.5.1 BaseLLMExtractor (`llm/base.ts`)

**职责**: LLM 提取器基类。

**抽象方法**:
- `extractMemories()`: 提取记忆
- `generateSummary()`: 生成摘要
- `generateScores()`: 生成评分

**具体实现**:
- `AnthropicExtractor`: Anthropic API
- `OpenAIExtractor`: OpenAI API
- `CustomExtractor`: 自定义兼容接口

---

### 3.6 API 层

#### 3.6.1 Memory Routes (`api/routes/memory.ts`)

**API 端点**:
| 方法 | 路径 | 职责 |
|------|------|------|
| GET | `/api/memories` | 获取记忆列表 |
| POST | `/api/memories/capture` | 捕获记忆 |
| POST | `/api/memories/recall` | 召回记忆 |
| GET | `/api/memories/:id` | 获取单条记忆 |
| PUT | `/api/memories/:id` | 更新记忆 |
| DELETE | `/api/memories/:id` | 删除记忆 |
| POST | `/api/memories/reinforce/:id` | 强化记忆 |
| POST | `/api/memories/forgetting-cycle` | 执行遗忘周期 |

---

## 4. 核心业务全流程梳理

### 4.1 记忆捕获流程

```
用户输入内容
    ↓
检测内容长度 (>=500 字符为对话)
    ↓
┌────────────────────────────────────┐
│ 短内容 (<500)                       │
│  → 直接存储，使用默认评分             │
├────────────────────────────────────┤
│ 长内容/对话 (>=500)                  │
│  → MemoryCaptureService.capture()   │
│     → LLM Extractor 提取关键记忆    │
│     → 包含检测 (避免重复)            │
│     → 循环处理每条提取结果            │
└────────────────────────────────────┘
    ↓
创建 MemoryInput
    ↓
StorageMemoryService.store()
    ↓
MemoryStoreManager.store()
    ├→ 版本检测 (detectVersion)
    ├→ 摘要生成 (generateSummary) [LLM]
    ├→ 标签提取 (extractTags) [LLM]
    ├→ Palace 位置计算
    ├→ 向量化 (embedder)
    ├→ 5层存储事务写入:
    │   ├→ Cache.set()
    │   ├→ VectorStore.store()
    │   ├→ SQLiteMetaStore.insert()
    │   ├→ PalaceStore.store()
    │   └→ GraphStore.addMemory()
    └→ 返回 Memory 对象
```

### 4.2 记忆召回流程

```
MemoryRecallManager.recall()
    ↓
构建 queryVector (如果提供 query)
    ↓
递进式作用域召回:
┌─────────────────────────────────────┐
│ Step 1: SESSION                     │
│  - SQLiteMetaStore.query(scope=SESSION) │
│  - AAAK 预筛选                       │
│  - VectorStore.search()              │
│  - BM25 混合重排序                   │
├─────────────────────────────────────┤
│ Step 2: AGENT (未达最小召回数)       │
├─────────────────────────────────────┤
│ Step 3: GLOBAL (未达最小召回数)      │
├─────────────────────────────────────┤
│ Step 4: OTHER_AGENTS (未达最小召回数)│
└─────────────────────────────────────┘
    ↓
enrichMemories() - 补全信息
    ├→ PalaceStore.retrieveMany() 获取内容
    ├→ GraphStore 批量获取关联
    └→ 派生 versionChain, block 等
    ↓
filterByImportance() - 重要性过滤
    ↓
sortMemories() - 排序
    ↓
applyReinforcement() - 强化评分 (异步)
    ↓
warmupCache() - 缓存预热 (异步)
    ↓
返回 RecallOutput
```

### 4.3 梦境整理流程

```
DreamingManager.dream()
    ↓
┌─────────────────────────────────────┐
│ Phase 1: SCAN                       │
│  - calculateFragmentation() 计算指标  │
│  - findCandidates() 查找候选记忆     │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Phase 2: ANALYZE                    │
│  - MemoryMerger.findSimilarGroups()  │
│  - GraphReorganizer 分析图谱          │
│  - StorageOptimizer 归档候选          │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Phase 3: EXECUTE                    │
│  - 并行执行:                         │
│    ├→ MemoryMerger.mergeGroup()      │
│    ├→ GraphReorganizer.rebuildRelation() │
│    └→ StorageOptimizer.archiveMemories() │
│  - consolidateMemories() 每日归纳     │
└─────────────────────────────────────┘
    ↓
返回 OrganizationReport
```

### 4.4 遗忘与降级流程

```
MemoryDegradationManager
    ↓
┌─────────────────────────────────────┐
│ 遗忘周期 (定时)                      │
│  - 查询低访问记忆                     │
│  - 计算遗忘分数                        │
│  - 保护 AAAK Flag 记忆               │
│  - 归档 (score <= archiveThreshold)  │
│  - 删除 (score <= deleteThreshold)   │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ 作用域降级周期 (定时)                 │
│  - SESSION → AGENT (7天未访问)       │
│  - AGENT → GLOBAL (30天未访问)        │
│  - 执行 Palace 迁移                   │
└─────────────────────────────────────┘
```

---

## 5. 关键技术与核心逻辑说明

### 5.1 存储架构设计

**5层存储架构**:

```
┌─────────────────────────────────────────────────────────────┐
│                    Storage Architecture                       │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: Cache (内存缓存)                                  │
│  - ICacheManager                                           │
│  - LRU/LFU 驱逐策略                                         │
│  - 快速访问、热数据                                          │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Vector Store (向量存储 - LanceDB)                │
│  - IVectorStore                                            │
│  - 语义相似度搜索                                            │
│  - 元数据索引 (importance, scope, tags...)                  │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: SQLite Meta Store (关系索引)                     │
│  - ISQLiteMetaStore                                        │
│  - 高效条件过滤查询                                          │
│  - 版本链管理                                               │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: Palace Store (文件系统)                           │
│  - IPalaceStore                                            │
│  - 原始内容持久化                                            │
│  - 层级化路径 (wing/hall/room/closet)                      │
├─────────────────────────────────────────────────────────────┤
│  Layer 5: Graph Store (知识图谱)                             │
│  - IGraphStore                                             │
│  - 实体-关系建模                                            │
│  - 关联发现                                                 │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 数据分层规则

**作用域分层 (MemoryScope)**:
| Scope | 描述 | 存储路径 |
|-------|------|---------|
| SESSION | 会话级记忆 | `session_{sessionId}/` |
| AGENT | Agent级记忆 | `agent_{agentId}/` |
| GLOBAL | 全局记忆 | `global/` |

**存储区块分层 (MemoryBlock)**:
| Block | 描述 | Importance 阈值 |
|-------|------|---------------|
| CORE | 核心记忆 | >= 7 |
| WORKING | 工作记忆 | >= 4 |
| ARCHIVED | 归档记忆 | < 4 |

**Profile 类型**:
- 使用固定 `wing_profile` 路径
- IDENTITY/PREFERENCE/PERSONA 类型记忆

### 5.3 事务回滚机制

`TransactionManager` (`services/memory/utils/transaction-manager.ts`) 提供多存储层事务支持:

```typescript
const tx = txManager.beginTransaction();
txManager.registerOperation(tx.id, {
  layer: 'vector',
  operation: 'insert',
  targetId: memory.uid,
  commit: () => vectorStore.store(vectorDoc),
  rollback: () => vectorStore.delete(memory.uid),
});
// ... 更多操作
await txManager.commit(tx.id);  // 全部成功
// 或
await txManager.rollback(tx.id);  // 全部回滚
```

### 5.4 递进式作用域扩大召回

```typescript
// 召回优先级配置
const scopePriority = [
  MemoryScope.SESSION,    // 1. 当前会话
  MemoryScope.AGENT,       // 2. 当前Agent
  MemoryScope.GLOBAL,      // 3. 全局
  // 4. 其他Agent (通过 agentIdNotEq)
];
```

### 5.5 作用域升级规则

**双评分升级算法**:
```typescript
// SESSION → AGENT
if (scope === SESSION && importance >= 5) → AGENT

// AGENT → GLOBAL
if (scope === AGENT && scopeScore >= 10 && importance >= 7) → GLOBAL
```

---

## 6. 配置体系说明

### 6.1 配置读取层级

```
config.json (用户配置)
    ↓ (覆盖)
config.default.json (默认配置)
    ↓ (覆盖)
代码中的 MemoryDefaults (硬编码兜底)
```

### 6.2 核心配置项

#### 6.2.1 顶级配置

| 配置路径 | 类型 | 默认值 | 描述 |
|----------|------|--------|------|
| `agentId` | string | "default-agent" | Agent标识 |
| `sessionPrefix` | string | "session-" | 会话ID前缀 |

#### 6.2.2 Memory Service 配置

| 配置路径 | 默认值 | 描述 |
|----------|--------|------|
| `memoryService.store.defaultImportance` | 5 | 默认重要性 |
| `memoryService.store.defaultScopeScore` | 5 | 默认作用域评分 |
| `memoryService.store.scopeUpgradeThresholds.sessionToAgentImportance` | 5 | 会话升级阈值 |
| `memoryService.recall.defaultLimit` | 20 | 默认召回数量 |
| `memoryService.recall.vectorWeight` | 0.7 | 向量搜索权重 |
| `memoryService.recall.keywordWeight` | 0.3 | 关键词权重 |
| `memoryService.cache.maxSize` | 1000 | 缓存最大条目 |
| `memoryService.cache.ttl` | 3600000 | 缓存TTL (ms) |
| `memoryService.forget.checkInterval` | 86400000 | 遗忘检查间隔 (ms) |
| `memoryService.capture.conversationThreshold` | 500 | 对话检测阈值 |

#### 6.2.3 Dreaming Engine 配置

| 配置路径 | 默认值 | 描述 |
|----------|--------|------|
| `dreamingEngine.scheduler.autoOrganize` | true | 自动整理 |
| `dreamingEngine.scheduler.organizeInterval` | 21600000 | 整理间隔 (6h) |
| `dreamingEngine.consolidation.similarityThreshold` | 0.85 | 合并相似度阈值 |
| `dreamingEngine.activeLearning.enabled` | true | 主动学习开关 |

#### 6.2.4 Embedding 配置

| 配置路径 | 默认值 | 描述 |
|----------|--------|------|
| `embedding.model` | "text-embedding-3-small" | Embedding模型 |
| `embedding.dimensions` | 1536 | 向量维度 |

### 6.3 配置读取方式

```typescript
// 方式1: config 单例 (主推)
import { config } from './shared/config';
const value = config.getConfig<string>('path.to.key');

// 方式2: ConfigManager 实例
const configManager = ConfigManager.getInstance();
const value = configManager.getConfig<number>('memoryService.cache.maxSize');

// 方式3: 工具函数
import { getConfig } from './config';
const value = getConfig<number>('memoryService.recall.defaultLimit', 20);
```

### 6.4 硬编码问题汇总

| 文件 | 位置 | 问题 | 建议 |
|------|------|------|------|
| `storage-memory-service.ts` | L313 | `defaultSessionId = 'default-session'` | 移至配置 |
| `memory-recall-manager.ts` | L261-277 | `DEFAULT_RECALL_CONFIG` 硬编码 | 使用配置管理 |
| `memory-degradation-manager.ts` | 多处 | 定时器间隔硬编码 | 移至配置 |
| `llm/base.ts` | 多处 | temperature/maxTokens 硬编码 | 移至配置 |

---

## 7. LLM调用体系说明

### 7.1 LLM 模块架构

```
src/llm/
├── base.ts           # BaseLLMExtractor 基类
├── anthropic.ts      # Anthropic 实现
├── openai.ts         # OpenAI 实现
├── custom.ts         # 自定义兼容实现
├── factory.ts        # LLM 工厂
├── types.ts          # 类型定义
└── index.ts          # 统一导出
```

### 7.2 核心接口

```typescript
interface ILLMExtractor {
  extractMemories(text: string, options: {...}): Promise<ExtractedMemory[]>;
  generateSummary(content: string): Promise<string>;
  generateScores(content: string): Promise<ScoringResult>;
  extractEntities(content: string): Promise<Entity[]>;
  consolidateMemories(memories: string[]): Promise<ConsolidationResult>;
  // ...更多方法
}
```

### 7.3 LLM 调用散落位置

| 位置 | 调用内容 | 问题 |
|------|---------|------|
| `MemoryStoreManager.generateSummary()` | 摘要生成 | 强制依赖 |
| `MemoryStoreManager.store()` | 标签提取 | 可选 |
| `MemoryMerger.consolidateGroup()` | 记忆合并 | 条件依赖 |
| `DreamingManager.dream()` | 模式发现 | 主动学习 |
| `ProfileManager` | Persona构建 | Profile模块内部 |
| `entity-extraction` prompt | 实体提取 | Graph数据准备 |

### 7.4 统一收拢建议

**建议1**: 创建统一的 `LLMService` 中心化模块:
```typescript
// src/services/llm/llm-service.ts
class LLMService {
  private extractors: Map<LLMProvider, ILLMExtractor>;

  async summarize(content: string): Promise<string>;
  async extractMemories(content: string, options: {...}): Promise<ExtractedMemory[]>;
  async score(content: string): Promise<ScoringResult>;
  async extractEntities(content: string): Promise<Entity[]>;
}
```

**建议2**: 通过依赖注入传入 LLM 服务，而非散落调用。

---

## 8. 日志&异常体系说明

### 8.1 日志模块架构

```
src/shared/logging/
├── context.ts        # 日志上下文
├── types.ts         # 日志类型
├── logger.ts         # Logger 实现
└── transports/      # 传输层
```

### 8.2 日志级别

| 级别 | 用途 | 使用场景 |
|------|------|---------|
| `error` | 错误 | 操作失败、异常 |
| `warn` | 警告 | 可恢复错误、降级处理 |
| `info` | 信息 | 关键操作完成 |
| `debug` | 调试 | 详细执行流程 |

### 8.3 日志埋点位置

**Service Logger**:
```typescript
import { createServiceLogger } from './shared/logging';
const logger = createServiceLogger('StorageMemoryService');

// 使用
logger.info('store 方法调用', { memoryId: 'xxx' });
logger.error('store 方法失败', error);
```

**关键埋点**:
| 模块 | 方法 | 埋点 |
|------|------|------|
| StorageMemoryService | store | 调用入口、返回、错误 |
| StorageMemoryService | recall | 调用入口、返回、错误 |
| MemoryRecallManager | recall | 递进步骤、结果 |
| MemoryDegradationManager | runForgettingCycle | 执行统计 |
| DreamingManager | dream | 三阶段开始/结束 |

### 8.4 异常处理

**存储层异常**:
```typescript
// SQLiteError
export class SQLiteError extends Error {
  constructor(message: string, operation: string, context?: Record<string, unknown>)
}
```

**异常处理策略**:
1. 存储操作: 事务回滚
2. LLM 调用: 降级处理（使用 fallback）
3. 向量化失败: 使用零向量，继续存储

### 8.5 日志缺失点位

| 场景 | 状态 |
|------|------|
| 缓存命中/未命中 | 有埋点 |
| 向量搜索结果 | 有埋点 |
| 事务回滚 | 有埋点 |
| 配置加载 | **缺失** |
| Agent 上下文加载 | **缺失** |

---

## 9. 全业务场景清单

### 9.1 独立场景

#### 9.1.1 记忆捕获场景

| 场景ID | 场景名称 | 输入 | 预期输出 |
|--------|---------|------|---------|
| CAP-001 | 短内容直接存储 | "今天天气真好" | 记忆创建成功 |
| CAP-002 | 长对话LLM提取 | 1000字符对话 | 提取关键记忆 |
| CAP-003 | Base64编码内容 | Base64字符串 | 解码后存储 |
| CAP-004 | 指定类型存储 | type=IDENTITY | Profile类型记忆 |
| CAP-005 | 指定标签存储 | tags=["工作"] | 标签关联成功 |

#### 9.1.2 记忆召回场景

| 场景ID | 场景名称 | 输入 | 预期输出 |
|--------|---------|------|---------|
| REC-001 | 基础语义召回 | query="天气" | 相关记忆 |
| REC-002 | 作用域过滤 | scope=SESSION | 仅会话记忆 |
| REC-003 | 类型过滤 | type=FACT | 仅事实记忆 |
| REC-004 | 标签过滤 | tags=["工作"] | 标签匹配 |
| REC-005 | 时间范围 | timeRange={from,to} | 范围记忆 |
| REC-006 | 批量获取 | UIDs=[...] | 批量记忆 |
| REC-007 | 列表获取 | limit=50, offset=0 | 分页列表 |

#### 9.1.3 记忆更新场景

| 场景ID | 场景名称 | 输入 | 预期输出 |
|--------|---------|------|---------|
| UPD-001 | 更新内容 | content="新内容" | 创建新版本 |
| UPD-002 | 更新评分 | importance=8 | 评分更新 |
| UPD-003 | 作用域升级 | scope=GLOBAL | 作用域变更+Palace迁移 |
| UPD-004 | 添加标签 | tags=["新标签"] | 标签追加 |

#### 9.1.4 记忆遗忘场景

| 场景ID | 场景名称 | 触发条件 | 预期行为 |
|--------|---------|---------|---------|
| FOR-001 | 遗忘周期执行 | 定时器触发 | 低价值记忆归档 |
| FOR-002 | 作用域降级 | 30天未访问 | SESSION→AGENT |
| FOR-003 | AAAK保护 | 标签含aaak:DECISION | 跳过遗忘 |
| FOR-004 | 彻底删除 | deleteThreshold=1 | 永久删除 |

#### 9.1.5 梦境整理场景

| 场景ID | 场景名称 | 输入 | 预期输出 |
|--------|---------|------|---------|
| DRM-001 | 全量整理 | type=ALL | 三阶段执行 |
| DRM-002 | 仅合并 | type=CONSOLIDATION | 相似记忆合并 |
| DRM-003 | 仅图谱重构 | type=REORGANIZATION | 关联重建 |
| DRM-004 | 仅归档 | type=ARCHIVAL | 低价值归档 |
| DRM-005 | 主动学习 | performActiveLearning | 模式+薄弱识别 |

### 9.2 混合场景

| 场景ID | 场景名称 | 组合场景 |
|--------|---------|---------|
| MIX-001 | 捕获+召回+强化 | 完整记忆使用流程 |
| MIX-002 | 更新+版本+召回 | 版本链追溯 |
| MIX-003 | 遗忘+梦境整理 | 清理+优化协同 |
| MIX-004 | 用户画像+记忆关联 | Profile与Memory联动 |

### 9.3 边界场景

| 场景ID | 场景名称 | 边界条件 |
|--------|---------|---------|
| BND-001 | 空内容存储 | 抛出错误 |
| BND-002 | 超长内容 | LLM截断或分片 |
| BND-003 | 重复内容 | 版本创建而非新建 |
| BND-004 | 无效类型 | 使用默认类型 |
| BND-005 | 配置未初始化 | 抛出错误禁止硬编码 |

### 9.4 异常场景

| 场景ID | 场景名称 | 异常条件 |
|--------|---------|---------|
| ERR-001 | LLM调用失败 | 网络错误、超时 |
| ERR-002 | 向量化失败 | 模型不可用 |
| ERR-003 | 存储层故障 | 数据库错误 |
| ERR-004 | 事务回滚 | 部分写入失败 |
| ERR-005 | 内存不足 | Cache满、Graph大 |

---

## 10. 现有代码问题汇总

### 10.1 高耦合点位

| 位置 | 耦合问题 | 建议 |
|------|---------|------|
| `StorageMemoryService` | 混合访问控制、索引更新、存储协调 | 拆分为Facade+策略模式 |
| `MemoryStoreManager` | 混合Graph数据准备、版本管理、存储协调 | 按职责拆分 |
| `MemoryRecallManager` | 直接依赖5个存储层 | 通过Port接口解耦 |
| `DreamingManager` | 直接持有所有服务实例 | 通过依赖注入 |

### 10.2 职责不清晰

| 位置 | 问题 | 建议 |
|------|------|------|
| `StorageMemoryService` | 同时是Facade又是实现 | 分离接口与实现 |
| `MemoryStoreManager` | 包含Graph准备逻辑 | 移至GraphStore相关 |
| 工具函数散落 | `block-utils.ts`, `memory-config-utils.ts` | 归集到配置或Utils |

### 10.3 跨模块乱调用

| 调用链 | 问题 |
|--------|------|
| API → MemoryService → StoreManager → VersionManager | 调用链过长 |
| API → MemoryService → DegradationManager | 直接调用子服务 |
| API → DreamingManager → MemoryMerger → MemoryService | 循环依赖风险 |

### 10.4 冗余逻辑

| 位置 | 冗余 |
|------|------|
| `generateSummary` 分散 | MemoryStoreManager, LLMExtractor都有 |
| 作用域计算逻辑 | StorageMemoryService, MemoryRecallManager各有一份 |
| 配置读取 | 散落在多个文件 |

### 10.5 硬编码问题

| 位置 | 硬编码值 | 应迁移至 |
|------|---------|---------|
| 多处 | `'default-session'` | 配置 |
| 多处 | `0.5`, `200` | MemoryDefaults |
| 多处 | 定时器间隔 | 配置 |

---

## 11. 重构&解耦前置建议

### 11.1 模块拆分方案

#### 方案1: 按领域拆分

```
src/
├── domain/
│   ├── memory/           # 记忆领域（核心业务）
│   │   ├── ports/        # 领域端口
│   │   ├── entities/    # 领域实体
│   │   └── services/   # 领域服务
│   ├── profile/         # 画像领域
│   └── dreaming/        # 梦境领域
├── infrastructure/       # 基础设施（不变）
│   ├── storage/
│   ├── llm/
│   └── security/
├── application/          # 应用层（用例编排）
│   ├── memory/
│   └── profile/
└── interface/            # 接口层（API/CLI）
```

#### 方案2: 洋葱架构

```
┌─────────────────────────────────────────┐
│           Interface Layer (API)         │
├─────────────────────────────────────────┤
│           Application Layer             │
│    (Use Cases, Commands, Queries)       │
├─────────────────────────────────────────┤
│            Domain Layer                 │
│     (Entities, Value Objects,          │
│      Domain Services, Ports)            │
├─────────────────────────────────────────┤
│          Infrastructure Layer            │
│   (Adapters: Storage, LLM, Security)    │
└─────────────────────────────────────────┘
```

### 11.2 统一收拢清单

| 类别 | 收拢目标 | 操作 |
|------|---------|------|
| 配置 | `ConfigManager` | 所有配置通过统一入口 |
| LLM调用 | `LLMService` | 中心化LLM调用 |
| 存储 | `IRepository` ports | 通过接口访问 |
| 日志 | `createLogger` | 统一日志创建 |
| 异常 | `OMMSError` | 统一异常类型 |

### 11.3 具体重构步骤

**Step 1: 配置统一**
- [ ] 将所有硬编码默认值迁移至 `MemoryDefaults`
- [ ] 统一配置读取入口，禁止直接访问 `config.getConfig`
- [ ] 添加配置验证器

**Step 2: LLM调用统一**
- [ ] 创建 `LLMService` 中心化服务
- [ ] 迁移所有 LLM 调用至该服务
- [ ] 添加 LLM 调用中间件（日志、监控、降级）

**Step 3: 存储层解耦**
- [ ] 定义 `IMemoryRepository` port
- [ ] 实现 `StorageMemoryRepository` 适配器
- [ ] 移除服务层对具体存储的直接依赖

**Step 4: 服务层拆分**
- [ ] 将 `StorageMemoryService` 拆分为:
  - `MemoryFacade`: API 入口
  - `RecallService`: 召回逻辑
  - `DegradationService`: 遗忘逻辑
- [ ] 提取公共 `Storage协调器`

**Step 5: 依赖注入**
- [ ] 引入 IoC 容器
- [ ] 将所有服务实例化逻辑归集
- [ ] 便于测试 Mock

### 11.4 风险评估

| 重构项 | 风险等级 | 风险描述 | 缓解措施 |
|--------|---------|---------|---------|
| 配置统一 | 中 | 可能有遗漏的硬编码 | 全面搜索 `??` 操作符 |
| LLM统一 | 高 | 涉及多个调用点 | 逐步迁移，保持兼容 |
| 存储解耦 | 高 | 事务边界改变 | 保留现有事务机制 |
| 服务拆分 | 中 | 接口变更影响大 | 保持Facade向后兼容 |

---

## 附录

### A. 关键文件索引

| 文件路径 | 行数 | 核心功能 |
|---------|------|---------|
| `src/index.ts` | 441 | OMMS主入口、初始化 |
| `src/services/memory/core/storage-memory-service.ts` | 1187 | 记忆服务核心 |
| `src/services/dreaming/dreaming-manager.ts` | 2064 | 梦境整理核心 |
| `src/services/memory/recall/memory-recall-manager.ts` | 1384 | 召回管理 |
| `src/services/memory/store/memory-store-manager.ts` | 1301 | 存储协调 |
| `src/infrastructure/storage/stores/sqlite-meta-store.ts` | ~1000+ | SQLite存储 |
| `src/llm/base.ts` | 516 | LLM基类 |

### B. 端口接口定义

| Port | 定义位置 | 实现 |
|------|---------|------|
| `ICacheManager` | `core/ports/storage/index.ts` | `CacheManager` |
| `IVectorStore` | `core/ports/storage/index.ts` | `VectorStore` |
| `IMetaStore` | `core/ports/storage/index.ts` | `SQLiteMetaStore` |
| `IPalaceStore` | `core/ports/storage/index.ts` | `PalaceStore` |
| `IGraphStore` | `core/ports/storage/index.ts` | `GraphStore` |
| `IMemoryRepository` | `core/ports/memory/index.ts` | `MemoryStoreManager` |

### C. 配置路径常量

| 常量 | 值 |
|------|---|
| `ConfigPaths.memory.store` | `memoryService.store` |
| `ConfigPaths.memory.recall` | `memoryService.recall` |
| `ConfigPaths.memory.cache` | `memoryService.cache` |
| `ConfigPaths.memory.degradation` | `memoryService.degradation` |
| `ConfigPaths.llmExtractor` | `memoryService.llmExtractor` |

---

*文档版本: v1.0*
*最后更新: 2026-04-28*
