<script setup lang="ts">
import { shallowRef, watch } from 'vue'
import type { BuildDraft } from '@/types/build'
import BuildTargetPlatforms from './BuildTargetPlatforms.vue'
import BuildArguments from './BuildArguments.vue'
import BuildSecretReferences from './BuildSecretReferences.vue'

const props = defineProps<{ modelValue: BuildDraft; errors: Record<string, string>; disabled: boolean; inherited?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: BuildDraft] }>()
const expanded = shallowRef(false)
watch(() => [props.errors.platform, props.errors.timeoutSeconds, props.errors.buildArguments, props.errors.buildSecrets, props.errors.buildSSH], (messages) => { if (messages.some(Boolean)) expanded.value = true })
function patch(value: Partial<BuildDraft>) { emit('update:modelValue', { ...props.modelValue, ...value }) }
</script>

<template>
  <div class="build-advanced">
    <button v-if="modelValue.buildMode !== 'buildpack'" type="button" class="build-advanced__toggle" :aria-expanded="expanded" @click="expanded = !expanded"><span class="build-advanced__icon"><t-icon name="tools" size="22px" /></span><span><strong>高级选项</strong><span>设置构建目标平台、Docker 构建参数及 Secrets／SSH</span></span><t-icon :name="expanded ? 'chevron-up' : 'chevron-down'" size="20px" /></button>
    <div v-if="expanded || modelValue.buildMode === 'buildpack'" class="build-advanced__body" :class="{ 'build-advanced__body--buildpack': modelValue.buildMode === 'buildpack' }">
      <BuildTargetPlatforms v-if="modelValue.buildMode !== 'buildpack'" :model-value="modelValue.platform" :disabled="disabled" :readonly="inherited" :error="errors.platform" @update:model-value="patch({ platform: $event })" />
      <BuildArguments :model-value="modelValue.buildMode === 'buildpack' ? modelValue.buildpackArguments : modelValue.buildArguments" :disabled="disabled" :buildpack="modelValue.buildMode === 'buildpack'" :error="errors.buildArguments" @update:model-value="patch(modelValue.buildMode === 'buildpack' ? { buildpackArguments: $event } : { buildArguments: $event })" />
      <template v-if="modelValue.buildMode !== 'buildpack'">
        <p class="build-advanced__mock">前端 Mock：仅保存 Secrets／SSH 引用，尚未连接凭据目录或执行注入。</p>
        <BuildSecretReferences :model-value="modelValue.buildSecrets" kind="secrets" :disabled="disabled" :error="errors.buildSecrets" @update:model-value="patch({ buildSecrets: $event })" />
        <BuildSecretReferences :model-value="modelValue.buildSSH" kind="ssh" :disabled="disabled" :error="errors.buildSSH" @update:model-value="patch({ buildSSH: $event })" />
      </template>
      <label class="build-advanced__field"><span>构建超时（秒）</span><t-input-number :value="modelValue.timeoutSeconds" :min="60" :max="86400" :step="60" :disabled="disabled" @change="patch({ timeoutSeconds: Number($event) })" /><span v-if="errors.timeoutSeconds" class="field-error">{{ errors.timeoutSeconds }}</span></label>
    </div>
  </div>
</template>

<style scoped>
.build-advanced{margin-top:24px}.build-advanced__toggle{display:flex;align-items:center;gap:16px;width:100%;padding:8px 0;text-align:left;background:none;border:0;cursor:pointer;font:inherit;color:#3b444c}.build-advanced__toggle>span:nth-child(2){display:flex;flex:1;flex-direction:column;gap:4px;font-size:13px}.build-advanced__toggle strong{font-size:14px;font-weight:500}.build-advanced__icon{display:flex;align-items:center;justify-content:center;width:40px;height:40px;border:1px solid #d0d4d9;border-radius:4px;color:#f9a825}.build-advanced__toggle>.t-icon{color:#959ba1}.build-advanced__body{display:flex;flex-direction:column;gap:20px;padding:20px 0 0 56px;min-width:0}.build-advanced__body--buildpack{padding:0}.build-advanced__body>section+section{padding-top:20px;border-top:1px solid #e6e9ef}.build-advanced__field{display:flex;max-width:280px;flex-direction:column;gap:8px;font-size:13px}.build-advanced__field .t-input-number{width:100%}.build-advanced__mock{font-size:12px;color:#767d84;margin:0;line-height:20px}.field-error{display:block;color:#d54941;font-size:12px;margin-bottom:8px}
@media(max-width:1100px){.build-advanced__body{padding-left:0}}
</style>
