import { computed, ref, shallowRef, watch, type Ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { getConfig, listCredentials, MockError, saveConfig } from '@/api'
import type { AppConfig, Credential, GitMaterial } from '@/types'
import { gitMaterialsOf } from '@/utils/gitMaterials'
import { notifySetupChanged } from '@/utils/appEvents'

export function useGitRepositories(appId: Ref<string>) {
  const config = ref<AppConfig | null>(null)
  const credentials = ref<Credential[]>([])
  const loading = shallowRef(true)
  const saving = shallowRef(false)
  const error = shallowRef('')
  const conflict = shallowRef(false)
  const newFormKey = shallowRef(0)
  const deleteTarget = ref<GitMaterial | null>(null)
  const materials = computed(() => gitMaterialsOf(config.value))
  let generation = 0

  async function load() {
    const current = ++generation
    const id = appId.value
    loading.value = true
    error.value = ''
    conflict.value = false
    deleteTarget.value = null
    try {
      const [cfg, creds] = await Promise.all([getConfig(id), listCredentials()])
      if (current !== generation) return
      config.value = cfg
      credentials.value = creds.filter((item) => item.kind === 'git')
      newFormKey.value++
    } catch (err) {
      if (current === generation) error.value = err instanceof Error ? err.message : 'Git 仓库加载失败'
    } finally {
      if (current === generation) loading.value = false
    }
  }

  async function persist(next: GitMaterial[]) {
    if (!config.value || saving.value) return false
    const id = appId.value
    const current = generation
    saving.value = true
    conflict.value = false
    try {
      const updated = await saveConfig(id, { section: 'git', expectedVersion: config.value.version, gitMaterials: next })
      if (current !== generation) return false
      config.value = updated
      notifySetupChanged(id)
      return true
    } catch (err) {
      if (current !== generation) return false
      if (err instanceof MockError && err.code === 'revision_conflict') conflict.value = true
      else MessagePlugin.error(err instanceof Error ? err.message : '保存失败')
      return false
    } finally { saving.value = false }
  }

  async function save(material: GitMaterial) {
    const exists = materials.value.some((item) => item.id === material.id)
    const next = exists ? materials.value.map((item) => item.id === material.id ? material : item) : [...materials.value, material]
    if (await persist(next)) {
      if (!exists) newFormKey.value++
      MessagePlugin.success('Git 仓库已保存')
    }
  }

  async function remove() {
    if (!deleteTarget.value || materials.value.length <= 1) return
    if (await persist(materials.value.filter((item) => item.id !== deleteTarget.value?.id))) {
      deleteTarget.value = null
      MessagePlugin.success('Git 仓库已删除')
    }
  }

  watch(appId, load, { immediate: true })
  return { config, credentials, materials, loading, saving, error, conflict, newFormKey, deleteTarget, load, save, remove }
}
