/* Offline product prototype. Every record and operation below is simulated. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => crypto.randomUUID();
  const stamp = () => new Date().toISOString();
  const digest = character => `sha256:${character.repeat(64)}`;
  const cid = 'c1000000-0000-4000-8000-000000000001';
  const cid2 = 'c1000000-0000-4000-8000-000000000002';
  const aid = 'a1000000-0000-4000-8000-000000000001';
  const environments = { development: '开发环境', staging: '测试环境', production: '生产环境' };
  const targetNamespace = env => env==='production'?'shop-prod':env==='staging'?'shop-staging':'shop-dev';
  const tabs = { overview: '概览', configuration: '配置', workflow: '工作流', builds: '构建历史', deployments: '发布历史', resources: '运行资源' };
  const states = { healthy: ['运行正常', 'good'], running: ['构建中', 'info'], queued: ['排队中', 'info'], submitting: ['提交中', 'info'], observing: ['等待就绪', 'info'], succeeded: ['成功', 'good'], failed: ['失败', 'bad'], unknown: ['结果未知', 'warn'], canceling: ['取消中', 'warn'], canceled: ['已取消', ''], degraded: ['存在异常', 'bad'], stopped: ['已停止', ''], pending: ['待部署', ''], Running: ['Running', 'good'], Available: ['Available', 'good'], Bound: ['Bound', 'good'], Active: ['Active', 'good'], Ready: ['Ready', 'good'] };
  const badge = status => `<span class="badge ${states[status]?.[1] || ''}">${esc(states[status]?.[0] || status)}</span>`;
  let timers = [];
  let toastTimer;
  const initial = () => {
    const apps = [
      { id: aid, name: 'checkout-api', project: 'commerce', repo: 'https://git.example.test/shop/checkout-api.git', branch: 'main', mode: 'git', health: 'healthy', version: 3, imageRepository: 'registry.example.test/shop/checkout-api', dockerfile: 'Dockerfile', context: '.', port: 8080, replicas: 2, drift: false },
      { id: 'a1000000-0000-4000-8000-000000000002', name: 'payment-worker', project: 'commerce', repo: 'https://git.example.test/shop/payment-worker.git', branch: 'main', mode: 'git', health: 'healthy', version: 1, imageRepository: 'registry.example.test/shop/payment-worker', dockerfile: 'Dockerfile', context: '.', port: 8080, replicas: 1, drift: false },
      { id: 'a1000000-0000-4000-8000-000000000003', name: 'storefront', project: 'commerce', repo: '', branch: '', mode: 'image', health: 'stopped', version: 1, imageRepository: 'registry.example.test/shop/storefront', dockerfile: '', context: '.', port: 80, replicas: 1, drift: false }
    ];
    apps.forEach(a => { a.overrides = { development: { replicas: a.replicas, host: `${a.name}.dev.example.test`, version: 1 }, staging: { replicas: 2, host: `${a.name}.staging.example.test`, version: 1 }, production: { replicas: 3, host: `${a.name}.example.test`, version: 1 } }; });
    const artifacts = [{ id: uid(), appId: aid, imageRef: `${apps[0].imageRepository}@${digest('a')}`, digest: digest('a'), commitSha: 'abcdef0123456789abcdef0123456789abcdef01' }];
    const deployments = ['development', 'production'].map((env, i) => ({ id: uid(), appId: aid, env, number: 16 - i, status: 'succeeded', kind: 'deploy', artifactId: artifacts[0].id, configVersion: 2, replicas: env === 'production' ? 3 : 2, host: apps[0].overrides[env].host, imageRef: artifacts[0].imageRef, createdAt: '2026-11-19T01:42:00Z' }));
    const builds = [{ id: uid(), appId: aid, number: 18, attemptNo: 1, status: 'succeeded', commitSha: artifacts[0].commitSha, configVersion: 2, artifactId: artifacts[0].id, createdAt: '2026-11-19T01:40:00Z', logs: ['[checkout] fixed commit abcdef0', '[check] checks passed', '[build] image built', `[push] ${artifacts[0].digest}`] }];
    const resources = [
      { id: uid(), clusterId: cid, namespace: 'shop-dev', kind: 'Deployment', name: 'checkout-api', status: 'Available', appId: aid, replicas: 2, image: artifacts[0].imageRef, rv: 4821 },
      { id: uid(), clusterId: cid, namespace: 'shop-dev', kind: 'Pod', name: 'checkout-api-7b8d9c-x2j4k', status: 'Running', appId: aid, image: artifacts[0].imageRef, rv: 4822 },
      { id: uid(), clusterId: cid, namespace: 'shop-dev', kind: 'Service', name: 'checkout-api', status: 'Active', appId: aid, rv: 4823 },
      { id: uid(), clusterId: cid, namespace: 'shop-dev', kind: 'ConfigMap', name: 'checkout-config', status: 'Active', appId: aid, value: 'info', rv: 4824 },
      { id: uid(), clusterId: cid, namespace: 'shop-dev', kind: 'Secret', name: 'checkout-secrets', status: 'Active', appId: aid, rv: 4825 },
      { id: uid(), clusterId: cid, namespace: '', kind: 'Node', name: 'dev-worker-01', status: 'Ready', rv: 4826 },
      { id: uid(), clusterId: cid, namespace: 'shop-dev', kind: 'PersistentVolumeClaim', name: 'checkout-data', status: 'Bound', rv: 4827 },
      { id: uid(), clusterId: cid2, namespace: 'shop-prod', kind: 'Deployment', name: 'checkout-api', status: 'Available', appId: aid, replicas: 3, image: artifacts[0].imageRef, rv: 9521 },
      { id: uid(), clusterId: cid2, namespace: 'shop-prod', kind: 'Pod', name: 'checkout-api-7b8d9c-p8z1a', status: 'Running', appId: aid, image: artifacts[0].imageRef, rv: 9522 },
      { id: uid(), clusterId: cid, namespace: 'shop-dev', kind: 'Certificate', name: 'checkout-tls', status: 'Ready', rv: 4828 }
    ];
    return { apps, artifacts, deployments, builds, resources, audit: [], section: 'apps', appId: null, tab: 'overview', env: 'development', clusterId: cid, namespace: 'all', kind: 'Deployment', query: '', selectedResource: null, detailTab: 'overview', role: 'operator', scenario: 'normal', outcome: 'success', preview: null, yamlDraft: '', terminalLines: [], dirty: false, serial: 19, formMode: 'git' };
  };
  let state = initial();
  const app = () => state.apps.find(a => a.id === state.appId);
  const allowed = () => state.role !== 'viewer';
  const busy = (appId, env) => state.deployments.some(d => d.appId === appId && d.env === env && ['queued', 'submitting', 'observing', 'unknown'].includes(d.status));
  const latest = (appId, env) => state.deployments.find(d => d.appId === appId && d.env === env && d.status === 'succeeded');
  const artifact = id => state.artifacts.find(a => a.id === id);
  const writeDisabled = () => allowed() ? '' : 'disabled title="观察者无写入权限"';
  const button = (label, action, cls = '', attrs = '') => `<button type="button" class="${cls}" data-action="${action}" ${attrs}>${label}</button>`;
  const table = (headers, rows) => `<div class="table-wrap"><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  const empty = (title, message, action = '') => `<div class="empty"><h2>${title}</h2><p>${message}</p>${action}</div>`;
  const note = message => `<div class="notice">${message}</div>`;
  const short = image => image ? `sha256:${image.split('sha256:')[1]?.slice(0, 12) || '—'}` : '—';
  const addAudit = (action, target) => state.audit.unshift({ id: uid(), action, target, at: stamp(), role: state.role });
  const later = (callback, delay) => { const timer = setTimeout(callback, delay); timers.push(timer); };
  function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').classList.add('visible'); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3400); }
  function go(section, appId = null, tab = 'overview') {
    if (state.dirty && !confirm('配置尚未保存，确认离开并丢弃输入？')) return;
    state.dirty = false; state.query = ''; state.selectedResource = null;
    const path = section === 'apps' ? `/application-management/apps${appId ? `/${appId}/${tab}` : ''}` : section === 'resources' ? `/infrastructure-management/resource-browser/${state.clusterId}` : `/settings/${section}`;
    if (location.hash.slice(1) === path) readRoute(); else location.hash = path;
  }
  function readRoute() {
    const route = location.hash.slice(1).split('/').filter(Boolean);
    state.selectedResource = null;
    if (route[0] === 'application-management') { state.section = 'apps'; state.appId = route[2] || null; state.tab = tabs[route[3]] ? route[3] : 'overview'; }
    else if (route[0] === 'infrastructure-management') { state.section = 'resources'; state.appId = null; state.clusterId = [cid, cid2].includes(route[2]) ? route[2] : cid; }
    else { state.section = route[1] === 'audit' ? 'audit' : 'settings'; state.appId = null; }
    render();
  }
  function render() {
    const activeInput = document.activeElement;
    const focusName = activeInput?.dataset?.control;
    const position = typeof activeInput?.selectionStart === 'number' ? activeInput.selectionStart : null;
    const nav = (section, label, mark) => `<a href="#" data-action="nav" data-section="${section}" class="nav-item ${state.section === section ? 'active' : ''}"><span class="nav-mark">${mark}</span>${label}</a>`;
    const title = state.section === 'apps' ? '应用管理' : state.section === 'resources' ? '基础设施管理' : '平台设置';
    $('#workspace').innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand">Podry</div><div class="brand-sub">Delivery & Infrastructure</div><nav><div class="nav-caption">工作区</div>${nav('apps', '应用管理', '▤')}${nav('resources', '资源浏览器', '◇')}<div class="nav-caption">平台</div>${nav('settings', '平台配置', '⚙')}${nav('audit', '操作审计', '≡')}</nav><div class="sidebar-bottom"><span class="avatar">D</span>Demo Operator<div class="subline">commerce / 演示团队</div></div></aside><main class="main"><header class="topbar"><div class="crumb">${title}<b>/ ${state.appId ? esc(app()?.name || '应用不存在') : state.section === 'apps' ? '应用列表' : state.section === 'resources' ? 'Resource Browser' : state.section === 'audit' ? '审计记录' : '配置中心'}</b></div><span class="demo-label">离线交互原型 · 全部为模拟数据</span></header><div class="content">${state.section === 'apps' ? state.appId ? appDetail() : appList() : state.section === 'resources' ? resourcePage() : state.section === 'audit' ? auditPage() : settingsPage()}</div></main></div>${state.selectedResource ? detailPanel() : ''}<details class="review"><summary>评审设置 · 模拟场景与权限</summary><div class="review-body"><label>角色<select data-control="role"><option value="operator" ${state.role === 'operator' ? 'selected' : ''}>运维 / 可写</option><option value="viewer" ${state.role === 'viewer' ? 'selected' : ''}>观察者 / 只读</option></select></label><label>场景<select data-control="scenario">${[['normal','正常数据'],['empty','资源空态'],['offline','集群离线']].map(([v,t]) => `<option value="${v}" ${state.scenario === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label><label>下次任务<select data-control="outcome">${[['success','成功'],['failure','失败'],['unknown','结果未知']].map(([v,t]) => `<option value="${v}" ${state.outcome === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>${button('重置演示', 'reset')}</div></details>`;
    if (focusName) { const next = document.querySelector(`[data-control="${focusName}"]`); next?.focus(); if (position !== null && next?.setSelectionRange && next.type !== 'number') next.setSelectionRange(position, position); }
  }
  function pageHeading(eyebrow, title, subtitle, actions = '') { return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><div class="subtitle">${subtitle}</div></div><div class="actions">${actions}</div></div>`; }
  function appList() {
    const apps = state.apps.filter(a => a.name.includes(state.query) || a.project.includes(state.query));
    return `${pageHeading('APPLICATION MANAGEMENT', '应用', '从代码提交到多环境发布，在一个工作区完成。', button('＋ 创建应用','create-app','primary',writeDisabled()))}<div class="panel"><div class="toolbar"><input aria-label="搜索应用" data-control="app-search" placeholder="搜索应用或项目" value="${esc(state.query)}"><span class="muted">项目：commerce</span><span class="tag">${state.apps.length} 个示例应用</span></div>${apps.length ? table(['应用名称 / 仓库','项目','健康状态','交付方式','最新配置','操作'], apps.map(a => `<tr><td><div class="name-cell"><span class="app-symbol">${a.mode === 'git' ? 'CI' : 'IM'}</span><div><a href="#" class="app-name" data-action="open-app" data-id="${a.id}">${esc(a.name)}</a><span class="subline">${a.repo ? esc(a.repo.replace('https://git.example.test/','')) : '使用已有镜像'}</span></div></div></td><td>${esc(a.project)}</td><td>${badge(a.health)}</td><td>${a.mode === 'git' ? 'Git → 镜像 → 发布' : '镜像 → 发布'}</td><td><span class="mono">v${a.version}</span></td><td>${button('打开应用','open-app','link',`data-id="${a.id}"`)}</td></tr>`)) : empty('没有匹配应用','调整搜索条件后重试。')}<div class="pagination"><span>共 ${apps.length} 个应用 · 样例数据</span><span>第 1 页</span></div></div><div class="footer-note">第一版聚焦应用交付与 Kubernetes 管理。原型不会连接代码仓库、镜像仓库或集群。</div>`;
  }
  function appDetail() {
    const a = app();
    if (!a) return empty('应用不存在','该原型地址中的应用 ID 无效。',button('返回列表','nav','','data-section="apps"'));
    const envSelect = `<select aria-label="应用环境" data-control="app-env">${Object.entries(environments).map(([key,label]) => `<option value="${key}" ${key === state.env ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
    const header = pageHeading('APPLICATION / COMMERCE', esc(a.name), `${esc(a.project)} <span class="muted">/</span> ${a.mode === 'git' ? `Git · ${esc(a.branch)}` : '已有镜像'} <span class="tag">配置 v${a.version}</span>`, envSelect + button('返回列表','nav','','data-section="apps"'));
    const tabbar = `<div class="tabs">${Object.entries(tabs).map(([key,label]) => button(label,'app-tab',state.tab === key ? 'active' : '',`data-tab="${key}"`)).join('')}</div>`;
    const views = { overview: overview, configuration: configuration, workflow, builds: buildsPage, deployments: deploymentsPage, resources: () => resourcesContent(true) };
    return header + tabbar + (a.drift ? note('检测到集群资源与最近发布快照存在差异。下一次发布会展示覆盖范围；可先将变更保存为配置草稿。') : '') + views[state.tab]();
  }
  function overview() {
    const a = app();
    const cards = Object.entries(environments).map(([env,label]) => {
      const d = latest(a.id,env);
      return `<div class="env-card ${state.env === env ? 'selected' : ''}"><div class="row spread"><h3>${label}</h3>${badge(d ? 'healthy' : 'pending')}</div><div class="version">${d ? `Release #${d.number}` : '尚未部署'}</div><div class="mono muted">${d ? esc(short(d.imageRef)) : '选择镜像产物后发布'}</div><div class="subline">${env === 'production' ? 'production-cluster' : 'development-cluster'} / ${targetNamespace(env)}</div><div class="row section-space">${button('查看发布','env-history','link',`data-env="${env}"`)}${button('运行资源','env-resources','link',`data-env="${env}"`)}</div></div>`;
    }).join('');
    const builds = state.builds.filter(b => b.appId === a.id);
    return `<div class="grid three">${cards}</div><div class="grid two section-space"><div class="panel"><div class="panel-head"><h3>交付概况</h3>${button('查看工作流','app-tab','link','data-tab="workflow"')}</div><div class="panel-body"><dl class="kv"><dt>最新构建</dt><dd>${builds[0] ? `Build #${builds[0].number} · ${badge(builds[0].status)}` : '暂无构建'}</dd><dt>部署配置</dt><dd>版本 v${a.version} · 内置应用 Chart 1.0.0</dd><dt>目标镜像仓库</dt><dd class="mono">${esc(a.imageRepository)}</dd><dt>发布策略</dt><dd>开发环境可自动部署；生产环境手动确认</dd></dl></div></div><div class="panel"><div class="panel-head"><h3>当前环境</h3><span class="tag">${environments[state.env]}</span></div><div class="panel-body"><dl class="kv"><dt>副本数</dt><dd>${a.overrides[state.env].replicas}</dd><dt>入口域名</dt><dd class="mono">${esc(a.overrides[state.env].host)}</dd><dt>配置差异</dt><dd>${a.drift ? '检测到集群临时修改' : '未检测到已知差异（模拟）'}</dd><dt>操作入口</dt><dd>${button('配置环境','app-tab','link','data-tab="configuration"')}${button('查看资源','app-tab','link','data-tab="resources"')}</dd></dl></div></div></div>`;
  }
  function field(label,name,value,type='text',hint='') { return `<div class="field"><label for="field-${name}">${label}</label><input id="field-${name}" name="${name}" type="${type}" value="${esc(value)}" ${type === 'number' ? name==='port'?'min="1" max="65535"':'min="0" max="100"' : ''} required ${allowed() ? '' : 'disabled'}>${hint ? `<small>${hint}</small>` : ''}</div>`; }
  function configuration() {
    const a=app(), override=a.overrides[state.env];
    return `<form id="config-form" class="panel"><div class="form-section"><div class="row spread"><h3>代码与构建配置</h3><span class="tag">草稿版本 v${a.version}</span></div><div class="form-grid">${a.mode === 'git' ? field('Git 仓库','repo',a.repo,'url') + field('默认分支','branch',a.branch) + field('Dockerfile 路径','dockerfile',a.dockerfile) + field('构建 Context','context',a.context) : '<p class="muted">已有镜像模式：从镜像导入入口固定 digest 后发布。</p>'}${field('镜像仓库路径','imageRepository',a.imageRepository)}${field('容器端口','port',a.port,'number')}</div></div><div class="form-section"><div class="row spread"><h3>${environments[state.env]}覆盖</h3><span class="tag">环境配置 v${override.version}</span></div><div class="form-grid">${field('副本数','replicas',override.replicas,'number','生产与开发独立覆盖，晋级仅复用镜像产物。')}${field('Ingress 域名','host',override.host)}</div></div><div class="form-section"><h3>配置生效预览</h3><p class="muted">Chart 默认值 → 应用基础配置 → 环境覆盖 → 固定镜像 digest。敏感信息保存版本引用，不在此处显示明文。</p><span class="tag">CPU request 100m / limit 1</span><span class="tag">Memory request 128Mi / limit 512Mi</span><span class="tag">Secret DATABASE_URL · version 1</span></div><div class="form-footer"><span class="muted" style="margin-right:auto">仅保存在本页内存中，刷新恢复样例。</span><button type="submit" class="primary" ${writeDisabled()}>保存为新配置版本</button></div></form>`;
  }
  function workflow() {
    const a=app(), latestBuild=state.builds.find(b=>b.appId===a.id), art=state.artifacts.find(x=>x.appId===a.id);
    return `<div class="panel"><div class="panel-head"><div><h3>交付工作流</h3><small>一次构建，同一 digest 在多个环境发布。</small></div><div class="actions">${a.mode==='git'?button('触发构建','build','primary',writeDisabled()):button('导入示例镜像','import-image','primary',writeDisabled())}${button('编辑配置','app-tab','','data-tab="configuration"')}</div></div><div class="flow"><button class="flow-node" data-action="app-tab" data-tab="configuration"><span class="flow-type">${a.mode==='git'?'SOURCE':'IMAGE SOURCE'}</span><strong>${a.mode==='git'?'Git / main':'固定镜像 digest'}</strong><small>${a.mode==='git'?'手动触发 · Push Webhook':'导入已有镜像，无构建依赖'}</small></button><span class="flow-arrow">→</span><button class="flow-node" data-action="app-tab" data-tab="builds"><span class="flow-type">CONTINUOUS INTEGRATION</span><strong>${a.mode==='git'?'Dockerfile Build':'镜像产物'}</strong>${badge(a.mode==='git'?(latestBuild?.status||'pending'):(art?'succeeded':'pending'))}<span class="subline">${a.mode==='git'?'Job · BuildKit · Registry':art?esc(short(art.imageRef)):'尚未导入'}</span></button><span class="flow-arrow">→</span><div class="flow-branch">${['development','production'].map(env=>`<button class="flow-node" data-action="env-history" data-env="${env}"><span class="flow-type">CONTINUOUS DELIVERY</span><strong>${environments[env]}</strong>${badge(state.deployments.find(d=>d.appId===a.id&&d.env===env)?.status||'pending')}<span class="subline">${env==='development'?'CI 成功后可自动部署':'手动选择产物并确认发布'}</span></button>`).join('')}</div></div></div><div class="notice blue section-space">流程图由配置生成。首版支持一个 CI 连接多个 CD，保留每次提交、构建产物、环境配置和发布快照的对应关系。</div>`;
  }
  function buildsPage() {
    const a=app(), items=state.builds.filter(b=>b.appId===a.id);
    return `<div class="panel"><div class="panel-head"><h3>构建执行记录</h3>${a.mode==='git'?button('触发构建','build','primary',writeDisabled()):button('导入示例镜像','import-image','primary',writeDisabled())}</div>${items.length?table(['构建 / 尝试','提交','状态','配置','镜像产物','操作'],items.map(b=>`<tr><td><strong>Build #${b.number}</strong><span class="subline">attempt ${b.attemptNo}</span></td><td class="mono">${esc(b.commitSha.slice(0,8))}</td><td>${badge(b.status)}</td><td>v${b.configVersion}</td><td class="mono">${b.artifactId?esc(short(artifact(b.artifactId)?.imageRef)):'—'}</td><td>${button('日志','build-logs','link',`data-id="${b.id}"`)}${['queued','running'].includes(b.status)?button('取消','cancel-build','link',`data-id="${b.id}" ${writeDisabled()}`):['failed','canceled'].includes(b.status)?button('重试','retry-build','link',`data-id="${b.id}" ${writeDisabled()}`):b.status==='unknown'?button('模拟核对','reconcile-build','link',`data-id="${b.id}" ${writeDisabled()}`):''}</td></tr>`)):empty('暂无构建','配置 Git 源后触发第一次构建。')}</div>`;
  }
  function deploymentsPage() {
    const a=app(), items=state.deployments.filter(d=>d.appId===a.id&&d.env===state.env), hasArtifact=state.artifacts.some(x=>x.appId===a.id);
    return `${busy(a.id,state.env)?note('当前目标正在执行或结果未知，保留目标占用。核对完成之前不能重复发布。'):''}<div class="panel"><div class="panel-head"><div><h3>${environments[state.env]} · 发布记录</h3><small>发布记录与镜像、配置版本绑定，回滚会生成新记录。</small></div><div class="actions">${button('发布新版本','deploy','primary',`${writeDisabled()} ${!hasArtifact||busy(a.id,state.env)?'disabled':''}`)}</div></div>${items.length?table(['发布','镜像 digest','配置','状态','类型','操作'],items.map(d=>`<tr><td><strong>Release #${d.number}</strong><span class="subline">${esc(d.createdAt.slice(0,16).replace('T',' '))} UTC</span></td><td class="mono">${esc(short(d.imageRef))}</td><td>v${d.configVersion}</td><td>${badge(d.status)}</td><td>${{deploy:'发布',promote:'晋级',rollback:'回滚'}[d.kind]}</td><td>${button('详情','deployment-detail','link',`data-id="${d.id}"`)}${d.status==='succeeded'?button('回滚到此版本','rollback','link',`data-id="${d.id}" ${writeDisabled()} ${busy(a.id,state.env)?'disabled':''}`)+(d.env!=='production'?button('晋级生产','promote','link',`data-id="${d.id}" ${writeDisabled()}`):''):d.status==='unknown'?button('模拟核对','reconcile-deployment','link',`data-id="${d.id}" ${writeDisabled()}`):''}</td></tr>`)):empty('当前环境尚未发布',hasArtifact?'选择已有产物，预览目标配置后部署。':'先完成构建或导入镜像产物。')}</div>`;
  }
  const kinds = { 'Workloads': ['Deployment','Pod'], 'Networking': ['Service'], 'Config & Storage': ['ConfigMap','Secret','PersistentVolumeClaim'], 'Cluster': ['Node'], 'Custom Resources': ['Certificate'] };
  function resourcePage() {
    return pageHeading('INFRASTRUCTURE MANAGEMENT','资源浏览器','按集群查看和管理资源，使用同一套详情、日志和终端。',button('＋ 创建资源','create-resource','primary',writeDisabled())) + resourcesContent(false);
  }
  function resourcesContent(isApp) {
    const a=app(), clusterId=isApp?(state.env==='production'?cid2:cid):state.clusterId;
    const namespace=isApp?targetNamespace(state.env):state.namespace;
    const controls=isApp?`<span class="tag">${environments[state.env]}</span><span class="mono muted">${namespace}</span>${button('在资源浏览器打开','jump-resource-browser','link')}`:`<select aria-label="选择集群" data-control="cluster"><option value="${cid}" ${clusterId===cid?'selected':''}>development-cluster</option><option value="${cid2}" ${clusterId===cid2?'selected':''}>production-cluster</option></select><select aria-label="选择 Namespace" data-control="namespace">${['all','shop-dev','shop-staging','shop-prod'].map(n=>`<option value="${n}" ${n===state.namespace?'selected':''}>${n==='all'?'全部 Namespace':n}</option>`).join('')}</select>`;
    let content;
    if(state.scenario==='offline') content=empty('集群连接失败','无法获取最新资源。此处为离线错误场景演示，未发出网络请求。',button('模拟重新连接','reconnect'));
    else {
      const rows=state.scenario==='empty'?[]:state.resources.filter(r=>r.clusterId===clusterId&&r.kind===state.kind&&(r.kind==='Node'||namespace==='all'||r.namespace===namespace)&&(!isApp||r.appId===a.id)&&r.name.includes(state.query));
      content=rows.length?table(['名称','Namespace','状态','资源版本','操作'],rows.map(r=>`<tr><td><a href="#" data-action="resource-detail" data-id="${r.id}"><strong>${esc(r.name)}</strong></a><span class="subline">${esc(r.kind)}${r.appId?' · Podry 应用资源':''}</span></td><td>${esc(r.namespace||'集群级')}</td><td>${badge(r.status)}</td><td class="mono">${r.rv}</td><td>${button('详情','resource-detail','link',`data-id="${r.id}"`)}</td></tr>`)):empty('没有匹配资源','切换资源类型、Namespace 或评审场景。');
    }
    return `<div class="panel"><div class="toolbar">${controls}<input aria-label="搜索资源" data-control="resource-search" placeholder="按名称搜索资源" value="${esc(state.query)}"><span class="muted" style="margin-left:auto"><span class="connection-dot"></span>${state.scenario==='offline'?'模拟离线':'模拟数据'}</span></div><div class="resource-layout"><aside class="kind-nav">${Object.entries(kinds).map(([category,items])=>`<div class="kind-caption">${category}</div>${items.map(k=>button(k,'kind',state.kind===k?'active':'',`data-kind="${k}"`)).join('')}`).join('')}</aside><div class="resource-main"><div class="panel-head"><h3>${esc(state.kind)}</h3><small>GVR 动态发现 · 原型展示常见类型</small></div>${content}</div></div></div>`;
  }
  function manifest(r) {
    if(r.manifestOverride) return r.manifestOverride;
    const apiVersion=r.kind==='Deployment'?'apps/v1':r.kind==='Certificate'?'cert-manager.io/v1':'v1';
    let text=`apiVersion: ${apiVersion}\nkind: ${r.kind}\nmetadata:\n  name: ${r.name}\n${r.namespace?`  namespace: ${r.namespace}\n`:''}  resourceVersion: "${r.rv}"\n`;
    if(r.kind==='Deployment') text+=`spec:\n  replicas: ${r.replicas}\n  template:\n    spec:\n      containers:\n        - name: app\n          image: ${r.image}\n          ports:\n            - containerPort: 8080\n`;
    else if(r.kind==='ConfigMap') text+=`data:\n  LOG_LEVEL: ${r.value||'info'}\n`;
    else if(r.kind==='Secret') text+='type: Opaque\n# Values are redacted. Separate authorization is required.\n';
    else if(r.kind==='Pod') text+=`spec:\n  containers:\n    - name: app\n      image: ${r.image}\nstatus:\n  phase: Running\n`;
    else text+=`# Read-only example for ${r.kind}\nstatus:\n  phase: ${r.status}\n`;
    return text;
  }
  function detailPanel() {
    const r=state.resources.find(x=>x.id===state.selectedResource);
    if(!r){state.selectedResource=null;return '';}
    const pod=r.kind==='Pod', edit=['Deployment','ConfigMap'].includes(r.kind);
    const detailTabs={overview:'概览',yaml:'YAML',events:'事件',...(pod?{logs:'日志',terminal:'终端'}:{})};
    if(!detailTabs[state.detailTab]) state.detailTab='overview';
    let body;
    if(state.detailTab==='overview') body=`<dl class="kv"><dt>状态</dt><dd>${badge(r.status)}</dd><dt>Namespace</dt><dd>${esc(r.namespace||'不适用')}</dd><dt>UID</dt><dd class="mono">${r.id}</dd><dt>资源版本</dt><dd class="mono">${r.rv}</dd>${r.replicas!==undefined?`<dt>副本数</dt><dd>${r.replicas}</dd>`:''}<dt>所属应用</dt><dd>${r.appId?button(esc(state.apps.find(a=>a.id===r.appId)?.name||'应用'),'open-app','link',`data-id="${r.appId}"`):'外部资源'}</dd><dt>CPU / Memory</dt><dd>指标不可用 · 原型未连接指标服务</dd></dl><div class="notice blue section-space">UID 标识对象身份。资源名称相同但 UID 变化时，需要清理旧缓存和日志连接。</div>`;
    else if(state.detailTab==='yaml') body=`${edit?'<p class="muted">原型仅支持修改 replicas、image 或 LOG_LEVEL；不会连接 API Server。</p>':'<p class="muted">该类型原型仅展示 YAML，Secret 值已脱敏。</p>'}<textarea class="editor" aria-label="资源 YAML" data-control="yaml" ${!edit||!allowed()?'readonly':''}>${esc(state.yamlDraft||manifest(r))}</textarea><div class="row section-space">${edit?button('校验并预览差异','preview-yaml','primary',writeDisabled()):''}${button('重新读取','reload-yaml')}</div>`;
    else if(state.detailTab==='events') body=`<ul class="timeline"><li><strong>Normal · Synced</strong><div>控制器已观察到当前资源版本 ${r.rv}。</div><small>模拟事件 · 2026-11-19</small></li><li><strong>Normal · Ready</strong><div>资源状态符合当前模拟配置。</div><small>模拟事件 · 2026-11-19</small></li></ul>`;
    else if(state.detailTab==='logs') body=`<div class="row"><select aria-label="日志容器"><option>app</option></select><span class="tag">tail 200 · 模拟日志</span>${button('刷新','refresh-logs')}</div><pre class="code section-space">${esc(`[2026-11-19T02:10:00Z] INFO server listening on :8080\n[2026-11-19T02:10:01Z] INFO request_id=demo-001 GET /checkout 200\n[2026-11-19T02:10:02Z] INFO pod=${r.name}\n[offline] 此窗口展示预置日志，未建立真实日志流。`)}</pre>`;
    else body=`<div class="notice blue">模拟终端，支持 help、pwd、ls、date 和 clear。输入不会发送到 shell 或集群。</div><pre class="code terminal" id="terminal-output">${esc(state.terminalLines.join('\n')||'Podry offline terminal\nType help to inspect supported demo commands.')}</pre><form id="terminal-form"><input class="terminal-input" name="command" aria-label="终端命令" autocomplete="off" placeholder="$ 输入 help" ${allowed()?'':'disabled'}></form>${!allowed()?'<small>观察者没有 pod.exec 权限。</small>':''}`;
    return `<aside class="detail" aria-label="资源详情"><div class="detail-head"><div class="row spread"><span class="eyebrow">${esc(r.kind.toUpperCase())}</span>${button('关闭','close-detail')}</div><h2>${esc(r.name)}</h2><div class="row section-space">${r.kind==='Deployment'?button('重启','restart-resource','',writeDisabled())+button('调整副本','scale-resource','',writeDisabled()):''}${button('删除','delete-resource','danger',writeDisabled())}</div></div><div class="tabs">${Object.entries(detailTabs).map(([key,label])=>button(label,'detail-tab',state.detailTab===key?'active':'',`data-tab="${key}"`)).join('')}</div><div class="detail-body">${body}</div></aside>`;
  }
  function auditPage() {
    return pageHeading('PLATFORM / AUDIT','操作审计','本次原型会话中的模拟操作记录。敏感值和终端键盘输入不写入审计。')+`<div class="panel">${state.audit.length?table(['时间 UTC','角色','动作','目标','结果'],state.audit.map(e=>`<tr><td class="mono">${esc(e.at.slice(11,19))}</td><td>${e.role==='viewer'?'观察者':'运维人员'}</td><td>${esc(e.action)}</td><td>${esc(e.target)}</td><td>${badge('succeeded')}</td></tr>`)):empty('暂无操作记录','先触发构建、发布或资源操作。')}</div>`;
  }
  function settingsPage() {
    return pageHeading('PLATFORM / CONFIGURATIONS','平台配置','配置页用于说明平台依赖；原型不会收集或保存真实凭据。')+`<div class="settings-list">${[['集群与环境','development-cluster / shop-dev<br>production-cluster / shop-prod','查看资源浏览器','nav','data-section="resources"'],['Git 与镜像仓库','GitHub / GitLab Push Webhook<br>registry.example.test · 示例地址','查看交付工作流','open-app',`data-id="${aid}" data-tab="workflow"`],['成员与权限','团队 → 项目 → 应用<br>资源、日志、终端和 Secret 权限分别授权','查看权限场景','open-review',''],['操作审计','记录构建、发布和资源写入<br>敏感信息脱敏，终端输入不留存','查看审计','nav','data-section="audit"']].map(([title,text,label,action,attrs])=>`<div class="panel"><div class="panel-head"><h3>${title}</h3><span class="tag">设计展示</span></div><div class="panel-body"><p class="muted">${text}</p>${button(label,action,'link',attrs)}</div></div>`).join('')}</div>`;
  }
  function modal(title,body,footer='') {
    const dialog=$('#modal');
    if(dialog.open) dialog.close();
    dialog.innerHTML=`<div class="modal-head"><h2 id="modal-title">${title}</h2>${button('关闭','close-modal')}</div><div class="modal-body">${body}</div><div class="modal-footer">${button('取消','close-modal')}${footer}</div>`;
    dialog.showModal();
  }
  function closeModal(){ $('#modal').close(); state.preview=null; }
  function beginBuild(existing) {
    if(!allowed())return toast('观察者无 build.trigger 权限。');
    const a=app(); if(!a||a.mode!=='git')return;
    const outcome=state.outcome;
    const b=existing||{id:uid(),appId:a.id,number:state.serial++,attemptNo:0,commitSha:`${(state.serial%16).toString(16).repeat(40)}`,configVersion:a.version,imageRepository:a.imageRepository,createdAt:stamp(),logs:[],attemptHistory:[]};
    if(existing&&!['failed','canceled'].includes(existing.status))return toast('仅明确失败或取消的构建可重试。');
    if(!existing)state.builds.unshift(b);
    if(existing)(b.attemptHistory||=[]).push({attemptNo:b.attemptNo,status:b.status,logs:[...b.logs]});
    b.attemptNo++; b.status='queued'; b.artifactId=null; b.logs=[`[queue] Build #${b.number} attempt ${b.attemptNo}`,`[source] fixed commit ${b.commitSha}`];
    const attemptNo=b.attemptNo;
    addAudit(existing?'build.retry':'build.trigger',`${a.name} #${b.number}`);
    state.tab='builds'; location.hash=`/application-management/apps/${a.id}/builds`; render();
    later(()=>{if(b.status!=='queued'||b.attemptNo!==attemptNo)return;b.status='running';b.logs.push('[checkout] repository checked out','[build] BuildKit building image');render();},450);
    later(()=>{
      if(b.status!=='running'||b.attemptNo!==attemptNo)return;
      if(outcome==='unknown'){b.status='unknown';b.logs.push('[observe] outcome unknown; reconcile before retry');}
      else if(outcome==='failure'){b.status='failed';b.logs.push('[build] simulated build failure; no artifact created');}
      else finishBuild(b);
      render();toast(`模拟构建：${states[b.status][0]}`);
    },1550);
  }
  function finishBuild(b) {
    const a=state.apps.find(x=>x.id===b.appId), d=digest((b.number%16).toString(16));
    const art={id:uid(),appId:a.id,digest:d,imageRef:`${b.imageRepository||a.imageRepository}@${d}`,commitSha:b.commitSha};
    state.artifacts.unshift(art);b.status='succeeded';b.artifactId=art.id;b.logs.push(`[push] ${d}`,'[complete] artifact recorded');
  }
  function previewDeploy(kind='deploy',source=null) {
    if(!allowed())return toast('观察者无 deploy.trigger 权限。');
    const a=app();
    if(busy(a.id,state.env))return toast('target_busy：当前目标被进行中或未知结果的发布占用。');
    const art=source?artifact(source.artifactId):state.artifacts.find(x=>x.appId===a.id);
    if(!art)return toast('请先完成构建或导入镜像。');
    const override=a.overrides[state.env];
    const preview={kind,appId:a.id,env:state.env,artifactId:art.id,imageRef:art.imageRef,configVersion:kind==='rollback'?source.configVersion:a.version,replicas:kind==='rollback'?source.replicas:override.replicas,host:kind==='rollback'?source.host:override.host,expectedVersion:a.version,bindingVersion:override.version,sourceId:source?.id||null,expiresAt:Date.now()+600000};
    state.preview=preview;
    const before=latest(a.id,state.env);
    modal(kind==='rollback'?'确认回滚历史版本':kind==='promote'?'确认晋级到生产环境':'预览并确认发布',`<div class="notice blue">${kind==='rollback'?'基于同环境历史完整快照创建新发布记录。':kind==='promote'?'复用源环境同一个 digest，使用生产环境自己的配置。':'固定镜像 digest、配置版本与目标后再提交。'}</div><dl class="kv"><dt>应用 / 环境</dt><dd>${esc(a.name)} / ${environments[state.env]}</dd><dt>目标</dt><dd>${state.env==='production'?'production-cluster':'development-cluster'} / ${targetNamespace(state.env)}</dd><dt>镜像</dt><dd class="mono">${esc(art.imageRef)}</dd><dt>配置 / Chart</dt><dd>v${preview.configVersion} / application 1.0.0</dd></dl><div class="diff section-space"><pre class="before">${esc(`之前\nimage: ${before?short(before.imageRef):'未部署'}\nreplicas: ${before?.replicas??0}\nhost: ${before?.host||'—'}`)}</pre><pre class="after">${esc(`之后\nimage: ${short(preview.imageRef)}\nreplicas: ${preview.replicas}\nhost: ${preview.host}`)}</pre></div>${a.drift?'<div class="notice section-space">存在集群临时修改，确认发布后按此快照覆盖。</div>':''}`,button('确认发布','confirm-deploy','primary'));
  }
  function confirmDeploy() {
    const p=state.preview, a=app(); if(!p||!allowed())return;
    if(Date.now()>p.expiresAt)return toast('preview_expired：请关闭并重新预览。');
    if(p.kind!=='rollback'&&(a.version!==p.expectedVersion||a.overrides[p.env].version!==p.bindingVersion))return toast('revision_conflict：配置发生变化，请重新预览。');
    if(busy(a.id,p.env))return toast('target_busy：当前目标已被占用。');
    const d={...p,id:uid(),number:state.serial++,status:'submitting',createdAt:stamp()};
    const outcome=state.outcome;
    state.deployments.unshift(d);addAudit(`deployment.${p.kind}`,`${a.name} / ${p.env} #${d.number}`);
    closeModal();state.tab='deployments';location.hash=`/application-management/apps/${a.id}/deployments`;render();
    later(()=>{if(d.status!=='submitting')return;d.status='observing';render();},500);
    later(()=>{if(d.status!=='observing')return;if(outcome==='unknown')d.status='unknown';else if(outcome==='failure')d.status='failed';else finishDeployment(d);render();toast(`模拟发布：${states[d.status][0]}`);},1500);
  }
  function finishDeployment(d) {
    d.status='succeeded';const a=state.apps.find(x=>x.id===d.appId);a.health='healthy';a.drift=false;
    const clusterId=d.env==='production'?cid2:cid, namespace=targetNamespace(d.env);
    let r=state.resources.find(x=>x.appId===a.id&&x.kind==='Deployment'&&x.clusterId===clusterId&&x.namespace===namespace);
    if(!r){r={id:uid(),clusterId,namespace,kind:'Deployment',name:a.name,status:'Available',appId:a.id,rv:5000};state.resources.push(r);}
    r.replicas=d.replicas;r.image=d.imageRef;r.rv++;delete r.manifestOverride;
  }
  function markResourceChange(r,action) { r.rv++; if(r.appId){const a=state.apps.find(x=>x.id===r.appId);if(a)a.drift=true;} addAudit(action,`${r.namespace||'cluster'}/${r.name}`); }
  function previewYaml() {
    const r=state.resources.find(x=>x.id===state.selectedResource);
    if(!r||!allowed())return;
    const draft=state.yamlDraft||manifest(r);
    if(!draft.includes(`kind: ${r.kind}`)||!draft.includes(`name: ${r.name}`)||(r.namespace&&!draft.includes(`namespace: ${r.namespace}`)))return toast('原型不允许修改对象 Kind、名称和 Namespace。');
    const count=draft.match(/^\s*replicas:\s*(\d+)\s*$/m);
    if(r.kind==='Deployment'&&(!count||Number(count[1])>100))return toast('原型要求 replicas 为 0–100 的整数。');
    state.preview={type:'yaml',id:r.id,rv:r.rv,draft};
    modal('YAML 差异预览',`<div class="notice blue">有限字段的模拟校验；真实实现必须由 Kubernetes Dry Run 与 UID/resourceVersion 校验。</div><div class="diff"><pre class="before">${esc(manifest(r))}</pre><pre class="after">${esc(draft)}</pre></div>`,button('确认应用变更','confirm-yaml','primary'));
  }
  function handleAction(action,target) {
    const id=target.dataset.id;
    if(action==='nav')return go(target.dataset.section);
    if(action==='open-app')return go('apps',id,target.dataset.tab||'overview');
    if(action==='app-tab')return go('apps',state.appId,target.dataset.tab);
    if(action==='env-history'||action==='env-resources'){state.env=target.dataset.env;return go('apps',state.appId,action==='env-history'?'deployments':'resources');}
    if(action==='close-modal')return closeModal();
    if(action==='open-review'){ $('.review').open=true;return; }
    if(action==='reset'){if(!confirm('重置全部模拟记录与场景？'))return;timers.forEach(clearTimeout);timers=[];closeModal();state=initial();location.hash='/application-management/apps';render();return toast('演示数据已重置。');}
    if(action==='create-app')return modal('创建应用',`<form id="create-app-form"><div class="form-grid">${field('应用名称','name','','text','小写字母、数字和连字符，3–63 字符。')}<div class="field"><label for="create-mode">交付方式</label><select id="create-mode" name="mode"><option value="git">Git 构建</option><option value="image">已有镜像</option></select></div>${field('Git 仓库（镜像模式忽略）','repo','https://git.example.test/shop/new-api.git','url')}${field('默认分支','branch','main')}</div><div class="notice blue section-space">演示将自动附带开发、测试、生产样例绑定。真实实现需要明确授权和选择目标。</div></form>`,`<button class="primary" type="submit" form="create-app-form">创建应用</button>`);
    if(action==='build')return beginBuild();
    if(action==='retry-build')return beginBuild(state.builds.find(b=>b.id===id));
    if(action==='cancel-build'){const b=state.builds.find(x=>x.id===id);if(!b||!allowed())return;b.status='canceling';b.logs.push('[cancel] waiting for simulated Job termination');render();later(()=>{if(b.status==='canceling'){b.status='canceled';addAudit('build.cancel',`Build #${b.number}`);render();}},450);return;}
    if(action==='reconcile-build'){const b=state.builds.find(x=>x.id===id);if(b?.status==='unknown'&&allowed()){finishBuild(b);addAudit('build.reconcile',`Build #${b.number}`);render();toast('模拟核对：原任务已成功，未创建新任务。');}return;}
    if(action==='build-logs'){const b=state.builds.find(x=>x.id===id);return modal(`Build #${b.number} · attempt ${b.attemptNo}`,`<p>${badge(b.status)} <span class="tag">模拟日志</span></p><pre class="code">${esc(b.logs.join('\n'))}</pre>${(b.attemptHistory||[]).map(h=>`<details class="section-space"><summary>历史 attempt ${h.attemptNo} · ${states[h.status]?.[0]||h.status}</summary><pre class="code">${esc(h.logs.join('\n'))}</pre></details>`).join('')}`);}
    if(action==='import-image'){if(!allowed())return;const a=app(),d=digest('c');state.artifacts.unshift({id:uid(),appId:a.id,imageRef:`${a.imageRepository}@${d}`,digest:d});addAudit('artifact.import',a.name);render();return toast('已导入固定 digest 的示例镜像；未访问 Registry。');}
    if(action==='deploy')return previewDeploy();
    if(action==='promote'){const source=state.deployments.find(d=>d.id===id);state.env='production';render();return previewDeploy('promote',source);}
    if(action==='rollback')return previewDeploy('rollback',state.deployments.find(d=>d.id===id));
    if(action==='confirm-deploy')return confirmDeploy();
    if(action==='reconcile-deployment'){const d=state.deployments.find(x=>x.id===id);if(d?.status==='unknown'&&allowed()){finishDeployment(d);addAudit('deployment.reconcile',`Release #${d.number}`);render();toast('模拟核对成功，目标占用已释放。');}return;}
    if(action==='deployment-detail'){const d=state.deployments.find(x=>x.id===id);return modal(`Release #${d.number} · 发布快照`,`<p>${badge(d.status)} <span class="tag">${environments[d.env]}</span></p><dl class="kv"><dt>镜像</dt><dd class="mono">${esc(d.imageRef)}</dd><dt>配置版本</dt><dd>v${d.configVersion}</dd><dt>副本 / 域名</dt><dd>${d.replicas} / ${esc(d.host)}</dd><dt>Chart</dt><dd>application 1.0.0</dd><dt>敏感配置</dt><dd>DATABASE_URL · version 1（仅版本引用）</dd><dt>来源</dt><dd>${d.sourceId?esc(d.sourceId):'直接发布'}</dd></dl>`);}
    if(action==='kind'){state.kind=target.dataset.kind;state.selectedResource=null;state.query='';render();return;}
    if(action==='reconnect'){state.scenario='normal';render();return toast('已恢复正常模拟场景。');}
    if(action==='jump-resource-browser'){state.clusterId=state.env==='production'?cid2:cid;state.namespace=targetNamespace(state.env);return go('resources');}
    if(action==='resource-detail'){state.selectedResource=id;state.detailTab='overview';state.yamlDraft='';state.terminalLines=[];render();return;}
    if(action==='close-detail'){state.selectedResource=null;render();return;}
    if(action==='detail-tab'){state.detailTab=target.dataset.tab;render();return;}
    if(action==='reload-yaml'){state.yamlDraft='';render();return toast('已重新读取当前模拟对象。');}
    if(action==='preview-yaml')return previewYaml();
    if(action==='confirm-yaml'){const p=state.preview,r=state.resources.find(x=>x.id===p?.id);if(!r||!allowed())return;if(r.rv!==p.rv)return toast('revision_conflict：对象已改变，请重新读取。');r.replicas=Number(p.draft.match(/^\s*replicas:\s*(\d+)/m)?.[1]??r.replicas);r.image=p.draft.match(/^\s*image:\s*(\S+)/m)?.[1]||r.image;r.value=p.draft.match(/^\s*LOG_LEVEL:\s*(\S+)/m)?.[1]||r.value;markResourceChange(r,'resource.update');r.manifestOverride=p.draft.replace(/resourceVersion:\s*"?\d+"?/,`resourceVersion: "${r.rv}"`);state.yamlDraft='';closeModal();render();return toast('模拟资源已更新，所属应用标记配置差异。');}
    if(action==='refresh-logs')return toast('已重新载入预置日志；未建立网络连接。');
    const r=state.resources.find(x=>x.id===state.selectedResource);
    if(action==='restart-resource'){if(!allowed()||!r)return;markResourceChange(r,'resource.restart');render();return toast('模拟重启已记录，已更新资源版本。');}
    if(action==='scale-resource'){if(!allowed()||!r)return;return modal('调整副本',`<form id="scale-form">${field('副本数','replicas',r.replicas,'number')}<p class="muted section-space">仅作用于当前 Deployment；真实实现会检查 HPA 与资源版本。</p></form>`,`<button class="primary" type="submit" form="scale-form">确认调整</button>`);}
    if(action==='delete-resource'){if(!allowed()||!r)return;return modal('确认删除资源',`<p>将删除模拟对象 <strong>${esc(r.kind)} / ${esc(r.name)}</strong>。</p><p class="muted">目标 ${esc(r.namespace||'集群级')}，UID ${r.id}。实际实现必须检查 UID 前置条件和级联影响。</p>`,button('确认删除','confirm-delete','danger'));}
    if(action==='confirm-delete'){if(!allowed()||!r)return;if(r.appId){const owner=state.apps.find(a=>a.id===r.appId);if(owner){owner.drift=true;owner.health='degraded';}}addAudit('resource.delete',r.name);state.resources=state.resources.filter(x=>x.id!==r.id);state.selectedResource=null;closeModal();render();return toast('模拟资源已删除，所属应用将显示差异。');}
    if(action==='create-resource'){if(!allowed())return;return modal('创建资源 · ConfigMap 演示',`<form id="create-resource-form"><p class="muted">原型仅解析 ConfigMap 的 name、namespace 和 LOG_LEVEL。真实产品支持通用多文档 YAML。</p><textarea name="manifest" aria-label="创建资源 YAML" class="editor" required>apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: demo-config\n  namespace: ${state.clusterId===cid2?'shop-prod':'shop-dev'}\ndata:\n  LOG_LEVEL: info\n</textarea></form>`,`<button class="primary" type="submit" form="create-resource-form">校验并预览</button>`);}
    if(action==='confirm-create-resource'){const p=state.preview;if(!p||!allowed())return;state.resources.push({...p.resource,id:uid(),rv:6001,status:'Active'});addAudit('resource.create',p.resource.name);state.kind='ConfigMap';state.namespace=p.resource.namespace;state.scenario='normal';closeModal();render();return toast('ConfigMap 已创建到模拟集群。');}
  }
  document.addEventListener('click',event=>{const target=event.target.closest('[data-action]');if(!target||target.disabled)return;event.preventDefault();handleAction(target.dataset.action,target);});
  document.addEventListener('input',event=>{
    const target=event.target;
    if(target.dataset.control==='app-search'||target.dataset.control==='resource-search'){state.query=target.value;render();}
    if(target.dataset.control==='yaml')state.yamlDraft=target.value;
    if(target.closest('#config-form'))state.dirty=true;
  });
  document.addEventListener('change',event=>{
    const key=event.target.dataset.control,value=event.target.value;
    if(key==='role'){state.role=value;state.selectedResource=null;closeModal();}
    if(key==='scenario'){state.scenario=value;state.selectedResource=null;}
    if(key==='outcome')state.outcome=value;
    if(key==='app-env'){if(state.dirty&&!confirm('配置未保存，确认切换环境？')){event.target.value=state.env;return;}state.env=value;state.dirty=false;state.selectedResource=null;}
    if(key==='namespace'){state.namespace=value;state.selectedResource=null;state.query='';}
    if(key==='cluster'){state.clusterId=value;state.namespace='all';state.selectedResource=null;state.query='';go('resources');return;}
    if(key)render();
  });
  document.addEventListener('submit',event=>{
    event.preventDefault();const form=event.target,values=Object.fromEntries(new FormData(form));
    if(form.id==='terminal-form'){
      if(!allowed())return;
      const cmd=values.command.trim();let output;
      if(cmd==='clear')state.terminalLines=[];
      else{output={help:'help · pwd · ls · date · clear\n仅模拟，不执行 shell 命令。',pwd:'/app',ls:'app  config  logs',date:'Thu Nov 19 10:10:00 CST 2026'}[cmd]||'不支持该模拟指令。输入 help 查看帮助。';state.terminalLines.push(`$ ${cmd}`,output);}
      render();$('.terminal-input')?.focus();return;
    }
    if(!allowed())return toast('观察者无写入权限。');
    if(form.id==='config-form'){
      if(Number(values.port)<1||Number(values.port)>65535)return toast('容器端口应在 1–65535 之间。');
      const a=app();for(const key of ['repo','branch','dockerfile','context','imageRepository'])if(values[key]!==undefined)a[key]=values[key];
      a.port=Number(values.port);a.version++;a.overrides[state.env]={replicas:Number(values.replicas),host:values.host,version:a.overrides[state.env].version+1};state.dirty=false;addAudit('application.config.save',`${a.name} v${a.version}`);render();return toast('新配置版本已保存；运行中的资源保持原发布版本。');
    }
    if(form.id==='create-app-form'){
      if(!/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(values.name))return toast('名称须为 3–63 字符的小写字母、数字和连字符。');
      if(state.apps.some(a=>a.name===values.name))return toast('该项目内应用名称已存在。');
      const a={id:uid(),name:values.name,project:'commerce',repo:values.mode==='git'?values.repo:'',branch:values.mode==='git'?values.branch:'',mode:values.mode,health:'stopped',version:1,imageRepository:`registry.example.test/shop/${values.name}`,dockerfile:'Dockerfile',context:'.',port:8080,replicas:1,drift:false,overrides:{}};
      Object.keys(environments).forEach(env=>{a.overrides[env]={replicas:env==='production'?3:1,host:`${a.name}.${env}.example.test`,version:1};});state.apps.push(a);addAudit('application.create',a.name);closeModal();go('apps',a.id,'configuration');return toast('示例应用已创建，请检查配置。');
    }
    if(form.id==='scale-form'){const r=state.resources.find(x=>x.id===state.selectedResource);if(!r)return;r.replicas=Number(values.replicas);delete r.manifestOverride;markResourceChange(r,'resource.scale');closeModal();render();return toast('模拟副本数已调整，应用已标记配置差异。');}
    if(form.id==='create-resource-form'){
      const raw=values.manifest,name=raw.match(/^\s+name:\s*([a-z0-9-]+)\s*$/m)?.[1],namespace=raw.match(/^\s+namespace:\s*([a-z0-9-]+)\s*$/m)?.[1];
      if(!raw.includes('kind: ConfigMap')||!name||!namespace)return toast('原型仅支持带 name、namespace 的单个 ConfigMap。');
      if(state.resources.some(r=>r.clusterId===state.clusterId&&r.namespace===namespace&&r.kind==='ConfigMap'&&r.name===name))return toast('同 Namespace 中已存在该 ConfigMap。');
      state.preview={type:'create-resource',resource:{name,namespace,kind:'ConfigMap',clusterId:state.clusterId,value:raw.match(/^\s*LOG_LEVEL:\s*(\S+)/m)?.[1]||'info'}};
      modal('创建资源预览',`<div class="notice blue">模拟校验通过；真实实现须在提交时重新授权与 Dry Run。</div><pre class="code">${esc(raw)}</pre>`,button('确认创建','confirm-create-resource','primary'));
    }
  });
  $('#modal').addEventListener('cancel',()=>{state.preview=null;});
  window.addEventListener('hashchange',readRoute);
  window.addEventListener('beforeunload',event=>{if(state.dirty){event.preventDefault();event.returnValue='';}});
  window.podryPrototype={getState:()=>structuredClone(state),reset:()=>{timers.forEach(clearTimeout);timers=[];state=initial();readRoute();},render};
  if(!location.hash)location.hash='/application-management/apps';else readRoute();
})();
