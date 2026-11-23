<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import type { CISource, GitWebhookEvent } from '@/types'
import { webhookFilterResults, webhookMatches } from '@/utils/gitSources'
import { fmtTime } from '@/utils/format'
import { repositoryName } from '@/utils/gitMaterials'
import ErrorState from '@/components/ErrorState.vue'
import GitWebhookDetails from './GitWebhookDetails.vue'

const props = defineProps<{ source: CISource; events: GitWebhookEvent[]; repositoryUrl: string; loading: boolean; error: string }>()
const emit = defineEmits<{ back: []; edit: []; refresh: [] }>()
const activeId = shallowRef('')
const copying = shallowRef(false)
const rows = computed(() => props.events.map(event => ({ event, filters: webhookFilterResults(props.source, event), matches: webhookMatches(props.source, event) })))
const active = computed(() => rows.value.find(row => row.event.id === activeId.value))
const payload = computed(() => JSON.stringify(active.value?.event.payload ?? {}, null, 2))
watch(() => props.events, events => { if (!events.some(event => event.id === activeId.value)) activeId.value = events[0]?.id ?? '' }, { immediate: true })
async function copyPayload() {
  if (copying.value) return
  copying.value = true
  try { await navigator.clipboard.writeText(payload.value); MessagePlugin.success('已复制 Payload') }
  catch { MessagePlugin.error('复制失败，请手动选择 Payload 文本复制') }
  finally { copying.value = false }
}
</script>

<template>
  <section class="received-webhooks">
    <div class="received-webhooks__toolbar"><t-button variant="text" @click="emit('back')"><template #icon><t-icon name="chevron-left" /></template>返回构建</t-button><strong>已接收的 Webhook <span>Mock</span></strong><t-button variant="text" :loading="loading" aria-label="刷新已接收事件" @click="emit('refresh')"><t-icon name="refresh" /></t-button></div>
    <div v-if="loading" class="received-webhooks__empty"><t-loading text="读取已接收事件…" /></div>
    <ErrorState v-else-if="error" :message="error" @retry="emit('refresh')" />
    <div v-else class="received-webhooks__body">
      <aside class="received-webhooks__sidebar"><h4>已接收事件</h4><div class="received-webhooks__deliveries"><button v-for="row in rows" :key="row.event.id" type="button" class="webhook-delivery" :class="{'webhook-delivery--active': activeId === row.event.id}" :aria-pressed="activeId === row.event.id" @click="activeId = row.event.id"><t-icon :name="row.matches ? 'check-circle-filled' : 'close-circle-filled'" :class="row.matches ? 'passed' : 'failed'" size="20px" /><span><strong>{{ fmtTime(row.event.receivedAt) }}</strong><span>{{ row.event.title }}</span><span>通过 {{ row.filters.filter(filter => filter.matches).length }}/{{ row.filters.length }} 个过滤条件</span></span></button></div></aside>
      <main v-if="active" class="received-webhooks__detail">
        <header><strong>来自 /{{ repositoryName(repositoryUrl) }} 的事件</strong><t-button variant="text" aria-label="编辑 Webhook 过滤条件" @click="emit('edit')"><t-icon name="edit" /></t-button></header>
        <p>{{ active.event.title }} · {{ active.matches ? '符合当前过滤条件' : '不符合当前过滤条件' }}</p>
        <div class="received-webhooks__source"><GitWebhookDetails :event="active.event" :repository-url="repositoryUrl" /><p v-if="active.event.commit.excluded" class="failed">提交仅修改已排除路径中的文件，无法用于构建。</p></div>
        <div class="webhook-filter-results"><table><thead><tr><th>字段</th><th>Payload 中的值</th><th>配置的正则</th><th>结果</th></tr></thead><tbody><tr v-for="filter in active.filters" :key="filter.key"><td>{{ filter.label }}</td><td>{{ filter.received || '—' }}</td><td class="u-mono">{{ filter.value }}</td><td :class="filter.matches ? 'passed' : 'failed'">{{ filter.matches ? '通过' : '未通过' }}</td></tr><tr v-if="!active.filters.length"><td colspan="4">未设置过滤条件，接受此类型的所有事件。</td></tr></tbody></table></div>
        <div class="webhook-payload"><header><strong>Payload</strong><t-button variant="text" :loading="copying" aria-label="复制 Webhook Payload" @click="copyPayload"><t-icon name="copy" /></t-button></header><pre>{{ payload }}</pre></div>
      </main>
      <div v-else class="received-webhooks__empty">尚未接收到 Webhook 事件</div>
    </div>
  </section>
</template>

<style scoped>
.received-webhooks{display:flex;flex-direction:column;height:100%;min-height:0;font-size:13px}.received-webhooks__toolbar{display:flex;align-items:center;gap:12px;flex:none;border-bottom:1px solid #e6e9ef;padding:8px 16px}.received-webhooks__toolbar>.t-button:last-child{margin-left:auto}.received-webhooks__toolbar strong span{font-weight:400;font-size:11px;color:#767d84;margin-left:8px}.received-webhooks__body{display:grid;grid-template-columns:250px minmax(0,1fr);flex:1;min-height:0}.received-webhooks__sidebar{display:flex;flex-direction:column;min-height:0;border-right:1px solid #e6e9ef}.received-webhooks__sidebar h4{margin:0;padding:16px;border-bottom:1px solid #e6e9ef;font-size:13px}.received-webhooks__deliveries{padding:8px;overflow:auto;min-height:0}.webhook-delivery{display:flex;gap:8px;padding:12px 8px;width:100%;text-align:left;border:0;border-radius:4px;background:#fff;cursor:pointer;font:inherit;margin-bottom:4px}.webhook-delivery--active{background:#e7f2ff}.webhook-delivery>.t-icon{flex:none}.webhook-delivery>span{display:flex;flex-direction:column;gap:4px;overflow-wrap:anywhere}.webhook-delivery strong{font-size:12px;font-weight:500}.webhook-delivery span span{color:#596168;font-size:12px}.received-webhooks__detail{padding:16px 20px;overflow:auto;min-width:0}.received-webhooks__detail>header,.webhook-payload>header{display:flex;align-items:center;justify-content:space-between;gap:12px}.received-webhooks__detail>p{color:#596168;margin:4px 0 16px}.webhook-filter-results{overflow:auto;margin-bottom:20px}.webhook-filter-results table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:12px}.webhook-filter-results th,.webhook-filter-results td{padding:12px 8px;text-align:left;vertical-align:top;overflow-wrap:anywhere;border-bottom:1px solid #e6e9ef}.webhook-filter-results th{color:#767d84;font-weight:500}.webhook-filter-results th:last-child{width:60px}.passed{color:#00875f}.failed{color:#d54941}.webhook-payload{border:1px solid #d0d4d9;border-radius:4px;overflow:hidden}.webhook-payload header{padding:6px 12px;border-bottom:1px solid #e6e9ef;background:#f2f4f7}.webhook-payload pre{padding:16px;margin:0;overflow:auto;font:12px/21px monospace;background:#fafbfc}.received-webhooks__empty{display:grid;place-items:center;color:#767d84}
.received-webhooks__source{padding:16px;margin:12px 0 16px;border:1px solid #d0d4d9;border-radius:4px;background:#fff}
</style>
