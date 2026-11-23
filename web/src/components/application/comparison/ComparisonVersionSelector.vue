<script setup lang="ts">
import { computed } from 'vue'
import type { ComparisonOption, ComparisonSelection, ComparisonSide } from '@/types/configComparison'
import { comparisonInitialVersion } from '@/utils/configComparison'

const props = defineProps<{ side: 'left' | 'right'; selection: ComparisonSelection; environments: ComparisonOption[]; versions: ComparisonOption[]; result: ComparisonSide }>()
const emit = defineEmits<{ change: [selection: ComparisonSelection] }>()
const caption = computed(() => props.side === 'left' ? '基准' : '对比')
const environmentOptions = computed(() => {
  const base = props.environments.filter(item => item.value === 'base')
  const environments = props.environments.filter(item => item.value !== 'base' && !item.value.startsWith('chart:'))
  const charts = props.environments.filter(item => item.value.startsWith('chart:'))
  return [...base, ...(environments.length ? [{ group: 'Environments', children: environments }] : []), ...(charts.length ? [{ group: 'Chart default values', children: charts }] : []),
    ...(!props.environments.some(item => item.value === props.selection.environment) ? [{ label: `无效环境：${props.selection.environment}`, value: props.selection.environment }] : []),
  ]
})
const versionOptions = computed(() => props.versions.some(item => item.value === props.selection.version) ? props.versions : [...props.versions, { label: `无效版本：${props.selection.version}`, value: props.selection.version }])
</script>

<template>
  <section class="comparison-version" :data-side="side">
    <span class="comparison-version__caption">{{ caption }}</span>
    <div class="comparison-version__fields">
      <t-select :value="selection.environment" :options="environmentOptions" filterable :aria-label="`对比${side === 'left' ? '基准' : '目标'}环境`" @change="emit('change', { environment: String($event), version: comparisonInitialVersion(String($event)) })" />
      <t-select :value="selection.version" :options="versionOptions" filterable :aria-label="`${caption}配置版本`" @change="emit('change', { ...selection, version: String($event) })" />
    </div>
    <p class="comparison-version__notice" :title="result.notice || result.error" :class="{ 'comparison-version__notice--error': result.error }">{{ result.notice || result.error || '选择环境和配置版本' }}</p>
  </section>
</template>

<style scoped>
.comparison-version{min-width:0;flex:1;padding:16px 20px 12px}.comparison-version__caption{display:block;margin-bottom:8px;color:#767d84;font-size:11px;font-weight:600}.comparison-version__fields{display:grid;grid-template-columns:minmax(120px,.9fr) minmax(150px,1.25fr);gap:8px}.comparison-version__notice{height:18px;margin:8px 0 0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:11px;line-height:18px;color:#767d84}.comparison-version__notice--error{color:#d54941}@media(max-width:1300px){.comparison-version{padding:12px}.comparison-version__fields{grid-template-columns:minmax(0,1fr)}.comparison-version__notice{height:18px}}
</style>
