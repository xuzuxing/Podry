<script setup lang="ts">
import { computed } from 'vue'
import { stringify } from 'yaml'
import type { Build, BuildMaterialSnapshot } from '@/types'
import { repositoryName } from '@/utils/gitMaterials'
import { fmtTime } from '@/utils/format'
import { sourceLabels } from '@/utils/gitSources'
import GitCommitDetails from './GitCommitDetails.vue'
import GitWebhookDetails from './GitWebhookDetails.vue'

const props = withDefaults(defineProps<{ build: Build | null; showBuildConfig?: boolean }>(), { showBuildConfig: true })
const sources = computed<Array<Partial<BuildMaterialSnapshot>>>(() => {
  if (props.build?.materials?.length) return props.build.materials
  if (!props.build) return []
  return [{ repositoryUrl: props.build.repositoryUrl, branch: props.build.sourceBranch, sha: props.build.commitSha, subject: props.build.commitSubject }]
})
const configYaml = computed(() => props.build?.buildConfigSnapshot ? stringify(props.build.buildConfigSnapshot) : '')
</script>

<template>
  <div class="build-source-snapshot">
    <p v-if="!build?.materials?.length" class="build-source-snapshot__notice">{{ build ? '此历史记录未保存完整源码快照，仅显示已记录字段。' : '此镜像未关联构建源码记录。' }}</p>
    <article v-for="(source, index) in sources" :key="source.gitMaterialId ?? index" class="build-source-card">
      <header :title="source.repositoryUrl"><t-icon name="code" size="20px" /><strong>{{ source.repositoryUrl ? repositoryName(source.repositoryUrl) : '仓库未记录' }}</strong><span>/</span><t-icon :name="source.sourceType === 'tag' ? 'discount' : 'fork'" size="14px" /><span>{{ source.sourceType === 'regex' ? source.sourceValue || source.branch || '分支未记录' : source.sourceType === 'pull_request' ? sourceLabels.pull_request : source.branch || '分支未记录' }}</span></header>
      <div v-if="source.webhookEvent" class="build-source-event">
        <GitWebhookDetails :event="source.webhookEvent" :repository-url="source.repositoryUrl" />
        <details class="build-source-event__payload"><summary>查看当次事件 Payload</summary><p>事件类型：{{ source.sourceType ? sourceLabels[source.sourceType] : 'Webhook' }}</p><p>事件 ID：{{ source.webhookEvent.id }}</p><p>接收时间：{{ fmtTime(source.webhookEvent.receivedAt) }}</p><pre>{{ JSON.stringify(source.webhookEvent.payload, null, 2) }}</pre></details>
      </div>
      <div class="build-source-card__commit">
        <GitCommitDetails v-if="!source.webhookEvent" :commit="source" :repository-url="source.repositoryUrl" />
        <span v-if="source.sourceType === 'regex'" class="build-source-card__path">检出分支：{{ source.branch || '分支未记录' }}</span>
        <span v-if="source.checkoutPath" class="build-source-card__path">克隆目录：{{ source.checkoutPath }}</span>
      </div>
    </article>
    <details v-if="showBuildConfig && configYaml" class="build-config-snapshot"><summary>本次构建配置 <span>配置 v{{ build?.configVersion }} · 流水线 v{{ build?.workflowVersion }}</span></summary><pre>{{ configYaml }}</pre></details>
    <p v-else-if="showBuildConfig && build && !configYaml" class="build-source-snapshot__notice">此历史记录未保存构建配置快照。</p>
  </div>
</template>

<style scoped>
.build-source-event{padding:16px;background:#fff;border-bottom:1px solid #e6e9ef;font-size:12px;overflow-wrap:anywhere}.build-source-event p{margin:8px 0;color:#596168}.build-source-event__payload{margin-top:12px}.build-source-event summary{cursor:pointer;color:#0066cc}.build-source-event pre{padding:12px;background:#f7fafc;overflow:auto;max-height:280px;font:12px/20px monospace}
.build-source-snapshot{padding:16px;min-width:0}.build-source-snapshot__notice{margin:0 0 12px;color:#767d84;font-size:12px}.build-source-card{margin-bottom:16px;background:#fff;border:1px solid #d0d4d9;border-radius:4px;overflow:hidden}.build-source-card header{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-height:48px;padding:12px 16px;box-sizing:border-box;border-bottom:1px solid #e6e9ef;font-size:13px;color:#596168}.build-source-card header strong{font-weight:500;color:#000a14;overflow-wrap:anywhere}.build-source-card__commit{display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:16px;font-size:13px}.build-source-card__commit p{margin:0;overflow-wrap:anywhere}.build-source-card__commit>span:not(.build-source-card__sha){display:flex;align-items:center;gap:6px;font-size:12px;color:#596168}.build-source-card__sha{font:11px/20px monospace;color:#0066cc;background:#e8f0fe;border-radius:2px;padding:0 6px}.build-config-snapshot{border:1px solid #d0d4d9;border-radius:4px;background:#fff}.build-config-snapshot summary{padding:12px 16px;font-size:13px;cursor:pointer;list-style:revert}.build-config-snapshot summary span{margin-left:12px;font-size:11px;color:#767d84}.build-config-snapshot pre{padding:16px;margin:0;overflow:auto;max-height:420px;background:#f7fafc;border-top:1px solid #e6e9ef;font:12px/21px monospace}.build-source-card__path{overflow-wrap:anywhere}
</style>
