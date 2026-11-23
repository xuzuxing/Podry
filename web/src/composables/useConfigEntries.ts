import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import type { LocationQueryRaw } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'
import { stringify } from 'yaml'
import { deleteConfigMap, deleteSecret, listBindings, listConfigMaps, listSecrets, saveConfigMap, saveSecret } from '@/api'
import { configEntryItems, effectiveEntries, entryData, entryOptions, parseEntryData } from '@/utils/configEntries'
import type { ConfigEntry, ConfigEntryKind } from '@/utils/configEntries'
import type { ConfigEntryOptions } from '@/types'

export interface ConfigEntryDraft extends Required<ConfigEntryOptions> { name: string; yaml: string }
export function useConfigEntries(kind: () => ConfigEntryKind) {
  const route = useRoute()
  const router = useRouter()
  let internalNavigation = false
  async function replaceQuery(query: LocationQueryRaw): Promise<void> {
    internalNavigation = true
    try { await router.replace({ query }) } finally { internalNavigation = false }
  }
  const appId = computed(() => String(route.params.appId ?? ''))
  const scopeEnv = computed(() => String(route.params.envId ?? '') || null)
  const isOverride = computed(() => !!scopeEnv.value)
  const isSecret = computed(() => kind() === 'secrets')
  const label = computed(() => isSecret.value ? 'Secret' : 'ConfigMap')
  const loading = shallowRef(true)
  const error = shallowRef('')
  const base = ref<ConfigEntry[]>([])
  const own = ref<ConfigEntry[]>([])
  const selected = shallowRef('')
  const creating = shallowRef(false)
  const overriding = shallowRef(false)
  const saving = shallowRef(false)
  const formError = shallowRef('')
  const deleteVisible = shallowRef(false)
  const discardVisible = shallowRef(false)
  const merged = shallowRef(false)
  const mode = shallowRef<'gui' | 'yaml'>('gui')
  const draft = ref<ConfigEntryDraft>({ name: '', yaml: '{}\n', ...entryOptions() })
  const original = shallowRef('')
  const draftRevision = shallowRef(0)
  const items = computed(() => configEntryItems(base.value, own.value, isOverride.value))
  const current = computed(() => items.value.find((item) => item.name === selected.value))
  const tab = computed(() => route.query.headerTab === 'inherited' ? 'inherited' : route.query.headerTab === 'dry-run' ? 'dry-run' : 'values')
  const dirty = computed(() => JSON.stringify(draft.value) !== original.value)
  const enabled = computed(() => creating.value || !!current.value?.own || overriding.value)
  const readonly = computed(() => tab.value !== 'values' || !enabled.value || merged.value)
  const parsed = computed(() => parseEntryData(draft.value.yaml))
  const validation = computed(() => {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(draft.value.name)) return '名称需为 1–63 位小写字母、数字或连字符，首尾为字母或数字'
    if (parsed.value.error) return isSecret.value ? 'Secret 数据格式无效，请显示/编辑值并修正 YAML。' : parsed.value.error
    if (draft.value.source === 'create' && !Object.keys(parsed.value.data).length && !(isOverride.value && current.value?.base && draft.value.mergeStrategy === 'patch')) return '至少需要一个 key'
    if (draft.value.mountAs === 'volume') {
      if (!draft.value.mountPath.startsWith('/') || draft.value.mountPath.includes('..')) return '请填写绝对挂载路径，不能包含 ..'
      if (draft.value.fileMode && !/^0?[0-7]{3}$/.test(draft.value.fileMode)) return '文件权限需为 000–777 八进制，例如 0644'
      if (draft.value.source === 'external' && draft.value.subPath && !Object.keys(parsed.value.data).length) return '使用 subPath 时请至少指定一个已有资源的 key'
    }
    return ''
  })
  function resetDraft(): void {
    draftRevision.value++
    const item = current.value?.own ?? current.value?.base
    draft.value = { name: item?.name ?? '', yaml: item && 'data' in item ? item.dataYaml ?? stringify(item.data) : stringify(entryData(item)), ...entryOptions(item) }
    original.value = JSON.stringify(draft.value)
    overriding.value = false; merged.value = false; formError.value = ''
  }
  let generation = 0
  async function load(): Promise<void> {
    const token = ++generation
    loading.value = true; error.value = ''
    try {
      const list = isSecret.value ? listSecrets : listConfigMaps
      const [inherited, local, bindings] = await Promise.all([isOverride.value ? list(appId.value, null) : Promise.resolve([]), list(appId.value, scopeEnv.value), listBindings(appId.value)])
      if (token !== generation) return
      if (isOverride.value && !bindings.some((item) => item.environmentId === scopeEnv.value)) throw new Error('该应用尚未绑定此环境')
      base.value = inherited; own.value = local
      creating.value = route.query.create === '1'
      selected.value = typeof route.query.entry === 'string' && items.value.some((item) => item.name === route.query.entry) ? route.query.entry : items.value[0]?.name ?? ''
      resetDraft()
      if (creating.value) { selected.value = ''; resetDraft() }
      if (isOverride.value && current.value?.base && !current.value.own && !route.query.headerTab && !creating.value) await replaceQuery({ ...route.query, headerTab: 'inherited' })
    } catch (err) { if (token === generation) error.value = err instanceof Error ? err.message : '配置加载失败' }
    finally { if (token === generation) loading.value = false }
  }
  async function select(name: string, create = false): Promise<void> {
    if (dirty.value) { pendingSelection = { name, create }; discardVisible.value = true; return }
    await applySelection(name, create)
  }
  async function applySelection(name: string, create: boolean): Promise<void> {
    selected.value = name; creating.value = create
    resetDraft()
    await replaceQuery({ ...route.query, entry: name || undefined, create: create ? '1' : undefined, headerTab: 'values' })
  }
  let pendingSelection: { name: string; create: boolean } | undefined
  let resolveLeave: ((result: boolean) => void) | undefined
  function discard(confirmed: boolean): void {
    discardVisible.value = false
    if (confirmed) {
      if (creating.value) {
        creating.value = false; selected.value = items.value[0]?.name ?? ''
        if (!resolveLeave && !pendingSelection) void replaceQuery({ ...route.query, create: undefined, entry: selected.value || undefined })
      }
      resetDraft()
      if (pendingSelection) void applySelection(pendingSelection.name, pendingSelection.create)
    }
    pendingSelection = undefined
    resolveLeave?.(confirmed); resolveLeave = undefined
  }
  function guard(): boolean | Promise<boolean> {
    if (saving.value) return false
    if (!dirty.value) return true
    discardVisible.value = true
    return new Promise((resolve) => { resolveLeave = resolve })
  }
  onBeforeRouteLeave(guard)
  onBeforeRouteUpdate((to, from) => internalNavigation ? true : to.path !== from.path || to.query.entry !== from.query.entry || to.query.create !== from.query.create ? guard() : true)
  function selectTab(value: string): void {
    merged.value = false
    void replaceQuery({ ...route.query, headerTab: value })
  }
  function createOverride(): void {
    draftRevision.value++
    overriding.value = true
    draft.value.mergeStrategy = 'patch'
    draft.value.yaml = '{}\n'
    merged.value = false
  }
  const preview = computed<ConfigEntry | undefined>(() => {
    if (tab.value === 'inherited') return current.value?.base
    if (!enabled.value) return current.value?.base
    const metadata = { ...entryOptions(draft.value), name: draft.value.name, id: current.value?.own?.id ?? 'draft', appId: appId.value, environmentId: scopeEnv.value, updatedAt: '' }
    const entry = isSecret.value ? { ...metadata, keys: Object.keys(parsed.value.data) } : { ...metadata, data: parsed.value.data }
    const inherited = current.value?.base
    return inherited && isOverride.value ? effectiveEntries([inherited], [entry])[0] : entry
  })
  const displayEntry = computed(() => tab.value === 'inherited' ? current.value?.base : merged.value || tab.value === 'dry-run' ? preview.value : undefined)
  const displayDraft = computed<ConfigEntryDraft>(() => displayEntry.value
    ? { ...entryOptions(displayEntry.value), name: displayEntry.value.name, yaml: stringify(entryData(displayEntry.value)) }
    : isOverride.value && current.value?.base && draft.value.mergeStrategy === 'patch'
      ? { ...draft.value, ...entryOptions(current.value.base), mergeStrategy: 'patch' }
      : draft.value)
  const manifest = computed(() => {
    const entry = preview.value
    if (!entry) return ''
    if (entry.source === 'external') return '# 使用命名空间中已存在的资源；不创建新的清单。\n' + stringify({ name: entry.name, mountAs: entry.mountAs ?? 'env', mountPath: entry.mountPath || undefined, subPath: entry.subPath || undefined })
    return stringify({ apiVersion: 'v1', kind: label.value, metadata: { name: entry.name }, ...(isSecret.value ? { type: 'Opaque', stringData: entryData(entry) } : { data: entryData(entry) }) })
  })
  async function save(): Promise<void> {
    if (validation.value || saving.value) return
    saving.value = true; formError.value = ''
    try {
      const input = { ...entryOptions(draft.value), id: creating.value ? undefined : current.value?.own?.id, appId: appId.value, environmentId: scopeEnv.value, name: draft.value.name }
      const saved = isSecret.value ? await saveSecret({ ...input, keys: Object.keys(parsed.value.data) }) : await saveConfigMap({ ...input, data: parsed.value.data, dataYaml: draft.value.yaml })
      const index = own.value.findIndex((item) => item.id === saved.id)
      if (index < 0) own.value.push(saved); else own.value[index] = saved
      creating.value = false; selected.value = saved.name; resetDraft()
      await replaceQuery({ ...route.query, entry: saved.name, create: undefined })
      MessagePlugin.success(`${label.value} 已保存`)
    } catch (err) { formError.value = err instanceof Error ? err.message : '保存失败' }
    finally { saving.value = false }
  }
  async function remove(): Promise<void> {
    const item = current.value?.own
    if (!item || saving.value) return
    saving.value = true; formError.value = ''
    try {
      await (isSecret.value ? deleteSecret : deleteConfigMap)(item.id)
      own.value = own.value.filter((entry) => entry.id !== item.id)
      if (!items.value.some((entry) => entry.name === selected.value)) selected.value = items.value[0]?.name ?? ''
      resetDraft(); deleteVisible.value = false
      await replaceQuery({ ...route.query, entry: selected.value || undefined, create: undefined })
      MessagePlugin.success(isOverride.value && current.value?.base ? '覆盖已删除，恢复继承' : `${label.value} 已删除`)
    } catch (err) { formError.value = err instanceof Error ? err.message : '删除失败' }
    finally { saving.value = false }
  }
  function beforeUnload(event: BeforeUnloadEvent): void { if (dirty.value) { event.preventDefault(); event.returnValue = '' } }
  onMounted(() => window.addEventListener('beforeunload', beforeUnload))
  onBeforeUnmount(() => { ++generation; window.removeEventListener('beforeunload', beforeUnload); resolveLeave?.(false) })
  watch([appId, scopeEnv, kind], () => void load(), { immediate: true })
  watch(() => [route.query.entry, route.query.create], ([name, create]) => {
    if (loading.value) return
    const newEntry = create === '1'
    const wanted = typeof name === 'string' && items.value.some((item) => item.name === name) ? name : newEntry ? '' : items.value[0]?.name ?? ''
    if (wanted !== selected.value || newEntry !== creating.value) { selected.value = wanted; creating.value = newEntry; resetDraft() }
  })
  return { label, isSecret, isOverride, items, current, selected, creating, overriding, loading, error, saving, formError, deleteVisible, discardVisible, merged, mode, draft, draftRevision, displayDraft, dirty, enabled, readonly, validation, tab, manifest, load, select, selectTab, createOverride, save, remove, discard }
}
