<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { NODE_FILTER_KEYS, type NodeFilterKey, type NodeFilters } from '@/utils/resourceFilters'

const props = defineProps<{ value: NodeFilters; options: NodeFilters; search: string; loading: boolean }>()
const emit = defineEmits<{ change: [key: NodeFilterKey, values: string[]]; search: [value: string]; clear: []; refresh: [] }>()
const visible = ref(false), category = ref<NodeFilterKey>('label'), keyword = ref(''), draft = ref<string[]>([])
const searchRoot = useTemplateRef<HTMLElement>('searchRoot'), filterRoot = useTemplateRef<HTMLElement>('filterRoot')
const labels: Record<NodeFilterKey, string> = { label: 'Label', nodeGroup: 'Node Groups', k8sVersion: 'K8s Version' }
const prefixes: Record<NodeFilterKey, string> = { label: 'Label', nodeGroup: 'Node group', k8sVersion: 'K8s version' }
const placeholders: Record<NodeFilterKey, string> = { label: 'Search by key=value', nodeGroup: 'Search by node group name', k8sVersion: 'Select K8s version' }
const filtered = computed(() => [...new Set([...props.options[category.value], ...props.value[category.value]])].filter(value => value.toLowerCase().includes(keyword.value.trim().toLowerCase())))
const chips = computed(() => NODE_FILTER_KEYS.flatMap(key => props.value[key].map(value => ({ key, value }))))
const count = computed(() => chips.value.length)
function resetDraft(): void { draft.value = [...props.value[category.value]]; keyword.value = '' }
let focusFrame = 0
// TDesign teleports and reveals the overlay in separate frames. Focus after it can receive focus.
function focusFilter(attempt = 0): void {
  cancelAnimationFrame(focusFrame)
  if (!visible.value || attempt >= 30) return
  focusFrame = requestAnimationFrame(() => {
    if (!visible.value) return
    const input = filterRoot.value?.querySelector('input')
    if (input?.getClientRects().length) input.focus()
    if (!input || document.activeElement !== input) focusFilter(attempt + 1)
  })
}
watch([visible, category], () => { cancelAnimationFrame(focusFrame); if (visible.value) { resetDraft(); focusFilter() } })
watch(() => props.value, () => { if (visible.value) resetDraft() })
function apply(): void { emit('change', category.value, draft.value); visible.value = false }
function remove(key: NodeFilterKey, value: string): void { emit('change', key, props.value[key].filter(item => item !== value)) }
function escape(e: KeyboardEvent): void { if (e.key === 'Escape' && visible.value) { visible.value = false; e.stopPropagation() } }
function shortcut(e: KeyboardEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey || (e.target instanceof Element && e.target.closest('input,textarea,[contenteditable="true"]'))) return
  if (e.key === '/') { e.preventDefault(); searchRoot.value?.querySelector('input')?.focus() }
  if (e.key.toLowerCase() === 'f') { e.preventDefault(); visible.value = !visible.value }
}
onMounted(() => document.addEventListener('keydown', shortcut))
onBeforeUnmount(() => { document.removeEventListener('keydown', shortcut); cancelAnimationFrame(focusFrame) })
</script>

<template>
  <div class="node-filters" @keydown="escape">
    <div class="node-filters__toolbar">
      <div ref="searchRoot" class="node-filters__search list-search"><t-input :value="search" clearable size="small" placeholder="Search Nodes" aria-label="搜索节点" @change="emit('search', String($event))"><template #prefix-icon><t-icon name="search" /></template><template #suffix><kbd>/</kbd></template></t-input></div>
      <t-popup v-model:visible="visible" trigger="click" placement="bottom-left" destroy-on-close>
        <t-button class="node-filters__trigger" variant="outline" size="small" aria-label="节点筛选" :aria-expanded="visible"><template #icon><t-icon name="filter" /></template>Filters<span v-if="count" class="node-filters__badge">{{ count }}</span><t-icon name="chevron-down" /></t-button>
        <template #content>
          <div class="node-filter-picker" @keydown="escape">
            <nav class="node-filter-picker__categories" aria-label="节点筛选类别"><button v-for="key in NODE_FILTER_KEYS" :key="key" type="button" :class="{ active: category === key }" :data-node-category="key" @click="category = key">{{ labels[key] }}<span v-if="value[key].length">{{ value[key].length }}</span></button></nav>
            <div ref="filterRoot" class="node-filter-picker__body">
              <t-input v-model="keyword" clearable size="small" :placeholder="placeholders[category]" aria-label="搜索节点筛选项"><template #prefix-icon><t-icon name="search" /></template></t-input>
              <div class="node-filter-picker__options"><t-checkbox-group v-model="draft"><t-checkbox v-for="option in filtered" :key="option" :value="option" :data-node-option="option"><span :title="option">{{ option }}</span></t-checkbox></t-checkbox-group><div v-if="!filtered.length" class="node-filter-picker__empty">没有匹配的选项</div></div>
              <div class="node-filter-picker__footer"><t-button variant="text" size="small" @click="draft = []">Clear selection</t-button><t-button theme="primary" size="small" @click="apply">Apply</t-button></div>
            </div>
          </div>
        </template>
      </t-popup>
      <span class="node-filters__divider" /><slot />
      <t-button class="node-filters__refresh" variant="text" size="small" title="刷新资源" :loading="loading" @click="emit('refresh')"><t-icon name="refresh" /></t-button>
    </div>
    <div v-if="chips.length" class="node-filters__chips"><span v-for="chip in chips" :key="`${chip.key}/${chip.value}`" class="node-filter-chip"><span>{{ prefixes[chip.key] }}: {{ chip.value }}</span><button type="button" :aria-label="`移除 ${chip.value}`" @click="remove(chip.key, chip.value)"><t-icon name="close" size="12px" /></button></span><t-button variant="text" size="small" @click="emit('clear')">Clear filters</t-button></div>
  </div>
</template>

<style scoped>
.node-filters{min-width:0;width:100%;font-size:12px}.node-filters__toolbar{display:flex;align-items:center;gap:12px;min-height:52px;padding:8px 16px}.node-filters__search{width:250px;flex-shrink:1;min-width:140px}.node-filters__trigger{min-width:145px}.node-filters__badge{padding:0 4px;color:var(--tk-primary);background:var(--td-brand-color-light);border-radius:3px}.node-filters__divider{height:20px;border-right:1px solid var(--tk-border)}.node-filters__refresh{margin-left:auto}.node-filters__chips{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:0 16px 12px}.node-filter-chip{display:flex;align-items:center;gap:4px;max-width:100%;padding:3px 6px;background:#f0f3f7;border-radius:3px;color:var(--tk-text-2)}.node-filter-chip>span{overflow-wrap:anywhere}.node-filter-chip>button{display:flex;border:0;background:none;padding:2px;color:inherit;cursor:pointer}
.node-filter-picker{display:flex;width:540px;max-width:calc(100vw - 48px);font-size:12px}.node-filter-picker__categories{width:145px;flex:none;padding:8px;border-right:1px solid var(--tk-border)}.node-filter-picker__categories>button{display:flex;justify-content:space-between;width:100%;border:0;background:none;padding:10px 8px;font:inherit;text-align:left;border-radius:3px;cursor:pointer}.node-filter-picker__categories>button.active{color:var(--tk-primary);background:var(--td-brand-color-light)}.node-filter-picker__body{min-width:0;flex:1;padding:12px}.node-filter-picker__options{height:220px;overflow:auto;padding:12px 0}.node-filter-picker__options :deep(.t-checkbox-group){display:flex;flex-direction:column;align-items:flex-start;gap:10px}.node-filter-picker__options :deep(.t-checkbox){max-width:100%;height:auto;align-items:flex-start}.node-filter-picker__options :deep(.t-checkbox__label){min-width:0;white-space:normal;overflow-wrap:anywhere;font-size:12px;line-height:18px}.node-filter-picker__footer{display:flex;justify-content:space-between;border-top:1px solid var(--tk-border);padding-top:10px}.node-filter-picker__empty{padding:32px 8px;color:var(--tk-text-3)}
</style>
