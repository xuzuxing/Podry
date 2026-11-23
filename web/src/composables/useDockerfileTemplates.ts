import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { getDockerfileTemplate, listDockerfileTemplates } from '@/api'
import type { BuildConfig } from '@/types'
import type { BuildDraft } from '@/types/build'
import { dockerfileTemplateKey, type DockerfileTemplate } from '@/types/dockerfile'

type TemplateLoader = {
  list: typeof listDockerfileTemplates
  get: typeof getDockerfileTemplate
}

export function useDockerfileTemplates(options: {
  draft: () => BuildDraft
  saved: () => BuildConfig | null | undefined
  readonly: () => boolean
  update: (value: BuildDraft) => void
}, loader: TemplateLoader = { list: listDockerfileTemplates, get: getDockerfileTemplate }) {
  const catalog = shallowRef<DockerfileTemplate[]>([])
  const catalogLoading = shallowRef(false)
  const contentLoading = shallowRef(false)
  const catalogError = shallowRef('')
  const contentError = shallowRef('')
  const selection = shallowRef({ language: options.draft().dockerfileLanguage, framework: options.draft().dockerfileFramework })
  const cache = shallowRef(new Map<string, string>())
  const customBaseline = shallowRef(options.draft().dockerfileContent)
  let generation = 0
  let catalogGeneration = 0
  let disposed = false
  const key = computed(() => dockerfileTemplateKey(selection.value.language, selection.value.framework))
  const baseline = computed(() => cache.value.get(key.value) ?? customBaseline.value)
  const modified = computed(() => options.draft().dockerfileContent !== baseline.value)
  const blocked = computed(() => !options.readonly() && (catalogLoading.value || contentLoading.value || Boolean(contentError.value)))
  const languages = computed(() => [...new Set([...catalog.value.map(item => item.language), selection.value.language])].filter(Boolean).map(value => ({ label: value, value })))
  const frameworks = computed(() => [...new Set([...catalog.value.filter(item => item.language === selection.value.language).map(item => item.framework), selection.value.framework])].filter(Boolean).map(value => ({ label: value, value })))
  const unavailable = computed(() => Boolean(selection.value.language) && !catalogLoading.value && !catalogError.value && !catalog.value.some(item => item.language === selection.value.language && item.framework === selection.value.framework))

  function remember(language: string, framework: string, content: string) {
    cache.value = new Map(cache.value).set(dockerfileTemplateKey(language, framework), content)
  }
  function syncSaved() {
    const draft = options.draft()
    const saved = options.saved()
    if (saved?.dockerfileContent && saved.dockerfileLanguage) remember(saved.dockerfileLanguage, saved.dockerfileFramework ?? '', saved.dockerfileContent)
    if (draft.dockerfileContent && draft.dockerfileLanguage && !cache.value.has(dockerfileTemplateKey(draft.dockerfileLanguage, draft.dockerfileFramework))) remember(draft.dockerfileLanguage, draft.dockerfileFramework, draft.dockerfileContent)
    customBaseline.value = saved?.dockerfileContent ?? draft.dockerfileContent
    restore()
  }
  watch(options.saved, syncSaved, { immediate: true })

  async function select(language: string, framework: string) {
    if (options.readonly() || disposed) return
    const current = ++generation
    selection.value = { language, framework }
    contentError.value = ''
    const templateKey = dockerfileTemplateKey(language, framework)
    const cached = cache.value.get(templateKey)
    if (cached !== undefined) {
      contentLoading.value = false
      options.update({ ...options.draft(), dockerfileLanguage: language, dockerfileFramework: framework, dockerfileContent: cached })
      return
    }
    const template = catalog.value.find(item => item.language === language && item.framework === framework)
    if (!template) { contentLoading.value = false; contentError.value = '模板已不在当前目录中，请返回当前内容或重新选择'; return }
    contentLoading.value = true
    try {
      const result = await loader.get(template.id)
      if (disposed || current !== generation || options.readonly()) return
      remember(language, framework, result.content)
      // 只替换模板字段；等待期间的仓库、参数或上下文更改继续保留。
      options.update({ ...options.draft(), dockerfileLanguage: language, dockerfileFramework: framework, dockerfileContent: result.content })
    } catch (error) {
      if (!disposed && current === generation) contentError.value = error instanceof Error ? error.message : '模板读取失败'
    } finally { if (!disposed && current === generation) contentLoading.value = false }
  }
  async function loadCatalog() {
    const current = ++catalogGeneration
    catalogLoading.value = true
    catalogError.value = ''
    try {
      const result = await loader.list()
      if (disposed || current !== catalogGeneration) return
      catalog.value = result
      const draft = options.draft()
      if (!draft.dockerfileContent && !draft.dockerfileLanguage && result[0] && !options.readonly()) await select(result[0].language, result[0].framework)
    } catch (error) {
      if (!disposed && current === catalogGeneration) catalogError.value = error instanceof Error ? error.message : '模板目录加载失败'
    } finally { if (!disposed && current === catalogGeneration) catalogLoading.value = false }
  }
  function selectLanguage(language: string) {
    const first = catalog.value.find(item => item.language === language)
    return select(language, first?.framework ?? '')
  }
  function reset() {
    if (options.readonly() || blocked.value) return
    options.update({ ...options.draft(), dockerfileContent: baseline.value })
  }
  function restore() {
    ++generation
    contentLoading.value = false
    contentError.value = ''
    selection.value = { language: options.draft().dockerfileLanguage, framework: options.draft().dockerfileFramework }
  }
  watch(options.readonly, readonly => { if (readonly) restore() })
  watch([() => options.draft().dockerfileLanguage, () => options.draft().dockerfileFramework], ([language, framework]) => {
    if (language !== selection.value.language || framework !== selection.value.framework) restore()
  })
  onScopeDispose(() => { disposed = true; ++generation; ++catalogGeneration })
  void loadCatalog()
  return { catalog, catalogLoading, contentLoading, catalogError, contentError, selection, languages, frameworks, unavailable, baseline, modified, blocked, loadCatalog, selectLanguage, select, reset, restore }
}
