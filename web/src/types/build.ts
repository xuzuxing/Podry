import type { BuildConfig } from '@/types'

export type BuildDraft = Required<BuildConfig>

export function buildDraft(config: BuildConfig | null, materialId = ''): BuildDraft {
  return {
    registryId: '', imageRepository: '', dockerfile: 'Dockerfile', context: '.',
    platform: '', timeoutSeconds: 1800,
    buildMode: 'dockerfile', gitMaterialId: materialId, contextGitMaterialId: materialId,
    useRootContext: false, dockerfileContent: '', builderImage: 'paketobuildpacks/builder-jammy-base:latest',
    dockerfileLanguage: '', dockerfileFramework: '',
    projectPath: '.', buildArguments: [], buildpackLanguage: 'Node.js', buildpackVersion: 'Autodetect',
    ...config,
    // 参数数组需要独立副本，避免表单改变已保存的配置。
    ...(config?.buildArguments ? { buildArguments: config.buildArguments.map((item) => ({ ...item })) } : {}),
    // 兼容早期 Mock 将 Buildpacks 环境变量放在 buildArguments 的配置。
    buildpackArguments: (config?.buildpackArguments ?? (config?.buildMode === 'buildpack' ? config.buildArguments : undefined) ?? []).map(item => ({ ...item })),
    buildSecrets: (config?.buildSecrets ?? []).map(({ type, id, secretName, key }) => ({ type, id, secretName, key })),
    buildSSH: (config?.buildSSH ?? []).map(({ type, id, secretName, key }) => ({ type, id, secretName, key })),
  }
}
