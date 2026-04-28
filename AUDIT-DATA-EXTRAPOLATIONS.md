# OMMS-PRO 记忆周期数据推演报告

## 概述

本文档包含10套完整的记忆生命周期数据推演，覆盖：
- 独立业务场景（记忆捕获、召回、版本、遗忘、梦境等）
- 混合交叉场景（跨模块业务流程）
- 异常分支场景（边界条件和异常处理）
- 边界分支场景（阈值边界条件）

---

## 场景一：记忆捕获流程（Memory Capture）

### 1.1 完整数据流

```
用户输入 → captureIncrementalMemory() → LLMExtractor → 置信度过滤 → 内容去重 → 版本检测 → AAAK索引生成 → 多级存储
```

### 1.2 数据转换详情

#### 阶段1：输入处理
```
输入: {
  content: "用户说今天天气很好，想去公园散步",
  agentId: "agent-001",
  type: "event",
  sessionId: "session-123"
}

MemoryInput: {
  content: "用户说今天天气很好，想去公园散步",
  agentId: "agent-001",
  type: MemoryType.EVENT,
  sessionId: "session-123",
  metadata: {
    source: "conversation",
    timestamp: 1745846400000
  }
}
```

#### 阶段2：LLM提取
```
LLMExtractor.extract() 输入:
{
  content: "用户说今天天气很好，想去公园散步",
  agentId: "agent-001",
  sessionId: "session-123",
  options: {
    extractionTimeout: 30000 (配置: memoryService.capture.extractionTimeout)
  }
}

LLMExtractor.extract() 输出:
{
  summary: "用户因天气好想去公园散步",
  importance: 5 (默认: memoryService.store.defaultImportance),
  scopeScore: 5 (默认: memoryService.store.defaultScopeScore),
  confidence: 0.85,
  keywords: ["天气", "公园", "散步"],
  type: "event"
}
```

#### 阶段3：置信度过滤
```
confidenceThreshold: 0.5 (配置: memoryService.capture.confidenceThreshold)

判断: 0.85 >= 0.5 → 通过
```

#### 阶段4：内容去重
```
内容哈希计算: SHA256("用户说今天天气很好，想去公园散步")
            = "a7b3c..."

contentHashCacheSize: 1000 (配置: memoryService.capture.contentHashCacheSize)

检查: 缓存中存在? → 否 → 继续
```

#### 阶段5：版本检测
```
versionLockTTLMs: 30000 (配置: memoryService.capture.versionLockTTLMs)
maxVersionLocks: 100 (配置: memoryService.capture.maxVersionLocks)

检查: 是否存在相似记忆?
- 计算向量相似度 (使用 embedding.dimensions=1536)
- similarityThreshold: 0.9 (配置: memoryService.version.similarityThreshold)

判断: 无相似记忆 → 创建新记忆 v1
```

#### 阶段6：AAAK索引生成
```
AgentAugmentedAutonomousKnowledge Index:
{
  indexId: "aaak-{shortId}",
  keywords: ["天气", "公园", "散步"],
  entityTypes: ["activity", "location"],
  topicVector: [0.2, -0.1, 0.8, ...], // 1536维
  agentId: "agent-001",
  createdAt: 1745846400000
}
```

#### 阶段7：多级存储

**L1 Cache:**
```
Cache.put(memoryId, {
  id: memoryId,
  summary: "用户因天气好想去公园散步",
  importance: 5,
  lastAccessedAt: 1745846400000
})
ttl: 3600000 (配置: memoryService.cache.ttl)
```

**L2 Vector Store (LanceDB):**
```
VectorDocument: {
  id: memoryId,
  vector: [0.1, -0.2, 0.5, ...], // 1536维
  metadata: {
    type: "event",
    agentId: "agent-001",
    keywords: ["天气", "公园", "散步"]
  }
}
```

**L3 SQLite Meta Store:**
```
MemoryMetaRecord: {
  uid: memoryId,
  version: 1,
  content: "用户说今天天气很好，想去公园散步",
  summary: "用户因天气好想去公园散步",
  type: "event",
  agentId: "agent-001",
  importance: 5,
  scopeScore: 5,
  scope: "session",
  block: "working",
  palace: {
    wingId: "session",
    hallId: "events",
    roomId: "room-{hash}",
    closetId: memoryId
  },
  accessCount: 0,
  recallCount: 0,
  lastAccessedAt: 1745846400000,
  createdAt: 1745846400000,
  updatedAt: 1745846400000
}
```

**L4 Palace Store (文件系统):**
```
文件路径: ./data/palace/session/events/{room-hash}/{memoryId}.json
内容: {
  uid: memoryId,
  version: 1,
  content: "用户说今天天气很好，想去公园散步",
  metadata: { ... }
}
```

### 1.3 配置使用清单

| 配置路径 | 值 | 使用位置 |
|---------|-----|---------|
| memoryService.capture.extractionTimeout | 30000 | LLMExtractor |
| memoryService.capture.confidenceThreshold | 0.5 | 置信度过滤 |
| memoryService.capture.contentHashCacheSize | 1000 | 内容去重 |
| memoryService.capture.versionLockTTLMs | 30000 | 版本锁 |
| memoryService.capture.maxVersionLocks | 100 | 版本锁 |
| memoryService.version.similarityThreshold | 0.9 | 版本检测 |
| memoryService.store.defaultImportance | 5 | 评分 |
| memoryService.store.defaultScopeScore | 5 | 评分 |
| memoryService.cache.ttl | 3600000 | L1缓存 |
| embedding.dimensions | 1536 | 向量维度 |

### 1.4 异常分支

| 场景 | 条件 | 处理 |
|-----|------|------|
| LLM超时 | extractionTimeout到达 | AbortController中断，返回null |
| 置信度不足 | confidence < 0.5 | 静默跳过，不创建记忆 |
| 内容重复 | contentHash已存在 | 复用现有记忆 |
| 版本锁满 | maxVersionLocks=100已满 | 等待或跳过 |
| 配置未初始化 | ConfigManager未init | 抛出错误 |

---

## 场景二：记忆召回流程（Memory Recall）

### 2.1 完整数据流

```
查询请求 → AAAK预筛选 → 渐进式范围搜索(SESSION→AGENT→GLOBAL) → 混合搜索 → BM25重排 → 强化应用 → 缓存
```

### 2.2 数据转换详情

#### 阶段1：渐进式范围搜索

**第一轮：SESSION范围**
```
scope: SESSION
时间范围: sessionToAgentDays = 7 (配置: memoryService.scopeDegradation.sessionToAgentDays)

查询条件:
- scope = "session"
- agentId = "agent-001"
- lastAccessedAt > (now - 7*24*60*60*1000)

结果: 15条记忆 (假设)
```

**第二轮：AGENT范围（若SESSION不足）**
```
scope: AGENT
时间范围: agentToGlobalDays = 30 (配置: memoryService.scopeDegradation.agentToGlobalDays)

查询条件:
- scope = "agent"
- agentId = "agent-001"
- lastAccessedAt > (now - 30*24*60*60*1000)

结果: 8条新记忆
```

**第三轮：GLOBAL范围（若仍不足）**
```
scope: GLOBAL
时间范围: globalToAgentDays = 365 (配置: memoryService.scopeDegradation.globalToAgentDays)

查询条件:
- scope = "global"
- lastAccessedAt > (now - 365*24*60*60*1000)

结果: 12条新记忆
```

#### 阶段2：AAAK预筛选
```
Pre-screening Query:
{
  keywords: ["公园", "散步"],
  agentId: "agent-001",
  type: "event",
  minScore: 0.5 (配置: memoryService.recall.minScore)
}

筛选结果: 从35条中筛选出20条相关记忆
```

#### 阶段3：混合搜索

**向量搜索 (vectorWeight = 0.7)**
```
queryVector: embed("用户想去公园散步")
           = [0.2, -0.1, 0.5, ...] // 1536维

向量相似度计算: cosineSimilarity(queryVector, memoryVector)

Top结果:
- memoryId-001: 0.92
- memoryId-015: 0.88
- memoryId-008: 0.85
```

**关键词搜索 (keywordWeight = 0.3)**
```
BM25参数:
- k1: 1.5
- b: 0.75 (配置: memoryService.recall.bm25B)

关键词匹配: "公园" in content
BM25分数:
- memoryId-001: 7.2
- memoryId-003: 6.8
- memoryId-015: 5.9
```

**混合评分**
```
finalScore = 0.7 * vectorScore + 0.3 * bm25Score
           = 0.7 * 0.92 + 0.3 * 7.2/10
           = 0.644 + 0.216
           = 0.86
```

#### 阶段4：强化应用
```
Reinforcement Boost (回忆后强化):
{
  lowBoostThreshold: 3 (配置: memoryService.reinforcement.lowBoostThreshold)
  mediumBoostThreshold: 6 (配置: memoryService.reinforcement.mediumBoostThreshold)
  highBoostThreshold: 7 (配置: memoryService.reinforcement.highBoostThreshold)

  lowBoost: 0.5
  mediumBoost: 0.3
  highBoost: 0.1
  defaultBoost: 0.2

  maxImportance: 10 (配置: memoryService.reinforcement.maxImportance)
}

假设记忆importance=5:
- recallCount从2增加到3
- importance计算: 5 + 0.5 = 5.5 (因为recallCount=3达到lowBoostThreshold)
- importance上限检查: min(5.5, 10) = 5.5
```

#### 阶段5：缓存更新
```
Cache.put(memoryId, {
  ...memory,
  accessCount: accessCount + 1,
  lastAccessedAt: now,
  importance: 5.5
})
```

### 2.3 配置使用清单

| 配置路径 | 值 | 使用位置 |
|---------|-----|---------|
| memoryService.recall.defaultLimit | 20 | 结果数量限制 |
| memoryService.recall.maxLimit | 100 | 上限检查 |
| memoryService.recall.minScore | 0.5 | 预筛选 |
| memoryService.recall.vectorWeight | 0.7 | 混合评分 |
| memoryService.recall.keywordWeight | 0.3 | 混合评分 |
| memoryService.recall.bm25B | 0.75 | BM25计算 |
| memoryService.scopeDegradation.sessionToAgentDays | 7 | SESSION范围 |
| memoryService.scopeDegradation.agentToGlobalDays | 30 | AGENT范围 |
| memoryService.scopeDegradation.globalToAgentDays | 365 | GLOBAL范围 |
| memoryService.reinforcement.* | (多个) | 强化计算 |

---

## 场景三：记忆升级/降级（Scope Upgrade/Downgrade）

### 3.1 升级流程

#### 升级条件检查
```
SESSION → AGENT 升级条件:
- sessionUpgradeRecallThreshold: 5 (配置: memoryService.scopeDegradation.sessionUpgradeRecallThreshold)
- 当前记忆 recallCount >= 5? → 是 → 检查importance

upgradeScopeScoreMax: 6 (配置: memoryService.scopeDegradation.upgradeScopeScoreMax)
当前记忆 scopeScore <= 6? → 是 → 允许升级

AGENT → GLOBAL 升级条件:
- agentUpgradeRecallThreshold: 7 (配置: memoryService.scopeDegradation.agentUpgradeRecallThreshold)
- agentToGlobalImportance: 7 (配置: memoryService.scopeDegradation.agentToGlobalImportance)
- 当前记忆 recallCount >= 7 且 importance >= 7? → 是 → 允许升级
```

#### 升级执行
```
升级前:
{
  uid: "memory-001",
  scope: "session",
  scopeScore: 5,
  importance: 6,
  palace: {
    wingId: "session",
    hallId: "events",
    roomId: "room-001",
    closetId: "closet-001"
  }
}

升级后 (SESSION → AGENT):
{
  uid: "memory-001",
  scope: "agent",
  scopeScore: 5, // 保持不变
  importance: 6, // 保持不变
  palace: {
    wingId: "agent",  // 变化
    hallId: "events",
    roomId: "room-001",
    closetId: "closet-001"
  }
}

Lifecycle事件:
{
  type: "upgraded",
  timestamp: 1745846400000,
  details: {
    fromScope: "session",
    toScope: "agent",
    reason: "recallCount_threshold_met"
  }
}
```

### 3.2 降级流程

#### 降级触发（遗忘周期）
```
遗忘检查周期: checkInterval = 3600000 (配置: memoryService.degradation.checkInterval)

双重评分算法:
- decayRate: 0.01 (配置: memoryService.degradation.decayRate)
- importanceWeight: 0.7 (配置: memoryService.degradation.importanceWeight)
- scopeWeight: 0.3 (配置: memoryService.degradation.scopeWeight)

遗忘分数计算:
forgetScore = importanceWeight * importance + scopeWeight * scopeScore
            = 0.7 * 3 + 0.3 * 4
            = 2.1 + 1.2
            = 3.3

deleteThreshold: 1 (配置: memoryService.degradation.deleteThreshold)
archiveThreshold: 3 (配置: memoryService.degradation.archiveThreshold)

判断:
- forgetScore <= 1 → 删除
- forgetScore <= 3 → 归档
- forgetScore > 3 → 保留
```

#### 范围降级（时间驱动）
```
SESSION → AGENT:
- sessionToAgentDays = 7 (配置: memoryService.scopeDegradation.sessionToAgentDays)
- 超过7天未访问的记忆 → scope降级

AGENT → GLOBAL:
- agentToGlobalDays = 30 (配置: memoryService.scopeDegradation.agentToGlobalDays)
- 超过30天未访问且不在其他agent引用 → scope降级
```

### 3.3 AAAK保护机制
```
protectLevel: 7 (配置: memoryService.degradation.protectLevel)

AAAK类型保护分数:
- DECISION: 0.5 (配置: memoryService.degradation.aaakProtection.DECISION)
- CORE: 0.3 (配置: memoryService.degradation.aaakProtection.CORE)
- PIVOT: 0.4 (配置: memoryService.degradation.aaakProtection.PIVOT)
- TECHNICAL: 0.2 (配置: memoryService.degradation.aaakProtection.TECHNICAL)

实际保护分数 = importance * protectionMultiplier

示例: importance=8, type=DECISION
- protectionMultiplier = 1 + 0.5 = 1.5
- effectiveImportance = min(8 * 1.5, 10) = 10
- 受到保护，不会被遗忘
```

---

## 场景四：梦境整理流程（Dreaming Organization）

### 4.1 三阶段流程

#### 阶段1：SCAN
```
扫描条件:
- organizeInterval: 21600000 (配置: dreamingEngine.scheduler.organizeInterval)
- memoryThreshold: 1000 (配置: dreamingEngine.scheduler.memoryThreshold)
- fragmentationThreshold: 0.3 (配置: dreamingEngine.scheduler.fragmentationThreshold)
- stalenessDays: 30 (配置: dreamingEngine.scheduler.stalenessDays)

扫描结果:
{
  totalMemories: 1500,
  fragmentedCount: 450,
  fragmentationRatio: 0.3,
  staleMemories: 120,
  orphanNodes: 35
}
```

#### 阶段2：ANALYZE
```
分析内容:
1. 碎片化分析 (defragmentation.fragmentationThreshold: 0.3)
   - 碎片化率 = fragmentedCount / totalMemories = 0.3
   - 判断: 需要碎片整理

2. 主题提取 (themeExtraction)
   - minThemeStrength: 0.3 (配置: dreamingEngine.themeExtraction.minThemeStrength)
   - maxThemes: 5 (配置: dreamingEngine.themeExtraction.maxThemes)
   - 提取结果: ["工作", "学习", "社交", "娱乐"]

3. 弱区域识别 (activeLearning)
   - minScopeMemoryCount: 5 (配置: dreamingEngine.activeLearning.weakAreaThresholds.minScopeMemoryCount)
   - lowImportanceRatioThreshold: 0.5 (配置: dreamingEngine.activeLearning.weakAreaThresholds.lowImportanceRatioThreshold)
   - 识别结果: AGENT范围的记忆较少，需要强化
```

#### 阶段3：EXECUTE
```
执行内容:
1. 记忆合并 (MemoryMerger)
   - similarityThreshold: 0.85 (配置: dreamingEngine.consolidation.similarityThreshold)
   - maxGroupSize: 5 (配置: dreamingEngine.consolidation.maxGroupSize)
   - mergeSimilarityThreshold: 0.85

   合并组示例:
   Group 1: [memory-001, memory-002, memory-003]
   - 主记忆: memory-001 (最新)
   - 生成新版本: v5

2. 图谱重组 (GraphReorganizer)
   - minEdgeWeight: 0.3 (配置: dreamingEngine.reorganization.minEdgeWeight)
   - densityTarget: 0.5 (配置: dreamingEngine.reorganization.densityTarget) [未使用]
   - orphanThreshold: 0.2 (配置: dreamingEngine.reorganization.orphanThreshold)
   - maxNewRelationsPerCycle: 30 (配置: dreamingEngine.reorganization.maxNewRelationsPerCycle)

   新建关联:
   - memory-001 → memory-010 (weight: 0.45)
   - memory-002 → memory-015 (weight: 0.38)

   清理弱关联:
   - 删除 edge-001 (weight: 0.15 < 0.3)

3. 存储优化 (StorageOptimizer)
   - importanceThreshold: 2 (配置: dreamingEngine.archival.importanceThreshold)
   - stalenessDays: 30 (配置: dreamingEngine.archival.stalenessDays)
   - archiveScoreWeights: {importance: 40, staleness: 35, recall: 25}

   归档候选:
   - memory-100: score = 40*2 + 35*40 + 25*1 = 80 + 1400 + 25 = 1505
   - memory-101: score = 40*2 + 35*35 + 25*2 = 80 + 1225 + 50 = 1355
```

---

## 场景五：遗忘流程（Forgetting）

### 5.1 自动遗忘周期
```
遗忘调度:
- checkInterval: 86400000 (配置: memoryService.forget.checkInterval) = 24小时
- maxInactiveDays: 90 (配置: memoryService.forget.maxInactiveDays)
- protectLevel: 7 (配置: memoryService.forget.protectLevel)

遗忘算法:
for each memory:
  if memory.lastAccessedAt < (now - maxInactiveDays):
    if memory.importance < protectLevel:
      if forgetScore < deleteThreshold:
        delete(memory)
      else if forgetScore < archiveThreshold:
        archive(memory)
```

### 5.2 遗忘分数计算
```
遗忘分数 = decayRate * inactiveDays * (importanceWeight * importance + scopeWeight * scopeScore)

示例:
- decayRate: 0.01
- inactiveDays: 95
- importance: 3
- scopeScore: 4
- importanceWeight: 0.7
- scopeWeight: 0.3

forgetScore = 0.01 * 95 * (0.7 * 3 + 0.3 * 4)
            = 0.95 * (2.1 + 1.2)
            = 0.95 * 3.3
            = 3.135

判断:
- deleteThreshold: 1 → 3.135 > 1
- archiveThreshold: 3 → 3.135 > 3
结论: 归档 (3 < forgetScore < ∞)
```

### 5.3 归档流程（两阶段提交）
```
阶段1: 预提交
Archive(memory-001):
1. 创建归档版本: memory-001-archive-v1
2. 记录归档日志
3. 锁定源记忆

阶段2: 确认提交
1. 更新palace位置: wingId = "archived"
2. 更新block: block = "archived"
3. 清理向量索引
4. 释放锁

阶段3: 回滚（如失败）
1. 删除归档版本
2. 恢复源记忆状态
3. 记录错误日志
```

### 5.4 强制遗忘
```
Force Forget条件:
- 重要性 < deleteThreshold (1)
- 非AAAK保护记忆
- 非核心记忆

Force Forget执行:
1. 删除向量索引
2. 删除SQLite记录
3. 删除Palace文件
4. 更新图谱关系
5. 发送webhook通知 (如配置)
```

---

## 场景六：用户画像联动（User Profile Integration）

### 6.1 画像类型
```
Persona (人格):
- importance: 8 (配置: memoryService.profileService.defaultScores.personaImportance)
- scopeScore: 8 (配置: memoryService.profileService.defaultScores.personaScopeScore)
- 来源: 用户行为分析

Identity (身份):
- importance: 9 (配置: memoryService.profileService.defaultScores.identityImportance)
- scopeScore: 9 (配置: memoryService.profileService.defaultScores.identityScopeScore)
- 来源: 用户自我陈述

Preference (偏好):
- importance: 7 (配置: memoryService.profileService.defaultScores.preferenceImportance)
- scopeScore: 7 (配置: memoryService.profileService.defaultScores.preferenceScopeScore)
- 来源: 历史交互分析
```

### 6.2 偏好推断
```
PreferenceInferer配置:
- minInteractions: 10 (配置: memoryService.profileService.preferenceInferer.minInteractions)
- confidenceThreshold: 0.6 (配置: memoryService.profileService.preferenceInferer.confidenceThreshold)
- decayFactor: 0.9 (配置: memoryService.profileService.preferenceInferer.decayFactor)

推断流程:
1. 收集用户交互记录
2. 统计行为频率
3. 计算置信度
4. 应用衰减: effectiveScore = originalScore * (decayFactor ^ months)
5. 判断: confidence >= 0.6? → 确认偏好
```

### 6.3 画像与记忆联动
```
记忆召回时携带画像:
RecallOptions:
{
  query: "用户偏好什么样的学习方式?",
  includeProfile: true
}

RecallResult:
{
  memories: [...],
  profile: {
    learningPreference: {
      type: "visual",
      confidence: 0.75,
      evidence: ["喜欢看视频教程", "经常使用图表"]
    }
  }
}
```

---

## 场景七：多级存储联动（Multi-level Storage）

### 7.1 存储层级
```
L1: Cache (内存)
   - maxSize: 1000 (配置: memoryService.cache.maxSize)
   - ttl: 3600000 (配置: memoryService.cache.ttl)
   - 淘汰策略: LRU

L2: Vector Store (LanceDB)
   - 路径: ./data/vector (配置: memoryService.storage.vectorStoreDbPath)
   - 表名: memory_vectors (配置: memoryService.storage.vectorStoreTableName)
   - 维度: 1536 (配置: embedding.dimensions)

L3: SQLite Meta Store
   - 路径: ./data/memory_meta.db (配置: memoryService.storage.metaStoreDbPath)

L4: Palace Store (文件系统)
   - 路径: ./data/palace (配置: memoryService.storage.palaceStorePath)

L5: Graph Store
   - 路径: ./data/graph/knowledge_graph.db (配置: memoryService.storage.graphStoreDbPath)
```

### 7.2 存储写入流程
```
Write(memory):
1. 计算palace位置: wingId/hallId/roomId/closetId
2. 写入Palace Store (L4)
3. 写入SQLite Meta (L3)
4. 生成向量并写入Vector Store (L2)
5. 写入Cache (L1)

写入确认:
- L4写入成功 → 继续
- L3写入成功 → 继续
- L2写入成功 → 继续
- L1写入成功 → 完成

失败处理:
- L3失败 → 回滚L4，抛出错误
- L2失败 → 回滚L3和L4，抛出错误
- L1失败 → 降级为无缓存，不影响其他层级
```

### 7.3 存储读取流程
```
Read(memoryId):
1. 检查Cache (L1)
   - 命中 → 返回
   - 未命中 → 继续

2. 查询SQLite Meta (L3)
   - 获取palace位置和元数据
   - 检查是否已归档 (block = "archived")
   - 未归档 → 继续

3. 如需向量:
   查询Vector Store (L2)
   - 获取向量数据

4. 如需完整内容:
   读取Palace Store (L4)
   - 获取原始内容

5. 更新Cache (L1)
   - 写入L1缓存
```

---

## 场景八：异常分支场景（Exception Branches）

### 8.1 分布式锁异常
```
场景: 多个进程同时创建同一记忆的版本

DistributedLockManager:
- DEFAULT_TTL_MS: 30000 (硬编码)
- pollIntervalMs: 50 (硬编码)

异常处理:
1. lockId = acquireLock(resourceId, ttlMs)
   - 成功: lockId
   - 失败: false (静默失败，无告警) ← 问题

2. waitForLock(resourceId, timeoutMs)
   - 超时: null (静默返回)
   - 成功: lockId

建议修复:
- 数据库错误应记录warn日志
- 应有最大重试次数
```

### 8.2 向量存储异常
```
场景: LanceDB初始化失败

VectorStoreAdapter:
- 降级策略: initializeMemoryMode()
- 内存模式: 使用SimpleVectorStore

异常处理:
1. initialize() 失败
   - 降级到内存模式
   - 记录error日志
   - 继续启动

2. store() 失败
   - 抛出SQLiteError
   - 上层处理回滚
```

### 8.3 事务回滚
```
场景: 版本创建事务提交失败

TransactionManager:
- 两阶段提交
- 失败时调用rollback()

回滚注册:
1. insertVector()
2. insertMeta()
3. insertPalace()

提交失败:
1. rollback() 调用
2. 逆序执行清理
3. 记录错误日志
4. 抛出 TransactionError
```

### 8.4 超时处理
```
场景: LLM提取超时

memory-config-utils.ts:
- extractionTimeout: 30000 (配置)
- 必须从配置读取，缺失则抛错

实现:
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), extractionTimeout);

try {
  result = await llm.extract(input, { signal: controller.signal });
} catch (e) {
  if (e.name === 'AbortError') {
    throw new Error('Extraction timeout');
  }
  throw e;
}
```

---

## 场景九：边界分支场景（Boundary Branches）

### 9.1 阈值边界
```
遗忘分数边界:
- deleteThreshold: 1
- archiveThreshold: 3

边界1: forgetScore = 1.0
  - 1.0 <= 1 → 删除
  - 注意: 浮点精度问题

边界2: forgetScore = 3.0
  - 3.0 <= 3 → 归档
  - 注意: 边界值相等情况

边界3: forgetScore = 3.001
  - 3.001 > 3 → 保留
```

### 9.2 缓存边界
```
缓存大小边界:
- maxSize: 1000 (配置: memoryService.cache.maxSize)

场景: 缓存已满，新写入

LRU淘汰:
1. 检查缓存大小
2. 如 >= maxSize
3. 淘汰最旧条目 (lastAccessedAt最小)
4. 写入新条目
```

### 9.3 版本链边界
```
maxVersions: 5 (配置: memoryService.version.maxVersions)

场景: 创建第6个版本

版本链结构:
v1 → v2 → v3 → v4 → v5 (最新)

创建v6时:
1. 检查版本链长度
2. 如 >= 5
3. 删除最旧版本v1
4. 创建新版本v6
5. 更新versionChain指针
```

### 9.4 相似度边界
```
similarityThreshold: 0.9 (配置: memoryService.version.similarityThreshold)

场景: 新内容与现有记忆相似度 = 0.9

判断: 0.9 >= 0.9 → 复用现有记忆
注意: 边界值情况，可能导致轻微差异内容被合并
```

---

## 场景十：混合组合场景（Hybrid Combination Scenarios）

### 10.1 完整记忆生命周期
```
场景: 一个记忆从创建到最终消亡的完整周期

T0: 创建
- captureIncrementalMemory()
- 生成AAAK索引
- 存储到L1-L4

T1: 召回强化
- recall() → 强化应用
- importance: 5 → 5.5

T2: 范围升级
- 多次召回后 recallCount=6
- 触发 SESSION → AGENT 升级
- scopeScore +0.5

T3: 梦境合并
- 梦境阶段发现相似记忆
- 合并为新版本 v2
- 更新图谱关系

T4: 遗忘检查
- 超过30天未访问
- importance=4
- forgetScore=2.5 < archiveThreshold
- 归档到archived block

T5: 恢复召回
- 召回相关查询
- 从归档恢复
- 更新lastAccessedAt

T6: 彻底遗忘
- 归档超过retentionDays=90
- importance<protectLevel
- forgetScore=1.2 < deleteThreshold
- 彻底删除
```

### 10.2 多模块联动
```
场景: 用户画像更新触发记忆强化

ProfileService.updatePreference():
1. 分析新交互
2. 更新preference记忆
3. 触发记忆强化
4. 召回相关记忆
5. 更新AAAK索引
6. 通知图谱更新
```

### 10.3 并发场景
```
场景: 多Agent同时操作同一记忆

Agent-1: 创建版本 v2
Agent-2: 创建版本 v2

分布式锁机制:
1. Agent-1 获取锁成功
2. Agent-2 等待锁
3. Agent-1 完成提交，释放锁
4. Agent-2 获取锁
5. Agent-2 创建版本 v3 (而非v2)
```

### 10.4 降级与升级博弈
```
场景: 记忆在降级和升级之间波动

记忆A:
- importance: 4
- recallCount: 3

单次召回后:
- recallCount: 4
- importance: 4 + 0.2 (defaultBoost) = 4.2

降级检查:
- sessionToAgentDays = 7
- 刚创建6天
- 不满足降级条件

下一周期:
- 降级检查: 7天已过
- importance: 4.2 < 5 (sessionToAgentImportance)
- 触发 SESSION → AGENT 降级

但:
- 频繁召回 recallCount: 8
- 触发 AGENT → GLOBAL 升级

博弈结果:
- 最终scope由最后一次操作决定
```

---

## 附录：配置清单

### A.1 记忆服务核心配置

| 配置路径 | 默认值 | 类型 |
|---------|-------|------|
| memoryService.store.defaultImportance | 5 | number |
| memoryService.store.defaultScopeScore | 5 | number |
| memoryService.store.chunkThreshold | 500 | number |
| memoryService.recall.defaultLimit | 20 | number |
| memoryService.recall.maxLimit | 100 | number |
| memoryService.recall.minScore | 0.5 | number |
| memoryService.recall.vectorWeight | 0.7 | number |
| memoryService.recall.keywordWeight | 0.3 | number |
| memoryService.recall.bm25B | 0.75 | number |
| memoryService.forget.checkInterval | 86400000 | number |
| memoryService.forget.maxInactiveDays | 90 | number |
| memoryService.forget.archiveThreshold | 3 | number |
| memoryService.forget.deleteThreshold | 1 | number |
| memoryService.forget.protectLevel | 7 | number |

### A.2 梦境引擎配置

| 配置路径 | 默认值 | 类型 |
|---------|-------|------|
| dreamingEngine.scheduler.organizeInterval | 21600000 | number |
| dreamingEngine.scheduler.memoryThreshold | 1000 | number |
| dreamingEngine.scheduler.fragmentationThreshold | 0.3 | number |
| dreamingEngine.scheduler.stalenessDays | 30 | number |
| dreamingEngine.consolidation.similarityThreshold | 0.85 | number |
| dreamingEngine.consolidation.maxGroupSize | 5 | number |
| dreamingEngine.reorganization.minEdgeWeight | 0.3 | number |
| dreamingEngine.reorganization.densityTarget | 0.5 | number |
| dreamingEngine.archival.importanceThreshold | 2 | number |
| dreamingEngine.archival.stalenessDays | 30 | number |
| dreamingEngine.archival.archiveScoreWeights.importanceWeight | 40 | number |

### A.3 存储配置

| 配置路径 | 默认值 | 类型 |
|---------|-------|------|
| memoryService.storage.metaStoreDbPath | ./data/memory_meta.db | string |
| memoryService.storage.palaceStorePath | ./data/palace | string |
| memoryService.storage.vectorStoreDbPath | ./data/vector | string |
| memoryService.storage.vectorStoreTableName | memory_vectors | string |
| memoryService.cache.maxSize | 1000 | number |
| memoryService.cache.ttl | 3600000 | number |

---

*报告生成时间: 2026-04-28*
*OMMS-PRO Version: 2.2.0+*
