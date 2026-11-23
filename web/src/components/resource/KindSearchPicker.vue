<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from 'vue'
import { searchKinds, type KindSearchOption } from '@/utils/resourceFilters'

const props = defineProps<{ options: KindSearchOption[]; shortcutsDisabled?: boolean }>()
const emit = defineEmits<{ select: [resource: string, group: string] }>()
const keyword = ref(''), focused = ref(false), active = ref(0)
const root = useTemplateRef<HTMLElement>('root'), resultsRoot = useTemplateRef<HTMLElement>('resultsRoot')
const id = useId()
const results = computed(() => searchKinds(props.options, keyword.value))
const visible = computed(() => focused.value && !!keyword.value.trim())
function labelParts(label: string): Array<{ text: string; match: boolean }> {
  const search = keyword.value.trim().toLowerCase(), index = label.toLowerCase().indexOf(search)
  return index < 0 || !search ? [{ text: label, match: false }] : [{ text: label.slice(0, index), match: false }, { text: label.slice(index, index + search.length), match: true }, { text: label.slice(index + search.length), match: false }]
}
watch(keyword, () => { active.value = 0 })
watch(results, () => { active.value = Math.min(active.value, Math.max(0, results.value.length - 1)) })
function close(): void { keyword.value = ''; focused.value = false; root.value?.querySelector('input')?.blur() }
function select(option: KindSearchOption): void { emit('select', option.resource, option.group); close() }
function onKey(_value: string, { e }: { e: KeyboardEvent }): void {
  if (e.isComposing) return
  if (e.key === 'Escape') { e.preventDefault(); close() }
  else if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].includes(e.key) && visible.value) {
    e.preventDefault()
    if (e.key === 'Enter') { const option = results.value[active.value]; if (option) select(option); return }
    const length = results.value.length
    active.value = !length ? 0 : e.key === 'Home' ? 0 : e.key === 'End' ? length - 1 : (active.value + (e.key === 'ArrowDown' ? 1 : -1) + length) % length
    void nextTick(() => resultsRoot.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }))
  }
}
function shortcut(e: KeyboardEvent): void {
  if (props.shortcutsDisabled) return
  if (e.key.toLowerCase() !== 'k' || e.ctrlKey || e.metaKey || e.altKey || (e.target instanceof Element && e.target.closest('input,textarea,[contenteditable="true"]'))) return
  e.preventDefault(); root.value?.querySelector('input')?.focus()
}
onMounted(() => document.addEventListener('keydown', shortcut))
onBeforeUnmount(() => document.removeEventListener('keydown', shortcut))
</script>

<template>
  <div ref="root" class="kind-search">
    <t-popup :visible="visible" placement="bottom-left" :overlay-style="{ width: '300px' }" :on-visible-change="(open: boolean) => { if (!open) close() }">
      <t-input v-model="keyword" size="small" clearable placeholder="Jump to Kind" aria-label="Jump to Kind" role="combobox" :aria-expanded="visible" :aria-controls="id" :aria-activedescendant="visible && results.length ? `${id}-${active}` : undefined" @focus="focused = true" @blur="close" @keydown="onKey" @enter="onKey">
        <template #prefix-icon><t-icon name="search" /></template>
        <template #suffix><span class="kind-search__kbd">K</span></template>
      </t-input>
      <template #content>
        <div :id="id" ref="resultsRoot" class="kind-search__results" role="listbox" aria-label="匹配的资源类型">
          <button v-for="(option, index) in results" :id="`${id}-${index}`" :key="option.key" type="button" role="option" :aria-selected="index === active" :data-kind-result="option.key" class="kind-search__option" @mousedown.prevent @mousemove="active = index" @click="select(option)">
            <span class="kind-search__label"><template v-for="(part, partIndex) in labelParts(option.label)" :key="partIndex"><mark v-if="part.match" class="kind-search__highlight">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></span><span v-if="option.description" class="kind-search__description">{{ option.description }}</span>
          </button>
          <div v-if="!results.length" class="kind-search__empty">No matching kind</div>
        </div>
      </template>
    </t-popup>
  </div>
</template>

<style scoped>
.kind-search :deep(.t-popup){display:block}.kind-search__kbd{padding:0 4px;color:var(--tk-text-3);font-size:10px;border:1px solid var(--tk-border);border-radius:2px}
.kind-search__highlight{background:none;color:var(--tk-primary);font-weight:600}
.kind-search__results{max-height:340px;overflow:auto;padding:4px}.kind-search__option{display:flex;flex-direction:column;gap:2px;width:100%;padding:8px 10px;text-align:left;background:none;border:0;border-radius:3px;cursor:pointer;font:inherit}.kind-search__option[aria-selected="true"]{background:var(--td-brand-color-light)}.kind-search__label{font-size:13px;color:var(--tk-text)}.kind-search__description{font-size:12px;color:var(--tk-text-3)}.kind-search__label,.kind-search__description{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.kind-search__empty{padding:18px;color:var(--tk-text-3);font-size:12px}
</style>
