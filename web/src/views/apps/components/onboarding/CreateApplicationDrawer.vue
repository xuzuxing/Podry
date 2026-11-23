<script setup lang="ts">
import { shallowRef, watch } from 'vue'
import type { Application } from '@/types'
import { useApplicationCreation } from '@/composables/useApplicationCreation'
import ApplicationIdentityForm from './ApplicationIdentityForm.vue'
import CloneApplicationList from './CloneApplicationList.vue'
const props = defineProps<{visible:boolean;projectId?:string;initialMode?:'scratch'|'clone';sourceApplicationId?:string}>()
const emit = defineEmits<{'update:visible':[value:boolean];created:[app:Application]}>()
const {draft,mode,source,projects,apps,projectLoading,appsLoading,projectError,appsError,submitting,submitted,formError,tagsExpanded,showingForm,effectiveSourceMode,dirty,discardVisible,resolveDiscard,requestClose,loadProjects,loadApps,changeMode,selectSource,backToSources,submit} = useApplicationCreation({
  visible:()=>props.visible,projectId:()=>props.projectId,initialMode:()=>props.initialMode,sourceId:()=>props.sourceApplicationId,
  close:()=>emit('update:visible',false),created:app=>emit('created',app),
})
const helpVisible = shallowRef(false)
watch(() => props.visible, open => { if (!open) helpVisible.value = false })
</script>
<template>
  <t-drawer :visible="visible" size="1024px" header="新建应用" :footer="true" :close-btn="!submitting" :close-on-overlay-click="false" :close-on-esc-keydown="!discardVisible && !helpVisible && !submitting" drawer-class-name="ca-drawer" @close="requestClose">
    <div class="ca">
      <aside class="ca__rail">
        <div class="ca__methods"><button type="button" class="ca__mode" :class="{'ca__mode--active':mode==='scratch'}" :aria-pressed="mode==='scratch'" :disabled="submitting" @click="changeMode('scratch')"><t-icon name="add-circle" size="16px" />从零创建</button><button type="button" class="ca__mode" :class="{'ca__mode--active':mode==='clone'}" :aria-pressed="mode==='clone'" :disabled="submitting" @click="changeMode('clone')"><t-icon name="file-copy" size="16px" />克隆应用</button></div>
        <div class="ca__help"><p>在 Podry 中，应用代表你的软件项目或服务。</p><p>应用包含部署配置、环境与其他设置，可以部署到多个环境。</p><p>创建应用后，即可配置并管理它的构建与发布流程。</p></div>
        <div class="ca__need"><t-icon name="help-circle" />需要帮助？</div><t-button variant="text" size="small" @click="helpVisible=true">查看创建说明</t-button>
      </aside>
      <main class="ca__main">
        <template v-if="showingForm">
          <nav v-if="mode==='clone' && source" class="ca__breadcrumb" aria-label="克隆应用路径"><t-button size="small" variant="outline" aria-label="返回克隆应用列表" :disabled="submitting" @click="backToSources"><t-icon name="chevron-left" /></t-button><t-button variant="text" size="small" :disabled="submitting" @click="backToSources">克隆应用</t-button><span>/</span><strong>{{source.name}}</strong></nav>
          <div class="ca__form-scroll">
            <ApplicationIdentityForm v-model="draft" v-model:tags-expanded="tagsExpanded" :active="visible" :projects="projects" :loading="projectLoading" :project-error="projectError" :submitted="submitted" :disabled="submitting" :clone="mode==='clone'" :source-mode="effectiveSourceMode" @retry="loadProjects" />
            <p v-if="mode==='clone'" class="ca__note">Mock 复制源应用最新的 Git、构建与部署模板配置；不复制环境绑定、流水线、ConfigMap/Secret、构建及发布历史。</p>
            <p v-if="formError" role="alert" class="ca__error">{{formError}}</p>
          </div>
        </template>
        <template v-else><CloneApplicationList :applications="apps" :projects="projects" :loading="appsLoading" :error="appsError" @select="selectSource" @retry="loadApps" @scratch="changeMode('scratch')" /><p v-if="formError" role="alert" class="ca__error ca__error--list">{{formError}}</p></template>
      </main>
    </div>
    <template #footer><div class="ca__footer"><span v-if="dirty" class="ca__draft-state">有未保存修改</span><span class="ca__spacer" /><t-button theme="primary" :loading="submitting" :disabled="projectLoading || (mode==='clone' && appsLoading)" @click="submit">创建应用</t-button></div></template>
  </t-drawer>
  <t-dialog :visible="discardVisible" header="放弃未保存的应用信息？" confirm-btn="放弃修改" cancel-btn="继续编辑" :close-on-overlay-click="false" @confirm="resolveDiscard(true)" @close="resolveDiscard(false)">名称、描述和标签尚未保存，放弃后将关闭创建页面。</t-dialog>
  <t-dialog v-model:visible="helpVisible" header="应用创建说明" :footer="false"><p>从零创建应用后，源码构建应用需要配置 Git 仓库、构建配置、部署模板与工作流。容器镜像应用从部署模板开始。</p><p>克隆应用先选择源应用，再填写新应用所属项目、名称、描述与标签。新应用可以部署到多个环境。</p><p>标签的传播选项在当前 Mock 中仅记录，不会修改集群资源。</p></t-dialog>
</template>
<style scoped>
:global(.ca-drawer .t-drawer__body){padding:0;overflow:hidden}
:global(.ca-drawer .t-drawer__header){height:49px;min-height:49px;padding:12px 20px;box-sizing:border-box}
:global(.ca-drawer .t-drawer__footer){height:74px;min-height:74px;padding:16px 20px;box-sizing:border-box}
:global(.ca-drawer .t-drawer__content-wrapper){max-width:calc(100vw - 48px)}
.ca{display:grid;grid-template-columns:250px minmax(0,1fr);height:100%;min-height:0;overflow:hidden;background:#fff}.ca__rail{padding:20px;overflow:auto;border-right:1px solid #dce1e7}.ca__methods{display:flex;flex-direction:column;gap:4px}.ca__mode{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:0;border-radius:4px;background:none;cursor:pointer;font-size:13px;line-height:20px;text-align:left;color:#000a14}.ca__mode--active{background:#e8f1ff;color:#0066cc;font-weight:600}.ca__help{margin-top:24px;padding-top:20px;border-top:1px solid #dce1e7;font-size:12px;line-height:20px;color:#596168}.ca__help p{margin:0 0 20px}.ca__need{display:flex;align-items:center;gap:6px;font-size:12px;color:#596168;margin-top:24px}.ca__main{display:flex;flex-direction:column;min-width:0;min-height:0;background:#f7f9fb}.ca__form-scroll{flex:1;overflow:auto;min-height:0;padding:20px}.ca__breadcrumb{display:flex;align-items:center;gap:6px;padding:12px 20px;border-bottom:1px solid #dce1e7;background:#fff;flex:none;font-size:13px;min-width:0}.ca__breadcrumb strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ca__note{font-size:12px;line-height:20px;color:#767d84;margin:12px 0 0}.ca__error{font-size:12px;line-height:20px;color:#d54941;margin:12px 0 0;padding:8px 12px;background:#fff0ed;border-radius:4px}.ca__error--list{margin:0 20px 20px}.ca__footer{display:flex;align-items:center;gap:8px;height:100%}.ca__spacer{flex:1}.ca__draft-state{font-size:12px;color:#767d84}
</style>
