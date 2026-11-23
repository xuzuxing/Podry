<script setup lang="ts">
import { computed } from 'vue'
import type { BuildDraft } from '@/types/build'
import { buildpackCatalog } from '@/mock/buildpackCatalog'
import { updateBuildpack } from '@/utils/buildpackOptions'

const props = defineProps<{ modelValue: BuildDraft; disabled: boolean; errors: Record<string, string> }>()
const emit = defineEmits<{ 'update:modelValue': [value: BuildDraft] }>()
const metadata = computed(() => buildpackCatalog.find(item => item.language === props.modelValue.buildpackLanguage))
const languages = computed(() => [...new Set([...buildpackCatalog.map(item => item.language), props.modelValue.buildpackLanguage])].filter(Boolean).map(value => ({ label: value, value })))
const versions = computed(() => [...new Set([...(metadata.value?.versions ?? []), 'Autodetect', props.modelValue.buildpackVersion])].filter(Boolean).map(value => ({ label: value === 'Autodetect' ? '自动检测（Autodetect）' : value, value })))
const builders = computed(() => [metadata.value?.builder].filter((value): value is string => Boolean(value)))
const customBuilder = computed(() => metadata.value?.builder !== props.modelValue.builderImage)
function patch(change: Partial<Pick<BuildDraft, 'buildpackLanguage' | 'buildpackVersion' | 'builderImage'>>) { emit('update:modelValue', updateBuildpack(props.modelValue, change)) }
</script>

<template>
  <section class="buildpack-options">
    <div class="buildpack-options__row">
      <label><span>语言</span><t-select :value="modelValue.buildpackLanguage" :options="languages" :disabled="disabled" aria-label="Buildpacks 语言" @change="patch({ buildpackLanguage: String($event) })" /><span v-if="errors.buildpackLanguage" class="buildpack-options__error">{{ errors.buildpackLanguage }}</span></label>
      <label><span>版本</span><t-select :value="modelValue.buildpackVersion" :options="versions" :disabled="disabled" aria-label="Buildpacks 版本" @change="patch({ buildpackVersion: String($event) })" /><span v-if="errors.buildpackVersion" class="buildpack-options__error">{{ errors.buildpackVersion }}</span></label>
    </div>
    <label><span>Builder 镜像 <em>*</em><t-tooltip content="Builder 包含构建所需的 Buildpacks、依赖和操作系统层。自定义镜像需能被构建节点访问。"><t-icon name="help-circle" /></t-tooltip></span><t-auto-complete :value="modelValue.builderImage" :options="builders" :input-props="{ name: 'builderImage' }" :disabled="disabled" placeholder="选择或输入自定义 Builder 镜像" @change="patch({ builderImage: String($event) })" /><span v-if="errors.builderImage" class="buildpack-options__error">{{ errors.builderImage }}</span></label>
    <p class="buildpack-options__hint">使用离线示例目录；支持输入自定义 Builder 镜像。</p>
    <p v-if="customBuilder" class="buildpack-options__hint">自定义 Builder 的语言与版本支持由镜像决定，不自动设置版本环境变量。</p>
  </section>
</template>

<style scoped>
.buildpack-options{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px 16px;margin-top:16px}.buildpack-options__row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.buildpack-options label{display:flex;min-width:0;flex-direction:column;gap:8px;font-size:13px}.buildpack-options label>span:first-child{display:flex;align-items:center;gap:6px}.buildpack-options em{color:#d54941;font-style:normal}.buildpack-options__hint{grid-column:1/-1;margin:0;font-size:12px;color:#767d84;line-height:20px}.buildpack-options__error{color:#d54941;font-size:12px}@media(max-width:1100px){.buildpack-options{grid-template-columns:minmax(0,1fr)}}
</style>
