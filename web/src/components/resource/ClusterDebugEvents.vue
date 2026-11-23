<script setup lang="ts">
import type { ResourceEvent } from '@/types'
import { fmtRelative } from '@/utils/format'
defineProps<{ events: ResourceEvent[] }>()
</script>
<template>
  <div class="debug-events" tabindex="0" aria-label="调试 Pod 事件">
    <p>调试 Pod 事件 · 本地 Mock</p>
    <table><thead><tr><th>类型</th><th>原因</th><th>消息</th><th>次数</th><th>年龄</th><th>最近出现</th></tr></thead><tbody><tr v-for="item in [...events].reverse()" :key="item.reason"><td><t-icon name="check-circle" /></td><td>{{ item.reason }}</td><td>{{ item.message }}</td><td>{{ item.count }}</td><td>{{ fmtRelative(item.firstSeenAt) }}</td><td>{{ fmtRelative(item.lastSeenAt) }}</td></tr></tbody></table>
  </div>
</template>
<style scoped>
.debug-events{flex:1;min-height:360px;overflow:auto;padding:0 20px 20px;background:#181920;color:#d4d4d4;font-size:12px}.debug-events>p{color:#a7acbc}.debug-events table{border-collapse:collapse;width:100%;min-width:850px;text-align:left;font:12px/20px var(--tk-mono)}.debug-events th{color:#a7acbc;font-weight:500;white-space:nowrap}.debug-events th,.debug-events td{padding:8px;border-bottom:1px solid #343641;vertical-align:top}.debug-events td:first-child{color:#6ac6a3}.debug-events td:nth-child(3){width:55%;overflow-wrap:anywhere}
</style>
