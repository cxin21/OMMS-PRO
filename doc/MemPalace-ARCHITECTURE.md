# MemPalace 完整架构文档

---

## 第一部分：模块与文件总结

---

### 模块 1：core（核心存储与调度）

| 文件 | 职责 | 核心定义 |
|------|------|----------|
| `backends/base.py` | 存储后端 ABC 接口 | `BaseBackend`, `BaseCollection`, `PalaceRef`, `QueryResult`, `GetResult`, `HealthStatus` |
| `backends/chroma.py` | ChromaDB 实现 | `ChromaBackend`, `ChromaCollection`, HNSW 修复, inode mtime 缓存 |
| `backends/registry.py` | 后端注册发现 | `register()`, `get_backend()`, `resolve_backend_for_palace()` |
| `palace.py` | 宫殿基础操作 | `get_collection()`, `build_closet_lines()`, `mine_lock()`, 文件锁 |
| `layers.py` | 4 层记忆栈 | `Layer0`(identity), `Layer1`(essential), `Layer2`(on-demand), `Layer3`(deep search) |

---

### 模块 2：知识图谱

| 文件 | 存储后端 | 核心类/函数 |
|------|---------|------------|
| `knowledge_graph.py` | **SQLite** | `KnowledgeGraph` 类：实体/三元组 CRUD，时间过滤，source_closet 追踪 |
| `palace_graph.py` | **内存+ChromaDB** | `build_graph()`, `traverse()`, `find_tunnels()`, `create_tunnel()`，60s TTL 缓存；显式隧道存 `tunnels.json` |

---

### 模块 3：mining（摄取引擎）

| 文件 | 核心功能 |
|------|---------|
| `miner.py` | 项目文件开采：固定字符 chunk(800)、房间路由(关键词)、Gitignore 匹配、mtime 增量、purge-before-upsert |
| `convo_miner.py` | 对话开采：按 `>` 交换对 chunk 或通用段落，topic 关键词房间分类 |
| `entity_detector.py` | 实体检测：正则候选提取(3+次)、信号打分(对话/人称/项目)、多语言 i18n |
| `entity_registry.py` | 实体注册表：`~/.mempalace/entity_registry.json`，Wikipedia 查询消歧，模糊词(grace/max)上下文分类 |
| `general_extractor.py` | 通用记忆提取：决策/偏好/里程碑/问题/情感 5 类标记，纯规则，无 LLM |

---

### 模块 4：dialect（AAAK 压缩格式）

| 文件 | 格式 |
|------|------|
| `dialect.py` | `ENTITY|TOPICS|"key_quote"|EMOTIONS|FLAGS`，25 种情感码，5 种重要性标记，LLM-free 压缩/解码 |

---

### 模块 5：search（搜索）

| 文件 | 算法 |
|------|------|
| `searcher.py` | BM25 + Vector 混合搜索，closet 增强排名，关键词贪婪扩展邻居抽屉 |
| `query_sanitizer.py` | 系统提示污染缓解：问题提取/尾句提取/截断，MAX_QUERY_LENGTH=250 |
| `room_detector_local.py` | 本地房间检测：文件夹结构映射(75+关键词)、文件名模式计数 |

---

### 模块 6：llm（LLM 集成）

| 文件 | LLM 提供商 | 关键功能 |
|------|----------|---------|
| `llm_client.py` | Ollama/OpenAI兼容/Anthropic | `classify()` 统一接口，JSON mode 各家实现 |
| `llm_refine.py` | 任意 LLM Provider | 实体重分类(PERSON/PROJECT/TOPIC/COMMON_WORD/AMBIGUOUS)，批量 25 条 |
| `closet_llm.py` | OpenAI 兼容 | 抽屉内容生成 closet lines，3 retries + backoff |
| `fact_checker.py` | 无（离线 KG） | 实体混淆检测(Levenshtein)，KG 矛盾检查，时间失效事实 |
| `embedding.py` | ONNX（all-MiniLM-L6-v2, 384维） | 硬件加速(CPU/CUDA/CoreML/DirectML)，进程级缓存 |

---

### 模块 7：ingestion（数据摄取）

| 文件 | 来源格式 | 特点 |
|------|---------|------|
| `project_scanner.py` | git + package manifests | 真实信号：commit 作者 + MANIFEST 项目名，bot 过滤，union-find 身份合并 |
| `convo_scanner.py` | Claude Code .jsonl | 从 slug 恢复项目名，cwd 字段提取 |
| `sweeper.py` | Claude Code .jsonl | 消息级增量摄取，光标恢复安全，幂等(确定性 drawer_id) |
| `diary_ingest.py` | 日记 .md (`##` headers) | 外部 JSON 状态文件，mtime 变更检测 |
| `split_mega_files.py` | 合并 .txt 转写 | 会话边界检测，过滤上下文恢复，`.mega_backup` 备份 |

---

### 模块 8：storage（存储后端）

| 文件 | 存储 |
|------|------|
| `knowledge_graph.py` | SQLite（`~/.mempalace/knowledge_graph.sqlite3`） |
| `palace_graph.py` | 内存缓存 + `tunnels.json` |
| `diary_ingest.py` 状态 | `~/.mempalace/state/diary_ingest_*.json` |

---

### 模块 9：MCP Server

| 文件 | 工具数 | 暴露方法 |
|------|-------|---------|
| `mcp_server.py` | 25+ | 读写抽屉/房间/翅膀、搜索、图谱遍历、知识图谱操作、日记、显式隧道管理、Webhook 设置 |

---

### 模块 10：CLI

| 文件 | 命令 |
|------|------|
| `cli.py` | init/mine/sweep/search/wake-up/split/compress/repair/migrate/mcp/status |
| `hooks_cli.py` | session-start/stop/precompact hooks，Claude Code + Codex 两种 harness |
| `instructions_cli.py` | 输出 skill instructions .md 文件 |

---

### 模块 11：utils（工具）

| 文件 | 职责 |
|------|------|
| `dedup.py` | ChromaDB 抽屉去重： cosine distance < 0.15 视为重复 |
| `exporter.py` | 导出宫殿为 markdown 树 |
| `migrate.py` | ChromaDB 版本迁移：绕过 API 直接读 SQLite |
| `repair.py` | HNSW 索引修复：扫描坏 ID、裁剪、重建 |
| `spellcheck.py` | 用户文本拼写检查，保留技术术语/专有名词 |
| `onboarding.py` | 交互式首次设置：模式/人物/项目/翅膀，生成 AAAK bootstrap |
| `normalize.py` | 格式标准化：Claude Code JSONL/Codex/Claude.ai/ChatGPT/Slack → 统一 `>` 格式 |

---

## 第二部分：记忆存储架构

---

### 2.1 整体架构

```
用户/Agent
    │
    ▼
┌──────────────────────────────────────────────────────────────┐
│                        MCP Server / CLI                       │
│               25+ tools: 抽屉读写/搜索/图谱/日记              │
└────────────────────────────┬─────────────────────────────────┘
                             │
    ┌────────────────────────┼────────────────────────────────┐
    │                        │                                │
    ▼                        ▼                                ▼
┌─────────────┐    ┌─────────────────┐    ┌─────────────────────┐
│   Miner     │    │   Searcher      │    │   KnowledgeGraph    │
│  (写入)      │    │   (读取)        │    │   (关系)            │
└──────┬──────┘    └────────┬─────────┘    └──────────┬──────────┘
       │                    │                          │
       ▼                    ▼                          ▼
┌──────────────────────────────────────────────────────────────┐
│                    ChromaDB (向量化存储)                      │
│   drawers collection (记忆抽屉)                               │
│   closets collection (索引/摘要)                              │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│                    Palace Graph (宫殿图)                      │
│   房间节点 / 翅膀结构 / 显式隧道 / Topic 隧道               │
│   60s TTL 缓存                                             │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│               Knowledge Graph (SQLite)                         │
│   实体 + 三元组 + 时间有效性 + source_closet 溯源          │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 数据结构

**Drawer（ChromaDB 抽屉）**：
```python
{
    "id": "drawer_abc123",        # 抽屉 ID
    "document": "...",           # 完整文本内容
    "metadata": {
        "wing": str,              # 翅膀名
        "room": str,              # 房间名
        "source_file": str,       # 来源文件路径
        "filed_at": timestamp,
        "added_by": str,          # "mempalace" / "claude-code"
        "session_id": str,        # 会话 ID（sweeper 新增）
        "timestamp": str,         # 消息时间戳（sweeper 新增）
        "normalize_version": int,  # 标准化版本号
    }
}
```

**Closet（ChromaDB 壁橱）**：
```
格式：topic|entities|→drawer_id_a,drawer_id_b
示例：vector_search|ai+memory|→drawer_abc,drawer_def
```

**实体注册表**（`~/.mempalace/entity_registry.json`）：
```python
{
    "mode": "personal",
    "version": 1,
    "people": {
        "Name": {
            "source": "onboarding|learned|wiki",
            "contexts": [...],
            "aliases": [],
            "relationship": "",
            "confidence": 1.0
        }
    },
    "projects": ["MemPalace", "Acme"],
    "ambiguous_flags": ["riley", "max"],
    "wiki_cache": {...}
}
```

**Knowledge Graph**（SQLite）：
```sql
entities(id, name, type, properties, created_at)
triples(id, subject, predicate, object, valid_from, valid_to, confidence,
        source_closet, source_file, source_drawer_id, adapter_name, extracted_at)
```

### 2.3 4 层记忆栈（layers.py）

```
Layer0 (Identity):  ~100 tokens   →  ~/.mempalace/identity.txt (始终加载)
Layer1 (Essential): 500-800 tokens → ChromaDB top drawers，按 importance 排序
Layer2 (On-Demand): 200-500 each   → wing/room 过滤检索
Layer3 (Deep Search): unlimited     → 全文语义搜索
```

### 2.4 写入流程

```
用户/CLI: mempalace mine
    │
    ▼
┌─────────────────┐
│ scan_project()  │ ← 遍历文件树，Gitignore 匹配
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ chunk_text()    │ ← 800 chars，段落边界分割
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ detect_room()   │ ← 关键词匹配 mempalace.yaml
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ process_file()  │ ← purge stale → batch upsert drawers
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ build_closet_   │ ← topic|entities|→drawer_ids
│ lines()         │    upsert_closet_lines()
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ _compute_topic_ │ ← 跨翅膀共享 topic 建立隧道
│ tunnels_for_wing │
└─────────────────┘
```

### 2.5 搜索流程

```
mempalace search "query"
    │
    ▼
┌────────────────────────┐
│ query_sanitizer        │ ← 去除系统提示污染
│ .sanitize_query()      │   提取问题/尾句/截断
└────────────┬───────────┘
             │
             ▼
┌─────────────────────────────────────────────┐
│ searcher.search_memories()                   │
│                                             │
│ 1. ChromaDB vector search drawers (x3)     │
│ 2. ChromaDB vector search closets (x2)     │
│ 3. closet 排名 boost: [0.40, 0.25, 0.15]   │
│ 4. 关键词 grep 扩展邻居抽屉                 │
│ 5. BM25 + Vector 混合重排序                │
└─────────────────────────────────────────────┘
```

### 2.6 AAAK 格式

```
格式：ENTITY|TOPICS|"key_quote"|EMOTIONS|FLAGS
示例：CHN|ai_memory+optimization|"we decided to use vector search"|determ|DECISION+TECHNICAL

用途：
1. 大量记忆的快速 LLM 扫描（无需加载完整内容）
2. Layer1 自动生成
3. 记忆压缩存档
```

---

## 第三部分：关键设计特点

### 3.1 增量与幂等性

| 策略 | 实现 |
|------|------|
| mtime 变更检测 | `file_already_mined()` 比较文件 mtime vs 存储 mtime |
| 确定性 drawer_id | `drawer_{session_id}_{message_uuid}` (sweeper) |
| 光标恢复 | `timestamp > cursor` 才处理 (sweeper) |
| purge-before-upsert | 重新开采前删除旧抽屉 |

### 3.2 并发安全

| 锁类型 | 实现 |
|--------|------|
| 文件级锁 | `mine_lock(source_file)` → `~/.mempalace/locks/` |
| 宫殿级全局锁 | `mine_palace_lock()` → 防止 HNSW 图损坏 |
| 跨平台 | Windows: `msvcrt.locking()`; Unix: `fcntl.flock()` |

### 3.3 实体检测信号

| 信号类型 | 权重 | 示例 |
|---------|------|------|
| 对话标记 | 3x | `"Bob said"`, `"Alice told"` |
| 直接称呼 | 4x | `"Hey Bob"`, `"thanks Bob"` |
| 项目动词 | 2x | `"implemented"`, `"deployed"` |
| 版本引用 | 3x | `"MemPalace-v2"` |
| 代码引用 | 3x | `"mem_palace.py"` |

分类需要 **2 个不同信号类别** 才能确认 PERSON，避免单信号误判。

---

## 第四部分：关键问题

### 数据持久化风险

| 组件 | 存储 | 问题 |
|------|------|------|
| EntityRegistry | JSON 文件 | 无版本管理，写并发不安全 |
| Palace Graph 缓存 | 内存 | 60s TTL 后失效，写入不主动失效 |
| Hall Keywords 缓存 | 内存 | config 变更后不刷新 |
| Wiki Cache | JSON 文件 | 无过期时间 |
| Hook State | `~/.mempalace/hook_state/` | 状态文件 race 条件 |

### 性能问题

| 位置 | 问题 |
|------|------|
| Sweeper 光标查询 | 每会话全表扫描 `where={session_id}` |
| `detect_room()` | O(n_rooms × n_keywords × len(content)) 无预索引 |
| `general_extractor` | 每次调用重新编译所有 regex |
| `entity_detector._build_patterns` | 每个 name 独立编译，无批量优化 |
| `repair.scan_palace` | 失败后逐 ID 探测，极慢 |
| `migrate.extract_drawers_from_sqlite` | JOIN 是相关子查询，N+1 风格 |

### 架构问题

| 位置 | 问题 |
|------|------|
| 双重抽取器 | sweeper vs miner 可能重复摄取同一内容 |
| closet_llm 仅 OpenAI | 不支持 Ollama/Anthropic |
| `closet_llm` basename 冲突 | 不同目录同名文件共享 closet_id |
| `onboarding` 实体编码 | 简单 3 字母碰撞处理简陋 |
| `general_extractor` 无房间分配 | 只输出 memory_type，无 wing/hall |
