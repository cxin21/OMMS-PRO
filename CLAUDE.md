# OMMS-PRO (Optimized Memory Management System - Professional)

## Project Overview

OMMS-PRO is a sophisticated memory management system featuring a "Memory Palace" hierarchical architecture with vector search, knowledge graphs, and LLM-based memory extraction.

**Core Features:**
- Memory Palace Architecture (Wing > Hall > Room > Closet)
- Multi-layer Memory Types (Facts, Events, Decisions, Errors, Learnings, Relations, Profile)
- Hybrid Recall (Vector + Keyword search)
- Automatic Memory Degradation with AAAK protection
- Dreaming Engine for memory organization
- Knowledge Graph for relationship tracking
- User Profile Management (L0/L1/L2)

## Architecture

```
src/
├── api/                    # REST API server (Express)
├── cli/                    # Command-line interface
├── core/                   # Core domain types and ports
│   ├── types/             # Memory, Episode, Graph types
│   ├── domain/            # Domain interfaces
│   └── ports/             # Repository/Service interfaces
├── infrastructure/         # Storage and persistence
│   └── storage/
│       ├── core/          # Storage interfaces
│       └── stores/        # SQLite, Vector, Palace, Graph stores
├── presentation/           # MCP Server, Plugins, Web UI
│   ├── mcp-server/        # Model Context Protocol server
│   └── plugins/claude/    # Claude Code plugin
└── services/              # Business logic
    ├── memory/            # Core memory management
    │   ├── core/          # StorageMemoryService
    │   ├── capture/       # MemoryCaptureService
    │   ├── recall/        # MemoryRecallManager
    │   ├── degradation/   # MemoryDegradationManager
    │   └── store/         # MemoryStoreManager, VersionManager
    ├── dreaming/          # DreamingEngine
    └── profile/           # ProfileManager
```

## Memory Lifecycle

### 1. Memory Capture
- **Entry**: `MemoryCaptureService.capture()`
- **Process**: LLM extraction → Confidence filtering → Version detection → Storage
- **Output**: Memory stored in Palace, Meta, Vector stores

### 2. Memory Recall
- **Entry**: `StorageMemoryService.recall()`
- **Process**: Progressive scope expansion (SESSION → AGENT → GLOBAL → OTHER_AGENTS)
- **Enhancement**: BM25 reranking, AAAK prescreening, Reinforcement

### 3. Scope Management
- **Upgrade**: SESSION → AGENT (importance ≥ threshold)
- **Upgrade**: AGENT → GLOBAL (scopeScore ≥ max AND importance ≥ threshold)
- **Degradation**: Time-based downgrade (7/30/365 days by scope)

### 4. Memory Degradation/Forgetting
- **Entry**: `MemoryDegradationManager.runForgettingCycle()`
- **Process**: Importance decay → Archive → Delete
- **Protection**: AAAK flags, Profile types, high importance memories

### 5. Dream Consolidation
- **Entry**: `DreamingManager.dream()` / `consolidateMemories()`
- **Process**: Scan → Analyze → Execute (merge, archive, defragment)

### 6. User Profile
- **Entry**: `ProfileManager`
- **Types**: IDENTITY (L0), PREFERENCE (L1), PERSONA (L2)
- **Storage**: Stored as special Memory types with high importance

## Configuration

All configuration is managed through `config.default.json` and `config.json`.

### Key Configuration Sections

```json
{
  "memoryService": {
    "capture": { "maxMemoriesPerCapture": 5, "confidenceThreshold": 0.5 },
    "store": { "blockThresholds": {...}, "scopeUpgradeThresholds": {...} },
    "recall": { "vectorWeight": 0.7, "keywordWeight": 0.3 },
    "forget": { "decayRate": 0.01, "protectLevel": 7 },
    "reinforcement": { "lowBoost": 0.5, "mediumBoost": 0.3 },
    "degradation": { "aaakProtection": {...} },
    "scopeDegradation": { "sessionToAgentDays": 7, "agentToGlobalDays": 30 }
  },
  "dreamingEngine": {
    "consolidation": { "similarityThreshold": 0.85 },
    "archival": { "importanceThreshold": 2, "stalenessDays": 30 }
  }
}
```

### Configuration Rules

1. **All values MUST come from ConfigManager** - no hardcoded defaults
2. **ConfigManager must be initialized before any service** - services throw if not initialized
3. **Missing required config throws Error** - use `getConfigOrThrow()` not `getConfig()`
4. **No fallback defaults in production code** - only in FALLBACK constants for safety

## Storage Architecture

### Stores
- **SQLite MetaStore**: Memory metadata, version chains, tags
- **VectorStore (LanceDB)**: Embeddings for semantic search
- **PalaceStore**: Actual memory content (hierarchical file storage)
- **GraphStore**: Knowledge graph relationships
- **CacheManager**: L1 cache for hot memories

### Data Flow
```
Memory Input → LLM Extraction → Scoring → Store
                                    ↓
                            ┌───────────────┐
                            │  MetaStore    │ (SQLite)
                            │  VectorStore  │ (LanceDB)
                            │  PalaceStore  │ (Filesystem)
                            │  GraphStore   │ (SQLite)
                            └───────────────┘
```

## Memory Types

| Type | Hall | Description |
|------|------|-------------|
| FACT | FACTS | Factual information |
| EVENT | EVENTS | Events/occurrences |
| DECISION | DECISIONS | Decisions made |
| ERROR | ERRORS | Errors/mistakes |
| LEARNING | LEARNINGS | Learned insights |
| RELATION | RELATIONS | Relationships |
| IDENTITY | (Profile) | User identity |
| PREFERENCE | (Profile) | User preferences |
| PERSONA | (Profile) | User persona |

## Memory Scopes

| Scope | Wing | Description |
|-------|------|-------------|
| SESSION | session_{id} | Single conversation session |
| AGENT | agent_{id} | Agent-specific memory |
| GLOBAL | global | Shared global memory |

## Memory Blocks

| Block | Importance | Description |
|-------|------------|-------------|
| CORE | ≥7 | High-value persistent memory |
| SESSION | ≥4 | Normal session memory |
| WORKING | ≥2 | Active working memory |
| ARCHIVED | ≥1 | Low-value archived memory |
| DELETED | <1 | Marked for deletion |

## API Tools (27 total)

### Memory Tools
- `memory_recall` - Semantic search
- `memory_capture` - Store conversation
- `memory_list` - Browse memories
- `memory_update` - Modify memory
- `memory_delete` - Remove memory

### Palace Tools
- `palace_navigate` - Navigate palace
- `palace_stats` - View statistics

### Graph Tools
- `graph_query` - Query relationships
- `graph_export` - Export graph

### Dreaming Tools
- `dream_organize` - Run organization
- `dream_report` - Get organization report

### Profile Tools
- `profile_get` - Get user profile
- `profile_update` - Update preferences

### System Tools
- `system_stats` - System statistics
- `system_health` - Health check
- `system_logs` - View logs

## CLI Commands

```bash
omms list              # List memories
omms search <query>    # Search memories
omms stats             # Show statistics
omms extract <text>    # Extract memories
omms start             # Start server
```

## Development

### Build
```bash
npm run build
```

### Type Check
```bash
npm run typecheck
```

### Run Tests
```bash
npm test
```

## Plugin Hooks

### Claude Plugin Hooks
Located in `src/presentation/plugins/claude/hooks/`:

- `session-start/init-session` - Session initialization, outputs L0/L1 context
- `pre-response/recall-memory` - Pre-response memory recall
- `session-end/capture-session` - Session-end memory capture

## Key Files

| File | Purpose |
|------|---------|
| `storage-memory-service.ts` | Main memory facade |
| `memory-recall-manager.ts` | Recall with progressive scope |
| `memory-capture-service.ts` | LLM-based extraction |
| `memory-degradation-manager.ts` | Forgetting and degradation |
| `dreaming-manager.ts` | Memory organization |
| `profile-manager.ts` | User profile management |
| `config-manager.ts` | Configuration management |
