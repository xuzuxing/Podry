<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useSessionStore } from '@/stores/session'

const router = useRouter()
const route = useRoute()
const session = useSessionStore()

const email = ref('admin@acme.dev')
const password = ref('podry')
const error = ref('')
const loading = ref(false)

async function submit(): Promise<void> {
  if (!email.value.trim() || !password.value.trim()) {
    error.value = '请输入邮箱与密码'
    return
  }
  loading.value = true
  error.value = ''
  try {
    await session.login(email.value, password.value)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
    await router.replace(redirect)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '登录失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login">
    <section class="login__aside">
      <div class="login__brand">
        <span class="login__logo">P</span>
        <span>Podry</span>
      </div>
      <h1 class="login__slogan">从代码到环境，<br />一条可追溯的交付链路。</h1>
      <ul class="login__points">
        <li><t-icon name="check-circle" /> 固定提交与配置版本的构建记录</li>
        <li><t-icon name="check-circle" /> 按环境绑定发布，digest 与快照可查</li>
        <li><t-icon name="check-circle" /> 应用资源与集群资源同一套详情</li>
      </ul>
      <p class="login__note">当前为静态演示：所有数据来自本地 mock，不会连接真实集群。</p>
    </section>

    <section class="login__panel">
      <div class="login__card">
        <h2 class="login__title">登录</h2>
        <p class="login__desc">使用团队账号进入交付工作台</p>

        <t-alert v-if="error" theme="error" :message="error" class="login__alert" />

        <label class="login__field">
          <span>邮箱</span>
          <t-input v-model="email" placeholder="you@company.dev" size="large" />
        </label>
        <label class="login__field">
          <span>密码</span>
          <t-input v-model="password" type="password" placeholder="输入密码" size="large" @enter="submit" />
        </label>

        <t-button theme="primary" size="large" block :loading="loading" @click="submit">进入工作台</t-button>
        <p class="login__hint">演示账号 admin@acme.dev，密码任意（静态 mock 校验）。</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.login {
  display: flex;
  height: 100vh;
  background: var(--tk-bg);
}
.login__aside {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 20px;
  width: 52%;
  padding: 0 64px;
  color: #eaf1ff;
  background:
    radial-gradient(1200px 400px at 10% 10%, rgba(0, 82, 217, 0.55), transparent 60%),
    linear-gradient(150deg, #0b1a33 0%, #10233f 55%, #0a1526 100%);
}
.login__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 600;
}
.login__logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  color: #fff;
  background: #2f7bff;
  border-radius: 3px;
}
.login__slogan {
  font-size: 30px;
  line-height: 42px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.login__points {
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: #b9cbe8;
}
.login__points li {
  display: flex;
  align-items: center;
  gap: 8px;
}
.login__note {
  margin: 8px 0 0;
  color: #7f95b8;
  font-size: 11px;
}
.login__panel {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
}
.login__card {
  width: 340px;
  padding: 28px;
  background: var(--tk-surface);
  border: 1px solid var(--tk-border);
  border-radius: var(--tk-radius);
}
.login__title {
  font-size: 18px;
}
.login__desc {
  margin: 4px 0 18px;
  color: var(--tk-text-2);
}
.login__alert {
  margin-bottom: 12px;
}
.login__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
  color: var(--tk-text-2);
}
.login__hint {
  margin: 12px 0 0;
  color: var(--tk-text-3);
  font-size: 11px;
  text-align: center;
}
</style>
