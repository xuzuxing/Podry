<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { MessagePlugin } from 'tdesign-vue-next'

import { closeExecSession, createExecSession, getCluster, listNamespace, listResources } from '@/api'
import type { ExecSession } from '@/api'
import type { Cluster } from '@/types'
import { fmtRelative } from '@/utils/format'

const route = useRoute()
const router = useRouter()

const cluster = ref<Cluster | null>(null)
const session = ref<ExecSession | null>(null)
const sessionError = ref('')
const lines = ref<string[]>([])
const input = ref('')
const history = ref<string[]>([])
const historyIndex = ref(-1)
const busy = ref(false)
const bodyRef = ref<HTMLElement | null>(null)

const clusterId = computed(() => String(route.params.clusterId ?? ''))
const prompt = computed(() => `${session.value?.sessionId?.slice(-4) ?? 'term'}:/#`)

function push(line = ''): void {
  lines.value.push(line)
  void nextTick(() => {
    if (bodyRef.value) bodyRef.value.scrollTop = bodyRef.value.scrollHeight
  })
}

async function connect(): Promise<void> {
  sessionError.value = ''
  try {
    session.value = await createExecSession(clusterId.value, { namespace: 'default', container: 'kubectl' })
    lines.value = []
    push(`已建立集群终端会话 ${session.value.sessionId}（30 分钟过期，静态演示）`)
    push('可用命令：help、kubectl get pods|nodes|namespaces|deployments、kubectl config current-context、clear、exit')
    push('')
  } catch (err) {
    sessionError.value = err instanceof Error ? err.message : '终端会话创建失败'
  }
}

async function disconnect(): Promise<void> {
  const current = session.value
  session.value = null
  if (!current) return
  try {
    await closeExecSession(current.sessionId)
  } catch {
    /* 已过期 */
  }
}

async function runCommand(command: string): Promise<void> {
  busy.value = true
  try {
    const [head, ...rest] = command.split(/\s+/)
    if (head === 'clear') {
      lines.value = []
      return
    }
    if (head === 'help') {
      push('支持的命令：')
      push('  kubectl get pods [-n <namespace>]   列出 Pod')
      push('  kubectl get deployments             列出 Deployment')
      push('  kubectl get nodes                   列出节点')
      push('  kubectl get namespaces              列出命名空间')
      push('  kubectl config current-context      当前上下文')
      push('  clear / exit                       清屏 / 断开会话')
      return
    }
    if (head === 'exit') {
      await disconnect()
      push('会话已关闭。')
      return
    }
    if (head !== 'kubectl') {
      push(`bash: ${head}: command not found`)
      return
    }
    const sub = rest.join(' ')
    if (sub.startsWith('config current-context')) {
      push(`kubernetes-admin@${cluster.value?.name ?? clusterId.value}`)
      return
    }
    if (sub.startsWith('get ')) {
      const parts = sub.split(/\s+/)
      const target = parts[1] ?? ''
      const nsFlag = parts.indexOf('-n')
      const namespace = nsFlag > -1 ? parts[nsFlag + 1] : undefined
      if (['ns', 'namespaces'].includes(target)) {
        const list = await listNamespace(clusterId.value)
        push('NAME'.padEnd(20) + 'STATUS'.padEnd(12) + 'AGE')
        list.forEach((item, index) => push(`${item.name.padEnd(20)}${item.phase.padEnd(12)}${index + 1}d`))
        return
      }
      const map: Record<string, { group: string; resource: string }> = {
        pods: { group: '', resource: 'pods' },
        pod: { group: '', resource: 'pods' },
        deployments: { group: 'apps', resource: 'deployments' },
        deploy: { group: 'apps', resource: 'deployments' },
        nodes: { group: '', resource: 'nodes' },
        node: { group: '', resource: 'nodes' },
      }
      const target2 = map[target]
      if (!target2) {
        push(`error: the server doesn't have a resource type "${target}"`)
        return
      }
      const list = await listResources(clusterId.value, { ...target2, namespace })
      if (!list.length) {
        push('No resources found.')
        return
      }
      push('NAME'.padEnd(38) + 'STATUS'.padEnd(22) + 'NAMESPACE')
      list.forEach((item) => push(`${item.ref.name.padEnd(38)}${item.status.padEnd(22)}${item.ref.namespace}`))
      return
    }
    push(`error: unknown kubectl subcommand "${rest.join(' ')}"`)
  } catch (err) {
    push(`error: ${err instanceof Error ? err.message : '命令执行失败'}`)
  } finally {
    busy.value = false
  }
}

async function submit(): Promise<void> {
  const command = input.value.trim()
  if (!command) return
  push(`${prompt.value} ${command}`)
  history.value.push(command)
  historyIndex.value = -1
  input.value = ''
  await runCommand(command)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (!history.value.length) return
    historyIndex.value = historyIndex.value < 0 ? history.value.length - 1 : Math.max(0, historyIndex.value - 1)
    input.value = history.value[historyIndex.value] ?? ''
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (historyIndex.value < 0) return
    historyIndex.value += 1
    input.value = historyIndex.value < history.value.length ? history.value[historyIndex.value] : ''
    if (historyIndex.value >= history.value.length) historyIndex.value = -1
  }
}

function back(): void {
  void router.push({ name: 'cluster-workspace', params: { clusterId: clusterId.value } })
}

onMounted(async () => {
  try {
    cluster.value = await getCluster(clusterId.value)
  } catch (err) {
    MessagePlugin.error(err instanceof Error ? err.message : '集群加载失败')
  }
  await connect()
})

onBeforeUnmount(() => {
  void disconnect()
})
</script>

<template>
  <div class="term tk-panel">
    <div class="term__crumb">
      <router-link class="term__crumb-link" :to="{ name: 'clusters' }">资源浏览器</router-link>
      <span class="term__sep">/</span>
      <button type="button" class="term__crumb-link" @click="back">{{ cluster?.name ?? clusterId }}</button>
      <span class="term__sep">/</span>
      <span class="term__crumb-current">集群终端</span>
      <span class="term__actions">
        <span v-if="session" class="term__session u-mono">
          会话 {{ session.sessionId }} · 过期 {{ fmtRelative(session.expiresAt) }}
        </span>
        <t-button size="small" variant="text" @click="back">返回工作区</t-button>
        <t-button v-if="session" size="small" variant="text" theme="danger" @click="disconnect">断开</t-button>
        <t-button v-else size="small" theme="primary" variant="outline" @click="connect">重连</t-button>
      </span>
    </div>

    <t-alert v-if="sessionError" theme="error" :message="sessionError" class="term__alert" />

    <div class="term__body">
      <div ref="bodyRef" class="term__screen">
        <p v-for="(line, index) in lines" :key="index" class="term__line">{{ line }}</p>
      </div>
      <div class="term__input-row">
        <span class="term__prompt u-mono">{{ prompt }}</span>
        <input
          v-model="input"
          class="term__input"
          type="text"
          spellcheck="false"
          autocomplete="off"
          :disabled="!session || busy"
          placeholder="输入 kubectl 命令，help 查看支持范围"
          @keydown="onKeydown"
          @keydown.enter="submit"
        />
      </div>
      <p class="term__hint">
        终端为 mock 会话（EX-02 / EX-03）：命令读取本地 mock 数据，不连接真实集群；真实实现会换成一次性 ticket + WebSocket。
      </p>
    </div>
  </div>
</template>

<style scoped>
.term {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 88px);
}
.term__crumb {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 12px;
  border-bottom: 1px solid var(--tk-border);
}
.term__crumb-link {
  padding: 0;
  font: inherit;
  color: var(--tk-text-2);
  background: none;
  border: 0;
  cursor: pointer;
}
.term__crumb-link:hover {
  color: var(--tk-primary);
}
.term__sep {
  color: var(--tk-text-3);
}
.term__crumb-current {
  font-weight: 600;
}
.term__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.term__session {
  color: var(--tk-text-3);
  font-size: 11px;
}
.term__alert {
  margin: 8px 12px 0;
}
.term__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 12px;
  min-height: 0;
}
.term__screen {
  flex: 1;
  min-height: 320px;
  max-height: 560px;
  padding: 10px 12px;
  overflow: auto;
  color: #d7e3f4;
  font-family: var(--tk-mono);
  font-size: 12px;
  line-height: 18px;
  background: #101828;
  border-radius: var(--tk-radius);
}
.term__line {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}
.term__input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 6px 10px;
  background: #101828;
  border-radius: var(--tk-radius);
}
.term__prompt {
  color: #6ee7b7;
  font-size: 12px;
}
.term__input {
  flex: 1;
  min-width: 0;
  color: #e5edf9;
  font-family: var(--tk-mono);
  font-size: 12px;
  background: transparent;
  border: 0;
  outline: none;
}
.term__input::placeholder {
  color: #6b7a90;
}
.term__hint {
  margin: 8px 2px 0;
  color: var(--tk-text-3);
  font-size: 11px;
}
</style>
