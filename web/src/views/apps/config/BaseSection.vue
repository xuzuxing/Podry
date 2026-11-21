<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'

import { getConfig, listApplicationResources, listBindings, MockError, saveConfig } from '@/api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import PageHeader from '@/components/PageHeader.vue'
import type { AppConfig, ChartConfig, DeployValues, K8sResource, WorkloadKind } from '@/types'

interface BaseForm {
  workloadKind: WorkloadKind
  chartVersion: string
  replicaCount: number
  containerPort: number
  host: string
  backoffLimit: number
  activeDeadlineSeconds: number
}

const route = useRoute()
const router = useRouter()
const appId = computed(() => String(route.params.appId ?? ''))

const chartVersionOptions = [
  { label: '1.4.0（Deployment / Job）', value: '1.4.0' },
  { label: '1.2.0（存量 Job 模板）', value: '1.2.0' },
]

const config = ref<AppConfig | null>(null)
const form = ref<BaseForm>(blankForm())
const saved = ref<BaseForm>(blankForm())
const errors = ref<Record<string, string>>({})
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const conflict = ref(false)
const kindLockedAlert = ref(false)

/** Base Configurations 里的 ConfigMaps / Secrets 入口（只读列表，编辑走资源页签） */
const objectResources = ref<K8sResource[]>([])

const objectKeys = (resource: K8sResource): string[] => {
  const manifest = resource.manifest ?? ''
  // 只匹配行首的 data:，避免命中 metadata:
  const matched = /^data:[ \t]*$/m.exec(manifest)
  if (!matched || matched.index === undefined) return []
  const body = manifest.slice(matched.index + matched[0].length)
  return [...body.matchAll(/^\s{2}([A-Za-z0-9_.-]+):/gm)].map((match) => match[1])
}

const configMaps = computed(() =>
  objectResources.value
    .filter((item) => item.kind === 'ConfigMap')
    .map((item) => ({ name: item.ref.name, keys: objectKeys(item) })),
)

const secrets = computed(() =>
  objectResources.value
    .filter((item) => item.kind === 'Secret')
    .map((item) => ({ name: item.ref.name, keys: objectKeys(item).length })),
)

async function loadObjects(): Promise<void> {
  try {
    const bindings = await listBindings(appId.value)
    const binding = bindings[0]
    if (!binding) return
    objectResources.value = await listApplicationResources(appId.value, binding.id)
  } catch {
    objectResources.value = []
  }
}

/* GUI / YAML 双模式（对齐 Devtron 的 Base Configurations） */
const mode = ref<'gui' | 'yaml'>('gui')
const yamlDraft = ref('')
const yamlError = ref('')

function toYaml(): string {
  const lines: string[] = []
  if (form.value.workloadKind === 'Deployment') {
    lines.push('replicaCount: ' + form.value.replicaCount)
    lines.push('containerPort: ' + form.value.containerPort)
    if (form.value.host.trim()) lines.push('host: ' + form.value.host.trim())
  } else {
    lines.push('job:')
    lines.push('  backoffLimit: ' + form.value.backoffLimit)
    lines.push('  activeDeadlineSeconds: ' + form.value.activeDeadlineSeconds)
  }
  return lines.join('\n') + '\n'
}

function applyYaml(): boolean {
  yamlError.value = ''
  const source = yamlDraft.value
  const read = (pattern: RegExp): number | null => {
    const matched = pattern.exec(source)
    if (!matched) return null
    const value = Number(matched[1])
    return Number.isFinite(value) ? value : null
  }
  if (form.value.workloadKind === 'Deployment') {
    const replica = read(/^\s*replicaCount:\s*(\d+)/m)
    const port = read(/^\s*containerPort:\s*(\d+)/m)
    const host = /^\s*host:\s*(\S+)/m.exec(source)?.[1] ?? ''
    if (replica === null || port === null) {
      yamlError.value = 'YAML 需包含 replicaCount 与 containerPort（整数）'
      return false
    }
    form.value.replicaCount = replica
    form.value.containerPort = port
    form.value.host = host
  } else {
    const backoff = read(/^\s*backoffLimit:\s*(\d+)/m)
    const deadline = read(/^\s*activeDeadlineSeconds:\s*(\d+)/m)
    if (backoff === null || deadline === null) {
      yamlError.value = 'YAML 需包含 job.backoffLimit 与 job.activeDeadlineSeconds（整数）'
      return false
    }
    form.value.backoffLimit = backoff
    form.value.activeDeadlineSeconds = deadline
  }
  return validate()
}

function switchMode(next: 'gui' | 'yaml'): void {
  if (next === mode.value) return
  if (next === 'yaml') {
    yamlDraft.value = toYaml()
    yamlError.value = ''
  } else if (!applyYaml()) {
    return
  }
  mode.value = next
}

function blankForm(): BaseForm {
  return {
    workloadKind: 'Deployment',
    chartVersion: '1.4.0',
    replicaCount: 1,
    containerPort: 8080,
    host: '',
    backoffLimit: 1,
    activeDeadlineSeconds: 1800,
  }
}

function fromConfig(cfg: AppConfig): BaseForm {
  const values = cfg.deployValues
  return {
    workloadKind: cfg.chartConfig?.workloadKind ?? 'Deployment',
    chartVersion: cfg.chartConfig?.chartVersion ?? '1.4.0',
    replicaCount: values.replicaCount ?? 1,
    containerPort: values.containerPort ?? 8080,
    host: values.host ?? '',
    backoffLimit: values.job?.backoffLimit ?? 1,
    activeDeadlineSeconds: values.job?.activeDeadlineSeconds ?? 1800,
  }
}

const versionText = computed(() => (config.value ? `v${config.value.version}` : '—'))
const chartLocked = computed(() => config.value !== null && config.value.chartConfig !== null)
const isJob = computed(() => form.value.workloadKind === 'Job')
const dirty = computed(() => JSON.stringify(form.value) !== JSON.stringify(saved.value))
const savedEmpty = computed(
  () => config.value !== null && config.value.chartConfig === null && Object.keys(config.value.deployValues).length === 0,
)
const savedRows = computed<Array<{ label: string; value: string }>>(() => {
  const cfg = config.value
  const values = cfg?.deployValues ?? {}
  const rows: Array<{ label: string; value: string }> = [
    { label: '工作负载类型', value: cfg?.chartConfig ? cfg.chartConfig.workloadKind : '未保存' },
    { label: 'Chart 版本', value: cfg?.chartConfig ? cfg.chartConfig.chartVersion : '未保存' },
  ]
  if (values.replicaCount !== undefined) rows.push({ label: '副本数', value: String(values.replicaCount) })
  if (values.containerPort !== undefined) rows.push({ label: '容器端口', value: String(values.containerPort) })
  if (values.host !== undefined) rows.push({ label: '访问域名', value: values.host || '—' })
  if (values.job) {
    rows.push({ label: 'Job backoffLimit', value: String(values.job.backoffLimit) })
    rows.push({ label: 'Job activeDeadlineSeconds', value: String(values.job.activeDeadlineSeconds) })
  }
  if (values.env) rows.push({ label: '环境变量', value: Object.keys(values.env).join('、') })
  return rows
})

function fill(next: BaseForm): void {
  form.value = { ...next }
  saved.value = { ...next }
}

async function load(): Promise<void> {
  if (!appId.value) return
  loading.value = true
  error.value = ''
  conflict.value = false
  kindLockedAlert.value = false
  errors.value = {}
  try {
    const cfg = await getConfig(appId.value)
    config.value = cfg
    fill(fromConfig(cfg))
    void loadObjects()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '基础部署配置加载失败'
  } finally {
    loading.value = false
  }
}

function validate(): boolean {
  const next: Record<string, string> = {}
  if (!form.value.chartVersion) next.chartVersion = '请选择 Chart 版本'
  if (form.value.workloadKind === 'Deployment') {
    if (!Number.isFinite(form.value.replicaCount) || form.value.replicaCount < 1 || form.value.replicaCount > 50) {
      next.replicaCount = '副本数需为 1–50 之间的整数'
    }
    if (!Number.isFinite(form.value.containerPort) || form.value.containerPort < 1 || form.value.containerPort > 65535) {
      next.containerPort = '容器端口需为 1–65535 之间的整数'
    }
    const host = form.value.host.trim()
    if (host && (host.includes('://') || host.includes('/'))) next.host = '只填写域名，不要带协议或路径'
  } else {
    if (!Number.isFinite(form.value.backoffLimit) || form.value.backoffLimit < 0 || form.value.backoffLimit > 10) {
      next.backoffLimit = 'backoffLimit 需为 0–10 之间的整数'
    }
    const deadline = form.value.activeDeadlineSeconds
    if (!Number.isFinite(deadline) || deadline < 30 || deadline > 86400) {
      next.activeDeadlineSeconds = 'activeDeadlineSeconds 需在 30–86400 秒之间'
    }
  }
  errors.value = next
  return Object.keys(next).length === 0
}

async function goNext(): Promise<void> {
  const ok = await save()
  if (!ok) return
  await router.push({ name: 'config-workflow', params: { projectId: route.params.projectId, appId: appId.value } })
}

async function save(): Promise<boolean> {
  if (mode.value === 'yaml' && !applyYaml()) return false
  if (!config.value || !validate()) return false
  saving.value = true
  conflict.value = false
  kindLockedAlert.value = false
  try {
    const chartConfig: ChartConfig = {
      workloadKind: form.value.workloadKind,
      chartVersion: form.value.chartVersion,
    }
    const deployValues: DeployValues = {}
    if (config.value.deployValues.env) deployValues.env = { ...config.value.deployValues.env }
    if (form.value.workloadKind === 'Deployment') {
      deployValues.replicaCount = Math.round(form.value.replicaCount)
      deployValues.containerPort = Math.round(form.value.containerPort)
      if (form.value.host.trim()) deployValues.host = form.value.host.trim()
    } else {
      deployValues.job = {
        backoffLimit: Math.round(form.value.backoffLimit),
        activeDeadlineSeconds: Math.round(form.value.activeDeadlineSeconds),
      }
    }
    const updated = await saveConfig(appId.value, {
      section: 'base',
      expectedVersion: config.value.version,
      chartConfig,
      deployValues,
    })
    config.value = updated
    fill(fromConfig(updated))
    MessagePlugin.success(`已保存（配置版本 v${updated.version}）`)
    return true
  } catch (err) {
    if (err instanceof MockError && err.code === 'revision_conflict') conflict.value = true
    else if (err instanceof MockError && err.code === 'chart_type_locked') kindLockedAlert.value = true
    else MessagePlugin.error(err instanceof Error ? err.message : '保存失败')
    return false
  } finally {
    saving.value = false
  }
}

watch(appId, load, { immediate: true })
</script>

<template>
  <div class="sec">
    <PageHeader title="基础部署配置" description="选择 Chart 与工作负载类型，并填写该应用的基础部署值。">
      <template #actions>
        <span v-if="dirty" class="hint-dirty">有未保存修改</span>
        <t-button variant="outline" :loading="saving" :disabled="loading || config === null" @click="goNext">
          保存并下一步
        </t-button>
        <t-button theme="primary" :loading="saving" :disabled="loading || config === null" @click="save">
          <template #icon><t-icon name="save" /></template>
          保存
        </t-button>
      </template>
    </PageHeader>

    <t-alert
      v-if="conflict"
      theme="warning"
      title="配置已被他人更新"
      message="当前表单仍保留你的输入；重新读取会以服务端版本覆盖本地改动。"
    >
      <template #operation>
        <t-button size="small" variant="outline" @click="load">
          <template #icon><t-icon name="refresh" /></template>
          重新读取
        </t-button>
      </template>
    </t-alert>

    <t-alert
      v-if="kindLockedAlert"
      theme="warning"
      title="工作负载类型首次保存后不可修改"
      message="chart_type_locked：如需更换 Deployment / Job，请新建应用后重新配置。"
    />

    <div v-if="loading" class="sec__state">
      <t-loading size="small" text="加载中…" />
    </div>
    <ErrorState v-else-if="error" :message="error" @retry="load" />

    <template v-else>
      <section class="tk-panel">
        <div class="tk-panel__head">
          <span>Chart</span>
          <span class="sec__modes">
            <button
              type="button"
              class="sec__mode"
              :class="{ 'sec__mode--active': mode === 'gui' }"
              @click="switchMode('gui')"
            >
              GUI
            </button>
            <button
              type="button"
              class="sec__mode"
              :class="{ 'sec__mode--active': mode === 'yaml' }"
              @click="switchMode('yaml')"
            >
              YAML
            </button>
          </span>
          <span class="u-dim">配置版本 {{ versionText }}</span>
        </div>
        <div class="tk-panel__body">
          <template v-if="mode === 'yaml'">
            <p class="u-dim">以 values.yaml 编辑部署值；切回 GUI 或保存时会解析，字段缺失会提示。</p>
            <t-textarea v-model="yamlDraft" class="sec__yaml" :autosize="{ minRows: 10, maxRows: 20 }" />
            <t-alert v-if="yamlError" theme="error" :message="yamlError" class="sec__yaml-error" />
          </template>
          <div v-else class="fld-grid">
            <div class="fld">
              <span class="fld__label">工作负载类型</span>
              <t-radio-group v-model="form.workloadKind">
                <t-radio value="Deployment" :disabled="chartLocked && form.workloadKind !== 'Deployment'">
                  Deployment
                </t-radio>
                <t-radio value="Job" :disabled="chartLocked && form.workloadKind !== 'Job'">Job</t-radio>
              </t-radio-group>
              <span v-if="chartLocked" class="u-dim">首次保存后锁定：已保存为 {{ form.workloadKind }}，不可再切换。</span>
              <span v-else class="u-dim">保存后该类型锁定，后续只能修改参数。</span>
            </div>
            <div class="fld">
              <span class="fld__label">Chart 版本</span>
              <t-select v-model="form.chartVersion" :options="chartVersionOptions" />
              <span v-if="errors.chartVersion" class="fld__err">{{ errors.chartVersion }}</span>
              <span class="u-dim">1.4.0 支持 Deployment 与 Job；1.2.0 为存量 Job 模板。</span>
            </div>
          </div>
        </div>
      </section>

      <section v-if="!isJob && mode === 'gui'" class="tk-panel">
        <div class="tk-panel__head">
          <span>Deployment 参数</span>
          <span class="u-dim">应用于所有环境的默认值</span>
        </div>
        <div class="tk-panel__body">
          <div class="fld-grid">
            <div class="fld">
              <span class="fld__label">副本数 <em>*</em></span>
              <t-input-number v-model="form.replicaCount" :min="1" :max="50" theme="normal" />
              <span v-if="errors.replicaCount" class="fld__err">{{ errors.replicaCount }}</span>
              <span class="u-dim">单个环境可在此基础值上覆盖副本数。</span>
            </div>
            <div class="fld">
              <span class="fld__label">容器端口 <em>*</em></span>
              <t-input-number v-model="form.containerPort" :min="1" :max="65535" theme="normal" />
              <span v-if="errors.containerPort" class="fld__err">{{ errors.containerPort }}</span>
              <span class="u-dim">Service 与 Ingress 均指向该端口。</span>
            </div>
            <div class="fld fld--wide">
              <span class="fld__label">访问域名（host）</span>
              <t-input v-model="form.host" placeholder="checkout.acme.dev" />
              <span v-if="errors.host" class="fld__err">{{ errors.host }}</span>
              <span class="u-dim">留空表示不创建 Ingress；只填写域名，不要带协议或路径。</span>
            </div>
          </div>
        </div>
      </section>

      <section v-else-if="mode === 'gui'" class="tk-panel">
        <div class="tk-panel__head">
          <span>Job 参数</span>
          <span class="u-dim">一次性任务交付</span>
        </div>
        <div class="tk-panel__body">
          <div class="fld-grid">
            <div class="fld">
              <span class="fld__label">backoffLimit <em>*</em></span>
              <t-input-number v-model="form.backoffLimit" :min="0" :max="10" theme="normal" />
              <span v-if="errors.backoffLimit" class="fld__err">{{ errors.backoffLimit }}</span>
              <span class="u-dim">失败重试次数上限，超过后 Job 标记为失败。</span>
            </div>
            <div class="fld">
              <span class="fld__label">activeDeadlineSeconds <em>*</em></span>
              <t-input-number v-model="form.activeDeadlineSeconds" :min="30" :max="86400" :step="30" theme="normal" />
              <span v-if="errors.activeDeadlineSeconds" class="fld__err">{{ errors.activeDeadlineSeconds }}</span>
              <span class="u-dim">受限区间 30–86400 秒，超时后任务被终止。</span>
            </div>
          </div>
        </div>
      </section>

      <section class="tk-panel">
        <div class="tk-panel__head">
          <span>ConfigMaps</span>
          <span class="u-dim">{{ configMaps.length }} 个</span>
        </div>
        <div class="tk-panel__body">
          <p v-if="!configMaps.length" class="u-dim">当前环境没有 ConfigMap。</p>
          <ul v-else class="obj-list">
            <li v-for="item in configMaps" :key="item.name" class="obj-item">
              <span class="u-mono">{{ item.name }}</span>
              <span class="u-dim obj-item__keys">{{ item.keys.join(', ') || '无数据' }}</span>
              <router-link
                class="obj-item__link"
                :to="{
                  name: 'app-resources',
                  params: { projectId: route.params.projectId, appId },
                  query: { kind: 'configmaps' },
                }"
              >
                在资源页签查看
              </router-link>
            </li>
          </ul>
        </div>
      </section>

      <section class="tk-panel">
        <div class="tk-panel__head">
          <span>Secrets</span>
          <span class="u-dim">{{ secrets.length }} 个 · 明文需在资源页签授权查看</span>
        </div>
        <div class="tk-panel__body">
          <p v-if="!secrets.length" class="u-dim">当前环境没有 Secret。</p>
          <ul v-else class="obj-list">
            <li v-for="item in secrets" :key="item.name" class="obj-item">
              <span class="u-mono">{{ item.name }}</span>
              <span class="u-dim obj-item__keys">{{ item.keys }} 个键</span>
              <router-link
                class="obj-item__link"
                :to="{
                  name: 'app-resources',
                  params: { projectId: route.params.projectId, appId },
                  query: { kind: 'secrets' },
                }"
              >
                在资源页签查看
              </router-link>
            </li>
          </ul>
        </div>
      </section>

      <section v-if="mode === 'gui'" class="tk-panel">
        <div class="tk-panel__head">
          <span>当前保存值</span>
          <span class="u-dim">只读；保存后更新</span>
        </div>
        <div class="tk-panel__body">
          <EmptyState
            v-if="savedEmpty"
            compact
            icon="info-circle"
            title="尚未保存基础部署配置"
            description="首次保存将创建 Chart 配置并解锁工作流分区。"
          />
          <dl v-else class="tk-kv">
            <template v-for="row in savedRows" :key="row.label">
              <dt>{{ row.label }}</dt>
              <dd class="u-mono">{{ row.value }}</dd>
            </template>
          </dl>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.sec {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sec__modes {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 12px;
}
.sec__mode {
  padding: 2px 10px;
  font: inherit;
  font-size: 12px;
  color: var(--tk-text-2);
  background: transparent;
  border: 1px solid var(--tk-border);
  border-radius: 3px;
  cursor: pointer;
}
.sec__mode--active {
  color: var(--tk-primary);
  background: #eef4fd;
  border-color: #b9d0f5;
  font-weight: 600;
}
.sec__yaml {
  font-family: var(--tk-mono);
  font-size: 12px;
}
.sec__yaml-error {
  margin-top: 8px;
}
.obj-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.obj-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid var(--tk-border);
}
.obj-item__keys {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.obj-item__link {
  color: var(--tk-primary);
  font-size: 12px;
}
.sec__state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 16px;
}
.hint-dirty {
  color: var(--tk-warning);
}
.fld-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.fld {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.fld--wide {
  grid-column: 1 / -1;
}
.fld__label {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--tk-text-2);
}
.fld__label em {
  color: var(--tk-danger);
  font-style: normal;
}
.fld__err {
  color: var(--tk-danger);
  font-size: 11px;
  line-height: 16px;
}
</style>
