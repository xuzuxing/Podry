<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { parseEntryData } from '@/utils/configEntries'
import { maskedConfigData, readConfigData } from '@/utils/configEntryData'
import ConfigEntryDataTable from './ConfigEntryDataTable.vue'
import DeploymentValuesEditor from './DeploymentValuesEditor.vue'
const props = defineProps<{ modelValue: string; mode: 'gui' | 'yaml'; secret: boolean; readonly: boolean; external: boolean; volume: boolean; patch: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; 'update:mode': [value: 'gui' | 'yaml'] }>()
const revealed = shallowRef(false)
const modeError = shallowRef('')
const clipboardStatus = shallowRef('')
const masked = computed(() => props.secret && !props.external && (!revealed.value || props.readonly))
const visibleYaml = computed(() => masked.value || (props.secret && props.external) ? maskedConfigData(props.modelValue) : props.modelValue)
function switchMode(value: 'gui' | 'yaml'): void {
  if (value === props.mode) return
  // An invalid YAML document must remain reachable for correction. Invalid GUI
  // rows remain in place until fixed, as in Devtron's KeyValueTable.
  if (props.mode === 'gui' && readConfigData(props.modelValue).error === '' && parseEntryData(props.modelValue).error) {
    modeError.value = '请先修正键值错误，再切换编辑模式。'; return
  }
  if (value === 'gui' && (readConfigData(props.modelValue).error || parseEntryData(props.modelValue).error)) {
    modeError.value = '请先修正 YAML 错误，再切换编辑模式。'; return
  }
  modeError.value = ''; clipboardStatus.value = ''; emit('update:mode', value)
}
function update(value: string): void {
  if (props.readonly || masked.value) return
  modeError.value = ''; clipboardStatus.value = ''; emit('update:modelValue', value)
}
async function copy(): Promise<void> {
  clipboardStatus.value = ''
  try { await navigator.clipboard.writeText(visibleYaml.value); clipboardStatus.value = masked.value ? '已复制遮蔽后的 YAML' : '已复制 YAML' }
  catch { clipboardStatus.value = '复制失败，请检查浏览器剪贴板权限。' }
}
</script>

<template>
  <section class="config-data-editor" aria-label="配置数据编辑器">
    <div class="entry-form__data-head">
      <strong>{{ external ? '指定已有资源的键（仅 subPath 需要）' : patch ? '覆盖数据' : '数据' }}</strong>
      <div class="data-actions">
        <t-button v-if="secret && !readonly && !external" size="small" variant="text" :aria-pressed="revealed" @click="revealed = !revealed; clipboardStatus = ''">{{ revealed ? '隐藏值' : '显示/编辑值' }}</t-button>
        <t-radio-group variant="default-filled" :model-value="mode" size="small" @change="switchMode($event as 'gui' | 'yaml')"><t-radio-button value="gui">GUI</t-radio-button><t-radio-button value="yaml">YAML</t-radio-button></t-radio-group>
      </div>
    </div>
    <p v-if="secret" class="data-notice">演示环境只保存 key 与挂载配置，不保存或回显 Secret 明文。显示/编辑只作用于本次草稿；现有值统一遮蔽。</p>
    <p v-if="modeError" role="alert" class="data-error">{{ modeError }}</p>
    <template v-if="mode === 'yaml'">
      <DeploymentValuesEditor :model-value="visibleYaml" :readonly="readonly || masked || external" label="配置数据 YAML" @update:model-value="update">
        <template #status>{{ masked ? 'Secret 值已隐藏 · 只读' : readonly || external ? '只读' : 'YAML 批量编辑' }}</template>
        <template #actions><t-button size="small" variant="text" aria-label="复制配置 YAML" @click="copy"><template #icon><t-icon name="file-copy" /></template>复制</t-button></template>
      </DeploymentValuesEditor>
      <span v-if="clipboardStatus" class="clipboard-status" role="status">{{ clipboardStatus }}</span>
    </template>
    <ConfigEntryDataTable v-else :model-value="modelValue" :readonly="readonly" :secret="secret" :masked="masked" :external="external" :volume="volume" @update:model-value="update" />
  </section>
</template>

<style scoped>
.config-data-editor{display:flex;flex-direction:column;gap:12px}.entry-form__data-head,.data-actions{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px}.data-actions{justify-content:flex-end}.data-notice{margin:0;padding:10px 12px;background:#f3f6f9;color:#596168;font-size:12px;line-height:20px}.data-error{margin:0;color:#d54941;font-size:12px}.clipboard-status{font-size:12px;color:#596168}
</style>
