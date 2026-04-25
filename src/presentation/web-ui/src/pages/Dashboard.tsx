import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid,
} from 'recharts'
import {
  Database, Moon, Activity, Zap, Server, CheckCircle, XCircle,
  Plus, Search, RefreshCw
} from 'lucide-react'
import { systemApi, dreamingApi, type SystemStats, type HealthStatus, type FragmentationMetrics } from '../api/client'
import StatCard from '../components/StatCard'
import { useNavigate } from 'react-router-dom'

const TYPE_COLORS: Record<string, string> = {
  fact: '#3b82f6', event: '#10b981', decision: '#f59e0b', error: '#ef4444',
  learning: '#8b5cf6', relation: '#06b6d4', identity: '#ec4899',
  preference: '#f97316', persona: '#84cc16',
}

const SCOPE_COLORS = ['#6366f1', '#8b5cf6', '#10b981']

const FRAG_ITEMS = [
  { key: 'palaceFragmentation', label: '宫殿碎片化', max: 1 },
  { key: 'graphEdgeDensity',    label: '图谱边密度', max: 1  },
  { key: 'orphanedMemories',    label: '孤儿记忆数', max: 100 },
  { key: 'staleMemories',       label: '陈旧记忆数', max: 100 },
] as const

const HEALTH_CHECKS = [
  { label: 'MemoryService',   key: 'memoryService'   },
  { label: 'DreamingManager', key: 'dreamingManager' },
] as const

export default function Dashboard() {
  const navigate = useNavigate()
  const [stats, setStats]         = useState<SystemStats | null>(null)
  const [health, setHealth]       = useState<HealthStatus | null>(null)
  const [frag, setFrag]           = useState<FragmentationMetrics | null>(null)
  const [loading, setLoading]     = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      const [statsRes, healthRes, fragRes] = await Promise.allSettled([
        systemApi.getStats(),
        systemApi.getHealth(),
        dreamingApi.getStatus(),
      ])

      // 处理每个响应，成功才更新，失败则清除旧数据
      if (statsRes.status === 'fulfilled' && statsRes.value.success) {
        setStats(statsRes.value.data)
      } else {
        setStats(null)  // 失败时清除旧数据
      }

      if (healthRes.status === 'fulfilled' && healthRes.value.success) {
        setHealth(healthRes.value.data)
      } else {
        setHealth(null)
      }

      if (fragRes.status === 'fulfilled' && fragRes.value.success) {
        setFrag(fragRes.value.data)
      } else {
        setFrag(null)
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // 当页面重新可见时刷新（如从其他页面返回 Dashboard）
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        load()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [load])

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    load()
  }, [load])

  const typeData = useMemo(() =>
    stats ? Object.entries(stats.memoriesByType).map(([name, value]) => ({ name, value })) : [],
    [stats]
  )

  const scopeData = useMemo(() =>
    stats ? Object.entries(stats.memoriesByScope).map(([name, value]) => ({ name, value })) : [],
    [stats]
  )

  const isHealthy = health?.status === 'healthy'

  if (loading) return (
    <div className="loading-wrap">
      <div className="spinner" />
      <span>加载系统数据...</span>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>

      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
          系统运行中 · {health ? `已运行 ${Math.floor((health.uptime ?? 0) / 60)} 分钟` : ''}
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button className="btn btn-secondary btn-sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw size={13} style={{ animation: refreshing ? 'spin 0.6s linear infinite' : '' }} />
            刷新
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/memories')}>
            <Plus size={13} />新建记忆
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-4">
        <StatCard
          label="总记忆数"
          value={stats?.totalMemories ?? 0}
          icon={<Database size={18} />}
          color="var(--color-primary)"
        />
        <StatCard
          label="平均重要性"
          value={(stats?.avgImportanceScore ?? 0).toFixed(1)}
          icon={<Activity size={18} />}
          color="var(--color-warning)"
        />
        <StatCard
          label="梦境整理次数"
          value={stats?.dreamingRuns ?? 0}
          icon={<Moon size={18} />}
          color="var(--color-secondary)"
        />
        <StatCard
          label="系统状态"
          value={isHealthy ? '健康' : '异常'}
          icon={isHealthy ? <CheckCircle size={18} /> : <XCircle size={18} />}
          color={isHealthy ? 'var(--color-success)' : 'var(--color-danger)'}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-2">
        {/* Type distribution */}
        <div className="card">
          <div className="card-header">
            <span className="card-title"><Database size={15} /> 记忆类型分布</span>
          </div>
          {typeData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={typeData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--color-border)' }} />
                <Bar dataKey="value" name="数量" radius={[4, 4, 0, 0]}>
                  {typeData.map(entry => (
                    <Cell key={entry.name} fill={TYPE_COLORS[entry.name] ?? '#6366f1'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state" style={{ padding: 40 }}><p>暂无数据</p></div>
          )}
        </div>

        {/* Scope distribution */}
        <div className="card">
          <div className="card-header">
            <span className="card-title"><Zap size={15} /> 作用域分布</span>
          </div>
          {scopeData.length > 0 && scopeData.some(d => d.value > 0) ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={scopeData}
                  cx="50%" cy="50%"
                  outerRadius={80} innerRadius={45}
                  dataKey="value"
                  label={({ name, percent }: { name?: string; percent?: number }) =>
                    `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`
                  }
                  labelLine={false}
                >
                  {scopeData.map((_, i) => (
                    <Cell key={i} fill={SCOPE_COLORS[i % SCOPE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state" style={{ padding: 40 }}><p>暂无数据</p></div>
          )}
        </div>
      </div>

      {/* Health + Fragmentation */}
      <div className="grid grid-2">
        {/* System Health */}
        <div className="card">
          <div className="card-header">
            <span className="card-title"><Server size={15} /> 存储层状态</span>
            <span className={`badge ${isHealthy ? 'badge-green' : 'badge-red'}`}>
              {isHealthy ? '全部正常' : '部分异常'}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {HEALTH_CHECKS.map(({ label, key }) => {
              const ok = health?.checks[key as keyof typeof health.checks]
              return (
                <div key={key} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: 'var(--space-3)',
                  background: 'var(--color-bg)',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--color-border)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`status-dot${ok ? '' : ' error'}`} />
                    <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{label}</span>
                  </div>
                  <span className={`badge ${ok ? 'badge-green' : 'badge-red'}`}>
                    {ok ? '正常' : '异常'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Fragmentation */}
        <div className="card">
          <div className="card-header">
            <span className="card-title"><Moon size={15} /> 碎片化指标</span>
            <button className="btn btn-secondary btn-sm" onClick={() => navigate('/dreaming')}>
              查看详情
            </button>
          </div>
          {frag ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {FRAG_ITEMS.map(({ key, label, max }) => {
                const value = frag[key] ?? 0
                const pct   = Math.min(100, (value / max) * 100)
                const color = pct > 60 ? 'danger' : pct > 30 ? 'warning' : 'success'
                return (
                  <div key={key}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 4 }}>
                      <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
                      <span style={{ fontWeight: 600 }}>{max === 1 ? value.toFixed(2) : value}</span>
                    </div>
                    <div className="progress-bar">
                      <div className={`progress-fill ${color}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="empty-state" style={{ padding: 20 }}><p>暂无数据</p></div>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="card">
        <div className="card-title" style={{ marginBottom: 'var(--space-4)' }}>
          <Zap size={15} /> 快捷操作
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => navigate('/memories')}>
            <Plus size={14} /> 新建记忆
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/memories')}>
            <Search size={14} /> 语义搜索
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/dreaming')}>
            <Moon size={14} /> 触发梦境整理
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/palace')}>
            <Database size={14} /> 浏览记忆宫殿
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/profile')}>
            <Activity size={14} /> 用户画像
          </button>
        </div>
      </div>
    </div>
  )
}
