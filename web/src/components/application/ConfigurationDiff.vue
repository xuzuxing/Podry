<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { stringify } from 'yaml'
import { configurationDiffRows } from '@/utils/configComparison'
import ConfigurationYamlDiff from './ConfigurationYamlDiff.vue'
const props = withDefaults(defineProps<{ left: Record<string, unknown>; right: Record<string, unknown>; leftLabel?: string; rightLabel?: string }>(), { leftLabel: '基准', rightLabel: '对比' })
const mode = shallowRef<'gui'|'yaml'>('gui')
const changesOnly = shallowRef(false)
const rows = computed(() => configurationDiffRows(props.left, props.right))
const changedCount = computed(() => rows.value.filter((row) => row.changed).length)
const visibleRows = computed(() => changesOnly.value ? rows.value.filter((row) => row.changed) : rows.value)
const leftYaml = computed(() => stringify(props.left)), rightYaml = computed(() => stringify(props.right))
// Align insertions/deletions so unchanged YAML lines remain beside one another.
// The native merge view keeps both complete documents, including collapsed ranges.
</script>
<template>
  <div class="configuration-diff">
    <div class="configuration-diff__toolbar"><strong>{{ changedCount }} 项差异</strong><t-checkbox v-model="changesOnly">仅显示差异</t-checkbox><span /><t-radio-group v-model="mode" variant="default-filled" size="small"><t-radio-button value="gui">GUI</t-radio-button><t-radio-button value="yaml">YAML</t-radio-button></t-radio-group></div>
    <div v-if="mode==='gui'" class="configuration-diff__scroll">
      <table class="cmp__table"><thead><tr><th>参数</th><th>{{leftLabel}}</th><th>{{rightLabel}}</th></tr></thead><tbody><tr v-for="row in visibleRows" :key="row.key" :class="{'cmp__row--changed':row.changed}"><td>{{row.key}}<small v-if="row.added">新增</small><small v-else-if="row.removed">移除</small></td><td>{{row.left}}</td><td>{{row.right}}</td></tr><tr v-if="!visibleRows.length"><td colspan="3" class="configuration-diff__empty">{{changesOnly?'没有差异':'没有可对比的配置'}}</td></tr></tbody></table>
    </div>
    <ConfigurationYamlDiff v-else :left="leftYaml" :right="rightYaml" :left-label="leftLabel" :right-label="rightLabel" :changes-only="changesOnly" />
  </div>
</template>
<style scoped>
.configuration-diff{display:flex;flex-direction:column;min-height:0;flex:1;border:1px solid #dce1e7;border-radius:4px;overflow:hidden}.configuration-diff__toolbar{display:flex;align-items:center;gap:20px;padding:10px 16px;flex:none;background:#fafbfc;border-bottom:1px solid #dce1e7;font-size:12px}.configuration-diff__toolbar>span{flex:1}.configuration-diff__scroll{min-height:0;overflow:auto;flex:1}.cmp__table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:12px}.cmp__table th{position:sticky;top:0;background:#f4f7fa;text-align:left;font-weight:500;color:#596168;z-index:1}.cmp__table th,.cmp__table td{padding:10px 14px;border-bottom:1px solid #edf1f5;vertical-align:top;overflow-wrap:anywhere;white-space:pre-wrap}.cmp__table td{font-family:var(--tk-mono);color:#3b444c}.cmp__row--changed td:first-child{background:#fff8e8}.cmp__row--changed td:nth-child(2){background:#fff0ee}.cmp__row--changed td:nth-child(3){background:#eef9f2}.cmp__table small{display:inline-block;font:10px sans-serif;color:#a45c00;padding:2px 4px;margin-left:6px}.configuration-diff__empty{text-align:center;color:#767d84}
</style>
