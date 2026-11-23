<script setup lang="ts">
import { shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { Artifact, Deployment } from '@/types'
import { useArtifactDetails } from '@/composables/useArtifactDetails'
import { fmtTime } from '@/utils/format'
import ArtifactDetailsBody from './ArtifactDetailsBody.vue'
import ArtifactMetadataDialog from './ArtifactMetadataDialog.vue'

const props = withDefaults(defineProps<{ visible: boolean; appId: string; artifactId: string; fallbackImage?: string; deployment?: Deployment | null; environmentName?: string }>(), { fallbackImage: '', deployment: null, environmentName: '' })
const emit = defineEmits<{ 'update:visible': [value: boolean]; saved: [artifact: Artifact] }>()
const { artifact, build, loading, error, sourceError, load, acceptSaved } = useArtifactDetails({ active: () => props.visible, appId: () => props.appId, artifactId: () => props.artifactId })
const editing = shallowRef(false), route = useRoute()
function saved(value: Artifact): void { acceptSaved(value); emit('saved', value) }
watch(() => route.fullPath, () => emit('update:visible', false))
watch(() => props.visible, value => { if (!value) editing.value = false })
</script>
<template>
  <t-drawer :visible="visible" placement="right" size="800px" drawer-class-name="artifact-details-drawer" :footer="false" :close-btn="true" :close-on-overlay-click="!editing" :close-on-esc-keydown="!editing" @close="!editing && emit('update:visible', false)">
    <template #header><div class="artifact-details-heading"><strong>源码与镜像详情</strong><p v-if="deployment">部署到 {{ environmentName || '未记录环境' }} · {{ fmtTime(deployment.createdAt) }} · {{ deployment.operator || '操作人未记录' }}</p></div></template>
    <ArtifactDetailsBody :artifact="artifact" :build="build" :fallback-image="fallbackImage" :loading="loading" :error="error" :source-error="sourceError" @retry="load" @edit="editing = true" />
  </t-drawer>
  <ArtifactMetadataDialog v-model:visible="editing" :artifact="artifact" @saved="saved" />
</template>
<style scoped>
.artifact-details-heading{min-width:0}.artifact-details-heading strong{font-size:16px;font-weight:600}.artifact-details-heading p{margin:4px 0 0;color:#596168;font-size:12px;font-weight:400;overflow-wrap:anywhere}
</style>
<style>
.artifact-details-drawer .t-drawer__body{padding:16px;background:#f7f9fc;overflow:auto}.artifact-details-drawer .t-drawer__header{padding:10px 20px;min-height:58px;box-sizing:border-box}.artifact-details-drawer .t-drawer__content-wrapper{max-width:100vw}
</style>
