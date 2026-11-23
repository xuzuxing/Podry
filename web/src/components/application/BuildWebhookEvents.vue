<script setup lang="ts">
import { computed } from 'vue'
import type { CISource, GitWebhookEvent } from '@/types'
import { sourceLabels, webhookMatches } from '@/utils/gitSources'
import { shortSha } from '@/utils/format'
import GitWebhookDetails from './GitWebhookDetails.vue'

const props = defineProps<{ source: CISource; events: GitWebhookEvent[]; selectedId: string; disabled: boolean; repositoryUrl: string }>()
const emit = defineEmits<{ select: [id: string]; received: [] }>()
const events = computed(() => props.events.filter(event => webhookMatches(props.source, event)))
function select(event: GitWebhookEvent) { if (!props.disabled && !event.commit.excluded) emit('select', event.id) }
</script>

<template>
  <div class="build-webhook-events">
    <div class="build-webhook-events__info"><t-icon name="info-circle-filled" /><span>显示匹配已配置过滤条件的 {{ sourceLabels[source.type] }} 事件。</span><t-button variant="text" theme="primary" @click="emit('received')">查看已接收的 Webhook</t-button></div>
    <p class="build-webhook-events__mock">Mock 示例事件</p>
    <div v-if="!events.length" class="build-webhook-events__empty"><t-icon name="notification" size="32px" /><strong>没有符合过滤条件的 Webhook 事件</strong><span>查看已接收事件的过滤结果，或在流水线配置中调整条件。</span><t-button theme="primary" variant="text" @click="emit('received')">查看已接收的 Webhook</t-button></div>
    <div v-else class="build-webhook-events__list">
      <div v-for="event in events" :key="event.id" class="webhook-event-card" :class="{'webhook-event-card--selected': selectedId === event.id}" role="button" :tabindex="disabled || event.commit.excluded ? -1 : 0" :aria-disabled="disabled || event.commit.excluded" :aria-pressed="selectedId === event.id" :data-event-id="event.id" @click="select(event)" @keydown.enter.self.prevent="select(event)" @keydown.space.self.prevent="select(event)">
        <div class="webhook-event-card__body"><GitWebhookDetails :event="event" :repository-url="repositoryUrl" /><span class="webhook-event-card__sha" :title="event.commit.sha">{{ shortSha(event.commit.sha) }}</span></div>
        <t-tooltip v-if="event.commit.excluded" content="该提交仅修改已排除路径中的文件，无法用于构建。"><span class="webhook-event-card__excluded">已排除</span></t-tooltip>
        <span v-else class="webhook-event-card__pick"><t-icon v-if="selectedId === event.id" name="check" size="12px" /></span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.build-webhook-events{display:flex;flex-direction:column;min-height:0;height:100%;font-size:13px}.build-webhook-events__info{display:flex;align-items:center;flex-wrap:wrap;gap:8px;flex:none;padding:8px 16px;background:#f2f7fd;border-bottom:1px solid #e6e9ef}.build-webhook-events__info>.t-icon{color:#0066cc;flex:none}.build-webhook-events__info .t-button{padding:0}.build-webhook-events__mock{color:#767d84;font-size:12px;margin:12px 20px 0;flex:none}.build-webhook-events__list{padding:12px 20px;overflow:auto;min-height:0}.webhook-event-card{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;width:100%;border:1px solid #d0d4d9;background:#fff;border-radius:4px;padding:16px;margin-bottom:8px;font:inherit;text-align:left;cursor:pointer}.webhook-event-card--selected{border-color:#0066cc;background:#f7fbff}.webhook-event-card__body{display:flex;flex-direction:column;align-items:flex-start;gap:8px;min-width:0;overflow-wrap:anywhere}.webhook-event-card__body strong{font-size:14px;font-weight:600}.webhook-event-card__meta{color:#596168;font-size:12px}.webhook-event-card__sha{padding:0 6px;background:#e8f0fe;color:#0066cc;font:11px/20px monospace;border-radius:2px}.webhook-event-card__pick{display:flex;align-items:center;justify-content:center;width:16px;height:16px;border:1px solid #b1b7bc;border-radius:50%;flex:none;color:#fff}.webhook-event-card--selected .webhook-event-card__pick{background:#0066cc;border-color:#0066cc}.build-webhook-events__empty{display:flex;flex:1;flex-direction:column;justify-content:center;align-items:center;gap:12px;padding:24px;color:#596168;text-align:center}.build-webhook-events__empty strong{color:#000a14;font-size:16px;font-weight:500}
.webhook-event-card{box-sizing:border-box}.webhook-event-card:focus-visible{outline:2px solid #0066cc;outline-offset:2px}.webhook-event-card[aria-disabled=true]{cursor:not-allowed}.webhook-event-card__excluded{flex:none;color:#d54941;font-size:12px}
</style>
