import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import {
  Server, Cpu, Info, FileText, RefreshCw,
  Settings as SettingsIcon, Save, RotateCcw, ChevronRight, Database, Layers, Moon
} from 'lucide-react'
import { systemApi, type HealthStatus, type LogFile, type LogContentResult, type ModuleStatus } from '../api/client'

export default function Settings() {
  const [health, setHealth]     = useState<HealthStatus | null>(null)
  const [modules, setModules]   = useState<ModuleStatus[]>([])
  const [loading, setLoading]   = useState(true)
  const [activeTab, setActiveTab] = useState<'modules' | 'config' | 'logs' | 'architecture'>('modules')

  useEffect(() => {
    systemApi.getHealth()
      .then(res => { if (res.success) setHealth(res.data) })
      .finally(() => setLoading(false))
    systemApi.getModules().then(res => {
      if (res.success) setModules(res.data.modules)
    })
  }, [])

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    if (h > 0) return `${h}h ${m}m`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
  }

  const refreshModules = useCallback(() => {
    systemApi.getModules().then(res => {
      if (res.success) setModules(res.data.modules)
    })
  }, [])

  if (loading) return (
    <div className="loading-wrap">
      <div className="spinner" />
      <span>加载系统数据...</span>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>

      {/* Tab Navigation */}
      <div className="tabs">
        {[
          { id: 'modules',     label: '模块状态',    icon: <Layers size={14} /> },
          { id: 'config',      label: '配置管理',    icon: <SettingsIcon size={14} /> },
          { id: 'logs',        label: '日志查看',    icon: <FileText size={14} /> },
          { id: 'architecture', label: '系统架构',  icon: <Cpu size={14} /> },
        ].map(tab => (
          <div
            key={tab.id}
            className={`tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{tab.icon}{tab.label}</span>
          </div>
        ))}
      </div>

      {/* System Info Bar */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: '0.8rem' }}>
        <span>版本: <strong>v0.1.0</strong></span>
        <span>运行时间: <strong>{health ? formatUptime(health.uptime) : '-'}</strong></span>
        <span>状态: <strong className={health?.status === 'healthy' ? 'text-success' : 'text-danger'}>
          {health?.status === 'healthy' ? '健康' : '异常'}
        </strong></span>
        <button className="btn btn-secondary btn-sm" onClick={refreshModules}>
          <RefreshCw size={12} /> 刷新
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'modules' && <ModulesTab modules={modules} />}
      {activeTab === 'config'  && <ConfigTab />}
      {activeTab === 'logs'     && <LogViewer />}
      {activeTab === 'architecture' && <ArchitectureTab />}
    </div>
  )
}

// ========== Modules Tab ==========
function ModulesTab({ modules }: { modules: ModuleStatus[] }) {

  // Flatten all submodules into individual module cards
  const allModules = useMemo(() => {
    const result: Array<{
      id: string
      name: string
      description: string
      status: string
      parentId?: string
      parentName?: string
      stats?: Record<string, unknown>
      error?: string
    }> = []

    for (const mod of modules) {
      if (mod.subModules && mod.subModules.length > 0) {
        for (const sub of mod.subModules) {
          result.push({
            id: `${mod.id}.${sub.id}`,
            name: sub.name,
            description: sub.id,
            status: sub.status,
            parentId: mod.id,
            parentName: mod.name,
            stats: mod.stats ? {
              [mod.name]: Object.values(mod.stats)[0],
            } : undefined,
          })
        }
      } else {
        result.push({
          id: mod.id,
          name: mod.name,
          description: mod.description,
          status: mod.status,
          stats: mod.stats,
          error: mod.error,
        })
      }
    }
    return result
  }, [modules])

  const getModuleIcon = (id: string) => {
    if (id.includes('cache'))    return <Database size={16} />
    if (id.includes('vector'))   return <Layers size={16} />
    if (id.includes('meta'))     return <Server size={16} />
    if (id.includes('palace'))   return <Database size={16} />
    if (id.includes('graph'))    return <Layers size={16} />
    if (id.includes('consolidation')) return <Moon size={16} />
    if (id.includes('reorganization')) return <Cpu size={16} />
    if (id.includes('archival'))  return <Server size={16} />
    if (id.includes('scheduler')) return <Layers size={16} />
    return <Server size={16} />
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'running': return <span className="badge badge-green">{status}</span>
      case 'idle':    return <span className="badge badge-blue">{status}</span>
      case 'stopped': return <span className="badge badge-gray">{status}</span>
      case 'error':   return <span className="badge badge-red">{status}</span>
      default:        return <span className="badge badge-gray">{status}</span>
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Parent module summary */}
      <div className="grid grid-2">
        {modules.map(mod => (
          <div key={mod.id} className="card">
            <div className="card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ color: 'var(--color-primary)' }}>{getModuleIcon(mod.id)}</div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{mod.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{mod.description}</div>
                </div>
              </div>
              {getStatusBadge(mod.status)}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
              {mod.subModules?.map(sub => (
                <span key={sub.id} className="badge badge-gray" style={{ fontSize: '0.7rem' }}>
                  {sub.name}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Individual submodule cards */}
      <div className="section-header">
        <div className="section-title">子模块详情</div>
      </div>
      <div className="grid grid-3">
        {allModules.map(mod => (
          <div key={mod.id} className="card" style={{ borderLeft: '3px solid var(--color-primary)' }}>
            <div className="card-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ color: 'var(--color-primary)' }}>{getModuleIcon(mod.id)}</div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{mod.name}</div>
                  {mod.parentName && (
                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                      隶属: {mod.parentName}
                    </div>
                  )}
                </div>
              </div>
              {getStatusBadge(mod.status)}
            </div>

            {mod.stats && (
              <div style={{ marginTop: 'var(--space-2)', fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                {Object.entries(mod.stats).slice(0, 3).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                    <span>{k}</span>
                    <strong>{typeof v === 'number' ? v.toLocaleString() : String(v).substring(0, 10)}</strong>
                  </div>
                ))}
              </div>
            )}

            {mod.error && (
              <div style={{
                marginTop: 'var(--space-2)',
                padding: '6px',
                background: 'var(--color-danger-light)',
                borderRadius: 'var(--radius)',
                fontSize: '0.7rem',
                color: 'var(--color-danger)',
              }}>
                {mod.error}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ========== Config Tab ==========
function ConfigTab() {
  const [configTree, setConfigTree]     = useState<Record<string, unknown>>({})
  const [selectedPath, setSelectedPath] = useState<string>('')
  const [editValue, setEditValue]     = useState<string>('')
  const [saving, setSaving]           = useState(false)
  const [message, setMessage]         = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadConfig = useCallback(async (path?: string) => {
    try {
      const res = await systemApi.getConfig(path)
      if (res.success) {
        if (path) {
          setEditValue(JSON.stringify(res.data, null, 2))
        } else {
          setConfigTree(res.data as Record<string, unknown>)
        }
      }
    } catch (e) { console.error('Failed to load config:', e) }
  }, [])

  useEffect(() => { loadConfig() }, [loadConfig])

  const handleSelectPath = (path: string) => {
    setSelectedPath(path)
    loadConfig(path)
  }

  const handleSave = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const value = JSON.parse(editValue)
      const res = await systemApi.updateConfig(selectedPath, value, true)
      if (res.success) {
        setMessage({ type: 'success', text: '配置已保存' })
        loadConfig()
      } else {
        setMessage({ type: 'error', text: '保存失败' })
      }
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Invalid JSON' })
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    if (!selectedPath) return
    setSaving(true)
    try {
      const res = await systemApi.resetConfig(selectedPath)
      if (res.success) {
        setMessage({ type: 'success', text: '配置已重置' })
        loadConfig(selectedPath)
      }
    } catch (e) {
      setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Reset failed' })
    } finally {
      setSaving(false)
    }
  }

  const renderTree = (obj: Record<string, unknown>, path = '', depth = 0) => {
    return Object.entries(obj).map(([key, value]) => {
      const currentPath  = path ? `${path}.${key}` : key
      const isExpandable = typeof value === 'object' && value !== null && !Array.isArray(value)

      return (
        <div key={key} style={{ paddingLeft: depth * 16 }}>
          <div
            onClick={() => isExpandable && handleSelectPath(currentPath)}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px',
              cursor: isExpandable ? 'pointer' : 'default',
              borderRadius: 'var(--radius)',
              background: selectedPath === currentPath ? 'var(--color-primary)' : 'transparent',
              color: selectedPath === currentPath ? 'white' : 'inherit',
            }}
          >
            {isExpandable ? <ChevronRight size={12} /> : <span style={{ width: 12 }} />}
            <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{key}</span>
            {!isExpandable && (
              <span style={{ color: selectedPath === currentPath ? 'rgba(255,255,255,0.7)' : 'var(--color-text-muted)', fontSize: '0.7rem', marginLeft: 8 }}>
                {String(value).substring(0, 30)}
              </span>
            )}
          </div>
          {isExpandable && renderTree(value as Record<string, unknown>, currentPath, depth + 1)}
        </div>
      )
    })
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 'var(--space-4)', minHeight: 500 }}>
      {/* Config Tree */}
      <div className="card" style={{ overflow: 'auto', maxHeight: 600 }}>
        <div className="card-title" style={{ marginBottom: 'var(--space-3)' }}>
          <Database size={14} /> 配置结构
        </div>
        <div style={{ fontSize: '0.75rem' }}>
          {renderTree(configTree)}
        </div>
      </div>

      {/* Config Editor */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <SettingsIcon size={15} /> 配置编辑器
            {selectedPath && (
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginLeft: 8 }}>
                当前: {selectedPath}
              </span>
            )}
          </div>
          {selectedPath && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={handleReset} disabled={saving}>
                <RotateCcw size={12} /> 重置
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                <Save size={12} /> {saving ? '保存中...' : '保存'}
              </button>
            </div>
          )}
        </div>

        {message && (
          <div style={{
            padding: 'var(--space-2) var(--space-3)',
            marginBottom: 'var(--space-3)',
            borderRadius: 'var(--radius)',
            background: message.type === 'success' ? 'var(--color-success-light)' : 'var(--color-danger-light)',
            color: message.type === 'success' ? 'var(--color-success)' : 'var(--color-danger)',
            fontSize: '0.8rem',
          }}>
            {message.text}
          </div>
        )}

        {selectedPath ? (
          <textarea
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            style={{
              width: '100%',
              minHeight: 400,
              padding: 'var(--space-3)',
              fontFamily: 'monospace',
              fontSize: '0.8rem',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius)',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
              resize: 'vertical',
            }}
          />
        ) : (
          <div className="empty-state" style={{ padding: 40 }}>
            <p>从左侧选择配置项进行编辑</p>
          </div>
        )}

        {/* Quick Paths */}
        <div style={{ marginTop: 'var(--space-3)', padding: 'var(--space-3)', background: 'var(--color-bg)', borderRadius: 'var(--radius)' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, marginBottom: 8 }}>常用配置路径</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              'memoryService.store',
              'memoryService.forget',
              'memoryService.reinforce',
              'memoryService.degradation',
              'dreamingEngine.scheduler',
              'embedding',
              'logging',
            ].map(p => (
              <button key={p} className="filter-chip" onClick={() => handleSelectPath(p)} style={{ fontSize: '0.7rem' }}>
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ========== Architecture Tab ==========
function ArchitectureTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* System Layers */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><Cpu size={15} /> 系统架构</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {[
            { layer: '接入层', components: ['REST API (Express :3000)', 'MCP Server (stdio)', 'OpenClaw Plugin'], color: 'var(--color-primary)' },
            { layer: '业务层', components: ['MemoryService', 'ProfileManager', 'DreamingEngine', 'AgentManager', 'RoomManager'], color: 'var(--color-secondary)' },
            { layer: '存储层 (5层)', components: ['CacheManager (L1)', 'VectorStore (L2)', 'SQLiteMetaStore (L3)', 'PalaceStore (L4)', 'GraphStore (L5)'], color: 'var(--color-success)' },
            { layer: '配置层', components: ['ConfigManager (单例)', 'config.json', '环境变量覆盖'], color: 'var(--color-warning)' },
          ].map(l => (
            <div key={l.layer} style={{
              padding: 'var(--space-3) var(--space-4)',
              background: 'var(--color-bg)',
              borderRadius: 'var(--radius)',
              borderLeft: `3px solid ${l.color}`,
            }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: l.color, marginBottom: 8 }}>{l.layer}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {l.components.map(c => (
                  <span key={c} className="badge badge-gray">{c}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Memory Lifecycle */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><Moon size={15} /> 记忆周期流程</div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
          {[
            { label: 'Capture',  desc: '捕获' },
            { label: 'Store',    desc: '存储' },
            { label: 'Recall',   desc: '召回' },
            { label: 'Reinforce', desc: '强化' },
            { label: 'Upgrade',  desc: '升级' },
            { label: 'Degrade',  desc: '降级' },
            { label: 'Forget',   desc: '遗忘' },
            { label: 'Dream',    desc: '整理' },
          ].map((step, i) => (
            <div key={step.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                padding: '6px 12px',
                background: 'var(--color-primary)',
                color: 'white',
                borderRadius: 'var(--radius)',
                fontSize: '0.75rem',
                fontWeight: 600,
              }}>
                {step.label}
              </div>
              {i < 7 && <span style={{ color: 'var(--color-text-muted)' }}>→</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Config Priority */}
      <div className="card">
        <div className="card-header">
          <div className="card-title"><Info size={15} /> 配置优先级</div>
        </div>
        <div style={{
          padding: 'var(--space-4)',
          background: '#1e1e2e',
          borderRadius: 'var(--radius)',
          fontFamily: 'monospace',
          fontSize: '0.8rem',
          lineHeight: 1.8,
          color: '#cdd6f4',
        }}>
          <div style={{ color: '#a6e3a1' }}># 配置优先级（从高到低）</div>
          <div style={{ paddingLeft: 16 }}>
            <div>1. <span style={{ color: '#89b4fa' }}>环境变量</span> (OMMS_* 前缀)</div>
            <div>2. <span style={{ color: '#89b4fa' }}>config.json</span> (项目根目录)</div>
            <div>3. <span style={{ color: '#89b4fa' }}>config.default.json</span> (默认配置)</div>
          </div>
          <div style={{ marginTop: 16, color: '#a6e3a1' }}># 常用配置路径</div>
          <div style={{ paddingLeft: 16 }}>
            <div><span style={{ color: '#f38ba8' }}>memoryService.store.blockThresholds</span> - 存储块阈值</div>
            <div><span style={{ color: '#f38ba8' }}>memoryService.forget.decayRate</span> - 遗忘衰减率</div>
            <div><span style={{ color: '#f38ba8' }}>dreamingEngine.scheduler.autoOrganize</span> - 自动整理开关</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ========== LogViewer ==========
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function LogViewer() {
  const [logFiles, setLogFiles]       = useState<LogFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [logContent, setLogContent]   = useState<LogContentResult | null>(null)
  const [loading, setLoading]         = useState(false)
  const [levelFilter, setLevelFilter] = useState<string>('all')
  const [searchText, setSearchText]   = useState<string>('')
  const [autoScroll, setAutoScroll]   = useState(true)
  const logContainerRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)

  const loadLogFiles = useCallback(async () => {
    try {
      const res = await systemApi.getLogFiles()
      if (res.success) {
        setLogFiles(res.data.files)
        const mainFile = res.data.files.find(f => f.isMain)
        if (mainFile && !selectedFile) setSelectedFile(mainFile.name)
      }
    } catch (err) { console.error('Failed to load log files:', err) }
  }, [selectedFile])

  const loadLogContent = useCallback(async (fileName: string, offset = 0) => {
    if (offset === 0) {
      setLoading(true)
      setLogContent(null)
    }
    try {
      const res = await systemApi.getLogContent({ file: fileName, offset, limit: 200 })
      if (res.success) {
        if (offset === 0) {
          setLogContent(res.data)
        } else {
          setLogContent(prev => prev ? { ...res.data, lines: [...prev.lines, ...res.data.lines] } : res.data)
        }
      }
    } catch (err) { console.error('Failed to load log content:', err) }
    finally { if (offset === 0) setLoading(false) }
  }, [])

  useEffect(() => { loadLogFiles() }, [loadLogFiles])

  useEffect(() => {
    if (selectedFile) loadLogContent(selectedFile, 0)
  }, [selectedFile, loadLogContent])

  // Auto-scroll to bottom when new content loads
  useEffect(() => {
    if (autoScroll && logContainerRef.current && logContent?.lines.length) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logContent, autoScroll])

  const handleScroll = useCallback(() => {
    if (!logContainerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current
    isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 50
    setAutoScroll(isAtBottomRef.current)

    if (!logContent?.hasMore) return
    if (scrollHeight - scrollTop - clientHeight < 100) {
      loadLogContent(selectedFile!, logContent.lines.length)
    }
  }, [logContent, selectedFile, loadLogContent])

  const getLogLevelColor = (line: string) => {
    if (line.includes('[ERROR')) return 'var(--color-danger)'
    if (line.includes('[WARN'))  return 'var(--color-warning)'
    if (line.includes('[INFO'))  return 'var(--color-primary)'
    if (line.includes('[DEBUG')) return 'var(--color-text-muted)'
    return 'inherit'
  }

  // Virtual window: only render visible lines for performance
  const visibleLines = useMemo(() => {
    if (!logContent) return []
    let lines = logContent.lines
    if (levelFilter !== 'all') {
      const searchPattern = `[${levelFilter.toUpperCase()}`;
      lines = lines.filter(line => line.includes(searchPattern))
    }
    if (searchText) {
      const q = searchText.toLowerCase()
      lines = lines.filter(line => line.toLowerCase().includes(q))
    }
    return lines
  }, [logContent, levelFilter, searchText])

  // Pagination: render max 500 lines at once
  const [visibleCount, setVisibleCount] = useState(500)
  const displayedLines = useMemo(() => visibleLines.slice(0, visibleCount), [visibleLines])
  const hasMoreLines = visibleLines.length > visibleCount

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title"><FileText size={15} /> 日志查看</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={e => setAutoScroll(e.target.checked)}
            />
            自动滚动
          </label>
          <button className="btn btn-secondary btn-sm" onClick={() => selectedFile && loadLogContent(selectedFile, 0)}>
            <RefreshCw size={12} /> 刷新
          </button>
        </div>
      </div>

      {/* File Tabs with size */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
        {logFiles.map(file => (
          <button
            key={file.name}
            className={`filter-chip ${selectedFile === file.name ? 'active' : ''}`}
            onClick={() => setSelectedFile(file.name)}
            style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <span>{file.name}</span>
            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.65rem' }}>
              {formatFileSize(file.size)}
            </span>
          </button>
        ))}
      </div>

      {/* Filter Bar */}
      <div style={{ marginBottom: 'var(--space-3)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {['all', 'error', 'warn', 'info', 'debug'].map(level => (
            <button
              key={level}
              className={`filter-chip ${levelFilter === level ? 'active' : ''}`}
              onClick={() => { setLevelFilter(level); setVisibleCount(500) }}
              style={{ fontSize: '0.7rem' }}
            >
              {level === 'all' ? '全部' : level.toUpperCase()}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="搜索..."
          value={searchText}
          onChange={e => { setSearchText(e.target.value); setVisibleCount(500) }}
          className="form-input"
          style={{ width: 160, fontSize: '0.75rem' }}
        />
        {logContent && (
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            共 {logContent.totalLines} 行 | 显示 {visibleLines.length} 条
          </span>
        )}
      </div>

      {/* Log Content */}
      {loading ? (
        <div className="loading-wrap"><div className="spinner" /><span>加载中...</span></div>
      ) : logContent ? (
        <>
          <div
            ref={logContainerRef}
            onScroll={handleScroll}
            style={{
              maxHeight: 500,
              overflowY: 'auto',
              background: '#1e1e2e',
              borderRadius: 'var(--radius)',
              padding: 'var(--space-3)',
              fontFamily: 'monospace',
              fontSize: '0.75rem',
              lineHeight: 1.6,
              color: '#cdd6f4',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {displayedLines.map((line, i) => (
              <div key={i} style={{ color: getLogLevelColor(line) }}>{line}</div>
            ))}
            {hasMoreLines && (
              <div
                style={{ textAlign: 'center', padding: 8, cursor: 'pointer', color: '#89b4fa' }}
                onClick={() => setVisibleCount(v => v + 500)}
              >
                ─── 点击加载更多 ({visibleLines.length - visibleCount} 条剩余) ───
              </div>
            )}
          </div>
          {logContent.hasMore && (
            <div style={{ textAlign: 'center', marginTop: 8, fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => loadLogContent(selectedFile!, logContent.lines.length)}>
                加载更多
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="empty-state"><p>暂无日志</p></div>
      )}
    </div>
  )
}