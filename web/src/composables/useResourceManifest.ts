import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { applyResource, dryRunResource, getResource, MockError } from '@/api'
import type { K8sResource } from '@/types'
import { resourceManifestView, validateResourceEdit } from '@/utils/resourceManifest'

type ManifestService = { dryRun: typeof dryRunResource; apply: typeof applyResource; get: typeof getResource }
export function useResourceManifest(options: { resource: () => K8sResource; clusterId: () => string; applied: (resource: K8sResource) => void }, service: ManifestService = { dryRun: dryRunResource, apply: applyResource, get: getResource }) {
  const mode = shallowRef<'read' | 'edit' | 'review'>('read')
  const hideManaged = shallowRef(true)
  const draft = shallowRef('')
  const baseline = shallowRef('')
  const checking = shallowRef(false)
  const saving = shallowRef(false)
  const reloading = shallowRef(false)
  const error = shallowRef('')
  const conflict = shallowRef(false)
  const validated = shallowRef<string | null>(null)
  let generation = 0, request = 0, disposed = false
  const view = computed(() => resourceManifestView(options.resource().manifest, hideManaged.value))
  const dirty = computed(() => mode.value !== 'read' && draft.value !== baseline.value)
  const canApply = computed(() => mode.value === 'review' && validated.value === draft.value && !conflict.value && !saving.value && !checking.value && !reloading.value)
  const busy = computed(() => saving.value || reloading.value)
  function cancel() {
    ++request
    mode.value = 'read'; draft.value = ''; baseline.value = ''; validated.value = null
    checking.value = false; error.value = ''; conflict.value = false
  }
  watch([options.resource, options.clusterId], () => { ++generation; cancel(); saving.value = false; reloading.value = false }, { immediate: true, flush: 'sync' })
  watch(draft, () => { ++request; validated.value = null; checking.value = false; error.value = '' }, { flush: 'sync' })
  function edit() {
    if (busy.value) return
    baseline.value = view.value.text; draft.value = view.value.text
    mode.value = 'edit'; error.value = ''; conflict.value = false
  }
  async function review() {
    if (mode.value === 'read' || busy.value || checking.value) return
    const validation = validateResourceEdit(draft.value, options.resource())
    if (validation) { error.value = validation; return }
    const text = draft.value, current = generation, token = ++request
    checking.value = true; error.value = ''
    try {
      const result = await service.dryRun(options.clusterId(), { manifest: text, namespace: options.resource().ref.namespace })
      if (disposed || current !== generation || token !== request || text !== draft.value) return
      if (!result.valid) { error.value = result.documents.filter(item => item.status === 'invalid').map(item => item.message).join('；'); return }
      validated.value = text; mode.value = 'review'
    } catch (cause) { if (!disposed && current === generation && token === request) error.value = cause instanceof Error ? cause.message : '清单校验失败' }
    finally { if (!disposed && current === generation && token === request) checking.value = false }
  }
  async function apply() {
    if (!canApply.value) return
    const validation = validateResourceEdit(draft.value, options.resource())
    if (validation) { error.value = validation; validated.value = null; return }
    const current = generation, resource = options.resource(), clusterId = options.clusterId(), text = draft.value
    let submitted = false
    saving.value = true; error.value = ''; conflict.value = false
    try {
      const result = await service.apply(clusterId, { manifest: text, expectedUid: resource.ref.uid, expectedManifest: resource.manifest })
      if (disposed || current !== generation) return
      if (result.status !== 'succeeded') throw new Error(result.items.find(item => item.result !== 'succeeded')?.message || '应用失败')
      submitted = true
      const updated = await service.get(clusterId, resource.ref.group, resource.ref.resource, resource.ref.namespace, resource.ref.name)
      if (disposed || current !== generation) return
      cancel(); options.applied(updated)
    } catch (cause) {
      if (disposed || current !== generation) return
      error.value = submitted ? '修改已提交，但重新读取失败。请重新读取当前资源后继续。' : cause instanceof Error ? cause.message : '应用失败'
      conflict.value = submitted || (cause instanceof MockError && cause.code === 'revision_conflict')
      validated.value = null
    } finally { if (!disposed && current === generation) saving.value = false }
  }
  async function reload() {
    if (busy.value) return
    const current = generation, resource = options.resource()
    reloading.value = true; error.value = ''
    try {
      const updated = await service.get(options.clusterId(), resource.ref.group, resource.ref.resource, resource.ref.namespace, resource.ref.name)
      if (!disposed && current === generation) { cancel(); options.applied(updated) }
    } catch (cause) { if (!disposed && current === generation) error.value = cause instanceof Error ? cause.message : '重新读取失败' }
    finally { if (!disposed && current === generation) reloading.value = false }
  }
  onScopeDispose(() => { disposed = true; ++generation; ++request })
  return { mode, hideManaged, draft, baseline, view, dirty, checking, saving, reloading, error, conflict, validated, canApply, busy, cancel, edit, review, apply, reload }
}
