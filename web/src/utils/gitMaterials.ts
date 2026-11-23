import type { AppConfig, GitMaterial } from '@/types'

export function repositoryName(url: string): string {
  return url.replace(/\/+$/, '').replace(/\.git$/, '').split(/[/:]/).filter(Boolean).pop() ?? url
}

/** 兼容已有单仓库 fixture，返回独立副本以免编辑表单修改已保存数据。 */
export function gitMaterialsOf(config: AppConfig | null): GitMaterial[] {
  if (!config) return []
  if (config.gitMaterials) return config.gitMaterials.map((item) => ({ ...item, filterPatterns: [...item.filterPatterns] }))
  return config.gitConfig ? [{
    ...config.gitConfig,
    id: `git-${config.appId}-primary`,
    checkoutPath: './',
    fetchSubmodules: false,
    filterPatterns: [],
  }] : []
}
