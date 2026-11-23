import type { RouteLocationRaw } from 'vue-router'

export interface ChartPart { label: string; value: number; color: string }
export interface DistributionRow { id: string; label: string; value: number; to?: RouteLocationRaw }
export type OverviewPeriod = 'today' | 'week' | 'month' | 'lastMonth' | '7' | '30' | '90'
export type OverviewSort = 'desc' | 'asc' | 'az' | 'za'

const overviewStatusLabels: Record<string, string> = {
  Healthy: '健康', Unhealthy: '异常', 'Connection Failed': '连接失败', Unknown: '未知',
  Schedulable: '可调度', Unschedulable: '不可调度',
  'Network Unavailable': '网络不可用', 'Insufficient Memory': '内存不足',
  'Disk Pressure': '磁盘压力', 'Insufficient PID': '进程 ID 不足',
  'Kubelet Not Ready': 'Kubelet 未就绪', 'Other Errors': '其他错误',
  Ready: '就绪', NotReady: '未就绪', 'Not detected': '未检测到',
  'Mixed / Unknown': '混合 / 未知', Other: '其他',
  'Unknown (details unavailable)': '未知（详情不可用）',
}

/** 仅用于状态和分类文案；保留 API 枚举、资源名称及筛选值。 */
export function overviewStatusLabel(value: string): string {
  return overviewStatusLabels[value] ?? value
}

export const activityPeriods: Array<{ value: OverviewPeriod; label: string }> = [
  { value: 'today', label: '今天' }, { value: 'week', label: '本周' },
  { value: 'month', label: '本月' }, { value: 'lastMonth', label: '上月' },
]
export const relativePeriods: Array<{ value: OverviewPeriod; label: string }> = [
  { value: '7', label: '近 7 天' }, { value: '30', label: '近 30 天' }, { value: '90', label: '近 90 天' },
]

/** 日历边界使用浏览器本地时间，避免以过去 24 小时替代“今天”。 */
export function periodBounds(period: OverviewPeriod, now = new Date()): { start: number; end: number; days: number } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let end = now.getTime()
  if (period === 'week') start.setDate(start.getDate() - (start.getDay() + 6) % 7)
  else if (period === 'month') start.setDate(1)
  else if (period === 'lastMonth') { start.setDate(1); end = start.getTime(); start.setMonth(start.getMonth() - 1) }
  else if (period !== 'today') start.setDate(start.getDate() - Number(period) + 1)
  const last = new Date(period === 'lastMonth' ? end - 1 : end)
  // 使用 UTC 的日历序数计算天数，跨夏令时也不会多出或少掉一天。
  const ordinal = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000
  return { start: start.getTime(), end, days: ordinal(last) - ordinal(start) + 1 }
}

export function inPeriod(createdAt: string, period: OverviewPeriod, now: Date): boolean {
  const { start, end } = periodBounds(period, now)
  const time = Date.parse(createdAt)
  return time >= start && (period === 'lastMonth' ? time < end : time <= end)
}

export function formatDuration(minutes: number | null): string {
  if (minutes === null) return '—'
  if (minutes < 1) return `${Math.round(minutes * 60)} 秒`
  if (minutes < 60) return `${Number(minutes.toFixed(1))} 分钟`
  return `${Math.floor(minutes / 60)} 小时 ${Math.round(minutes % 60)} 分钟`
}

export function sortDistribution(rows: DistributionRow[], sort: OverviewSort): DistributionRow[] {
  return [...rows].sort((a, b) => sort === 'az' || sort === 'za'
    ? a.label.localeCompare(b.label, 'zh-CN') * (sort === 'az' ? 1 : -1)
    : (a.value - b.value) * (sort === 'asc' ? 1 : -1) || a.label.localeCompare(b.label, 'zh-CN'))
}

/** Kubernetes CPU 返回核数，内存返回字节。缺失和非法数值保留 null。 */
export function parseQuantity(value: string | undefined, resource: 'cpu' | 'memory'): number | null {
  if (!value) return null
  const match = /^([\d.]+)\s*([a-zA-Z]*)$/.exec(value.trim())
  if (!match) return null
  const amount = Number(match[1])
  const units: Record<string, number> = resource === 'cpu'
    ? { '': 1, m: 1e-3, u: 1e-6, n: 1e-9 }
    : { '': 1, Ki: 2 ** 10, Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40, Pi: 2 ** 50, K: 1e3, M: 1e6, G: 1e9, T: 1e12 }
  const scale = units[match[2] ?? '']
  return Number.isFinite(amount) && scale !== undefined ? amount * scale : null
}

export function percent(value: string | undefined): number | null {
  if (!value || !/^[\d.]+\s*%$/.test(value.trim())) return null
  const number = Number.parseFloat(value)
  return Number.isFinite(number) ? Math.max(0, number) : null
}
