// Offline source-link, path-filter and recorded-source checks. No Git/backend access.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { effectScope, shallowRef } from 'vue'
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
let count = 0
const scopes = []
function check(name, value) { assert.ok(value, name); count++; console.log('PASS ' + name) }
async function waitFor(test) { for (let i = 0; i < 100 && !test(); i++) await new Promise(done => setTimeout(done, 30)); assert.ok(test(), 'Async state settled') }
try {
  const links = await server.ssrLoadModule('/src/utils/gitSourceDetails.ts')
  const filters = await server.ssrLoadModule('/src/utils/gitCommitFilters.ts')
  const api = await server.ssrLoadModule('/src/api/index.ts')
  const { gitMaterialsOf } = await server.ssrLoadModule('/src/utils/gitMaterials.ts')
  const { useBuildMaterials } = await server.ssrLoadModule('/src/composables/useBuildMaterials.ts')
  const sha = 'a'.repeat(40)
  check('HTTPS repository trims .git and trailing slash', links.repositoryWebUrl('https://github.com/acme/app.git/') === 'https://github.com/acme/app')
  check('SCP repository uses HTTPS', links.gitCommitUrl('git@github.com:acme/app.git', sha) === `https://github.com/acme/app/commit/${sha}`)
  check('SSH repository drops transport port and user', links.gitCommitUrl('ssh://git@gitlab.example:2222/team/app.git', sha) === `https://gitlab.example/team/app/-/commit/${sha}`)
  check('Embedded credentials and query tokens are removed', links.repositoryWebUrl('https://user:secret@github.com/acme/app.git?token=secret#ref') === 'https://github.com/acme/app')
  check('Bitbucket commit route supported', links.gitCommitUrl('https://bitbucket.org/team/app.git', sha) === `https://bitbucket.org/team/app/commits/${sha}`)
  check('Azure commit route supported', links.gitCommitUrl('https://dev.azure.com/team/project/_git/app', sha) === `https://dev.azure.com/team/project/_git/app/commit/${sha}`)
  check('Unknown provider does not invent a commit URL', links.gitCommitUrl('https://git.internal/team/app', sha) === null)
  check('Missing or invalid SHA is plain text', !links.gitCommitUrl('https://github.com/team/app', '') && !links.gitCommitUrl('https://github.com/team/app', '../main?x'))
  check('Executable and malformed repository URLs are rejected', !links.repositoryWebUrl('javascript:alert(1)') && !links.repositoryWebUrl('data:text/html,x') && !links.repositoryWebUrl('not-a-url'))
  check('Slash and query in branch remain one encoded ref', links.gitRefUrl('https://gitlab.com/team/app', 'feature/order?x#y') === 'https://gitlab.com/team/app/-/tree/feature%2Forder%3Fx%23y')
  check('Azure tags use GT version', links.gitRefUrl('https://dev.azure.com/team/project/_git/app', 'v1.4', 'tag').endsWith('?version=GTv1.4'))
  check('PR numbers route by provider', links.gitPullRequestUrl('https://github.com/team/app', 42).endsWith('/pull/42') && links.gitPullRequestUrl('https://gitlab.com/team/app', 42).endsWith('/-/merge_requests/42') && links.gitPullRequestUrl('https://bitbucket.org/team/app', 42).endsWith('/pull-requests/42'))
  check('Invalid or missing PR number never parsed from title', !links.gitPullRequestUrl('https://github.com/team/app', -1) && !links.gitPullRequestUrl('https://github.com/team/app'))
  check('Explicit HTTP PR URL is retained', links.gitPullRequestUrl(undefined, undefined, 'https://review.internal/requests/12') === 'https://review.internal/requests/12')
  check('Unsafe recorded PR URL is not replaced with guessed URL', !links.gitPullRequestUrl('https://github.com/team/app', 42, 'javascript:alert(1)') && !links.gitPullRequestUrl(undefined, undefined, 'https://user:token@host/request/1'))
  check('Default paths included', filters.gitPathIncluded('src/app.ts', []))
  check('Recursive exclude covers nested paths', !filters.gitPathIncluded('docs/releases/v1.md', ['!docs/**']))
  check('Trailing /* follows documented recursive behavior', !filters.gitPathIncluded('docs/releases/v1.md', ['!docs/*']))
  check('Middle /* matches one directory', !filters.gitPathIncluded('Project/a/Client', ['!Project/*/Client']) && filters.gitPathIncluded('Project/a/b/Client', ['!Project/*/Client']))
  check('Middle /** matches zero or many directories', !filters.gitPathIncluded('Project/Client', ['!Project/**/Client']) && !filters.gitPathIncluded('Project/a/b/Client', ['!Project/**/Client']))
  check('Later include overrides earlier exclude', filters.gitPathIncluded('docs/public/index.md', ['!docs/**', 'docs/public/**']))
  check('Later exclude overrides earlier include', !filters.gitPathIncluded('docs/public/index.md', ['docs/**', '!docs/public/**']))
  check('Pattern punctuation is literal', !filters.gitPathIncluded('src/a[1].ts', ['!src/a[1].ts']) && filters.gitPathIncluded('src/a1.ts', ['!src/a[1].ts']))
  check('Missing paths are not treated as excluded', !filters.gitCommitExcluded({}, ['!*']) && !filters.gitCommitExcluded({ changedPaths: [] }, ['!*']))
  check('Mixed changes remain eligible', !filters.gitCommitExcluded({ changedPaths: ['docs/a.md', 'src/app.ts'] }, ['!docs/**']))
  const appId = 'a-checkout'
  let config = await api.getConfig(appId)
  const first = gitMaterialsOf(config)[0]
  const second = { ...first, id: 'source-details-second', repositoryUrl: 'https://gitlab.com/acme/second.git', checkoutPath: './second', filterPatterns: [] }
  config = await api.saveConfig(appId, { section: 'git', expectedVersion: config.version, gitMaterials: [{ ...first, filterPatterns: ['!docs/**', '!README.md'] }, second] })
  let wf = await api.getWorkflow(appId)
  const ci = { ...wf.items.find(item => item.kind === 'ci'), id: 'source-details-ci' }
  ci.definition = { ...ci.definition, materials: [{ gitMaterialId: first.id, type: 'regex', value: '^(main|release/1\\.x)$', selectedBranch: 'main' }, { gitMaterialId: second.id, type: 'branch', value: 'main' }] }
  wf = await api.saveWorkflow(appId, { version: wf.version, items: [...wf.items, ci] }, config.version)
  const commits = await api.listCommits('main', appId, first.id)
  const other = await api.listCommits('main', appId, second.id)
  const excluded = commits.find(item => item.excluded)
  check('Only explicitly excluded-only commit is marked', commits.filter(item => item.excluded).length === 1 && excluded.subject.startsWith('docs:'))
  check('Repository rules stay independent', other.every(item => !item.excluded))
  commits[0].changedPaths.push('client-mutation')
  check('Returned nested paths are independent', !(await api.listCommits('main', appId, first.id))[0].changedPaths.includes('client-mutation'))
  other[0].changedPaths.push('secondary-client-mutation')
  check('Scoped repository nested paths are independent', !(await api.listCommits('main', appId, second.id))[0].changedPaths.includes('secondary-client-mutation'))
  const picks = [{ gitMaterialId: first.id, branch: 'main', commitSha: excluded.sha }, { gitMaterialId: second.id, branch: 'main', commitSha: other[0].sha }]
  await assert.rejects(api.triggerBuild(appId, excluded.sha, config.version, ci.id, 'main', { workflowVersion: wf.version, materials: picks }), err => err.code === 'commit_excluded')
  check('Trigger rejects forged excluded selection', true)
  const visible = shallowRef(true), app = shallowRef(appId), pipeline = shallowRef(ci.id)
  const scope = effectScope(); scopes.push(scope)
  const state = scope.run(() => useBuildMaterials(visible, app, pipeline))
  await waitFor(() => !state.loading.value && state.states.value.length === 2)
  const active = state.states.value[0]
  check('Exclude visibility defaults to hidden independently per repository', state.states.value.every(item => !item.showExcluded))
  active.selectedSha = active.commits[0].sha; active.showExcluded = true
  await state.refresh(active, false)
  check('Refresh preserves eligible selection and visibility choice', active.selectedSha === commits[0].sha && active.showExcluded)
  active.selectedSha = excluded.sha
  await state.refresh(active, false)
  check('Refresh clears stale excluded selection', !active.selectedSha)
  picks[0].commitSha = commits[1].sha
  const build = await api.triggerBuild(appId, commits[1].sha, config.version, ci.id, 'main', { workflowVersion: wf.version, materials: picks })
  check('Historical source records regex and actual checkout separately', build.materials[0].sourceValue === ci.definition.materials[0].value && build.materials[0].branch === 'main')
  await api.cancelBuild(build.id)
  config = await api.saveConfig(appId, { section: 'git', expectedVersion: config.version, gitMaterials: [{ ...first, repositoryUrl: 'https://github.com/acme/new-repository.git', filterPatterns: ['!*'] }, second] })
  const historic = await api.getBuild(build.id)
  check('Repository edits do not rewrite recorded source URL or metadata', historic.materials[0].repositoryUrl === first.repositoryUrl && !historic.materials[0].excluded)
  const retry = await api.retryBuild(build.id)
  check('Retry keeps original eligible source even if current rules changed', JSON.stringify(retry.materials) === JSON.stringify(historic.materials))
  const old = await api.getBuild('bd-1011')
  check('Legacy source does not acquire current paths or materials', !old.materials)
} finally { scopes.forEach(scope => scope.stop()); await server.close() }
console.log(`Completed ${count} source details checks`)
