<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  values: number[]
  /** 图形宽度（px） */
  width?: number
  /** 图形高度（px） */
  height?: number
  unit?: string
  tone?: 'primary' | 'success' | 'warning'
}>()

const W = computed(() => props.width ?? 160)
const H = computed(() => props.height ?? 40)

const spans = computed(() => {
  const values = props.values.length ? props.values : [0]
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1
  const step = W.value / Math.max(1, values.length - 1)
  return values.map((value, index) => {
    const x = index * step
    const y = H.value - ((value - min) / range) * (H.value - 6) - 3
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
})

const areaPath = computed(() => {
  const points = spans.value.join(' ')
  return `M0,${H.value} L${points.replace(/ /g, ' L')} L${W.value},${H.value} Z`
})

const last = computed(() => props.values[props.values.length - 1] ?? 0)
const stroke = computed(() => {
  if (props.tone === 'success') return '#2ba471'
  if (props.tone === 'warning') return '#e37318'
  return '#0052d9'
})
</script>

<template>
  <span class="spark">
    <svg :width="W" :height="H" :viewBox="`0 0 ${W} ${H}`" role="img" aria-hidden="true">
      <path :d="areaPath" :fill="stroke" opacity="0.10" />
      <polyline :points="spans.join(' ')" fill="none" :stroke="stroke" stroke-width="1.5" />
    </svg>
    <span class="spark__value">{{ last }}{{ unit ?? '' }}</span>
  </span>
</template>

<style scoped>
.spark {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.spark__value {
  min-width: 52px;
  font-size: 13px;
  font-weight: 600;
}
</style>
