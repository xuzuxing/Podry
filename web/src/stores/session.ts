import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { getMe, login as loginApi } from '@/api'
import type { User } from '@/types'

export const useSessionStore = defineStore(
  'session',
  () => {
    const token = ref('')
    const user = ref<User | null>(null)
    const isLogin = computed(() => Boolean(token.value))

    async function login(email: string, _password: string): Promise<void> {
      const res = await loginApi(email)
      token.value = res.token
      user.value = res.user
    }

    async function loadMe(): Promise<void> {
      if (!token.value) return
      user.value = await getMe()
    }

    function logout(): void {
      token.value = ''
      user.value = null
    }

    return { token, user, isLogin, login, loadMe, logout }
  },
  { persist: { key: 'podry:session', pick: ['token', 'user'] } },
)
