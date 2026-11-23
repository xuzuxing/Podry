import type { AppConfig, BuildConfig, CIDefinition, CISource, GitMaterial } from '@/types'
import { buildDraft, type BuildDraft } from '@/types/build'
import { gitMaterialsOf, repositoryName } from './gitMaterials'
import { copySource, filterKeys, isWebhookSource, sourceSummary } from './gitSources'
import { buildReferenceError } from './buildOptions'

export function ciSourcesOf(config: AppConfig | null, definition?: CIDefinition): CISource[] {
  return gitMaterialsOf(config).map((material, index) => ({
    ...copySource(definition?.materials?.find((item) => item.gitMaterialId === material.id) ?? {
      gitMaterialId: material.id, type: 'branch' as const,
      value: index === 0 ? definition?.branch || material.branch : material.branch,
    }),
  }))
}

export function sourceError(source: CISource): string {
  if (!['branch', 'regex', 'tag', 'pull_request'].includes(source.type)) return '请选择有效的代码源类型'
  if (isWebhookSource(source)) {
    const keys = filterKeys(source.type)
    const filters = source.filters ?? []
    if (filters.some(filter => !keys.includes(filter.key))) return '请选择当前事件支持的过滤字段'
    if (new Set(filters.map(filter => filter.key)).size !== filters.length) return '过滤字段不能重复'
    for (const filter of filters) {
      if (!filter.value.trim()) return '请填写 Webhook 过滤正则表达式'
      try { new RegExp(filter.value) } catch { return 'Webhook 过滤正则表达式无效' }
    }
    return ''
  }
  if (!source.value.trim()) return source.type === 'regex' ? '请填写分支正则表达式' : 'CI 分支不能为空'
  if (source.type === 'regex') {
    try { new RegExp(source.value) } catch { return '分支正则表达式无效' }
  }
  return ''
}

export function sourceMatches(source: CISource, branch: string): boolean {
  if (sourceError(source) || isWebhookSource(source)) return false
  return source.type === 'branch' ? source.value === branch : new RegExp(source.value).test(branch)
}

export function effectiveBuildConfig(config: AppConfig, definition: CIDefinition): BuildDraft {
  const draft = buildDraft(definition.buildOverride ?? config.buildConfig, gitMaterialsOf(config)[0]?.id)
  if (draft.buildMode === 'buildpack') return { ...draft, platform: '', buildSecrets: [], buildSSH: [], buildArguments: [] }
  return draft.buildMode === 'managed' ? { ...draft, dockerfile: 'Dockerfile' } : draft
}

export function ciGraphSource(config: AppConfig | null, definition: CIDefinition) {
  const materials = gitMaterialsOf(config)
  const id = config ? effectiveBuildConfig(config, definition).gitMaterialId : ''
  const material = materials.find(item => item.id === id) ?? materials[0]
  const source = ciSourcesOf(config, definition).find(item => item.gitMaterialId === material?.id)
  return material ? { kind: 'git' as const, repo: repositoryName(material.repositoryUrl) + (materials.length > 1 ? ` (+${materials.length - 1})` : ''), branch: source ? sourceSummary(source) : material.branch }
    : { kind: 'webhook' as const, repo: '外部来源', branch: '' }
}

function pathError(value: string): string {
  value = value.trim()
  if (!value.trim()) return '请填写相对路径'
  if (value.startsWith('/') || value.includes('\\') || /^[A-Za-z]:/.test(value) || value.split('/').includes('..')) return '请使用仓库内的相对路径，不能包含上级目录 ..'
  return ''
}

export function validateBuildConfig(config: BuildConfig, materials: GitMaterial[]): Record<string, string> {
  const form = buildDraft(config, materials[0]?.id)
  const errors: Record<string, string> = {}
  if (!form.registryId) errors.registryId = '请选择镜像仓库'
  if (!form.imageRepository.trim() || form.imageRepository.trim().startsWith('/')) errors.imageRepository = '请填写有效的镜像 Repository'
  if (!['dockerfile', 'managed', 'buildpack'].includes(form.buildMode)) errors.buildMode = '请选择有效的构建方式'
  if (!materials.some((item) => item.id === form.gitMaterialId)) errors.gitMaterialId = '请选择源码仓库'
  if (form.buildMode === 'dockerfile' && pathError(form.dockerfile)) errors.dockerfile = pathError(form.dockerfile)
  if (form.buildMode === 'managed' && !form.dockerfileContent.trim()) errors.dockerfileContent = '请填写 Dockerfile 内容'
  if (form.buildMode === 'buildpack') {
    if (!form.builderImage.trim()) errors.builderImage = '请填写 Builder 镜像'
    if (!form.buildpackLanguage.trim()) errors.buildpackLanguage = '请选择构建语言'
    if (!form.buildpackVersion.trim()) errors.buildpackVersion = '请选择语言版本'
    if (pathError(form.projectPath)) errors.projectPath = pathError(form.projectPath)
  } else {
    if (pathError(form.context)) errors.context = pathError(form.context)
    if (!form.useRootContext && !materials.some((item) => item.id === form.contextGitMaterialId)) errors.contextGitMaterialId = '请选择构建上下文仓库'
  }
  if (form.buildMode !== 'buildpack') {
    if (form.platform && form.platform.split(',').some(item => !item.trim() || /\s/.test(item.trim()))) errors.platform = '目标平台不能包含空项或空白字符'
    const secretError = buildReferenceError(form.buildSecrets)
    const sshError = buildReferenceError(form.buildSSH)
    if (secretError) errors.buildSecrets = `构建 Secrets：${secretError}`
    if (sshError) errors.buildSSH = `SSH 引用：${sshError}`
  }
  if (!Number.isInteger(form.timeoutSeconds) || form.timeoutSeconds < 60 || form.timeoutSeconds > 86400) errors.timeoutSeconds = '构建超时需为 60–86400 之间的整数（秒）'
  const keys = (form.buildMode === 'buildpack' ? form.buildpackArguments : form.buildArguments).map((item) => item.key.trim())
  if (keys.some((key) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) || new Set(keys).size !== keys.length) errors.buildArguments = '参数名称需有效且不能重复'
  return errors
}
