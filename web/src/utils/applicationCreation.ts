import type { ApplicationLabel } from '@/types'

// The reference checkout disables FEATURE_APP_NAME_40_CHAR_ENABLE.
export const APPLICATION_NAME_LIMIT = 30
export const APPLICATION_DESCRIPTION_LIMIT = 350
export interface ApplicationTagDraft extends ApplicationLabel { id: number }
export interface ApplicationIdentityDraft { projectId: string; name: string; description: string; sourceMode: 'git' | 'image'; tags: ApplicationTagDraft[] }
export interface ApplicationTagError { key: string; value: string }

export function applicationNameError(name: string): string {
  if (!name) return '请填写应用名称'
  if (name.length < 3 || name.length > APPLICATION_NAME_LIMIT) return `名称需为 3–${APPLICATION_NAME_LIMIT} 位`
  return /^[a-z][a-z0-9-]*[a-z0-9]$/.test(name) ? '' : '以小写字母开头、字母或数字结尾，仅允许小写字母、数字和连字符'
}
export function applicationDescriptionError(value: string): string { return value.length > APPLICATION_DESCRIPTION_LIMIT ? `描述不能超过 ${APPLICATION_DESCRIPTION_LIMIT} 位` : '' }

function labelName(value: string): boolean { return value.length <= 63 && /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/.test(value) }
function labelKey(value: string): boolean {
  const parts = value.split('/')
  if (parts.length === 1) return labelName(value)
  if (parts.length !== 2) return false
  const [prefix, name] = parts as [string, string]
  return prefix.length > 0 && prefix.length <= 253 && prefix.split('.').every(part => part.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part)) && labelName(name)
}
export function applicationTagErrors(rows: ApplicationLabel[]): ApplicationTagError[] {
  const counts = new Map<string, number>()
  rows.forEach(row => { if (row.key) counts.set(row.key, (counts.get(row.key) ?? 0) + 1) })
  return rows.map(row => {
    // Devtron ignores an entirely empty tag row.
    if (!row.key && !row.value) return { key: '', value: '' }
    return {
      key: !row.key ? '请填写标签键' : !labelKey(row.key) ? '键格式为 name 或 DNS前缀/name；name 最多 63 位' : counts.get(row.key)! > 1 ? '标签键不能重复' : '',
      value: !row.value ? '请填写标签值' : !labelName(row.value) ? '值最多 63 位，首尾为字母或数字，可包含点、下划线和连字符' : '',
    }
  })
}
export function applicationLabels(rows: ApplicationLabel[]): ApplicationLabel[] {
  return rows.filter(row => row.key || row.value).map(({key, value, propagate}) => ({key, value, propagate}))
}
export function applicationCreationErrors(draft: ApplicationIdentityDraft, projects: readonly string[]) {
  return {
    projectId: !projects.includes(draft.projectId) ? '请选择有效项目' : '',
    name: applicationNameError(draft.name),
    description: applicationDescriptionError(draft.description),
    tags: applicationTagErrors(draft.tags),
  }
}
