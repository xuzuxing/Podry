// 页面巡检：独立 Chrome profile；保存本轮截图，不删除已有截图目录。
// node scripts/check-pages.mjs [baseURL] [outputDirectory]
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { launchBrowser, delay } from './lib/browser.mjs'
const baseURL = process.argv[2] || 'http://127.0.0.1:4173'
const output = resolve(process.argv[3] || resolve(import.meta.dirname, '../screenshots-pages-parity'))
const routes = [
  ['00-default-apps', '/'],
  ['01-projects', '/projects'],
  ['02-project-detail', '/projects/p-shop'],
  ['03-apps', '/apps'],
  ['04-app-overview', '/projects/p-shop/apps/a-checkout/overview'],
  ['05-build-deploy', '/projects/p-shop/apps/a-checkout/trigger'],
  ['06-build-history', '/projects/p-shop/apps/a-checkout/builds'],
  ['06a-build-log-tools', '/projects/p-shop/apps/a-checkout/builds?pipeline=pl-checkout-ci&build=bd-1011&tab=logs'],
  ['06b-build-source-link', '/projects/p-shop/apps/a-checkout/builds?pipeline=pl-checkout-ci&build=bd-1011&tab=source'],
  ['06c-build-log-expired', '/projects/p-shop/apps/a-checkout/builds?pipeline=pl-checkout-ci&build=bd-1008&tab=logs'],
  ['07-deployment-history', '/projects/p-shop/apps/a-checkout/deployments'],
  ['08-config-git', '/projects/p-shop/apps/a-checkout/config/git'],
  ['09-config-build', '/projects/p-shop/apps/a-checkout/config/build'],
  ['10-config-base', '/projects/p-shop/apps/a-checkout/config/base'],
  ['10a-base-configmaps', '/projects/p-shop/apps/a-checkout/config/base/configmaps'],
  ['10b-base-secrets', '/projects/p-shop/apps/a-checkout/config/base/secrets'],
  ['10c-environment-configmaps', '/projects/p-shop/apps/a-checkout/config/overrides/e-dev/configmaps'],
  ['10d-environment-secrets', '/projects/p-shop/apps/a-checkout/config/overrides/e-prod/secrets'],
  ['10e-inherited-configmaps', '/projects/p-shop/apps/a-checkout/config/overrides/e-staging/configmaps'],
  ['10f-empty-secrets', '/projects/p-shop/apps/a-storefront/config/base/secrets'],
  ['10g-config-comparison', '/projects/p-shop/apps/a-checkout/config/compare/deployment?left=base&leftVersion=saved&right=e-dev&rightVersion=saved'],
  ['10h-historical-comparison', '/projects/p-shop/apps/a-checkout/config/compare/configmaps/checkout-api-config?left=e-dev&leftVersion=history:d-checkout-dev-1&right=e-dev&rightVersion=history:d-checkout-dev-2'],
  ['10i-missing-comparison-snapshot', '/projects/p-shop/apps/a-checkout/config/compare/deployment?left=e-staging&leftVersion=deployed&right=base&rightVersion=saved'],
  ['11-config-workflow', '/projects/p-shop/apps/a-checkout/config/workflow'],
  ['12-config-overrides', '/projects/p-shop/apps/a-checkout/config/overrides'],
  ['13-app-resources', '/projects/p-shop/apps/a-checkout/resources'],
  ['13b-app-resources-prod', '/projects/p-shop/apps/a-checkout/resources?env=b-checkout-prod'],
  ['13c-app-log-analyzer', '/projects/p-shop/apps/a-checkout/resources?env=b-checkout-dev&view=analyzer'],
  ['13d-app-log-analyzer-no-pods', '/projects/p-shop/apps/a-checkout/resources?env=b-checkout-staging&view=analyzer'],
  ['14-clusters', '/clusters'],
  ['15a-cluster-overview', '/clusters/c-prod'],
  ['15-cluster-workspace', '/clusters/c-prod?resource=deployments'],
  ['15-cluster-events', '/clusters/c-prod?view=events'],
  ['15-cluster-nodes', '/clusters/c-dev?view=nodes'],
  ['15-cluster-namespaces', '/clusters/c-prod?view=namespaces'],
  ['15b-cluster-resource-tab', '/clusters/c-dev?open=core,pods,shop-dev,checkout-api-5b8d7c9f4-t1n9p'],
  ['15f-cluster-terminal', '/clusters/c-prod/terminal'],
  ['15c-node-detail-summary', '/clusters/c-prod/node/detail/prod-node-01/summary'],
  ['15d-node-detail-conditions', '/clusters/c-prod/node/detail/prod-node-02/node-conditions'],
  ['15e-node-detail-issues', '/clusters/c-prod/node/detail/prod-node-02/summary'],
  ['16-resource-detail', '/clusters/c-prod/resources/apps/deployments/shop-prod/checkout-api/manifest'],
  ['17-audit', '/audit'],
  ['18-settings-members', '/settings/members'],
  ['19-settings-clusters', '/settings/clusters'],
  ['20-settings-environments', '/settings/environments'],
  ['21-settings-credentials', '/settings/credentials'],
  ['22-settings-registries', '/settings/registries'],
  ['23-login', '/login'],
]

const browser = await launchBrowser(baseURL, output)
const results = []
try {
  for (const [name, path] of routes) {
    if (path === '/login') {
      await browser.evaluate("localStorage.removeItem('podry:session')")
      await browser.call('Page.navigate', {url:baseURL + path})
      await browser.until('document.querySelector("#app")?.innerText.length > 20')
    } else await browser.navigate(path)
    await delay(500)
    const text = await browser.evaluate('document.querySelector("#app")?.innerText || ""')
    assert.ok(text.length > 20, '页面为空: ' + path)
    if (path === '/') assert.equal(await browser.evaluate('location.pathname'), '/apps')
    if (path === '/projects') assert.ok(text.includes('项目'))
    await browser.screenshot(name)
    results.push({name,path})
    console.log('PASS ' + name + ' ' + path)
  }
  assert.equal(browser.errors.length, 0, browser.errors.join('\n'))
  assert.equal(browser.warnings.length, 0, browser.warnings.join('\n'))
} finally {
  writeFileSync(resolve(output,'results.json'),JSON.stringify({pages:results,errors:browser.errors,warnings:browser.warnings},null,2))
  await browser.close()
}
console.log('Completed ' + results.length + ' route/state checks; zero runtime errors/warnings')
