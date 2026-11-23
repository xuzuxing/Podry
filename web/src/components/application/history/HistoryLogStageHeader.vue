<script setup lang="ts">
import { computed } from 'vue'
import { historyStageDuration, type HistoryLogStage, type HistoryStageStatus } from '@/utils/historyLogs'
const props = defineProps<{ stage: HistoryLogStage; open: boolean }>()
defineEmits<{ toggle: [] }>()
const labels: Record<HistoryStageStatus, string> = { succeeded: '成功', failed: '失败', running: '运行中', queued: '排队中', canceled: '已取消', unknown: '状态未知' }
const icons: Record<HistoryStageStatus, string> = { succeeded: 'check-circle-filled', failed: 'close-circle-filled', running: 'loading', queued: 'time', canceled: 'stop-circle', unknown: 'help-circle' }
const duration = computed(() => historyStageDuration(props.stage))
</script>

<template>
  <button class="history-log-stage" type="button" :aria-expanded="open" :data-stage="stage.title" @click="$emit('toggle')">
    <t-icon :name="open ? 'chevron-down' : 'chevron-right'" class="history-log-chevron" />
    <t-icon :name="icons[stage.status]" class="history-log-stage-status" :class="`is-${stage.status}`" :aria-label="labels[stage.status]" :title="labels[stage.status]" />
    <strong>{{ stage.title }}</strong>
    <span class="history-log-stage-meta">
      <t-popup v-if="stage.platforms.length" :content="stage.platforms.join(', ')" placement="bottom-right">
        <span class="history-log-platforms" :aria-label="`目标平台：${stage.platforms.join(', ')}`"><t-icon name="server" />{{ stage.platforms.length }} 个目标平台</span>
      </t-popup>
      <span v-if="duration" class="history-log-duration" :title="`${stage.startTime} → ${stage.endTime}`">{{ duration }}</span>
      <small>{{ stage.lines.length }} 行</small>
    </span>
  </button>
</template>

<style scoped>
.history-log-stage{display:flex;align-items:center;gap:8px;width:100%;min-height:36px;padding:6px 8px;border:0;border-radius:4px;background:#252c38;color:#d8e1ed;text-align:left;font:13px/20px var(--tk-mono);cursor:pointer;white-space:normal}
.history-log-stage:hover{background:#303847}.history-log-stage:focus-visible{outline:2px solid #61afef;outline-offset:-2px}
.history-log-stage>strong{min-width:0;overflow-wrap:anywhere;font-weight:400}.history-log-chevron,.history-log-stage-status{flex:none;font-size:16px}
.history-log-stage-status.is-succeeded{color:#98c379}.history-log-stage-status.is-failed{color:#e06c75}.history-log-stage-status.is-running{color:#61afef;animation:history-log-spin 1.2s linear infinite}
.history-log-stage-status.is-queued,.history-log-stage-status.is-unknown,.history-log-stage-status.is-canceled{color:#a2adbd}
.history-log-stage-meta{display:flex;align-items:center;justify-content:flex-end;gap:12px;flex-wrap:wrap;margin-left:auto;font-size:12px;color:#b5bfcc}
.history-log-stage-meta small{font-size:11px;white-space:nowrap}.history-log-platforms{display:flex;align-items:center;gap:4px;white-space:nowrap}.history-log-duration{white-space:nowrap}
@keyframes history-log-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.history-log-stage-status.is-running{animation:none}}
</style>
