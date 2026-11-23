<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { archiveApplication } from '@/api'
import type { Application } from '@/types'
const props = defineProps<{ application: Application | null }>()
const emit = defineEmits<{ close: []; deleted: [] }>()
const confirmation = ref('')
const loading = ref(false)
const error = ref('')
const valid = computed(() => !!props.application && confirmation.value === props.application.name)
watch(() => props.application, () => { confirmation.value = ''; error.value = '' })
async function submit(): Promise<void> {
  if (!valid.value || !props.application || loading.value) return
  loading.value = true
  try { await archiveApplication(props.application.id); emit('deleted'); emit('close'); void MessagePlugin.success('应用已删除（本地 Mock）') }
  catch (err) { error.value = err instanceof Error ? err.message : '删除失败' }
  finally { loading.value = false }
}
</script>
<template>
  <t-dialog :visible="!!application" header="删除应用" theme="danger" width="520px" :footer="false" :close-btn="!loading" :close-on-overlay-click="!loading" :close-on-esc-keydown="!loading" @close="emit('close')">
    <div class="delete-app"><t-alert theme="warning" message="删除后将无法在应用列表中访问此应用。此操作不会卸载已部署到集群的资源。" /><t-alert v-if="error" theme="error" :message="error" /><p>输入应用名称 <strong>{{ application?.name }}</strong> 以确认。</p><t-input v-model="confirmation" aria-label="应用删除确认名称" @enter="submit" /><footer><t-button variant="outline" :disabled="loading" @click="emit('close')">取消</t-button><t-button theme="danger" :disabled="!valid" :loading="loading" @click="submit">确认删除</t-button></footer></div>
  </t-dialog>
</template>
<style scoped>
.delete-app{display:flex;flex-direction:column;gap:16px}.delete-app p{margin:0}.delete-app footer{display:flex;justify-content:flex-end;gap:8px;border-top:1px solid var(--tk-border);padding-top:16px}
</style>
