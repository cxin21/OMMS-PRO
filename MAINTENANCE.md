# OMMS-PRO 项目维护文档

> 本文档由代码审查自动生成，包含项目架构、模块关系、配置管理及已知问题。

## 项目概述

OMMS-PRO (Omniscient Memory Management System) 是一个以记忆为中心的多层存储系统，采用 5 层存储架构实现记忆的持久化管理。

### 核心特性

- **5层存储架构**: L1 Cache → L2 Vector → L3 Meta → L4 Palace → L5 Graph
- **记忆生命周期**: 捕获 → 召回 → 升级/降级 → 梦境整合 → 遗忘
- **AAAK压缩索引**: 用于LLM快速扫描大量记忆条目
- **渐进式作用域扩展**: SESSION → AGENT → GLOBAL
- **双重评分遗忘算法**: importanceScore + scopeScore + AAAK保护

---

## 目录结构

```
src/
├── core/                      # 核心类型定义
│   └── types/
│       ├── config.ts           # 配置类型
│       └── memory.ts           # 记忆类型
├── services/                   # 业务服务层
│   ├── memory/                 # 记忆服务
│   │   ├── capture/           # 记忆捕获 (MemoryCaptureService)
│   │   ├── recall/            # 记忆召回 (MemoryRecallManager)
│   │   ├── degradation/       # 记忆降级 (MemoryDegradationManager)
│   │   ├── store/             # 记忆存储 (MemoryStoreManager, MemoryVersionManager)
│   │   ├── search/            # 混合搜索 (HybridSearch)
│   │   └── aaak/              # AAAK压缩格式
│   ├── dreaming/              # 梦境管理器 (DreamingManager)
│   └── profile/                # 用户画像 (ProfileManager)
├── infrastructure/             # 基础设施层
│   └── storage/                # 存储适配器
│       └── stores/            # 存储实现
│           ├── sqlite-meta-store.ts   # L3 SQLite元存储
│           ├── vector-store.ts        # L2 向量存储 (LanceDB)
│           ├── palace-store.ts       # L4 宫殿存储 (文件系统)
│           └── graph-store.ts        # L5 知识图谱
├── presentation/               # 表现层
│   ├── mcp-server/             # MCP服务器
│   │   └── tools/             # MCP工具
│   └── plugins/claude/        # Claude插件
└── shared/                     # 共享模块
    ├── config/                 # 配置管理
    └── logging/               # 日志服务
```

---

## 5层存储架构

| 层级 | 存储类型 | 实现 | 用途 |
|------|---------|------|------|
| L1 | Cache | Memory Map | 热点记忆缓存 |
| L2 | Vector | LanceDB | 语义相似度搜索 |
| L3 | Meta | SQLite | 记忆元数据、索引 |
| L4 | Palace | 文件系统 | 原始记忆内容 |
| L5 | Graph | SQLite | 记忆关系图谱 |

### 存储调用链

```
MemoryStoreManager.store()
├── cache.set()              # L1 Cache
├── vectorStore.store()       # L2 Vector
├── metaStore.insert()        # L3 Meta
├── palaceStore.store()      # L4 Palace
└── graphStore.addMemory()   # L5 Graph
```

---

## 记忆类型

```typescript
enum MemoryType {
  FACT = 'fact',           // 事实
  EVENT = 'event',         // 事件
  DECISION = 'decision',    // 决策
  ERROR = 'error',          // 错误
  LEARNING = 'learning',    // 学习
  RELATION = 'relation',   // 关系
  IDENTITY = 'identity',    // 身份
  PREFERENCE = 'preference',// 偏好
  PERSONA = 'persona'       // 用户画像
}
```

### 记忆作用域

```typescript
enum MemoryScope {
  SESSION = 'session',     // 会话作用域
  AGENT = 'agent',         // Agent作用域
  GLOBAL = 'global'         // 全局作用域
}
```

### 记忆区块

```typescript
enum MemoryBlock {
  WORKING = 'working',     // 工作记忆
  SESSION = 'session',     // 会话记忆
  CORE = 'core',           // 核心记忆
  ARCHIVED = 'archived',   // 归档记忆
  DELETED = 'deleted'      // 已删除
}
```

---

## 记忆生命周期

### 1. 记忆捕获 (Capture)

**入口**: `MemoryCaptureService.capture()`

**流程**:
1. 增量捕获预检 (`incrementalCaptureManager.checkShouldSkip()`)
2. 内容Hash去重 (`computeContentHash()`)
3. LLM提取记忆 (`llmExtractor.extractMemories()`)
4. 置信度过滤 (默认阈值 0.5)
5. LLM评分 (importance, scopeScore)
6. 版本检测 (`versionManager.findCandidates()`)
7. 版本锁获取 (`acquireVersionLock()`)
8. 多层存储 (`MemoryStoreManager.store()`)
9. AAAK索引生成
10. 用户画像更新 (`analyzeAndUpdateProfile()`)

### 2. 记忆召回 (Recall)

**入口**: `MemoryRecallManager.recall()`

**流程**:
1. 渐进式作用域查询 (SESSION → AGENT → GLOBAL → OTHER_AGENTS)
2. SQLite候选过滤 (`metaStore.query()`)
3. AAAK预筛选 (`prescreenByAAAK()`)
4. 向量搜索 (`vectorStore.search()`)
5. BM25重排序 (`rerankWithBM25()`)
6. 强化检查 (`applyReinforcement()`)
7. 作用域升级检查 (`shouldUpgradeScope()`)

**强化算法**:
```typescript
// importance强化
boost = importance < 3 ? 0.5 : importance < 6 ? 0.3 : importance < 7 ? 0.1 : 0.2
newImportance = min(importance + boost, 10)

// 跨Agent召回强化
if (currentAgentId !== memoryAgentId) {
  scopeBoost = 0.6
}
```

### 3. 作用域升级 (Upgrade)

**条件**:
- SESSION → AGENT: `importance >= sessionUpgradeRecallThreshold` (默认5)
- AGENT → GLOBAL: `scopeScore >= upgradeScopeScoreMax AND importance >= agentUpgradeRecallThreshold`

### 4. 记忆降级 (Degradation)

**入口**: `MemoryDegradationManager.runForgettingCycle()`

**遗忘算法**:
```typescript
forgetScore = effectiveImportance * 0.7 + effectiveScope * 0.3 + aaakProtection

effectiveImportance = max(importance - daysSinceRecalled * decayRate * archivedDecayMultiplier, 0)
effectiveScope = max(scopeScore - daysSinceRecalled * decayRate * archivedDecayMultiplier, 0)
aaakProtection = min(sum(AAAKFlagProtection), 1.0)  // 仅对未归档记忆生效
```

**归档衰减加速**: 归档记忆的 `archivedDecayMultiplier = 2.0`

### 5. 梦境整合 (Dreaming Consolidation)

**入口**: `DreamingManager.dream()`

**三阶段执行**:
1. **Phase 1 (SCAN)**: 扫描候选记忆，计算碎片化指标
2. **Phase 2 (ANALYZE)**: 相似记忆分组，Union-Find算法
3. **Phase 3 (EXECUTE)**: 调用 `consolidateMemories()` 执行合并

### 6. 遗忘 (Forgetting)

**归档条件**: `forgetScore < archiveThreshold` (默认3.0)
**删除条件**: `forgetScore < deleteThreshold` (默认1.5)

---

## AAAK压缩格式

**格式**: `ENTITY|TOPICS|"key_quote"|EMOTIONS|FLAGS`

**示例**: `CHN|ai_memory+optimization|"we decided to use vector search"|determ|DECISION+TECHNICAL`

### AAAK Flag保护系数

| Flag | 保护系数 |
|------|---------|
| DECISION | 0.5 |
| PIVOT | 0.4 |
| CORE | 0.3 |
| TECHNICAL | 0.2 |

---

## 配置管理

### 配置文件

- `config.default.json`: 默认配置
- `config.json`: 用户配置 (覆盖默认)

### 关键配置路径

| 配置项 | 路径 | 默认值 |
|--------|------|--------|
| 遗忘衰减率 | `memoryService.degradation.decayRate` | 0.01 |
| 重要性权重 | `memoryService.degradation.importanceWeight` | 0.7 |
| 作用域权重 | `memoryService.degradation.scopeWeight` | 0.3 |
| 删除阈值 | `memoryService.degradation.deleteThreshold` | 1.5 |
| 归档阈值 | `memoryService.degradation.archiveThreshold` | 3.0 |
| 保护等级 | `memoryService.degradation.protectLevel` | 7 |
| SESSION升级阈值 | `memoryService.scopeDegradation.sessionUpgradeRecallThreshold` | 5 |
| AGENT升级阈值 | `memoryService.scopeDegradation.agentUpgradeRecallThreshold` | 10 |
| 向量权重 | `memoryService.recall.vectorWeight` | 0.7 |
| 关键词权重 | `memoryService.recall.keywordWeight` | 0.3 |

---

## 已知问题

### 严重问题

1. **extractionTimeout配置路径错误** (`memory-store-manager.ts:281`)
   - 当前: `config.getConfig('capture')`
   - 应改为: `config.getConfig('memoryService.capture')`

2. **HybridSearch权重硬编码** (`hybrid-search.ts`)
   - 当前使用: vectorWeight=0.6, bm25Weight=0.4
   - 配置值: vectorWeight=0.7, keywordWeight=0.3

3. **DreamingManager和ConsolidationManager配置冲突**
   - DreamingManager使用: `dreamingEngine.consolidation`
   - ConsolidationManager使用: `memoryService.consolidation`

4. **ConsolidationManager未被使用**
   - 只在 `memory/index.ts` 导出
   - 没有任何模块导入它

### 中等问题

1. **interaction-recorder.ts中await非Promise**
   - `await db.prepare(...)` 无效，应直接调用

2. **MemoryMerger配置默认值硬编码**
   - 应从 `config.default.json` 读取

3. **block-utils.ts配置路径不一致**
   - `memoryService.scopeDegradation` vs `memoryService.store.scopeUpgradeThresholds`

4. **getUserStats总是不使用缓存**
   - 总是调用 `interactionRecorder.getUserStats()` 而非先查缓存

### 低优先级问题

1. **memory_extract工具实现不完整**
   - 导入了LLM服务但未使用

2. **多个死代码方法**
   - `computeCosineSimilarity` (memory-version-manager.ts)
   - `_addMemoryToGraph` (memory-store-manager.ts)

3. **apiHost回退值不一致** (memory-tools.ts:829)
   - 代码回退: 'localhost'
   - 配置值: '0.0.0.0'

---

## 测试场景

### 10个完整记忆周期场景

1. **基本记忆生命周期**: Capture → Recall → Reinforcement
2. **作用域升级边界**: SESSION → AGENT 阈值触发
3. **时间降级**: 超过 `agentToGlobalDays` 自动降级
4. **并发版本创建**: Version Lock机制
5. **AAAK Flag保护**: DECISION/CORE标记提供额外保护
6. **梦境整合**: 碎片记忆合并
7. **用户画像联动**: IDENTITY类型触发画像更新
8. **遗忘完整周期**: Archive → Delete流程
9. **ORPHAN_VECTOR错误处理**: 向量丢失时降级处理
10. **跨Agent召回**: scopeBoost强化

---

## 编译和运行

```bash
# 编译
npm run build

# 类型检查
npx tsc --noEmit

# 运行
npm start
```

---

*文档生成时间: 2026-04-26*
