// Offline URL boundaries and global sort-before-page checks; frontend Mock only.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
const server = await createServer({ configFile: false, resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } }, server: { middlewareMode: true, hmr: false }, appType: 'custom' })
let checks = 0
function check(name, value) { assert.ok(value, name); checks++; console.log('PASS ' + name) }
try {
  const { readResourceListState: read, resourcePage: page, lastResourcePage: last } = await server.ssrLoadModule('/src/utils/resourceListState.ts')
  const { compareResourceRows } = await server.ssrLoadModule('/src/utils/resourceListing.ts')
  const keys = ['name', 'namespace', 'cpu']
  check('Missing query uses first page, 100 rows, namespace ASC', JSON.stringify(read({}, keys, 'namespace')) === JSON.stringify({ pageNumber: 1, pageSize: 100, sortBy: 'namespace', sortOrder: 'ASC' }))
  check('Explicit deep link reads uppercase DESC', read({ pageNumber: '2', pageSize: '150', sortBy: 'cpu', sortOrder: 'DESC' }, keys, 'name').sortOrder === 'DESC')
  for (const input of ['0', '-1', '1.2', 'NaN', 'Infinity', '1e3', '99999999999999999999', '2junk']) check(`Invalid page ${input} falls back safely`, read({ pageNumber: input }, keys, 'name').pageNumber === 1)
  check('Repeated parameters use first value', read({ pageNumber: ['2', '3'], sortBy: ['cpu', 'name'] }, keys, 'name').pageNumber === 2)
  check('Leading zeros normalize to integer', read({ pageNumber: '002' }, keys, 'name').pageNumber === 2)
  check('Unknown sort key falls back to current Kind default', read({ sortBy: 'printer:99' }, keys, 'namespace').sortBy === 'namespace')
  check('Invalid sort direction falls back to ASC', read({ sortOrder: 'descending' }, keys, 'name').sortOrder === 'ASC')
  for (const size of [20, 40, 50, 100, 150, 200]) check(`Supported retained page size ${size}`, read({ pageSize: String(size) }, keys, 'name').pageSize === size)
  check('Unknown page size does not allow unbounded rendering', read({ pageSize: '1000000000' }, keys, 'name').pageSize === 100)
  check('Empty table has a safe first page', last(0, 100) === 1)
  check('Exact boundary does not add an empty page', last(200, 100) === 2)
  const rows = Array.from({ length: 205 }, (_, i) => ({ id: String(i), name: `node-${205 - i}`, namespace: 'default', kind: 'Node', group: '', status: 'Ready', age: '1d', fields: { cpu: `${i}%` }, sortValues: { cpu: i } }))
  const state = read({ pageNumber: '2', sortBy: 'name' }, keys, 'name')
  const result = page(rows, state, (a, b) => compareResourceRows(a, b, 'name'))
  check('Global numeric name sort happens before slicing page 2', result.length === 100 && result[0].name === 'node-101' && result.at(-1).name === 'node-200')
  check('Paging never mutates source order', rows[0].name === 'node-205')
  check('Oversized page clamps to actual final rows', page(rows, { ...state, pageNumber: 9999 }, (a, b) => compareResourceRows(a, b, 'name')).length === 5)
  check('Descending metrics sort spans original page boundaries', page(rows, { ...state, pageNumber: 1 }, (a, b) => compareResourceRows(a, b, 'cpu', true))[0].fields.cpu === '204%')
  check('No results never leaks earlier rows', page([], state, () => 0).length === 0)
  console.log(`PASS ${checks} resource pagination offline checks`)
} finally { await server.close() }
