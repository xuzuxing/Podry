<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'

import { createRegistry, listCredentials, listRegistries, updateRegistry } from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import PageHeader from '@/components/PageHeader.vue'
import type { Credential, Registry } from '@/types'

const rows = ref<Registry[]>([])
const credentials = ref<Credential[]>([])
const loading = ref(false)
const error = ref('')
const keyword = ref('')

const dialogVisible = ref(false)
const editingId = ref('')
const registryName = ref('')
const endpoint = ref('')
const credentialId = ref('')

const columns = [
  { colKey: 'name', title: '名称', width: 170 },
  { colKey: 'endpoint', title: 'Endpoint', width: 240 },
  { colKey: 'credential', title: '凭据', width: 170 },
  { colKey: 'actions', title: '操作', width: 80 },
]

const registryCredentialOptions = computed(() =>
  credentials.value
    .filter((item) => item.kind === 'registry')
    .map((item) => ({ label: `${item.name} · v${item.version}`, value: item.id })),
)

function credentialName(id: string | null): string {
  if (!id) return '未绑定'
  return credentials.value.find((item) => item.id === id)?.name ?? '未绑定'
}

const filteredRows = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return rows.value
  return rows.value.filter((registry) =>
    [registry.name, registry.endpoint, credentialName(registry.credentialId)]
      .some((value) => value.toLowerCase().includes(kw)),
  )
})

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [registryList, credentialList] = await Promise.all([listRegistries(), listCredentials()])
    rows.value = registryList
    credentials.value = credentialList
  } catch (err) {
    error.value = err instanceof Error ? err.message : '镜像仓库加载失败'
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  editingId.value = ''
  registryName.value = ''
  endpoint.value = ''
  credentialId.value = ''
  dialogVisible.value = true
}

function openEdit(row: { id: string; name: string; endpoint: string; credentialId: string | null }): void {
  editingId.value = row.id
  registryName.value = row.name
  endpoint.value = row.endpoint
  credentialId.value = row.credentialId ?? ''
  dialogVisible.value = true
}

async function confirmRegistry(): Promise<void> {
  const name = registryName.value.trim()
  const address = endpoint.value.trim()
  if (!name) {
    MessagePlugin.warning('请输入镜像仓库名称')
    return
  }
  if (!/^https?:\/\/.+/.test(address)) {
    MessagePlugin.warning('Endpoint 需为 http(s):// 地址')
    return
  }
  try {
    if (editingId.value) {
      await updateRegistry(editingId.value, { name, endpoint: address, credentialId: credentialId.value || null })
      MessagePlugin.success(`镜像仓库 ${name} 已更新`)
    } else {
      await createRegistry({ name, endpoint: address, credentialId: credentialId.value || null })
      MessagePlugin.success(`镜像仓库 ${name} 已添加`)
    }
    dialogVisible.value = false
    await load()
  } catch (err) {
    MessagePlugin.error(err instanceof Error ? err.message : '保存镜像仓库失败')
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="registries">
    <PageHeader title="镜像仓库" description="构建推送与镜像拉取使用的仓库地址；凭据只引用已保存的 registry 类型凭据。">
      <template #actions>
        <t-button theme="primary" size="small" @click="openCreate">
          <template #icon>
            <t-icon name="add" />
          </template>
          添加镜像仓库
        </t-button>
      </template>
    </PageHeader>

    <ErrorState v-if="error" :message="error" @retry="load" />

    <t-loading v-else :loading="loading">
      <div class="registries__toolbar">
        <t-input v-model="keyword" size="small" clearable placeholder="搜索仓库名称 / Endpoint" class="registries__search">
          <template #prefix-icon><t-icon name="search" /></template>
        </t-input>
        <span class="registries__count">共 {{ filteredRows.length }} 个仓库</span>
      </div>

      <t-table row-key="id" :data="filteredRows" :columns="columns" size="small" hover>
        <template #name="{ row }">{{ row.name }}</template>
        <template #endpoint="{ row }">
          <span class="u-mono">{{ row.endpoint }}</span>
        </template>
        <template #credential="{ row }">
          <span :class="row.credentialId ? 'u-mono' : 'u-dim'">{{ credentialName(row.credentialId) }}</span>
        </template>
        <template #actions="{ row }">
          <t-button size="small" variant="text" @click="openEdit(row)">编辑</t-button>
        </template>
        <template #empty>
          <EmptyState
            v-if="keyword"
            title="没有匹配的镜像仓库"
            description="调整关键字后再试。"
            icon="search"
            compact
          />
          <EmptyState v-else title="还没有镜像仓库" description="添加 Harbor、Docker Hub 或私有仓库后即可在构建配置中选择。" icon="component" compact />
        </template>
      </t-table>
    </t-loading>

    <p class="registries__foot">未绑定凭据的仓库只允许匿名拉取；构建推送需要 registry 类型凭据。</p>

    <t-drawer
      v-model:visible="dialogVisible"
      :header="editingId ? '编辑镜像仓库' : '添加镜像仓库'"
      size="560px"
      :footer="false"
      @close="dialogVisible = false"
    >
      <div class="settings-drawer">
        <div class="settings-drawer__scroll">
          <label class="settings-drawer__field">
            <span class="settings-drawer__label">名称</span>
            <t-input v-model="registryName" placeholder="例如 harbor.acme.dev" />
          </label>
          <label class="settings-drawer__field">
            <span class="settings-drawer__label">Endpoint</span>
            <t-input v-model="endpoint" placeholder="https://harbor.acme.dev" />
          </label>
          <label class="settings-drawer__field">
            <span class="settings-drawer__label">凭据</span>
            <t-select v-model="credentialId" :options="registryCredentialOptions" placeholder="选择 registry 类型凭据" />
          </label>
          <p class="settings-drawer__hint">凭据只保存引用关系；未选择凭据时仓库按匿名访问处理。</p>
        </div>
        <div class="settings-drawer__footer">
          <t-button variant="outline" @click="dialogVisible = false">取消</t-button>
          <t-button theme="primary" @click="confirmRegistry">{{ editingId ? '保存' : '添加' }}</t-button>
        </div>
      </div>
    </t-drawer>
  </div>
</template>

<style scoped>
.registries__foot {
  margin: 8px 0 0;
  color: var(--tk-text-3);
  font-size: 11px;
}
.registries__toolbar {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}
.registries__search {
  width: 260px;
}
.registries__count {
  margin-left: auto;
  color: var(--tk-text-3);
  font-size: 11px;
}
.registries__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  color: var(--tk-text-2);
}
.registries__hint {
  margin: 0;
  color: var(--tk-text-3);
  font-size: 11px;
  line-height: 16px;
}
</style>
