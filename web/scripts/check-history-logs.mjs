// Log search and Mock history metadata; no commands or jobs are executed.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
let count = 0
function check(name, value) { assert.ok(value, name); count++; console.log('PASS ' + name) }
try {
  const { searchLogLines: search } = await server.ssrLoadModule('/src/utils/historyLogs.ts')
  const api = await server.ssrLoadModule('/src/api/index.ts')
  const db = await server.ssrLoadModule('/src/mock/data.ts')
  const plain = search('first\r\n\r\nlast\n', '')
  check('保留空行和末尾换行', plain.lines.length === 4 && plain.lines[1].segments[0].text === '')
  check('CRLF 规范为行而不残留回车', plain.lines.every(line => line.segments.every(segment => !segment.text.includes('\r'))))
  check('空搜索没有高亮', plain.count === 0 && plain.lines.every(line => line.segments.every(segment => segment.match === null)))
  const hits = search('Build BUILD build\nrebuild', 'build')
  check('搜索忽略大小写并跨行连续编号', hits.count === 4 && hits.lines[1].segments.find(segment => segment.match !== null).match === 3)
  check('搜索保留原始大小写', hits.lines[0].segments.filter(segment => segment.match !== null).map(segment => segment.text).join('|') === 'Build|BUILD|build')
  check('搜索不会删除原日志', hits.lines.map(line => line.segments.map(segment => segment.text).join('')).join('\n') === 'Build BUILD build\nrebuild')
  for (const query of ['.*', '[Mock]', '(x)', 'a+b?', '$^', '\\', '{2}|']) check('特殊字符按字面匹配 ' + query, search('prefix ' + query + ' suffix', query).count === 1)
  check('没有匹配返回零', search('existing content', 'missing').count === 0)
  check('相邻匹配独立编号', search('aaaa', 'aa').count === 2)
  check('中文和 emoji 搜索保留字符边界', search('失败 🚀 失败 🚀', '🚀').count === 2)
  check('Unicode 大小写不改变后续位置', search('İ MOCK', 'MOCK').lines[0].segments[0].text === 'İ ')
  const html = '<img src=x onerror=alert(1)> & <script>oops</script>'
  check('HTML 标记作为纯文本片段', search(html, 'script').lines[0].segments.map(segment => segment.text).join('') === html)
  check('空日志保留可渲染行', search('', 'text').lines.length === 1)
  const payment = (await api.getBuildLogs('bd-899')).join('\n')
  check('构建日志明确说明 Mock', payment.includes('没有执行构建命令'))
  check('日志使用当前历史关联的镜像和真正 digest', payment.includes('payment-worker:v0.9.7') && payment.includes('artifact digest sha256:45c48'))
  check('日志不串用 checkout 镜像及产物 ID', !payment.includes('checkout-api') && !payment.includes('artifact digest ar-'))
  check('取消日志显示本次 Job', (await api.getBuildLogs('bd-1009')).join('\n').includes('build-checkout-api-1009-a1'))
  await assert.rejects(api.getBuildLogs('bd-1008'), /日志不可用/); count++; console.log('PASS 过期日志保留不可用状态')
  await assert.rejects(api.getBuildLogs('missing'), /构建不存在/); count++; console.log('PASS 缺失记录不制造日志')
  const build = db.builds.find(item => item.id === 'bd-899')
  const original = { ...build }
  try {
    build.artifactId = 'ar-1011'
    check('错误应用镜像关联不能泄漏到日志', !(await api.getBuildLogs(build.id)).join('\n').includes('checkout-api'))
    build.artifactId = 'missing'
    check('缺失产物元数据明确说明历史缺失', (await api.getBuildLogs(build.id)).join('\n').includes('historical artifact metadata not recorded'))
    for (const [status, expected] of [['queued', 'queued; waiting'], ['unknown', 'execution status unknown'], ['canceling', 'waiting for worker confirmation']]) {
      build.status = status
      const logs = (await api.getBuildLogs(build.id)).join('\n')
      check(status + ' 不被解释成成功', logs.includes(expected) && !logs.includes('build succeeded'))
    }
  } finally { Object.assign(build, original) }
  console.log(`${count} history log checks passed`)
} finally { await server.close() }
