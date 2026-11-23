import type { K8sResource } from '@/types'
import { filterPodLogLines, podContainers, type PodContainer } from './podLogs'

export interface AnalyzerPodOption { value: string; label: string; pods: K8sResource[]; group: boolean }
export interface AnalyzerSource { uid: string; pod: string; lines: string[]; error: string; unavailable: boolean }

/** Follow the namespaced owner graph, including ReplicaSet -> Deployment and Job -> CronJob. */
export function analyzerPodOptions(resources: K8sResource[]): AnalyzerPodOption[] {
  const pods = resources.filter(item => item.kind === 'Pod')
  const grouped = new Map<string, AnalyzerPodOption>()
  for (const pod of pods) {
    let current = pod
    const visited = new Set([pod.ref.uid])
    while (current.ownerRefs[0]) {
      const owner = current.ownerRefs[0]
      const parent = resources.find(item => item.ref.namespace === pod.ref.namespace && `${item.kind}/${item.ref.name}` === owner)
      if (!parent) {
        const value = `owner:${pod.ref.namespace}/${owner}`
        const option = grouped.get(value) ?? { value, label: `全部 ${owner.split('/').slice(1).join('/')}`, pods: [], group: true }
        option.pods.push(pod); grouped.set(value, option)
        break
      }
      if (visited.has(parent.ref.uid)) break
      visited.add(parent.ref.uid); current = parent
    }
    if (current !== pod && !current.ownerRefs[0]) {
      const value = `workload:${current.ref.uid}`
      const option = grouped.get(value) ?? { value, label: `全部 ${current.ref.name}`, pods: [], group: true }
      option.pods.push(pod); grouped.set(value, option)
    }
  }
  return [
    ...[...grouped.values()].sort((a, b) => a.label.localeCompare(b.label)),
    ...pods.map(pod => ({ value: `pod:${pod.ref.uid}`, label: pod.ref.name, pods: [pod], group: false })).sort((a, b) => a.label.localeCompare(b.label)),
  ]
}

export function analyzerContainers(pods: K8sResource[]): PodContainer[] {
  const containers = new Map<string, PodContainer>()
  for (const pod of pods) for (const item of podContainers(pod.manifest)) if (!containers.has(item.name)) containers.set(item.name, item)
  return [...containers.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Filter each stream separately so grep context never leaks into a neighboring Pod. */
export function filterAnalyzerSources(sources: AnalyzerSource[], query: string): { lines: string[]; error: string } {
  const validation = filterPodLogLines([], query)
  if (validation.error) return validation
  return { lines: sources.flatMap(source => filterPodLogLines(source.lines.map(line => `${source.pod}: ${line}`), query).lines), error: '' }
}
