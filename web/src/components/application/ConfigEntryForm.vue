<script setup lang="ts">
import { computed } from 'vue'
import type { ConfigEntryDraft } from '@/composables/useConfigEntries'
import ConfigEntryDataEditor from './ConfigEntryDataEditor.vue'

const props = defineProps<{
  modelValue: ConfigEntryDraft; secret: boolean; readonly: boolean; nameLocked: boolean
  patch: boolean; mode: 'gui' | 'yaml'
}>()
const emit = defineEmits<{ 'update:modelValue': [value: ConfigEntryDraft]; 'update:mode': [value: 'gui' | 'yaml'] }>()
const metadataReadonly = computed(() => props.readonly || props.patch)
function update<K extends keyof ConfigEntryDraft>(key: K, value: ConfigEntryDraft[K]): void { emit('update:modelValue', { ...props.modelValue, [key]: value }) }
</script>

<template>
  <div class="entry-form">
    <div class="entry-form__identity">
      <label>类型
        <t-select :model-value="modelValue.source" :disabled="metadataReadonly" :options="[{label: `创建 ${secret ? 'Secret' : 'ConfigMap'}`,value:'create'},{label:`使用已有 Kubernetes ${secret ? 'Secret' : 'ConfigMap'}`,value:'external'}]" aria-label="配置来源" @change="update('source', $event as ConfigEntryDraft['source'])" />
      </label>
      <label><span>名称 <em>*</em></span><t-input :model-value="modelValue.name" :disabled="readonly || nameLocked" aria-label="配置名称" placeholder="sample-config" @change="update('name', String($event))" /></label>
    </div>
    <p v-if="modelValue.source === 'external'" class="entry-form__notice">引用部署命名空间中已存在的 {{ secret ? 'Secret' : 'ConfigMap' }}。名称须与集群中的资源一致。</p>
    <label><span>挂载方式 <em>*</em></span>
      <t-radio-group :model-value="modelValue.mountAs" :disabled="metadataReadonly" @change="update('mountAs', $event as 'env' | 'volume')"><t-radio value="env">环境变量</t-radio><t-radio value="volume">数据卷</t-radio></t-radio-group>
    </label>
    <template v-if="modelValue.mountAs === 'volume'">
      <label class="entry-form__path"><span>Volume mount path <em>*</em></span><t-input :model-value="modelValue.mountPath" :disabled="metadataReadonly" aria-label="挂载路径" placeholder="/etc/config" @change="update('mountPath', String($event))" /><small>每个 key 作为文件挂载到此目录。</small></label>
      <t-checkbox :checked="modelValue.subPath" :disabled="metadataReadonly" @change="update('subPath', Boolean($event))">设置 subPath（使用 key 作为文件名）</t-checkbox>
      <label class="entry-form__permission">文件权限（defaultMode，可选）<t-input :model-value="modelValue.fileMode" :disabled="metadataReadonly" aria-label="文件权限" placeholder="0644" @change="update('fileMode', String($event))" /></label>
    </template>
    <ConfigEntryDataEditor :model-value="modelValue.yaml" :mode="mode" :secret="secret" :readonly="readonly" :external="modelValue.source === 'external'" :volume="modelValue.mountAs === 'volume'" :patch="patch" @update:model-value="update('yaml', $event)" @update:mode="emit('update:mode', $event)" />
  </div>
</template>

<style scoped>
.entry-form{display:flex;flex-direction:column;gap:18px;max-width:1200px;padding:20px}.entry-form>label:not(.t-checkbox),.entry-form__identity>label{display:flex;flex-direction:column;gap:8px;font-size:13px;color:#3b444c}.entry-form em{color:#d54941;font-style:normal}.entry-form__identity{display:grid;grid-template-columns:300px minmax(180px,1fr);gap:12px}.entry-form__notice{margin:0;padding:10px 12px;background:#f3f6f9;color:#596168;font-size:12px;line-height:20px}.entry-form__path{max-width:680px}.entry-form__permission{max-width:300px}.entry-form small{font-size:12px;color:#767d84}.entry-form :deep(.values-editor){height:360px;min-height:280px;max-height:480px;flex:none}
@media(max-width:1200px){.entry-form__identity{grid-template-columns:240px minmax(150px,1fr)}}
</style>
