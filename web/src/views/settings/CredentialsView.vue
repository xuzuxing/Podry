<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'

import { createCredential, listCredentials, rotateCredential } from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import PageHeader from '@/components/PageHeader.vue'
import type { Credential } from '@/types'
import { fmtTime } from '@/utils/format'

const rows = ref<Credential[]>([])
const loading = ref(false)
const error = ref('')
const keyword = ref('')

const dialogVisible = ref(false)
const credentialName = ref('')
const kind = ref<Credential['kind']>('git')
const secretValue = ref('')

const rotateVisible = ref(false)
const rotateTarget = ref<Credential | null>(null)

const kindLabels: Record<Credential['kind'], string> = {
  git: 'Git 凭据',
  registry: '镜像仓库凭据',
  kubeconfig: 'Kubeconfig',
}

const kindOptions = (Object.keys(kindLabels) as Array<Credential['kind']>).map((value) => ({
  label: kindLabels[value],
  value,
}))

function kindLabel(value: Credential['kind']): string {
  return kindLabels[value] ?? value
}

const columns = [
  { colKey: 'name', title: '名称', width: 180 },
  { colKey: 'kind', title: '类型', width: 140 },
  { colKey: 'version', title: '版本', width: 80 },
  { colKey: 'updatedAt', title: '更新时间', width: 150 },
  { colKey: 'actions', title: '操作', width: 90 },
]

const filteredRows = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return rows.value
  return rows.value.filter((credential) =>
    [credential.name, kindLabel(credential.kind), `v${credential.version}`]
      .some((value) => value.toLowerCase().includes(kw)),
  )
})

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    rows.value = await listCredentials()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '凭据列表加载失败'
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  credentialName.value = ''
  kind.value = 'git'
  secretValue.value = ''
  dialogVisible.value = true
}

async function confirmCreate(): Promise<void> {
  const name = credentialName.value.trim()
  if (!name) {
    MessagePlugin.warning('请输入凭据名称')
    return
  }
  if (!secretValue.value.trim()) {
    MessagePlugin.warning('请输入凭据值')
    return
  }
  try {
    await createCredential({ name, kind: kind.value })
    MessagePlugin.success(`凭据 ${name} 已创建（值只写入不回显）`)
    secretValue.value = ''
    dialogVisible.value = false
    await load()
  } catch (err) {
    MessagePlugin.error(err instanceof Error ? err.message : '创建凭据失败')
  }
}

function askRotate(row: { id: string }): void {
  rotateTarget.value = rows.value.find((item) => item.id === row.id) ?? null
  rotateVisible.value = true
}

async function confirmRotate(): Promise<void> {
  if (!rotateTarget.value) return
  try {
    const updated = await rotateCredential(rotateTarget.value.id)
    MessagePlugin.success(`凭据已轮换到 v${updated.version}`)
    rotateVisible.value = false
    rotateTarget.value = null
    await load()
  } catch (err) {
    MessagePlugin.error(err instanceof Error ? err.message : '凭据轮换失败')
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="credentials">
    <PageHeader title="凭据" description="Git、镜像仓库与集群凭据；列表只返回元信息，密文不回显。">
      <template #actions>
        <t-button theme="primary" size="small" @click="openCreate">
          <template #icon>
            <t-icon name="add" />
          </template>
          新建凭据
        </t-button>
      </template>
    </PageHeader>

    <t-alert theme="info" message="凭据以加密形式保存，列表接口只返回元信息" class="credentials__alert" />

    <ErrorState v-if="error" :message="error" @retry="load" />

    <t-loading v-else :loading="loading">
      <div class="credentials__toolbar">
        <t-input v-model="keyword" size="small" clearable placeholder="搜索凭据名称 / 类型" class="credentials__search">
          <template #prefix-icon><t-icon name="search" /></template>
        </t-input>
        <span class="credentials__count">共 {{ filteredRows.length }} 个凭据</span>
      </div>

      <t-table row-key="id" :data="filteredRows" :columns="columns" size="small" hover>
        <template #name="{ row }">{{ row.name }}</template>
        <template #kind="{ row }">
          <t-tag size="small" variant="light">{{ kindLabel(row.kind) }}</t-tag>
        </template>
        <template #version="{ row }">
          <span class="u-mono">v{{ row.version }}</span>
        </template>
        <template #updatedAt="{ row }">
          <span class="u-mono">{{ fmtTime(row.updatedAt) }}</span>
        </template>
        <template #actions="{ row }">
          <t-button size="small" variant="text" @click="askRotate(row)">轮换</t-button>
        </template>
        <template #empty>
          <EmptyState
            v-if="keyword"
            title="没有匹配的凭据"
            description="调整关键字后再试。"
            icon="search"
            compact
          />
          <EmptyState v-else title="还没有凭据" description="新建 Git、镜像仓库或 kubeconfig 凭据后即可在配置中引用。" icon="key" compact />
        </template>
      </t-table>
    </t-loading>

    <div class="credentials__actions">
      <span class="u-dim">轮换会生成新版本，引用旧版本的配置需要重新选择凭据。</span>
    </div>

    <t-drawer v-model:visible="dialogVisible" header="新建凭据" size="560px" :footer="false" @close="dialogVisible = false">
      <div class="settings-drawer">
        <div class="settings-drawer__scroll">
          <label class="settings-drawer__field">
            <span class="settings-drawer__label">名称</span>
            <t-input v-model="credentialName" placeholder="例如 acme-git-token" />
          </label>
          <label class="settings-drawer__field">
            <span class="settings-drawer__label">类型</span>
            <t-select v-model="kind" :options="kindOptions" />
          </label>
          <label class="settings-drawer__field">
            <span class="settings-drawer__label">值</span>
            <t-textarea v-model="secretValue" :autosize="{ minRows: 4, maxRows: 8 }" placeholder="粘贴 token 或 kubeconfig 内容" />
          </label>
          <p class="settings-drawer__hint">值只写入不回显；保存后列表仅展示名称、类型、版本与更新时间。</p>
        </div>
        <div class="settings-drawer__footer">
          <t-button variant="outline" @click="dialogVisible = false">取消</t-button>
          <t-button theme="primary" @click="confirmCreate">保存</t-button>
        </div>
      </div>
    </t-drawer>

    <t-drawer v-model:visible="rotateVisible" header="轮换凭据" size="480px" :footer="false" @close="rotateVisible = false">
      <div class="settings-drawer">
        <div class="settings-drawer__scroll">
          <t-alert
            theme="warning"
            title="旧版本立即失效"
            message="引用旧版本凭据的配置需要重新选择，已保存的构建与发布记录不受影响。"
          />
          <p class="settings-drawer__hint">
            轮换 {{ rotateTarget?.name }}（当前 v{{ rotateTarget?.version }}）会生成新版本。
          </p>
        </div>
        <div class="settings-drawer__footer">
          <t-button variant="outline" @click="rotateVisible = false">取消</t-button>
          <t-button theme="danger" @click="confirmRotate">确认轮换</t-button>
        </div>
      </div>
    </t-drawer>
  </div>
</template>

<style scoped>
.credentials__alert {
  margin-bottom: 12px;
}
.credentials__toolbar {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}
.credentials__search {
  width: 260px;
}
.credentials__count {
  margin-left: auto;
  color: var(--tk-text-3);
  font-size: 11px;
}
.credentials__actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}
.credentials__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  color: var(--tk-text-2);
}
.credentials__hint {
  margin: 0;
  color: var(--tk-text-3);
  font-size: 11px;
  line-height: 16px;
}
.credentials__hint--plain {
  color: var(--tk-text-2);
  font-size: 12px;
  line-height: 18px;
}
</style>
