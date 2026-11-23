<script setup lang="ts">
import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import { updateArtifactMetadata } from '@/api'
import type { Artifact } from '@/types'
import { artifactMetadataError, artifactMetadataInput } from '@/utils/artifactDetails'
import { usePipelineDraft } from '@/composables/usePipelineDraft'

const props = defineProps<{ visible: boolean; artifact: Artifact | null }>()
const emit = defineEmits<{ 'update:visible': [value: boolean]; saved: [artifact: Artifact] }>()
const labels = ref<string[]>([])
const notes = shallowRef('')
const saving = shallowRef(false)
const error = shallowRef('')
const { discardVisible, markClean, resolveDiscard, requestClose } = usePipelineDraft({ visible: () => props.visible, saving, snapshot: () => JSON.stringify({ labels: labels.value, notes: notes.value }), close: () => emit('update:visible', false) })
let request = 0
watch([() => props.visible, () => props.artifact?.id], () => {
  ++request; saving.value = false
  if (!props.visible) return
  labels.value = [...(props.artifact?.releaseTags ?? [])]
  notes.value = props.artifact?.notes ?? ''
  error.value = ''
  markClean()
}, { immediate: true, flush: 'sync' })
async function save(): Promise<void> {
  if (!props.artifact || saving.value) return
  error.value = artifactMetadataError(labels.value, notes.value)
  if (error.value) return
  const token = ++request, id = props.artifact.id
  const input = artifactMetadataInput(labels.value, notes.value)
  saving.value = true
  try {
    const saved = await updateArtifactMetadata(id, input)
    if (token !== request) return
    markClean()
    emit('saved', saved)
    emit('update:visible', false)
  } catch (err) { if (token === request) error.value = err instanceof Error ? err.message : '保存失败' }
  finally { if (token === request) saving.value = false }
}
onScopeDispose(() => { ++request })
</script>

<template>
  <t-dialog :visible="visible" header="镜像标签与备注" width="560px" :confirm-btn="{content:'保存',loading:saving,disabled:!artifact}" :cancel-btn="{content:'取消',disabled:saving}" :close-on-esc-keydown="!discardVisible && !saving" :close-on-overlay-click="!saving" @confirm="save" @close="requestClose">
    <div class="artifact-metadata">
      <t-alert v-if="error" theme="error" :message="error" />
      <p class="u-mono">{{ artifact?.imageRef }}</p>
      <label>Release tags<t-tag-input v-model="labels" :disabled="saving" placeholder="输入标签后按 Enter" clearable /></label>
      <small>最多 20 个标签，每个不超过 64 个字符；空值和重复标签会自动合并。</small>
      <label>备注<t-textarea v-model="notes" :disabled="saving" :maxlength="2000" :autosize="{minRows:4,maxRows:8}" /></label>
    </div>
  </t-dialog>
  <t-dialog :visible="discardVisible" header="放弃未保存的镜像标签与备注？" body="尚未保存的修改会丢失。" :z-index="3200" confirm-btn="放弃修改" cancel-btn="继续编辑" :close-on-overlay-click="false" @confirm="resolveDiscard(true)" @close="resolveDiscard(false)" />
</template>

<style scoped>
.artifact-metadata{display:flex;flex-direction:column;gap:16px}.artifact-metadata p{margin:0;overflow-wrap:anywhere;color:var(--tk-text-2)}.artifact-metadata label{display:flex;flex-direction:column;gap:8px}.artifact-metadata small{margin-top:-8px;color:#767d84;font-size:12px}
</style>
