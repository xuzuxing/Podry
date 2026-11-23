import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { closeExecSession, createExecSession, type ExecSession } from '@/api'
import type { K8sResource } from '@/types'
import { podContainers } from '@/utils/podLogs'
import { mockTerminalCommand, podTerminalError, terminalPrompt, type PodShell } from '@/utils/podTerminal'
import { terminalCommands } from '@/utils/terminalInput'

type Connection = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error' | 'expired'
interface TerminalOptions {
  resource: () => K8sResource
  clusterId: () => string
  active: () => boolean
  initialContainer: () => string | undefined
  create?: typeof createExecSession
  close?: typeof closeExecSession
}

export function usePodTerminal(options: TerminalOptions) {
  const create = options.create ?? createExecSession, close = options.close ?? closeExecSession
  const containers = computed(() => podContainers(options.resource().manifest))
  const container = shallowRef(''), shell = shallowRef<PodShell>('sh')
  /* 终端（仅 Pod）：本地回显，不建立真实 exec 会话 */
  const lines = shallowRef<string[]>([]), input = shallowRef(''), history = shallowRef<string[]>([])
  /* P2：终端会话（ticket → session） */
  const session = shallowRef<ExecSession | null>(null), status = shallowRef<Connection>('idle'), error = shallowRef('')
  const online = shallowRef(typeof navigator === 'undefined' || navigator.onLine !== false)
  const unavailable = computed(() => podTerminalError(options.resource(), container.value))
  const connected = computed(() => status.value === 'connected' && !!session.value && online.value && !unavailable.value)
  let generation = 0, alive = true, expiry: ReturnType<typeof setTimeout> | undefined
  let historyIndex = 0, draft = ''
  const safelyClose = async (id: string): Promise<void> => { try { await close(id) } catch { /* 会话可能已过期，忽略 */ } }
  function release(): Promise<void> {
    ++generation; clearTimeout(expiry)
    const current = session.value; session.value = null
    return current ? safelyClose(current.sessionId) : Promise.resolve()
  }
  function disconnect(next: Connection = 'disconnected'): void { status.value = next; input.value = ''; void release() }
  function expire(now = Date.now()): void {
    if (session.value && new Date(session.value.expiresAt).getTime() <= now) {
      disconnect('expired'); error.value = '会话已过期，请重新连接'
    }
  }
  async function connect(): Promise<void> {
    const cleanup = release(), request = generation
    lines.value = []; input.value = ''; history.value = []; historyIndex = 0; draft = ''; error.value = ''
    if (!online.value || unavailable.value) {
      status.value = 'error'; error.value = !online.value ? '当前处于离线状态，请检查网络连接' : unavailable.value
      return
    }
    const target = { namespace: options.resource().ref.namespace, pod: options.resource().ref.name, container: container.value, shell: shell.value, resourceUid: options.resource().ref.uid }
    const targetCluster = options.clusterId()
    status.value = 'connecting'
    await cleanup
    if (!alive || request !== generation) return
    try {
      const result = await create(targetCluster, target)
      if (!alive || request !== generation) { await safelyClose(result.sessionId); return }
      session.value = result; status.value = 'connected'
      lines.value = [`${target.pod} / ${target.container} · ${target.shell}`, 'Mock 终端已连接。输入 help 查看演示命令。', '']
      expire()
      if (session.value) expiry = setTimeout(() => expire(), Math.max(0, new Date(result.expiresAt).getTime() - Date.now()))
    } catch (err) {
      if (alive && request === generation) { status.value = 'error'; error.value = err instanceof Error ? err.message : '终端连接失败' }
    }
  }
  function append(...next: string[]): void { lines.value = [...lines.value, ...next].slice(-1000) }
  function clear(): void { lines.value = [] }
  function submit(): void {
    expire()
    if (!connected.value) return
    const command = input.value.trim(); input.value = ''
    if (!command) return
    if (history.value.at(-1) !== command) history.value = [...history.value, command].slice(-100)
    historyIndex = history.value.length; draft = ''
    append(`${terminalPrompt(shell.value)} ${command.replace(/\n/g, '\n> ')}`)
    for (const item of terminalCommands(command)) {
      const result = mockTerminalCommand(item, shell.value)
      if (result.clear) clear()
      else append(...result.lines)
      if (result.exit) { disconnect(); break }
    }
  }
  function recall(direction: -1 | 1): void {
    if (!connected.value) return
    if (historyIndex === history.value.length) draft = input.value
    historyIndex = Math.min(history.value.length, Math.max(0, historyIndex + direction))
    input.value = historyIndex === history.value.length ? draft : history.value[historyIndex] ?? ''
  }
  function interrupt(): void {
    if (!connected.value) return
    append(`${terminalPrompt(shell.value)} ${input.value}^C`); input.value = ''; historyIndex = history.value.length; draft = ''
  }
  watch(() => [options.clusterId(), options.resource().ref.uid] as const, () => {
    disconnect('idle'); shell.value = 'sh'; lines.value = []
    container.value = containers.value.find(item => item.name === options.initialContainer())?.name ?? containers.value[0]?.name ?? ''
  }, { immediate: true })
  watch(() => options.initialContainer(), (value) => { if (containers.value.some(item => item.name === value)) container.value = value! })
  watch(containers, () => {
    if (!containers.value.some(item => item.name === container.value)) container.value = containers.value[0]?.name ?? ''
  })
  watch([container, shell, unavailable], () => {
    if (options.active()) void connect()
    else disconnect('idle')
  })
  watch(options.active, (active) => {
    if (active && status.value === 'idle') void connect()
    else if (!active && status.value === 'connecting') disconnect('idle')
  }, { immediate: true })
  function updateNetwork(): void {
    online.value = navigator.onLine
    if (!online.value) { disconnect(); error.value = '当前处于离线状态，请检查网络连接' }
    else if (error.value === '当前处于离线状态，请检查网络连接') error.value = ''
  }
  if (typeof window !== 'undefined') { window.addEventListener('online', updateNetwork); window.addEventListener('offline', updateNetwork) }
  onScopeDispose(() => {
    alive = false; void release()
    if (typeof window !== 'undefined') { window.removeEventListener('online', updateNetwork); window.removeEventListener('offline', updateNetwork) }
  })
  return { containers, container, shell, lines, input, session, status, error, online, unavailable, connected, connect, disconnect, expire, clear, submit, recall, interrupt }
}
