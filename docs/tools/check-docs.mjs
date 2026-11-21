// Structural checks only: this is not an OpenAPI conformance engine or SQL parser.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(resolve(dir,entry.name)):[resolve(dir,entry.name)]);
const files=walk(root), failures=[];
const check=(value,message)=>{if(!value)failures.push(message);};
let links=0;
for(const file of files.filter(f=>f.endsWith('.md'))){
  const text=readFileSync(file,'utf8');
  check(!text.includes('\uFFFD'),`Invalid replacement character: ${file}`);
  for(const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){
    let target=match[1].trim().replace(/^<|>$/g,'').split('#')[0];
    if(!target||/^[a-z]+:/i.test(target))continue;
    target=decodeURIComponent(target);
    const path=resolve(dirname(file),target);links++;
    check(existsSync(path),`Missing link: ${relative(root,file)} -> ${target}`);
  }
}
const api=JSON.parse(readFileSync(resolve(root,'api/openapi.json'),'utf8'));
check(api.openapi==='3.1.0','Expected OpenAPI 3.1.0');
const ids=new Set();let operations=0,refs=0;
function inspect(node){
  if(!node||typeof node!=='object')return;
  if(node.$ref){refs++;let target=api;for(const part of node.$ref.replace(/^#\//,'').split('/'))target=target?.[part];check(!!target,`Unresolved ref: ${node.$ref}`);}
  if(node.required&&node.properties)for(const key of node.required)check(Object.hasOwn(node.properties,key),`Required property ${key} is undefined`);
  for(const child of Object.values(node))inspect(child);
}
inspect(api);
for(const [path,methods] of Object.entries(api.paths))for(const [method,op] of Object.entries(methods)){
  operations++;check(!ids.has(op.operationId),`Duplicate operation ID: ${op.operationId}`);ids.add(op.operationId);
  for(const [,name] of path.matchAll(/\{([^}]+)\}/g))check(op.parameters.some(p=>p.name===name&&p.in==='path'&&p.required),`Missing path parameter ${method} ${path}: ${name}`);
  check(!!op.responses.default,`Missing error response ${op.operationId}`);
  check(!path.startsWith('/api/'),'Prefix duplicated in path');
}
const sql=readFileSync(resolve(root,'data/schema.sql'),'utf8');
const tables=[...sql.matchAll(/CREATE TABLE\s+(\w+)\s*\(/g)].map(m=>m[1]);
check(new Set(tables).size===tables.length,'Duplicate SQL table name');
for(const [,table] of sql.matchAll(/REFERENCES\s+(\w+)\s*\(/g))check(tables.includes(table),`Unknown SQL reference table ${table}`);
const model=readFileSync(resolve(root,'data/01-data-model.md'),'utf8');
for(const table of tables)check(model.includes(`| ${table} |`),`Table missing from model catalog: ${table}`);
for(const schema of ['Build','Deployment','ReleaseRequest']){
  const values=api.components.schemas[schema].properties.status.enum;
  const flow=readFileSync(resolve(root,'product/02-workflows-and-states.md'),'utf8');
  for(const value of values)check(flow.includes(value),`State undocumented ${schema}.${value}`);
}
for(const file of ['prototype.js','prototype.css'])check(statSync(resolve(root,'prototype',file)).size>100,`Empty prototype asset ${file}`);
const html=readFileSync(resolve(root,'prototype/index.html'),'utf8');
check(!/(src|href)=["']https?:/i.test(html),'Prototype must be offline');
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}else console.log(`PASS: ${files.filter(f=>f.endsWith('.md')).length} Markdown files, ${links} local links, ${operations} HTTP operations, ${refs} schema refs, ${tables.length} SQL tables. Structural checks only; SQL not executed.`);
assert(operations>=60);
