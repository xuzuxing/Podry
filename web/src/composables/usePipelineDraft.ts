import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'

/** 抽屉关闭和路由跳转共享一次待确认操作，保存成功后由调用方更新基线。 */
export function usePipelineDraft(options: { visible: () => boolean; saving: Ref<boolean>; snapshot: () => string; close: () => void }) {
  const baseline = ref('')
  const discardVisible = ref(false)
  const dirty = computed(() => options.visible() && Boolean(baseline.value) && options.snapshot() !== baseline.value)
  let pending: ((value: boolean) => void) | undefined
  function markClean(): void { baseline.value = options.snapshot() }
  function guard(): boolean | Promise<boolean> {
    if (!options.visible()) return true
    if (options.saving.value) return false
    if (!dirty.value) return true
    if (pending) return false
    discardVisible.value = true
    return new Promise(resolve => { pending = resolve })
  }
  function resolveDiscard(value: boolean): void {
    discardVisible.value = false
    if (value) markClean()
    const resolve = pending; pending = undefined; resolve?.(value)
  }
  async function requestClose(): Promise<void> {
    if (await guard()) options.close()
  }
  async function routeGuard(): Promise<boolean> {
    if (!options.visible()) return true
    if (!await guard()) return false
    options.close()
    return true
  }
  onBeforeRouteLeave(routeGuard)
  onBeforeRouteUpdate((to, from) => to.fullPath === from.fullPath ? true : routeGuard())
  function beforeUnload(event: BeforeUnloadEvent): void {
    if (dirty.value) { event.preventDefault(); event.returnValue = '' }
  }
  onMounted(() => window.addEventListener('beforeunload', beforeUnload))
  onBeforeUnmount(() => { window.removeEventListener('beforeunload', beforeUnload); pending?.(false) })
  return { dirty, discardVisible, markClean, resolveDiscard, requestClose }
}
