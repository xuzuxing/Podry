// 两个 Manager 概览的浏览器交互与布局验证；使用现有前端 Mock。
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { launchBrowser, delay } from './lib/browser.mjs'

const base = process.argv[2] || 'http://127.0.0.1:5197'
const output = resolve(import.meta.dirname, '../screenshots-management-overview-parity')
const browser = await launchBrowser(base, output)
const { evaluate, until, screenshot, call } = browser
const checks = []
function check(name, value) { assert.ok(value, name); checks.push(name); console.log('PASS ' + name) }
async function tap(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await delay(150) }
async function select(label, value) { await evaluate(`(()=>{const select=document.querySelector('select[aria-label="${label}"]');select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}))})()`); await delay(150) }
async function tab(label) { await evaluate(`[...document.querySelectorAll('[role=tab]')].find(el=>el.textContent.trim()===${JSON.stringify(label)}).click()`); await delay(150) }
async function go(path) { await browser.navigate(path); await until('!!document.querySelector(".management-overview__body")'); await delay(100) }
async function scrollPanel(title) { await evaluate(`[...document.querySelectorAll('.overview-panel')].find(el=>el.querySelector('h3').textContent===${JSON.stringify(title)}).scrollIntoView({block:'start'})`); await delay(100) }
async function menu(label, entry) {
  await tap(`[aria-label="${label}"]`)
  const target = `[...document.querySelectorAll('.t-dropdown__item')].find(el=>el.checkVisibility()&&el.textContent.trim()===${JSON.stringify(entry)})`
  await until(`!!(${target})`)
  await evaluate(`(${target}).click()`)
  await until('!!document.querySelector(".management-overview__body")')
}

try {
  await go('/apps/overview')
  check('Application overview uses its own title and application navigation', await evaluate(`document.querySelector('.topbar h1').textContent==='应用概览'&&document.title==='应用概览 · Podry'&&!!document.querySelector('.primary-nav__group.is-active a[href="/apps"]')&&!document.querySelector('.shell__page--application')`))
  await menu('应用更多入口', '应用概览')
  check('Application menu opens the canonical overview route', await evaluate(`location.pathname==='/apps/overview'`))
  check('Nine reference metric cards, three columns with 8px gaps', await evaluate(`document.querySelectorAll('.ocode-card').length===9&&getComputedStyle(document.querySelector('.overview-grid')).columnGap==='8px'`))
  check('Overview fills shell without duplicate page padding', await evaluate(`getComputedStyle(document.querySelector('.shell__page')).padding==='0px'`))
  check('Unavailable scanning and GitOps metrics use unknown instead of zero', await evaluate(`[...document.querySelectorAll('.ocode-card')].filter(el=>/安全扫描|GitOps/.test(el.textContent)).every(el=>el.querySelector('strong').textContent==='—')`))
  check('DORA, activity and pipeline insights retain reference order', await evaluate(`JSON.stringify([...document.querySelectorAll('.overview-panel h3')].map(el=>el.textContent))===JSON.stringify(['DORA 效能指标','触发次数与构建耗时','流水线触发排行'])`))
  check('DORA avoids fabricated recovery or lead time when production has no completed deployments', await evaluate(`document.querySelector('.dora-metrics .overview-empty strong')?.textContent==='暂无 DORA 指标'`))
  check('Activity line chart has daily points and numeric summary', await evaluate(`document.querySelectorAll('.activity-chart circle').length>0&&Number(document.querySelector('.activity-chart__tabs strong').textContent)>0`))
  await screenshot('01-application-overview')
  await tap('#activity-tab-duration')
  check('Average build time switches chart and preserves units', await evaluate(`document.querySelector('#activity-tab-duration').getAttribute('aria-selected')==='true'&&document.querySelector('.activity-chart__axis-title').textContent.includes('分钟')`))
  await tap('#activity-tab-deployments')
  check('Deployment chart uses deployment records', await evaluate(`document.querySelector('.activity-chart__axis-title').textContent==='部署触发次数'`))
  await tap('.activity-chart__legend button')
  check('Chart legend toggles dataset visibility', await evaluate(`document.querySelector('.activity-chart__legend button').getAttribute('aria-pressed')==='false'`))
  await tap('.activity-chart__legend button')
  await select('构建与部署时间范围', 'lastMonth')
  check('Empty activity duration renders explicit empty state', await evaluate(`document.querySelector('.activity-chart .overview-empty strong')?.textContent==='暂无部署触发记录'`))
  await select('构建与部署时间范围', 'month')
  await select('DORA 指标时间范围', '7')
  check('DORA time range responds independently', await evaluate(`document.querySelector('select[aria-label="DORA 指标时间范围"]').value==='7'&&document.querySelector('select[aria-label="构建与部署时间范围"]').value==='month'`))
  await tab('部署流水线')
  check('Deployment insights group by environment and deep-link to deployment history', await evaluate(`document.querySelector('.overview-distribution__label').href.includes('/deployments?env=e-')`))
  const deploymentHref = await evaluate(`document.querySelector('.overview-distribution__label').getAttribute('href')`)
  await select('流水线触发排行排序方式', 'asc')
  check('Pipeline trigger ranking sorts numerically', await evaluate(`(()=>{const values=[...document.querySelectorAll('.overview-distribution__value')].map(el=>Number(el.textContent));return values.every((value,i)=>!i||value>=values[i-1])})()`))
  await scrollPanel('流水线触发排行'); await screenshot('02-application-activity-insights')
  await evaluate(`document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify(deploymentHref)})`)
  await until('!!document.querySelector(".deployment-activity")')
  check('Insight destination opens real deployment workspace', await evaluate(`document.querySelector('.deployment-activity')!==null&&location.search.includes('env=e-')`))
  await go('/apps/overview')
  const beforeRefresh = await evaluate(`document.querySelectorAll('.ocode-card')[4].querySelector('strong').textContent`)
  await tap('[aria-label="刷新应用概览"]'); await until('!!document.querySelector(".management-overview__body")')
  check('Refresh recomputes counters without accumulating external image count', await evaluate(`document.querySelectorAll('.ocode-card')[4].querySelector('strong').textContent===${JSON.stringify(beforeRefresh)}`))

  await go('/clusters/overview')
  check('Infrastructure overview selects its own title and cluster navigation', await evaluate(`document.querySelector('.topbar h1').textContent==='基础设施概览'&&document.title==='基础设施概览 · Podry'&&!!document.querySelector('.primary-nav__group.is-active a[href="/clusters"]')&&!document.querySelector('.topbar--workspace')`))
  await menu('集群资源更多入口', '基础设施概览')
  check('Cluster menu opens the canonical infrastructure overview route', await evaluate(`location.pathname==='/clusters/overview'`))
  check('Infrastructure cards show reachable CPU cores and memory GiB', await evaluate(`document.querySelectorAll('.ocode-card').length===3&&document.querySelectorAll('.ocode-card')[1].textContent.includes('核')&&document.querySelectorAll('.ocode-card')[2].textContent.includes('GiB')`))
  check('Cluster and node sections follow reference vertical order', await evaluate(`JSON.stringify([...document.querySelectorAll('.overview-panel h3')].map(el=>el.textContent))===JSON.stringify(['集群健康状态','节点错误','节点调度状态','集群数量分布','集群容量与资源分配','节点数量分布'])`))
  check('Node scheduling exposes unknown nodes and actual unschedulable node', await evaluate(`(()=>{const panel=[...document.querySelectorAll('.overview-panel')].find(el=>el.querySelector('h3').textContent==='节点调度状态');return panel.textContent.includes('未知')&&panel.textContent.includes('不可调度')})()`))
  await screenshot('03-infrastructure-overview')
  await tap('[aria-label="查看健康：2"]'); await until('!!document.querySelector(".health-details__table")')
  check('Health chart opens matching cluster details', await evaluate(`document.querySelectorAll('.health-details__table tbody tr').length===2`))
  await screenshot('06-cluster-health-details')
  await evaluate(`document.querySelector('.t-drawer__close-btn').click()`); await delay(300)
  await tap('[aria-label="查看不可调度：1"]'); await until('!!document.querySelector(".health-details__table")')
  check('Scheduling chart opens actual cordoned node', await evaluate(`document.querySelectorAll('.health-details__table tbody tr').length===1&&document.querySelector('.health-details__table tbody').textContent.includes('prod-node-02')`))
  const nodeHref = await evaluate(`document.querySelector('.health-details__table a').getAttribute('href')`)
  await evaluate(`document.querySelector('.t-drawer__close-btn').click()`); await delay(300)
  await tap('[aria-label="查看未知：6"]'); await until('!!document.querySelector(".health-details .overview-empty")')
  check('Unknown node slice explains missing detail without invented node identities', await evaluate(`document.querySelector('.health-details .overview-empty').textContent.includes('节点详情不可用')`))
  await evaluate(`document.querySelector('.t-drawer__close-btn').click()`); await delay(300)
  await evaluate(`document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify(nodeHref)})`)
  await until('location.pathname.includes("prod-node-02/summary")')
  check('Health detail links resolve to the existing node detail route', await evaluate('location.pathname.includes("/node/detail/prod-node-02/summary")'))
  await go('/clusters/overview')
  await tab('按集群版本')
  check('Cluster version grouping uses Kubernetes versions', await evaluate(`[...document.querySelectorAll('.overview-distribution')][0].textContent.includes('v1.')`))
  await select('集群数量分布排序方式', 'az')
  check('Cluster name sorting is deterministic', await evaluate(`(()=>{const values=[...document.querySelectorAll('.overview-distribution')[0].querySelectorAll('.overview-distribution__label')].map(el=>el.textContent);return values.length>1&&values.every((value,i)=>!i||value.localeCompare(values[i-1], 'zh-CN')>=0)})()`))
  await select('资源分配排序字段', 'cpuCapacity')
  check('Capacity numeric sorting defaults to highest first', await evaluate(`document.querySelector('.cluster-allocation__table tbody tr a').href.includes('c-prod')&&document.querySelector('select[aria-label="资源分配排序方向"]').value==='desc'`))
  await select('资源分配排序方向', 'asc')
  check('Capacity ascending sorting changes cluster order', await evaluate(`document.querySelector('.cluster-allocation__table tbody tr a').href.includes('c-dev')`))
  check('Capacity separates utilisation, requests and limits', await evaluate(`document.querySelectorAll('.cluster-allocation__values').length===4&&document.querySelectorAll('.cluster-allocation__request').length===4`))
  await scrollPanel('集群容量与资源分配'); await screenshot('04-infrastructure-allocation-nodes')
  await tab('按自动扩缩容工具')
  check('Autoscaler grouping retains unavailable node details as unknown', await evaluate(`[...document.querySelectorAll('.overview-distribution')][1].textContent.includes('未知（详情不可用）')`))
  await tab('按集群')
  check('Node counts deep-link into existing cluster node list', await evaluate(`[...document.querySelectorAll('.overview-distribution')][1].querySelector('a').href.includes('resource=nodes')`))
  await tap('[aria-label="刷新基础设施概览"]'); await until('!!document.querySelector(".management-overview__body")')
  check('Infrastructure refresh displays Chinese 24-hour timestamp', await evaluate(`/更新于 (?:[01]\\d|2[0-3]):[0-5]\\d/.test(document.querySelector('.infra-updated').textContent)`))

  for (const [legacy, canonical] of [['/application-management/overview', '/apps/overview'], ['/infrastructure-management/overview', '/clusters/overview']]) {
    await go(`${legacy}?source=bookmark#overview`)
    check(`Legacy ${legacy} redirects with query and hash intact`, await evaluate(`location.pathname===${JSON.stringify(canonical)}&&location.search==='?source=bookmark'&&location.hash==='#overview'`))
  }
  await browser.navigate('/clusters/c-prod')
  await until('!!document.querySelector(".ws")')
  check('Cluster detail still resolves to its workspace', await evaluate(`!!document.querySelector('.topbar--workspace')&&!document.querySelector('.management-overview')`))
  await browser.navigate('/projects/p-shop/apps/a-checkout/overview')
  await until('!!document.querySelector(".app-workspace")')
  check('Individual application overview remains a separate workspace', await evaluate(`!!document.querySelector('.shell__page--application')&&!document.querySelector('.management-overview')`))

  for (const width of [1280, 1024, 800]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
    for (const [name, path] of [['application', '/apps/overview'], ['infrastructure', '/clusters/overview']]) {
      await go(path)
      check(`${name} overview fits ${width}px without shell overflow`, await evaluate(`document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.shell__page').scrollWidth<=document.querySelector('.shell__page').clientWidth+1`))
      if (width === 1280) await screenshot(`05-${name}-1280`)
    }
  }
  check('No runtime errors or Vue warnings', browser.errors.length === 0 && browser.warnings.length === 0)
  writeFileSync(resolve(output, 'results.json'), JSON.stringify({ checks, errors: browser.errors, warnings: browser.warnings, boundary: 'frontend Mock; no backend or live cluster validation' }, null, 2))
  console.log(`PASS ${checks.length} management overview browser checks`)
} catch (error) { await screenshot('failure'); console.error({ errors: browser.errors, warnings: browser.warnings }); throw error }
finally { await browser.close() }
