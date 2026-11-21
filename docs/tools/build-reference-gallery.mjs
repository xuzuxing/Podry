// Build a local, network-free gallery from retained screenshots; does not access Devtron.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../references/devtron-live/',import.meta.url));
const path=resolve(root,'manifest.json');const m=JSON.parse(readFileSync(path,'utf8'));
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
for(const s of m.screenshots){const bytes=readFileSync(resolve(root,s.file));s.sha256=createHash('sha256').update(bytes).digest('hex');s.width=bytes.readUInt32BE(16);s.height=bytes.readUInt32BE(20);if(s.width!==1440||s.height!==1000)throw Error('Unexpected viewport '+s.file);}
writeFileSync(path,JSON.stringify(m,null,2)+'\n');
writeFileSync(resolve(root,'gallery.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Devtron 实例截图参考</title><link rel="icon" href="data:,"><style>body{margin:0;background:#f2f5f9;color:#203148;font:14px/1.7 Arial,"Microsoft YaHei",sans-serif}header{padding:28px 32px;background:white;border-bottom:1px solid #d4dce5;position:sticky;top:0;z-index:2}h1{font-size:22px;margin:0}p{margin:6px 0;color:#52657d}a{color:#0066cc}button{font:inherit;padding:5px 14px;background:white;border:1px solid #cbd5e1;border-radius:4px;cursor:pointer;margin-right:8px}button.active{background:#0066cc;color:white;border-color:#0066cc}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;padding:28px 32px}article{background:white;border:1px solid #d4dce5;border-radius:5px;overflow:hidden}article[hidden]{display:none}article img{width:100%;height:auto;display:block;background:#edf0f5;border-bottom:1px solid #d4dce5}article .info{padding:16px 20px}h2{font-size:16px;margin:0}code{font:11px/1.6 Consolas,monospace;overflow-wrap:anywhere}footer{padding:24px 32px;color:#52657d}@media(max-width:900px){.grid{grid-template-columns:1fr;padding:16px}header{position:static;padding:20px}}</style><header><h1>Devtron 真实实例交互参考</h1><p>${m.recordedDate} · ${m.screenshots.length} 张 · 1440 × 1000 · 用户测试部署 · 仅查看与非提交表单</p><p><a href="../../prototype/index.html">打开 Podry V2 原型 ↗</a>　<a href="README.md">观察记录与限制</a>　<a href="manifest.json">截图索引与 SHA-256</a></p><button class="active" data-category="all">全部</button><button data-category="applications">应用 CI/CD</button><button data-category="resources">资源浏览器</button></header><main class="grid">${m.screenshots.map(s=>`<article data-group="${s.category}"><a href="${s.file}" target="_blank"><img loading="lazy" src="${s.file}" alt="${esc(s.title)}"></a><div class="info"><h2>${esc(s.id.slice(0,2))} · ${esc(s.title)}</h2><p>${esc(s.observation)}</p><code>${esc(s.route)}</code></div></article>`).join('')}</main><footer>以上为远程真实页面；Podry 原型中的业务数据与写操作另行使用本地模拟。未触发构建、发布、资源写入或远程终端连接。</footer><script>document.querySelectorAll('[data-category]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-category]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('article').forEach(x=>x.hidden=b.dataset.category!=='all'&&x.dataset.group!==b.dataset.category);});</script></html>`,'utf8');
const intro=`# Devtron 测试实例观察记录

观察日期：2026-11-19；时区：Asia/Shanghai；视口：1440 × 1000。来源：用户授权访问的 Devtron 测试部署。实际版本和 edition 未读取，不将这些页面称为最新版本。

入口：[截图画廊](gallery.html) · [机器索引与哈希](manifest.json) · [当前原型](../../prototype/index.html) · [页面规格](../../prototype/01-page-spec.md)。

## 观察方法与边界

使用临时隔离的本机 Chrome，通过 CDP 登录、导航、打开不提交的表单、读取资源和日志并截图。会话结束后关闭拥有的浏览器并清理临时认证配置。没有将登录凭据、Cookie、Token、认证存储、kubeconfig 写入项目。截图保留页面原始像素，包括部署拥有的应用名称与非凭据元信息，用作项目内设计参考。

首次 REA 浏览器场景在初始导航前超时并确认清理；随后成功采集来自本机 CDP，不标为 REA Evidence。未采集网络请求正文、认证头或浏览器存储。表单打开和只读页面不能证明提交后的行为。

此次没有点击远程 Start Build、Deploy、Update Pipeline、Save Configuration、Save Changes、Apply、Delete、Scale、Restart，也没有打开远程终端会话。实际终端行为、写入确认、失败恢复、权限角色差异仍需独立验收。

## 已确认的结构

- 应用横向功能页签分开组织 Overview、App Details、Build & Deploy、Build History、Deployment History、Configurations。
- 配置有独立左菜单；进入 Base Configurations / Environment Override 后，侧栏切成聚焦编辑导航。
- Select Material / Select Image 与管线编辑使用右侧大抽屉，并保留背景页面；临时面板不是新的全屏导航页。
- 构建/发布历史采用左侧选择器和时间条目、右侧执行详情。
- 全局资源详情打开为可保留和关闭的工作区页签，内层再切 Manifest / Events / Logs / Terminal。
- App Details 内的资源详情同样保留资源页签，但仍在应用头部、环境、健康状态下展示；只有 All resources 进入全局资源工作区。

## 截图目录

| 编号 | 页面 | 观察到的内容 |
| --- | --- | --- |
`;
const rows=m.screenshots.map(s=>`| ${s.id.slice(0,2)} | [${s.title}](${s.file}) | ${s.observation} |`).join('\n');
const tail=`

## 现场限制与 Podry 差异

1. 实例已存在一个外部镜像部署流程和一个独立 CI；本期 Podry 仍限定一 CI 多 CD，以及已有镜像交付，未增加任意流程引擎。
2. 历史 CI 日志显示未配置存储，不能将其替换为成功日志来证明现场能力。外部镜像的 Source 显示 Data not available；资源 Events 当前也为空。
3. 截图 15 的节点路由实际落在 node/longhorn.io，但渲染的是 Nodes。此处如实保留，不将路径中的 group 当作 Kubernetes Node 的 API 语义。
4. 资源创建抽屉宣告支持多 YAML；本地原型明确只支持单个 ConfigMap。
5. 生产手动发布、固定 digest、Review 后单独确认、未知结果保留占用，是 Podry 已确认的业务约定；未在远程实例执行这些写入。
6. 本地原型没有复刻 Devtron 品牌、Chart 商店、Job 平台、指标监控和全部高级字段。它对齐本次两项核心需求的操作结构，业务仍用合成数据。

原始截图与本地原型截图分别保存，不能互相替代验证结果。
`;
writeFileSync(resolve(root,'README.md'),intro+rows+tail,'utf8');
console.log(`Built gallery and verified ${m.screenshots.length} reference PNGs.`);
