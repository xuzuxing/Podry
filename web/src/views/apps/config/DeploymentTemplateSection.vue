<script setup lang="ts">
/**
 * Base / Environment Override 的 Deployment Template。
 * 对齐 Devtron：Configuration / Dry run 页签，GUI | YAML 切换，YAML 编辑器带行号，底部 Save Changes。
 * Base 保存写 appConfig.deployValues；环境覆盖保存写 binding.overrideValues。
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'

import { getApplication, getConfig, listBindings, listEnvironments, MockError, saveConfig, updateAppBinding } from '@/api'
import ErrorState from '@/components/ErrorState.vue'
import type { AppConfig, Binding, ChartConfig, DeployValues, Environment, WorkloadKind } from '@/types'
import { notifySetupChanged } from '@/utils/appEvents'

type EditorTab = 'configuration' | 'inherited' | 'override' | 'dry'

interface TemplateForm {
  workloadKind: WorkloadKind
  chartVersion: string
  replicaCount: number
  containerPort: number
  host: string
  envRows: Array<{ key: string; value: string }>
  backoffLimit: number
  activeDeadlineSeconds: number
}

const route = useRoute()
const router = useRouter()
const appId = computed(() => String(route.params.appId ?? ''))
const envId = computed(() => String(route.params.envId ?? ''))
const isOverride = computed(() => String(route.name ?? '').startsWith('config-override'))

const config = ref<AppConfig | null>(null)
const bindings = ref<Binding[]>([])
const environments = ref<Environment[]>([])
const appName = ref('')
const loading = ref(true)
const error = ref('')
const saving = ref(false)
const conflict = ref(false)

const tab = ref<EditorTab>('configuration')
const mode = ref<'gui' | 'yaml'>('yaml')

const form = ref<TemplateForm>(blankForm())
const savedForm = ref<TemplateForm>(blankForm())
const yamlDraft = ref('')
const yamlSaved = ref('')
const yamlError = ref('')

const chartVersionOptions = [
  { label: '1.4.0（Deployment / Job）', value: '1.4.0' },
  { label: '1.2.0（存量 Job 模板）', value: '1.2.0' },
]

const binding = computed<Binding | null>(
  () => bindings.value.find((item) => item.environmentId === envId.value) ?? null,
)
const environment = computed<Environment | null>(
  () => environments.value.find((item) => item.id === envId.value) ?? null,
)
const envName = computed(() => environment.value?.name ?? (envId.value || '环境'))
const chartText = computed(() => {
  const chart = config.value?.chartConfig
  return chart ? `${chart.workloadKind} · 版本 ${chart.chartVersion}` : '未配置'
})
const versionText = computed(() => (config.value ? `v${config.value.version}` : '—'))
const chartLocked = computed(() => Boolean(config.value?.chartConfig))
const isJob = computed(() => form.value.workloadKind === 'Job')

function blankForm(): TemplateForm {
  return {
    workloadKind: 'Deployment',
    chartVersion: '1.4.0',
    replicaCount: 1,
    containerPort: 8080,
    host: '',
    envRows: [],
    backoffLimit: 1,
    activeDeadlineSeconds: 1800,
  }
}

function fromValues(base: DeployValues, chart?: ChartConfig | null): TemplateForm {
  return {
    workloadKind: chart?.workloadKind ?? 'Deployment',
    chartVersion: chart?.chartVersion ?? '1.4.0',
    replicaCount: base.replicaCount ?? 1,
    containerPort: base.containerPort ?? 8080,
    host: base.host ?? '',
    envRows: Object.entries(base.env ?? {}).map(([key, value]) => ({ key, value })),
    backoffLimit: base.job?.backoffLimit ?? 1,
    activeDeadlineSeconds: base.job?.activeDeadlineSeconds ?? 1800,
  }
}

function valuesOf(source: TemplateForm): DeployValues {
  const values: DeployValues = {}
  const env: Record<string, string> = {}
  source.envRows.forEach((row) => {
    const key = row.key.trim()
    if (key) env[key] = row.value
  })
  if (Object.keys(env).length) values.env = env
  if (source.workloadKind === 'Deployment') {
    values.replicaCount = Math.round(source.replicaCount)
    values.containerPort = Math.round(source.containerPort)
    if (source.host.trim()) values.host = source.host.trim()
  } else {
    values.job = {
      backoffLimit: Math.round(source.backoffLimit),
      activeDeadlineSeconds: Math.round(source.activeDeadlineSeconds),
    }
  }
  return values
}

function toYaml(source: TemplateForm): string {
  const lines: string[] = []
  if (source.workloadKind === 'Deployment') {
    lines.push(`replicaCount: ${source.replicaCount}`)
    lines.push(`containerPort: ${source.containerPort}`)
    if (source.host.trim()) lines.push(`host: ${source.host.trim()}`)
  } else {
    lines.push('job:')
    lines.push(`  backoffLimit: ${source.backoffLimit}`)
    lines.push(`  activeDeadlineSeconds: ${source.activeDeadlineSeconds}`)
  }
  const env = source.envRows.filter((row) => row.key.trim())
  if (env.length) {
    lines.push('env:')
    env.forEach((row) => lines.push(`  ${row.key.trim()}: ${JSON.stringify(row.value)}`))
  }
  return `${lines.join('\n')}\n`
}

function parseYaml(source: string): TemplateForm | null {
  const read = (pattern: RegExp): number | null => {
    const matched = pattern.exec(source)
    if (!matched) return null
    const value = Number(matched[1])
    return Number.isFinite(value) ? value : null
  }
  const next = { ...form.value }
  if (next.workloadKind === 'Deployment') {
    const replica = read(/^\s*replicaCount:\s*(\d+)/m)
    const port = read(/^\s*containerPort:\s*(\d+)/m)
    const host = /^\s*host:\s*(\S+)/m.exec(source)?.[1] ?? ''
    if (replica === null || port === null) {
      yamlError.value = 'YAML 需包含 replicaCount 与 containerPort（整数）'
      return null
    }
    if (replica < 1 || replica > 50) {
      yamlError.value = '副本数需为 1–50 之间的整数'
      return null
    }
    if (port < 1 || port > 65535) {
      yamlError.value = '容器端口需为 1–65535 之间的整数'
      return null
    }
    next.replicaCount = replica
    next.containerPort = port
    next.host = host
  } else {
    const backoff = read(/^\s*backoffLimit:\s*(\d+)/m)
    const deadline = read(/^\s*activeDeadlineSeconds:\s*(\d+)/m)
    if (backoff === null || deadline === null) {
      yamlError.value = 'YAML 需包含 job.backoffLimit 与 job.activeDeadlineSeconds（整数）'
      return null
    }
    next.backoffLimit = backoff
    next.activeDeadlineSeconds = deadline
  }
  const envBlock = /^env:\s*\n((?:[ \t]+.*\n?)*)/m.exec(source)?.[1] ?? ''
  next.envRows = envBlock
    .split('\n')
    .map((line) => /^\s+([^:\s]+):\s*(.*)$/.exec(line))
    .filter((matched): matched is RegExpExecArray => matched !== null)
    .map((matched) => {
      let value = matched[2].trim()
      if (value.startsWith('"') && value.endsWith('"')) {
        try {
          value = JSON.parse(value) as string
        } catch {
          value = value.slice(1, -1)
        }
      }
      return { key: matched[1], value }
    })
  yamlError.value = ''
  return next
}

const lineNumbers = computed(() => {
  const count = Math.max(1, yamlDraft.value.split('\n').length)
  return Array.from({ length: count }, (_, index) => index + 1).join('\n')
})

const dirty = computed(() => {
  if (mode.value === 'yaml') return yamlDraft.value !== yamlSaved.value
  return JSON.stringify(form.value) !== JSON.stringify(savedForm.value)
})

const dryRunOutput = computed(() => {
  const image = `registry.xuzuxing.cn/podry/${appName.value || 'app'}:<tag>`
  if (form.value.workloadKind === 'Job') {
    return [
      `# Dry run · ${chartText.value}`,
      'apiVersion: batch/v1',
      'kind: Job',
      'metadata:',
      `  name: ${appName.value || 'app'}-${isOverride.value ? envName.value : 'base'}`,
      'spec:',
      `  backoffLimit: ${form.value.backoffLimit}`,
      `  activeDeadlineSeconds: ${form.value.activeDeadlineSeconds}`,
      '  template:',
      '    spec:',
      '      restartPolicy: Never',
      '      containers:',
      '        - name: app',
      `          image: ${image}`,
      '',
    ].join('\n')
  }
  return [
    `# Dry run · ${chartText.value}`,
    'apiVersion: apps/v1',
    'kind: Deployment',
    'metadata:',
    `  name: ${appName.value || 'app'}-${isOverride.value ? envName.value : 'base'}`,
    'spec:',
    `  replicas: ${form.value.replicaCount}`,
    '  template:',
    '    spec:',
    '      containers:',
    '        - name: app',
    `          image: ${image}`,
    '          ports:',
    `            - containerPort: ${form.value.containerPort}`,
    form.value.host ? `# ingress host: ${form.value.host}` : '# ingress host: (none)',
    '',
  ].join('\n')
})

function switchMode(next: 'gui' | 'yaml'): void {
  if (next === mode.value) return
  if (next === 'yaml') {
    yamlDraft.value = toYaml(form.value)
    yamlError.value = ''
  } else {
    const parsed = parseYaml(yamlDraft.value)
    if (!parsed) return
    form.value = parsed
  }
  mode.value = next
}

function setTab(next: EditorTab): void {
  if (mode.value === 'yaml') {
    const parsed = parseYaml(yamlDraft.value)
    if (parsed) form.value = parsed
  }
  tab.value = next
  if (next === 'inherited') {
    yamlDraft.value = toYaml(form.value)
    yamlSaved.value = yamlDraft.value
  }
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  conflict.value = false
  try {
    const [cfg, bindingList, environmentList, app] = await Promise.all([
      getConfig(appId.value),
      listBindings(appId.value),
      listEnvironments(),
      getApplication(appId.value),
    ])
    config.value = cfg
    bindings.value = bindingList
    environments.value = environmentList
    appName.value = app.name
    const baseForm = fromValues(cfg.deployValues, cfg.chartConfig)
    form.value = { ...baseForm }
    savedForm.value = { ...baseForm }
    yamlDraft.value = toYaml(baseForm)
    yamlSaved.value = yamlDraft.value
    const overrideForm = binding.value
      ? fromValues({ ...cfg.deployValues, ...binding.value.overrideValues }, cfg.chartConfig)
      : baseForm
    form.value = { ...overrideForm }
    savedForm.value = { ...overrideForm }
    yamlDraft.value = toYaml(overrideForm)
    yamlSaved.value = yamlDraft.value
    tab.value = isOverride.value ? 'inherited' : 'configuration'
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Deployment Template 加载失败'
  } finally {
    loading.value = false
  }
}

async function saveBase(): Promise<void> {
  if (!config.value) return
  if (mode.value === 'yaml') {
    const parsed = parseYaml(yamlDraft.value)
    if (!parsed) return
    form.value = parsed
  }
  const updated = await saveConfig(appId.value, {
    section: 'base',
    expectedVersion: config.value.version,
    chartConfig: { workloadKind: form.value.workloadKind, chartVersion: form.value.chartVersion },
    deployValues: valuesOf(form.value),
  })
  config.value = updated
  savedForm.value = { ...form.value }
  yamlDraft.value = toYaml(form.value)
  yamlSaved.value = yamlDraft.value
  MessagePlugin.success(`已保存基础配置（配置版本 v${updated.version}）`)
  notifySetupChanged(appId.value)
}

async function saveOverride(): Promise<void> {
  const current = binding.value
  if (!current) return
  const parsed = parseYaml(yamlDraft.value)
  if (!parsed) return
  form.value = parsed
  const updated = await updateAppBinding(appId.value, current.id, {
    expectedVersion: current.version,
    overrideValues: valuesOf(parsed),
  })
  bindings.value = bindings.value.map((item) => (item.id === updated.id ? updated : item))
  yamlSaved.value = yamlDraft.value
  savedForm.value = { ...parsed }
  MessagePlugin.success(`已保存 ${envName.value} 的环境覆盖`)
}

async function save(): Promise<void> {
  if (saving.value) return
  saving.value = true
  conflict.value = false
  try {
    if (isOverride.value) {
      if (tab.value !== 'inherited') {
        MessagePlugin.info('“不覆盖”表示该环境不覆盖基础配置；切到“继承”后编辑即可创建覆盖')
        saving.value = false
        return
      }
      await saveOverride()
    } else {
      await saveBase()
    }
  } catch (err) {
    if (err instanceof MockError && err.code === 'revision_conflict') {
      conflict.value = true
      MessagePlugin.warning('配置已被更新，请重新加载后再保存')
    } else {
      MessagePlugin.error(err instanceof Error ? err.message : '保存失败')
    }
  } finally {
    saving.value = false
  }
}

function addEnvRow(): void {
  form.value.envRows.push({ key: '', value: '' })
}

function removeEnvRow(index: number): void {
  form.value.envRows.splice(index, 1)
}

async function saveAndNext(): Promise<void> {
  if (isOverride.value || saving.value) return
  if (dirty.value) await save()
  if (dirty.value) return
  await router.push({
    name: 'config-workflow',
    params: { projectId: String(route.params.projectId ?? ''), appId: appId.value },
  })
}

watch([appId, envId], () => void load(), { immediate: true })
</script>

<template>
  <div class="dt">
    <div v-if="loading" class="dt__state">
      <t-loading size="small" text="加载 Deployment Template…" />
    </div>
    <ErrorState v-else-if="error" :message="error" @retry="load" />

    <template v-else>
      <div class="dt__tabs">
        <button
          v-if="!isOverride"
          type="button"
          class="dt__tab"
          :class="{ 'dt__tab--active': tab === 'configuration' }"
          @click="setTab('configuration')"
        >
          <t-icon name="file-copy" size="14px" />
          配置
        </button>
        <template v-else>
          <button
            type="button"
            class="dt__tab"
            :class="{ 'dt__tab--active': tab === 'inherited' }"
            @click="setTab('inherited')"
          >
            <t-icon name="file-copy" size="14px" />
            继承
          </button>
          <button
            type="button"
            class="dt__tab"
            :class="{ 'dt__tab--active': tab === 'override' }"
            @click="setTab('override')"
          >
            <t-icon name="lock-off" size="14px" />
            不覆盖
          </button>
        </template>
        <button
          type="button"
          class="dt__tab"
          :class="{ 'dt__tab--active': tab === 'dry' }"
          @click="setTab('dry')"
        >
          <t-icon name="play-circle" size="14px" />
          试运行
        </button>
      </div>

      <div v-if="tab === 'dry'" class="dt__dry">
        <div class="dt__dry-bar">
          <span>试运行只渲染清单，不会提交保存；实际发布仍由构建发布页发起。</span>
          <t-button size="small" variant="outline" @click="setTab(isOverride ? 'inherited' : 'configuration')">
            返回编辑
          </t-button>
        </div>
        <pre class="dt__code">{{ dryRunOutput }}</pre>
      </div>

      <template v-else>
        <div class="dt__toolbar">
          <div class="dt__modes">
            <button
              type="button"
              class="dt__mode"
              :class="{ 'dt__mode--active': mode === 'gui' }"
              @click="switchMode('gui')"
            >
              GUI
            </button>
            <button
              type="button"
              class="dt__mode"
              :class="{ 'dt__mode--active': mode === 'yaml' }"
              @click="switchMode('yaml')"
            >
              YAML
            </button>
          </div>
          <span class="dt__chart">Chart <b>{{ chartText }}</b></span>          <t-select
            v-if="mode === 'gui' && !isOverride"
            v-model="form.chartVersion"
            class="dt__version"
            size="small"
            :options="chartVersionOptions"
            :disabled="chartLocked"
          />
          <span class="dt__spacer" />
          <span class="dt__meta">配置版本 {{ versionText }}</span>
        </div>

        <div v-if="tab === 'inherited'" class="dt__notice">
          <t-icon name="info-circle" size="14px" />
          继承自基础配置 · Chart {{ chartText }}
        </div>

        <t-alert
          v-if="conflict"
          theme="warning"
          title="配置已被他人更新"
          message="重新加载会以服务端版本覆盖本地改动。"
          class="dt__alert"
        >
          <template #operation>
            <t-button size="small" variant="outline" @click="load">重新加载</t-button>
          </template>
        </t-alert>

        <div class="dt__body">
          <div v-if="isOverride && tab === 'override'" class="dt__nooverride">
            <p class="dt__nooverride-title">该环境未配置覆盖</p>
            <p class="dt__nooverride-text">
              该环境当前不覆盖基础配置，部署时直接使用基础配置的 values。
              需要覆盖时切到 <b>继承</b>，编辑 YAML 后保存即可创建环境覆盖。
            </p>
            <t-button size="small" variant="outline" @click="setTab('inherited')">去“继承”编辑</t-button>
          </div>

          <template v-else-if="mode === 'yaml'">
            <div class="dt__editor">
              <pre class="dt__gutter" aria-hidden="true">{{ lineNumbers }}</pre>
              <textarea
                v-model="yamlDraft"
                class="dt__textarea"
                spellcheck="false"
                placeholder="replicaCount: 2&#10;containerPort: 8080"
              />
            </div>
            <p v-if="yamlError" class="dt__error">{{ yamlError }}</p>
            <p v-if="isOverride && tab === 'inherited'" class="dt__hint">
              继承自基础配置；直接编辑并保存会写入 {{ envName }} 的环境覆盖。
            </p>
          </template>

          <div v-else class="dt__form">
            <section class="dt__group">
              <h3 class="dt__group-title">工作负载</h3>
              <div class="dt__grid">
                <label class="dt__field">
                  <span class="dt__label">工作负载类型</span>
                  <t-radio-group v-model="form.workloadKind" :disabled="chartLocked && !isOverride">
                    <t-radio value="Deployment" :disabled="chartLocked && form.workloadKind !== 'Deployment'">Deployment</t-radio>
                    <t-radio value="Job" :disabled="chartLocked && form.workloadKind !== 'Job'">Job</t-radio>
                  </t-radio-group>
                </label>
                <label v-if="!isJob" class="dt__field">
                  <span class="dt__label">replicaCount</span>
                  <t-input-number v-model="form.replicaCount" :min="1" :max="50" theme="normal" />
                </label>
                <template v-else>
                  <label class="dt__field">
                    <span class="dt__label">job.backoffLimit</span>
                    <t-input-number v-model="form.backoffLimit" :min="0" :max="10" theme="normal" />
                  </label>
                  <label class="dt__field">
                    <span class="dt__label">job.activeDeadlineSeconds</span>
                    <t-input-number v-model="form.activeDeadlineSeconds" :min="30" :max="86400" :step="30" theme="normal" />
                  </label>
                </template>
              </div>
            </section>

            <section class="dt__group">
              <h3 class="dt__group-title">容器</h3>
              <div class="dt__grid">
                <label v-if="!isJob" class="dt__field">
                  <span class="dt__label">containerPort</span>
                  <t-input-number v-model="form.containerPort" :min="1" :max="65535" theme="normal" />
                </label>
                <label v-if="!isJob" class="dt__field">
                  <span class="dt__label">host</span>
                  <t-input v-model="form.host" placeholder="checkout.acme.dev" />
                </label>
              </div>

              <div class="dt__env">
                <div class="dt__env-head">
                  <span class="dt__label">环境变量</span>
                  <t-button size="small" variant="text" @click="addEnvRow">+ 添加变量</t-button>
                </div>
                <div v-for="(row, index) in form.envRows" :key="index" class="dt__env-row">
                  <t-input v-model="row.key" size="small" placeholder="KEY" />
                  <t-input v-model="row.value" size="small" placeholder="value" />
                  <button type="button" class="dt__env-remove" title="删除变量" @click="removeEnvRow(index)">
                    <t-icon name="close" size="13px" />
                  </button>
                </div>
                <p v-if="!form.envRows.length" class="dt__hint">没有环境变量；敏感值请使用 Secret 引用。</p>
              </div>
            </section>
          </div>
        </div>

        <div v-if="isOverride" class="dt__metrics-note">
          <t-icon name="info-circle" size="14px" />
          应用指标未在基础配置中启用
        </div>

        <div class="dt__footer">
          <span class="dt__meta">
            配置版本 {{ versionText }}
            <em v-if="dirty" class="dt__meta-dirty">· 有未保存修改</em>
            <em v-else>· 已保存</em>
          </span>
          <template v-if="!isOverride">
            <t-button variant="outline" :loading="saving" :disabled="!dirty" @click="save">保存</t-button>
            <t-button theme="primary" :loading="saving" :disabled="saving" @click="saveAndNext">
              保存并下一步
            </t-button>
          </template>
          <t-button v-else theme="primary" :loading="saving" :disabled="!dirty" @click="save">保存修改</t-button>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.dt {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  background: #fff;
  border: 1px solid #e6e9ef;
  border-radius: 4px;
}
.dt__state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px;
}
.dt__tabs {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
  height: 48px;
  padding: 0 12px;
  border-bottom: 1px solid #e6e9ef;
}
.dt__tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  padding: 0 12px;
  color: #3b444c;
  font: inherit;
  font-size: 13px;
  background: none;
  border: 0;
  border-bottom: 2px solid transparent;
  cursor: pointer;
}
.dt__tab:hover {
  color: #0066cc;
}
.dt__tab--active {
  color: #0066cc;
  border-bottom-color: #0066cc;
}
.dt__toolbar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 12px;
  height: 44px;
  padding: 0 16px;
  border-bottom: 1px solid #e6e9ef;
}
.dt__modes {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  background: #f2f4f7;
  border-radius: 4px;
}
.dt__mode {
  height: 24px;
  padding: 0 12px;
  color: #596168;
  font: inherit;
  font-size: 12px;
  background: none;
  border: 0;
  border-radius: 2px;
  cursor: pointer;
}
.dt__mode--active {
  color: #000a14;
  font-weight: 600;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 10, 20, 0.12);
}
.dt__chart {
  color: #596168;
  font-size: 12px;
}
.dt__chart b {
  color: #3b444c;
  font-weight: 600;
}
.dt__version {
  width: 200px;
}
.dt__spacer {
  flex: 1;
}
.dt__meta {
  color: #767d84;
  font-size: 12px;
}
.dt__notice {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  color: #3b444c;
  font-size: 12px;
  background: #f7fafc;
  border-bottom: 1px solid #edf1f5;
}
.dt__alert {
  margin: 12px 16px 0;
}
.dt__body {
  flex: 1;
  min-height: 0;
  padding: 12px 16px;
}
.dt__nooverride {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 20px;
  background: #f7fafc;
  border: 1px solid #e6e9ef;
  border-radius: 4px;
}
.dt__nooverride-title {
  margin: 0;
  color: #000a14;
  font-size: 14px;
  font-weight: 600;
}
.dt__nooverride-text {
  max-width: 640px;
  margin: 0;
  color: #596168;
  font-size: 13px;
  line-height: 21px;
}
.dt__editor {
  display: flex;
  height: 100%;
  min-height: 520px;
  overflow: hidden;
  background: #fbfcfd;
  border: 1px solid #d0d4d9;
  border-radius: 2px;
}
.dt__gutter {
  flex: none;
  min-width: 44px;
  margin: 0;
  padding: 10px 8px;
  overflow: hidden;
  color: #b1b7bc;
  font-family: var(--tk-mono);
  font-size: 12px;
  line-height: 20px;
  text-align: right;
  background: #f7f9fb;
  border-right: 1px solid #edf1f5;
  user-select: none;
}
.dt__textarea {
  flex: 1;
  width: 100%;
  min-height: 520px;
  padding: 10px 12px;
  color: #1d2730;
  font-family: var(--tk-mono);
  font-size: 12px;
  line-height: 20px;
  resize: none;
  background: transparent;
  border: 0;
  outline: none;
  white-space: pre;
}
.dt__error {
  margin: 8px 0 0;
  color: #f33e3e;
  font-size: 12px;
}
.dt__hint {
  margin: 8px 0 0;
  color: #767d84;
  font-size: 12px;
}
.dt__form {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 820px;
}
.dt__group {
  padding-bottom: 16px;
  border-bottom: 1px solid #edf1f5;
}
.dt__group:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}
.dt__group-title {
  margin: 0 0 12px;
  color: #000a14;
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
}
.dt__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.dt__env {
  margin-top: 14px;
}
.dt__env-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.dt__env-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 28px;
  gap: 8px;
  align-items: center;
  margin-bottom: 6px;
}
.dt__env-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: #767d84;
  background: transparent;
  border: 0;
  border-radius: 2px;
  cursor: pointer;
}
.dt__env-remove:hover {
  color: #f33e3e;
  background: #fef0f0;
}
.dt__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dt__label {
  color: #596168;
  font-size: 12px;
}
.dt__metrics-note {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  color: #767d84;
  font-size: 11px;
  border-top: 1px solid #e6e9ef;
}
.dt__footer {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  height: 64px;
  padding: 0 16px;
  border-top: 1px solid #e6e9ef;
}
.dt__meta {
  margin-right: auto;
  color: #767d84;
  font-size: 11px;
}
.dt__meta em {
  font-style: normal;
}
.dt__meta-dirty {
  color: #e37318;
}
.dt__dirty {
  color: #e37318;
  font-size: 12px;
}
.dt__saved {
  color: #767d84;
  font-size: 12px;
}
.dt__dry {
  flex: 1;
  padding: 16px;
}
.dt__dry-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  color: #596168;
  font-size: 12px;
}
.dt__code {
  margin: 0;
  padding: 16px;
  overflow: auto;
  color: #1d2730;
  font-family: var(--tk-mono);
  font-size: 12px;
  line-height: 20px;
  background: #f7fafc;
  border: 1px solid #e6e9ef;
  border-radius: 4px;
}
</style>
