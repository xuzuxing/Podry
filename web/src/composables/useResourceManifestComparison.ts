import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { getDesiredResourceManifest } from '@/api'
import type { K8sResource } from '@/types'
import type { DesiredResourceManifest } from '@/types/resourceManifest'
import { resourceComparisonView } from '@/utils/resourceManifestComparison'

export function useResourceManifestComparison(options: { resource: () => K8sResource; clusterId: () => string }, service = getDesiredResourceManifest) {
  const snapshot = shallowRef<DesiredResourceManifest | null>(null)
  const loading = shallowRef(false), error = shallowRef('')
  let generation = 0, disposed = false
  const comparison = computed(() => {
    if (!snapshot.value) return { view: null, error: '' }
    try { return { view: resourceComparisonView(options.resource(), snapshot.value), error: '' } }
    catch (cause) { return { view: null, error: cause instanceof Error ? cause.message : 'Manifest 无法比较' } }
  })
  async function load(): Promise<void> {
    const request = ++generation, resource = options.resource(), clusterId = options.clusterId()
    loading.value = true; error.value = ''; snapshot.value = null
    try {
      const result = await service(clusterId, { ...resource.ref })
      if (!disposed && request === generation) snapshot.value = result
    } catch (cause) {
      if (!disposed && request === generation) error.value = cause instanceof Error ? cause.message : '期望 Manifest 加载失败'
    } finally { if (!disposed && request === generation) loading.value = false }
  }
  watch([() => options.resource().ref.uid, options.clusterId], () => { void load() }, { immediate: true })
  onScopeDispose(() => { disposed = true; ++generation })
  return { snapshot, loading, error: computed(() => error.value || comparison.value.error), view: computed(() => comparison.value.view), reload: load }
}
