<script setup lang="ts">
import { computed, onScopeDispose, ref, useTemplateRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'

import { getCluster, getNodeDetail, getResource } from '@/api'
import ResourceManifestWorkspace from '@/components/resource/ResourceManifestWorkspace.vue'
import NodeMetadataPanel from '@/components/resource/NodeMetadataPanel.vue'
import NodePodsPanel from '@/components/resource/NodePodsPanel.vue'
import ResourceActionDialog from '@/components/resource/ResourceActionDialog.vue'
import type { ResourceAction } from '@/components/resource/listTypes'
import type { K8sResource } from '@/types'
import ErrorState from '@/components/ErrorState.vue'
import StatusTag from '@/components/StatusTag.vue'
import type { Cluster, NodeDetail } from '@/types'
import { fmtTime } from '@/utils/format'

type NodeTab = 'summary' | 'yaml' | 'node-conditions'

const TABS: Array<{ key: NodeTab; label: string }> = [
  { key: 'summary', label: '概要' },
  { key: 'yaml', label: 'YAML' },
  { key: 'node-conditions', label: '节点状态' },
]

const route = useRoute()
const router = useRouter()

const cluster = ref<Cluster | null>(null)
const detail = ref<NodeDetail | null>(null)
const loading = ref(false)
const error = ref('')
const resource = ref<K8sResource | null>(null)
const manifestEditor = useTemplateRef<InstanceType<typeof ResourceManifestWorkspace>>('manifestEditor')
const actionVisible = ref(false)
const actionType = ref<ResourceAction>('cordon')
const actionTargets = ref<K8sResource[]>([])

const clusterId = computed(() => String(route.params.clusterId ?? ''))
const nodeName = computed(() => String(route.params.nodeName ?? ''))
const activeTab = computed<NodeTab>(() => {
  const raw = String(route.params.tab ?? 'summary')
  return (TABS.some((item) => item.key === raw) ? raw : 'summary') as NodeTab
})

const backTo = computed(() => ({
  name: 'cluster-workspace',
  params: { clusterId: clusterId.value },
  query: { view: 'list', resource: 'nodes' },
}))

const issues = computed(() => {
  const current = detail.value
  if (!current) return [] as Array<{ title: string; description: string }>
  const list: Array<{ title: string; description: string }> = []
  const cpu = current.resources.find((item) => item.name === 'cpu')
  // 与上游 NodeDetails 的触发条件保持一致；其提示文案仍说明 limits。
  const cpuUsage = Number((cpu?.usagePercentage ?? '').replace('%', ''))
  if (cpuUsage > 100) {
    list.push({ title: '资源超卖', description: 'CPU limits 已超过 100%，节点存在超卖风险' })
  }
  if (current.taints.length) {
    list.push({
      title: `已设置 ${current.taints.length} 个 taint`,
      description: 'Taint 可能阻止 Pod 调度到该节点',
    })
  }
  if (current.unschedulable) {
    list.push({ title: '不可调度：true', description: '该状态会阻止新的 Pod 调度到该节点' })
  }
  return list
})

const errors = computed(() => Object.entries(detail.value?.errors ?? {}))
const resourceRows = computed(() => [...(detail.value?.resources ?? [])].sort((a, b) => {
  const order = (name: string) => name === 'cpu' ? 0 : name === 'memory' ? 1 : 2
  return order(a.name) - order(b.name)
}))
let generation = 0

async function load(): Promise<void> {
  if (!clusterId.value || !nodeName.value) return
  const request = ++generation, id = clusterId.value, name = nodeName.value
  loading.value = true
  error.value = ''
  cluster.value = null; detail.value = null; resource.value = null; actionVisible.value = false
  try {
    const [foundCluster, foundDetail, foundResource] = await Promise.all([
      getCluster(id),
      getNodeDetail(id, name),
      getResource(id, '', 'nodes', '_cluster', name),
    ])
    if (request !== generation) return
    cluster.value = foundCluster; detail.value = foundDetail; resource.value = foundResource
  } catch (err) {
    if (request !== generation) return
    detail.value = null
    error.value = err instanceof Error ? err.message : '节点详情加载失败'
  } finally {
    if (request === generation) loading.value = false
  }
}

function switchTab(tab: NodeTab): void {
  void router.replace({
    name: 'node-detail',
    params: { clusterId: clusterId.value, nodeName: nodeName.value, tab },
  })
}

function openPod(namespace: string, name: string): void {
  void router.push({
    name: 'cluster-workspace',
    params: { clusterId: clusterId.value },
    query: { open: ['core', 'pods', namespace, name].join(',') },
  })
}

async function nodeAction(action: ResourceAction): Promise<void> {
  const request = generation
  if (await manifestEditor.value?.requestLeave() === false || request !== generation) return
  try {
    const found = await getResource(clusterId.value, '', 'nodes', '_cluster', nodeName.value)
    if (request !== generation) return
    actionTargets.value = [found]
    actionType.value = action; actionVisible.value = true
  } catch (err) { if (request === generation) void MessagePlugin.error(err instanceof Error ? err.message : '节点加载失败') }
}
function onNodeAction(deleted: string[]): void {
  if (deleted.length) void router.push(backTo.value)
  else void load()
}

async function applied(updated: K8sResource) {
  resource.value = updated
  const request = generation, id = clusterId.value, name = nodeName.value
  try { const found = await getNodeDetail(id, name); if (request === generation) detail.value = found }
  catch (cause) { if (request === generation) void MessagePlugin.error(cause instanceof Error ? cause.message : '节点详情读回失败') }
}

watch([clusterId, nodeName], () => void load(), { immediate: true })
onScopeDispose(() => { ++generation })
</script>

<template>
  <div class="node tk-panel">
    <Teleport to="#shell-breadcrumbs" defer><div class="node__crumb">
      <router-link class="node__crumb-link" :to="{ name: 'clusters' }">资源浏览器</router-link>
      <span class="node__crumb-sep">/</span>
      <router-link class="node__crumb-link" :to="backTo">{{ cluster?.name ?? clusterId }}</router-link>
      <span class="node__crumb-sep">/</span>
      <span class="node__crumb-current">{{ nodeName }}</span>

    </div></Teleport>
    <ResourceActionDialog v-model:visible="actionVisible" :cluster-id="clusterId" :targets="actionTargets" :action="actionType" @completed="onNodeAction" />

    <div class="node__head">
      <div class="node__ident">
        <span class="node__kind">Node</span>
        <span class="node__sep">/</span>
        <span class="node__name">{{ nodeName }}</span>
        <StatusTag v-if="detail" :value="detail.status" :text="detail.status" :dot="false" />
        <span v-if="detail?.unschedulable" class="node__scheduling">SchedulingDisabled</span>
      </div>
      <div class="node__meta">
        <span class="u-mono">{{ detail?.k8sVersion ?? '—' }}</span>
        <span class="u-dim">·</span>
        <span class="u-mono">{{ detail?.internalIp ?? '—' }}</span>
      </div>
    </div>

    <div class="node__tabs">
      <button
        v-for="tab in TABS"
        :key="tab.key"
        type="button"
        class="node__tab"
        :class="{ 'node__tab--active': activeTab === tab.key }"
        @click="switchTab(tab.key)"
      >
        {{ tab.label }}
      </button>
      <span class="node__crumb-actions" :inert="!detail || loading">
        <t-button size="small" variant="text" @click="router.push({ name: 'cluster-terminal', params: { clusterId }, query: { node: nodeName } })">
          <template #icon><t-icon name="terminal" /></template>
          调试
        </t-button>
        <t-button size="small" variant="text" @click="nodeAction(detail?.unschedulable ? 'uncordon' : 'cordon')">
          {{ detail?.unschedulable ? '恢复调度' : '禁止调度' }}
        </t-button>
        <t-button size="small" variant="text" @click="nodeAction('drain')">
          驱逐
        </t-button>
        <t-button size="small" variant="text" @click="nodeAction('taints')">
          Taints
        </t-button>
        <t-button size="small" variant="text" theme="danger" @click="nodeAction('delete')">
          删除
        </t-button>
      </span>
    </div>

    <ErrorState v-if="error" :message="error" @retry="load" />

    <t-loading v-else :loading="loading">
      <div v-if="detail" class="node__body">
        <!-- Summary -->
        <div v-if="activeTab === 'summary'" class="node__summary">
          <div class="node__col node__col--left">
            <section v-if="errors.length" class="node-card node-card--error">
              <div class="node-card__banner">
                <t-icon name="error-circle" size="16px" />
                {{ errors.length }} 个错误
              </div>
              <div class="node-card__body">
                <div v-for="[key, message] in errors" :key="key" class="node-error">
                  <p class="node-error__title">{{ key }}</p>
                  <p class="node-error__desc">{{ message }}</p>
                </div>
              </div>
            </section>

            <section v-if="issues.length" class="node-card node-card--warning">
              <div class="node-card__banner node-card__banner--warning">
                <t-icon name="error-circle" size="16px" />
                {{ issues.length }} 个可能的问题
              </div>
              <div class="node-card__body">
                <div v-for="issue in issues" :key="issue.title" class="node-error">
                  <p class="node-error__title">{{ issue.title }}</p>
                  <p class="node-error__desc">{{ issue.description }}</p>
                </div>
              </div>
            </section>

            <section class="node-card">
              <div class="node-card__head">节点概览</div>
              <dl class="node-kv node-card__body">
                <dt>名称</dt>
                <dd>{{ detail.name }}</dd>
                <dt>状态</dt>
                <dd>
                  <StatusTag :value="detail.status" :text="detail.status" :dot="false" />
                  <span v-if="detail.unschedulable" class="node__scheduling">SchedulingDisabled</span>
                </dd>
                <dt>角色</dt>
                <dd>{{ detail.roles }}</dd>
                <dt>K8s 版本</dt>
                <dd class="u-mono">{{ detail.k8sVersion }}</dd>
                <dt>不可调度</dt>
                <dd>{{ detail.unschedulable }}</dd>
                <dt>创建时间</dt>
                <dd>{{ fmtTime(detail.createdAt) }}</dd>
                <dt>内网 IP</dt>
                <dd class="u-mono">{{ detail.internalIp }}</dd>
                <dt>外网 IP</dt>
                <dd class="u-mono">{{ detail.externalIp }}</dd>
              </dl>
            </section>
          </div>

          <div class="node__col node__col--right">
            <section class="node-card">
              <div class="node-card__head">资源用量</div>
              <t-table
                row-key="name"
                size="small"
                :data="resourceRows"
                :columns="[
                  { colKey: 'name', title: '资源', width: 170 },
                  { colKey: 'requestPercentage', title: '请求', width: 90 },
                  { colKey: 'limitPercentage', title: '限制', width: 90 },
                  { colKey: 'usagePercentage', title: '用量', width: 90 },
                  { colKey: 'allocatable', title: '可分配', width: 110 },
                  { colKey: 'capacity', title: '容量', width: 100 },
                ]"
              >
                <template #name="{ row }"><span class="node__resource-name"><t-icon :name="row.name === 'cpu' ? 'cpu' : row.name === 'memory' ? 'server' : 'hard-drive'" size="18px" /><span class="u-mono">{{ row.name }}</span></span></template>
                <template #usagePercentage="{ row }">
                  <span :class="{ 'node-warn': Number(String(row.usagePercentage).replace('%', '')) >= 80 }">
                    {{ row.usagePercentage }}
                  </span>
                </template>
              </t-table>
            </section>

            <NodeMetadataPanel :key="detail.name" :detail="detail" @edit-taints="nodeAction('taints')" />
            <NodePodsPanel :key="detail.name" :pods="detail.pods" @open="openPod" />
          </div>
        </div>

        <!-- YAML -->
        <ResourceManifestWorkspace v-else-if="activeTab === 'yaml' && resource" ref="manifestEditor" :resource="resource" :cluster-id="clusterId" @applied="applied" />

        <!-- Node Conditions -->
        <div v-else class="node__conditions">
          <t-table
            row-key="type"
            size="small"
            :data="detail.conditions"
            :columns="[
              { colKey: 'type', title: '类型', width: 220 },
              { colKey: 'status', title: '状态', width: 260 },
              { colKey: 'message', title: '消息' },
            ]"
          >
            <template #type="{ row }"><span class="u-mono">{{ row.type }}</span></template>
            <template #status="{ row }">
              <span class="node__cond">
                <t-icon :name="row.haveIssue ? 'error-circle' : 'check-circle'" size="14px" :class="row.haveIssue ? 'node-warn' : 'node-ok'" />
                {{ row.reason }}
              </span>
            </template>
            <template #message="{ row }"><span class="u-muted">{{ row.message }}</span></template>
          </t-table>
        </div>
      </div>
    </t-loading>
  </div>
</template>

<style scoped>
.node {
  display: flex;
  flex-direction: column;
  min-height: calc(100dvh - 64px);
  margin: -12px -16px -24px;
  border: 0;
}
.node__crumb {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 48px;
  padding: 0;
}
.node__crumb-link {
  color: var(--tk-text-2);
}
.node__crumb-link:hover {
  color: var(--tk-primary);
}
.node__crumb-sep {
  color: var(--tk-text-3);
}
.node__crumb-current {
  font-weight: 600;
}
.node__crumb-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}
.node__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 48px;
  padding: 0 12px;
  border-bottom: 1px solid var(--tk-border);
}
.node__ident {
  display: flex;
  align-items: center;
  gap: 6px;
}
.node__kind {
  color: var(--tk-text-2);
}
.node__sep {
  color: var(--tk-text-3);
}
.node__name {
  font-size: 15px;
  font-weight: 600;
}
.node__scheduling {
  margin-left: 6px;
  color: var(--tk-danger);
  font-size: 12px;
}
.node__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--tk-text-2);
}
.node__tabs {
  display: flex;
  align-items: center;
  gap: 20px;
  min-height: 38px;
  flex-wrap: wrap;
  padding: 0 12px;
  border-bottom: 1px solid var(--tk-border);
}
.node__tab {
  position: relative;
  height: 38px;
  padding: 0;
  font: inherit;
  color: var(--tk-text-2);
  background: none;
  border: 0;
  cursor: pointer;
}
.node__tab:hover {
  color: var(--tk-primary);
}
.node__tab--active {
  color: var(--tk-primary);
  font-weight: 600;
}
.node__tab--active::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  background: var(--tk-primary);
}
.node__body {
  flex: 1;
  min-height: 0;
}
.node__summary {
  display: grid;
  grid-template-columns: minmax(260px, 28%) minmax(0, 1fr);
  gap: 12px;
  padding: 12px;
  align-items: start;
  height: calc(100dvh - 175px);
  min-height: 400px;
  box-sizing: border-box;
}
.node__col {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  max-height: 100%;
  overflow: auto;
}
.node__col>section{flex-shrink:0}
.node__col--right :deep(.t-table){font-size:12px}
.node__col--right :deep(.t-table th),.node__col--right :deep(.t-table td){padding:8px 12px}
.node-card__body--list{max-height:none}
@media(max-width:1100px){.node__tabs{gap:12px}.node__crumb-actions{gap:0}.node__summary{grid-template-columns:260px minmax(0,1fr)}}
.node-card {
  background: var(--tk-surface);
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-radius);
  overflow: hidden;
}
.node-card__banner {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  font-weight: 600;
}
.node-card--error .node-card__banner {
  color: #fff;
  background: var(--tk-danger);
}
.node__resource-name{display:inline-flex;align-items:center;gap:12px}
.node-card__banner--warning {
  color: #1f2733;
  background: #ffe6c7;
}
.node-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 38px;
  padding: 0 12px;
  font-weight: 600;
  border-bottom: 1px solid var(--tk-border);
}
.node-card__body {
  padding: 12px;
}
.node-kv {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  row-gap: 8px;
}
.node-kv dt {
  color: var(--tk-text-2);
}
.node-kv dd {
  margin: 0;
  min-width: 0;
  word-break: break-all;
}
.node-error + .node-error {
  margin-top: 10px;
}
.node-error__title {
  margin: 0;
  font-weight: 600;
}
.node-error__desc {
  margin: 2px 0 0;
  color: var(--tk-text-2);
}
.node-card__tabs {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 38px;
  padding: 0 12px;
  border-bottom: 1px solid var(--tk-border);
}
.node-card__tab {
  height: 38px;
  padding: 0;
  font: inherit;
  color: var(--tk-text-2);
  background: none;
  border: 0;
  border-bottom: 2px solid transparent;
  cursor: pointer;
}
.node-card__tab--active {
  color: var(--tk-primary);
  font-weight: 600;
  border-bottom-color: var(--tk-primary);
}
.node-card__body--list {
  max-height: 260px;
  overflow: auto;
}
.node-line {
  margin: 0 0 4px;
  padding: 2px 6px;
  color: var(--tk-text);
  background: #f7f9fc;
  border-radius: 3px;
  word-break: break-all;
}
.node__yaml {
  padding: 12px;
}
.node__yaml-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.node__manifest {
  max-height: 620px;
}
.node__conditions {
  padding: 12px;
}
.node__cond {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.node-ok {
  color: var(--tk-success);
}
.node-warn {
  color: var(--tk-warning);
}
.node-warn-text {
  color: var(--tk-warning);
}
.node__hint {
  margin: 8px 2px 0;
  color: var(--tk-text-3);
  font-size: 11px;
}
.node-link {
  padding: 0;
  font: inherit;
  color: var(--tk-primary);
  text-align: left;
  background: none;
  border: 0;
  cursor: pointer;
}
.node-link:hover {
  text-decoration: underline;
}
</style>
