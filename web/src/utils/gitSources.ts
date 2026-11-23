import type { CISource, GitMaterial, GitSourceFilterKey, GitWebhookEvent } from '@/types'

export const sourceLabels: Record<CISource['type'], string> = {
  branch: '分支固定', regex: '分支正则', tag: 'Tag Creation', pull_request: 'Pull Request',
}
export const filterLabels: Record<GitSourceFilterKey, string> = {
  tag: 'Tag 名称', sourceBranch: '源分支', targetBranch: '目标分支', action: '事件动作', author: '作者',
}
export function isWebhookSource(source: Pick<CISource, 'type'>): boolean {
  return source.type === 'tag' || source.type === 'pull_request'
}

/** 本地目录示例；真实接入时以 Git Provider 返回的事件和选择器元数据为准。 */
export function supportsWebhook(repositoryUrl: string): boolean {
  let host = ''
  try { host = new URL(repositoryUrl).hostname.toLowerCase() } catch {
    host = repositoryUrl.match(/^git@([^/:]+):/i)?.[1]?.toLowerCase() ?? ''
  }
  return ['github.com', 'gitlab.com', 'bitbucket.org'].includes(host ?? '')
}
export function sourceTypeOptions(material: GitMaterial | undefined, materialCount: number, current: CISource['type']) {
  const webhookAvailable = materialCount === 1 && supportsWebhook(material?.repositoryUrl ?? '')
  return (Object.keys(sourceLabels) as CISource['type'][])
    .filter(type => !isWebhookSource({ type }) || webhookAvailable || current === type)
    .map(type => ({ label: sourceLabels[type], value: type, disabled: isWebhookSource({ type }) && !webhookAvailable }))
}
export function sourceContextError(sources: CISource[], materials: GitMaterial[]): string {
  if (materials.length > 1 && sources.some(isWebhookSource)) return '多仓库应用仅支持固定分支与分支正则，请先修改 Webhook 代码源'
  if (sources.some(source => isWebhookSource(source) && !supportsWebhook(materials.find(material => material.id === source.gitMaterialId)?.repositoryUrl ?? ''))) return '当前仓库没有可用的 Webhook 事件目录，请改用分支代码源'
  return ''
}
export function filterKeys(type: CISource['type']): GitSourceFilterKey[] {
  return type === 'tag' ? ['tag', 'author'] : type === 'pull_request' ? ['sourceBranch', 'targetBranch', 'action', 'author'] : []
}
export function newSource(source: CISource, type: CISource['type'], defaultBranch: string): CISource {
  if (source.type === type) return copySource(source)
  const base = { gitMaterialId: source.gitMaterialId, type }
  if (type === 'tag') return { ...base, value: '', filters: [{ key: 'tag', value: '^v.*' }] }
  if (type === 'pull_request') return { ...base, value: '', filters: [{ key: 'targetBranch', value: '^main$' }] }
  return { ...base, value: type === 'regex' ? '^feature/.*' : defaultBranch }
}
export function copySource(source: CISource): CISource {
  return { ...source, ...(source.filters ? { filters: source.filters.map(filter => ({ ...filter })) } : {}) }
}
export function webhookFilterResults(source: CISource, event: GitWebhookEvent) {
  return (source.filters ?? []).map(filter => {
    let matches = false
    try { matches = new RegExp(filter.value).test(event.values[filter.key] ?? '') } catch { /* 无效正则不通过过滤。 */ }
    return { ...filter, label: filterLabels[filter.key], received: event.values[filter.key] ?? '', matches }
  })
}
export function webhookMatches(source: CISource, event: GitWebhookEvent): boolean {
  return source.type === event.type && webhookFilterResults(source, event).every(filter => filter.matches)
}
export function sourceSummary(source: CISource): string {
  return isWebhookSource(source) ? sourceLabels[source.type] : source.type === 'regex' ? source.selectedBranch || source.value : source.value
}
