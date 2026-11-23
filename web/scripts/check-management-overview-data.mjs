// 日历边界和 Kubernetes 数值口径回归；不连接后端。
import assert from 'node:assert/strict'
import { createServer } from 'vite'
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
let count = 0
function check(name, value) { assert.ok(value, name); console.log('PASS ' + name); count++ }
try {
  const { parseQuantity, percent, periodBounds, inPeriod, sortDistribution, formatDuration } = await server.ssrLoadModule('/src/utils/managementOverview.ts')
  check('Millicores convert to CPU cores', parseQuantity('1500m', 'cpu') === 1.5)
  check('Micro and nanocores retain their units', parseQuantity('1000000u', 'cpu') === 1 && parseQuantity('1000000000n', 'cpu') === 1)
  check('CPU core capacity remains numeric', parseQuantity('12', 'cpu') === 12)
  check('Gi and Mi sum in the same byte unit', parseQuantity('1Gi', 'memory') === parseQuantity('1024Mi', 'memory'))
  check('Binary and decimal memory suffixes remain distinct', parseQuantity('1G', 'memory') === 1e9 && parseQuantity('1Gi', 'memory') === 2 ** 30)
  check('Missing quantities are unknown, rather than zero', parseQuantity(undefined, 'memory') === null && parseQuantity('', 'cpu') === null)
  check('Invalid quantities never leak NaN', parseQuantity('NA', 'cpu') === null && parseQuantity('1.2.3Gi', 'memory') === null)
  check('Zero capacity remains valid', parseQuantity('0', 'cpu') === 0)
  check('Percent parser does not treat CPU cores as percent', percent('6') === null && percent('6%') === 6)
  check('Overcommitted requests retain values above 100 percent', percent('150%') === 150)
  check('Unavailable percentages remain unknown', percent('NA') === null && percent(undefined) === null)
  const now = new Date(2026, 10, 23, 15, 30)
  const today = periodBounds('today', now)
  check('Today starts at local midnight', today.start === new Date(2026, 10, 23).getTime() && today.days === 1)
  check('This week starts on Monday', periodBounds('week', now).start === new Date(2026, 10, 23).getTime())
  check('This month uses elapsed calendar days', periodBounds('month', now).days === 23)
  check('Relative seven days includes today once', periodBounds('7', now).days === 7 && periodBounds('7', now).start === new Date(2026, 10, 17).getTime())
  const previous = periodBounds('lastMonth', now)
  check('Last month excludes the first instant of this month', previous.days === 31 && previous.end === new Date(2026, 10, 1).getTime() && !inPeriod(new Date(previous.end).toISOString(), 'lastMonth', now))
  check('Future records do not enter current metrics', !inPeriod(new Date(now.getTime() + 1).toISOString(), 'month', now))
  check('Invalid record timestamps are excluded', !inPeriod('not-a-date', 'month', now))
  const rows = [{ id: 'a', label: 'B', value: 2 }, { id: 'b', label: 'A', value: 10 }]
  check('Trigger counts sort numerically', sortDistribution(rows, 'desc')[0].value === 10)
  check('Alphabetical grouping sort uses labels', sortDistribution(rows, 'az')[0].label === 'A')
  check('Sorting does not mutate the source array', rows[0].value === 2)
  check('Chinese duration units preserve unknown, zero, seconds, minutes and hours', formatDuration(null) === '—' && formatDuration(0) === '0 秒' && formatDuration(0.5) === '30 秒' && formatDuration(7) === '7 分钟' && formatDuration(65) === '1 小时 5 分钟')
  const previousTZ = process.env.TZ
  try {
    process.env.TZ = 'America/New_York'
    check('Calendar day count survives daylight saving boundary', periodBounds('7', new Date(2026, 10, 4, 15)).days === 7)
  } finally { if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ }
  console.log(`PASS ${count} management overview data checks; no backend validation`)
} finally { await server.close() }
