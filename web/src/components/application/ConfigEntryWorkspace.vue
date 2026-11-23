<script setup lang="ts">
import { computed } from 'vue'
import ErrorState from '@/components/ErrorState.vue'
import ConfigEntryList from './ConfigEntryList.vue'
import ConfigEntryForm from './ConfigEntryForm.vue'
import DeploymentValuesEditor from './DeploymentValuesEditor.vue'
import { useConfigEntries } from '@/composables/useConfigEntries'
import type { ConfigEntryKind } from '@/utils/configEntries'
const props = defineProps<{kind: ConfigEntryKind}>()
const { label, isSecret, isOverride, items, current, selected, creating, loading, error, saving, formError, deleteVisible, discardVisible, merged, mode, draft, draftRevision, displayDraft, dirty, enabled, readonly, validation, tab, manifest, load, select, selectTab, createOverride, save, remove, discard } = useConfigEntries(() => props.kind)
const patch = computed(() => !!current.value?.base && isOverride.value && draft.value.mergeStrategy === 'patch' && tab.value === 'values')
const inherited = computed(() => isOverride.value && !!current.value?.base && !creating.value)
const emptyOverride = computed(() => inherited.value && !enabled.value && tab.value === 'values')
</script>
<template>
  <div class="ce">
    <div v-if="loading" class="ce__state"><t-loading size="small" text="加载配置…" /></div>
    <ErrorState v-else-if="error" :message="error" @retry="load" />
    <template v-else>
      <Teleport to="#config-entry-navigation" defer><ConfigEntryList :items="items" :selected="selected" :override="isOverride" :creating="creating" :label="label" @select="select($event)" @create="select('',true)" /></Teleport>
      <main class="ce__main">
        <template v-if="current || creating">
          <nav class="ce__tabs" aria-label="配置视图">
            <button v-if="inherited" :class="{'is-active':tab==='inherited'}" @click="selectTab('inherited')">继承</button>
            <button :class="{'is-active':tab==='values'}" @click="selectTab('values')">{{ inherited ? enabled ? '覆盖' : '不覆盖' : '配置' }}<span v-if="dirty" class="ce__dot" /></button>
            <button :class="{'is-active':tab==='dry-run'}" @click="selectTab('dry-run')">试运行</button>
            <span class="ce__spacer" />
            <t-button v-if="current?.own && !creating" size="small" theme="danger" variant="text" :disabled="saving" @click="deleteVisible = true">{{ inherited ? '删除覆盖' : '删除' }}</t-button>
          </nav>
          <div v-if="emptyOverride" class="ce__empty"><t-icon name="file-copy" size="58px" /><h3>{{ label }} 尚未配置覆盖</h3><p>当前使用基础配置的 {{ selected }}。</p><t-button @click="createOverride">创建覆盖</t-button><t-button variant="text" @click="selectTab('inherited')">查看继承值</t-button></div>
          <template v-else-if="tab === 'dry-run'">
            <div class="ce__notice">本地清单预览，未接入集群校验。{{ isSecret ? 'Secret 值已遮蔽。' : '' }}</div>
            <p v-if="validation && enabled" class="ce__error" role="alert">{{ validation }}</p>
            <DeploymentValuesEditor v-else :model-value="manifest" readonly label="配置清单预览" />
            <footer class="ce__footer"><span>预览不会保存修改</span><t-button variant="outline" @click="selectTab('values')">返回配置</t-button></footer>
          </template>
          <template v-else>
            <div v-if="tab==='inherited'" class="ce__notice">继承自基础配置 · {{ selected }} · 只读</div>
            <div v-if="inherited && tab==='values'" class="ce__strategy"><label>合并策略<t-select v-model="draft.mergeStrategy" class="ce__strategy-select" size="small" :disabled="saving" :options="[{label:'Patch · 覆盖指定字段',value:'patch'},{label:'Replace · 替换完整配置',value:'replace'}]" /></label><t-button size="small" variant="text" @click="merged = !merged">{{ merged ? '编辑覆盖值' : '查看合并值' }}</t-button></div>
            <div v-if="patch" class="ce__notice">Patch 继承来源和挂载设置，仅覆盖指定 key；未填写的 key 保留基础值。</div>
            <div class="ce__body"><ConfigEntryForm :key="`${kind}:${draftRevision}:${tab}:${merged}`" :model-value="displayDraft" :secret="isSecret" :readonly="readonly || saving" :name-locked="!creating" :patch="patch" v-model:mode="mode" @update:model-value="draft=$event" /></div>
            <footer v-if="tab==='values'" class="ce__footer"><span>{{ dirty ? '有未保存修改' : '· 已保存' }}</span><span v-if="validation && (dirty || creating)" class="ce__error" role="alert">{{ validation }}</span><span class="ce__spacer" /><t-button variant="outline" :disabled="!dirty || saving" @click="discardVisible=true">取消修改</t-button><t-button :disabled="!dirty || !!validation || merged" :loading="saving" @click="save">保存修改</t-button></footer>
          </template>
          <p v-if="formError" class="ce__error" role="alert">{{ formError }}</p>
        </template>
        <div v-else class="ce__empty"><t-icon :name="isSecret ? 'lock-on' : 'folder'" size="64px" /><h3>{{ label }}s</h3><p>{{ isSecret ? '管理应用的敏感配置键与挂载方式。' : '以环境变量或文件形式为应用提供配置。' }}</p><t-button @click="select('',true)">+ 新建 {{ label }}</t-button></div>
      </main>
    </template>
    <t-dialog :visible="deleteVisible" :header="inherited ? '删除覆盖' : `删除 ${label}`" :confirm-btn="{content:inherited?'删除覆盖':'删除',theme:'danger',loading:saving}" :close-on-overlay-click="false" @confirm="remove" @close="deleteVisible=false"><p>{{ inherited ? '删除后将恢复继承基础配置。' : `确认删除 ${selected}？` }}</p><p v-if="dirty">当前未保存的修改也会丢弃。</p><p v-if="formError" class="ce__error">{{formError}}</p></t-dialog>
    <t-dialog :visible="discardVisible" header="放弃未保存修改？" confirm-btn="放弃修改" cancel-btn="继续编辑" :close-on-overlay-click="false" @confirm="discard(true)" @close="discard(false)">当前修改尚未保存，放弃后将恢复已保存的配置。</t-dialog>
  </div>
</template>
<style scoped>
.ce{display:flex;flex:none;height:calc(100vh - 112px);min-height:480px;overflow:hidden;background:#fff;border:1px solid #dce1e7;border-radius:4px}.ce__state{margin:auto}.ce__main{display:flex;flex:1;flex-direction:column;min-width:0;min-height:0}
/* ---- 列表 ---- */
.ce__tabs{display:flex;align-items:center;min-height:48px;padding:0 16px;border-bottom:1px solid #dce1e7;gap:24px}.ce__tabs>button{position:relative;align-self:stretch;border:0;background:none;cursor:pointer;font-size:13px;color:#596168;padding:0 2px}.ce__tabs>button.is-active{color:#0066cc;box-shadow:inset 0 -2px #0066cc}.ce__spacer{flex:1}.ce__dot{display:inline-block;width:5px;height:5px;border-radius:50%;background:#e37318;margin:0 0 2px 6px}.ce__notice{font-size:12px;line-height:20px;color:#596168;padding:10px 20px;background:#f7f9fc;border-bottom:1px solid #edf1f5}.ce__strategy{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 20px;border-bottom:1px solid #edf1f5}.ce__strategy label{display:flex;align-items:center;gap:12px;font-size:12px}.ce__strategy-select{width:240px}
/* ---- 空态 ---- */
.ce__empty{display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:32px;color:#767d84}.ce__empty h3{font-size:16px;color:#000a14;margin:4px}.ce__empty p{margin:0;font-size:13px;text-align:center}
/* ---- 表单 ---- */
.ce__body{flex:1;min-height:0;overflow:auto}.ce__footer{display:flex;align-items:center;gap:10px;flex:none;min-height:64px;padding:12px 20px;border-top:1px solid #dce1e7;font-size:12px;color:#767d84}.ce__footer .ce__error{max-width:45%;margin:0}.ce__error{color:#d54941;font-size:12px;margin:12px 20px;overflow-wrap:anywhere}.ce__main>:deep(.values-editor){flex:1;min-height:0}
</style>
