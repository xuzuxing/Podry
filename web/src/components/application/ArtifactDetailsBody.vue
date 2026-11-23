<script setup lang="ts">
import type { Artifact, Build } from '@/types'
import BuildSourceSnapshot from './BuildSourceSnapshot.vue'
import ArtifactSummaryCard from './ArtifactSummaryCard.vue'
withDefaults(defineProps<{ artifact: Artifact | null; build: Build | null; fallbackImage?: string; loading: boolean; error: string; sourceError: string; sourceOnly?: boolean }>(), { fallbackImage: '', sourceOnly: false })
const emit = defineEmits<{ retry: []; edit: [] }>()
</script>
<template>
  <div class="artifact-details-body">
    <div v-if="loading" class="artifact-details-body__loading" role="status"><t-loading size="small" />加载源码与镜像详情…</div>
    <div v-else-if="error" class="artifact-details-body__error"><t-alert theme="error" :message="error" /><t-button variant="outline" size="small" @click="emit('retry')">重试</t-button></div>
    <template v-else>
      <div v-if="sourceError" class="artifact-details-body__error"><t-alert theme="warning" :message="sourceError" /><t-button variant="text" size="small" @click="emit('retry')">重试读取源码</t-button></div>
      <BuildSourceSnapshot v-else-if="build" :build="build" :show-build-config="false" />
      <p v-else class="artifact-details-body__notice">{{ artifact?.source === 'external' ? '外部导入镜像没有关联的构建源码记录。' : '此镜像未关联可用的构建源码记录。' }}</p>
      <template v-if="!sourceOnly">
        <div v-if="build" class="artifact-details-body__connector" aria-hidden="true"><span /><t-icon name="arrow-down" size="16px" /><span /></div>
        <ArtifactSummaryCard :artifact="artifact" :fallback-image="fallbackImage" expanded @edit="emit('edit')" />
      </template>
    </template>
  </div>
</template>
<style scoped>
.artifact-details-body{min-width:0}.artifact-details-body__loading{display:flex;align-items:center;justify-content:center;gap:8px;min-height:180px;color:#767d84;font-size:13px}.artifact-details-body__error{display:flex;flex-direction:column;align-items:flex-start;gap:12px;margin-bottom:16px}.artifact-details-body__error>.t-alert{width:100%}.artifact-details-body :deep(.build-source-snapshot){padding:0}.artifact-details-body :deep(.build-source-card:last-child){margin-bottom:0}.artifact-details-body__connector{display:flex;flex-direction:column;align-items:center;justify-content:center;height:64px;color:#767d84}.artifact-details-body__connector span{height:16px;border-left:1px dashed #b1b7bc}.artifact-details-body__notice{margin:0 0 16px;font-size:13px;color:#767d84;line-height:22px}
</style>
