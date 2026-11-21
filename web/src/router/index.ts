import { createRouter, createWebHistory } from 'vue-router'

import { useSessionStore } from '@/stores/session'
import routes from './routes'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach((to) => {
  const session = useSessionStore()

  if (to.meta.public) {
    if (to.name === 'login' && session.isLogin) return { path: '/' }
    return true
  }

  if (!session.isLogin) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  if (!session.user && session.token) {
    void session.loadMe().catch(() => session.logout())
  }

  return true
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · Podry` : 'Podry'
})

export default router
