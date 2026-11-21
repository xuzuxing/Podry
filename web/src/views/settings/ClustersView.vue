<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'

import { createCluster, listClusters, listCredentials, testClusterConnection } from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import PageHeader from '@/components/PageHeader.vue'
import StatusTag from '@/components/StatusTag.vue'
import type { Cluster, Credential } from '@/types'
import { fmtRelative } from '@/utils/format'

const rows = ref<Cluster[]>([])
const credentials = ref<Credential[]>([])
const loading = ref(false)
const error = ref('')
const keyword = ref('')

const dialogVisible = ref(false)
const clusterName = ref('')
const apiServer = ref('')
const credentialId = ref('')

const columns = [
  { colKey: 'name', title: '名称', width: 130 },
  { colKey: 'apiServer', title: 'API Server', width: 180 },
  { colKey: 'serverVersion', title: '版本', width: 90 },
  { colKey: 'connectionStatus', title: '状态', width: 100 },
  { colKey: 'credential', title: '凭据', width: 120 },
  { colKey: 'environmentNames', title: '关联环境', width: 160 },
  { colKey: 'lastCheckedAt', title: '最近检测', width: 100 },
  { colKey: 'actions', title: '操作', width: 100 },
]

const kubeconfigOptions = computed(() =>
  credentials.value
    .filter((item) => item.kind === 'kubeconfig')
    .map((item) => ({ label: `${item.name} · v${item.version}`, value: item.id })),
)

const filteredRows = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return rows.value
  return rows.value.filter((cluster) =>
    [cluster.name, cluster.apiServer, cluster.serverVersion ?? '', cluster.connectionStatus]
      .some((value) => value.toLowerCase().includes(kw)),
  )
})

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [clusterList, credentialList] = await Promise.all([listClusters(), listCredentials()])
    rows.value = clusterList
    credentials.value = credentialList
  } catch (err) {
    error.value = err instanceof Error ? err.message : '集群接入信息加载失败'
  } finally {
    loading.value = false
  }
}

function openConnect(): void {
  clusterName.value = ''
  apiServer.value = ''
  credentialId.value = ''
  dialogVisible.value = true
}

async function confirmConnect(): Promise<void> {
  const name = clusterName.value.trim()
  const server = apiServer.value.trim()
  if (!name) {
    MessagePlugin.warning('请输入集群名称')
    return
  }
  if (!/^https:\/\/.+/.test(server)) {
    MessagePlugin.warning('API Server 需为 https:// 地址')
    return
  }
  try {
    await createCluster({ name, apiServer: server, credentialId: credentialId.value || null })
    MessagePlugin.success(`集群 ${name} 已登记，状态为未检测`)
    dialogVisible.value = false
    await load()
  } catch (err) {
    MessagePlugin.error(err instanceof Error ? err.message : '接入集群失败')
  }
}

async function testConnection(cluster: Cluster): Promise<void> {
  try {
    const updated = await testClusterConnection(cluster.id)
    MessagePlugin.success(`${updated.name} 连接正常（${updated.serverVersion}）`)
    await load()
  } catch (err) {
    MessagePlugin.error(err instanceof Error ? err.message : '连接测试失败')
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="settings-clusters">
    <PageHeader title="集群接入" description="接入的 Kubernetes 集群与连接状态；凭据在接入时选择，列表接口只返回元信息。">
      <template #actions>
        <t-button theme="primary" size="small" @click="openConnect">
          <template #icon>
            <t-icon name="add" />
          </template>
          接入集群
        </t-button>
      </template>
    </PageHeader>

    <ErrorState v-if="error" :message="error" @retry="load" />

    <t-loading v-else :loading="loading">
      <div class="settings-clusters__toolbar">
        <t-input v-model="keyword" size="small" clearable placeholder="搜索集群名称 / API Server" class="settings-clusters__search">
          <template #prefix-icon><t-icon name="search" /></template>
        </t-input>
        <span class="settings-clusters__count">共 {{ filteredRows.length }} 个集群</span>
      </div>

      <t-table row-key="id" :data="filteredRows" :columns="columns" size="small" hover>
        <template #name="{ row }">{{ row.name }}</template>
        <template #apiServer="{ row }">
          <span class="u-mono">{{ row.apiServer }}</span>
        </template>
        <template #serverVersion="{ row }">{{ row.serverVersion ?? '—' }}</template>
        <template #connectionStatus="{ row }">
          <StatusTag kind="connection" :value="row.connectionStatus" />
        </template>
        <template #credential>
          <span class="u-dim" title="接入时选择的 kubeconfig 凭据；列表接口不返回集群凭据绑定">未绑定</span>
        </template>
        <template #environmentNames="{ row }">
          <div class="u-wrap">
            <t-tag v-for="env in row.environmentNames" :key="env" size="small" variant="light">{{ env }}</t-tag>
            <span v-if="row.environmentNames.length === 0" class="u-dim">未关联</span>
          </div>
        </template>
        <template #lastCheckedAt="{ row }">{{ fmtRelative(row.lastCheckedAt) }}</template>
        <template #actions="{ row }">
          <t-button size="small" variant="text" @click="testConnection(row)">连接测试</t-button>
        </template>
        <template #empty>
          <EmptyState
            v-if="keyword"
            title="没有匹配的集群"
            description="调整关键字后再试。"
            icon="search"
            compact
          />
          <EmptyState v-else title="还没有接入集群" description="点击右上角「接入集群」填写 API Server 与凭据。" icon="cloud" compact />
        </template>
      </t-table>
    </t-loading>

    <p class="settings-clusters__foot">连接测试为只读探测；接入后的集群先以「未检测」登记，点「连接测试」才会更新状态与版本。</p>

    <t-drawer v-model:visible="dialogVisible" header="接入集群" size="560px" :footer="false" @close="dialogVisible = false">
      <div class="settings-drawer">
        <div class="settings-drawer__scroll">
          <label class="settings-drawer__field">
            <span class="settings-drawer__label">集群名称</span>
            <t-input v-model="clusterName" placeholder="例如 prod-k8s" />
          </label>
          <label class="settings-drawer__field">
            <span class="settings-drawer__label">API Server</span>
            <t-input v-model="apiServer" placeholder="https://10.20.0.10:6443" />
          </label>
          <label class="settings-drawer__field">
            <span class="settings-drawer__label">凭据</span>
            <t-select v-model="credentialId" :options="kubeconfigOptions" placeholder="选择 kubeconfig 凭据" />
          </label>
          <p class="settings-drawer__hint">
            Namespace 提示：接入后可在集群工作区按 Namespace 筛选资源；未指定时展示全部命名空间。
            凭据只以加密形式保存，不会回显。
          </p>
        </div>
        <div class="settings-drawer__footer">
          <t-button variant="outline" @click="dialogVisible = false">取消</t-button>
          <t-button theme="primary" @click="confirmConnect">接入</t-button>
        </div>
      </div>
    </t-drawer>
  </div>
</template>

<style scoped>
.settings-clusters__foot {
  margin: 8px 0 0;
  color: var(--tk-text-3);
  font-size: 11px;
}
.settings-clusters__toolbar {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}
.settings-clusters__search {
  width: 260px;
}
.settings-clusters__count {
  margin-left: auto;
  color: var(--tk-text-3);
  font-size: 11px;
}
.settings-clusters__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  color: var(--tk-text-2);
}
.settings-clusters__hint {
  margin: 0;
  color: var(--tk-text-3);
  font-size: 11px;
  line-height: 16px;
}
</style>
