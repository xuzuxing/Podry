<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'
import type { BuildConfig, GitMaterial } from '@/types'
import type { BuildDraft } from '@/types/build'
import { repositoryName } from '@/utils/gitMaterials'
import BuildpackOptions from './BuildpackOptions.vue'
import ManagedDockerfile from './ManagedDockerfile.vue'

const props = defineProps<{ modelValue: BuildDraft; savedConfig?: BuildConfig | null; materials: GitMaterial[]; errors: Record<string, string>; disabled: boolean; inherited?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: BuildDraft]; blocked: [value: boolean] }>()
onBeforeUnmount(() => emit('blocked', false))
const contextExpanded = shallowRef(true)
watch(() => [props.errors.context, props.errors.contextGitMaterialId], (messages) => { if (messages.some(Boolean)) contextExpanded.value = true })
const options: Array<{ id: BuildDraft['buildMode']; title: string; description: string; icon: string }> = [
  { id: 'dockerfile', title: '已有 Dockerfile', description: '使用仓库中的 Dockerfile，完全控制构建过程。', icon: 'file' },
  { id: 'managed', title: '创建 Dockerfile', description: '选择模板并编辑 Dockerfile。', icon: 'add' },
  { id: 'buildpack', title: '无需 Dockerfile 构建', description: '使用 Buildpacks 构建容器镜像。', icon: 'layers' },
]
const repositories = computed(() => props.materials.map((item) => ({ label: repositoryName(item.repositoryUrl), value: item.id })))
const selected = computed(() => props.materials.find((item) => item.id === props.modelValue.gitMaterialId))
const contextRepository = computed(() => props.materials.find((item) => item.id === props.modelValue.contextGitMaterialId))
function patch(value: Partial<BuildDraft>) { emit('update:modelValue', { ...props.modelValue, ...value }) }
function selectMode(mode: BuildDraft['buildMode']) {
  patch({ buildMode: mode })
}
</script>

<template>
  <section class="build-method">
    <h2 class="build-method__title">如何构建容器镜像？</h2>
    <div class="build-modes" role="radiogroup" aria-label="构建方式">
      <button v-for="option in options" :key="option.id" type="button" class="build-mode" :class="{ 'build-mode--active': modelValue.buildMode === option.id }" role="radio" :aria-checked="modelValue.buildMode === option.id" :disabled="disabled" @click="selectMode(option.id)">
        <t-icon :name="option.icon" size="20px" /><span><strong>{{ option.title }}</strong><span>{{ option.description }}</span></span><t-icon v-if="modelValue.buildMode === option.id" class="build-mode__check" name="check" size="12px" />
      </button>
    </div>
    <div v-if="modelValue.buildMode !== 'managed'" class="build-source-row">
      <label class="build-field"><span>{{ modelValue.buildMode === 'dockerfile' ? '包含 Dockerfile 的仓库' : '源码仓库' }}</span><t-select :value="modelValue.gitMaterialId" :options="repositories" :disabled="disabled" placeholder="选择 Git 仓库" @change="patch({ gitMaterialId: String($event) })" /><span v-if="errors.gitMaterialId" class="field-error">{{ errors.gitMaterialId }}</span></label>
      <label v-if="modelValue.buildMode === 'dockerfile'" class="build-field"><span>Dockerfile 路径（相对路径） <em>*</em></span><div class="build-relative"><span class="build-relative__prefix">{{ selected?.checkoutPath || './' }}</span><t-input :value="modelValue.dockerfile" name="dockerfile" placeholder="Dockerfile" :disabled="disabled" @change="patch({ dockerfile: String($event) })" /></div><span v-if="errors.dockerfile" class="field-error">{{ errors.dockerfile }}</span></label>
      <label v-else-if="modelValue.buildMode === 'buildpack'" class="build-field"><span>项目路径（相对路径） <em>*</em></span><div class="build-relative"><span class="build-relative__prefix">{{ selected?.checkoutPath || './' }}</span><t-input :value="modelValue.projectPath" name="projectPath" placeholder="." :disabled="disabled" @change="patch({ projectPath: String($event) })" /></div><span v-if="errors.projectPath" class="field-error">{{ errors.projectPath }}</span></label>
    </div>
    <ManagedDockerfile v-if="modelValue.buildMode === 'managed'" :key="String(Boolean(inherited))" :model-value="modelValue" :saved-config="savedConfig" :materials="materials" :errors="errors" :disabled="disabled" :inherited="inherited" @update:model-value="emit('update:modelValue', $event)" @blocked="emit('blocked', $event)" />
    <BuildpackOptions v-if="modelValue.buildMode === 'buildpack'" :model-value="modelValue" :disabled="disabled" :errors="errors" @update:model-value="emit('update:modelValue', $event)" />
    <template v-if="modelValue.buildMode !== 'buildpack'">
      <button type="button" class="build-context-toggle" :aria-expanded="contextExpanded" @click="contextExpanded = !contextExpanded"><t-icon :name="contextExpanded ? 'chevron-down' : 'chevron-right'" size="16px" /> 设置构建上下文 <t-tooltip content="构建上下文中的文件会发送给镜像构建器。"><t-icon name="help-circle" size="14px" /></t-tooltip></button>
      <div v-if="contextExpanded" class="build-context">
        <div class="build-source-row">
          <label class="build-field"><span>包含构建上下文的仓库</span><t-select :value="modelValue.contextGitMaterialId" :options="repositories" :disabled="disabled || modelValue.useRootContext" @change="patch({ contextGitMaterialId: String($event) })" /><span v-if="errors.contextGitMaterialId" class="field-error">{{ errors.contextGitMaterialId }}</span></label>
          <label class="build-field"><span>构建上下文路径（相对路径）</span><div class="build-relative"><span class="build-relative__prefix">{{ modelValue.useRootContext ? './' : contextRepository?.checkoutPath || './' }}</span><t-input :value="modelValue.context" name="context" placeholder="." :disabled="disabled" @change="patch({ context: String($event) })" /></div><span v-if="errors.context" class="field-error">{{ errors.context }}</span></label>
        </div>
        <t-checkbox :checked="modelValue.useRootContext" :disabled="disabled" @change="patch({ useRootContext: Boolean($event) })">使用工作区根目录（包含所有仓库）</t-checkbox>
      </div>
    </template>
    <slot />
  </section>
</template>

<style scoped>
.build-method{padding:16px;background:white;border:1px solid #d0d4d9;border-radius:8px}.build-method__title{margin:0 0 12px;font-size:14px;font-weight:500;color:#3b444c}.build-modes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-bottom:16px}.build-mode{position:relative;display:flex;gap:10px;min-height:80px;padding:10px 12px;text-align:left;border:1px solid #d0d4d9;border-radius:4px;background:white;color:#0066cc;cursor:pointer;font:inherit;font-size:13px;line-height:20px}.build-mode>span{display:flex;flex:1;min-width:0;flex-direction:column}.build-mode strong{font-weight:600}.build-mode>span>span{color:#3b444c}.build-mode>.t-icon{flex:none;margin-top:2px}.build-mode--active{background:#e7f2ff;border-color:#9bc9ff;color:#000a14}.build-mode .build-mode__check{position:absolute;top:0;right:0;margin:0;padding:2px;box-sizing:content-box;background:#0066cc;color:#fff;border-radius:0 3px 0 3px}.build-mode:focus-visible{outline:2px solid #0066cc;outline-offset:2px}.build-source-row{display:grid;grid-template-columns:250px minmax(0,1fr);gap:16px}.build-field{display:flex;flex-direction:column;gap:8px;color:#3b444c;font-size:13px}.build-field em{color:#f33e3e;font-style:normal}.build-relative{display:flex;min-width:0}.build-relative__prefix{display:flex;align-items:center;flex:none;max-width:40%;overflow:hidden;padding:0 10px;color:#596168;font-size:12px;background:#f0f2f5;border:1px solid #d0d4d9;border-right:0;border-radius:4px 0 0 4px}.build-relative>.t-input__wrap{flex:1;min-width:0}.build-relative :deep(.t-input){border-radius:0 4px 4px 0}.field-error{font-size:12px;color:#d54941}.build-context-toggle{display:flex;align-items:center;gap:4px;padding:0;margin:16px 0 8px;border:0;background:none;color:#596168;font:inherit;font-size:13px;cursor:pointer}.build-context{padding:4px 0 0 24px}.build-context>.t-checkbox{margin-top:12px;font-size:12px}.build-dockerfile{margin-top:16px}.build-template{display:flex;align-items:flex-end;gap:12px;margin-bottom:12px}.build-template label{display:flex;flex-direction:column;gap:8px;width:250px;font-size:13px}.build-dockerfile :deep(textarea){font-family:Consolas,monospace;font-size:12px;line-height:20px}.build-builder{margin-top:16px}
@media(max-width:1100px){.build-source-row{grid-template-columns:200px minmax(0,1fr)}.build-modes{gap:8px}.build-mode{padding:8px;font-size:12px}}@media(max-width:900px){.build-source-row{grid-template-columns:minmax(0,1fr)}.build-modes{grid-template-columns:minmax(0,1fr)}}
</style>
