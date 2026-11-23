<script setup lang="ts">
import { computed } from 'vue'
import { overviewStatusLabel } from '@/utils/managementOverview'
import type { ChartPart } from '@/utils/managementOverview'

const props = defineProps<{ parts: ChartPart[]; label: string; interactive?: boolean }>()
const emit = defineEmits<{ select: [part: ChartPart] }>()
const total = computed(() => props.parts.reduce((sum, part) => sum + part.value, 0))
const segments = computed(() => {
  let offset = 0
  return props.parts.filter(part => part.value > 0).map(part => {
    const length = part.value / total.value * 100
    const result = { ...part, length, offset }
    offset += length
    return result
  })
})
</script>

<template>
  <div class="overview-donut">
    <svg viewBox="0 0 140 140" role="img" :aria-label="`${label}：${parts.map(p => `${overviewStatusLabel(p.label)} ${p.value}`).join('，')}`">
      <circle cx="70" cy="70" r="52" fill="none" stroke="#edf1f5" stroke-width="22" />
      <circle v-for="part in segments" :key="part.label" cx="70" cy="70" r="52" pathLength="100" fill="none" :stroke="part.color" stroke-width="22" :stroke-dasharray="`${part.length} ${100 - part.length}`" :stroke-dashoffset="-part.offset" transform="rotate(-90 70 70)" :class="{ 'overview-donut__segment--interactive': interactive }" @click="interactive && emit('select', part)"><title>{{ overviewStatusLabel(part.label) }}：{{ part.value }}</title></circle>
      <text x="70" y="70" class="overview-donut__total">{{ total }}</text><text x="70" y="89" class="overview-donut__caption">{{ label }}</text>
    </svg>
    <ul class="overview-donut__legend"><li v-for="part in parts" :key="part.label"><component :is="interactive ? 'button' : 'span'" :type="interactive ? 'button' : undefined" class="overview-donut__legend-item" :aria-label="interactive ? `查看${overviewStatusLabel(part.label)}：${part.value}` : undefined" @click="interactive && emit('select', part)"><span class="overview-donut__dot" :style="{ background: part.color }" /><span>{{ overviewStatusLabel(part.label) }}</span><strong>{{ part.value }}</strong></component></li></ul>
  </div>
</template>

<style scoped>
.overview-donut{display:flex;align-items:center;justify-content:center;gap:16px;min-height:200px;padding:16px}.overview-donut svg{width:140px;max-width:50%;flex:none}.overview-donut__total{font-size:23px;font-weight:600;fill:var(--tk-text);text-anchor:middle;dominant-baseline:middle;font-variant-numeric:tabular-nums}.overview-donut__caption{font-size:10px;fill:var(--tk-text-3);text-anchor:middle}.overview-donut__legend{display:flex;flex-direction:column;gap:10px;min-width:0;font-size:12px}.overview-donut__legend li{display:flex;align-items:center;gap:7px}.overview-donut__legend strong{margin-left:auto;padding-left:6px;font-variant-numeric:tabular-nums}.overview-donut__dot{width:9px;height:9px;flex:none;border-radius:2px}
@media(max-width:1100px){.overview-donut{flex-direction:column;gap:4px}.overview-donut svg{width:120px;max-width:100%}.overview-donut__legend{width:100%}}
.overview-donut__legend-item{display:flex;align-items:center;gap:7px;width:100%;padding:0;border:0;background:none;color:inherit;font:inherit;text-align:left}.overview-donut__legend button{cursor:pointer}.overview-donut__legend button:hover{color:var(--tk-primary);text-decoration:underline}.overview-donut__legend button:focus-visible{outline:2px solid var(--tk-primary);outline-offset:3px}.overview-donut__segment--interactive{cursor:pointer}.overview-donut__segment--interactive:hover{opacity:.8}
</style>
