// YAML draft/row identity checks and Mock persistence. No backend or cluster calls.
import assert from 'node:assert/strict'
import { effectScope, shallowRef } from 'vue'
import { createServer } from 'vite'
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' })
let count = 0
function check(name, value) { assert.ok(value, name); count++; console.log('PASS ' + name) }
try {
  const { readConfigData: read, changeConfigData: change, maskedConfigData: mask } = await server.ssrLoadModule('/src/utils/configEntryData.ts')
  const { parseEntryData: parse } = await server.ssrLoadModule('/src/utils/configEntries.ts')
  const { useConfigDataTable } = await server.ssrLoadModule('/src/composables/useConfigDataTable.ts')
  let source = '# file comment\nZ: z # inline\nA: |\n  first\n  second\n'
  source = change(source, {type:'key',index:0,value:'RENAMED'})
  check('改名保留原值和行内注释', parse(source).data.RENAMED === 'z' && source.includes('# inline'))
  check('改名保留文件注释和多行格式', source.includes('# file comment') && source.includes('A: |') && parse(source).data.A === 'first\nsecond\n')
  const duplicate = change(source, {type:'key',index:0,value:'A'})
  check('重复键两个值均留在 GUI', read(duplicate).rows.length === 2 && read(duplicate).rows[0].value === 'z' && read(duplicate).rows[1].value.includes('first'))
  check('重复键逐行校验并阻止保存', read(duplicate).rows.every(row => row.error.includes('重复')) && !!parse(duplicate).error)
  const repaired = change(duplicate, {type:'key',index:0,value:'FIXED'})
  check('重复键可改名恢复且没有丢值', !parse(repaired).error && parse(repaired).data.FIXED === 'z')
  const blank = change(source, {type:'add'})
  check('空行进入 YAML 草稿并使保存无效', blank !== source && read(blank).rows[0].error.includes('不能为空') && !!parse(blank).error)
  check('空行位于表格数据开头', read(blank).rows[0].key === '' && read(blank).rows[1].key === 'RENAMED')
  const invalid = change(source, {type:'key',index:0,value:'bad key'})
  check('非法键留在 GUI 可修正', read(invalid).rows[0].key === 'bad key' && !!read(invalid).rows[0].error && !!parse(invalid).error)
  check('删除重复键恢复有效数据', !parse(change(duplicate,{type:'remove',index:0})).error)
  check('删除最终行得到空对象', Object.keys(parse(change('A: a\n',{type:'remove',index:0})).data).length === 0)
  check('越界编辑不修改文档', change(source,{type:'value',index:20,value:'x'}) === source)
  check('数字状键保留 YAML 顺序', read('"10": ten\n"2": two\n').rows.map(row => row.key).join(',') === '10,2')
  const proto = change('__proto__: original\nconstructor: safe\n', {type:'value',index:0,value:'updated'})
  check('原型字段作为普通 YAML 数据修改', Object.hasOwn(parse(proto).data, '__proto__') && parse(proto).data.__proto__ === 'updated' && ({}).polluted === undefined)
  const anchor = 'BASE: &base one\nCOPY: *base\n'
  check('字符串别名在 GUI 解析', read(anchor).rows[1].value === 'one')
  check('修改锚点同步别名', read(change(anchor,{type:'value',index:0,value:'two'})).rows.every(row => row.value === 'two'))
  check('单独修改别名不影响锚点', parse(change(anchor,{type:'value',index:1,value:'own'})).data.BASE === 'one')
  assert.throws(() => change(anchor,{type:'remove',index:0})); count++; console.log('PASS 删除被引用锚点拒绝破坏文档')
  for (const value of ['A: 12\n', 'A: true\n', 'A: [a,b]\n', 'A:\n  nested: string\n', '- list\n', 'A: [\n']) check('不支持的结构保留 YAML 修正 ' + value.trim(), !!read(value).error && change(value,{type:'add'}) === value)
  const secret = '# private-comment\nTOKEN: &token private-token # private-inline\nCOPY: *token\n'
  check('遮蔽移除值注释和锚点', !mask(secret).includes('private') && !mask(secret).includes('&token') && !mask(secret).includes('*token'))
  check('遮蔽保留键集合', read(mask(secret)).rows.map(row => row.key).join(',') === 'TOKEN,COPY')
  check('无效 YAML 遮蔽不泄漏错误片段', !mask('TOKEN: [private-token').includes('private-token'))
  check('重复 Secret 键在遮蔽文档仍可校验', read(mask('A: first\nA: second')).rows.every(row => row.error.includes('重复')))
  const scope = effectScope()
  scope.run(() => {
    const yaml = shallowRef('Z: z\nA: a\n')
    const table = useConfigDataTable(() => yaml.value, value => { yaml.value = value })
    check('初始按键升序显示', table.displayed.value.map(row => row.key).join(',') === 'A,Z')
    const original = yaml.value
    table.sort()
    check('排序不写入草稿', yaml.value === original && table.displayed.value[0].key === 'Z')
    const id = table.displayed.value[0].id
    table.change({type:'key',index:0,value:'B'})
    check('编辑键名保留行标识和显示位置', table.displayed.value[0].id === id && table.displayed.value[0].key === 'B')
    table.change({type:'add'})
    check('新增行显示在首行且标识独立', table.displayed.value[0].key === '' && new Set(table.displayed.value.map(row => row.id)).size === 3)
    table.change({type:'remove',index:0})
    check('删除新增行保留原行标识', table.displayed.value[0].id === id)
    yaml.value = 'OTHER: safe\n'
    check('切换数据重置行且无旧错误', table.displayed.value.length === 1 && table.displayed.value[0].key === 'OTHER' && !table.mutationError.value)
  })
  scope.stop()
  console.log(`${count} config data checks passed`)
} finally { await server.close() }
