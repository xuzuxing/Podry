import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { getPodLogs, MockError } from '@/api'
import type { K8sResource } from '@/types'
import { logRangeOptions, podContainers, type PodLogOptions, type PodLogRange } from '@/utils/podLogs'

export function usePodLogs(resource: () => K8sResource, active: () => boolean, initialContainer: () => string | undefined, refreshKey: () => number, read: (uid: string, options: PodLogOptions) => Promise<string[]> = getPodLogs) {
  const containers = computed(() => podContainers(resource().manifest))
  const container = shallowRef(''), previous = shallowRef(false)
  const range = shallowRef<PodLogRange>({ type: 'lines', value: 500 })
  const lines = shallowRef<string[]>([]), loading = shallowRef(false), error = shallowRef(''), unavailable = shallowRef('')
  const paused = shallowRef(false)
  const canStream = computed(() => active() && !loading.value && !error.value && !unavailable.value && !previous.value && !paused.value && containers.value.some(item => item.name === container.value && item.type === 'containers'))
  let generation = 0, alive = true
  /** mock 日志流：暂停时不再追加，便于对照排查；历史容器和初始化容器不追加。 */
  function appendMockLine(now = Date.now()): void {
    if (!canStream.value) return
    const limit = range.value.type === 'lines' ? Math.min(range.value.value, 10000) : 10000
    lines.value = [...lines.value, `${new Date(now).toISOString()} INFO  [Mock/${container.value}] healthz /healthz 200`].slice(-limit)
  }
  async function reload(): Promise<void> {
    const request = ++generation
    lines.value = []; error.value = ''; unavailable.value = ''; loading.value = false
    if (!alive || !active() || !container.value || !containers.value.some(item => item.name === container.value)) return
    loading.value = true
    try {
      const found = await read(resource().ref.uid, { container: container.value, previous: previous.value, ...logRangeOptions(range.value) })
      if (!alive || request !== generation) return
      lines.value = found
    } catch (err) {
      if (!alive || request !== generation) return
      if (err instanceof MockError && ['not_found', 'previous_logs_unavailable'].includes(err.code)) unavailable.value = err.message
      else error.value = err instanceof Error ? err.message : '日志读取失败'
    } finally { if (alive && request === generation) loading.value = false }
  }
  function chooseContainer(value: string): void {
    previous.value = false; container.value = value
  }
  watch(() => [resource().ref.uid, resource().manifest, initialContainer()] as const, () => {
    const requested = initialContainer()
    const next = containers.value.find(item => item.name === requested)?.name ?? containers.value.find(item => item.name === container.value)?.name ?? containers.value[0]?.name ?? ''
    previous.value = false; container.value = next
    void reload()
  }, { immediate: true })
  watch(() => resource().ref.uid, () => { paused.value = false; range.value = { type: 'lines', value: 500 } })
  watch([container, previous, range, active, refreshKey], () => void reload())
  const timer = setInterval(() => appendMockLine(), 5000)
  onScopeDispose(() => { alive = false; generation++; clearInterval(timer) })
  return { containers, container, previous, range, lines, loading, error, unavailable, paused, canStream, reload, chooseContainer, appendMockLine }
}
