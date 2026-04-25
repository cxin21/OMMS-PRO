import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { Search, X, ExternalLink, AlertCircle } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import apiClient from '../api/client'
import type { GraphNode, GraphEdge } from '../api/client'

const TYPE_COLORS: Record<string, string> = {
  concept: '#6366f1', agent: '#10b981', event: '#f59e0b',
  entity: '#06b6d4', person: '#ec4899', default: '#8b5cf6',
}
const nodeColor = (type: string) => TYPE_COLORS[type] ?? TYPE_COLORS.default

interface FGNode {
  id: string
  name: string
  type: string
  memoryIds: string[]
  createdAt: number
  val: number
  color: string
  x?: number
  y?: number
}

interface FGLink {
  id: string
  source: FGNode
  target: FGNode
  relation: string
  weight: number
}

const MAX_VISIBLE_NODES = 200

export default function Graph() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const focusMemoryId = searchParams.get('focus') // from memory detail link

  const wrapRef = useRef<HTMLDivElement>(null)
  const fgRef = useRef<any>(null)

  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [selected, setSelected] = useState<FGNode | null>(null)
  const [memoryMap, setMemoryMap] = useState<Record<string, { summary: string; content: string }>>({})
  const [totalCount, setTotalCount] = useState(0)
  const [hasSearched, setHasSearched] = useState(false)
  const [isLODMode, setIsLODMode] = useState(false)
  // Use ref for selected ID to avoid renderNode callback recreation
  const selectedIdRef = useRef<string | null>(null)

  // ── Load graph data based on search/filter ────────────────────────────
  const loadGraph = useCallback(async (entity?: string, type?: string, memoryId?: string) => {
    setLoading(true)
    setHasSearched(true)
    setSelected(null)
    selectedIdRef.current = null  // Clear ref when loading new data
    try {
      // Build params for node query
      const nodeParams = new URLSearchParams()
      if (entity) nodeParams.set('entity', entity)
      if (type) nodeParams.set('type', type)
      if (memoryId) nodeParams.set('memoryId', memoryId)

      const [nr, er] = await Promise.allSettled([
        apiClient.get(`/graph/nodes?${nodeParams.toString()}`),
        apiClient.get(`/graph/edges?limit=500`),
      ])

      const nodeData: GraphNode[] = nr.status === 'fulfilled' && nr.value.data?.success ? nr.value.data.data ?? [] : []
      const edgeData: GraphEdge[] = er.status === 'fulfilled' && er.value.data?.success ? er.value.data.data ?? [] : []
      const nodeTotal = nr.status === 'fulfilled' && nr.value.data?.total ? nr.value.data.total : nodeData.length

      // Filter edges to only show those connected to visible nodes
      const nodeIds = new Set(nodeData.map(n => n.id))
      const filteredEdges = edgeData.filter(e => nodeIds.has(e.sourceId) && nodeIds.has(e.targetId))

      setNodes(nodeData)
      setEdges(filteredEdges)
      setTotalCount(nodeTotal)

      // Auto-select first node if searching by memory ID
      if (memoryId && nodeData.length > 0) {
        const firstNode = nodeData[0]
        const fgNode = {
          id: firstNode.id,
          name: firstNode.entity,
          type: firstNode.type,
          memoryIds: firstNode.memoryIds ?? [],
          createdAt: firstNode.createdAt,
          val: 6,
          color: nodeColor(firstNode.type),
        }
        setSelected(fgNode)
        selectedIdRef.current = fgNode.id
      } else if (!memoryId) {
        // Clear selection when not searching by memoryId
        selectedIdRef.current = null
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load if focus memory is set
  useEffect(() => {
    if (focusMemoryId) {
      loadGraph(undefined, undefined, focusMemoryId)
    }
  }, [focusMemoryId, loadGraph])

  // ── Load memory summaries for node labels ───────────────────────────
  useEffect(() => {
    if (nodes.length === 0) return
    const allIds = nodes.flatMap(n => n.memoryIds ?? []).slice(0, 100)
    if (!allIds.length) return
    apiClient.get('/memories?limit=100')
      .then((res: any) => {
        if (res.data?.success && res.data?.data?.memories) {
          const map: Record<string, { summary: string; content: string }> = {}
          res.data.data.memories.forEach((m: any) => {
            map[m.uid] = { summary: m.summary || m.content, content: m.content }
          })
          setMemoryMap(map)
        }
      })
      .catch(() => { /* ignore */ })
  }, [nodes])

  // ── Build graph data ─────────────────────────────────────────────────
  const q = search.toLowerCase()

  const visibleNodes = useMemo(() => {
    if (nodes.length > MAX_VISIBLE_NODES) {
      return [...nodes]
        .sort((a, b) => (b.memoryIds?.length ?? 0) - (a.memoryIds?.length ?? 0))
        .slice(0, MAX_VISIBLE_NODES)
    }
    return nodes
  }, [nodes])

  const fgNodes: FGNode[] = useMemo(() => visibleNodes.map(n => {
    const mems = n.memoryIds ?? []
    const summary = mems[0] ? (memoryMap[mems[0]]?.summary || n.entity) : n.entity
    return {
      id: n.id,
      name: summary,
      type: n.type,
      memoryIds: n.memoryIds,
      createdAt: n.createdAt,
      val: 4 + (n.memoryIds?.length ?? 0) * 1.5,
      color: q && (n.entity.toLowerCase().includes(q) || summary.toLowerCase().includes(q)) ? '#f59e0b' : nodeColor(n.type),
    }
  }), [visibleNodes, q, memoryMap])

  const visibleNodeIds = useMemo(() => new Set(fgNodes.map(n => n.id)), [fgNodes])

  const fgLinks = useMemo(() => {
    const nodeMap = new Map(fgNodes.map(n => [n.id, n]))
    return edges
      .filter(e => visibleNodeIds.has(e.sourceId) && visibleNodeIds.has(e.targetId))
      .map(e => {
        const source = nodeMap.get(e.sourceId)
        const target = nodeMap.get(e.targetId)
        if (!source || !target) return null
        return { id: e.id, source, target, relation: e.relation, weight: e.weight }
      })
      .filter((l): l is NonNullable<typeof l> => l !== null)
  }, [edges, fgNodes, visibleNodeIds])

  const graphData = useMemo(() => ({ nodes: fgNodes, links: fgLinks }), [fgNodes, fgLinks])

  // ── Stats ────────────────────────────────────────────────────────────
  const typeGroups = useMemo(() =>
    visibleNodes.reduce<Record<string, number>>((a, n) => { a[n.type] = (a[n.type] ?? 0) + 1; return a }, {}),
    [visibleNodes]
  )

  const selectedConnections = useMemo(() =>
    selected ? edges.filter(e => e.sourceId === selected.id || e.targetId === selected.id) : [],
    [selected, edges]
  )

  const makeFGNode = (n: GraphNode): FGNode => ({
    id: n.id, name: n.entity, type: n.type, memoryIds: n.memoryIds ?? [],
    createdAt: n.createdAt, val: 4 + (n.memoryIds?.length ?? 0) * 1.5, color: nodeColor(n.type),
  })

  const handleZoomChange = useCallback((transform: { k: number }) => {
    setIsLODMode(transform.k < 0.5)
  }, [])

  const renderNode = useCallback((node: unknown, ctx: unknown, globalScale: number) => {
    const n = node as FGNode & { x: number; y: number }
    const c = ctx as CanvasRenderingContext2D
    const r = Math.sqrt(n.val ?? 4) * 3
    const isSel = selectedIdRef.current === n.id

    c.beginPath()
    c.arc(n.x, n.y, r, 0, Math.PI * 2)
    c.fillStyle = n.color
    c.fill()

    if (isSel) {
      c.strokeStyle = '#fff'
      c.lineWidth = 2 / globalScale
      c.stroke()
    }

    if (n.memoryIds.length > 0 && globalScale > 0.8) {
      const br = 5 / globalScale, bx = n.x + r * 0.75, by = n.y - r * 0.75
      c.beginPath()
      c.arc(bx, by, br, 0, Math.PI * 2)
      c.fillStyle = '#ef4444'
      c.fill()
      c.fillStyle = '#fff'
      c.font = `bold ${7 / globalScale}px system-ui`
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      c.fillText(String(n.memoryIds.length), bx, by)
    }

    const fontSize = Math.max(10 / globalScale, 3)
    c.font = `${isSel ? 'bold ' : ''}${fontSize}px system-ui`
    c.fillStyle = isSel ? '#111827' : '#374151'
    c.textAlign = 'center'
    c.textBaseline = 'top'
    c.fillText(n.name, n.x, n.y + r + 2 / globalScale)
  }, [])

  const handleSearch = () => {
    if (!search.trim() && !typeFilter) return
    loadGraph(search || undefined, typeFilter || undefined)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch()
  }

  const handleFilterByType = (type: string) => {
    const newType = typeFilter === type ? '' : type
    setTypeFilter(newType)
    loadGraph(search || undefined, newType || undefined)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

      {/* Search & Filter Toolbar */}
      <div className="card" style={{ padding: 'var(--space-3) var(--space-4)', display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="search-wrap" style={{ flex: 1, minWidth: 200 }}>
          <Search className="search-icon" />
          <input
            className="search-input"
            placeholder="搜索实体名称..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {search && (
            <button className="search-clear-btn" onClick={() => setSearch('')}>
              <X size={13} />
            </button>
          )}
        </div>

        {/* Type filter buttons */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {Object.keys(typeGroups).map(type => (
            <button
              key={type}
              className={`btn btn-sm ${typeFilter === type ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => handleFilterByType(type)}
              style={{ fontSize: '0.75rem' }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: nodeColor(type), marginRight: 4 }} />
              {type} ({typeGroups[type]})
            </button>
          ))}
        </div>

        <button className="btn btn-primary btn-sm" onClick={handleSearch} disabled={loading || (!search.trim() && !typeFilter)}>
          <Search size={14} /> 搜索
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => { setNodes([]); setEdges([]); setHasSearched(false); setSearch(''); setTypeFilter(''); }} disabled={loading}>
          <X size={14} /> 清空
        </button>
      </div>

      {/* Stats bar */}
      {hasSearched && (
        <div className="grid grid-4">
          <div className="stat-card">
            <div className="stat-value">{visibleNodes.length}</div>
            <div className="stat-label">显示节点 / 总数 {totalCount}</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{edges.length}</div>
            <div className="stat-label">关系边</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{Object.keys(typeGroups).length}</div>
            <div className="stat-label">节点类型</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{focusMemoryId ? '是' : '否'}</div>
            <div className="stat-label">记忆联动</div>
          </div>
        </div>
      )}

      {/* Empty state or graph */}
      {!hasSearched ? (
        <div className="card" style={{ padding: 60, textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: 16 }}>🔍</div>
          <h3 style={{ marginBottom: 8 }}>知识图谱</h3>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: 24 }}>
            输入关键词搜索实体，或从记忆详情页点击跳转查看关联图谱
          </p>
          <button className="btn btn-secondary" onClick={() => navigate('/memories')}>
            <ExternalLink size={14} /> 前往记忆管理
          </button>
        </div>
      ) : loading ? (
        <div className="card" style={{ padding: 60, textAlign: 'center' }}>
          <div className="spinner" style={{ margin: '0 auto 16px' }} />
          <p>加载图谱数据...</p>
        </div>
      ) : visibleNodes.length === 0 ? (
        <div className="card" style={{ padding: 60, textAlign: 'center' }}>
          <AlertCircle size={48} style={{ color: 'var(--color-text-muted)', marginBottom: 16 }} />
          <h3>未找到匹配的实体</h3>
          <p style={{ color: 'var(--color-text-muted)' }}>尝试其他关键词或筛选条件</p>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'stretch', flex: 1, minHeight: 0 }}>
          {/* Graph Canvas */}
          <div
            ref={wrapRef}
            style={{
              flex: 1, minWidth: 0,
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-border)',
              background: '#f8f9fc',
              overflow: 'hidden',
              position: 'relative',
              height: '100%',
            }}
          >
            <ForceGraph2D
              ref={fgRef}
              graphData={graphData}
              backgroundColor="#f8f9fc"
              nodeLabel="name"
              nodeColor={n => (n as FGNode).color}
              nodeVal={n => (n as FGNode).val}
              nodeCanvasObject={renderNode}
              nodeCanvasObjectMode={() => 'replace'}
              linkColor={() => '#d1d5db'}
              linkWidth={1.5}
              linkDirectionalArrowLength={isLODMode ? 0 : 4}
              linkDirectionalArrowRelPos={1}
              linkLabel={(l: unknown) => (l as FGLink).relation}
              linkCanvasObjectMode={isLODMode ? () => null : () => 'after'}
              linkCanvasObject={(link: unknown, ctx, globalScale) => {
                if (globalScale < 0.8) return
                const l = link as FGLink & { source: { x?: number; y?: number }; target: { x?: number; y?: number } }
                const start = l.source, end = l.target
                if (start?.x == null || start?.y == null || end?.x == null || end?.y == null) return
                const c = ctx as CanvasRenderingContext2D
                c.font = `${9 / globalScale}px system-ui`
                c.fillStyle = '#9ca3af'
                c.textAlign = 'center'
                c.textBaseline = 'middle'
                c.fillText(l.relation, (start.x + end.x) / 2, (start.y + end.y) / 2 - 5 / globalScale)
              }}
              onNodeClick={node => {
                const n = node as FGNode
                const newSelected = selected?.id === n.id ? null : n
                setSelected(newSelected)
                selectedIdRef.current = newSelected?.id ?? null
                // Force refresh to redraw selection highlight
                if (fgRef.current) {
                  fgRef.current.refresh()
                }
              }}
              onBackgroundClick={() => {
                if (selected) {
                  setSelected(null)
                  selectedIdRef.current = null
                  if (fgRef.current) {
                    fgRef.current.refresh()
                  }
                }
              }}
              cooldownTicks={80}
              d3AlphaDecay={0.02}
              d3VelocityDecay={0.4}
              onEngineStop={() => {
                if (fgRef.current) {
                  const zoom = fgRef.current.zoom()
                  handleZoomChange({ k: zoom })
                }
              }}
            />

            {/* Legend */}
            <div style={{
              position: 'absolute', top: 12, left: 12,
              background: 'rgba(255,255,255,0.92)',
              border: '1px solid var(--color-border)',
              borderRadius: 8, padding: '8px 12px',
              display: 'flex', flexDirection: 'column', gap: 5,
              pointerEvents: 'none',
            }}>
              {Object.entries(typeGroups).slice(0, 6).map(([type, count]) => (
                <span key={type} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', color: 'var(--color-text-secondary)' }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: nodeColor(type), flexShrink: 0 }} />
                  {type} <span style={{ color: 'var(--color-text-muted)' }}>({count})</span>
                </span>
              ))}
            </div>

            <div style={{
              position: 'absolute', bottom: 10, right: 12,
              fontSize: '0.68rem', color: 'var(--color-text-muted)',
              background: 'rgba(255,255,255,0.85)', padding: '3px 8px',
              borderRadius: 6, pointerEvents: 'none',
            }}>
              {isLODMode ? '缩放查看详情' : '拖拽节点 · 滚轮缩放 · 点击节点'}
            </div>
          </div>

          {/* Detail panel */}
          {selected && (
            <div className="card" style={{ width: 280, flexShrink: 0 }}>
              <div className="card-header">
                <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 11, height: 11, borderRadius: '50%', background: nodeColor(selected.type), flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.name}</span>
                </span>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setSelected(null)}>
                  <X size={14} />
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginBottom: 4 }}>节点类型</div>
                  <span className="badge badge-purple">{selected.type}</span>
                </div>

                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginBottom: 6 }}>
                    关联记忆 ({selected.memoryIds.length})
                  </div>
                  {selected.memoryIds.length === 0 ? (
                    <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>无</span>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {selected.memoryIds.slice(0, 8).map(mid => (
                        <button
                          key={mid}
                          className="btn btn-secondary btn-sm"
                          style={{ justifyContent: 'flex-start', gap: 4, fontSize: '0.72rem', fontFamily: 'monospace' }}
                          onClick={() => navigate(`/memories?focus=${mid}`)}
                        >
                          <ExternalLink size={11} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {mid.slice(7, 30)}...
                          </span>
                        </button>
                      ))}
                      {selected.memoryIds.length > 8 && (
                        <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                          +{selected.memoryIds.length - 8} 更多
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {selectedConnections.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginBottom: 6 }}>
                      关联关系 ({selectedConnections.length})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {selectedConnections.slice(0, 6).map(e => {
                        const otherId = e.sourceId === selected.id ? e.targetId : e.sourceId
                        const other = nodes.find(n => n.id === otherId)
                        return (
                          <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem' }}>
                            <span style={{ color: 'var(--color-text-muted)' }}>
                              {e.sourceId === selected.id ? '→' : '←'}
                            </span>
                            <span
                              style={{
                                color: nodeColor(other?.type ?? 'default'), fontWeight: 500,
                                cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                              }}
                              onClick={() => {
                                const n = nodes.find(n => n.id === otherId)
                                if (n) setSelected(makeFGNode(n))
                              }}
                            >
                              {other?.entity ?? otherId.slice(0, 12)}
                            </span>
                            <span className="badge" style={{ fontSize: '0.62rem', padding: '1px 4px' }}>
                              {e.relation}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                  {new Date(selected.createdAt).toLocaleString('zh-CN')}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}