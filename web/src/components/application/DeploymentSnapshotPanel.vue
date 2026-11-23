<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { stringify } from 'yaml'
import { getConfigComparisonCatalog } from '@/api'
import type { Binding, Deployment } from '@/types'
import type { ComparisonSide } from '@/types/configComparison'
import { configDocument } from '@/utils/configDocument'
import { resolveComparisonSide } from '@/utils/configComparison'
import { hasScopedVariables, resolveVariableSide } from '@/utils/configVariables'
import { flattenValues } from '@/utils/deploymentValues'
import ConfigurationDiff from './ConfigurationDiff.vue'
import DeploymentValuesEditor from './DeploymentValuesEditor.vue'
import ScopedVariablesToggle from './ScopedVariablesToggle.vue'
const props = defineProps<{deployment:Deployment;binding:Binding|null}>()
const route = useRoute()
const section = shallowRef<'values'|'configMaps'|'secrets'>('values')
const resource = shallowRef('')
const compare = shallowRef(false), yaml = shallowRef(false)
const loading = shallowRef(false), error = shallowRef('')
const current = shallowRef<ComparisonSide|null>(null)
const showVariables = shallowRef(false)
const snapshot = computed(()=>props.deployment.configSnapshot)
const rawHistorical = computed<ComparisonSide>(()=>({label:'发布时快照', document:snapshot.value?configDocument(snapshot.value.values,snapshot.value.configMaps,snapshot.value.secrets):null,variableSnapshot:snapshot.value?.variableSnapshot,error:'',notice:''}))
const hasVariables = computed(()=>hasScopedVariables(rawHistorical.value.document)||(compare.value&&hasScopedVariables(current.value?.document??null)))
const historySide = computed(()=>resolveVariableSide(rawHistorical.value,showVariables.value))
const currentSide = computed(()=>current.value?resolveVariableSide(current.value,showVariables.value):null)
const variableError = computed(()=>historySide.value.error||(compare.value?currentSide.value?.error:'')||'')
const documentSection = computed(()=>section.value==='configMaps'?'configmaps':'secrets')
const resources = computed(()=>section.value==='values'?[]:[...new Set([...Object.keys(rawHistorical.value.document?.[documentSection.value]??{}),...Object.keys(compare.value?current.value?.document?.[documentSection.value]??{}:{})])].sort().map((name)=>({label:name,value:name})))
function data(side:ComparisonSide|null):Record<string,unknown>{
  if(!side?.document)return {}
  return section.value==='values'?side.document.values:side.document[documentSection.value][resource.value]??{}
}
const historical = computed(()=>data(historySide.value)), latest = computed(()=>data(currentSide.value))
const rows = computed(()=>Object.entries(flattenValues(historical.value)))
const historicalYaml = computed(()=>stringify(historical.value))
const comparisonTarget = computed(() => ({
  name: 'config-compare',
  params: { projectId: String(route.params.projectId ?? ''), appId: props.deployment.appId, resourceType: section.value === 'values' ? 'deployment' : section.value === 'configMaps' ? 'configmaps' : 'secrets', resourceName: section.value === 'values' ? undefined : resource.value || undefined },
  query: { left: props.binding?.environmentId, right: props.binding?.environmentId, leftVersion: `history:${props.deployment.id}`, rightVersion: 'saved', returnTo: 'deployment', returnRun: props.deployment.id, resolveVariables:showVariables.value?'1':undefined },
}))
let generation=0
async function load():Promise<void>{
  const token=++generation
  loading.value=true;error.value='';current.value=null
  if(!props.binding){loading.value=false;return}
  const binding=props.binding
  try{
    const catalog=await getConfigComparisonCatalog(props.deployment.appId)
    if(token!==generation)return
    current.value=resolveComparisonSide(catalog,{environment:binding.environmentId,version:'saved'})
  }catch(err){if(token===generation)error.value=err instanceof Error?err.message:'当前配置加载失败'}
  finally{if(token===generation)loading.value=false}
}
watch(resources,(items)=>{if(!items.some((item)=>item.value===resource.value))resource.value=items[0]?.value??''})
watch(()=>[props.deployment.id,props.binding],()=>{section.value='values';resource.value='';compare.value=false;showVariables.value=false;void load()},{immediate:true})
onBeforeUnmount(()=>{generation++})
</script>
<template>
  <section class="deployment-snapshot">
    <div v-if="!snapshot" class="deployment-snapshot__missing"><t-icon name="info-circle" size="24px" /><strong>该发布记录未保存配置快照</strong><p>无法还原当时的部署参数、ConfigMaps 或 Secrets。</p></div>
    <template v-else>
      <div class="deployment-snapshot__meta"><span>{{snapshot.source==='fixture'?'本地示例快照':'发布触发时快照'}} · v{{deployment.configVersion}}</span><div class="deployment-snapshot__actions"><RouterLink v-if="binding" :to="comparisonTarget">打开版本对比</RouterLink><t-button size="small" variant="text" :disabled="loading || !!error || !current" @click="compare=!compare">{{compare?'返回历史配置':'对比当前配置'}}</t-button></div></div>
      <p v-if="error" class="deployment-snapshot__error">{{error}} <t-button size="small" variant="text" @click="load">重试</t-button></p>
      <nav class="deployment-snapshot__tabs"><button :class="{'is-active':section==='values'}" @click="section='values'">Deployment values</button><button :class="{'is-active':section==='configMaps'}" @click="section='configMaps'">ConfigMaps</button><button :class="{'is-active':section==='secrets'}" @click="section='secrets'">Secrets</button><span /><t-select v-if="section!=='values'" v-model="resource" :options="resources" class="deployment-snapshot__resource" placeholder="无配置条目" aria-label="历史配置条目" /><t-button v-if="!compare" size="small" variant="text" @click="yaml=!yaml">{{yaml?'GUI':'YAML'}}</t-button></nav>
      <p v-if="section==='secrets'" class="deployment-snapshot__hint">仅记录 Secret 键与挂载配置，不记录明文值。</p>
      <div v-if="hasVariables" class="deployment-snapshot__variables"><span>{{section==='values'?'Deployment values':section==='configMaps'?resource:'Secrets'}}</span><ScopedVariablesToggle v-model="showVariables" /></div>
      <p v-if="variableError" role="alert" class="deployment-snapshot__error">{{variableError}} 可隐藏变量值查看原始配置。</p>
      <ConfigurationDiff v-else-if="compare" :left="historical" :right="latest" left-label="发布时快照" right-label="当前有效配置" />
      <DeploymentValuesEditor v-else-if="yaml" :model-value="historicalYaml" readonly label="历史配置 YAML" />
      <table v-else class="deployment-snapshot__table"><thead><tr><th>参数</th><th>发布时的值</th></tr></thead><tbody><tr v-for="[key,value] in rows" :key="key"><td>{{key}}</td><td>{{value}}</td></tr><tr v-if="!rows.length"><td colspan="2">本次快照中没有该配置。</td></tr></tbody></table>
    </template>
  </section>
</template>
<style scoped>
.deployment-snapshot__variables{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 16px;color:#596168;font-size:12px;border-bottom:1px solid #edf1f5;background:#fafbfc}.deployment-snapshot__variables>span{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.deployment-snapshot__actions{display:flex;align-items:center;gap:12px}.deployment-snapshot__actions>a{color:#0066cc;font-size:12px}
.deployment-snapshot{width:100%;max-width:800px;min-width:0;margin-top:16px;border:1px solid #dce1e7;background:#fff;border-radius:4px;overflow:hidden}.deployment-snapshot__meta{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;font-size:12px;color:#596168;background:#f8fafc;border-bottom:1px solid #dce1e7}.deployment-snapshot__tabs{display:flex;align-items:center;gap:18px;padding:0 16px;border-bottom:1px solid #dce1e7;height:48px}.deployment-snapshot__tabs button{border:0;background:none;cursor:pointer;font-size:12px;color:#596168;height:100%}.deployment-snapshot__tabs button.is-active{color:#0066cc;box-shadow:inset 0 -2px #0066cc}.deployment-snapshot__tabs>span{flex:1}.deployment-snapshot__resource{max-width:260px}.deployment-snapshot__table{width:100%;border-collapse:collapse;font:12px/20px var(--tk-mono);table-layout:fixed}.deployment-snapshot__table td,.deployment-snapshot__table th{padding:10px 16px;border-bottom:1px solid #edf1f5;text-align:left;overflow-wrap:anywhere;white-space:pre-wrap}.deployment-snapshot__table th{font-family:inherit;font-weight:500;color:#767d84;background:#fafbfc}.deployment-snapshot__missing{display:flex;flex-direction:column;align-items:center;gap:10px;padding:32px;color:#767d84;font-size:13px}.deployment-snapshot__missing p{margin:0}.deployment-snapshot__hint{font-size:12px;color:#767d84;padding:10px 16px;margin:0}.deployment-snapshot__error{color:#d54941;padding:12px;font-size:12px}.deployment-snapshot :deep(.configuration-diff){height:420px;min-height:220px;max-height:500px;border:0}.deployment-snapshot :deep(.values-editor){height:360px}
</style>
