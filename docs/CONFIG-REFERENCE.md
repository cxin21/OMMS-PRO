# OMMS-PRO 配置参考手册

> 版本：v1.0.0 | 每个配置键的完整路径、默认值、代码引用

---

## 配置加载优先级

```
环境变量 OMMS_* (最高) > config.json > config.default.json (最低)
```

---

## 配置键索引

### 顶层

| 路径 | 类型 | 默认值 | 代码引用 |
|------|------|--------|---------|
| `agentId` | string | `"default-agent"` | `cli/index.ts:190`, `api/routes/memory.ts:21` |
| `sessionPrefix` | string | `"session-"` | (配置文件使用) |
| `projectDir` | string | `"./data/sessions"` | (配置文件使用) |
| `agentsDir` | string | `"./agents"` | `shared/agents/types.ts:117` |

### llmExtraction

| 路径 | 类型 | 默认值 | 代码引用 |
|------|------|--------|---------|
| `llmExtraction.provider` | `openai\|anthropic\|ollama\|mock\|openai-compatible` | `"openai-compatible"` | `llm/factory.ts:71` |
| `llmExtraction.model` | string | `"gpt-4o-mini"` | `llm/factory.ts:87` |
| `llmExtraction.apiKey` | string | `""` | `llm/base.ts` |
| `llmExtraction.baseURL` | string | `""` | `llm/base.ts` |
| `llmExtraction.temperature` | number | `0.7` | `llm/base.ts` |
| `llmExtraction.maxTokens` | number | `2000` | `memory-inclusion-detector.ts` |
| `llmExtraction.timeout` | number | `30000` | `llm/base.ts` |

### api

| 路径 | 类型 | 默认值 | 代码引用 |
|------|------|--------|---------|
| `api.enabled` | boolean | `false` | `api/server.ts:80` |
| `api.port` | number | `3000` | `src/index.ts:421` |
| `api.host` | string | `"0.0.0.0"` | `src/index.ts:422` |
| `api.server.timeout` | number | `30000` | `api/server.ts` |
| `api.cors.enabled` | boolean | `true` | `api/middleware/cors.ts` |
| `api.cors.origin` | string\|string[] | `"*"` | `api/middleware/cors.ts` |
| `api.logging.level` | LogLevel | `"info"` | `api/routes/system.ts` |
| `api.performance.webUIPath` | string | `"./dist/web-ui"` | `api/server.ts:194` |

### mcp

| 路径 | 类型 | 默认值 | 代码引用 |
|------|------|--------|---------|
| `mcp.server.transport` | `stdio\|sse\|websocket` | `"stdio"` | `presentation/mcp-server/server.ts:72` |
| `mcp.tools.timeout` | number | `30000` | `presentation/mcp-server/tools/` |
| `mcp.tools.maxResults` | number | `100` | `presentation/mcp-server/tools/` |
| `mcp.performance.cacheTTL` | number | `300000` | `presentation/mcp-server/server.ts` |

### memoryService.store

| 路径 | 类型 | 默认值 | 代码引用 |
|------|------|--------|---------|
| `memoryService.store.defaultImportance` | number (1-10) | `5` | `block-utils.ts` |
| `memoryService.store.defaultScopeScore` | number (1-10) | `5` | `block-utils.ts` |
| `memoryService.store.chunkThreshold` | number | `500` | `memory-capture-service.ts` |
| `memoryService.store.scopeUpgradeThresholds.sessionToAgentImportance` | number | `5` | `block-utils.ts:37` |
| `memoryService.store.scopeUpgradeThresholds.agentToGlobalScopeScore` | number | `10` | `block-utils.ts:37` |
| `memoryService.store.scopeUpgradeThresholds.agentToGlobalImportance` | number | `7` | `block-utils.ts:37` |
| `memoryService.store.blockThresholds.coreMinImportance` | number | `7` | `block-utils.ts:97` |
| `memoryService.store.blockThresholds.sessionMinImportance` | number | `4` | `block-utils.ts:97` |
| `memoryService.store.blockThresholds.workingMinImportance` | number | `2` | `block-utils.ts:97` |
| `memoryService.store.blockThresholds.archivedMinImportance` | number | `1` | `block-utils.ts:97` |

### memoryService.recall

| 路径 | 类型 | 默认值 | 代码引用 |
|------|------|--------|---------|
| `memoryService.recall.defaultLimit` | number | `20` | `memory-recall-manager.ts` |
| `memoryService.recall.maxLimit` | number | `100` | `memory-recall-manager.ts` |
| `memoryService.recall.minScore` | number | `0.5` | `memory-recall-manager.ts` |
| `memoryService.recall.vectorWeight` | number | `0.7` | `hybrid-search.ts` |
| `memoryService.recall.keywordWeight` | number | `0.3` | `hybrid-search.ts` |
| `memoryService.recall.bm25K1` | number | `1.5` | `hybrid-search.ts` |
| `memoryService.recall.bm25B` | number | `0.75` | `hybrid-search.ts` |

### memoryService.capture

| 路径 | 类型 | 默认值 | 代码引用 |
|------|------|--------|---------|
| `memoryService.capture.maxMemoriesPerCapture` | number | `5` | `src/index.ts:273` |
| `memoryService.capture.similarityThreshold` | number | `0.9` | `src/index.ts:274` |
| `memoryService.capture.confidenceThreshold` | number | `0.5` | `src/index.ts:275` |
| `memoryService.capture.enableLLMSummarization` | boolean | `true` | `memory-capture-service.ts` |
| `memoryService.capture.extractionTimeout` | number | `30000` | `memory-capture-service.ts` |

### memoryService.forget

| 路径 | 类型 | 默认值 | 代码引用 |
|------|------|--------|---------|
| `memoryService.forget.enabled` | boolean | `true` | `memory-degradation-manager.ts` |
| `memoryService.forget.checkInterval` | number (ms) | `86400000` | `memory-degradation-manager.ts` |
| `memoryService.forget.archiveThreshold` | number | `3` | `memory-degradation-manager.ts` |
| `memoryService.forget.deleteThreshold` | number | `1` | `memory-degradation-manager.ts` |
| `memoryService.forget.maxInactiveDays` | number | `90` | `memory-degradation-manager.ts` |
| `memoryService.forget.protectLevel` | number | `7` | `memory-degradation-manager.ts` |

### memoryService.degradation

| 路径 | 类型 | 默认值 | 代码引用 |
|------|------|--------|---------|
| `memoryService.degradation.enabled` | boolean | `true` | `memory-degradation-manager.ts:57` |
| `memoryService.degradation.checkInterval` | number (ms) | `3600000` | `memory-degradation-manager.ts:57` |
| `memoryService.degradation.decayRate` | number | `0.01` | `memory-degradation-manager.ts:228` |
| `memoryService.degradation.importanceWeight` | number | `0.7` | `memory-degradation-manager.ts:228` |
| `memoryService.degradation.scopeWeight` | number | `0.3` | `memory-degradation-manager.ts:228` |
| `memoryService.degradation.archivedDecayMultiplier` | number | `2.0` | `memory-degradation-manager.ts:228` |
| `memoryService.degradation.aaakProtection.DECISION` | number | `0.5` | `memory-degradation-manager.ts:57` |
| `memoryService.degradation.aaakProtection.CORE` | number | `0.3` | `memory-degradation-manager.ts:57` |
| `memoryService.degradation.aaakProtection.PIVOT` | number | `0.4` | `memory-degradation-manager.ts:57` |
| `memoryService.degradation.aaakProtection.TECHNICAL` | number | `0.2` | `memory-degradation-manager.ts:57` |

### memoryService.storage

| 路径 | 类型 | 默认值 | 代码引用 |
|------|------|--------|---------|
| `memoryService.storage.metaStoreDbPath` | string | `"./data/memory_meta.db"` | `sqlite-meta-store.ts:95` |
| `memoryService.storage.vectorStoreDbPath` | string | `"./data/vector"` | `vector-store.ts:50` |
| `memoryService.storage.palaceStorePath` | string | `"./data/palace"` | `palace-store.ts:41` |
| `memoryService.storage.graphStoreDbPath` | string | `"./data/graph/knowledge_graph.db"` | `graph-store.ts:55` |
| `memoryService.storage.episodeStorePath` | string | `"./data/graph"` | `episode-store.ts:29` |
| `memoryService.storage.profileDbPath` | string | `"./data/profile.db"` | `profile-manager.ts:77` |
| `memoryService.storage.dreamReportsDbPath` | string | `"./data/graph/dream_reports.db"` | `dream-storage.ts:53` |

### embedding

| 路径 | 类型 | 默认值 | 代码引用 |
|------|------|--------|---------|
| `embedding.model` | string | `"text-embedding-3-small"` | `embedding-service.ts:20` |
| `embedding.dimensions` | number | `1536` | `vector-store.ts:49` |
| `embedding.apiKey` | string | `""` | `embedding-service.ts:20` |
| `embedding.baseURL` | string | `""` | `embedding-service.ts:20` |
| `embedding.batchSize` | number | `32` | `embedding-service.ts:20` |
| `embedding.timeout` | number | `30000` | `embedding-service.ts` |

### dreamingEngine

| 路径 | 类型 | 默认值 | 代码引用 |
|------|------|--------|---------|
| `dreamingEngine.scheduler.autoOrganize` | boolean | `true` | `dreaming-manager.ts:159` |
| `dreamingEngine.scheduler.organizeInterval` | number (ms) | `21600000` | `dreaming-manager.ts:159` |
| `dreamingEngine.consolidation.similarityThreshold` | number | `0.85` | `memory-merger.ts` |
| `dreamingEngine.consolidation.candidateThreshold` | number | `0.7` | `memory-merger.ts` |
| `dreamingEngine.consolidation.semanticCheckThreshold` | number | `0.5` | `memory-merger.ts` |
| `dreamingEngine.archival.archiveScoreThreshold` | number | `50` | `storage-optimizer.ts` |

---

## 环境变量映射

所有 `OMMS_` 前缀的环境变量自动映射（使用下划线分隔路径）:

```bash
OMMS_LLM_EXTRACTION_API_KEY=sk-xxx          # → llmExtraction.apiKey
OMMS_EMBEDDING_API_KEY=sk-xxx               # → embedding.apiKey
OMMS_API_PORT=3000                           # → api.port
OMMS_LOGGING_LEVEL=debug                     # → logging.level
OMMS_MEMORY_SERVICE_STORE_DEFAULT_IMPORTANCE=7  # → memoryService.store.defaultImportance
```
