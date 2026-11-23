<script setup lang="ts">
/**
 * Base / Environment Override 的 Deployment Template。
 * 对齐 Devtron：Configuration / Dry run 页签，GUI | YAML 切换，YAML 编辑器带行号，底部 Save Changes。
 * Base 保存写 appConfig.deployValues；环境覆盖保存写 binding.overrideValues。
 */
import { computed } from 'vue'
import ErrorState from '@/components/ErrorState.vue'
import DeploymentValuesEditor from '@/components/application/DeploymentValuesEditor.vue'
import DeploymentValuesForm from '@/components/application/DeploymentValuesForm.vue'
import { useDeploymentTemplate } from '@/composables/useDeploymentTemplate'
import { hasOverride } from '@/utils/deploymentValues'
import { deploymentValuesSchema } from '@/mock/deploymentValuesSchema'

const {
  config, binding, envName, loading, error, conflict, saving, mode, tab, draft, strategy,
  creating, showMerged, workloadKind, chartVersion, deleteVisible, discardVisible, leaveVisible,
  isOverride, enabled, yamlError, dirty, editable, editorValue, chartText, versionText, dryRunOutput,
  selectTab, resetDraft, createOverride, changeStrategy, switchMode, load, save, removeOverride, finishLeave,
} = useDeploymentTemplate()
const empty = computed(() => isOverride.value && tab.value === 'values' && !enabled.value)
const showFooter = computed(() => tab.value === 'values' && !empty.value)
const savedOverride = computed(() => hasOverride(binding.value))
const dryRunValue = computed(() => dryRunOutput.value)
const strategyOptions = [
  { label: 'Patch · 覆盖指定字段', value: 'patch' },
  { label: 'Replace · 替换完整配置', value: 'replace' },
]
</script>

<template>
  <div class="dt">
    <div v-if="loading" class="dt__state"><t-loading size="small" text="加载部署模板…" /></div>
    <ErrorState v-else-if="error" :message="error" @retry="load" />
    <template v-else>
      <nav class="dt__tabs" aria-label="部署模板视图">
        <button v-if="!isOverride" class="dt__tab" :class="{ 'dt__tab--active': tab === 'values' }" @click="selectTab('values')"><t-icon name="file-copy" size="14px" />配置</button>
        <template v-else>
          <button class="dt__tab" :class="{ 'dt__tab--active': tab === 'inherited' }" @click="selectTab('inherited')"><t-icon name="download" size="14px" />继承</button>
          <button class="dt__tab" :class="{ 'dt__tab--active': tab === 'values' }" @click="selectTab('values')"><t-icon name="file-copy" size="14px" />{{ enabled ? '覆盖' : '不覆盖' }}<span v-if="dirty" class="dt__dot" aria-label="有未保存修改" /></button>
        </template>
        <button class="dt__tab" :class="{ 'dt__tab--active': tab === 'dry-run' }" @click="selectTab('dry-run')"><t-icon name="play-circle" size="14px" />试运行</button>
        <span class="dt__spacer" />
        <t-button v-if="isOverride && savedOverride && tab === 'values'" class="dt__delete" variant="text" theme="danger" size="small" :disabled="saving" @click="deleteVisible = true">删除覆盖</t-button>
      </nav>

      <template v-if="tab === 'dry-run'">
        <div class="dt__notice"><t-icon name="info-circle" size="14px" />按当前{{ dirty ? '未保存草稿' : '配置' }}生成本地清单预览；尚未接入 Helm 渲染或集群校验。</div>
        <p v-if="yamlError && (!isOverride || enabled)" class="dt__error" role="alert">{{ yamlError }}</p>
        <DeploymentValuesEditor v-else :model-value="dryRunValue" readonly label="本地清单预览" />
        <div class="dt__footer"><span class="dt__meta">{{ dirty ? '预览不会保存当前修改' : '只读清单预览' }}</span><t-button variant="outline" @click="selectTab('values')">返回配置</t-button></div>
      </template>

      <div v-else-if="empty" class="dt__empty">
        <t-icon name="file-copy" size="64px" class="dt__empty-icon" />
        <h3>部署模板：{{ envName }} 尚未配置覆盖</h3>
        <p>为此环境创建独立配置，并通过合并策略决定如何组合继承值与覆盖值。</p>
        <t-button theme="primary" @click="createOverride"><template #icon><t-icon name="add" /></template>创建覆盖</t-button>
        <t-button variant="text" @click="selectTab('inherited')">查看继承值</t-button>
      </div>

      <template v-else>
        <div v-if="tab === 'inherited'" class="dt__inherited-bar">
          <t-icon name="info-circle" size="14px" /><span>继承自 <RouterLink :to="{ name: 'config-base-deployment', params: { projectId: $route.params.projectId, appId: $route.params.appId } }">基础配置</RouterLink></span>
          <span class="dt__chart">Chart <b>{{ chartText }}</b></span>
          <span class="dt__spacer" /><span class="dt__readonly">只读</span>
        </div>
        <div v-else class="dt__toolbar">
          <div class="dt__modes"><button :class="{ active: mode === 'gui' }" :disabled="Boolean(yamlError) || showMerged || saving" @click="switchMode('gui')">GUI</button><button :class="{ active: mode === 'yaml' }" :disabled="saving" @click="switchMode('yaml')">YAML</button></div>
          <span class="dt__divider" />
          <span class="dt__chart">Chart</span>
          <t-select v-if="!isOverride" v-model="workloadKind" class="dt__chart-kind" size="small" :disabled="Boolean(config?.chartConfig) || saving" :options="[{ label: 'Deployment', value: 'Deployment' }, { label: 'Job', value: 'Job' }]" aria-label="Chart 类型" />
          <b v-else class="dt__chart">{{ workloadKind }}</b>
          <span class="dt__chart">版本</span>
          <t-select v-model="chartVersion" class="dt__version" size="small" :disabled="isOverride || saving" :options="[{ label: '1.4.0', value: '1.4.0' }, { label: '1.2.0', value: '1.2.0' }]" aria-label="Chart 版本" />
          <template v-if="isOverride"><span class="dt__divider" /><span class="dt__chart">合并策略</span><t-select :model-value="strategy" class="dt__strategy" size="small" :options="strategyOptions" :disabled="saving" aria-label="合并策略" @change="changeStrategy($event as 'patch' | 'replace')" /></template>
          <span class="dt__spacer" />
          <t-checkbox v-if="isOverride" v-model="showMerged" :disabled="Boolean(yamlError)" class="dt__merged">查看合并值</t-checkbox>
        </div>

        <div v-if="isOverride && tab === 'values'" class="dt__notice"><t-icon name="info-circle" size="14px" />{{ showMerged ? '合并结果只读，关闭“查看合并值”继续编辑覆盖。' : strategy === 'patch' ? 'Patch：仅覆盖填写的字段，其余字段继续继承基础配置。' : 'Replace：以当前 Values 替换完整配置，未填写的字段不会继承。' }}</div>
        <t-alert v-if="conflict" theme="warning" title="配置版本已更新" message="重新加载会丢弃本地草稿并读取最新配置。" class="dt__alert"><template #operation><t-button size="small" variant="outline" @click="load">重新加载</t-button></template></t-alert>

        <div v-if="!editable || mode === 'yaml'" class="dt__editor">
          <DeploymentValuesEditor v-model="editorValue" :readonly="!editable || saving" :validator-schema="deploymentValuesSchema" :label="tab === 'inherited' ? '继承的基础 Values' : showMerged ? '合并后的 Values' : '部署 Values YAML'" />
        </div>
        <DeploymentValuesForm v-else v-model="draft" :workload-kind="workloadKind" :class="{ 'dt__busy': saving }" />
        <div v-if="yamlError && tab === 'values'" class="dt__validation"><p class="dt__error" role="alert">{{ yamlError }}</p><t-button size="small" variant="text" :disabled="saving" @click="discardVisible = true">恢复已保存内容</t-button></div>
        <div v-if="tab === 'inherited'" class="dt__metrics-note"><t-icon name="info-circle" size="14px" />继承值随基础配置更新。<t-button v-if="!enabled" size="small" variant="text" @click="createOverride">创建覆盖</t-button><t-button v-else size="small" variant="text" @click="selectTab('values')">查看环境覆盖</t-button></div>
        <footer v-if="showFooter" class="dt__footer"><span class="dt__meta">配置版本 {{ versionText }} <em :class="{ 'dt__dirty': dirty }">· {{ dirty ? '有未保存修改' : '已保存' }}</em></span><t-button v-if="dirty" variant="outline" :disabled="saving" @click="discardVisible = true">取消修改</t-button><t-button theme="primary" :disabled="!dirty || Boolean(yamlError)" :loading="saving" @click="save">保存修改</t-button></footer>
      </template>
    </template>

    <t-dialog v-model:visible="deleteVisible" header="删除环境覆盖" :confirm-btn="{ content: '删除覆盖', theme: 'danger', loading: saving }" :cancel-btn="{ content: '取消', disabled: saving }" :close-on-overlay-click="!saving" :close-btn="!saving" :close-on-esc-keydown="!saving" @confirm="removeOverride"><p>删除 {{ envName }} 的部署模板覆盖后，该环境将恢复继承基础配置。</p><p v-if="dirty" class="dt__dialog-note">当前未保存的覆盖修改也会丢弃。</p></t-dialog>
    <t-dialog v-model:visible="discardVisible" header="放弃未保存修改？" confirm-btn="放弃修改" @confirm="resetDraft"><p>{{ creating ? '当前新建的环境覆盖尚未保存，放弃后仍继承基础配置。' : '当前草稿将恢复为上次保存的内容。' }}</p></t-dialog>
    <t-dialog :visible="leaveVisible" header="配置有未保存修改" confirm-btn="放弃修改并离开" cancel-btn="继续编辑" @confirm="finishLeave(true)" @close="finishLeave(false)" @cancel="finishLeave(false)"><p>离开此页面会丢失当前草稿。请先保存，或确认放弃修改。</p></t-dialog>
  </div>
</template>

<style scoped>
.dt { display: flex; flex: none; flex-direction: column; height: calc(100dvh - 118px); min-height: 480px; margin: 8px; overflow: hidden; background: #fff; border: 1px solid #d0d4d9; border-radius: 4px; }
.dt__state { display: grid; flex: 1; place-content: center; }
.dt__tabs { display: flex; flex: none; align-items: center; height: 36px; border-bottom: 1px solid #d0d4d9; background: #f7fafc; }
.dt__tab { display: flex; align-items: center; gap: 6px; align-self: stretch; padding: 0 12px; border: 0; border-right: 1px solid transparent; border-bottom: 2px solid transparent; background: transparent; font: inherit; font-size: 12px; color: #3b444c; cursor: pointer; }
.dt__tab--active { border-right-color: #d0d4d9; border-bottom-color: #0066cc; background: #fff; color: #0066cc; }
.dt__dot { width: 5px; height: 5px; border-radius: 50%; background: #e37318; }
.dt__spacer { flex: 1; }
.dt__toolbar, .dt__inherited-bar { display: flex; flex: none; align-items: center; flex-wrap: wrap; gap: 8px; min-height: 34px; padding: 4px 12px; border-bottom: 1px solid #edf1f5; font-size: 12px; }
.dt__inherited-bar a { color: #0066cc; }
.dt__modes { display: flex; padding: 1px; border-radius: 4px; background: #f2f4f7; }
.dt__modes button { height: 22px; padding: 0 6px; border: 0; border-radius: 2px; background: transparent; font: inherit; cursor: pointer; }
.dt__modes button.active { color: #0066cc; background: #fff; box-shadow: 0 1px 2px #000a1426; }
.dt__modes button:disabled { cursor: default; color: #959ba1; }
.dt__divider { height: 16px; width: 1px; background: #e6e9ef; }
.dt__chart { font-size: 12px; white-space: nowrap; color: #596168; }
.dt__chart b { color: #000a14; font-weight: 600; }
.dt__chart-kind { width: 124px; }
.dt__version { width: 90px; }
.dt__strategy { width: 200px; }
.dt__readonly { color: #767d84; }
.dt__merged { font-size: 12px; }
.dt__notice { display: flex; flex: none; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid #edf1f5; background: #f7fafc; color: #596168; font-size: 12px; }
.dt__editor { display: flex; flex: 1; min-height: 0; }
.dt__alert { flex: none; margin: 8px 12px; }
.dt__validation { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 12px; background: #fff3f2; }
.dt__error { margin: 4px 0; padding: 0 12px; color: #c9353f; font-size: 12px; white-space: pre-wrap; }
.dt__metrics-note { display: flex; flex: none; align-items: center; gap: 6px; min-height: 32px; padding: 4px 12px; border-top: 1px solid #e6e9ef; background: #f7fafc; color: #596168; font-size: 12px; }
.dt__footer { display: flex; flex: none; align-items: center; justify-content: flex-end; gap: 12px; min-height: 56px; padding: 8px 12px; border-top: 1px solid #e6e9ef; }
.dt__meta { margin-right: auto; color: #767d84; font-size: 12px; }
.dt__meta em { font-style: normal; }
.dt__dirty { color: #e37318; }
.dt__busy { pointer-events: none; opacity: .65; }
.dt__delete { margin: 0 8px; }
.dt__empty { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 32px; text-align: center; }
.dt__empty h3 { margin: 0; font-size: 16px; font-weight: 600; }
.dt__empty p { max-width: 480px; margin: 0 0 12px; color: #767d84; font-size: 13px; line-height: 22px; }
.dt__empty-icon { margin-bottom: 8px; color: #a9bfd5; }
.dt__dialog-note { color: #c9353f; font-size: 12px; }
</style>
