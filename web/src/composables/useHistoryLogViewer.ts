import { computed, nextTick, onScopeDispose, shallowRef, watch, type Ref } from 'vue'
import { parseHistoryLogs } from '@/utils/historyLogs'

export interface HistoryLogViewportHandle {
  scrollTop: () => void
  scrollBottom: () => void
  scrollToMatch: (match: number) => Promise<void>
  capture: () => { top: number; left: number }
  restore: (value: { top: number; left: number }) => void
}

export function useHistoryLogViewer(text: () => string, context: () => string, viewport: Ref<HistoryLogViewportHandle | null>, title: () => string, status: () => string) {
  const query = shallowRef('')
  const wrap = shallowRef(false)
  const follow = shallowRef(true)
  const closed = shallowRef<ReadonlySet<string>>(new Set())
  const current = shallowRef(0)
  const result = computed(() => parseHistoryLogs(text(), query.value, title(), status()))
  const allOpen = computed(() => result.value.stages.every(stage => !closed.value.has(stage.key)))
  let known = new Set<string>(), generation = 0
  let alive = true

  function scrollBottom(): void {
    viewport.value?.scrollBottom()
  }
  function scrollTop(): void {
    follow.value = false
    viewport.value?.scrollTop()
  }
  async function revealMatch(): Promise<void> {
    const request = ++generation
    const match = result.value.matches[current.value]
    if (!match) return
    closed.value = new Set([...closed.value].filter(key => key !== match.stageKey))
    await nextTick()
    if (alive && request === generation) await viewport.value?.scrollToMatch(current.value)
  }
  function moveMatch(delta: number): void {
    if (!result.value.count) return
    follow.value = false
    current.value = (current.value + delta + result.value.count) % result.value.count
    void revealMatch()
  }
  function onScroll(distance: number, upward: boolean): void {
    if (distance > 24 && upward) follow.value = false
  }
  function setFollow(value: boolean): void {
    follow.value = value
    if (value) void nextTick(() => { if (alive) scrollBottom() })
  }
  function toggleStage(key: string): void {
    follow.value = false
    const next = new Set(closed.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    closed.value = next
  }
  function toggleAll(): void {
    follow.value = false
    closed.value = allOpen.value ? new Set(result.value.stages.map(stage => stage.key)) : new Set()
  }

  watch(context, () => {
    generation++; known = new Set(result.value.stages.map(stage => stage.key))
    closed.value = new Set(result.value.stages.filter(stage => stage.status === 'succeeded').map(stage => stage.key))
    query.value = ''; current.value = 0; follow.value = true
  })
  watch(result, value => {
    const next = new Set([...closed.value].filter(key => value.stages.some(stage => stage.key === key)))
    for (const stage of value.stages) if (!known.has(stage.key) && stage.status === 'succeeded') next.add(stage.key)
    if (query.value) for (const match of value.matches) next.delete(match.stageKey)
    known = new Set(value.stages.map(stage => stage.key)); closed.value = next
  }, { immediate: true })
  watch(query, () => {
    current.value = 0
    if (query.value) { follow.value = false; void revealMatch() }
    else generation++
  })
  watch(text, async () => {
    current.value = Math.min(current.value, Math.max(0, result.value.count - 1))
    await nextTick()
    if (alive && follow.value) scrollBottom()
  }, { immediate: true })
  onScopeDispose(() => { alive = false; generation++ })
  return { query, wrap, follow, closed, allOpen, current, result, toggleStage, toggleAll, moveMatch, onScroll, setFollow, scrollTop, scrollBottom }
}
