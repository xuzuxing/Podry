import type { BuildConfig, BuildSecretReference } from '@/types'
import { buildDraft, type BuildDraft } from '@/types/build'

export const targetPlatforms = ['linux/arm64', 'linux/amd64', 'linux/arm/v7']

export function platformsOf(value: string): string[] {
  return [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))]
}

export function customPlatformsOf(config: BuildConfig): string[] {
  return config.buildMode === 'buildpack' ? [] : platformsOf(config.platform).filter(item => !targetPlatforms.includes(item))
}

export function buildReferenceError(references: BuildSecretReference[]): string {
  const ids = new Set<string>()
  for (const reference of references) {
    if (!['BUILD_INFRA', 'SOURCE_CODE'].includes(reference.type)) return '请选择有效的来源'
    const id = reference.id.trim()
    if (!id || !reference.secretName.trim() || !reference.key.trim()) return '请填写引用 ID、Secret 名称与键'
    if (!/^[A-Za-z0-9_.-]+$/.test(id)) return '引用 ID 仅支持字母、数字、下划线、点和短横线'
    if (ids.has(id)) return '引用 ID 不能重复'
    ids.add(id)
  }
  return ''
}

/** 白名单复制引用字段，Mock 也不接收额外的凭据明文。 */
export function normalizeBuildConfig(config: BuildConfig, materialId = ''): BuildDraft {
  const draft = buildDraft(config, materialId)
  const copyReferences = (references: BuildSecretReference[]) => references.map(({ type, id, secretName, key }) => ({ type, id: id.trim(), secretName: secretName.trim(), key: key.trim() }))
  return {
    ...draft,
    imageRepository: draft.imageRepository.trim(), dockerfile: draft.dockerfile.trim(),
    context: draft.context.trim(), builderImage: draft.builderImage.trim(), projectPath: draft.projectPath.trim(),
    platform: platformsOf(draft.platform).join(','),
    buildArguments: draft.buildArguments.map(({ key, value }) => ({ key: key.trim(), value })),
    buildpackArguments: draft.buildpackArguments.map(({ key, value }) => ({ key: key.trim(), value })),
    buildSecrets: copyReferences(draft.buildSecrets), buildSSH: copyReferences(draft.buildSSH),
  }
}
