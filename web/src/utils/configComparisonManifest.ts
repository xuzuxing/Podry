import { stringify } from 'yaml'
import type { ComparisonSide } from '@/types/configComparison'
import { isValuesMap } from './deploymentValues'

export interface ComparisonManifest { text: string; error: string; notice: string }
const supportedVersions = ['1.4.0', '1.2.0']
const supportedValues = ['replicaCount', 'containerPort', 'host', 'env', 'job']
const integer = (value: unknown, minimum: number, maximum: number) => typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum
const sorted = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))

/**
 * 仅为现有前端 Values/配置条目生成可对比的示例清单，不执行 Helm 模板。
 * 未支持的字段必须报错，避免把部分结果误当成完整 Manifest。
 * 历史只使用 resolveComparisonSide 提供的快照上下文，不读取当前配置。
 */
export function resolveComparisonManifest(side: ComparisonSide): ComparisonManifest {
  const fail = (error: string): ComparisonManifest => ({ text: '', error, notice: '' })
  if (side.error) return fail(side.error)
  if (!side.document || !side.manifestContext) return fail('该版本缺少清单预览上下文。')
  const { chartConfig, target, workloadName, imageRef } = side.manifestContext
  if (!chartConfig) return fail('该版本尚未配置 Chart，无法生成清单预览。')
  if (!supportedVersions.includes(chartConfig.chartVersion) || !['Deployment', 'Job'].includes(chartConfig.workloadKind)) return fail('本地预览尚不支持此 Chart 类型或版本，请切回配置查看。')
  if (side.deploymentId && (!target?.namespace || !target.releaseName || !imageRef)) return fail('历史快照缺少目标或镜像，无法还原清单预览。')
  const name = target?.releaseName || workloadName
  if (!name) return fail('缺少应用或发布名称，无法生成清单预览。')
  const values = side.document.values
  const unknown = Object.keys(values).filter(key => !supportedValues.includes(key))
  if (unknown.length) return fail(`本地预览尚不支持 Values 字段：${unknown.join('、')}。请切回配置查看完整内容。`)
  if (values.replicaCount !== undefined && !integer(values.replicaCount, 0, 1000)) return fail('replicaCount 必须是 0–1000 的整数。')
  if (values.containerPort !== undefined && !integer(values.containerPort, 1, 65535)) return fail('containerPort 必须是 1–65535 的整数。')
  if (values.host !== undefined && typeof values.host !== 'string') return fail('host 必须是字符串。')
  if (values.env !== undefined && (!isValuesMap(values.env) || Object.values(values.env).some(value => typeof value !== 'string'))) return fail('env 必须是字符串键值对象。')
  if (values.job !== undefined && (!isValuesMap(values.job) || Object.keys(values.job).some(key => !['backoffLimit', 'activeDeadlineSeconds'].includes(key)))) return fail('本地预览仅支持 job.backoffLimit 和 job.activeDeadlineSeconds。')
  const job = isValuesMap(values.job) ? values.job : {}
  if (job.backoffLimit !== undefined && !integer(job.backoffLimit, 0, 1000)) return fail('job.backoffLimit 必须是 0–1000 的整数。')
  if (job.activeDeadlineSeconds !== undefined && !integer(job.activeDeadlineSeconds, 1, 604800)) return fail('job.activeDeadlineSeconds 必须是 1–604800 的整数。')

  const labels = { 'app.kubernetes.io/instance': name }
  const metadata = (resourceName: string) => ({ name: resourceName, ...(target?.namespace ? { namespace: target.namespace } : {}), labels })
  const manifests: Record<string, unknown>[] = []
  const envFrom: Record<string, unknown>[] = [], volumes: Record<string, unknown>[] = [], mounts: Record<string, unknown>[] = []
  for (const type of ['configmaps', 'secrets'] as const) {
    const secret = type === 'secrets'
    for (const [entryName, entry] of Object.entries(side.document[type]).sort(([a], [b]) => a.localeCompare(b))) {
      if (!isValuesMap(entry.data)) return fail(`配置 ${entryName} 缺少有效的键值数据。`)
      if (!['create', 'external'].includes(String(entry.source)) || !['env', 'volume'].includes(String(entry.mountAs))) return fail(`配置 ${entryName} 的来源或挂载方式不受本地预览支持。`)
      if (entry.mountAs === 'env') envFrom.push({ [secret ? 'secretRef' : 'configMapRef']: { name: entryName } })
      else {
        if (typeof entry.mountPath !== 'string' || !entry.mountPath.startsWith('/')) return fail(`配置 ${entryName} 缺少有效的绝对挂载路径。`)
        if (entry.fileMode && !/^0?[0-7]{3}$/.test(String(entry.fileMode))) return fail(`配置 ${entryName} 的文件权限必须是八进制权限。`)
        const volumeName = `${secret ? 'secret' : 'configmap'}-${volumes.length}`
        volumes.push({ name: volumeName, [secret ? 'secret' : 'configMap']: { [secret ? 'secretName' : 'name']: entryName, ...(entry.fileMode ? { defaultMode: parseInt(String(entry.fileMode), 8) } : {}) } })
        if (entry.subPath) {
          for (const key of Object.keys(entry.data).sort()) mounts.push({ name: volumeName, mountPath: `${entry.mountPath.replace(/\/$/, '')}/${key}`, subPath: key, readOnly: true })
        } else mounts.push({ name: volumeName, mountPath: entry.mountPath, readOnly: true })
      }
      // 外部条目只生成引用；Secret 从已脱敏的文档重新构造，不传播旧快照额外字段。
      if (entry.source === 'external') continue
      manifests.push({ apiVersion: 'v1', kind: secret ? 'Secret' : 'ConfigMap', metadata: metadata(entryName),
        ...(secret ? { type: 'Opaque', stringData: Object.fromEntries(Object.keys(entry.data).sort().map(key => [key, '••••••'])) } : { data: sorted(entry.data) }),
      })
    }
  }
  const container = { name: 'app', image: imageRef ?? '<IMAGE>',
    ...(chartConfig.workloadKind === 'Deployment' ? { ports: [{ name: 'http', containerPort: values.containerPort ?? 8080 }] } : {}),
    ...(isValuesMap(values.env) && Object.keys(values.env).length ? { env: Object.entries(sorted(values.env)).map(([name, value]) => ({ name, value })) } : {}),
    ...(envFrom.length ? { envFrom } : {}), ...(mounts.length ? { volumeMounts: mounts } : {}),
  }
  const template = { metadata: { labels }, spec: { ...(chartConfig.workloadKind === 'Job' ? { restartPolicy: 'Never' } : {}), containers: [container], ...(volumes.length ? { volumes } : {}) } }
  manifests.unshift({ apiVersion: chartConfig.workloadKind === 'Job' ? 'batch/v1' : 'apps/v1', kind: chartConfig.workloadKind, metadata: metadata(name),
    spec: chartConfig.workloadKind === 'Job'
      ? { backoffLimit: job.backoffLimit ?? 6, activeDeadlineSeconds: job.activeDeadlineSeconds ?? 600, template }
      : { replicas: values.replicaCount ?? 1, selector: { matchLabels: labels }, template },
  })
  // host 是现有前端演示契约；此映射不声称等同真实 Chart 的 Service/Ingress 模板。
  if (chartConfig.workloadKind === 'Deployment' && values.host) {
    manifests.push({ apiVersion: 'v1', kind: 'Service', metadata: metadata(name), spec: { type: 'ClusterIP', selector: labels, ports: [{ name: 'http', port: 80, targetPort: 'http' }] } })
    manifests.push({ apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', metadata: metadata(name), spec: { rules: [{ host: values.host, http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name, port: { number: 80 } } } }] } }] } })
  }
  return {
    text: '# 本地 Mock 清单预览；未执行 Helm 或 Kubernetes 校验。\n# Secret 仅展示键及遮蔽值，不能据此判断明文相同。\n' + manifests.map(item => stringify(item, { lineWidth: 0, aliasDuplicateObjects: false })).join('---\n'),
    error: '', notice: [imageRef ? '镜像与目标取自对应发布快照。' : '未选择发布镜像，image 使用 <IMAGE> 占位。', !target ? '基础配置和 Chart 默认值不指定 Namespace。' : ''].filter(Boolean).join(' '),
  }
}
