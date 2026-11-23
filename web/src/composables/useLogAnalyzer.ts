import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { getPodLogs, MockError } from '@/api'
import type { K8sResource } from '@/types'
import { analyzerContainers, analyzerPodOptions, type AnalyzerSource } from '@/utils/logAnalyzer'
import { logRangeOptions, podContainers, type PodLogOptions, type PodLogRange } from '@/utils/podLogs'

interface LogAnalyzerOptions {
  resources: () => K8sResource[]
  active: () => boolean
  refreshKey?: () => number
  read?: (uid: string, options: PodLogOptions) => Promise<string[]>
}

export function useLogAnalyzer(options: LogAnalyzerOptions) {
  const read = options.read ?? getPodLogs
  const pod = shallowRef(''), container = shallowRef(''), previous = shallowRef(false), paused = shallowRef(false)
  const range = shallowRef<PodLogRange>({ type: 'lines', value: 500 })
  const sources = shallowRef<AnalyzerSource[]>([]), loading = shallowRef(false)
  const podOptions = computed(() => analyzerPodOptions(options.resources()))
  const selectedPods = computed(() => podOptions.value.find(item => item.value === pod.value)?.pods ?? [])
  const containers = computed(() => analyzerContainers(selectedPods.value))
  const targets = computed(() => selectedPods.value.filter(item => podContainers(item.manifest).some(entry => entry.name === container.value)))
  const successful = computed(() => sources.value.filter(source => !source.error))
  const failures = computed(() => sources.value.filter(source => source.error))
  const streamPods = computed(() => !options.active() || loading.value || previous.value || paused.value ? [] : targets.value.filter(item => successful.value.some(source => source.uid === item.ref.uid) && podContainers(item.manifest).some(entry => entry.name === container.value && entry.type === 'containers')))
  const canStream = computed(() => streamPods.value.length > 0)
  let generation = 0, alive = true

  async function reload(): Promise<void> {
    const request = ++generation
    sources.value = []; loading.value = false
    if (!alive || !options.active() || !targets.value.length) return
    const selection = [...targets.value], settings = { container: container.value, previous: previous.value, ...logRangeOptions(range.value) }
    loading.value = true
    const results = await Promise.allSettled(selection.map(item => read(item.ref.uid, settings)))
    if (!alive || request !== generation) return
    sources.value = results.map((result, index) => {
      const target = selection[index]!
      return {
        uid: target.ref.uid, pod: target.ref.name,
        lines: result.status === 'fulfilled' ? result.value : [],
        error: result.status === 'rejected' ? result.reason instanceof Error ? result.reason.message : '日志读取失败' : '',
        unavailable: result.status === 'rejected' && result.reason instanceof MockError && ['not_found', 'previous_logs_unavailable'].includes(result.reason.code),
      }
    })
    loading.value = false
  }
  function choosePod(value: string): void {
    if (!podOptions.value.some(item => item.value === value)) return
    pod.value = value; previous.value = false
    if (!containers.value.some(item => item.name === container.value)) container.value = ''
  }
  function chooseContainer(value: string): void {
    if (!containers.value.some(item => item.name === value)) return
    container.value = value; previous.value = false
  }
  /** Clearing the viewport keeps the stream and selection; reconnect replays the selected history. */
  function clear(): void { sources.value = sources.value.map(source => ({ ...source, lines: [] })) }
  function appendMockLine(now = Date.now()): void {
    const live = new Set(streamPods.value.map(item => item.ref.uid))
    if (!live.size) return
    const limit = range.value.type === 'lines' ? Math.min(range.value.value, 10000) : 10000
    sources.value = sources.value.map(source => live.has(source.uid) ? { ...source, lines: [...source.lines, `${new Date(now).toISOString()} INFO  [Mock/${container.value}] healthz /healthz 200`].slice(-limit) } : source)
  }
  watch(podOptions, items => {
    if (!items.some(item => item.value === pod.value)) {
      pod.value = items[0]?.value ?? ''; previous.value = false
      container.value = containers.value[0]?.name ?? ''
    } else if (container.value && !containers.value.some(item => item.name === container.value)) container.value = ''
  }, { immediate: true })
  watch([targets, container, previous, range, options.active, () => options.refreshKey?.() ?? 0], () => void reload(), { immediate: true })
  const timer = setInterval(() => appendMockLine(), 5000)
  onScopeDispose(() => { alive = false; generation++; clearInterval(timer) })
  return { pod, container, previous, paused, range, podOptions, selectedPods, containers, targets, sources, successful, failures, loading, canStream, reload, choosePod, chooseContainer, clear, appendMockLine }
}
