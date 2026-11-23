import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { applyResource, type ApplyResult } from '@/api'
import { createdResourceRows } from '@/utils/resourceCreation'

export function useResourceCreation(options: { clusterId: () => string }, service = { apply: applyResource }) {
  const manifest = shallowRef(''), phase = shallowRef<'edit' | 'submitting' | 'result'>('edit')
  const error = shallowRef(''), result = shallowRef<ApplyResult | null>(null), needsRefresh = shallowRef(false)
  const busy = computed(() => phase.value === 'submitting')
  const canApply = computed(() => phase.value === 'edit' && Boolean(manifest.value.trim()))
  const rows = computed(() => createdResourceRows(result.value?.items ?? []))
  let generation = 0, disposed = false
  watch(options.clusterId, () => {
    ++generation; manifest.value = ''; phase.value = 'edit'; error.value = ''; result.value = null; needsRefresh.value = false
  }, { flush: 'sync' })
  async function apply() {
    if (!canApply.value) return
    const current = ++generation, clusterId = options.clusterId(), text = manifest.value
    phase.value = 'submitting'; error.value = ''; result.value = null
    try {
      const response = await service.apply(clusterId, { manifest: text })
      if (disposed || current !== generation) return
      result.value = response; needsRefresh.value = true; phase.value = 'result'
    } catch (cause) {
      if (disposed || current !== generation) return
      error.value = cause instanceof Error ? cause.message : '应用失败，请重试'
      phase.value = 'edit'
    }
  }
  function edit() { if (!busy.value) { phase.value = 'edit'; error.value = '' } }
  onScopeDispose(() => { disposed = true; ++generation })
  return { manifest, phase, busy, canApply, error, rows, needsRefresh, apply, edit }
}
