<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import type { ResourceColumn } from './listTypes'

const props = defineProps<{ columns: ResourceColumn[]; value: string[] }>()
const emit = defineEmits<{ change: [keys: string[]] }>()
const visible = shallowRef(false), keyword = shallowRef(''), draft = ref<string[]>([])
const choices = computed(() => props.columns.filter(column => column.key !== 'ops' && !column.mandatory && column.key !== 'name'))
const filtered = computed(() => choices.value.filter(column => `${column.label} ${column.key}`.toLowerCase().includes(keyword.value.trim().toLowerCase())))
watch(visible, (open) => { if (open) { draft.value = [...props.value]; keyword.value = '' } })
function apply(): void {
  emit('change', props.columns.filter(column => column.key !== 'ops' && (column.mandatory || column.key === 'name' || draft.value.includes(column.key))).map(column => column.key))
}
function toggle(open: boolean): void {
  if (!open && visible.value) apply()
  visible.value = open
}
function applyAndClose(): void { apply(); visible.value = false }
</script>

<template>
  <t-popup :visible="visible" trigger="click" placement="bottom-right" @visible-change="toggle">
    <t-button class="resource-table__columns" size="small" variant="text" aria-label="选择显示列"><template #icon><t-icon name="setting" /></template>Column</t-button>
    <template #content>
      <div class="resource-columns">
        <t-input v-model="keyword" autofocus clearable size="small" placeholder="搜索列" aria-label="搜索显示列"><template #prefix-icon><t-icon name="search" /></template></t-input>
        <t-checkbox-group v-model="draft" class="resource-columns__choices">
          <t-checkbox v-for="column in filtered" :key="column.key" :value="column.key">{{ column.label }}</t-checkbox>
        </t-checkbox-group>
        <span v-if="!filtered.length" class="u-dim">没有匹配的列</span>
        <div class="resource-columns__footer"><t-button size="small" block @click="applyAndClose">Apply</t-button></div>
      </div>
    </template>
  </t-popup>
</template>

<style scoped>
.resource-columns{width:240px;padding:12px 8px 0}.resource-columns__choices{display:flex;flex-direction:column;gap:10px;max-height:310px;overflow:auto;margin:14px 0}.resource-columns__footer{padding:12px 0;border-top:1px solid var(--tk-border)}
</style>
