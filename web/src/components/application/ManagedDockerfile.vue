<script setup lang="ts">
import { computed, onBeforeUnmount, useTemplateRef, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import type { BuildConfig, GitMaterial } from '@/types'
import type { BuildDraft } from '@/types/build'
import { useDockerfileTemplates } from '@/composables/useDockerfileTemplates'
import { repositoryName } from '@/utils/gitMaterials'
import DockerfileCodeEditor from './DockerfileCodeEditor.vue'

const props = defineProps<{ modelValue: BuildDraft; savedConfig?: BuildConfig | null; materials: GitMaterial[]; errors: Record<string, string>; disabled: boolean; inherited?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: BuildDraft]; blocked: [value: boolean] }>()
const { catalog, catalogLoading, contentLoading, catalogError, contentError, selection, languages, frameworks, unavailable, modified, blocked, loadCatalog, selectLanguage, select, reset, restore } = useDockerfileTemplates({
  draft: () => props.modelValue, saved: () => props.savedConfig, readonly: () => props.disabled,
  update: value => emit('update:modelValue', value),
})
const repositories = computed(() => props.materials.map(item => ({ label: repositoryName(item.repositoryUrl), value: item.id })))
const repository = computed(() => props.materials.find(item => item.id === props.modelValue.gitMaterialId))
const fileLocation = computed(() => `${(repository.value?.checkoutPath || '.').replace(/\/$/, '')}/Dockerfile`)
const content = computed({ get: () => props.modelValue.dockerfileContent, set: value => emit('update:modelValue', { ...props.modelValue, dockerfileContent: value }) })
const editor = useTemplateRef<InstanceType<typeof DockerfileCodeEditor>>('editor')
const editorContext = computed(() => JSON.stringify([props.modelValue.gitMaterialId, selection.value.language, selection.value.framework]))
watch(blocked, value => emit('blocked', value), { immediate: true })
onBeforeUnmount(() => emit('blocked', false))
async function copy() {
  try { await navigator.clipboard.writeText(content.value); MessagePlugin.success('Dockerfile 已复制') }
  catch { MessagePlugin.error('复制失败，请在编辑器中选择内容后复制') }
}
</script>

<template>
  <div class="managed-dockerfile">
    <div class="managed-dockerfile__container">
      <header class="managed-dockerfile__toolbar">
        <div class="managed-dockerfile__option managed-dockerfile__repository"><span>Dockerfile 所在仓库</span><strong v-if="inherited">{{ repository ? repositoryName(repository.repositoryUrl) : '未选择' }}</strong><t-select v-else :value="modelValue.gitMaterialId" :options="repositories" size="small" :disabled="disabled" placeholder="选择仓库" aria-label="Dockerfile 所在仓库" @change="emit('update:modelValue', { ...modelValue, gitMaterialId: String($event) })" /></div>
        <div class="managed-dockerfile__option managed-dockerfile__language"><span>语言</span><strong v-if="inherited">{{ selection.language || '自定义' }}</strong><t-select v-else :value="selection.language" :options="languages" size="small" :disabled="disabled || catalogLoading || !catalog.length" placeholder="自定义" aria-label="Dockerfile 语言" @change="selectLanguage(String($event))" /></div>
        <div class="managed-dockerfile__option managed-dockerfile__framework"><span>框架</span><strong v-if="inherited">{{ selection.framework || '自定义' }}</strong><t-select v-else :value="selection.framework" :options="frameworks" size="small" :disabled="disabled || catalogLoading || !catalog.length" placeholder="自定义" aria-label="Dockerfile 框架" @change="select(selection.language, String($event))" /></div>
        <div class="managed-dockerfile__actions"><t-button size="small" variant="text" aria-label="查找 Dockerfile" title="查找（Ctrl+F）" :disabled="catalogLoading || contentLoading" @click="editor?.search()"><template #icon><t-icon name="search" /></template></t-button><template v-if="!inherited"><t-button v-if="modified && !contentError" size="small" variant="text" :disabled="disabled || blocked" @click="reset"><template #icon><t-icon name="rollback" /></template>重置修改</t-button><t-button size="small" variant="text" aria-label="复制 Dockerfile" :disabled="disabled || blocked || !content" @click="copy"><template #icon><t-icon name="file-copy" /></template></t-button></template></div>
      </header>
      <DockerfileCodeEditor ref="editor" v-model="content" :context="editorContext" :readonly="disabled || Boolean(contentError)" :loading="catalogLoading || contentLoading" :invalid="Boolean(errors.dockerfileContent)" />
    </div>
    <div v-if="contentError" class="managed-dockerfile__feedback" role="alert"><span>{{ contentError }}</span><t-button size="small" variant="text" :disabled="disabled" @click="select(selection.language, selection.framework)">重试模板</t-button><t-button size="small" variant="text" :disabled="disabled" @click="restore">返回当前内容</t-button></div>
    <div v-else-if="catalogError" class="managed-dockerfile__feedback" role="alert"><span>模板目录读取失败，当前内容继续保留。</span><t-button size="small" variant="text" :disabled="disabled" @click="loadCatalog">重试目录</t-button></div>
    <p v-else-if="unavailable" class="managed-dockerfile__hint">已保存的模板当前不可用，保留原有内容；可继续编辑或选择其他模板。</p>
    <p v-else-if="!catalogLoading && !catalog.length" class="managed-dockerfile__hint">暂无可用模板，可直接编写 Dockerfile。</p>
    <p class="managed-dockerfile__location">Dockerfile 位置：<code>{{ fileLocation }}</code><span>保存在所选仓库的根目录</span></p>
    <p v-if="errors.gitMaterialId || errors.dockerfileContent" class="managed-dockerfile__error" role="alert">{{ errors.gitMaterialId || errors.dockerfileContent }}</p>
  </div>
</template>

<style scoped>
.managed-dockerfile__container{overflow:hidden;border:1px solid #d0d4d9;border-radius:4px}.managed-dockerfile__toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px;background:#f7fafc;border-bottom:1px solid #d0d4d9;color:#596168;font-size:12px}.managed-dockerfile__option{display:flex;align-items:center;gap:6px;min-width:0}.managed-dockerfile__option>span{white-space:nowrap}.managed-dockerfile__option strong{font-size:12px;font-weight:500;overflow-wrap:anywhere;color:#000a14}.managed-dockerfile__option+.managed-dockerfile__option{padding-left:8px;border-left:1px solid #d0d4d9}.managed-dockerfile__repository{flex:1 1 240px}.managed-dockerfile__repository .t-select__wrap{flex:1;min-width:100px;max-width:200px}.managed-dockerfile__language .t-select__wrap{width:100px}.managed-dockerfile__framework .t-select__wrap{width:110px}.managed-dockerfile__option :deep(.t-input){border-color:transparent;background:transparent;font-size:12px}.managed-dockerfile__option :deep(.t-input:hover){border-color:#9bc9ff;background:#fff}.managed-dockerfile__actions{display:flex;align-items:center;margin-left:auto;gap:2px}.managed-dockerfile__actions :deep(.t-button){padding:0 4px;font-size:12px}.managed-dockerfile__location{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0;font-size:12px;line-height:18px;color:#596168}.managed-dockerfile__location code{color:#3b444c;overflow-wrap:anywhere}.managed-dockerfile__location>span{color:#767d84}.managed-dockerfile__hint{font-size:12px;line-height:18px;color:#767d84;margin:8px 0}.managed-dockerfile__feedback{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:8px;font-size:12px;color:#d54941}.managed-dockerfile__error{font-size:12px;color:#d54941;margin:8px 0 0}
</style>
