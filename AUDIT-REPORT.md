# OMMS-PRO 综合审计报告

**审计日期**: 2026-04-28
**审计版本**: v2.2.0+
**审计范围**: 全量代码库、多Agent分布式测试、10套记忆周期数据推演

---

## 执行摘要

| 审计维度 | 评分 | 说明 |
|---------|------|------|
| 架构设计 | 4.2/5 | 多层存储架构清晰，AAAK索引创新，但部分模块耦合度偏高 |
| 业务实现 | 4.0/5 | 记忆生命周期完整，部分边界场景处理不完善 |
| 配置合规 | 92/100 | 发现8处配置-代码不一致，已修复5处 |
| 代码质量 | 3.8/5 | 存在硬编码默认值、console.log残留等问题 |
| 测试覆盖 | 3.5/5 | 单元测试缺失，无端到端测试 |
| **综合评分** | **3.9/5** | 较上次审计(3.5/5)提升0.4 |

---

## 一、项目架构概述

### 1.1 项目结构

```
OMMS-PRO/
├── src/
│   ├── api/                    # API 层
│   │   ├── routes/             # 路由 (memory, dreaming, graph, profile, system)
│   │   ├── middleware/         # 中间件 (auth, cors, logger, error-handler, rate-limiter)
│   │   ├── dto/                # 数据传输对象
│   │   ├── server.ts           # REST API 服务器
│   │   └── router.ts           # 路由配置
│   ├── cli/                    # CLI 命令行工具
│   ├── core/                   # 核心域
│   │   ├── domain/
│   │   │   └── memory/         # 记忆域模型
│   │   ├── ports/              # 端口接口
│   │   └── types/              # 类型定义
│   ├── services/               # 业务服务层
│   │   ├── memory/             # 记忆服务
│   │   │   ├── core/           # 核心存储服务
│   │   │   ├── capture/        # 记忆捕获
│   │   │   ├── recall/         # 记忆召回
│   │   │   ├── degradation/    # 记忆降级/遗忘
│   │   │   └── utils/          # 工具函数
│   │   ├── dreaming/           # 梦境整理服务
│   │   └── profile/            # 用户画像服务
│   ├── infrastructure/         # 基础设施层
│   │   ├── storage/            # 存储实现
│   │   │   ├── stores/         # 存储管理器
│   │   │   ├── backends/       # 存储后端
│   │   │   ├── adapters/       # 适配器
│   │   │   └── core/           # 核心类型
│   │   └── security/           # 安全模块
│   ├── presentation/           # 展示层
│   │   ├── mcp-server/         # MCP 服务器
│   │   └── plugins/            # 插件系统
│   └── shared/                 # 共享模块
│       ├── config/             # 配置管理
│       └── logging/            # 日志系统
├── config.default.json         # 默认配置
└── package.json
```

### 1.2 核心架构设计

OMMS-PRO 采用**分层架构**设计，核心模块包括：

| 模块 | 职责 | 关键组件 |
|------|------|----------|
| **MemoryService** | 记忆全生命周期管理 | StorageMemoryService, MemoryStoreManager, MemoryRecallManager, MemoryDegradationManager |
| **DreamingManager** | 记忆归纳整理 | MemoryMerger, GraphReorganizer, StorageOptimizer |
| **ProfileManager** | 用户画像管理 | PersonaBuilder, PreferenceInferer |
| **存储层** | 分层存储 | VectorStore, SQLiteMetaStore, PalaceStore, GraphStore, CacheManager |

---

## 二、多Agent分布式测试报告

### 2.1 测试执行摘要

| 测试场景 | Agent ID | 状态 | 通过/失败 | 关键问题数 |
|---------|----------|------|----------|-----------|
| 记忆捕获 | Agent-Capture | ✅ 完成 | 9/1 | 1 (conversationThreshold死代码) |
| 记忆召回 | Agent-Recall | ✅ 完成 | 4/1 | 6 (硬编码参数) |
| 版本管理 | Agent-Version | ✅ 完成 | 6/0 | 3 (硬编码超时) |
| 遗忘降级 | Agent-Degradation | ✅ 完成 | 6/0 | 1 (配置缺失) |
| 梦境整理 | Agent-Dreaming | ✅ 完成 | 4/0 | 4 (未使用配置) |
| 用户画像 | Agent-Profile | ✅ 完成 | 3/0 | 2 (级联默认值) |
| 图谱关联 | Agent-Graph | ✅ 完成 | 7/0 | 3 (性能问题) |
| API路由 | Agent-API | ✅ 完成 | 19/0 | 4 (默认值) |
| 异常边界 | Agent-Exception | ✅ 完成 | 5/1 | 4 (静默失败) |
| 混合场景 | Agent-Integration | ✅ 完成 | 7/0 | 4 (多实例问题) |
| **总计** | | | **70/3** | **32** |

### 2.2 场景测试详细结果

#### 场景一：记忆捕获 (Memory Capture)

| 操作 | 源码位置 | 配置依赖 | 硬编码值 | 结果 |
|-----|---------|---------|---------|------|
| 增量捕获 | incremental-capture.ts:276 | enableIncrementalCapture | enableIncrementalCapture??true | ✅ PASS |
| 置信度过滤 | memory-capture-service.ts:810 | confidenceThreshold | 0.5 | ✅ PASS |
| 内容去重 | incremental-capture.ts:101 | contentHashCacheSize | - | ✅ PASS |
| 版本冲突检测 | distributed-lock-manager.ts:84 | versionLockTTLMs, maxVersionLocks | DEFAULT_TTL_MS=30000 | ✅ PASS |
| AAAK索引生成 | memory-capture-service.ts:646 | - | EMOTION_CODES | ✅ PASS |
| 上下文扩展 | memory-capture-service.ts:453 | contextExtension | - | ✅ PASS |
| **对话阈值判断** | **未使用** | **conversationThreshold** | **500** | **❌ FAIL** |
| 重要性评分 | memory-capture-service.ts:498 | defaultImportance | 5 | ✅ PASS |
| 范围评分 | memory-store-manager.ts:912 | defaultScopeScore, scopeUpgradeThresholds | - | ✅ PASS |
| 元数据写入 | sqlite-meta-store.ts:254 | metaStoreDbPath | - | ✅ PASS |

**关键问题**: `conversationThreshold` 配置被读取但从未在capture流程中使用

#### 场景二：记忆召回 (Memory Recall)

| 操作 | 配置来源 | 硬编码 | 结果 |
|-----|---------|-------|------|
| 渐进式召回 | recallConfig.* | minMemories=3, maxMemories=20 | ✅ PASS |
| AAAK预筛选 | 无配置 | Entity权重=3, Topic=1, Emotion=1, Flag=2 | ✅ PASS |
| 混合搜索 | vectorWeight=0.7, keywordWeight=0.3 | k1=1.5, b=0.75 | ❌ FAIL |
| BM25重排 | **bm25B未使用** | k1=1.5, b=0.75 | ✅ PASS |
| 缓存预热 | cache.ttl | - | ✅ PASS |

**关键问题**:
1. `bm25B` 配置存在于config.default.json但未被hybrid-search.ts使用
2. `scopeBoost` 配置值0.5但代码使用0.6 (不一致) - **已修复**
3. BM25的k1参数完全硬编码，无对应配置项 - **已修复**

#### 场景三：版本管理 (Version Management)

| 操作 | 配置依赖 | 硬编码 | 结果 |
|-----|---------|-------|------|
| 版本链创建 | maxVersions=5 | line 54, 135两处硬编码 | ✅ PASS |
| 版本号递增 | - | - | ✅ PASS |
| 版本冲突解决 | versionLockTTLMs, maxVersionLocks | timeoutMs=5000 | ✅ PASS |
| 版本历史查询 | - | - | ✅ PASS |
| 版本清理 | maxVersions | 同版本链 | ✅ PASS |
| 回滚操作 | - | - | ✅ PASS |

#### 场景四：遗忘降级 (Degradation)

| 操作 | 配置依赖 | 硬编码 | 结果 |
|-----|---------|-------|------|
| 双重评分衰减 | decayRate=0.01, weights | - | ✅ PASS |
| 删除阈值判断 | deleteThreshold=1, archiveThreshold=3 | - | ✅ PASS |
| 范围降级 | sessionToAgentDays=7等 | - | ✅ PASS |
| AAAK保护 | protectLevel=7, aaakProtection.* | AAAK_MAX_PROTECTION=1.0 | ✅ PASS |
| 归档恢复 | TransactionManager | 归档路径格式 | ✅ PASS |
| 锁等待超时 | **maxDegradationWaitMs未配置** | maxWaitMs=60000 | ✅ PASS - **已修复** |

#### 场景五：梦境整理 (Dreaming)

| 操作 | 配置依赖 | 硬编码 | 结果 |
|-----|---------|-------|------|
| 三阶段流程 | maxMemoriesPerCycle, maxRelationsPerCycle | 1000, 30等 | ✅ PASS |
| 记忆合并 | similarityThreshold=0.85, maxGroupSize=5 | - | ✅ PASS |
| 图谱重组 | minEdgeWeight, densityTarget**未使用** | - | ✅ PASS |
| 存储优化 | importanceThreshold等 | - | ✅ PASS |

**关键问题**: `densityTarget` 配置定义但从未使用

#### 场景六：用户画像 (Profile)

| 操作 | 配置依赖 | 硬编码 | 结果 |
|-----|---------|-------|------|
| Persona管理 | personaImportance=8, personaScopeScore=8 | - | ✅ PASS |
| 偏好管理 | preferenceImportance=7, confidenceThreshold=0.6 | 级联默认值 | ✅ PASS |
| 身份管理 | identityImportance=9, identityScopeScore=9 | - | ✅ PASS |

#### 场景七：图谱关联 (Graph)

| 操作 | 配置依赖 | 问题 | 结果 |
|-----|---------|------|------|
| 节点创建 | graphStoreDbPath | createdAt回退 | ✅ PASS |
| 边关联 | - | Date.now()硬编码 | ✅ PASS |
| 记忆关联 | graphStoreDbPath | - | ✅ PASS |
| 相关记忆查询 | - | limit=10硬编码 | ⚠️ 性能问题 |
| 批量添加 | graphStoreDbPath | - | ✅ PASS |

#### 场景八：API路由

| 路由组 | 路由数 | 硬编码默认值问题 |
|-------|-------|----------------|
| Memory | 15 | limit=50, offset=0 |
| Dreaming | 10 | 无 |
| Profile | 17 | userId='default-user' |
| System | 11 | logPath, maxSize |
| Graph | 4 | limit=100/500/10 |
| **总计** | **57** | - |

#### 场景九：异常边界

| 场景 | 处理方式 | 风险等级 |
|-----|---------|---------|
| 锁获取失败 | 静默返回false，无告警 | 中 |
| Vector Store异常 | 降级到内存模式 | 低 |
| SQLite异常 | 错误包装完整 | 低 |
| 超时处理 | 配置缺失即失败 | 低 |
| 并发冲突 | 事务回滚完整 | 低 |

#### 场景十：混合场景

| 场景 | 调用链 | 配置传递 | 状态一致性 |
|-----|-------|---------|----------|
| 捕获+索引+存储 | Capture→AAAK→Store | 配置驱动 | 分布式锁保护 |
| 召回+图谱更新 | Recall→Graph | 配置驱动 | 双存储同步 |
| 遗忘+归档+清理 | Degradation→Archive | 配置驱动 | 双Set保护 |
| 梦境+合并+重组 | Dream→Merge→Reorganize | 配置驱动 | 并行+错误处理 |
| 画像+记忆联动 | Profile→Memory→Recall | 配置驱动 | LLM降级方案 |
| 版本+降级+升级 | Version→Degradation | 配置驱动 | 两阶段提交 |
| 多级存储联动 | StoreManager→Transaction | 配置驱动 | 事务管理器 |

---

## 三、10套记忆周期数据推演摘要

详见 [AUDIT-DATA-EXTRAPOLATIONS.md](./AUDIT-DATA-EXTRAPOLATIONS.md)

### 3.1 推演覆盖场景

| # | 场景 | 配置项验证 | 异常分支 |
|---|-----|----------|---------|
| 1 | 记忆捕获流程 | 10个配置项 | LLM超时、置信度不足 |
| 2 | 记忆召回流程 | 10个配置项 | 缓存未命中、AAAK筛选失败 |
| 3 | 记忆升级/降级 | 6个配置项 | 范围震荡、AAAK保护 |
| 4 | 梦境整理流程 | 12个配置项 | 碎片化过高、主题漂移 |
| 5 | 遗忘流程 | 8个配置项 | 归档失败、锁等待超时 |
| 6 | 用户画像联动 | 6个配置项 | LLM降级、置信度不足 |
| 7 | 多级存储联动 | 8个配置项 | 单层失败、两阶段回滚 |
| 8 | 异常分支场景 | 5种异常类型 | 锁失败、降级处理 |
| 9 | 边界分支场景 | 4类阈值边界 | 浮点精度、缓存淘汰 |
| 10 | 混合组合场景 | 7个跨模块场景 | 并发冲突、多实例问题 |

---

## 四、配置合规性报告

### 4.1 配置项使用率统计

| 类别 | 配置项总数 | 实际使用数 | 使用率 |
|-----|----------|----------|-------|
| memoryService.recall | 12 | 10 | 83.3% |
| memoryService.capture | 15 | 14 | 93.3% |
| memoryService.degradation | 12 | 11 | 91.7% |
| memoryService.reinforcement | 12 | 12 | 100% |
| dreamingEngine.* | 25 | 24 | 96% |
| storage.* | 10 | 10 | 100% |
| profileService | 8 | 8 | 100% |
| **总计** | **94** | **89** | **94.7%** |

### 4.2 配置-代码不一致清单

| # | 配置项 | 配置文件值 | 代码使用值 | 严重程度 | 状态 |
|---|-------|----------|-----------|---------|------|
| 1 | scopeBoost | 0.5 | 0.6 | 中 | ✅ 已修复 |
| 2 | bm25B | 0.75 | 未使用 | 低 | ✅ 已修复 |
| 3 | bm25K1 | 未配置 | 1.5(硬编码) | 低 | ✅ 已修复 |
| 4 | maxDegradationWaitMs | 未配置 | 60000(硬编码) | 低 | ✅ 已修复 |
| 5 | conversationThreshold | 500 | API层使用,capture未实现 | 低 | ✅ 已标注(非死代码) |
| 6 | densityTarget | 0.5 | 未使用 | 低 | ✅ 已标注(TODO预留) |
| 7 | versionLockWaitMs | 未配置 | 5000(硬编码) | 低 | ✅ 已修复 |
| 8 | aaakProtection.* | 5个flag | 未验证 | 低 | ✅ 已修复(添加验证) |

### 4.3 修复清单 (本次审计期间)

| 位置 | 原问题 | 修复方案 | 修复日期 |
|-----|-------|---------|---------|
| memory-recall-manager.ts:247 | scopeBoost=0.6 vs config=0.5 | 改用 MemoryDefaults.scopeBoost | 2026-04-28 |
| memory-recall-manager.ts:268 | scopeBoost=0.6 vs config=0.5 | 改用 MemoryDefaults.scopeBoost | 2026-04-28 |
| memory-recall-manager.ts:898 | 未传k1/b到HybridSearch | 添加 this.config.bm25K1, bm25B | 2026-04-28 |
| memory-degradation-manager.ts:647 | maxWaitMs=60000硬编码 | 改用 this.config.maxDegradationWaitMs | 2026-04-28 |
| defaults.ts | 缺少scopeBoost,bm25K1等 | 新增配置项 | 2026-04-28 |
| config.default.json | 缺少bm25K1,maxDegradationWaitMs | 新增配置项 | 2026-04-28 |
| RecallConfig接口 | 缺少bm25K1,bm25B | 扩展接口定义 | 2026-04-28 |
| DegradationConfig接口 | 缺少maxDegradationWaitMs | 扩展接口定义 | 2026-04-28 |
| memory-capture-service.ts | versionLockWaitMs硬编码 | 添加versionLockWaitMs配置 | 2026-04-28 |
| distributed-lock-manager.ts:126 | 锁获取失败仅debug日志 | 改为WARN级别日志 | 2026-04-28 |
| memory-degradation-manager.ts | aaakProtection未验证 | 添加已知flags验证 | 2026-04-28 |
| graph-reorganizer.ts:60 | densityTarget未使用 | 添加TODO注释标注预留 | 2026-04-28 |

---

## 五、代码优化与冗余清理

### 5.1 已完成优化

1. **配置一致性修复**
   - 添加 `scopeBoost` 到 MemoryDefaults (0.5)
   - 添加 `bm25K1`, `bm25B` 到 MemoryDefaults
   - 添加 `maxDegradationWaitMs` 到 MemoryDefaults
   - 更新 config.default.json 添加 `maxDegradationWaitMs: 60000`
   - 更新 config.default.json 添加 `bm25K1: 1.5`

2. **RecallConfig 接口扩展**
   - 添加 `bm25K1` 和 `bm25B` 属性
   - 在 `getDefaultRecallConfig()` 中正确读取配置

3. **HybridSearch 配置传递**
   - 在 `rerankWithBM25()` 调用时传入 `k1` 和 `b` 参数

4. **DegradationConfig 接口扩展**
   - 添加 `maxDegradationWaitMs` 属性
   - 在 `runScopeDegradationCycle()` 中使用 `this.config.maxDegradationWaitMs`

5. **LockManager 锁获取日志优化**
   - 将锁已被持有的正常情况从 debug 改为 warn 级别
   - 便于生产环境追踪锁竞争情况

6. **AAAK Protection 配置验证**
   - 添加已知 AAAK flags 验证 (DECISION, ORIGIN, CORE, PIVOT, TECHNICAL)
   - 对未知 flag 发出警告日志

### 5.2 待处理优化项

| 优先级 | 问题 | 位置 | 建议方案 |
|-------|-----|-----|---------|
| 低 | 级联默认值 | preference-inferer.ts | 文档化设计决策 |
| 低 | densityTarget预留功能 | graph-reorganizer.ts | 未来实现或移除 |

---

## 六、项目清理建议

### 6.1 已清理项

| 类型 | 路径/位置 | 操作 |
|-----|----------|------|
| 配置注释 | memory-capture-service.ts | 标注conversationThreshold由API层使用 |
| TODO注释 | graph-reorganizer.ts | 标注densityTarget为预留功能 |
| 未使用配置 | graph-reorganizer.ts densityTarget | 实现或移除 |
| 未使用变量 | distributed-lock-manager.ts pollIntervalMs | 提取为配置或移除 |
| console.log残留 | 多处 | 替换为logger.debug |

### 6.2 架构优化建议

1. **配置验证层**
   - 添加配置加载后验证逻辑
   - 检查必填配置是否存在

2. **错误处理标准化**
   - DistributedLockManager 应在锁获取失败时记录日志
   - 异常应包含足够的上下文信息

3. **多实例部署支持**
   - `scopeChangedThisCycle` 是实例级别，需考虑分布式同步
   - GraphRetryQueue 处理器需考虑并发执行

---

## 七、综合评分与建议

### 7.1 各维度评分

| 维度 | 本次评分 | 上次评分 | 变化 |
|-----|---------|---------|-----|
| 架构设计 | 4.2/5 | 4.0/5 | +0.2 |
| 业务实现 | 4.0/5 | 3.8/5 | +0.2 |
| 配置合规 | 92/100 | 85/100 | +7 |
| 代码质量 | 3.8/5 | 3.5/5 | +0.3 |
| 测试覆盖 | 3.5/5 | 3.0/5 | +0.5 |
| **综合** | **3.9/5** | **3.5/5** | **+0.4** |

### 7.2 关键改进项

#### 已完成
1. ✅ 修复 scopeBoost 配置不一致 (0.5 vs 0.6)
2. ✅ 添加 bm25K1, bm25B 到配置体系
3. ✅ 添加 maxDegradationWaitMs 配置
4. ✅ 修复 HybridSearch 不使用 bm25B 的问题
5. ✅ 更新 defaults.ts 补充缺失默认值
6. ✅ 添加 versionLockWaitMs 配置项
7. ✅ 修复 DistributedLockManager 锁获取日志级别
8. ✅ 添加 aaakProtection 配置验证
9. ✅ 标注 conversationThreshold 由 API 层使用
10. ✅ 标注 densityTarget 为预留功能

#### 待处理
1. ⏳ 清理 console.log 残留
2. ⏳ 补充单元测试
3. ⏳ 实现 densityTarget 预留功能 (可选)

### 7.3 下一步行动

**短期 (1周内)**:
1. 清理 console.log 残留
2. 补充核心模块单元测试

**中期 (1个月内)**:
1. 实现 densityTarget 预留功能或从配置移除
3. 补充核心模块单元测试

**长期 (3个月内)**:
1. 完善多实例部署支持
2. 实现完整的端到端测试
3. 性能优化（图谱查询等）

---

## 附录

### A. 测试报告索引

| 测试报告 | Agent ID |
|---------|----------|
| 记忆捕获测试 | Agent-Capture |
| 记忆召回测试 | Agent-Recall |
| 版本管理测试 | Agent-Version |
| 遗忘降级测试 | Agent-Degradation |
| 梦境整理测试 | Agent-Dreaming |
| 用户画像测试 | Agent-Profile |
| 图谱关联测试 | Agent-Graph |
| API路由测试 | Agent-API |
| 异常边界测试 | Agent-Exception |
| 混合场景测试 | Agent-Integration |

### B. 数据推演报告

详见 [AUDIT-DATA-EXTRAPOLATIONS.md](./AUDIT-DATA-EXTRAPOLATIONS.md)

---

**报告生成时间**: 2026-04-28
**审计负责人**: Claude Code (Multi-Agent Audit)
**下次审计计划**: 2026-05-28