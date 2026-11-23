<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, shallowRef, useTemplateRef, watch } from 'vue'
import { historyLogRowAt, historyLogRows, type HistoryLogRow } from '@/utils/historyLogLayout'
import type { HistoryLogStage } from '@/utils/historyLogs'
import HistoryLogStageHeader from './HistoryLogStageHeader.vue'

const props = defineProps<{ stages: HistoryLogStage[]; closed: ReadonlySet<string>; wrap: boolean; current: number; follow: boolean; label: string; logClass: string }>()
const emit = defineEmits<{ toggle: [key: string]; scroll: [distance: number, upward: boolean] }>()
const viewport = useTemplateRef<HTMLElement>('viewport')
const position = shallowRef(0), width = shallowRef(700), height = shallowRef(500), revision = shallowRef(0)
const measured = new Map<string, number>()
const rows = computed(() => { void revision.value; return historyLogRows(props.stages, props.closed, measured, props.wrap, width.value) })
const total = computed(() => { const last = rows.value.at(-1); return last ? last.top + last.height + 24 : 24 })
const headers = computed(() => rows.value.filter(row => !row.line))
const active = computed(() => {
  let index = -1
  for (let item = 0; item < headers.value.length && headers.value[item]!.top <= position.value; item++) index = item
  return index
})
const visible = computed(() => {
  if (!rows.value.length) return []
  const start = Math.max(0, historyLogRowAt(rows.value, position.value) - 25)
  const end = Math.min(rows.value.length, historyLogRowAt(rows.value, position.value + height.value) + 26)
  const result = rows.value.slice(start, end), sticky = headers.value[active.value]
  if (sticky && !result.includes(sticky)) result.unshift(sticky)
  return result
})
function rowStyle(row: HistoryLogRow): Record<string, string | number> {
  if (row !== headers.value[active.value]) return { transform: `translateY(${row.top}px)` }
  const next = headers.value[active.value + 1]
  return { transform: `translateY(${Math.max(row.top, Math.min(position.value, next ? next.top - row.height : Infinity))}px)`, zIndex: 2 }
}
let alive = true, observer: ResizeObserver | undefined, generation = 0, programmatic = 0
const observed = new Set<Element>()
function anchor(): { key?: string; offset: number } {
  const row = rows.value[historyLogRowAt(rows.value, position.value)]
  return { key: row?.key, offset: position.value - (row?.top ?? 0) }
}
function setTop(top: number): void {
  const element = viewport.value
  if (!element) return
  programmatic++
  element.scrollTop = top
  position.value = element.scrollTop
  void nextTick(() => requestAnimationFrame(() => { programmatic = Math.max(0, programmatic - 1) }))
}
function scrollTop(): void { setTop(0) }
function scrollBottom(): void { setTop(total.value) }
function capture(): { top: number; left: number } { return { top: position.value, left: viewport.value?.scrollLeft ?? 0 } }
function restore(value: { top: number; left: number }): void {
  setTop(value.top)
  if (viewport.value) viewport.value.scrollLeft = value.left
}
async function scrollToMatch(match: number): Promise<void> {
  const request = ++generation
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!alive || request !== generation) return
    const row = rows.value.find(item => item.line?.segments.some(segment => segment.match === match))
    if (!row) return
    setTop(Math.max(0, row.top - height.value / 2 + row.height / 2))
    await nextTick()
    if (!alive || request !== generation) return
    const element = viewport.value, found = element?.querySelector<HTMLElement>(`[data-match="${match}"]`)
    if (element && found) {
      const box = found.getBoundingClientRect(), parent = element.getBoundingClientRect()
      // A wrapped line can exceed the viewport height; reveal the match itself, not the row midpoint.
      setTop(position.value + box.top - parent.top - element.clientHeight / 2 + box.height / 2)
      element.scrollLeft += box.left - parent.left - element.clientWidth / 2
    }
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  }
}
function onScroll(): void {
  const element = viewport.value
  if (!element) return
  const upward = element.scrollTop < position.value
  position.value = element.scrollTop
  if (!programmatic) emit('scroll', element.scrollHeight - element.clientHeight - element.scrollTop, upward)
}
watch(visible, async () => {
  await nextTick()
  if (!alive || !observer || !viewport.value) return
  const elements = new Set(viewport.value.querySelectorAll('[data-row-key]'))
  for (const element of observed) if (!elements.has(element)) { observer.unobserve(element); observed.delete(element) }
  for (const element of elements) if (!observed.has(element)) { observer.observe(element); observed.add(element) }
}, { flush: 'post' })
watch(viewport, element => {
  observer?.disconnect(); observed.clear()
  if (!element) return
  width.value = element.clientWidth; height.value = element.clientHeight
  observer = new ResizeObserver(entries => {
    if (!alive) return
    const saved = anchor()
    let changed = false
    for (const entry of entries) {
      if (entry.target === element) {
        const nextWidth = element.clientWidth
        if (nextWidth !== width.value) { width.value = nextWidth; measured.clear(); changed = true }
        height.value = element.clientHeight
      } else {
        const key = (entry.target as HTMLElement).dataset.rowKey!, size = entry.borderBoxSize[0]?.blockSize ?? entry.target.getBoundingClientRect().height
        if (size > 0 && Math.abs((measured.get(key) ?? -1) - size) > .5) { measured.set(key, size); changed = true }
      }
    }
    if (changed) revision.value++
    void nextTick(() => {
      if (!alive) return
      if (props.follow) scrollBottom()
      else if (saved.key && changed) { const row = rows.value.find(item => item.key === saved.key); if (row) setTop(row.top + saved.offset) }
    })
  })
  observer.observe(element)
  for (const row of element.querySelectorAll('[data-row-key]')) { observer.observe(row); observed.add(row) }
}, { flush: 'post' })
watch(() => props.wrap, async () => {
  const saved = anchor(); measured.clear(); revision.value++
  await nextTick()
  if (!alive) return
  if (props.follow) scrollBottom()
  else { const row = rows.value.find(item => item.key === saved.key); if (row) setTop(row.top + saved.offset) }
})
watch(() => props.stages, () => { generation++; measured.clear(); revision.value++ })
onBeforeUnmount(() => { alive = false; generation++; observer?.disconnect(); observed.clear() })
defineExpose({ scrollTop, scrollBottom, scrollToMatch, capture, restore })
</script>

<template>
  <div ref="viewport" class="history-log-text" :class="[logClass, { 'is-wrapped': wrap }]" :aria-label="label" tabindex="0" @scroll="onScroll">
    <div class="history-log-window" :style="{ height: `${total}px` }">
      <div v-for="row in visible" :key="row.key" class="history-log-row" :class="{ 'is-header': !row.line }" :data-row-key="row.key" :style="rowStyle(row)">
        <HistoryLogStageHeader v-if="!row.line" :stage="row.stage" :open="!closed.has(row.stage.key)" @toggle="emit('toggle', row.stage.key)" />
        <div v-else class="history-log-line" :data-line="row.line.number">
          <span class="history-log-number" aria-hidden="true">{{ row.line.number }}</span>
          <pre><template v-for="(segment, index) in row.line.segments" :key="index"><mark v-if="segment.match !== null" :style="segment.style" :data-match="segment.match" :class="{ 'is-current': current === segment.match }">{{ segment.text }}</mark><span v-else :style="segment.style">{{ segment.text }}</span></template></pre>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.history-log-text{flex:1;min-height:0;min-width:0;overflow:auto;overflow-anchor:none;margin:0;padding:8px 12px 0;color:#d8e1ed;background:#171a21;font:13px/20px var(--tk-mono);outline-offset:-2px;tab-size:4}
.history-log-window{position:relative;min-width:100%}.history-log-row{position:absolute;top:0;left:0;width:100%;padding-bottom:4px;box-sizing:border-box}
.history-log-row.is-header{padding-bottom:0}.history-log-line{display:flex;align-items:flex-start;min-height:20px;width:max-content;min-width:100%;padding-bottom:0;box-sizing:border-box}
.history-log-number{flex:0 0 36px;padding-right:10px;color:#697586;text-align:right;user-select:none}
.history-log-line pre{margin:0;min-width:0;background:transparent;color:inherit;font:inherit;white-space:pre}
.is-wrapped .history-log-line{width:100%}.is-wrapped .history-log-line pre{flex:1;white-space:pre-wrap;overflow-wrap:anywhere}
.history-log-line mark{color:#fff!important;background:#785b17!important;border-radius:2px}.history-log-line mark.is-current{color:#fff!important;background:#0066cc!important;outline:1px solid #61afef}
</style>
