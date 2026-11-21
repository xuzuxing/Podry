import type {
  BuildStatus,
  ConnectionStatus,
  DeployStatus,
  Health,
  LogAvailability,
  MemberRole,
  SetupStatus,
} from '@/types'

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'default' | 'primary'

interface Entry {
  label: string
  tone: Tone
}

export const healthMap: Record<Health, Entry> = {
  unknown: { label: '未知', tone: 'default' },
  progressing: { label: '进行中', tone: 'info' },
  healthy: { label: '健康', tone: 'success' },
  completed: { label: '已完成', tone: 'success' },
  degraded: { label: '异常', tone: 'danger' },
  stopped: { label: '已停止', tone: 'default' },
}

export const buildStatusMap: Record<BuildStatus, Entry> = {
  queued: { label: '排队中', tone: 'info' },
  running: { label: '构建中', tone: 'info' },
  canceling: { label: '取消中', tone: 'warning' },
  succeeded: { label: '成功', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
  canceled: { label: '已取消', tone: 'default' },
  unknown: { label: '待核对', tone: 'warning' },
}

export const deployStatusMap: Record<DeployStatus, Entry> = {
  queued: { label: '排队中', tone: 'info' },
  submitting: { label: '提交中', tone: 'info' },
  observing: { label: '观察中', tone: 'info' },
  succeeded: { label: '成功', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
  unknown: { label: '待核对', tone: 'warning' },
}

export const logAvailabilityMap: Record<LogAvailability, Entry> = {
  runtime: { label: '实时日志', tone: 'info' },
  archived: { label: '已归档', tone: 'success' },
  unavailable: { label: '日志不可用', tone: 'default' },
  expired: { label: '日志已过期', tone: 'default' },
}

export const connectionMap: Record<ConnectionStatus, Entry> = {
  unknown: { label: '未检测', tone: 'default' },
  connected: { label: '已连接', tone: 'success' },
  unavailable: { label: '连接不可用', tone: 'danger' },
}

export const setupStatusMap: Record<SetupStatus, Entry> = {
  complete: { label: '已完成', tone: 'success' },
  pending: { label: '待配置', tone: 'warning' },
  blocked: { label: '被阻塞', tone: 'danger' },
  not_required: { label: '不需要', tone: 'default' },
}

export const roleMap: Record<MemberRole, Entry> = {
  admin: { label: '管理员', tone: 'primary' },
  developer: { label: '开发者', tone: 'info' },
  operator: { label: '运维', tone: 'warning' },
  viewer: { label: '观察者', tone: 'default' },
}

export const auditResultMap: Record<string, Entry> = {
  accepted: { label: '已受理', tone: 'info' },
  succeeded: { label: '成功', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
  denied: { label: '被拒绝', tone: 'warning' },
  unknown: { label: '待核对', tone: 'warning' },
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 2026-11-20 12:34 */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 11-20 12:34（表格里省年份） */
export function fmtShortTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 0) return fmtShortTime(iso)
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  return `${Math.floor(hour / 24)} 天前`
}

export function fmtDuration(from: string, to: string | null): string {
  if (!to) return '—'
  const ms = new Date(to).getTime() - new Date(from).getTime()
  if (ms <= 0) return '—'
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const rest = sec % 60
  return `${min}m ${rest}s`
}

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 8) : '—'
}

export function shortDigest(digest: string | null | undefined): string {
  if (!digest) return '—'
  const value = digest.replace('sha256:', '')
  return `sha256:${value.slice(0, 12)}`
}
