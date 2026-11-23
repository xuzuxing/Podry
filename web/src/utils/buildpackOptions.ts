import type { BuildDraft } from '@/types/build'
import { buildpackCatalog } from '@/mock/buildpackCatalog'

/** 语言/版本/Builder 联动只改动其对应的语言参数，其余用户环境变量保留。 */
export function updateBuildpack(draft: BuildDraft, change: Partial<Pick<BuildDraft, 'buildpackLanguage' | 'buildpackVersion' | 'builderImage'>>): BuildDraft {
  const previous = buildpackCatalog.find(item => item.language === draft.buildpackLanguage)
  const language = change.buildpackLanguage ?? draft.buildpackLanguage
  const metadata = buildpackCatalog.find(item => item.language === language)
  const builderImage = change.builderImage ?? draft.builderImage
  const version = change.buildpackVersion ?? (language === draft.buildpackLanguage || draft.buildpackVersion === 'Autodetect' || metadata?.versions.includes(draft.buildpackVersion) ? draft.buildpackVersion : 'Autodetect')
  const previousKey = previous?.builder === draft.builderImage ? previous.versionArgument : ''
  const nextKey = metadata?.builder === builderImage ? metadata.versionArgument : ''
  const args = draft.buildpackArguments.filter(item => ![previousKey, nextKey].filter(Boolean).includes(item.key)).map(item => ({ ...item }))
  if (version !== 'Autodetect' && nextKey) args.push({ key: nextKey, value: version })
  return { ...draft, ...change, buildpackLanguage: language, buildpackVersion: version, builderImage, buildpackArguments: args }
}
