<script setup lang="ts">
import { computed } from 'vue'
import type { CISource, GitSourceFilter, GitSourceFilterKey } from '@/types'
import { filterKeys, filterLabels } from '@/utils/gitSources'

const props = defineProps<{ source: CISource; disabled: boolean }>()
const emit = defineEmits<{ change: [filters: GitSourceFilter[]] }>()
const filters = computed(() => props.source.filters ?? [])
const keys = computed(() => filterKeys(props.source.type))
const available = computed(() => keys.value.filter(key => !filters.value.some(filter => filter.key === key)))
const options = (current: GitSourceFilterKey) => keys.value.filter(key => key === current || available.value.includes(key)).map(key => ({ label: filterLabels[key], value: key }))
function patch(index: number, changes: Partial<GitSourceFilter>) {
  emit('change', filters.value.map((filter, position) => position === index ? { ...filter, ...changes } : { ...filter }))
}
function add() {
  if (available.value[0]) emit('change', [...filters.value, { key: available.value[0], value: '' }])
}
</script>

<template>
  <div class="webhook-source">
    <p class="webhook-source__info">使用事件中记录的代码构建镜像；PR 的检出或合并在构建环境内完成。</p>
    <div class="webhook-source__prerequisite">
      <strong><t-icon name="link" /> 前置条件：配置仓库 Webhook</strong>
      <p>在 Git 仓库中添加对应事件的 Webhook；GitHub 的 Content type 使用 application/json。</p>
      <p class="u-muted">当前为前端 Mock，事件和 Payload 使用本地示例。Webhook URL 与密钥将在接口接入后提供。</p>
    </div>
    <p class="webhook-source__hint">仅构建符合以下全部过滤条件的事件，过滤值使用正则表达式。</p>
    <div v-for="(filter, index) in filters" :key="index" class="webhook-source__filter">
      <t-select :value="filter.key" :options="options(filter.key)" :disabled="disabled" :aria-label="`Webhook 过滤字段 ${index + 1}`" @change="patch(index, {key: $event as GitSourceFilterKey})" />
      <t-input :value="filter.value" placeholder="输入正则表达式" :disabled="disabled" :aria-label="`Webhook 过滤正则 ${index + 1}`" @change="patch(index, {value: String($event)})" />
      <t-button variant="text" shape="square" :disabled="disabled" :aria-label="`删除过滤条件 ${index + 1}`" @click="emit('change', filters.filter((_, position) => position !== index))"><t-icon name="close" /></t-button>
    </div>
    <t-button class="webhook-source__add" variant="text" theme="primary" :disabled="disabled || !available.length" @click="add"><template #icon><t-icon name="add" /></template>添加过滤条件</t-button>
    <p v-if="!filters.length" class="u-muted">未设置过滤条件，将显示该类型的所有事件。</p>
  </div>
</template>

<style scoped>
.webhook-source{font-size:13px}.webhook-source__info{margin:12px 0;padding:10px 12px;background:#e7f2ff;border-radius:4px;line-height:20px}.webhook-source__prerequisite{padding:16px;background:#f2f4f7;border-radius:4px;margin:16px 0}.webhook-source__prerequisite strong{display:flex;align-items:center;gap:8px;font-size:13px}.webhook-source__prerequisite p{margin:8px 0 0;line-height:20px}.webhook-source__hint{margin:16px 0;color:#596168;line-height:20px}.webhook-source__filter{display:grid;grid-template-columns:180px minmax(0,1fr) 32px;gap:12px;margin:0 0 12px}.webhook-source__add{margin-left:-12px}
</style>
