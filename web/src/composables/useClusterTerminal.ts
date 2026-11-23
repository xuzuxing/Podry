import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import { parseDocument } from 'yaml'
import { closeExecSession, createExecSession, listNamespace, listResources } from '@/api'
import type { ExecSession } from '@/api'
import type { K8sResource, NodeTaint, ResourceEvent } from '@/types'
import { retainManagedFields } from '@/utils/resourceManifest'
import { AUTO_NODE, createDebugPod, debugPodEvents, terminalSelectionError, validateDebugManifest } from '@/utils/clusterTerminal'
import type { ClusterTerminalSelection } from '@/utils/clusterTerminal'
import { terminalCommands } from '@/utils/terminalInput'

type TerminalServices = { create: typeof createExecSession; close: typeof closeExecSession; namespaces: typeof listNamespace; resources: typeof listResources }
export function useClusterTerminal(options: { clusterId: () => string; clusterName: () => string; selection: () => ClusterTerminalSelection; nodes: () => string[]; debug: () => boolean; taints?: () => NodeTaint[] }, services: TerminalServices = { create: createExecSession, close: closeExecSession, namespaces: listNamespace, resources: listResources }) {
  const session = shallowRef<ExecSession | null>(null), pod = shallowRef<K8sResource | null>(null), events = shallowRef<ResourceEvent[]>([])
  const status = shallowRef<'connecting' | 'connected' | 'disconnected' | 'error' | 'expired'>('disconnected')
  const error = shallowRef(''), online = shallowRef(typeof navigator === 'undefined' || navigator.onLine !== false)
  const lines = ref<string[]>([]), input = ref(''), busy = shallowRef(false)
  const selectedNode = computed(() => options.selection().node === AUTO_NODE ? options.nodes()[0] || '' : options.selection().node)
  const connected = computed(() => status.value === 'connected' && online.value)
  const prompt = computed(() => options.debug() ? 'root@node:/host#' : 'debug:/#')
  let generation = 0, commandRequest = 0, sequence = 0, disposed = false, history: string[] = [], cursor = -1, savedDraft = ''
  let expiry: ReturnType<typeof setTimeout> | undefined
  async function close(current: ExecSession | null) {
    if (!current) return
    try { await services.close(current.sessionId) } catch { /* 已过期 */ }
  }
  function disconnect(reason: 'disconnected' | 'expired' = 'disconnected') {
    ++generation; ++commandRequest; clearTimeout(expiry)
    const current = session.value; session.value = null; status.value = reason; busy.value = false; input.value = ''
    void close(current)
  }
  async function connect(manifest?: string): Promise<void> {
    const selection = { ...options.selection() }, clusterId = options.clusterId(), node = selectedNode.value, debug = options.debug()
    disconnect(); const request = generation
    error.value = terminalSelectionError(selection)
    if (!online.value || !node || error.value) { status.value = 'error'; error.value ||= online.value ? '该集群没有可用节点' : '网络已离线，请检查网络连接'; return }
    status.value = 'connecting'; lines.value = [`Selecting node ${node}.`, manifest ? 'Recreating debug Pod (local Mock).' : pod.value ? 'Connecting to existing debug Pod (local Mock).' : 'Creating debug Pod (local Mock).']
    const nextPod = manifest && pod.value ? { ...pod.value, ref: { ...pod.value.ref, uid: `mock-debug-${++sequence}` }, manifest } : pod.value ?? createDebugPod(selection, node, debug, ++sequence, options.taints?.())
    input.value = ''; history = []; cursor = -1; savedDraft = ''
    try {
      const container = parseDocument(nextPod.manifest).toJS({ maxAliasCount: 100 }).spec.containers[0].name as string
      const created = await services.create(clusterId, { namespace: selection.namespace, container, shell: selection.shell })
      if (disposed || request !== generation) { await close(created); return }
      session.value = created
      if (pod.value?.ref.uid !== nextPod.ref.uid) events.value = debugPodEvents(nextPod, node, created.createdAt)
      pod.value = nextPod
      status.value = 'connected'; lines.value.push(`Connected to ${nextPod.ref.name} · ${selection.shell}.`, 'Local Mock · help 查看支持的只读 kubectl 命令。', '')
      expiry = setTimeout(() => disconnect('expired'), Math.max(0, Date.parse(created.expiresAt) - Date.now()))
    } catch (cause) { if (!disposed && request === generation) { status.value = 'error'; error.value = cause instanceof Error ? cause.message : '终端连接失败' } }
  }
  async function applyManifest(text: string) {
    if (!pod.value) return false
    const validation = validateDebugManifest(text, pod.value)
    if (validation) { error.value = validation; return false }
    await connect(retainManagedFields(pod.value.manifest, text))
    return status.value === 'connected'
  }
  function clear() { lines.value = [] }
  function recall(direction: -1 | 1) {
    if (!history.length) return
    if (cursor === -1) { if (direction === 1) return; savedDraft = input.value; cursor = history.length }
    cursor = Math.max(0, Math.min(history.length, cursor + direction))
    input.value = cursor === history.length ? savedDraft : history[cursor] || ''
    if (cursor === history.length) cursor = -1
  }
  function interrupt() { ++commandRequest; busy.value = false; lines.value.push(`${prompt.value} ${input.value}^C`); input.value = ''; cursor = -1 }
  async function submit() {
    const command = input.value.trim()
    if (!connected.value || busy.value || !command) return
    const token = ++commandRequest, current = generation, clusterId = options.clusterId(), selection = { ...options.selection() }
    const push = (...output: string[]) => { if (!disposed && current === generation && token === commandRequest) lines.value.push(...output) }
    lines.value.push(`${prompt.value} ${command.replace(/\n/g, '\n> ')}`); input.value = ''; history.push(command); history = history.slice(-100); cursor = -1; savedDraft = ''; busy.value = true
    async function execute(command: string) {
      if (command === 'clear') { clear(); return }
      if (command === 'exit') { push('Session closed.'); disconnect(); return }
      if (command === 'help') { push('kubectl get pods|deployments|nodes|namespaces [-n namespace] [-A]', 'kubectl config current-context', 'hostname / whoami / pwd / ansi / clear / exit', 'Shift+Enter 换行；多行粘贴后按 Enter 提交。', '本地 Mock 只解析上述字面命令，不运行脚本。'); return }
      if (command === 'ansi') { push('\x1b[32mSUCCESS\x1b[0m local Mock', '\x1b[31mERROR\x1b[0m example only', 'progress 10%\r\x1b[2Kprogress 100%'); return }
      if (command === 'hostname') { push(options.debug() ? selectedNode.value : pod.value?.ref.name || 'debug'); return }
      if (command === 'whoami') { push('root'); return }
      if (command === 'pwd') { push(options.debug() ? '/host' : '/'); return }
      if (command === 'kubectl config current-context') { push(`kubernetes-admin@${options.clusterName()}`); return }
      const parts = /^kubectl get (pods?|deployments?|deploy|nodes?|namespaces|ns)(?: (-A|--all-namespaces)| -n ([a-z0-9-]+))?$/.exec(command)
      if (!parts) { push(`${selection.shell}: unsupported command (local Mock): ${command}`); return }
      if (['ns', 'namespaces'].includes(parts[1]!)) {
        const rows = await services.namespaces(clusterId); push('NAME'.padEnd(30) + 'STATUS', ...rows.map(row => row.name.padEnd(30) + row.phase)); return
      }
      const target = parts[1]!, resource = target.startsWith('pod') ? 'pods' : target.startsWith('node') ? 'nodes' : 'deployments'
      const rows = await services.resources(clusterId, { group: resource === 'deployments' ? 'apps' : '', resource, namespace: resource === 'nodes' || parts[2] ? undefined : parts[3] || selection.namespace })
      push(...(rows.length ? ['NAME'.padEnd(46) + 'STATUS'.padEnd(24) + 'NAMESPACE', ...rows.map(row => row.ref.name.padEnd(46) + row.status.padEnd(24) + row.ref.namespace)] : ['No resources found.']))
    }
    try {
      for (const item of terminalCommands(command)) {
        if (disposed || current !== generation || token !== commandRequest) break
        await execute(item)
      }
    } catch (cause) { push(`error: ${cause instanceof Error ? cause.message : '命令读取失败'}`) }
    finally { if (!disposed && current === generation && token === commandRequest) { busy.value = false; lines.value = lines.value.slice(-1000) } }
  }
  function offline() { online.value = false; disconnect(); error.value = '网络已离线，请检查网络连接' }
  function resumeOnline() { online.value = true; error.value = '' }
  if (typeof window !== 'undefined') { window.addEventListener('offline', offline); window.addEventListener('online', resumeOnline) }
  watch(() => [options.clusterId(), options.selection().node, options.selection().namespace, options.selection().image, options.selection().shell, options.debug()], (value, previous) => {
    // Shell 切换和暂停/继续只重建连接；节点、Namespace、镜像、Debug Mode 变化才重建 Pod。
    if (!previous || value.some((entry, index) => index !== 4 && entry !== previous[index])) { pod.value = null; events.value = [] }
    void connect()
  }, { immediate: true })
  onScopeDispose(() => { disposed = true; disconnect(); if (typeof window !== 'undefined') { window.removeEventListener('offline', offline); window.removeEventListener('online', resumeOnline) } })
  return { session, pod, events, status, error, online, lines, input, busy, connected, prompt, selectedNode, connect, disconnect, clear, recall, interrupt, submit, applyManifest }
}
