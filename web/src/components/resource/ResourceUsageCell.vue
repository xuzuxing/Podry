<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ percentage?: string; absolute?: string; allocatable?: string; tone: 'cpu' | 'memory' }>()
const available = computed(() => props.absolute !== undefined && props.absolute !== '—')
const width = computed(() => `${Math.max(0, Math.min(100, Number.parseFloat(props.percentage ?? '') || 0))}%`)
</script>
<template>
  <t-tooltip>
    <template #content>
      <div v-if="available" class="resource-usage__tooltip"><span>Usage (%) <b>{{ percentage }}</b></span><span>Usage (Abs.) <b>{{ absolute }}</b></span><span>Allocatable <b>{{ allocatable ?? '—' }}</b></span></div>
      <span v-else>Metrics API is not available：当前没有实际用量数据。</span>
    </template>
    <div v-if="available" class="resource-usage" :class="`resource-usage--${tone}`" tabindex="0"><div class="resource-usage__values"><span>{{ absolute }}</span><span>{{ percentage }}</span></div><div class="resource-usage__bar"><i :style="{ width }" /></div></div>
    <span v-else class="resource-usage__missing" tabindex="0">NA <t-icon name="info-circle" size="13px" /></span>
  </t-tooltip>
</template>
<style scoped>
.resource-usage{min-width:90px;padding:4px 0}.resource-usage__values{display:flex;justify-content:space-between;gap:8px;font-size:12px;line-height:18px}.resource-usage__values>span:last-child{color:var(--tk-text-3)}.resource-usage__bar{height:4px;margin-top:4px;background:#e3e8ef;overflow:hidden;border-radius:2px}.resource-usage__bar>i{display:block;height:100%;background:#06b6d4}.resource-usage--memory .resource-usage__bar>i{background:#8b5cf6}.resource-usage__tooltip{display:flex;flex-direction:column;gap:4px;min-width:160px}.resource-usage__tooltip>span{display:flex;justify-content:space-between;gap:12px}.resource-usage__tooltip b{font-weight:500}.resource-usage__missing{display:inline-flex;align-items:center;gap:6px;color:var(--tk-text-3)}
</style>
