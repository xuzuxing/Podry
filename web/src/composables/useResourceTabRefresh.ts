import { computed, ref } from 'vue'

interface ResourcePanel {
  requestLeave: () => boolean | Promise<boolean>
  reload: () => Promise<void>
}

/** 页签刷新继续复用 Manifest 的草稿确认，只记录实际完成读取的同步时间。 */
export function useResourceTabRefresh(panel: () => ResourcePanel | null, activeId: () => string) {
  const pending = ref('')
  const syncTimes = ref<Record<string, number>>({})
  const refreshing = computed(() => !!activeId() && pending.value === activeId())
  const syncedAt = computed(() => syncTimes.value[activeId()] ?? 0)
  function synced(): void { if (activeId()) syncTimes.value[activeId()] = Date.now() }
  async function refresh(): Promise<void> {
    const target = panel(), id = activeId()
    if (!target || !id || pending.value) return
    pending.value = id
    try {
      if (!(await target.requestLeave()) || panel() !== target || activeId() !== id) return
      await target.reload()
    } finally { if (pending.value === id) pending.value = '' }
  }
  return { refreshing, syncedAt, synced, refresh }
}
