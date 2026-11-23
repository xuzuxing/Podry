<script setup lang="ts">
import { computed, ref } from 'vue'
export interface FilterOption { label: string; value: string }
export interface FilterGroup { key: string; label: string; options: FilterOption[] }
const props = defineProps<{ modelValue: Record<string, string[]>; groups: FilterGroup[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, string[]>] }>()
const open = ref(false)
const active = ref('project')
const search = ref('')
const current = computed(() => props.groups.find((group) => group.key === active.value) ?? props.groups[0])
const options = computed(() => current.value?.options.filter((option) => option.label.toLowerCase().includes(search.value.toLowerCase())) ?? [])
const selected = computed({ get: () => props.modelValue[current.value?.key ?? ''] ?? [], set: (value: string[]) => emit('update:modelValue', { ...props.modelValue, [current.value!.key]: value }) })
const chips = computed(() => props.groups.flatMap((group) => (props.modelValue[group.key] ?? []).map((value) => ({ key: group.key, value, label: group.options.find((option) => option.value === value)?.label ?? value }))))
function remove(key: string, value: string): void { emit('update:modelValue', { ...props.modelValue, [key]: (props.modelValue[key] ?? []).filter((item) => item !== value) }) }
function clear(): void { emit('update:modelValue', Object.fromEntries(props.groups.map((group) => [group.key, []]))) }
</script>
<template>
  <div class="application-filters">
    <t-popup v-model:visible="open" trigger="click" placement="bottom-left" :overlay-inner-style="{ padding: 0 }">
      <t-button size="small" variant="outline"><template #icon><t-icon name="filter" /></template>Filter<t-badge v-if="chips.length" :count="chips.length" /><kbd v-else>F</kbd></t-button>
      <template #content>
        <div class="filter-picker">
          <nav aria-label="筛选分类"><button v-for="group in groups" :key="group.key" :class="{active:active === group.key}" @click="active = group.key; search = ''">{{ group.label }}<span>{{ modelValue[group.key]?.length || '' }}</span></button></nav>
          <section><t-input v-model="search" size="small" clearable :placeholder="`搜索${current?.label ?? ''}`" /><t-checkbox-group v-model="selected"><t-checkbox v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</t-checkbox></t-checkbox-group><p v-if="!options.length" class="u-dim">没有匹配的筛选项</p></section>
          <footer><t-button variant="text" size="small" @click="clear">清空筛选</t-button><t-button variant="text" size="small" @click="open = false">完成</t-button></footer>
        </div>
      </template>
    </t-popup>
    <t-tag v-for="chip in chips" :key="chip.key + chip.value" closable variant="light" size="small" @close="remove(chip.key, chip.value)">{{ chip.label }}</t-tag>
    <t-button v-if="chips.length" variant="text" size="small" @click="clear">清空</t-button>
  </div>
</template>
<style scoped>
.application-filters{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.application-filters kbd{font-size:11px;border:1px solid var(--tk-border);margin-left:6px;padding:0 4px}.filter-picker{display:grid;grid-template-columns:152px 260px;grid-template-rows:minmax(230px,auto) 40px}.filter-picker nav{background:#f5f7fa;padding:8px}.filter-picker nav button{display:flex;align-items:center;justify-content:space-between;width:100%;font:inherit;background:none;border:0;text-align:left;padding:10px;cursor:pointer;border-radius:4px}.filter-picker nav button.active{background:var(--tk-primary-weak);color:var(--tk-primary)}.filter-picker section{display:flex;flex-direction:column;gap:16px;max-height:340px;overflow:auto;padding:12px}.filter-picker :deep(.t-checkbox-group){display:flex;flex-direction:column;gap:12px}.filter-picker footer{grid-column:1/3;display:flex;justify-content:space-between;border-top:1px solid var(--tk-border);padding:4px 12px}
</style>
