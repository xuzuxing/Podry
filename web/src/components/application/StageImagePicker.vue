<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { getConfig, getWorkflow, listStageImages, listStageResources, triggerStageRun } from '@/api'
import type { Artifact, CDDefinition, DeploymentStageType, StageRun } from '@/types'
import { deploymentStageOf } from '@/utils/deploymentStage'
import { stageTitle } from '@/utils/stageRuns'
import { fmtTime } from '@/utils/format'
import EmptyState from '@/components/EmptyState.vue'

const props = defineProps<{visible: boolean; appId: string; pipelineId: string; stage: DeploymentStageType}>()
const emit = defineEmits<{'update:visible':[value:boolean]; triggered:[run:StageRun]}>()
const images = ref<Artifact[]>([])
const selectedId = shallowRef('')
const expandedId = shallowRef('')
const search = shallowRef('')
const loading = shallowRef(false)
const submitting = shallowRef(false)
const error = shallowRef('')
const scope = shallowRef('')
const taskCount = shallowRef(0)
const runInEnvironment = shallowRef(false)
const configVersion = shallowRef(0)
const workflowVersion = shallowRef(0)
let generation = 0
const filtered = computed(() => images.value.filter(image => `${image.imageRef} ${image.digest} ${image.releaseTags?.join(' ')}`.toLowerCase().includes(search.value.trim().toLowerCase())))
const selected = computed(() => images.value.find(image=>image.id===selectedId.value))
async function load(): Promise<void> {
  const current = ++generation
  loading.value = true; error.value = ''
  try {
    const [workflow, config, artifacts] = await Promise.all([getWorkflow(props.appId),getConfig(props.appId),listStageImages(props.appId,props.pipelineId)])
    const pipeline = workflow.items.find(item=>item.id===props.pipelineId && item.kind==='cd')
    if (!pipeline) throw new Error('部署流水线已不存在')
    const context = await listStageResources(props.appId,pipeline.bindingId ?? '')
    if (current !== generation) return
    const definition = pipeline.definition as CDDefinition
    images.value = artifacts
    if (!artifacts.some(item=>item.id===selectedId.value)) selectedId.value = artifacts[0]?.id ?? ''
    scope.value = context.scope
    taskCount.value = (props.stage==='PRECD' ? definition.preTasks : definition.postTasks)?.length ?? 0
    runInEnvironment.value = deploymentStageOf(definition,props.stage==='PRECD'?'pre':'post').runInEnvironment
    configVersion.value = config.version; workflowVersion.value = workflow.version
  } catch(err) { if (current===generation) error.value = err instanceof Error ? err.message : '镜像加载失败' }
  finally { if (current===generation) loading.value = false }
}
function close(): void { if (!submitting.value) emit('update:visible',false) }
async function trigger(): Promise<void> {
  if (!selected.value || loading.value || submitting.value || !taskCount.value) return
  const current=generation
  submitting.value = true; error.value = ''
  try {
    const run = await triggerStageRun(props.appId,{pipelineId:props.pipelineId,stage:props.stage,artifactId:selectedId.value,configVersion:configVersion.value,workflowVersion:workflowVersion.value})
    if (current!==generation) return
    emit('triggered',run); emit('update:visible',false)
  } catch(err) { if(current===generation) error.value = err instanceof Error ? err.message : '阶段触发失败' }
  finally { submitting.value = false }
}
watch(()=>[props.visible,props.appId,props.pipelineId,props.stage] as const,([visible])=>{
  generation++
  if (!visible) return
  images.value=[]; selectedId.value=''; expandedId.value=''; search.value=''; scope.value=''; taskCount.value=0
  void load()
},{immediate:true})
onBeforeUnmount(()=>generation++)
</script>

<template>
  <t-drawer :visible="visible" size="1024px" :header="`${stageTitle(stage)} · Select Image`" :close-on-overlay-click="!submitting" :close-on-esc-keydown="!submitting" :footer="false" drawer-class-name="stage-image-drawer" @close="close">
    <div class="stage-image-picker">
      <header class="stage-image-picker__head"><strong>选择镜像</strong><span>{{ scope }}</span><t-input v-model="search" aria-label="搜索阶段镜像" placeholder="按镜像 tag / digest 搜索" clearable /><t-button variant="text" shape="square" aria-label="刷新阶段镜像" :disabled="loading || submitting" @click="load"><t-icon name="refresh" /></t-button></header>
      <t-alert v-if="error" theme="error" :message="error"><template #operation><t-button variant="text" size="small" :disabled="loading || submitting" @click="load">重新读取</t-button></template></t-alert>
      <div class="stage-image-picker__body">
        <t-loading v-if="loading" text="读取镜像与阶段配置…" />
        <EmptyState v-else-if="!images.length" title="还没有可用镜像" description="此阶段只显示当前应用的外部镜像及上游 CI 产物。" />
        <EmptyState v-else-if="!filtered.length" title="没有匹配的镜像" compact />
        <div v-else class="stage-image-grid">
          <article v-for="image in filtered" :key="image.id" class="stage-image-card" :class="{'is-selected':image.id===selectedId}">
            <button class="stage-image-card__select" type="button" :aria-label="`选择阶段镜像 ${image.imageRef}`" :aria-pressed="image.id===selectedId" :disabled="submitting" @click="selectedId=image.id"><span>{{ image.imageRef.split('/').pop() }}</span><t-icon :name="image.id===selectedId?'check-circle-filled':'circle'" /></button>
            <p>{{ fmtTime(image.createdAt) }}</p><p>{{ image.source==='external'?'外部镜像':'上游 CI 构建' }}</p>
            <div class="stage-image-card__tags"><t-tag v-for="tag in image.releaseTags" :key="tag" size="small" variant="light">{{ tag }}</t-tag></div>
            <t-button variant="text" size="small" @click="expandedId=expandedId===image.id?'':image.id">{{ expandedId===image.id?'收起详情':'展开详情' }}</t-button>
            <dl v-if="expandedId===image.id"><dt>镜像仓库</dt><dd>{{ image.imageRepository }}</dd><dt>digest</dt><dd>{{ image.digest }}</dd><dt>备注</dt><dd>{{ image.notes || '无备注' }}</dd></dl>
          </article>
        </div>
      </div>
      <footer class="stage-image-picker__footer"><div><strong>{{ stageTitle(stage) }} · {{ taskCount }} 个任务</strong><span>配置 v{{ configVersion }} / 流水线 v{{ workflowVersion }} · {{ runInEnvironment?'应用环境':'默认 worker' }} · 本地 Mock</span><span v-if="!taskCount && !loading">此阶段没有任务，请先在工作流中配置。</span></div><t-button variant="outline" :disabled="submitting" @click="close">取消</t-button><t-button theme="primary" :disabled="loading || !selected || !taskCount || Boolean(error)" :loading="submitting" @click="trigger">运行阶段</t-button></footer>
    </div>
  </t-drawer>
</template>

<style scoped>
.stage-image-picker{display:flex;flex-direction:column;height:100%;min-height:0;margin:-16px -24px}.stage-image-picker__head{display:flex;align-items:center;gap:12px;padding:16px 24px;border-bottom:1px solid var(--tk-border)}.stage-image-picker__head>span{font-size:12px;color:var(--tk-text-2);white-space:nowrap}.stage-image-picker__head>.t-input__wrap{width:280px;margin-left:auto}.stage-image-picker__body{flex:1;overflow:auto;min-height:0;padding:24px;background:#f7fafc}.stage-image-grid{display:flex;flex-wrap:wrap;align-items:flex-start;gap:16px}.stage-image-card{width:calc(33.333% - 11px);border:1px solid #d0d4d9;border-radius:4px;background:white;min-width:0;padding:12px;box-sizing:border-box}.stage-image-card.is-selected{border-color:#0066cc;background:#f0f7ff}.stage-image-card__select{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;border:0;background:none;text-align:left;width:100%;padding:0;font-family:inherit;font-size:13px;font-weight:600;line-height:20px;cursor:pointer;color:#000a14}.stage-image-card__select>span{overflow-wrap:anywhere}.stage-image-card__select>.t-icon{flex:none;color:#0066cc}.stage-image-card p{font-size:12px;line-height:18px;margin:10px 0;color:#767d84}.stage-image-card__tags{display:flex;flex-wrap:wrap;gap:4px}.stage-image-card dl{font-size:12px;line-height:18px}.stage-image-card dt{color:#767d84;margin-top:8px}.stage-image-card dd{margin:0;overflow-wrap:anywhere}.stage-image-picker__footer{display:flex;align-items:center;gap:12px;padding:16px 24px;border-top:1px solid var(--tk-border);background:white}.stage-image-picker__footer>div{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}.stage-image-picker__footer strong{font-size:13px}.stage-image-picker__footer span{font-size:12px;color:#767d84}
</style>
