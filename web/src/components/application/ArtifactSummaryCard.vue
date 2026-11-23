<script setup lang="ts">
import { computed } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import type { Artifact } from '@/types'
import { artifactImageLabel } from '@/utils/artifactDetails'
import { fmtTime } from '@/utils/format'

const props = withDefaults(defineProps<{ artifact: Artifact | null; fallbackImage?: string; showDetails?: boolean; expanded?: boolean }>(), { fallbackImage: '', showDetails: false, expanded: false })
const emit = defineEmits<{ edit: []; details: [] }>()
const image = computed(() => props.artifact?.imageRef || props.fallbackImage)
async function copy(value: string): Promise<void> {
  try { await navigator.clipboard.writeText(value); void MessagePlugin.success('已复制') }
  catch { void MessagePlugin.warning('复制失败，请手动选择文本复制') }
}
</script>
<template>
  <article class="artifact-summary">
    <div class="artifact-summary__main">
      <span class="artifact-summary__icon"><t-icon name="layers" size="20px" /></span>
      <div class="artifact-summary__identity">
        <div class="artifact-summary__tag"><strong>{{ artifactImageLabel(image) || '未记录' }}</strong><button v-if="image" type="button" aria-label="复制镜像标签" @click="copy(artifactImageLabel(image))"><t-icon name="copy" /></button></div>
        <div class="artifact-summary__ref"><span>{{ image || '镜像地址未记录' }}</span><button v-if="image" type="button" aria-label="复制完整镜像地址" @click="copy(image)"><t-icon name="copy" /></button></div>
      </div>
      <button v-if="showDetails" type="button" class="artifact-summary__details" @click="emit('details')">源码与镜像详情 <t-icon name="chevron-right" /></button>
    </div>
    <dl v-if="expanded && artifact" class="artifact-summary__fields">
      <dt>镜像仓库</dt><dd>{{ artifact.imageRepository }}</dd>
      <dt>Digest</dt><dd class="artifact-summary__digest"><span>{{ artifact.digest || '未记录' }}</span><button v-if="artifact.digest" type="button" aria-label="复制镜像 Digest" @click="copy(artifact.digest)"><t-icon name="copy" /></button></dd>
      <dt>来源</dt><dd>{{ artifact.source === 'external' ? '外部镜像' : `构建产物 ${artifact.buildId || '（构建记录未关联）'}` }}</dd>
      <dt>创建时间</dt><dd>{{ fmtTime(artifact.createdAt) }}</dd>
    </dl>
    <p v-if="!artifact" class="artifact-summary__missing">镜像产物记录不可用，仅显示已记录的镜像地址。</p>
    <div v-else class="artifact-summary__metadata">
      <div v-if="artifact.releaseTags?.length" class="artifact-summary__tags"><t-tag v-for="tag in artifact.releaseTags" :key="tag" variant="light" size="small">{{ tag }}</t-tag></div>
      <p v-if="artifact.notes" class="artifact-summary__notes">{{ artifact.notes }}</p>
      <button type="button" class="artifact-summary__edit" @click="emit('edit')"><t-icon :name="artifact.releaseTags?.length || artifact.notes ? 'edit' : 'add'" />{{ artifact.releaseTags?.length || artifact.notes ? '编辑标签/备注' : '添加标签/备注' }}</button>
    </div>
  </article>
</template>
<style scoped>
.artifact-summary{padding:16px;border:1px solid #d0d4d9;border-radius:4px;background:white;min-width:0;color:#000a14}.artifact-summary__main{display:flex;align-items:flex-start;gap:12px}.artifact-summary__icon{display:flex;align-items:center;justify-content:center;flex:none;width:36px;height:36px;border:1px solid #e1e7ed;border-radius:4px;color:#0066cc;background:#f7f9fc}.artifact-summary__identity{min-width:0;flex:1}.artifact-summary__tag,.artifact-summary__ref,.artifact-summary__digest{display:flex;align-items:flex-start;gap:6px;min-width:0}.artifact-summary__tag strong{font-size:14px;font-weight:500;overflow-wrap:anywhere}.artifact-summary__ref{margin-top:4px;color:#596168;font:12px/20px var(--tk-mono)}.artifact-summary__ref span,.artifact-summary__digest span{min-width:0;overflow-wrap:anywhere}.artifact-summary button{font:inherit;cursor:pointer}.artifact-summary__tag button,.artifact-summary__ref button,.artifact-summary__digest button{display:inline-flex;align-items:center;justify-content:center;flex:none;width:22px;height:22px;border:0;background:transparent;color:#767d84}.artifact-summary__tag button:hover,.artifact-summary__ref button:hover,.artifact-summary__digest button:hover{color:#0066cc}.artifact-summary__details{display:inline-flex;align-items:center;gap:4px;flex:none;padding:2px 0;border:0;background:none;color:#0066cc;font-size:12px!important}.artifact-summary__metadata{display:flex;flex-direction:column;align-items:flex-start;gap:10px;margin:16px 0 0 48px}.artifact-summary__tags{display:flex;flex-wrap:wrap;gap:6px;max-width:100%}.artifact-summary__notes{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;max-width:100%;color:#596168}.artifact-summary__edit{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border:1px dashed #b1b7bc;border-radius:4px;background:white;color:#596168;font-size:12px!important}.artifact-summary__edit:hover{color:#0066cc;border-color:#0066cc}.artifact-summary__fields{display:grid;grid-template-columns:80px minmax(0,1fr);gap:10px;margin:16px 0 0;padding:16px 0 0;border-top:1px solid #edf1f5;font-size:12px}.artifact-summary__fields dt{color:#767d84}.artifact-summary__fields dd{margin:0;overflow-wrap:anywhere}.artifact-summary__fields dd:nth-of-type(-n+2){font-family:var(--tk-mono)}.artifact-summary__missing{font-size:12px;color:#767d84;margin:16px 0 0}@media(max-width:700px){.artifact-summary__main{flex-wrap:wrap}.artifact-summary__details{margin-left:48px}.artifact-summary__metadata{margin-left:0}}
</style>
