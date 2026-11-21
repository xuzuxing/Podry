import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useUiStore = defineStore(
  'ui',
  () => {
    const siderCollapsed = ref(false)
    const sidebarProjectsOpen = ref(true)

    function toggleSider(): void {
      siderCollapsed.value = !siderCollapsed.value
    }

    return { siderCollapsed, sidebarProjectsOpen, toggleSider }
  },
  { persist: { key: 'podry:ui', pick: ['siderCollapsed'] } },
)
