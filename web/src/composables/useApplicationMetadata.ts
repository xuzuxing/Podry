import { computed, ref, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'
import { updateApplication } from '@/api'
import type { Application, Project } from '@/types'
import { applicationDescriptionError, applicationLabels, applicationTagErrors, type ApplicationTagDraft } from '@/utils/applicationCreation'
import { applicationLabelCopies, legacyApplicationTags } from '@/utils/applicationOverview'
import { notifyApplicationChanged } from '@/utils/appEvents'
import { usePipelineDraft } from './usePipelineDraft'

export type ApplicationMetadataField = ''|'description'|'project'|'tags'|'readme'
interface MetadataDraft {description:string;readme:string;projectId:string;labels:ApplicationTagDraft[];legacyTags:string[]}
const empty = ():MetadataDraft => ({description:'',readme:'',projectId:'',labels:[],legacyTags:[]})
export function useApplicationMetadata(options:{application:()=>Application|null;projects:()=>Project[];saved:(app:Application)=>void}) {
  const route = useRoute(), router = useRouter()
  const field = shallowRef<ApplicationMetadataField>('')
  const draft = ref(empty())
  const saving = shallowRef(false), submitted = shallowRef(false), error = shallowRef('')
  const descriptionError = computed(() => applicationDescriptionError(draft.value.description))
  const {dirty,discardVisible,resolveDiscard,requestClose,markClean} = usePipelineDraft({visible:()=>!!field.value,saving,snapshot:()=>JSON.stringify(draft.value),close:()=>{field.value=''}})
  function open(value:ApplicationMetadataField):void {
    const application = options.application()
    if (!application || saving.value || field.value) return
    draft.value = {description:application.description,readme:application.readme ?? '',projectId:application.projectId,labels:applicationLabelCopies(application).map((label,index)=>({...label,id:index+1})),legacyTags:legacyApplicationTags(application)}
    if (!draft.value.labels.length) draft.value.labels = [{id:1,key:'',value:'',propagate:false}]
    submitted.value=false;error.value='';field.value=value;markClean()
  }
  async function save():Promise<void> {
    const application = options.application()
    if (!application || !field.value || saving.value) return
    submitted.value=true;error.value=''
    if (field.value==='description' && descriptionError.value) {error.value=descriptionError.value;return}
    if (field.value==='tags' && applicationTagErrors(draft.value.labels).some(row=>row.key||row.value)) {error.value='请修正标签中的必填项和格式错误';return}
    if (field.value==='project' && !options.projects().some(item=>item.id===draft.value.projectId)) {error.value='请选择有效项目';return}
    const editing = field.value
    const patch = editing==='tags' ? {labels:applicationLabels(draft.value.labels),legacyTags:[...draft.value.legacyTags]}
      : editing==='project' ? {projectId:draft.value.projectId}
      : editing==='description' ? {description:draft.value.description.trim()} : {readme:draft.value.readme}
    saving.value=true
    try {
      const updated = await updateApplication(application.id,patch)
      markClean();field.value='';options.saved(updated);notifyApplicationChanged(updated.id)
      void MessagePlugin.success('已保存')
      if (updated.projectId !== String(route.params.projectId)) {
        await router.replace({name:'app-overview',params:{projectId:updated.projectId,appId:updated.id},query:{...route.query}})
      }
    } catch (err) {error.value=err instanceof Error ? err.message : '保存失败'}
    finally {saving.value=false}
  }
  return {field,draft,saving,submitted,error,descriptionError,dirty,discardVisible,resolveDiscard,requestClose,open,save}
}
