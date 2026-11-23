<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'
import { getConfig, listRegistries, MockError, saveConfig } from '@/api'
import ErrorState from '@/components/ErrorState.vue'
import BuildMethodFields from '@/components/application/BuildMethodFields.vue'
import BuildAdvancedOptions from '@/components/application/BuildAdvancedOptions.vue'
import BuildPlatformConfirmation from '@/components/application/BuildPlatformConfirmation.vue'
import type { AppConfig, Registry } from '@/types'
import { buildDraft, type BuildDraft } from '@/types/build'
import { gitMaterialsOf } from '@/utils/gitMaterials'
import { notifySetupChanged } from '@/utils/appEvents'
import { validateBuildConfig } from '@/utils/pipelineBuild'
import { customPlatformsOf, normalizeBuildConfig } from '@/utils/buildOptions'

const route = useRoute()
const router = useRouter()
const appId = computed(() => String(route.params.appId ?? ''))
const config = ref<AppConfig | null>(null)
const registries = ref<Registry[]>([])
const form = ref<BuildDraft>(buildDraft(null))
const saved = shallowRef('')
const errors = ref<Record<string, string>>({})
const loading = shallowRef(true)
const saving = shallowRef(false)
const buildBlocked = shallowRef(false)
const error = shallowRef('')
const conflict = shallowRef(false)
const platformConfirmation = shallowRef(false)
const customPlatforms = computed(() => customPlatformsOf(form.value))
const materials = computed(() => gitMaterialsOf(config.value))
const dirty = computed(() => JSON.stringify(form.value) !== saved.value)
const registryOptions = computed(() => registries.value.map((item) => ({ label: item.name, value: item.id })))
const currentRegistry = computed(() => registries.value.find((item) => item.id === form.value.registryId))
const imagePreview = computed(() => {
  const endpoint = (currentRegistry.value?.endpoint ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '')
  return [endpoint, form.value.imageRepository.trim()].filter(Boolean).join('/')
})
let generation = 0

async function load() {
  const current = ++generation
  const id = appId.value
  loading.value = true
  error.value = ''
  conflict.value = false
  errors.value = {}
  platformConfirmation.value = false
  try {
    const [cfg, registryList] = await Promise.all([getConfig(id), listRegistries()])
    if (current !== generation) return
    config.value = cfg
    registries.value = registryList
    form.value = buildDraft(cfg.buildConfig, gitMaterialsOf(cfg)[0]?.id)
    if (!form.value.registryId) form.value.registryId = registryList[0]?.id ?? ''
    saved.value = cfg.buildConfig ? JSON.stringify(form.value) : ''
  } catch (err) {
    if (current === generation) error.value = err instanceof Error ? err.message : '构建配置加载失败'
  } finally { if (current === generation) loading.value = false }
}

function validate() {
  const next = validateBuildConfig(form.value, materials.value)
  errors.value = next
  return Object.keys(next).length === 0
}
async function save(confirmed = false) {
  if (!config.value || saving.value || buildBlocked.value || !validate()) return
  if (customPlatforms.value.length && confirmed !== true) { platformConfirmation.value = true; return }
  platformConfirmation.value = false
  const current = generation
  const id = appId.value
  saving.value = true
  conflict.value = false
  try {
    const payload = normalizeBuildConfig(form.value)
    const updated = await saveConfig(id, { section: 'build', expectedVersion: config.value.version, buildConfig: payload })
    if (current !== generation) return
    config.value = updated
    form.value = buildDraft(updated.buildConfig, materials.value[0]?.id)
    saved.value = JSON.stringify(form.value)
    MessagePlugin.success('构建配置已保存')
    notifySetupChanged(id)
  } catch (err) {
    if (current !== generation) return
    if (err instanceof MockError && err.code === 'revision_conflict') conflict.value = true
    else MessagePlugin.error(err instanceof Error ? err.message : '保存失败')
  } finally { saving.value = false }
}
function openWorkflow() { void router.push({ name: 'config-workflow', params: { projectId: route.params.projectId, appId: appId.value } }) }
watch(appId, load, { immediate: true })
</script>

<template>
  <div class="build-page">
    <div class="build-page__body">
      <header class="build-page__head"><h1>构建配置</h1></header>
      <t-alert v-if="conflict" theme="warning" title="配置已被他人更新" message="当前表单保留你的输入；请重新读取最新配置。" class="build-page__alert"><template #operation><t-button variant="text" @click="load">重新读取</t-button></template></t-alert>
      <div v-if="loading" class="build-page__state"><t-loading size="small" text="加载中…" /></div>
      <ErrorState v-else-if="error" :message="error" @retry="load" />
      <template v-else>
        <t-alert v-if="!registries.length" theme="warning" title="尚未接入镜像仓库" message="请先在平台设置中登记镜像仓库。" class="build-page__alert" />
        <t-alert v-if="Object.keys(errors).length" theme="error" :message="Object.values(errors)[0]" class="build-page__alert" />
        <section class="build-card">
          <h2 class="build-card__title">存储容器镜像</h2>
          <div class="build-grid">
            <label class="build-field"><span>镜像仓库 <em>*</em></span><t-select v-model="form.registryId" :options="registryOptions" :disabled="saving" placeholder="选择镜像仓库" /><span v-if="errors.registryId" class="field-error">{{ errors.registryId }}</span></label>
            <label class="build-field"><span>镜像 Repository <em>*</em></span><t-input v-model="form.imageRepository" name="imageRepository" :disabled="saving" placeholder="acme/checkout-api" /><span v-if="errors.imageRepository" class="field-error">{{ errors.imageRepository }}</span><span v-else class="build-field__hint">{{ imagePreview }}</span></label>
          </div>
          <div class="build-info"><t-icon name="info-circle-filled" size="16px" /><span>镜像仓库与 Dockerfile 位置可以在构建流水线中覆盖。<button type="button" @click="openWorkflow">前往配置</button></span></div>
        </section>
        <BuildMethodFields v-model="form" :saved-config="config?.buildConfig" :materials="materials" :errors="errors" :disabled="saving" @blocked="buildBlocked = $event"><BuildAdvancedOptions v-model="form" :errors="errors" :disabled="saving" /></BuildMethodFields>
      </template>
    </div>
    <footer v-if="!loading && !error" class="build-page__foot"><span class="build-page__meta">{{ dirty ? '有未保存的修改' : '' }}</span><t-button theme="primary" :loading="saving" :disabled="buildBlocked || !registries.length || !materials.length || !dirty" @click="save()">保存配置</t-button></footer>
    <BuildPlatformConfirmation :visible="platformConfirmation" :platforms="customPlatforms" :loading="saving" @cancel="platformConfirmation = false" @confirm="save(true)" />
  </div>
</template>

<style scoped>
.build-page{display:flex;flex:1;flex-direction:column;min-height:100%;background:#f2f4f7}.build-page__body{width:100%;max-width:1012px;box-sizing:border-box;margin:0 auto;padding:24px}.build-page__head{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}.build-page__head h1{margin:0;color:#000a14;font-size:18px;font-weight:400;line-height:26px}.build-page__state{display:flex;justify-content:center;padding:80px 0}.build-page__alert{margin-bottom:16px}.build-card{padding:16px;margin-bottom:12px;background:#fff;border:1px solid #d0d4d9;border-radius:8px}.build-card__title{margin:0 0 16px;color:#3b444c;font-size:14px;font-weight:500}.build-grid{display:grid;grid-template-columns:250px minmax(0,1fr);gap:16px}.build-field{display:flex;flex-direction:column;gap:8px;font-size:13px;color:#3b444c}.build-field em{font-style:normal;color:#f33e3e}.build-field__hint{color:#767d84;font-size:11px;overflow-wrap:anywhere}.field-error{font-size:12px;color:#d54941}.build-info{display:flex;align-items:center;gap:8px;margin-top:16px;padding:8px 12px;color:#3b444c;font-size:12px;line-height:20px;background:#e7f2ff;border:1px solid #9bc9ff;border-radius:4px}.build-info>.t-icon{flex:none;color:#0066cc}.build-info button{padding:0 0 0 4px;font:inherit;color:#0066cc;border:0;background:none;cursor:pointer}.build-page__foot{display:flex;align-items:center;justify-content:space-between;position:sticky;bottom:0;z-index:2;gap:16px;margin-top:auto;padding:12px 20px;background:#fff;border-top:1px solid #d0d4d9}.build-page__meta{font-size:12px;color:#767d84}@media(max-width:1100px){.build-grid{grid-template-columns:200px minmax(0,1fr)}}@media(max-width:900px){.build-grid{grid-template-columns:minmax(0,1fr)}}
</style>
