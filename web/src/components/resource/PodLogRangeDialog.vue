<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { logRangeError, type PodLogRange } from '@/utils/podLogs'
const props = defineProps<{ visible: boolean; range: PodLogRange }>()
const emit = defineEmits<{ 'update:visible': [value: boolean]; confirm: [range: PodLogRange] }>()
const type = shallowRef<PodLogRange['type']>('lines'), value = shallowRef('500'), unit = shallowRef(60), date = shallowRef('')
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
const draft = computed<PodLogRange>(() => ({ type: type.value, value: type.value === 'since' ? Date.parse(date.value) : Number(value.value) * (type.value === 'duration' ? unit.value : 1) }))
const error = computed(() => ['lines', 'duration'].includes(type.value) && !/^\d+$/.test(value.value) ? '请输入大于 0 的整数' : logRangeError(draft.value))
watch(() => props.visible, visible => {
  if (!visible) return
  type.value = props.range.type; unit.value = 60
  value.value = String(props.range.type === 'duration' ? props.range.value / 60 : props.range.type === 'lines' ? props.range.value : 500)
  const current = new Date(props.range.type === 'since' ? props.range.value : Date.now() - 15 * 60000)
  date.value = new Date(current.getTime() - current.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
})
function submit(): void { if (!error.value) { emit('confirm', { ...draft.value }); emit('update:visible', false) } }
</script>

<template>
  <t-dialog :visible="visible" header="查看日志" width="500px" :close-on-overlay-click="false" :confirm-btn="{ content: '完成', disabled: !!error }" @update:visible="emit('update:visible', $event)" @confirm="submit">
    <div class="pod-log-range">
      <t-radio-group v-model="type" class="pod-log-range__types">
        <t-radio value="duration">设置时长</t-radio><t-radio value="lines">设置行数</t-radio><t-radio value="since">指定日期和时间</t-radio><t-radio value="all">全部可用日志</t-radio>
      </t-radio-group>
      <div class="pod-log-range__input">
        <template v-if="type === 'lines' || type === 'duration'">
          <label for="pod-log-range-number">{{ type === 'lines' ? '设置日志行数' : '查看最近的日志' }}</label>
          <div class="pod-log-range__number"><t-input id="pod-log-range-number" v-model="value" type="number" placeholder="输入正整数" /><t-select v-if="type === 'duration'" v-model="unit" :options="[{ label: '分钟', value: 60 }, { label: '小时', value: 3600 }]" /><span v-else>行</span></div>
        </template>
        <template v-else-if="type === 'since'"><label for="pod-log-range-date">开始日期与时间</label><input id="pod-log-range-date" v-model="date" type="datetime-local"><small>浏览器时区：{{ timezone }}</small></template>
        <template v-else><p>显示该容器全部可用日志。</p><t-alert theme="warning" message="日志量较大时可能需要更长时间加载。" /></template>
        <p v-if="error" class="pod-log-range__error" role="alert">{{ error }}</p>
      </div>
    </div>
  </t-dialog>
</template>

<style scoped>
.pod-log-range { display: grid; grid-template-columns: 160px minmax(0, 1fr); border-block: 1px solid #dce0e5; min-height: 200px; }
.pod-log-range__types { flex-direction: column; align-items: flex-start; gap: 18px; min-width: 0; padding: 20px 10px; border-right: 1px solid #dce0e5; }
.pod-log-range__types :deep(.t-radio) { display: inline-flex; align-items: center; flex-shrink: 0; margin: 0; white-space: nowrap; }
.pod-log-range__types :deep(.t-radio__input) { flex-shrink: 0; }
.pod-log-range__input { padding: 22px 12px; min-width: 0; }
.pod-log-range__input label, small { display: block; margin-bottom: 10px; font-size: 12px; }
small { margin-top: 8px; color: #6b7785; overflow-wrap: anywhere; }
.pod-log-range__number { display: flex; align-items: center; gap: 8px; }
.pod-log-range__number > .t-input__wrap { flex: 1; min-width: 0; }
.pod-log-range__number > .t-select__wrap { width: 80px; flex-shrink: 0; }
input[type=datetime-local] { width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box; border: 1px solid #cbd3dc; border-radius: 4px; padding: 7px; font: inherit; }
.pod-log-range__error { color: #bd242b; font-size: 12px; }
</style>
