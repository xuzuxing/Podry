import { computed, shallowRef, watch } from 'vue'
import { changeConfigData, readConfigData } from '@/utils/configEntryData'
import type { ConfigDataChange } from '@/utils/configEntryData'

export function useConfigDataTable(source: () => string, update: (value: string) => void) {
  let serial = 0
  let emitted: string | undefined
  const ids = shallowRef<number[]>([])
  const order = shallowRef<number[]>([])
  const descending = shallowRef(false)
  const mutationError = shallowRef('')
  const parsed = computed(() => readConfigData(source()))
  const rows = computed(() => parsed.value.rows.map((row, index) => ({ ...row, index, id: ids.value[index]! })))
  const displayed = computed(() => {
    const positions = new Map(order.value.map((id, index) => [id, index]))
    return [...rows.value].sort((a, b) => (positions.get(a.id) ?? 0) - (positions.get(b.id) ?? 0))
  })
  function sort(toggle = true): void {
    if (toggle) descending.value = !descending.value
    order.value = [...rows.value].sort((a, b) => (a.key.localeCompare(b.key, 'en', { numeric: true }) || a.index - b.index) * (descending.value ? -1 : 1)).map(row => row.id)
  }
  watch(source, value => {
    mutationError.value = ''
    if (value === emitted) { emitted = undefined; return }
    emitted = undefined
    ids.value = readConfigData(value).rows.map(() => ++serial)
    sort(false)
  }, { immediate: true, flush: 'sync' })
  function change(action: ConfigDataChange): void {
    let result: string
    try { result = changeConfigData(source(), action) }
    catch { mutationError.value = '该键仍被 YAML 别名引用，请先在 YAML 中调整引用。'; return }
    if (result === source()) return
    if (action.type === 'add') {
      const id = ++serial
      ids.value = [id, ...ids.value]; order.value = [id, ...order.value]
    } else if (action.type === 'remove') {
      const id = ids.value[action.index]
      ids.value = ids.value.filter((_, index) => index !== action.index)
      order.value = order.value.filter(item => item !== id)
    }
    emitted = result
    update(result)
  }
  return { parsed, displayed, descending, mutationError, sort, change }
}
