<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from 'vue'
import type { ResourceTab } from '@/stores/resourceTabs'

const props = withDefaults(defineProps<{
  tabs: ResourceTab[]
  active: string
  variant: 'cluster' | 'application'
  refreshing?: boolean
  syncedAt?: number
}>(), { refreshing: false, syncedAt: 0 })
const emit = defineEmits<{
  select: [id: string]
  close: [id: string]
  menu: [action: string, id: string]
  refresh: []
}>()
const strip = useTemplateRef<HTMLElement>('strip')
const root = useTemplateRef<HTMLElement>('root')
const picker = useTemplateRef<HTMLElement>('picker')
const trigger = useTemplateRef<HTMLElement>('trigger')
const visible = ref(false), keyword = ref(''), cursor = ref(0), now = ref(Date.now())
let focusFrame: number | undefined
const id = useId()
const prefix = computed(() => props.variant === 'cluster' ? 'ws' : 'res')
const results = computed(() => {
  const search = keyword.value.trim().toLocaleLowerCase()
  return props.tabs.filter(tab => `${tab.kind}/${tab.name} ${tab.namespace} ${tab.group || 'core'}`.toLocaleLowerCase().includes(search))
})
const syncLabel = computed(() => {
  if (props.refreshing) return '同步中…'
  if (!props.syncedAt) return '刷新资源'
  const seconds = Math.max(0, Math.floor((now.value - props.syncedAt) / 1000))
  return seconds < 10 ? '刚刚同步' : seconds < 60 ? `${seconds} 秒前同步` : `${Math.floor(seconds / 60)} 分钟前同步`
})
const menu = [{ content: '刷新', value: 'refresh' }, { content: '关闭', value: 'close' }, { content: '关闭其他页签', value: 'others' }, { content: '关闭全部资源页签', value: 'all' }]

function revealActive(): void {
  const selected = strip.value?.querySelector<HTMLElement>('[data-selected="true"]')
  if (!selected || !strip.value) return
  const bounds = strip.value.getBoundingClientRect(), item = selected.getBoundingClientRect()
  // 仅移动页签栏，避免 scrollIntoView 连带滚动应用状态卡和整个页面。
  if (item.left < bounds.left) strip.value.scrollLeft += item.left - bounds.left
  else if (item.right > bounds.right) strip.value.scrollLeft += item.right - bounds.right
}
watch(() => [props.active, props.tabs.length], () => void nextTick(revealActive), { immediate: true })
watch(() => props.tabs.map(tab => tab.id), ids => {
  const focused = document.activeElement?.closest<HTMLElement>('[data-resource-tab]')
  if (!focused || ids.includes(focused.dataset.resourceTab ?? '') || !root.value?.contains(focused) && !picker.value?.contains(focused)) return
  void nextTick(() => {
    if (visible.value && props.tabs.length) focusPicker()
    else (strip.value?.querySelector<HTMLButtonElement>('[data-selected="true"] [role="tab"]') ?? root.value?.querySelector<HTMLButtonElement>('.resource-workspace-tabs__fixed button'))?.focus()
  })
})
watch(() => props.syncedAt, () => { now.value = Date.now() })
watch(visible, async open => {
  if (!open) return
  keyword.value = ''
  cursor.value = Math.max(0, props.tabs.findIndex(tab => tab.id === props.active))
  await nextTick()
  focusPicker()
})
// Popup 首次打开时内容由浮层延后挂载，需要在实际 DOM 就绪后聚焦。
watch(picker, root => { if (visible.value && root) focusPicker() }, { flush: 'post' })
function focusPicker(): void {
  if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
  let remaining = 60
  const attempt = (): void => {
    if (!visible.value || !picker.value) return
    const input = picker.value.querySelector('input')
    // TDesign 在定位完成前会隐藏浮层，此时原生 focus() 不生效。
    if (input?.checkVisibility({ visibilityProperty: true })) { input.focus(); revealOption(); return }
    if (remaining-- > 0) focusFrame = requestAnimationFrame(attempt)
  }
  focusFrame = requestAnimationFrame(attempt)
}
watch(keyword, () => { cursor.value = 0 }, { flush: 'sync' })
watch(results, list => { cursor.value = Math.min(cursor.value, Math.max(0, list.length - 1)); if (!props.tabs.length) visible.value = false })
function closePicker(focus = false): void { visible.value = false; if (focus) trigger.value?.focus() }
function select(tab: ResourceTab): void { emit('select', tab.id); closePicker(true) }
function revealOption(): void { void nextTick(() => picker.value?.querySelector('[data-cursor="true"]')?.scrollIntoView({ block: 'nearest' })) }
function movePicker(event: KeyboardEvent): void {
  if (event.isComposing) return
  if (event.key === 'Escape') { event.preventDefault(); closePicker(true); return }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].includes(event.key)) return
  if (event.target instanceof HTMLElement && event.target.closest('.resource-tabs-picker__close')) return
  event.preventDefault()
  if (event.key === 'Enter') { const tab = results.value[cursor.value]; if (tab) select(tab); return }
  const length = results.value.length
  cursor.value = !length ? 0 : event.key === 'Home' ? 0 : event.key === 'End' ? length - 1 : (cursor.value + (event.key === 'ArrowDown' ? 1 : -1) + length) % length
  revealOption()
}
function moveStrip(event: KeyboardEvent): void {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  const buttons = [...strip.value!.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
  const index = buttons.indexOf(event.target as HTMLButtonElement)
  if (index < 0 || !buttons.length) return
  event.preventDefault()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
  buttons[next]?.focus()
}
let timer: ReturnType<typeof setInterval> | undefined
let observer: ResizeObserver | undefined
onMounted(() => {
  timer = setInterval(() => { now.value = Date.now() }, 10000)
  observer = new ResizeObserver(revealActive)
  if (strip.value) observer.observe(strip.value)
})
onBeforeUnmount(() => { if (timer) clearInterval(timer); if (focusFrame !== undefined) cancelAnimationFrame(focusFrame); observer?.disconnect() })
</script>

<template>
  <div ref="root" class="resource-workspace-tabs" :class="`resource-workspace-tabs--${variant}`">
    <div class="resource-workspace-tabs__fixed"><slot name="fixed" /></div>
    <div ref="strip" class="resource-workspace-tabs__strip" role="tablist" aria-label="已打开的资源" @keydown="moveStrip">
      <t-dropdown v-for="tab in tabs" :key="tab.id" trigger="context-menu" :options="menu" @click="emit('menu', String($event.value), tab.id)">
        <div class="resource-workspace-tabs__item" :data-resource-tab="tab.id" :data-selected="active === tab.id" :title="`${tab.kind}/${tab.name} · ${tab.namespace === '_cluster' ? '集群范围' : tab.namespace} · ${tab.group || 'core'}`">
          <button type="button" role="tab" :aria-selected="active === tab.id" class="resource-workspace-tabs__select" :class="[`${prefix}__tab`, { [`${prefix}__tab--active`]: active === tab.id }]" @click="emit('select', tab.id)"><span :class="`${prefix}__tab-label`">{{ tab.kind.toLowerCase() }}/{{ tab.name }}</span></button>
          <button type="button" class="resource-workspace-tabs__close" :class="`${prefix}__tab-close`" :aria-label="`关闭 ${tab.kind}/${tab.name} 页签`" @click.stop="emit('close', tab.id)"><t-icon name="close" size="12px" /></button>
        </div>
      </t-dropdown>
    </div>
    <div v-if="tabs.length" class="resource-workspace-tabs__tools">
      <t-tooltip v-if="active" :content="syncLabel">
        <t-button size="small" variant="text" shape="square" :loading="refreshing" aria-label="刷新当前资源" @click="emit('refresh')"><t-icon name="refresh" /></t-button>
      </t-tooltip>
      <span v-if="active && syncedAt" class="resource-workspace-tabs__sync">{{ syncLabel }}</span>
      <t-popup v-model:visible="visible" trigger="click" placement="bottom-right" :overlay-style="{ width: 'min(360px, calc(100vw - 32px))' }">
        <button ref="trigger" type="button" class="resource-workspace-tabs__picker" aria-label="搜索已打开的资源页签" :aria-expanded="visible" :aria-controls="id"><t-icon name="chevron-down" size="16px" /></button>
        <template #content>
          <div :id="id" ref="picker" class="resource-tabs-picker" @keydown="movePicker">
            <t-input v-model="keyword" size="small" clearable placeholder="搜索页签" aria-label="搜索资源页签" role="combobox" :aria-controls="`${id}-list`" :aria-expanded="visible" :aria-activedescendant="results.length ? `${id}-${cursor}` : undefined"><template #prefix-icon><t-icon name="search" /></template></t-input>
            <div :id="`${id}-list`" class="resource-tabs-picker__list" role="listbox" aria-label="已打开的资源页签">
              <div v-for="(tab, index) in results" :key="tab.id" class="resource-tabs-picker__row" :data-resource-tab="tab.id" :data-cursor="index === cursor" @mousemove="cursor = index">
                <button :id="`${id}-${index}`" type="button" role="option" :aria-selected="active === tab.id" class="resource-tabs-picker__option" @click="select(tab)"><span class="resource-tabs-picker__kind">{{ tab.kind }} <t-icon v-if="active === tab.id" name="check" size="13px" /></span><span class="resource-tabs-picker__name">{{ tab.name }}</span><span class="resource-tabs-picker__meta">{{ tab.namespace === '_cluster' ? '集群范围' : tab.namespace }} · {{ tab.group || 'core' }}</span></button>
                <button type="button" class="resource-tabs-picker__close" :aria-label="`关闭 ${tab.kind}/${tab.name} 页签`" @click.stop="emit('close', tab.id)"><t-icon name="close" size="14px" /></button>
              </div>
              <p v-if="!results.length" class="resource-tabs-picker__empty">没有匹配的资源页签</p>
            </div>
            <div class="resource-tabs-picker__footer">{{ results.length }} / {{ tabs.length }} 个页签</div>
          </div>
        </template>
      </t-popup>
    </div>
  </div>
</template>

<style scoped>
.resource-workspace-tabs{display:flex;flex:1;align-items:center;gap:8px;min-width:0;overflow:hidden;height:100%}
.resource-workspace-tabs__fixed{display:flex;align-items:center;gap:8px;flex:none;height:100%}.resource-workspace-tabs--application .resource-workspace-tabs__fixed{gap:20px}
.resource-workspace-tabs__strip{display:flex;align-items:center;flex:1;min-width:0;gap:4px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;height:100%}.resource-workspace-tabs__strip :deep(.t-dropdown){flex:none}
.resource-workspace-tabs__item{display:flex;align-items:center;height:28px;max-width:250px;border:1px solid transparent;border-radius:4px}.resource-workspace-tabs__item:hover{background:#eef2f9}.resource-workspace-tabs__item[data-selected="true"]{background:var(--tk-surface);border-color:var(--tk-border)}
.resource-workspace-tabs__select{display:flex;align-items:center;min-width:0;height:26px;padding:0 8px;color:var(--tk-text-2);font:inherit;font-size:12px;white-space:nowrap;background:none;border:0;cursor:pointer}.resource-workspace-tabs__select span{overflow:hidden;text-overflow:ellipsis}.resource-workspace-tabs__select[aria-selected="true"]{color:var(--tk-primary);font-weight:600}
.resource-workspace-tabs__close,.resource-tabs-picker__close{display:flex;align-items:center;justify-content:center;flex:none;width:22px;height:22px;padding:0;margin-right:3px;color:var(--tk-text-3);background:none;border:0;border-radius:3px;cursor:pointer}.resource-workspace-tabs__close:hover,.resource-tabs-picker__close:hover{color:var(--tk-danger);background:#fdeceb}
.resource-workspace-tabs__tools{display:flex;align-items:center;flex:none;gap:4px;padding-left:8px;border-left:1px solid var(--tk-border)}.resource-workspace-tabs__sync{color:var(--tk-text-3);font-size:11px;white-space:nowrap}.resource-workspace-tabs__picker{display:flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;color:var(--tk-text-2);background:var(--tk-surface);border:1px solid var(--tk-border);border-radius:3px;cursor:pointer}
.resource-tabs-picker{padding:8px;color:var(--tk-text)}.resource-tabs-picker__list{max-height:360px;overflow:auto;margin-top:8px}.resource-tabs-picker__row{display:flex;align-items:center;border-radius:3px}.resource-tabs-picker__row[data-cursor="true"]{background:var(--td-brand-color-light)}.resource-tabs-picker__option{display:flex;flex:1;flex-direction:column;gap:2px;min-width:0;padding:8px;text-align:left;font:inherit;background:none;border:0;cursor:pointer}.resource-tabs-picker__kind{display:flex;align-items:center;gap:6px;color:var(--tk-text-2);font-size:11px}.resource-tabs-picker__name{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.resource-tabs-picker__meta{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--tk-text-3);font-size:11px}.resource-tabs-picker__footer{padding:8px 8px 0;margin-top:4px;border-top:1px solid var(--tk-border);color:var(--tk-text-3);font-size:11px}.resource-tabs-picker__empty{padding:16px;color:var(--tk-text-3);font-size:12px}
@media(max-width:1280px){.resource-workspace-tabs__sync{display:none}}
</style>
