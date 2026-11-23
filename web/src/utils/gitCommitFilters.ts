import type { GitCommit } from '@/types'

function pathPattern(value: string): RegExp {
  const pattern = value.replace(/^\.\//, '').replace(/^\//, '')
  let expression = ''
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!
    if (char !== '*') expression += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    else if (pattern[i + 1] === '*') {
      i++
      if (pattern[i + 1] === '/') { expression += '(?:.*/)?'; i++ }
      else expression += '.*'
    } else expression += i === pattern.length - 1 && (i === 0 || pattern[i - 1] === '/') ? '.*' : '[^/]*'
  }
  return new RegExp(`^${expression}$`)
}

/** Ordered rules match Devtron's path help: ! excludes; a later match wins. */
export function gitPathIncluded(path: string, patterns: readonly string[]): boolean {
  let included = true
  const normalized = path.replace(/^\.\//, '').replace(/^\//, '')
  for (const rule of patterns) {
    const value = rule.trim()
    if (!value || value === '!') continue
    const excluded = value.startsWith('!')
    if (pathPattern(excluded ? value.slice(1) : value).test(normalized)) included = !excluded
  }
  return included
}

/** Missing changed paths are unknown, never proof that a commit is excluded. */
export function gitCommitExcluded(commit: Pick<GitCommit, 'changedPaths'>, patterns: readonly string[]): boolean {
  return Boolean(patterns.length && commit.changedPaths?.length && commit.changedPaths.every(path => !gitPathIncluded(path, patterns)))
}
