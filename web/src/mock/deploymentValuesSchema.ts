import type { ResourceYamlSchema } from '@/utils/resourceYamlValidation'

// The offline Chart catalog describes only Podry's existing demo Values contract.
// It does not claim to be a Devtron Chart schema or Kubernetes validation.
export const deploymentValuesSchema: ResourceYamlSchema = {
  title: 'Deployment Values', type: 'object', additionalProperties: true,
  properties: {
    replicaCount: { type: 'integer', minimum: 0, maximum: 1000, default: 1, description: 'Deployment 副本数，范围 0–1000。' },
    containerPort: { type: 'integer', minimum: 1, maximum: 65535, default: 8080, description: '容器监听端口，范围 1–65535。' },
    host: { type: 'string', description: '应用访问域名；未设置时沿用当前配置。' },
    env: { type: 'object', additionalProperties: { type: 'string' }, description: '环境变量键值对象；数字和布尔值请加引号。' },
    job: { type: 'object', additionalProperties: true, description: 'Job 运行配置。', properties: {
      backoffLimit: { type: 'integer', minimum: 0, maximum: 1000, default: 6, description: 'Job 失败后的重试次数，范围 0–1000。' },
      activeDeadlineSeconds: { type: 'integer', minimum: 1, maximum: 604800, description: 'Job 执行时限，单位为秒，范围 1–604800。' },
    } },
  },
}
