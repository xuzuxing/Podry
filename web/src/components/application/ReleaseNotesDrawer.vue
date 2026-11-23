<script setup lang="ts">
import { ref, watch } from 'vue'
import { getReleaseNotes } from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import ReleaseNotesMarkdown from './ReleaseNotesMarkdown.vue'

const props = defineProps<{ visible: boolean; appId: string; bindingId: string }>()
const emit = defineEmits<{ 'update:visible': [visible: boolean] }>()
const notes = ref('')
const loading = ref(false)
const error = ref('')
let generation = 0
async function load(): Promise<void> {
  const current = ++generation
  if (!props.visible || !props.bindingId) return
  notes.value = ''
  loading.value = true
  error.value = ''
  try {
    const value = await getReleaseNotes(props.appId, props.bindingId)
    if (current === generation) notes.value = value
  } catch (err) {
    if (current === generation) error.value = err instanceof Error ? err.message : 'Notes 加载失败'
  } finally { if (current === generation) loading.value = false }
}
watch(() => [props.visible, props.appId, props.bindingId], load, { immediate: true })
</script>

<template>
  <t-drawer :visible="visible" header="Notes" size="50%" :footer="false" :close-btn="true" @close="emit('update:visible', false)">
    <ErrorState v-if="error" :message="error" @retry="load" />
    <t-loading v-else :loading="loading">
      <ReleaseNotesMarkdown v-if="notes" :source="notes" />
      <EmptyState v-else-if="!loading" compact title="暂无 Notes" description="该环境的 Helm release 尚未提供 Notes。" />
    </t-loading>
  </t-drawer>
</template>

