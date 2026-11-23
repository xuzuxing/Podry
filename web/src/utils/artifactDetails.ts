import type { Artifact, Build } from '@/types'

/** Registry ports and digest references must not be mistaken for image tags. */
export function artifactImageLabel(imageRef: string): string {
  const digestAt = imageRef.indexOf('@')
  if (digestAt >= 0) return imageRef.slice(digestAt + 1)
  const tagAt = imageRef.lastIndexOf(':')
  return tagAt > imageRef.lastIndexOf('/') ? imageRef.slice(tagAt + 1) : imageRef.split('/').pop() || imageRef
}

export function artifactImageRepository(imageRef: string): string {
  const named = imageRef.split('@')[0] || ''
  const tagAt = named.lastIndexOf(':')
  return tagAt > named.lastIndexOf('/') ? named.slice(0, tagAt) : named
}

export function artifactBuild(artifact: Artifact | null, build: Build | null): Build | null {
  if (!artifact || !build) return null
  return artifact.source === 'build' && artifact.buildId === build.id && artifact.appId === build.appId ? build : null
}

export function artifactMetadataInput(tags: string[], notes: string): { releaseTags: string[]; notes: string } {
  return { releaseTags: [...new Set(tags.map(tag => tag.trim()).filter(Boolean))], notes }
}

export function artifactMetadataError(tags: string[], notes: string): string {
  const { releaseTags } = artifactMetadataInput(tags, notes)
  if (releaseTags.length > 20) return '最多添加 20 个标签'
  if (releaseTags.some(tag => tag.length > 64)) return '每个标签不超过 64 个字符'
  if (notes.length > 2000) return '备注不超过 2000 个字符'
  return ''
}
