<script setup lang="ts">
import { computed } from 'vue'
import type { AppConfig, BuildConfig, Registry } from '@/types'
import { buildDraft } from '@/types/build'
import { gitMaterialsOf } from '@/utils/gitMaterials'
import BuildMethodFields from './BuildMethodFields.vue'
import BuildAdvancedOptions from './BuildAdvancedOptions.vue'

const props = defineProps<{ modelValue: BuildConfig | null; savedConfig?: BuildConfig | null; config: AppConfig; registries: Registry[]; errors: Record<string, string>; disabled: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: BuildConfig | null]; blocked: [value: boolean] }>()
const materials = computed(() => gitMaterialsOf(props.config))
const draft = computed({ get: () => buildDraft(props.modelValue ?? props.config.buildConfig, materials.value[0]?.id), set: value => emit('update:modelValue', value) })
const registryOptions = computed(() => props.registries.map(item => ({label:item.name,value:item.id})))
const inherited = computed(() => !props.modelValue)
function toggle() { emit('update:modelValue', inherited.value ? buildDraft(props.config.buildConfig, materials.value[0]?.id) : null) }
</script>

<template>
  <section class="pipeline-override">
    <header><div><h3>覆盖选项</h3><p>覆盖此流水线的镜像仓库、容器镜像和构建选项。</p></div><t-button size="small" :theme="inherited ? 'default' : 'danger'" variant="outline" :disabled="disabled" @click="toggle">{{ inherited ? '允许覆盖' : '删除覆盖' }}</t-button></header>
    <p class="pipeline-override__status">{{ inherited ? '继承应用构建配置' : '使用此流水线的独立构建配置' }}</p>
    <div class="pipeline-override__registry">
      <label><span>镜像仓库</span><t-select :value="draft.registryId" :options="registryOptions" :disabled="disabled || inherited" @change="draft = {...draft, registryId: String($event)}" /><span class="pipeline-override__error">{{ errors.registryId }}</span></label>
      <label><span>镜像 Repository</span><t-input :value="draft.imageRepository" name="pipelineImageRepository" :disabled="disabled || inherited" @change="draft = {...draft, imageRepository: String($event)}" /><span class="pipeline-override__error">{{ errors.imageRepository }}</span></label>
    </div>
    <BuildMethodFields :model-value="draft" :saved-config="inherited ? config.buildConfig : savedConfig ?? config.buildConfig" :materials="materials" :errors="errors" :disabled="disabled || inherited" :inherited="inherited" @update:model-value="draft = $event" @blocked="emit('blocked', $event)"><BuildAdvancedOptions :model-value="draft" :errors="errors" :disabled="disabled || inherited" :inherited="inherited" @update:model-value="draft = $event" /></BuildMethodFields>
  </section>
</template>

<style scoped>
.pipeline-override{padding-top:20px;border-top:1px solid #e6e9ef}.pipeline-override>header{display:flex;align-items:center;justify-content:space-between;gap:16px}.pipeline-override h3{margin:0;font-size:14px;font-weight:600}.pipeline-override header p{margin:4px 0 0;color:#767d84;font-size:13px}.pipeline-override__status{font-size:12px;color:#767d84;margin:16px 0}.pipeline-override__registry{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:16px 0}.pipeline-override__registry label{display:flex;flex-direction:column;gap:8px;font-size:13px}.pipeline-override__error{color:#d54941;font-size:12px}.pipeline-override :deep(.build-method){border:0;padding:0;background:none}.pipeline-override :deep(.build-modes){grid-template-columns:1fr}.pipeline-override :deep(.build-mode){min-height:64px}
</style>
