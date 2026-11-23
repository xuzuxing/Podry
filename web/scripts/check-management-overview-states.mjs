// 开发服务器专用：只修改隔离 Chrome 页面的内存 Mock，测试结束恢复。
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { launchBrowser, delay } from './lib/browser.mjs'
const output = resolve(import.meta.dirname, '../screenshots-management-overview-states')
const browser = await launchBrowser(process.argv[2] || 'http://127.0.0.1:5196', output)
const { evaluate, until, screenshot } = browser
const checks = []
function check(name, value) { assert.ok(value, name); checks.push(name); console.log('PASS ' + name) }
async function refresh(kind = 'infrastructure') { await evaluate(`document.querySelector('[aria-label="刷新${kind === 'application' ? '应用' : '基础设施'}概览"]').click()`); await until('!!document.querySelector(".management-overview:not([aria-busy=true])")'); await delay(100) }
async function restore() { await evaluate(`(()=>{const db=window.__overviewDB,b=window.__overviewBackup;db.clusters.splice(0,db.clusters.length,...structuredClone(b.clusters));db.applications.splice(0,db.applications.length,...structuredClone(b.applications));db.deployments.splice(0,db.deployments.length,...structuredClone(b.deployments));db.builds.splice(0,db.builds.length,...structuredClone(b.builds));for(const key of Object.keys(db.clusterOverviews))delete db.clusterOverviews[key];Object.assign(db.clusterOverviews,structuredClone(b.clusterOverviews));for(const key of Object.keys(db.workflows))delete db.workflows[key];Object.assign(db.workflows,structuredClone(b.workflows))})()`); }
async function route(path) { await evaluate(`document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(${JSON.stringify(path)})`); await until('!!document.querySelector(".management-overview__body")'); await delay(100) }
try {
  await browser.navigate('/clusters/overview')
  await until('!!document.querySelector(".management-overview__body")')
  await evaluate(`(async()=>{const db=await import('/src/mock/data.ts');window.__overviewDB=db;window.__overviewBackup=structuredClone({clusters:db.clusters,applications:db.applications,deployments:db.deployments,builds:db.builds,clusterOverviews:db.clusterOverviews,workflows:db.workflows})})()`)
  await evaluate(`window.__overviewDB.clusters[0].connectionStatus='unavailable'`)
  await refresh()
  check('Unreachable cluster capacity is excluded from totals', await evaluate(`document.querySelectorAll('.ocode-card')[1].querySelector('strong').textContent==='6'&&document.querySelectorAll('.ocode-card')[2].querySelector('strong').textContent==='12'`))
  check('Partial connectivity exposes warning and reachable count', await evaluate(`document.querySelector('.overview-notice').textContent.includes('资源统计不包含无法连接的集群')&&document.querySelector('.ocode-card strong').textContent==='1'`))
  await screenshot('01-unreachable-cluster')
  await evaluate(`document.querySelector('.overview-notice a').click()`)
  await until('!!document.querySelector(".clusters .t-table__body a")')
  check('Unreachable cluster link applies its destination filter', await evaluate(`location.search.includes('status=unreachable')&&document.querySelector('.clusters').textContent.includes('prod-k8s')&&!document.querySelector('.t-table__body').textContent.includes('dev-k3s')`))
  await route('/clusters/overview')
  await evaluate(`window.__overviewDB.clusters.forEach(cluster=>cluster.connectionStatus='unavailable')`)
  await refresh()
  check('All unreachable clusters render a recovery action', await evaluate(`document.querySelector('.infra-empty').textContent.includes('已添加的集群当前均无法连接')&&document.querySelector('.infra-empty__action').href.endsWith('/clusters')`))
  await evaluate('window.__overviewDB.clusters.splice(0)')
  await refresh()
  check('No clusters offers cluster setup', await evaluate(`document.querySelector('.infra-empty').textContent.includes('尚未添加集群')&&document.querySelector('.infra-empty__action').href.endsWith('/settings/clusters')`))
  await restore(); await refresh()
  await evaluate(`delete window.__overviewDB.clusterOverviews['c-prod']`)
  await refresh()
  check('Failed cluster detail remains visible as Unknown', await evaluate(`document.querySelector('.overview-notice').textContent.includes('读取失败')&&document.querySelector('.overview-donut__legend').textContent.includes('未知')`))
  check('Failed capacity metrics show em dash rather than zero utilisation', await evaluate(`document.querySelector('.cluster-allocation__table tbody tr:last-child').textContent.includes('—')`))
  await screenshot('02-partial-overview-data')
  await restore()
  await evaluate(`(()=>{Object.defineProperty(window.__overviewDB.clusters[0],'name',{get(){throw new Error('Overview test: cluster list unavailable')},configurable:true});return true})()`)
  await refresh()
  check('Top-level failure exposes retryable error state', await evaluate(`document.querySelector('.err__message').textContent.includes('cluster list unavailable')`))
  await restore(); await evaluate('document.querySelector(".err button").click()'); await until('!!document.querySelector(".management-overview__body")')
  check('Retry restores infrastructure dashboard after failure', await evaluate('document.querySelectorAll(".ocode-card").length===3'))

  await route('/apps/overview')
  await evaluate(`window.__overviewDB.applications.splice(0)`)
  await refresh('application')
  check('No applications keeps metrics navigable and zero-valued', await evaluate(`document.querySelectorAll('.ocode-card')[1].querySelector('strong').textContent==='0'&&document.querySelectorAll('.ocode-card')[1].href.endsWith('/apps')`))
  check('No applications shows separate DORA, activity and insights empty states', await evaluate(`document.querySelectorAll('.overview-panel .overview-empty').length===3`))
  await screenshot('03-empty-applications')
  await restore(); await refresh('application')
  await evaluate(`(()=>{const db=window.__overviewDB;const now=new Date().toISOString();const record=db.deployments.find(d=>d.bindingId==='b-checkout-prod');record.status='failed';record.createdAt=now;db.deployments.push({...record,id:'overview-success',status:'succeeded'})})()`)
  await refresh('application')
  check('DORA failure rate derives from production deployments, not failed builds', await evaluate(`[...document.querySelectorAll('.dora-metrics__card')].find(el=>el.textContent.includes('变更失败率')).querySelector('strong').textContent==='50%'`))
  check('DORA does not invent lead time or recovery time from build duration', await evaluate(`[...document.querySelectorAll('.dora-metrics__card')].filter(el=>/平均交付前置时间|平均恢复时间/.test(el.textContent)).every(el=>el.querySelector('strong').textContent==='—')`))
  await screenshot('04-production-metrics')
  await evaluate(`(()=>{const db=window.__overviewDB;const build=db.builds.find(b=>b.appId==='a-checkout');for(let i=0;i<60;i++)db.builds.push({...build,id:'overview-build-'+i,createdAt:new Date().toISOString()})})()`)
  await refresh('application')
  check('Truncated history is disclosed instead of presented as full history', await evaluate(`document.querySelector('.overview-notice').textContent.includes('最近 50 条记录')`))
  await restore()
  await evaluate(`(()=>{const db=window.__overviewDB;const workflow=db.workflows['a-checkout'];const ci=workflow.items.find(p=>p.kind==='ci');const template=db.builds.find(b=>b.appId==='a-checkout');for(let i=0;i<12;i++){const id='overview-ci-'+i;workflow.items.push({...ci,id});db.builds.push({...template,id:'overview-ranked-'+i,pipelineId:id,createdAt:new Date().toISOString()})}})()`)
  await refresh('application')
  check('Pipeline ranking paginates more than ten pipelines', await evaluate(`document.querySelectorAll('.overview-distribution__row').length===10&&!!document.querySelector('[aria-label="流水线触发排行下一页"]')`))
  await evaluate(`document.querySelector('[aria-label="流水线触发排行下一页"]').click()`); await delay(100)
  check('Pipeline ranking next page displays remaining pipelines', await evaluate(`document.querySelector('.overview-pagination').textContent.includes('2 /')&&document.querySelectorAll('.overview-distribution__row').length<10`))
  await evaluate(`(()=>{const select=document.querySelector('[aria-label="流水线触发排行排序方式"]');select.value='asc';select.dispatchEvent(new Event('change',{bubbles:true}))})()`); await delay(100)
  check('Changing ranking order resets pagination', await evaluate(`document.querySelector('.overview-pagination').textContent.includes('1 /')`))
  await restore()
  await evaluate(`(()=>{const db=window.__overviewDB;const app=db.applications[0];for(let i=0;i<101;i++){const id='overview-app-'+i;db.applications.push({...app,id,name:id});db.workflows[id]={version:1,items:[]}}})()`)
  await refresh('application')
  check('Application totals traverse more than one API page', await evaluate(`document.querySelectorAll('.ocode-card')[1].querySelector('strong').textContent===String(window.__overviewBackup.applications.filter(app=>!app.archivedAt).length+101)`))
  check('State coverage emits no runtime errors or warnings', browser.errors.length===0&&browser.warnings.length===0)
  writeFileSync(resolve(output,'results.json'),JSON.stringify({checks,errors:browser.errors,warnings:browser.warnings,boundary:'isolated in-memory frontend Mock states only'},null,2))
  console.log(`PASS ${checks.length} management overview state checks`)
} catch(error) { await screenshot('failure');console.error({errors:browser.errors,warnings:browser.warnings});throw error }
finally { try{await restore()}catch{} await browser.close() }
