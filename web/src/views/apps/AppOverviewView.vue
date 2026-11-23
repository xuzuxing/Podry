<script setup lang="ts">
import ApplicationProfile from '@/components/application/overview/ApplicationProfile.vue'
import ApplicationReadme from '@/components/application/overview/ApplicationReadme.vue'
import ApplicationMetadataOverlays from '@/components/application/overview/ApplicationMetadataOverlays.vue'
import OverviewEnvironmentTable from '@/components/application/overview/OverviewEnvironmentTable.vue'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import { useApplicationOverview } from '@/composables/useApplicationOverview'
import { useApplicationMetadata } from '@/composables/useApplicationMetadata'

const {appId,app,config,project,projects,loading,error,tab,rows,load,setTab,artifactSaved} = useApplicationOverview()
/* 元信息编辑：描述 / 所属项目 / 标签 / Readme */
const {field,draft,saving,submitted,error:metadataError,dirty,discardVisible,resolveDiscard,requestClose,open,save} = useApplicationMetadata({application:()=>app.value,projects:()=>projects.value,saved:updated=>{app.value=updated}})
</script>
<template>
  <div class="ov">
    <div v-if="loading" class="ov__state"><t-loading size="small" /><span class="u-muted">加载应用概览…</span></div>
    <ErrorState v-else-if="error" :message="error" @retry="load" />
    <EmptyState v-else-if="!app" title="应用数据不完整" description="未能读取该应用的概览数据，请返回项目后重新进入。" icon="error-circle" />
    <div v-else class="ov__grid" :class="{'ov__grid--about':tab==='about'}">
      <!-- 左列：应用档案 -->
      <ApplicationProfile v-if="tab==='about'" :application="app" :project="project" :config="config" :editing="field==='description'" v-model:text="draft.description" :saving="saving" :disabled="!!field" :submitted="submitted" :error="field==='description' ? metadataError : ''" @edit="open" @save="save" @cancel="requestClose" />
      <!-- 右列：About / Environments -->
      <section class="ov__main">
        <div class="ov__tabs" role="tablist" aria-label="应用概览"><button type="button" class="ov__tab" :class="{'ov__tab--active':tab==='about'}" role="tab" :aria-selected="tab==='about'" @click="setTab('about')">关于</button><button type="button" class="ov__tab" :class="{'ov__tab--active':tab==='environments'}" role="tab" :aria-selected="tab==='environments'" @click="setTab('environments')">环境</button></div>
        <ApplicationReadme v-if="tab==='about'" :source="app.readme ?? ''" :editing="field==='readme'" v-model:draft="draft.readme" :saving="saving" :disabled="!!field" :error="field==='readme' ? metadataError : ''" :updated-by="app.readmeUpdatedBy" :updated-at="app.readmeUpdatedAt" @edit="open('readme')" @save="save" @cancel="requestClose" />
        <OverviewEnvironmentTable v-else :rows="rows" :app-id="appId" :project-id="app.projectId" @saved="artifactSaved" />
      </section>
    </div>
    <ApplicationMetadataOverlays :field="field" v-model:labels="draft.labels" v-model:legacy-tags="draft.legacyTags" v-model:project-id="draft.projectId" :original-project-id="app?.projectId ?? ''" :projects="projects" :saving="saving" :submitted="submitted" :error="metadataError" :dirty="dirty" :discard-visible="discardVisible" @save="save" @close="requestClose" @discard="resolveDiscard" />
  </div>
</template>
<style scoped>
.ov{display:flex;flex-direction:column;min-width:0}.ov__state{display:flex;align-items:center;justify-content:center;gap:8px;padding:56px 16px}.ov__grid{display:grid;grid-template-columns:minmax(0,1400px);justify-content:center;align-items:start;padding:8px 0 24px}.ov__grid--about{grid-template-columns:300px minmax(0,1068px);gap:32px}
/* ---- 右列 ---- */
.ov__main{min-width:0}.ov__tabs{display:inline-flex;padding:2px;background:#f2f4f8;border:1px solid #dce1e7;border-radius:4px}.ov__tab{height:28px;padding:0 14px;color:#596168;font:inherit;font-size:12px;background:none;border:0;border-radius:3px;cursor:pointer}.ov__tab:hover{color:#0066cc}.ov__tab--active{color:#000a14;font-weight:600;background:white}@media(max-width:1050px){.ov__grid--about{grid-template-columns:260px minmax(0,1fr);gap:24px}}@media(max-width:800px){.ov__grid--about{grid-template-columns:minmax(0,1fr);gap:24px}}
</style>
