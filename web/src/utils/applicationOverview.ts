import type { AppConfig, Application, ApplicationLabel, Artifact, Binding, Build, Deployment, Environment } from '@/types'
import { gitMaterialsOf, repositoryName } from './gitMaterials'

export interface OverviewEnvironment {
  id: string
  environmentId: string
  name: string
  production: boolean
  deployment: Deployment | null
  artifact: Artifact | null
  build: Build | null
}

export function legacyApplicationTags(application: Application): string[] {
  const structured = new Set((application.labels ?? []).map(label => `${label.key}:${label.value}`))
  return [...new Set(application.tags ?? [])].filter(tag => !structured.has(tag))
}

export function applicationLabelCopies(application: Application): ApplicationLabel[] {
  return (application.labels ?? []).map(label => ({...label}))
}

/** 取仓库名：https://github.com/acme/checkout-api.git → checkout-api */
export function overviewRepositories(config: AppConfig | null) {
  return gitMaterialsOf(config).map(material => ({id:material.id,name:repositoryName(material.repositoryUrl),url:repositoryWebUrl(material.repositoryUrl)}))
}

export function repositoryWebUrl(raw: string): string {
  const scp = /^git@([^:]+):(.+)$/.exec(raw)
  try {
    const parsed = new URL(scp ? `https://${scp[1]}/${scp[2]}` : raw)
    const url = parsed.protocol === 'ssh:' ? new URL(`https://${parsed.hostname}${parsed.pathname}`) : parsed
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    url.username = ''; url.password = ''
    url.pathname = url.pathname.replace(/\.git$/, '')
    return url.href
  } catch { return '' }
}

/** 镜像 tag：harbor.acme.dev/acme/app:v1.42.0 → v1.42.0 */
export function overviewImageLabel(image: string): string {
  if (image.includes('@')) return image.split('@').at(-1) ?? image
  const tail = image.split('/').at(-1) ?? image
  return tail.includes(':') ? tail.slice(tail.lastIndexOf(':')+1) : tail
}

export function overviewEnvironments(bindings: Binding[], environments: Environment[], deployments: Deployment[], artifacts: Artifact[], builds: Build[]): OverviewEnvironment[] {
  return bindings.map(binding => {
    const environment = environments.find(item => item.id === binding.environmentId)
    const candidates = deployments.filter(item => item.appId === binding.appId && item.bindingId === binding.id)
    const deployment = candidates.find(item => item.id === binding.currentDeploymentId)
      ?? candidates.slice().sort((a,b) => Date.parse(b.createdAt)-Date.parse(a.createdAt))[0] ?? null
    const artifact = deployment ? artifacts.find(item => item.id === deployment.artifactId && item.appId === binding.appId) ?? null : null
    const build = artifact?.buildId ? builds.find(item => item.id === artifact.buildId && item.appId === binding.appId) ?? null : null
    return {id:binding.id,environmentId:binding.environmentId,name:environment?.name ?? binding.environmentId,production:environment?.production ?? false,deployment,artifact,build}
  })
}

export function sortOverviewEnvironments(rows: OverviewEnvironment[], key: 'environment'|'deployedAt', direction: 'ASC'|'DESC'): OverviewEnvironment[] {
  return rows.slice().sort((left,right) => {
    if (key === 'environment') return (direction === 'ASC' ? 1 : -1)*left.name.localeCompare(right.name)
    const a = left.deployment ? Date.parse(left.deployment.createdAt) : NaN
    const b = right.deployment ? Date.parse(right.deployment.createdAt) : NaN
    if (!Number.isFinite(a)) return Number.isFinite(b) ? 1 : left.name.localeCompare(right.name)
    if (!Number.isFinite(b)) return -1
    return (direction === 'ASC' ? 1 : -1)*(a-b) || left.name.localeCompare(right.name)
  })
}
