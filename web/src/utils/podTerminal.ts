import { parseDocument } from 'yaml'
import type { K8sResource } from '@/types'
import { podContainers } from './podLogs'

export const POD_SHELLS = ['sh', 'bash', 'powershell', 'cmd'] as const
export type PodShell = typeof POD_SHELLS[number]
export const isPodShell = (value: unknown): value is PodShell => POD_SHELLS.includes(value as PodShell)

/** Missing status is not evidence of a running container; the Mock only rejects known unavailable states. */
export function podTerminalError(resource: K8sResource, container: string): string {
  if (resource.kind !== 'Pod') return '只有 Pod 支持容器终端'
  if (!podContainers(resource.manifest).some(item => item.name === container)) return '容器不存在，请重新选择'
  try {
    const document = parseDocument(resource.manifest)
    if (document.errors.length) return 'Pod 清单无效，无法读取容器状态'
    const data = document.toJS({ maxAliasCount: 100 })
    let running = false
    for (const key of ['containerStatuses', 'initContainerStatuses', 'ephemeralContainerStatuses']) {
      const statuses = data?.status?.[key]
      const status = Array.isArray(statuses) ? statuses.find(item => item?.name === container) : null
      if (status?.state?.terminated) return `容器已终止：${status.state.terminated.reason || 'Terminated'}`
      if (status?.state?.waiting) return `容器尚未运行：${status.state.waiting.reason || 'Waiting'}`
      if (status?.state?.running) running = true
    }
    if (running && data?.status?.phase === 'Running') return ''
    if (['Pending', 'Succeeded', 'Failed', 'Completed', 'Unknown', 'CrashLoopBackOff'].includes(resource.status)) return `Pod 当前状态为 ${resource.status}，无法连接终端`
    return ''
  } catch { return 'Pod 清单无效，无法读取容器状态' }
}

export function terminalPrompt(shell: PodShell): string {
  return shell === 'powershell' ? 'PS C:\\app>' : shell === 'cmd' ? 'C:\\app>' : '$'
}

/** Literal Mock commands only. Never evaluate, interpolate or pass input to a shell. */
export function mockTerminalCommand(command: string, shell: PodShell): { lines: string[]; clear?: boolean; exit?: boolean } {
  const [head] = command.trim().split(/\s+/)
  if (!head) return { lines: [] }
  if (head === 'clear' || head === 'cls') return { lines: [], clear: true }
  if (head === 'exit' || head === 'logout') return { lines: ['会话已关闭'], exit: true }
  if (head === 'help') return { lines: ['Mock 支持 help、ls / dir、pwd、whoami、echo、ansi、clear / cls、exit。', '↑ / ↓ 查看命令历史；← / →、Home / End 编辑；Shift+Enter 换行。', 'Ctrl+C 中断输入；Ctrl+D 断开；Ctrl+L / ⌘K 清屏。', '仅本地文本演示，不执行 Shell，不读取容器文件或环境变量。'] }
  if (head === 'ansi') return { lines: ['\x1b[32mSUCCESS\x1b[0m local Mock', '\x1b[31mERROR\x1b[0m example only', 'progress 10%\r\x1b[2Kprogress 100%', '<script>literal text</script>'] }
  if (head === 'pwd') return { lines: [shell === 'cmd' || shell === 'powershell' ? 'C:\\app' : '/app'] }
  if (head === 'whoami') return { lines: ['mock-user'] }
  if (head === 'ls' || head === 'dir') return { lines: ['bin   dev   etc   proc   sys   tmp   usr   var   app  (Mock)'] }
  if (head === 'echo') {
    const value = command.trim().slice(4).trimStart()
    return { lines: [value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) ? value.slice(1, -1) : value] }
  }
  return { lines: [`${shell}: ${head}: command not found (Mock)`] }
}
