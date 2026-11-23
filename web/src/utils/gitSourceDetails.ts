/** Source links are derived only from the repository recorded with the source. */
export function repositoryWebUrl(value?: string): string | null {
  if (!value?.trim()) return null
  const input = value.trim()
  const scp = /^[^@\s/:]+@([^\s/:]+):(.+)$/.exec(input)
  try {
    let parsed = new URL(scp ? `https://${scp[1]}/${scp[2]}` : input)
    if (parsed.protocol === 'ssh:') parsed = new URL(`https://${parsed.hostname}${parsed.pathname}`)
    if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname) return null
    // A repository link must never expose an embedded password or token.
    parsed.username = ''; parsed.password = ''; parsed.search = ''; parsed.hash = ''
    parsed.pathname = parsed.pathname.replace(/\/+$/, '').replace(/\.git$/i, '')
    return parsed.toString().replace(/\/$/, '')
  } catch { return null }
}

function providerOf(base: string): 'github' | 'gitlab' | 'bitbucket' | 'azure' | null {
  const parsed = new URL(base)
  const host = parsed.hostname.toLowerCase()
  if (host.includes('github')) return 'github'
  if (host.includes('gitlab')) return 'gitlab'
  if (host.includes('bitbucket')) return 'bitbucket'
  if (host === 'dev.azure.com' || host.endsWith('.visualstudio.com')) return 'azure'
  return null
}

export function gitCommitUrl(repository?: string, sha?: string): string | null {
  const base = repositoryWebUrl(repository)
  if (!base || !sha || !/^[a-f\d]{7,64}$/i.test(sha)) return null
  switch (providerOf(base)) {
    case 'github': return `${base}/commit/${sha}`
    case 'gitlab': return `${base}/-/commit/${sha}`
    case 'bitbucket': return `${base}/commits/${sha}`
    case 'azure': return `${base}/commit/${sha}`
    default: return null
  }
}

export function gitRefUrl(repository: string | undefined, ref: string | undefined, kind: 'branch' | 'tag' = 'branch'): string | null {
  const base = repositoryWebUrl(repository)
  if (!base || !ref) return null
  const encoded = encodeURIComponent(ref)
  switch (providerOf(base)) {
    case 'github': return `${base}/tree/${encoded}`
    case 'gitlab': return `${base}/-/tree/${encoded}`
    case 'bitbucket': return `${base}/src/${encoded}`
    case 'azure': return `${base}?version=${kind === 'tag' ? 'GT' : 'GB'}${encoded}`
    default: return null
  }
}

export function gitPullRequestUrl(repository?: string, number?: number, recordedUrl?: string): string | null {
  if (recordedUrl) {
    try {
      const parsed = new URL(recordedUrl)
      if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password) return parsed.href
    } catch { /* An invalid recorded URL is displayed as plain text. */ }
    return null
  }
  const base = repositoryWebUrl(repository)
  if (!base || !number || !Number.isSafeInteger(number) || number < 1) return null
  switch (providerOf(base)) {
    case 'github': return `${base}/pull/${number}`
    case 'gitlab': return `${base}/-/merge_requests/${number}`
    case 'bitbucket': return `${base}/pull-requests/${number}`
    case 'azure': return `${base}/pullrequest/${number}`
    default: return null
  }
}
