<script setup lang="ts">
import { computed, nextTick, shallowRef, useTemplateRef } from 'vue'
import type { K8sResource } from '@/types'
import { useLogAnalyzer } from '@/composables/useLogAnalyzer'
import { filterAnalyzerSources } from '@/utils/logAnalyzer'
import { logRangeLabel, type PodLogRange } from '@/utils/podLogs'
import PodLogRangeDialog from './PodLogRangeDialog.vue'
import XtermLogViewport from './XtermLogViewport.vue'

const props = defineProps<{ resources: K8sResource[]; active: boolean; refreshKey: number }>()
const { pod, container, previous, paused, range, podOptions, selectedPods, containers, targets, sources, successful, failures, loading, canStream, reload, choosePod, chooseContainer, clear } = useLogAnalyzer({ resources: () => props.resources, active: () => props.active, refreshKey: () => props.refreshKey })
const query = shallowRef(''), appliedQuery = shallowRef(''), customVisible = shallowRef(false), wrap = shallowRef(false), follow = shallowRef(true)
const viewport = useTemplateRef<InstanceType<typeof XtermLogViewport>>('viewport')
const result = computed(() => filterAnalyzerSources(sources.value, appliedQuery.value))
const total = computed(() => sources.value.reduce((sum, source) => sum + source.lines.length, 0))
const skipped = computed(() => selectedPods.value.length - targets.value.length)
const groups = computed(() => [
  { label: '全部 Pod（按工作负载）', items: podOptions.value.filter(item => item.group) },
  { label: '单个 Pod', items: podOptions.value.filter(item => !item.group) },
].filter(group => group.items.length))
const containerGroups = computed(() => [
  { type: 'containers', label: '容器' }, { type: 'initContainers', label: '初始化容器' }, { type: 'ephemeralContainers', label: '临时容器' },
].map(group => ({ ...group, items: containers.value.filter(item => item.type === group.type) })).filter(group => group.items.length))
const presets = [
  { label: '自定义…', value: 'custom' },
  ...[15, 30, 60, 120].map(minutes => ({ label: logRangeLabel({ type: 'duration', value: minutes * 60 }), value: `duration:${minutes * 60}` })),
  ...[500, 1000, 5000, 10000].map(value => ({ label: logRangeLabel({ type: 'lines', value }), value: `lines:${value}` })),
]
const rangeValue = computed(() => `${range.value.type}:${range.value.value}`)
const rangeOptions = computed(() => presets.some(item => item.value === rangeValue.value) ? presets : [...presets, { label: logRangeLabel(range.value), value: rangeValue.value }])
const status = computed(() => loading.value ? '正在连接' : !container.value ? '请选择容器' : failures.value.length === sources.value.length && sources.value.length ? '日志不可用' : previous.value ? '上一容器日志' : paused.value ? '已停止打印' : canStream.value ? '已连接 · 本地 Mock 日志流' : '本地 Mock 历史日志')
function selectRange(value: unknown): void {
  if (value === 'custom') { customVisible.value = true; return }
  const [type, number] = String(value).split(':')
  range.value = { type: type as PodLogRange['type'], value: Number(number) }
}
function search(): void { appliedQuery.value = query.value }
function setFollow(value: unknown): void { follow.value = value === true; if (follow.value) void nextTick(() => viewport.value?.scrollBottom()) }
function keydown(event: KeyboardEvent): void {
  const target = event.target
  if (event.ctrlKey && event.key.toLowerCase() === 'c' && !window.getSelection()?.toString() && !(target instanceof HTMLInputElement) && !previous.value && targets.value.length) { event.preventDefault(); paused.value = !paused.value }
}
function download(): void {
  if (loading.value) return
  for (const source of successful.value) {
    if (!source.lines.length) continue
    const url = URL.createObjectURL(new Blob([source.lines.join('\n')], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = `${source.pod}-${container.value}${previous.value ? '-previous' : ''}.log`; link.click(); URL.revokeObjectURL(url)
  }
}
</script>

<template>
  <section class="log-analyzer" aria-label="日志分析器" @keydown="keydown">
    <div class="log-analyzer__toolbar">
      <div class="log-analyzer__filters">
        <t-button size="small" variant="text" :aria-label="paused ? '继续打印日志' : '停止打印日志'" :title="paused ? '继续（Ctrl+C）' : '停止（Ctrl+C）'" :disabled="previous || !targets.length" @click="paused = !paused"><t-icon :name="paused ? 'play' : 'stop'" /></t-button>
        <t-button size="small" variant="text" aria-label="清空日志视窗" title="清空" :disabled="loading || !total" @click="clear"><t-icon name="clear" /></t-button>
        <span class="log-analyzer__divider" />
        <label>Pods</label>
        <t-select class="log-analyzer__pod" :value="pod" size="small" filterable placeholder="选择 Pod" :disabled="!podOptions.length" @change="choosePod(String($event))">
          <t-option-group v-for="group in groups" :key="group.label" :label="group.label"><t-option v-for="item in group.items" :key="item.value" :value="item.value" :label="item.label" /></t-option-group>
        </t-select>
        <span class="log-analyzer__divider" />
        <label>容器</label>
        <t-select class="log-analyzer__container" :value="container" size="small" placeholder="选择容器" :disabled="!containers.length" @change="chooseContainer(String($event))">
          <t-option-group v-for="group in containerGroups" :key="group.type" :label="group.label"><t-option v-for="item in group.items" :key="item.name" :value="item.name" :label="item.name" /></t-option-group>
        </t-select>
        <span class="log-analyzer__divider" />
        <t-checkbox v-model="previous" :disabled="!container">上一容器</t-checkbox>
        <t-select class="log-analyzer__range" :value="rangeValue" size="small" :options="rangeOptions" @change="selectRange" />
        <t-button size="small" variant="text" aria-label="重新连接分析器" :loading="loading" :disabled="!targets.length" @click="reload"><t-icon name="refresh" /></t-button>
        <t-button size="small" variant="text" aria-label="下载各 Pod 日志" :disabled="loading || !total" @click="download"><t-icon name="download" /></t-button>
      </div>
      <form class="log-analyzer__search" @submit.prevent="search">
        <t-input v-model="query" size="small" clearable placeholder="grep -A 10 -B 20 &quot;Server Error&quot; | grep 500" aria-label="搜索分析器日志" @enter="search" @clear="appliedQuery = ''"><template #prefix-icon><t-icon name="search" /></template></t-input>
        <t-button size="small" variant="text" type="submit">搜索</t-button>
        <t-popup trigger="click" placement="bottom-right"><t-button size="small" variant="text" aria-label="分析器搜索帮助"><t-icon name="help-circle" /></t-button><template #content><div class="log-analyzer__help">支持普通文本、grep -i、-A/-B/-C 上下文及 grep 管道。<br>每个 Pod 独立计算上下文，可搜索 Pod 名称。<br>当前 Mock 按普通文本匹配，不执行命令或正则表达式。</div></template></t-popup>
      </form>
    </div>
    <div class="log-analyzer__tools">
      <t-checkbox v-model="wrap">自动换行</t-checkbox><t-checkbox :checked="follow" @change="setFollow">自动滚动</t-checkbox>
      <span class="log-analyzer__counts">{{ result.lines.length }} / {{ total }} 行 · {{ targets.length }} / {{ selectedPods.length }} 个 Pod</span>
      <t-button size="small" variant="text" aria-label="分析器滚动到顶部" :disabled="!result.lines.length" @click="viewport?.scrollTop()"><t-icon name="chevron-up" /></t-button>
      <t-button size="small" variant="text" aria-label="分析器滚动到底部" :disabled="!result.lines.length" @click="viewport?.scrollBottom()"><t-icon name="chevron-down" /></t-button>
    </div>
    <div v-if="paused" class="log-analyzer__paused">已停止打印新日志。<button @click="paused = false">继续（Ctrl+C）</button></div>
    <div v-if="result.error" class="log-analyzer__notice" role="alert">{{ result.error }}</div>
    <div v-if="skipped && container" class="log-analyzer__notice">{{ skipped }} 个 Pod 不包含容器 {{ container }}，已跳过。</div>
    <div v-if="failures.length" class="log-analyzer__failures" role="alert">
      <div v-for="source in failures" :key="source.uid"><strong>{{ source.pod }}</strong>：{{ source.error }}</div>
      <t-button size="small" variant="text" @click="reload">重新连接</t-button>
    </div>
    <div v-if="loading" class="log-analyzer__state" role="status"><t-loading size="small" />正在读取 {{ targets.length }} 个 Pod 的容器日志…</div>
    <div v-else-if="!podOptions.length" class="log-analyzer__state">该环境没有可分析的 Pod</div>
    <div v-else-if="!container" class="log-analyzer__state">{{ containers.length ? '请选择容器以查看日志' : '所选 Pod 没有可用容器' }}</div>
    <div v-else-if="!result.lines.length" class="log-analyzer__state">{{ failures.length && !successful.length ? '所选 Pod 的日志暂不可用，可重新连接。' : total ? '没有匹配的日志，请修改搜索条件。' : '当前视窗没有日志，可调整范围或重新连接。' }}</div>
    <XtermLogViewport v-else ref="viewport" v-model:follow="follow" :lines="result.lines" :wrap="wrap" :active="active" :context-key="`${pod}/${container}/${previous}/${rangeValue}/${appliedQuery}`" />
    <footer class="log-analyzer__status"><span :class="{ 'is-live': canStream }">{{ status }}</span><span>{{ logRangeLabel(range) }} / Pod · {{ follow ? '跟随新增' : '已暂停滚动' }}</span></footer>
    <PodLogRangeDialog v-model:visible="customVisible" :range="range" @confirm="range = $event" />
  </section>
</template>

<style scoped>
.log-analyzer { min-width: 0; display: flex; flex-direction: column; background: #181920; color: #fff; min-height: 420px; }
.log-analyzer__toolbar { display: flex; flex-wrap: wrap; background: #fff; color: #3b444c; border-bottom: 1px solid #dce0e5; }
.log-analyzer__filters { display: flex; flex: 1 1 880px; flex-wrap: wrap; align-items: center; gap: 6px; padding: 4px 12px; min-width: 0; }
.log-analyzer__filters label { font-size: 12px; }
.log-analyzer__pod { width: 200px; }
.log-analyzer__container { width: 130px; }
.log-analyzer__range { width: 144px; }
.log-analyzer__divider { width: 1px; height: 16px; background: #dce0e5; margin: 0 2px; }
.log-analyzer__filters :deep(.t-checkbox__label), .log-analyzer__tools :deep(.t-checkbox__label) { font-size: 12px; }
.log-analyzer__search { flex: 1 1 280px; display: flex; align-items: center; padding: 4px 8px; border-left: 1px solid #dce0e5; min-width: 0; }
.log-analyzer__search .t-input__wrap { flex: 1; min-width: 0; }
.log-analyzer__tools { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 5px 14px; border-bottom: 1px solid #253242; }
.log-analyzer__tools :deep(.t-checkbox__label) { color: #c8d1dc; }
.log-analyzer__tools :deep(.t-button) { color: #9cb8d5; }
.log-analyzer__counts { margin-left: auto; font-size: 11px; }
.log-analyzer__state { min-height: 300px; display: flex; align-items: center; justify-content: center; gap: 12px; padding: 20px; text-align: center; font-size: 13px; }
.log-analyzer__status { display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; padding: 8px 14px; font-size: 11px; color: #91a1b5; border-top: 1px solid #253242; }
.log-analyzer__status .is-live { color: #63c697; }
.log-analyzer__paused, .log-analyzer__failures { background: #79303c; padding: 7px 16px; font-size: 12px; color: white; }
.log-analyzer__paused button { background: none; border: none; color: inherit; text-decoration: underline; cursor: pointer; }
.log-analyzer__failures { overflow-wrap: anywhere; }
.log-analyzer__failures :deep(.t-button) { color: white; }
.log-analyzer__notice { background: #293442; padding: 7px 16px; font-size: 12px; }
.log-analyzer__help { padding: 8px; max-width: 340px; font-size: 12px; line-height: 1.8; }
</style>
