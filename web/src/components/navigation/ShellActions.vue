<script setup lang="ts">
import { useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'
import { useSessionStore } from '@/stores/session'
const router = useRouter()
const session = useSessionStore()
function help(value: string): void {
  void MessagePlugin.info(value === 'keys' ? 'Ctrl/⌘ + K 全局搜索，/ 搜索当前列表，K 跳转资源类型，Esc 关闭弹层。' : value === 'about' ? 'Podry · Vue 3 + TDesign · 本地 Mock' : '项目使用说明见 web/README.md')
}
function logout(): void { session.logout(); void router.push('/login') }
</script>
<template>
  <div class="shell-actions">
    <t-dropdown trigger="click" :options="[{ content: '帮助文档', value: 'docs' }, { content: '键盘快捷键', value: 'keys' }, { content: '关于 Podry', value: 'about' }]" @click="help(String($event.value))">
      <t-button variant="text" size="small"><template #icon><t-icon name="help-circle" size="18px" /></template>帮助<t-icon name="chevron-down" size="12px" /></t-button>
    </t-dropdown>
    <t-dropdown trigger="click" :options="[{ content: session.user?.name ?? '用户', value: 'profile', disabled: true }, { content: '退出登录', value: 'logout' }]" @click="$event.value === 'logout' && logout()">
      <button class="shell-user" aria-label="用户菜单"><span>{{ session.user?.name?.slice(0, 1) ?? 'U' }}</span><t-icon name="chevron-down" size="12px" /></button>
    </t-dropdown>
  </div>
</template>
<style scoped>
.shell-actions{display:flex;align-items:center;gap:12px;flex:none}.shell-user{display:flex;align-items:center;gap:8px;padding:3px 8px;background:#f5f7fa;border:1px solid var(--tk-border);border-radius:20px;cursor:pointer}.shell-user span{display:grid;place-items:center;width:24px;height:24px;background:#ca333a;color:#fff;border-radius:50%;font-size:12px}
</style>
