# OMMS-PRO 数据流与生命周期文档

> 版本：v1.0.0 | 记忆生命周期全流程

---

## 一、记忆捕获流程

```
用户输入
  │
  ├─[1]─ API/MCP Server 接收请求
  │     Express: POST /api/v1/memories/capture
  │     MCP: memory_capture tool
  │
  ├─[2]─ IncrementalCaptureManager 预检
  │     ├─ CursorManager: session 光标 -> 跳过已处理
  │     └─ ContentHashManager: SHA-256 -> 跳过已处理
  │
  ├─[3]─ LLM Extractor 提取
  │     ├─ extractMemories(text, {maxCount:5})
  │     ├─ 返回: [{type, summary, keywords, entities, importance, scopeScore, confidence}]
  │     └─ 置信度过滤: confidence < 0.5 → 丢弃
  │
  ├─[4]─ 版本检测（三级）
  │     ├─ L1: 内容 Hash 匹配
  │     ├─ L2: 向量余弦相似度 >= similarityThreshold(0.9)
  │     └─ L3: LLM Inclusion 语义检测
  │
  ├─[5]─ 嵌入生成
  │     └─ Embedding Service (BAAI/bge-m3, 1024 dims)
  │
  └─[6]─ 多层级存储写入
        ├─ L1 缓存: CacheManager.set()
        ├─ L2 向量: VectorStore.insert()
        ├─ L3 元数据: SQLiteMetaStore.insert()
        ├─ L4 Palace: PalaceStore.writeFile()
        └─ L5 图谱: GraphStore.upsertNode() + upsertEdge()
```

---

## 二、记忆召回流

```
查询请求 (text + filters)
  │
  ├─[1]─ 查询文本 → 嵌入向量
  │
  ├─[2]─ 向量搜索 (VectorStore.search)
  │      └─ LanceDB L2 距离 → 余弦相似度转换
  │         score = max(0, 1 - dist²/2)
  │
  ├─[3]─ BM25 关键词重排序 (HybridSearch)
  │      └─ combinedScore = vectorWeight(0.7) × vecSim + keywordWeight(0.3) × bm25Norm
  │
  ├─[4]─ 作用域 + ACL 过滤
  │      ├─ scope 隔离: SESSION < AGENT < GLOBAL
  │      └─ AccessPolicy: agent-owns, session-scoped, global-read
  │
  ├─[5]─ 元数据增强
  │      ├─ SQLite: importance, scopeScore, recallCount, tags
  │      └─ 知识图谱: 关联实体、相邻节点
  │
  └─[6]─ 返回排序结果 (top-N, minScore 过滤)
         └─ 更新 recallCount, lastRecalledAt
```

---

## 三、记忆升级流程

```
触发: recallCount 达标
  │
  ├─[1]─ SESSION → AGENT 判定
  │     条件: importance >= sessionToAgentImportance(5)
  │
  ├─[2]─ AGENT → GLOBAL 判定
  │     条件: scopeScore >= agentToGlobalScopeScore(10)
  │        OR importance >= agentToGlobalImportance(7)
  │
  └─[3]─ 跨层迁移
        ├─ PalaceStore.copy() → 新路径
        ├─ SQLiteMetaStore.update({scope})
        ├─ VectorStore.updateMetadata({scope})
        ├─ CacheManager.set() 更新缓存
        └─ PalaceStore.deleteSourceOnly() 删除旧文件
```

---

## 四、记忆降级与遗忘流程

```
定时检查 (checkInterval)
  │
  ├─[1]─ 衰减计算
  │      newImportance = max(0, importance - 天数 × decayRate × multiplier)
  │      newScopeScore = max(0, scopeScore - 天数 × decayRate)
  │
  ├─[2]─ Block 重判定
  │      ├─ importance >= 7 → CORE
  │      ├─ importance >= 4 → SESSION
  │      ├─ importance >= 2 → WORKING
  │      └─ importance <  2 → ARCHIVED
  │
  ├─[3]─ 遗忘检查 (inactiveDays > maxInactiveDays)
  │      ├─ importance < archiveThreshold(3) → 归档
  │      │    └─ archivedDecayMultiplier = 2.0 (衰减加速)
  │      ├─ importance < deleteThreshold(1) → 删除
  │      │    └─ 五层存储级联删除
  │      └─ importance >= protectLevel(7) → 受保护，跳过
  │
  └─[4]─ AAAK 保护
         └─ 特定类型衰减减缓
            DECISION: ×0.5, CORE: ×0.3, PIVOT: ×0.4, TECHNICAL: ×0.2
```

---

## 五、Dreaming 合并流程

```
调度触发 (scheduleHour=3, 凌晨 3 点)
  │
  ├─[1]─ 候选发现 (MemoryMerger)
  │      ├─ 排除 Profile 类型记忆
  │      ├─ L1: 向量相似度 >= candidateThreshold(0.7)
  │      ├─ L2: 主题过滤 (Jaccard 相似度)
  │      └─ L3: LLM 语义检查 (可选)
  │
  ├─[2]─ 主记忆选择
  │      score = importance×0.5 + recall/100×0.3 + time×0.2
  │
  ├─[3]─ LLM 合并
  │      llmExtractor.mergeMemories([content1, content2, ...])
  │
  └─[4]─ 事务提交 (TransactionCoordinator)
         ├─ 更新主记忆 content
         ├─ 删除被合并记忆 (5层级联)
         └─ 全部成功 OR 全部回滚
```

---

## 六、存储架构总览

```
┌─────────────────────────────────────────────────────┐
│                  应用层 (API / MCP / CLI)             │
├─────────────────────────────────────────────────────┤
│  StorageMemoryService (统一入口)                     │
│  ┌──────────┬──────────┬──────────┬──────────────┐  │
│  │ Capture  │  Recall  │Degradation│  Dreaming   │  │
│  │ Service  │  Manager │  Manager  │   Manager   │  │
│  └──────────┴──────────┴──────────┴──────────────┘  │
├─────────────────────────────────────────────────────┤
│  MemoryStoreManager (多层级写入协调)                  │
├───────┬─────────┬──────────┬──────────┬────────────┤
│  L1   │   L2    │    L3    │    L4    │     L5     │
│ 缓存   │  向量库  │  元数据库 │  Palace  │  知识图谱  │
│ Map   │ LanceDB │  SQLite  │  Files   │   SQLite   │
│ HOT   │  WARM   │   WARM   │   COLD   │   WARM     │
├───────┴─────────┴──────────┴──────────┴────────────┤
│          StorageService (分层读取协调)                │
│          HOT → WARM → COLD 透读策略                  │
└─────────────────────────────────────────────────────┘
```

---

## 七、关键数据实体

### Memory (内存对象)
```
{
  uid: string          // 唯一标识
  agentId: string      // 所属 Agent
  sessionId: string    // 所属 Session
  type: MemoryType     // fact|event|decision|error|learning|relation|identity|persona|preference
  scope: MemoryScope   // SESSION|AGENT|GLOBAL
  block: MemoryBlock   // CORE|SESSION|WORKING|ARCHIVED
  content: string      // 记忆内容
  summary: string      // LLM 摘要
  importance: number   // 重要性 1-10
  scopeScore: number   // 作用域得分 1-10
  confidence: number   // 置信度 0-1
  version: number      // 版本号
  versionChain: VersionInfo[]  // 版本链
  tags: string[]       // 标签
  keywords: string[]   // 关键词
  entities: Entity[]   // 实体
  relations: Relation[] // 关系
  sentiment?: string   // 情感标签
  createdAt: number    // 创建时间
  updatedAt: number    // 更新时间
  lastRecalledAt: number // 最后召回时间
  recallCount: number  // 召回次数
}
```

### VectorDocument (向量存储)
```
{
  id: string           // = memory.uid
  vector: number[]     // 1024/1536 维嵌入
  text: string         // 记忆内容
  metadata: {
    uid, type, scope, agentId, sessionId,
    importanceScore, scopeScore, tags, summary,
    createdAt, palaceRef, version, isLatestVersion
  }
}
```

### Graph Node / Edge (知识图谱)
```
Node: { id, entity, type, memoryIds[], properties }
Edge: { id, sourceId, targetId, relation, weight }
```
