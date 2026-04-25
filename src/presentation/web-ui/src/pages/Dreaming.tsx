import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts'
import { Moon, Play, Settings, RefreshCw, CheckCircle, Loader, BarChart2 } from 'lucide-react'
import {
  dreamingApi,
  type FragmentationMetrics,
  type OrganizationReport,
  type DreamingStats,
} from '../api/client'

type OrgType = 'all' | 'consolidation' | 'reorganization' | 'archival'

const ORG_TYPES: { value: OrgType; label: string; desc: string }[] = [
  { value: 'all',            label: '全部整理', desc: '执行所有整理步骤' },
  { value: 'consolidation',  label: '记忆合并', desc: '合并相似记忆'   },
  { value: 'reorganization', label: '图谱重构', desc: '重建关联关系'   },
  { value: 'archival',       label: '归档清理', desc: '归档低价值记忆' },
]

const PHASE_STEPS: ['pending' | 'active' | 'done', string][] = [
  ['pending', 'SCAN'], ['pending', 'ANALYZE'], ['pending', 'EXECUTE'],
]

// Circular progress gauge
function CircleGauge({ value, max, label, color }: { value: number; max: number; label: string; color: string }) {
  const pct  = Math.min(1, max > 0 ? value / max : 0)
  const r    = 34
  const circ = 2 * Math.PI * r
  const dash = circ * (1 - pct)
  const displayVal = max === 1 ? `${(value * 100).toFixed(0)}%` : String(value)

  return (
    <div className="frag-meter">
      <div className="frag-ring">
        <svg width="80" height="80" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r={r} fill="none" stroke="var(--color-border)" strokeWidth="6" />
          <circle
            cx="40" cy="40" r={r} fill="none"
            stroke={color} strokeWidth="6"
            strokeDasharray={circ} strokeDashoffset={dash}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.5s ease' }}
          />
        </svg>
        <div className="frag-ring-value" style={{ fontSize: '0.85rem', color }}>{displayVal}</div>
      </div>
      <div className="frag-label">{label}</div>
    </div>
  )
}

export default function Dreaming() {
  const [frag,    setFrag]    = useState<FragmentationMetrics | null>(null)
  const [dStats,  setDStats]  = useState<DreamingStats | null>(null)
  const [lastReport, setLastReport] = useState<OrganizationReport | null>(null)
  const [historyReports, setHistoryReports] = useState<OrganizationReport[]>([])
  const [loading,   setLoading]   = useState(true)
  const [running,   setRunning]   = useState(false)
  const [orgType,   setOrgType]   = useState<OrgType>('all')
  const [limit,     setLimit]     = useState(100)
  const [phases,    setPhases]    = useState<['pending' | 'active' | 'done', string][]>(PHASE_STEPS)
  const [showConfig, setShowConfig] = useState(false)
  const [configSaving, setConfigSaving] = useState(false)
  const [configMessage, setConfigMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Config draft for editing
  const [configDraft, setConfigDraft] = useState({
    // consolidation
    similarityThreshold: 0.85,
    maxGroupSize: 5,
    preserveNewest: true,
    createNewVersion: true,
    // archival
    importanceThreshold: 2,
    stalenessDaysArchival: 30,
    retentionDays: 90,
    // scheduler
    autoOrganize: true,
    fragmentationThreshold: 0.3,
    organizeInterval: 21600000,
  })

  const loadData = useCallback(async () => {
    const [fragRes, statsRes, historyRes, configRes] = await Promise.allSettled([
      dreamingApi.getStatus(),
      dreamingApi.getStats(),
      dreamingApi.getHistory(),
      dreamingApi.getConfig(),
    ])
    if (fragRes.status    === 'fulfilled' && fragRes.value.success)    setFrag(fragRes.value.data)
    if (statsRes.status   === 'fulfilled' && statsRes.value.success)   setDStats(statsRes.value.data)
    if (historyRes.status === 'fulfilled' && historyRes.value.success) {
      setHistoryReports(historyRes.value.data.slice().reverse().slice(0, 10))
    }
    if (configRes.status === 'fulfilled' && configRes.value.success) {
      const cfg = configRes.value.data
      // Initialize draft from server config
      setConfigDraft({
        similarityThreshold: cfg.consolidation.similarityThreshold,
        maxGroupSize: cfg.consolidation.maxGroupSize,
        preserveNewest: cfg.consolidation.preserveNewest,
        createNewVersion: cfg.consolidation.createNewVersion,
        importanceThreshold: cfg.archival.importanceThreshold,
        stalenessDaysArchival: cfg.archival.stalenessDays,
        retentionDays: cfg.archival.retentionDays,
        autoOrganize: cfg.scheduler.autoOrganize,
        fragmentationThreshold: cfg.scheduler.fragmentationThreshold,
        organizeInterval: cfg.scheduler.organizeInterval,
      })
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleOrganize = useCallback(async () => {
    setRunning(true)
    setPhases([['active','SCAN'], ['pending','ANALYZE'], ['pending','EXECUTE']])
    try {
      await new Promise(r => setTimeout(r, 600))
      setPhases([['done','SCAN'], ['active','ANALYZE'], ['pending','EXECUTE']])
      await new Promise(r => setTimeout(r, 500))
      setPhases([['done','SCAN'], ['done','ANALYZE'], ['active','EXECUTE']])

      const res = await dreamingApi.organize(orgType, limit)

      setPhases([['done','SCAN'], ['done','ANALYZE'], ['done','EXECUTE']])
      if (res.success) {
        setLastReport(res.data)
        setHistoryReports(prev => [res.data, ...prev.slice(0, 9)])
      }
      await loadData()
    } catch {
      setPhases([['pending','SCAN'], ['pending','ANALYZE'], ['pending','EXECUTE']])
    } finally {
      setRunning(false)
    }
  }, [orgType, limit, loadData])

  const handleSaveConfig = useCallback(async () => {
    setConfigSaving(true)
    setConfigMessage(null)
    try {
      await dreamingApi.updateConfig({
        consolidation: {
          similarityThreshold: configDraft.similarityThreshold,
          maxGroupSize: configDraft.maxGroupSize,
          preserveNewest: configDraft.preserveNewest,
          createNewVersion: configDraft.createNewVersion,
        },
        archival: {
          importanceThreshold: configDraft.importanceThreshold,
          stalenessDays: configDraft.stalenessDaysArchival,
          retentionDays: configDraft.retentionDays,
        },
        scheduler: {
          autoOrganize: configDraft.autoOrganize,
          fragmentationThreshold: configDraft.fragmentationThreshold,
          organizeInterval: configDraft.organizeInterval,
        },
      })
      setConfigMessage({ type: 'success', text: '配置已保存并持久化' })
      await loadData() // Reload to sync
    } catch (e) {
      setConfigMessage({ type: 'error', text: `保存失败: ${e instanceof Error ? e.message : '未知错误'}` })
    } finally {
      setConfigSaving(false)
    }
  }, [configDraft, loadData])

  const historyChart = useMemo(() =>
    historyReports.map((r, i) => ({
      name: `#${historyReports.length - i}`,
      合并: r.memoriesMerged,
      归档: r.memoriesArchived,
      重建关系: r.relationsRebuilt,
    })),
    [historyReports]
  )

  if (loading) return <div className="loading-wrap"><div className="spinner" /><span>加载梦境数据...</span></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>

      {/* Fragmentation gauges */}
      <div className="card">
        <div className="card-header">
          <span className="card-title"><Moon size={15} /> 碎片化指标</span>
          <button className="btn btn-ghost btn-sm" onClick={loadData}>
            <RefreshCw size={13} />
          </button>
        </div>
        {frag ? (
          <div style={{ display: 'flex', justifyContent: 'space-around', padding: 'var(--space-3) 0' }}>
            <CircleGauge value={frag.palaceFragmentation} max={1}  label="宫殿碎片化" color="#ef4444" />
            <CircleGauge value={frag.graphEdgeDensity}    max={1}  label="图谱边密度" color="#10b981" />
            <CircleGauge value={frag.orphanedMemories}    max={50} label="孤儿记忆数" color="#f59e0b" />
            <CircleGauge value={frag.staleMemories}       max={50} label="陈旧记忆数" color="#6366f1" />
          </div>
        ) : (
          <div className="empty-state" style={{ padding: 20 }}><p>暂无数据</p></div>
        )}
      </div>

      {/* Control panel */}
      <div className="card">
        <div className="card-title" style={{ marginBottom: 'var(--space-4)' }}>
          <Play size={15} /> 触发整理
        </div>

        {/* Type selector */}
        <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
          {ORG_TYPES.map(t => (
            <div
              key={t.value}
              onClick={() => setOrgType(t.value)}
              style={{
                padding: 'var(--space-3) var(--space-4)',
                borderRadius: 'var(--radius)',
                border: `1px solid ${orgType === t.value ? 'var(--color-primary)' : 'var(--color-border)'}`,
                background: orgType === t.value ? 'var(--color-primary-light)' : 'var(--color-surface)',
                cursor: 'pointer',
                transition: 'all 0.15s',
                minWidth: 120,
              }}
            >
              <div style={{
                fontSize: '0.875rem', fontWeight: 600, marginBottom: 2,
                color: orgType === t.value ? 'var(--color-primary)' : 'var(--color-text)',
              }}>{t.label}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{t.desc}</div>
            </div>
          ))}
        </div>

        {/* Limit slider */}
        <div className="form-group" style={{ maxWidth: 320, marginBottom: 'var(--space-4)' }}>
          <label className="form-label">最大处理数量: {limit}</label>
          <input
            type="range" className="form-range"
            min={10} max={500} step={10}
            value={limit}
            onChange={e => setLimit(Number(e.target.value))}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
            <span>10</span><span>500</span>
          </div>
        </div>

        <button
          className="btn btn-primary btn-lg"
          onClick={handleOrganize}
          disabled={running}
          style={{ minWidth: 160 }}
        >
          {running
            ? <><Loader size={16} style={{ animation: 'spin 0.6s linear infinite' }} /> 整理中...</>
            : <><Moon size={16} /> 开始整理</>
          }
        </button>
      </div>

      {/* Phase progress */}
      {(running || lastReport) && (
        <div className="card">
          <div className="card-title" style={{ marginBottom: 'var(--space-5)' }}>执行进度</div>
          <div className="phase-stepper">
            {phases.map(([state, label], i) => (
              <div key={label} className={`phase-step ${state}`}>
                <div className="phase-circle">
                  {state === 'done'   ? <CheckCircle size={14} /> :
                   state === 'active' ? <Loader size={14} style={{ animation: 'spin 0.6s linear infinite' }} /> :
                   i + 1}
                </div>
                <div className="phase-label">Phase {i + 1}<br />{label}</div>
              </div>
            ))}
          </div>

          {lastReport && (
            <div className="grid grid-4" style={{ marginTop: 'var(--space-5)' }}>
              {[
                { label: '合并记忆',  value: lastReport.memoriesMerged,   color: '#6366f1' },
                { label: '归档记忆',  value: lastReport.memoriesArchived,  color: '#f59e0b' },
                { label: '重建关系',  value: lastReport.relationsRebuilt,  color: '#10b981' },
                { label: '用时 (ms)', value: lastReport.totalDuration,     color: '#3b82f6' },
              ].map(item => (
                <div key={item.label} style={{
                  textAlign: 'center', padding: 'var(--space-4)',
                  background: 'var(--color-bg)', borderRadius: 'var(--radius)',
                  border: '1px solid var(--color-border)',
                }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: item.color }}>{item.value}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{item.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-2">
        <div className="card">
          <div className="card-title" style={{ marginBottom: 'var(--space-4)' }}>
            <BarChart2 size={15} /> 整理统计
          </div>
          <div className="grid grid-3" style={{ gap: 8 }}>
            {[
              { label: '总整理次数',   value: dStats?.totalReports ?? 0 },
              { label: '平均用时 (ms)', value: Math.round(dStats?.avgDuration ?? 0) },
              { label: '上次整理',      value: dStats?.lastReportAt
                  ? new Date(dStats.lastReportAt).toLocaleDateString('zh-CN')
                  : '未运行' },
            ].map(item => (
              <div key={item.label} style={{
                padding: 'var(--space-3)', background: 'var(--color-bg)',
                borderRadius: 'var(--radius)', border: '1px solid var(--color-border)',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{item.value}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{item.label}</div>
              </div>
            ))}
          </div>
        </div>

        {historyChart.length > 0 && (
          <div className="card">
            <div className="card-title" style={{ marginBottom: 'var(--space-4)' }}>历次整理结果</div>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={historyChart} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="合并"    fill="#6366f1" radius={[2,2,0,0]} />
                <Bar dataKey="归档"    fill="#f59e0b" radius={[2,2,0,0]} />
                <Bar dataKey="重建关系" fill="#10b981" radius={[2,2,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Config panel */}
      <div className="card">
        <div className="card-header" style={{ cursor: 'pointer' }} onClick={() => setShowConfig(v => !v)}>
          <span className="card-title"><Settings size={15} /> 整理配置</span>
          <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
            {showConfig ? '收起' : '展开'}
          </span>
        </div>

        {showConfig && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            {/* Consolidation settings */}
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>记忆合并</div>
              <div className="grid grid-2" style={{ gap: 'var(--space-3)' }}>
                <div className="form-group">
                  <label className="form-label">合并相似度阈值: {configDraft.similarityThreshold}</label>
                  <input
                    type="range" className="form-range"
                    min={0.5} max={1} step={0.05}
                    value={configDraft.similarityThreshold}
                    onChange={e => setConfigDraft(d => ({ ...d, similarityThreshold: +e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">最大组大小: {configDraft.maxGroupSize}</label>
                  <input
                    type="range" className="form-range"
                    min={2} max={10} step={1}
                    value={configDraft.maxGroupSize}
                    onChange={e => setConfigDraft(d => ({ ...d, maxGroupSize: +e.target.value }))}
                  />
                </div>
                <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <input
                    type="checkbox" id="preserveNewest"
                    checked={configDraft.preserveNewest}
                    onChange={e => setConfigDraft(d => ({ ...d, preserveNewest: e.target.checked }))}
                  />
                  <label htmlFor="preserveNewest" style={{ margin: 0 }}>保留最新版本</label>
                </div>
                <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <input
                    type="checkbox" id="createNewVersion"
                    checked={configDraft.createNewVersion}
                    onChange={e => setConfigDraft(d => ({ ...d, createNewVersion: e.target.checked }))}
                  />
                  <label htmlFor="createNewVersion" style={{ margin: 0 }}>创建新版本</label>
                </div>
              </div>
            </div>

            {/* Archival settings */}
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>归档清理</div>
              <div className="grid grid-2" style={{ gap: 'var(--space-3)' }}>
                <div className="form-group">
                  <label className="form-label">归档重要性阈值: {configDraft.importanceThreshold}</label>
                  <input
                    type="range" className="form-range"
                    min={1} max={8} step={1}
                    value={configDraft.importanceThreshold}
                    onChange={e => setConfigDraft(d => ({ ...d, importanceThreshold: +e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">陈旧天数: {configDraft.stalenessDaysArchival}</label>
                  <input
                    type="range" className="form-range"
                    min={7} max={365} step={7}
                    value={configDraft.stalenessDaysArchival}
                    onChange={e => setConfigDraft(d => ({ ...d, stalenessDaysArchival: +e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">保留天数: {configDraft.retentionDays}</label>
                  <input
                    type="range" className="form-range"
                    min={30} max={365} step={15}
                    value={configDraft.retentionDays}
                    onChange={e => setConfigDraft(d => ({ ...d, retentionDays: +e.target.value }))}
                  />
                </div>
              </div>
            </div>

            {/* Scheduler settings */}
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>调度器</div>
              <div className="grid grid-2" style={{ gap: 'var(--space-3)' }}>
                <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <input
                    type="checkbox" id="autoOrganize"
                    checked={configDraft.autoOrganize}
                    onChange={e => setConfigDraft(d => ({ ...d, autoOrganize: e.target.checked }))}
                  />
                  <label htmlFor="autoOrganize" style={{ margin: 0 }}>启用自动整理</label>
                </div>
                <div className="form-group">
                  <label className="form-label">碎片化触发阈值: {configDraft.fragmentationThreshold}</label>
                  <input
                    type="range" className="form-range"
                    min={0.1} max={0.9} step={0.05}
                    value={configDraft.fragmentationThreshold}
                    onChange={e => setConfigDraft(d => ({ ...d, fragmentationThreshold: +e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">整理间隔: {Math.round(configDraft.organizeInterval / 3600000)}小时</label>
                  <input
                    type="range" className="form-range"
                    min={1} max={24} step={1}
                    value={configDraft.organizeInterval / 3600000}
                    onChange={e => setConfigDraft(d => ({ ...d, organizeInterval: +e.target.value * 3600000 }))}
                  />
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
              {configMessage && (
                <span style={{
                  fontSize: '0.8rem',
                  color: configMessage.type === 'success' ? 'var(--color-success, #10b981)' : 'var(--color-error, #ef4444)',
                  alignSelf: 'center'
                }}>
                  {configMessage.text}
                </span>
              )}
              <button className="btn btn-primary btn-sm" onClick={handleSaveConfig} disabled={configSaving}>
                {configSaving ? '保存中...' : '保存配置'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
