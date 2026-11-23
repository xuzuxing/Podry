import type { LocationQuery } from 'vue-router'
import type { ResourceTab, ResourceTabKey } from '@/stores/resourceTabs'

export const detailQueryText = (value: LocationQuery[string]): string => String((Array.isArray(value) ? value[0] : value) ?? '')
const isPod = (resource: Pick<ResourceTab, 'group' | 'resource'>): boolean => !resource.group && resource.resource === 'pods'
export function resourceDetailTab(value: string, resource: Pick<ResourceTab, 'group' | 'resource'>): ResourceTabKey {
  return (['manifest', 'events', ...(isPod(resource) ? ['logs', 'terminal'] : [])].includes(value) ? value : 'manifest') as ResourceTabKey
}
export function resourceContainer(value: string): string | undefined {
  return value.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value) ? value : undefined
}

/** The existing tab identifier contains its resource address, so shared URLs do not require localStorage. */
export function resourceTabAddress(id: string, scope: string, clusterId: string): Omit<ResourceTab, 'kind' | 'tab'> | null {
  const parts = id.split('|')
  if (parts.length !== 6) return null
  const [storedScope, cluster, group, resource, namespace, name] = parts as [string, string, string, string, string, string]
  const dns = (value: string): boolean => value.length <= 253 && value.split('.').every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
  // RBAC names such as system:discovery are valid path segments, rather than DNS labels.
  const validName = !!name && name.length <= 253 && !['.', '..'].includes(name) && !/[/%|\s\u0000-\u001f\u007f]/.test(name)
  if (storedScope !== scope || cluster !== clusterId || !cluster || (group && !dns(group)) || !/^[a-z][a-z0-9-]*$/.test(resource) || resource.length > 63 || (namespace !== '_cluster' && (!dns(namespace) || namespace.includes('.'))) || !validName) return null
  return { id, scope, clusterId, group, resource, namespace, name }
}

export function resourceDetailQuery(query: LocationQuery, resource?: ResourceTab): LocationQuery {
  const next = { ...query }
  delete next.resourceTab
  delete next.container
  if (resource) {
    next.resourceTab = resourceDetailTab(resource.tab, resource)
    const container = isPod(resource) ? resourceContainer(resource.container ?? '') : undefined
    if (container) next.container = container
  }
  return next
}
