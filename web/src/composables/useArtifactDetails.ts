import { onScopeDispose, shallowRef, watch } from 'vue'
import { getBuild, listArtifacts } from '@/api'
import type { Artifact, Build } from '@/types'
import { artifactBuild } from '@/utils/artifactDetails'

const defaultReaders = { listArtifacts, getBuild }

/** Lazy, scoped reads also find build records beyond the history page's first 50 rows. */
export function useArtifactDetails(options: { active: () => boolean; appId: () => string; artifactId: () => string }, readers = defaultReaders) {
  const artifact = shallowRef<Artifact | null>(null), build = shallowRef<Build | null>(null)
  const loading = shallowRef(false), error = shallowRef(''), sourceError = shallowRef('')
  let request = 0
  async function load(): Promise<void> {
    const token = ++request, appId = options.appId(), id = options.artifactId()
    artifact.value = null; build.value = null; error.value = ''; sourceError.value = ''; loading.value = false
    if (!options.active() || !appId || !id) return
    loading.value = true
    try {
      const items = await readers.listArtifacts(appId)
      if (token !== request) return
      const current = items.find(item => item.id === id && item.appId === appId) ?? null
      artifact.value = current
      if (current?.source === 'build' && current.buildId) {
        try {
          const record = await readers.getBuild(current.buildId)
          if (token !== request) return
          build.value = artifactBuild(current, record)
          if (!build.value) sourceError.value = '关联构建与当前镜像不匹配，无法显示源码。'
        } catch (err) {
          if (token === request) sourceError.value = err instanceof Error ? err.message : '关联构建加载失败'
        }
      }
    } catch (err) { if (token === request) error.value = err instanceof Error ? err.message : '镜像详情加载失败' }
    finally { if (token === request) loading.value = false }
  }
  function acceptSaved(saved: Artifact): void {
    if (saved.id === options.artifactId() && saved.appId === options.appId()) artifact.value = saved
  }
  watch(() => [options.active(), options.appId(), options.artifactId()], load, { immediate: true })
  onScopeDispose(() => { ++request })
  return { artifact, build, loading, error, sourceError, load, acceptSaved }
}
