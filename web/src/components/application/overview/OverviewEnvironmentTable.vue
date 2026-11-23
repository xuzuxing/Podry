<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import EmptyState from '@/components/EmptyState.vue'
import ArtifactDetailsDrawer from '@/components/application/ArtifactDetailsDrawer.vue'
import type { Artifact } from '@/types'
import type { OverviewEnvironment } from '@/utils/applicationOverview'
import { overviewImageLabel, sortOverviewEnvironments } from '@/utils/applicationOverview'
import { fmtRelative, fmtTime } from '@/utils/format'
const props=defineProps<{rows:OverviewEnvironment[];appId:string;projectId:string}>()
const emit=defineEmits<{saved:[artifact:Artifact]}>()
const route=useRoute(),router=useRouter()
const expanded=shallowRef(false),selected=shallowRef<OverviewEnvironment|null>(null)
const sortKey=computed(()=>route.query.sortBy==='deployedAt'?'deployedAt':'environment')
const sortOrder=computed(()=>route.query.sortOrder==='DESC'?'DESC':'ASC')
const sorted=computed(()=>sortOverviewEnvironments(props.rows,sortKey.value,sortOrder.value))
const baseParams=computed(()=>({projectId:props.projectId,appId:props.appId}))
function sort(key:'environment'|'deployedAt'):void{void router.replace({query:{...route.query,sortBy:key,sortOrder:sortKey.value===key&&sortOrder.value==='ASC'?'DESC':'ASC'}})}
watch(()=>props.appId,()=>{selected.value=null;expanded.value=false})
</script>
<template>
  <section class="ov__envs">
    <div v-if="!rows.length" class="env-empty"><EmptyState compact title="还没有环境绑定" description="继续应用配置，添加环境后即可发布。" icon="layers" /><router-link class="env-config-link" :to="{name:'config-workflow',params:baseParams}">继续应用配置 <t-icon name="arrow-right" /></router-link></div>
    <div v-else class="env-table-scroll">
      <!-- ---- Environments 表（对齐 Devtron：Environment / Last Deployed / Commit / Deployed At） ---- -->
      <div class="env-table" :class="{'env-table--expanded':expanded}" role="table" aria-label="应用环境">
        <div class="env-table__head" role="row"><span role="columnheader" :aria-sort="sortKey==='environment'?(sortOrder==='ASC'?'ascending':'descending'):'none'"><button type="button" aria-label="按环境排序" @click="sort('environment')">环境 <t-icon :name="sortKey==='environment'?(sortOrder==='ASC'?'arrow-up':'arrow-down'):'swap'" size="12px" /></button></span><span role="columnheader">最近部署 <button type="button" :aria-label="expanded?'收起镜像名称':'展开镜像名称'" :aria-expanded="expanded" @click="expanded=!expanded"><t-icon :name="expanded?'chevron-left':'chevron-right'" size="14px" /></button></span><span role="columnheader">提交</span><span role="columnheader" :aria-sort="sortKey==='deployedAt'?(sortOrder==='ASC'?'ascending':'descending'):'none'"><button type="button" aria-label="按部署时间排序" @click="sort('deployedAt')">部署时间 <t-icon :name="sortKey==='deployedAt'?(sortOrder==='ASC'?'arrow-up':'arrow-down'):'swap'" size="12px" /></button></span></div>
        <div v-for="row in sorted" :key="row.id" class="env-row" role="row" :data-binding="row.id">
          <span role="cell" class="env-row__name"><t-icon name="layers" size="16px" /><router-link :to="{name:'app-resources',params:baseParams,query:{env:row.id}}">{{row.name}}</router-link><t-tag v-if="row.production" size="small" theme="warning" variant="light">生产</t-tag></span>
          <span role="cell" class="env-row__deploy"><button v-if="row.deployment" type="button" class="tag-chip" :title="row.deployment.imageRef" @click="selected=row">{{expanded ? row.deployment.imageRef : overviewImageLabel(row.deployment.imageRef)}}</button><span v-else class="u-muted">未部署</span></span>
          <span role="cell"><button v-if="row.build?.commitSha" type="button" class="sha-chip" @click="selected=row">{{row.build.commitSha.slice(0,7)}}</button><span v-else class="u-muted">—</span></span>
          <span role="cell" class="env-row__at"><template v-if="row.deployment"><span>{{row.deployment.operator || '—'}}</span><router-link :to="{name:'app-deployments',params:baseParams,query:{deployment:row.deployment.id,env:row.environmentId,tab:'config'}}" :title="fmtTime(row.deployment.createdAt)">{{fmtRelative(row.deployment.createdAt)}}</router-link></template><span v-else class="u-muted">—</span></span>
        </div>
      </div>
    </div>
    <ArtifactDetailsDrawer :visible="!!selected" :app-id="appId" :artifact-id="selected?.deployment?.artifactId || ''" :fallback-image="selected?.deployment?.imageRef" :deployment="selected?.deployment" :environment-name="selected?.name" @update:visible="value=>{if(!value) selected=null}" @saved="emit('saved',$event)" />
  </section>
</template>
<style scoped>
.ov__envs{margin-top:16px;min-width:0}.env-table-scroll{max-width:100%;overflow:auto;background:#fff;border:1px solid #dce1e7;border-radius:4px}.env-table{min-width:920px}.env-table__head,.env-row{display:grid;grid-template-columns:240px 210px 120px minmax(260px,1fr);align-items:center;gap:16px;padding:0 16px}.env-table--expanded{min-width:1120px}.env-table--expanded .env-table__head,.env-table--expanded .env-row{grid-template-columns:240px 410px 120px minmax(260px,1fr)}.env-table__head{min-height:38px;border-bottom:1px solid #dce1e7;color:#767d84;font-size:12px;font-weight:600}.env-table__head>span{display:flex;align-items:center;gap:4px}.env-table__head button{display:inline-flex;align-items:center;gap:4px;border:0;background:none;color:inherit;font:inherit;cursor:pointer;padding:2px}.env-row{min-height:46px;border-bottom:1px solid #edf1f5;font-size:13px}.env-row:last-child{border-bottom:0}.env-row>span{min-width:0}.env-row__name{display:flex;align-items:center;gap:8px}.env-row__name a{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.env-row a{color:#0066cc}.env-row__name>.t-tag{flex:none}.tag-chip,.sha-chip{display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid #dce1e7;border-radius:4px;background:#f7f9fb;padding:3px 6px;color:#0066cc;cursor:pointer;font:12px/18px var(--tk-mono)}.env-row__at{display:flex;align-items:center;gap:10px}.env-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:360px;background:white;border:1px solid #dce1e7;border-radius:4px}.env-config-link{display:flex;align-items:center;gap:8px;color:#0066cc}.overview-image-info{max-height:65vh;overflow:auto}.overview-image-info dl{display:grid;grid-template-columns:70px minmax(0,1fr);gap:12px;margin:0 0 20px}.overview-image-info dt{color:#767d84}.overview-image-info dd{margin:0;overflow-wrap:anywhere}
</style>
