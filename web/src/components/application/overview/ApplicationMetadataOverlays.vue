<script setup lang="ts">
import { computed } from 'vue'
import type { Project } from '@/types'
import type { ApplicationTagDraft } from '@/utils/applicationCreation'
import ApplicationTagsEditor from '@/views/apps/components/onboarding/ApplicationTagsEditor.vue'
const props = defineProps<{field:string;labels:ApplicationTagDraft[];legacyTags:string[];projectId:string;originalProjectId:string;projects:Project[];saving:boolean;submitted:boolean;error:string;dirty:boolean;discardVisible:boolean}>()
const emit = defineEmits<{'update:labels':[rows:ApplicationTagDraft[]];'update:legacyTags':[tags:string[]];'update:projectId':[id:string];save:[];close:[];discard:[value:boolean]}>()
const options = computed(() => props.projects.map(item=>({label:item.name,value:item.id})))
</script>
<template>
  <t-drawer :visible="field==='tags'" header="管理标签" size="800px" drawer-class-name="overview-tags-drawer" :close-btn="!saving" :close-on-overlay-click="false" :close-on-esc-keydown="!saving && !discardVisible" @close="emit('close')">
    <div class="overview-tags-form">
      <ApplicationTagsEditor :model-value="labels" :disabled="saving" :submitted="submitted" @update:model-value="emit('update:labels',$event)" />
      <div v-if="legacyTags.length" class="overview-tags-legacy"><h3>旧版标签</h3><p>这些标签没有键值结构，保留原文；可移除后在上表重新配置。</p><div><t-tag v-for="tag in legacyTags" :key="tag" closable :disabled="saving" @close="emit('update:legacyTags',legacyTags.filter(item=>item!==tag))">{{tag}}</t-tag></div></div>
      <p v-if="error" role="alert" class="overview-metadata-error">{{error}}</p>
    </div>
    <template #footer><div class="overview-metadata-footer"><small v-if="dirty">有未保存修改</small><span /><t-button variant="outline" :disabled="saving" @click="emit('close')">取消</t-button><t-button :loading="saving" @click="emit('save')">保存</t-button></div></template>
  </t-drawer>
  <t-dialog :visible="field==='project'" header="调整所属项目" width="600px" :close-btn="!saving" :close-on-overlay-click="false" :close-on-esc-keydown="!saving && !discardVisible" :confirm-btn="{content:'保存',loading:saving}" :cancel-btn="{content:'取消',disabled:saving}" @confirm="emit('save')" @close="emit('close')">
    <div class="overview-project-form"><label>项目 <em>*</em><t-select :model-value="projectId" :options="options" :disabled="saving" filterable aria-label="目标项目" placeholder="选择目标项目" @change="emit('update:projectId',String($event))" /></label>
      <t-alert v-if="projectId && projectId!==originalProjectId" theme="warning"><p>切换项目可能影响访问权限：</p><ol><li>当前用户可能失去此应用的访问权限。</li><li>拥有目标项目权限的用户可能自动获得此应用的访问权限。</li></ol><small>当前 Mock 仅更新应用归属，未执行真实权限变更。</small></t-alert>
      <p v-if="error" role="alert" class="overview-metadata-error">{{error}}</p>
    </div>
  </t-dialog>
  <t-dialog :visible="discardVisible" header="放弃未保存的应用信息？" confirm-btn="放弃修改" cancel-btn="继续编辑" :close-on-overlay-click="false" @confirm="emit('discard',true)" @close="emit('discard',false)">当前修改尚未保存，离开后将丢失。</t-dialog>
</template>
<style scoped>
.overview-tags-form{display:flex;flex-direction:column;gap:20px}.overview-tags-legacy{border-top:1px solid #dce1e7;padding-top:16px}.overview-tags-legacy h3{font-size:13px;margin:0 0 8px}.overview-tags-legacy p{font-size:12px;color:#767d84;line-height:20px}.overview-tags-legacy>div{display:flex;flex-wrap:wrap;gap:8px}.overview-metadata-error{margin:0;padding:8px;color:#d54941;background:#fff0ed;font-size:12px;line-height:20px}.overview-metadata-footer{display:flex;align-items:center;gap:12px}.overview-metadata-footer>span{flex:1}.overview-metadata-footer small{color:#767d84}.overview-project-form{display:flex;flex-direction:column;gap:20px}.overview-project-form label{display:flex;flex-direction:column;gap:8px;font-size:13px}.overview-project-form em{display:none}.overview-project-form p{margin:0 0 4px}.overview-project-form ol{margin:0 0 8px;padding-left:20px;list-style:decimal;line-height:22px}.overview-project-form li{display:list-item}.overview-project-form small{font-size:11px;color:#767d84}:global(.overview-tags-drawer .t-drawer__body){overflow:auto}:global(.overview-tags-drawer .t-drawer__footer){height:74px;flex:none;padding:16px 20px}:global(.overview-tags-drawer .t-drawer__content-wrapper){max-width:calc(100vw - 48px)}
</style>
