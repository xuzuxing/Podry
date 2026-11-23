<script setup lang="ts">
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue'
import type { K8sResource } from '@/types'
import { usePodLogs } from '@/composables/usePodLogs'
import { filterPodLogLines, logRangeLabel, type PodLogRange } from '@/utils/podLogs'
import PodLogRangeDialog from './PodLogRangeDialog.vue'
import XtermLogViewport from './XtermLogViewport.vue'

const props = defineProps<{ resource: K8sResource; active: boolean; initialContainer?: string; refreshKey: number }>()
const emit = defineEmits<{ container: [name: string] }>()
const { containers, container, previous, range, lines, loading, error, unavailable, paused, canStream, reload, chooseContainer } = usePodLogs(() => props.resource, () => props.active, () => props.initialContainer, () => props.refreshKey)
watch([() => props.active, container], ([active, name]) => { if (active && name) emit('container', name) }, { immediate: true })
const query = shallowRef(''), appliedQuery = shallowRef(''), customVisible = shallowRef(false), wrap = shallowRef(false), follow = shallowRef(true)
const viewport = useTemplateRef<InstanceType<typeof XtermLogViewport>>('viewport')
const result = computed(() => filterPodLogLines(lines.value, appliedQuery.value))
const groupLabels = { containers: '容器', initContainers: '初始化容器', ephemeralContainers: '临时容器' }
const groups = computed(() => (['containers', 'initContainers', 'ephemeralContainers'] as const).map(type => ({ type, label: groupLabels[type], items: containers.value.filter(item => item.type === type) })).filter(group => group.items.length))
const presets = [
  { label: '自定义…', value: 'custom' },
  ...[15, 30, 60, 120].map(minutes => ({ label: logRangeLabel({ type: 'duration', value: minutes * 60 }), value: `duration:${minutes * 60}` })),
  ...[500, 1000, 5000, 10000].map(value => ({ label: logRangeLabel({ type: 'lines', value }), value: `lines:${value}` })),
]
const rangeValue = computed(() => `${range.value.type}:${range.value.value}`)
const rangeOptions = computed(() => presets.some(item => item.value === rangeValue.value) ? presets : [...presets, { label: logRangeLabel(range.value), value: rangeValue.value }])
function selectRange(value: unknown): void {
  if (value === 'custom') { customVisible.value = true; return }
  const [type, number] = String(value).split(':')
  range.value = { type: type as PodLogRange['type'], value: Number(number) }
}
function search(): void { appliedQuery.value = query.value }
function scrollBottom(): void { viewport.value?.scrollBottom() }
function scrollTop(): void { follow.value = false; viewport.value?.scrollTop() }
function setFollow(value: unknown): void { follow.value = value === true; if (follow.value) void nextTick(scrollBottom) }
function keydown(event: KeyboardEvent): void {
  if (event.ctrlKey && event.key.toLowerCase() === 'c' && !window.getSelection()?.toString() && !(event.target instanceof HTMLInputElement)) { event.preventDefault(); paused.value = !paused.value }
}
function download(): void {
  if (!lines.value.length || loading.value || error.value || unavailable.value) return
  const url = URL.createObjectURL(new Blob([lines.value.join('\n')], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = `${props.resource.ref.name}-${container.value}${previous.value ? '-previous' : ''}.log`; link.click(); URL.revokeObjectURL(url)
}
watch(() => props.resource.ref.uid, () => { query.value = ''; appliedQuery.value = ''; follow.value = true; customVisible.value = false })
watch([lines, appliedQuery, () => props.active], async () => { await nextTick(); if (props.active && follow.value) scrollBottom() })
</script>

<template>
  <section class="pod-logs" aria-label="Pod 日志工作区" @keydown="keydown">
    <div class="pod-logs__toolbar">
      <div class="pod-logs__filters">
        <label>容器</label>
        <t-select class="pod-logs__container" :value="container" size="small" :disabled="!containers.length" placeholder="无可用容器" @change="chooseContainer(String($event))">
          <t-option-group v-for="group in groups" :key="group.type" :label="group.label"><t-option v-for="item in group.items" :key="item.name" :value="item.name" :label="item.name" /></t-option-group>
        </t-select>
        <t-checkbox v-model="previous" :disabled="!container">上一容器</t-checkbox>
        <t-select class="pod-logs__range" :value="rangeValue" size="small" :options="rangeOptions" @change="selectRange" />
        <t-button size="small" variant="text" aria-label="重新加载日志" :loading="loading" :disabled="!container" @click="reload"><template #icon><t-icon name="refresh" /></template></t-button>
        <t-button size="small" variant="text" aria-label="下载日志" :disabled="!lines.length || loading || !!error || !!unavailable" @click="download"><template #icon><t-icon name="download" /></template></t-button>
      </div>
      <form class="pod-logs__search" @submit.prevent="search">
        <t-input v-model="query" size="small" clearable placeholder="搜索日志 / grep -C 2 error" aria-label="搜索 Pod 日志" @enter="search" @clear="appliedQuery = ''"><template #prefix-icon><t-icon name="search" /></template></t-input>
        <t-button size="small" variant="text" type="submit">搜索</t-button>
        <t-popup trigger="click" placement="bottom-right"><t-button size="small" variant="text" aria-label="日志搜索帮助"><t-icon name="help-circle" /></t-button><template #content><div class="pod-logs__help">支持普通文本、grep -i、-A/-B/-C 上下文和 grep 管道。<br>例如：grep -A 2 -B 3 error | grep timeout<br>当前 Mock 按普通文本匹配，不执行命令或正则表达式。</div></template></t-popup>
      </form>
    </div>
    <div class="pod-logs__view-tools"><t-checkbox :checked="wrap" @change="wrap = $event === true">自动换行</t-checkbox><t-checkbox :checked="follow" @change="setFollow">自动滚动</t-checkbox><t-button size="small" variant="text" :disabled="previous || !container" @click="paused = !paused">{{ paused ? '继续' : '暂停' }}</t-button><span>{{ result.lines.length }} / {{ lines.length }} 行</span><t-button size="small" variant="text" aria-label="滚动到日志顶部" :disabled="!result.lines.length" @click="scrollTop"><t-icon name="chevron-up" /></t-button><t-button size="small" variant="text" aria-label="滚动到日志底部" :disabled="!result.lines.length" @click="scrollBottom"><t-icon name="chevron-down" /></t-button></div>
    <div v-if="result.error" class="pod-logs__notice" role="alert">{{ result.error }}</div>
    <div v-if="paused" class="pod-logs__paused">已停止打印新日志。<button @click="paused = false">继续（Ctrl+C）</button></div>
    <div v-if="loading" class="pod-logs__state" role="status"><t-loading size="small" />正在读取容器日志…</div>
    <div v-else-if="!containers.length" class="pod-logs__state">该 Pod 没有可用容器</div>
    <div v-else-if="error" class="pod-logs__state" role="alert"><t-icon name="error-circle" />{{ error }}<t-button variant="outline" theme="primary" size="small" @click="reload">重新连接</t-button></div>
    <div v-else-if="unavailable" class="pod-logs__state">{{ unavailable }}<t-button variant="text" size="small" @click="reload">重试</t-button></div>
    <div v-else-if="!lines.length" class="pod-logs__state">当前范围内没有日志，可调整日志范围后重试。</div>
    <div v-else-if="!result.lines.length" class="pod-logs__state">没有匹配的日志{{ result.error ? '' : '，请修改搜索条件。' }}</div>
    <XtermLogViewport v-else ref="viewport" v-model:follow="follow" class="pod-logs__viewport" :lines="result.lines" :wrap="wrap" :active="active" :context-key="`${resource.ref.uid}/${container}/${previous}/${rangeValue}/${appliedQuery}`" />
    <footer class="pod-logs__status"><span :class="{ 'is-live': canStream }">{{ loading ? '读取中' : error ? '读取失败' : unavailable ? '日志不可用' : previous ? '上一容器日志' : paused ? '已暂停' : canStream ? '本地 Mock 日志流' : '本地 Mock 历史日志' }}</span><span>{{ logRangeLabel(range) }} · {{ follow ? '跟随新增' : '已暂停滚动' }}</span></footer>
    <PodLogRangeDialog v-model:visible="customVisible" :range="range" @confirm="range = $event" />
  </section>
</template>

<style scoped>
.pod-logs { min-width: 0; display: flex; flex-direction: column; background: #181920; color: #fff; min-height: 400px; }
.pod-logs__toolbar { display: flex; flex-wrap: wrap; background: #f5f7fa; color: #3b444c; border-bottom: 1px solid #dce0e5; }
.pod-logs__filters { display: flex; flex: 1 1 630px; flex-wrap: wrap; align-items: center; gap: 8px; padding: 9px 12px; min-width: 0; }
.pod-logs__filters label { font-size: 12px; }
.pod-logs__container { width: 160px; }
.pod-logs__range { width: 156px; }
.pod-logs__filters :deep(.t-checkbox__label), .pod-logs__view-tools :deep(.t-checkbox__label) { font-size: 12px; }
.pod-logs__search { flex: 1 1 260px; display: flex; align-items: center; padding: 9px 8px; border-left: 1px solid #dce0e5; min-width: 0; }
.pod-logs__search .t-input__wrap { flex: 1; min-width: 0; }
.pod-logs__view-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; padding: 6px 14px; border-bottom: 1px solid #253242; }
.pod-logs__view-tools :deep(.t-checkbox__label) { color: #c8d1dc; }
.pod-logs__view-tools :deep(.t-button) { color: #9cb8d5; }
.pod-logs__view-tools > span { margin-left: auto; font-size: 11px; }
.pod-logs__state { min-height: 300px; display: flex; align-items: center; justify-content: center; gap: 12px; padding: 20px; text-align: center; font-size: 13px; }
.pod-logs__status { display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; padding: 8px 14px; font-size: 11px; color: #91a1b5; border-top: 1px solid #253242; }
.pod-logs__status .is-live { color: #63c697; }
.pod-logs__notice, .pod-logs__paused { background: #79303c; padding: 7px 16px; font-size: 12px; color: white; }
.pod-logs__paused button { background: none; border: none; color: inherit; text-decoration: underline; cursor: pointer; }
.pod-logs__help { padding: 8px; max-width: 340px; font-size: 12px; line-height: 1.8; }
</style>
