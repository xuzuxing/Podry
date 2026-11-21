/* V2.1: interaction structure observed on the user's Devtron instance, 2026-11-19.
 * All business records are synthetic. No fetch, WebSocket, remote authentication or shell execution.
 * The first design and its original comments are preserved in archive-v1/.
 */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uuid = () => crypto.randomUUID();
  const aid = 'a1000000-0000-4000-8000-000000000001';
  const cid = 'c1000000-0000-4000-8000-000000000001';
  const cid2 = 'c1000000-0000-4000-8000-000000000002';
  const envs = ['development','staging','production'];
  const APP = '/application-management/devtron-app';
  const RB = '/infrastructure-management/resource-browser';
  const ns = env => ({development:'shop-dev',staging:'shop-staging',production:'shop-prod'}[env]);
  const clusterFor = env => env === 'production' ? cid2 : cid;
  const clusterName = id => id === cid2 ? 'production-cluster' : 'development-cluster';
  const sha = c => `sha256:${c.repeat(64)}`;
  const B = (label, action, attrs = '', cls = '') => `<button type="button" data-action="${action}" class="${cls}" ${attrs}>${label}</button>`;
  const L = (label, path, cls = '') => `<a class="${cls}" href="#${esc(path)}">${label}</a>`;
  const empty = (title, message = '') => `<div class="empty"><span class="empty-symbol">ⓘ</span><h3>${title}</h3><p>${message}</p></div>`;
  const labels = {succeeded:'Succeeded',failed:'Failed',canceled:'Aborted',running:'Running',queued:'Queued',unknown:'Unknown',canceling:'Canceling',observing:'Progressing',Healthy:'Healthy',Running:'Running',Ready:'Ready',Available:'Available',pending:'Not deployed'};
  const badge = status => `<span class="status ${esc(status)}">${esc(labels[status] || status)}</span>`;
  const table = (headers, rows) => `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  const input = (label,name,value,type='text',attrs='') => `<div class="field"><label class="required" for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" required ${attrs}></div>`;
  const select = (name, values, value, attrs='') => `<select aria-label="${name}" data-control="${name}" ${attrs}>${values.map(v=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(v==='all'?'All namespaces':v)}</option>`).join('')}</select>`;
  const initial = () => {
    const apps = [
      {id:aid,name:'checkout-api',project:'commerce',repo:'https://git.example.test/shop/checkout-api.git',branch:'main',dockerfile:'Dockerfile',context:'.',imageRepository:'registry.example.test/shop/checkout-api',version:3,port:8080,replicas:2,configured:true,mode:'git'},
      {id:'a1000000-0000-4000-8000-000000000002',name:'payment-worker',project:'commerce',repo:'',branch:'main',dockerfile:'Dockerfile',context:'.',imageRepository:'registry.example.test/shop/payment-worker',version:1,port:8080,replicas:1,configured:false,mode:'git'},
      {id:'a1000000-0000-4000-8000-000000000003',name:'storefront',project:'commerce',repo:'',branch:'main',dockerfile:'Dockerfile',context:'.',imageRepository:'registry.example.test/shop/storefront',version:1,port:80,replicas:1,configured:true,mode:'image'}
    ];
    apps.forEach(a=>{a.saved={git:!!a.repo,build:a.configured,base:a.configured};a.ci=a.configured&&a.mode==='git';a.cdEnvs=a.configured?[...envs]:[];a.ciTrigger='MANUAL';a.registry='registry.example.test';a.platform='linux/amd64';a.chartType='Deployment';a.gitAccount='public';a.overrides=Object.fromEntries(envs.map(e=>[e,{replicas:e==='production'?3:a.replicas,host:`${a.name}.${e}.example.test`,version:1,enabled:false,trigger:e==='development'?'AUTO':'MANUAL'}]));});
    const artifacts=[{id:uuid(),appId:aid,digest:sha('a'),commit:'c1c836d',imageRef:`${apps[0].imageRepository}@${sha('a')}`},{id:uuid(),appId:aid,digest:sha('b'),commit:'324f74c',imageRef:`${apps[0].imageRepository}@${sha('b')}`}];
    const builds=[{id:uuid(),appId:aid,number:18,status:'canceled',commit:'c1c836d',attempt:1,configVersion:3,artifactId:null,logs:null},{id:uuid(),appId:aid,number:17,status:'succeeded',commit:'324f74c',attempt:1,configVersion:2,artifactId:artifacts[1].id,logs:null}];
    const deployments=envs.filter(e=>e!=='staging').map((env,i)=>({id:uuid(),appId:aid,env,number:16-i,status:'succeeded',artifactId:artifacts[1].id,configVersion:2,kind:'deploy',replicas:env==='production'?3:2,host:apps[0].overrides[env].host}));
    const resources=[];
    for(const env of envs){const cl=clusterFor(env),namespace=ns(env);for(const [kind,name,status] of [['Deployment','checkout-api','Available'],['Pod','checkout-api-589556d45d-demo1','Running'],['Service','checkout-api','Active'],['ConfigMap','checkout-config','Active'],['Secret','checkout-secrets','Active']])resources.push({id:uuid(),clusterId:cl,namespace,kind,name,status,rv:4821+resources.length,appId:aid,replicas:2,image:artifacts[1].imageRef,value:'info'});}
    for(const [cl,name] of [[cid,'dev-control'],[cid,'dev-worker-01'],[cid2,'prod-worker-01']])resources.push({id:uuid(),clusterId:cl,namespace:'',kind:'Node',name,status:'Ready',rv:5010+resources.length});
    resources.push({id:uuid(),clusterId:cid,namespace:'shop-dev',kind:'Certificate',name:'checkout-tls',status:'Ready',rv:5100});
    return {apps,artifacts,builds,deployments,resources,audit:[],section:'apps',appId:null,page:'list',config:'workflow',env:'development',clusterId:cid,kind:'Node',namespace:'all',resourceTabs:[],resourceId:null,resourceTab:'manifest',resourceView:'list',query:'',jump:'',groups:['Workloads'],filter:false,projectFilter:'all',menu:false,historyId:null,historyTab:'logs',overviewTab:'about',sheet:null,commit:'c1c836d',selectedArtifact:null,imageSearch:'',commitSearch:'',stage:'build',configMode:'yaml',baseTab:'deployment',overrideEdit:false,yamlDraft:'',editing:false,role:'operator',scenario:'normal',outcome:'success',dirty:false,serial:19,terminalLines:[],logsPaused:false,preview:null,createMode:'scratch'};
  };
  let state = initial(), timers=[], toastTimer, focusReturn;
  const app = () => state.apps.find(a=>a.id===state.appId);
  // Setup is derived from saved sections and real pipeline definitions, never the last Save click.
  const setup = a => {const stages=a.mode==='image'?[a.saved.base,a.cdEnvs.length>0]:[a.saved.git,a.saved.build,a.saved.base,a.ci&&a.cdEnvs.length>0];return {done:stages.filter(Boolean).length,total:stages.length};};
  const refreshSetup = a => {const s=setup(a);a.configured=s.done===s.total;};
  const buildReady = a => a.mode==='git'&&a.saved.git&&a.saved.build&&a.ci;
  const boundEnvs = () => app()?.cdEnvs||[];
  const configLocked = key => {const a=app();return (key==='workflow'&&!a.saved.base)||(a.mode==='git'&&((key==='docker-build-config'&&!a.saved.git)||(['base-config','workflow'].includes(key)&&(!a.saved.git||!a.saved.build))));};
  const allowed = () => state.role!=='viewer';
  const wd = () => allowed()?'':'disabled title="只读演示角色"';
  const targetBusy = () => state.deployments.some(d=>d.appId===state.appId&&d.env===state.env&&['queued','observing','unknown'].includes(d.status));
  const logAudit = (action,target) => state.audit.unshift({action,target,at:new Date().toISOString()});
  const later = (fn,ms) => timers.push(setTimeout(fn,ms));
  function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.add('visible');toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3200);}
  const appPath = (page='trigger',suffix='') => `${APP}/${state.appId}/${page}${suffix}`;
  const resourceListPath = () => `${RB}/${state.clusterId}/${state.kind.toLowerCase()}/${state.kind==='Deployment'?'apps':state.kind==='Certificate'?'cert-manager.io':'k8sEmptyGroup'}?namespace=${state.namespace}`;
  const resourcePath = (r,tab='manifest') => `${RB}/${r.clusterId}/${r.namespace||'_cluster'}/${r.kind.toLowerCase()}/${r.kind==='Deployment'?'apps':'k8sEmptyGroup'}/${encodeURIComponent(r.name)}/${tab}`;
  const appResourcePath = (r,tab='manifest') => appPath('details',`/${state.env}/k8s-resources/${r.kind.toLowerCase()}/${encodeURIComponent(r.name)}/${tab}`);
  function go(path){if(state.dirty&&!confirm('配置尚未保存，离开并丢弃修改？'))return;state.dirty=false;const keepQuery=(state.section==='resources'&&state.resourceView!=='clusters'&&path.startsWith(`${RB}/${state.clusterId}/`))||(state.section==='apps'&&state.page==='details'&&path.startsWith(appPath('details')));if(!keepQuery)state.query='';state.menu=false;if(location.hash.slice(1)===path)readRoute();else location.hash=path;}
  function openSheet(type){focusReturn=document.activeElement;state.sheet=type;state.stage='build';const path=location.hash.slice(1).split('?')[0];const params=new URLSearchParams(location.hash.split('?')[1]||'');params.set('panel',type);go(`${path}?${params}`);}
  function closeSheet(){if(state.dirty&&!confirm('丢弃当前未保存输入？'))return;state.dirty=false;state.sheet=null;const u=new URL('https://prototype.test'+location.hash.slice(1));u.searchParams.delete('panel');go(u.pathname+u.search);focusReturn?.focus();}
  function readRoute(){
    const u=new URL('https://prototype.test'+(location.hash.slice(1)||`${APP}/list`));const p=u.pathname.split('/').filter(Boolean);
    const previousApp=state.appId,previousPage=state.page;state.sheet=u.searchParams.get('panel');state.menu=false;
    if(p[0]==='application-management'){
      state.section='apps';state.appId=p[2]&&p[2]!=='list'?p[2]:null;state.page=p[3]||'list';
      if(state.appId&&state.page==='list')state.page='trigger';
      if(state.page==='details'&&previousPage!=='details')state.kind='Pod';
      if(previousApp!==state.appId){state.historyId=null;state.selectedArtifact=null;}
      state.config=p[4]||'workflow';
      if(state.page==='edit'&&state.config==='env-override'&&envs.includes(p[5]))state.env=p[5];
      if(state.page==='details'&&envs.includes(p[4])){
        state.env=p[4];state.resourceId=null;
        if(p[5]==='k8s-resources'&&p[6])state.kind=Object.values(kindGroups).flat().find(k=>k.toLowerCase()===p[6])||'Pod';
        if(p[7]){const r=state.resources.find(r=>r.appId===state.appId&&r.namespace===ns(state.env)&&r.kind===state.kind&&r.name===decodeURIComponent(p[7]));if(r){state.resourceId=r.id;state.resourceTab=p[8]||'manifest';state.appResourceTabs||=[];if(!state.appResourceTabs.includes(r.id))state.appResourceTabs.push(r.id);}}
      }
      if(['ci-details','cd-details'].includes(state.page)){state.historyId=p[4]||null;state.historyTab=p[5]||(state.page==='ci-details'?'logs':'source');}
    }else if(p[0]==='infrastructure-management'){
      state.section='resources';state.appId=null;
      if(!p[2]||p[2]==='list'){state.resourceView='clusters';state.resourceId=null;}
      else{
        if(state.clusterId!==p[2]){state.resourceTabs=[];state.namespace='all';}state.clusterId=p[2];
        if(p[3]==='overview'){state.resourceView='overview';state.resourceId=null;}
        else if(p[3]==='terminal'){state.resourceView='terminal';state.resourceId=null;}
        else if(p.length>=8){
          const r=state.resources.find(r=>r.clusterId===p[2]&&r.name===decodeURIComponent(p[6])&&r.namespace===(p[3]==='_cluster'?'':p[3])&&r.kind.toLowerCase()===p[4]);
          state.resourceView=r?'detail':'missing';state.resourceId=r?.id||null;state.resourceTab=p[7]||'manifest';state.editing=false;state.yamlDraft='';
          if(r&&!state.resourceTabs.includes(r.id))state.resourceTabs.push(r.id);
        }else{state.resourceView='list';state.resourceId=null;const kinds=Object.values(kindGroups).flat();state.kind=kinds.find(k=>k.toLowerCase()===p[3])||'Node';state.namespace=u.searchParams.get('namespace')||state.namespace;}
      }
    }else{state.section='audit';state.appId=null;}
    render();syncSheet();
  }
  const icons={apps:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4m3-10h4m-2-2v4"/>',resources:'<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M8 8V5a4 4 0 0 1 8 0v3m-3 5h5m-3-2v4"/>',search:'<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',settings:'<path d="m9 3 6 0 1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z"/><circle cx="12" cy="12" r="3"/>',audit:'<path d="M5 3h14v18H5zm3 5h8m-8 4h8m-8 4h5"/>'};
  function rail(){return `<aside class="rail"><div class="brand" title="Podry">P</div>${[['apps',`${APP}/list`,'应用管理'],['resources',`${RB}/list`,'资源浏览器'],['audit','/settings/audit','操作审计']].map(([key,path,label])=>`<a href="#${path}" class="rail-link ${state.section===key?'active':''}" aria-label="${label}"><svg viewBox="0 0 24 24" aria-hidden="true">${icons[key]}</svg><span>${label}</span></a>`).join('')}<a class="rail-link rail-bottom" href="../references/devtron-live/gallery.html" target="_blank" aria-label="真实页面截图"><svg viewBox="0 0 24 24">${icons.search}</svg><span>真实页面截图</span></a></aside>`;}
  function header(){
    let crumb,actions='';
    if(state.section==='apps'){
      crumb=state.appId?`${L('Applications',`${APP}/list`)} / <strong>${esc(app()?.name||'Application not found')}</strong><span class="env-count">　│　${B(`${boundEnvs().length}/${boundEnvs().length} Environments ⌄`,'env-filter','','link')}</span>`:'<strong>Applications</strong>';
      if(!state.appId)actions=B('Create ⌄','create-menu',wd(),'primary');
    }else if(state.section==='resources'){
      crumb=`${L('Resource Browser',`${RB}/list`)}${state.resourceView==='clusters'?'':` / ${select('cluster',[cid,cid2],state.clusterId).replace(`>${cid}<`,`>${clusterName(cid)}<`).replace(`>${cid2}<`,`>${clusterName(cid2)}<`)}`}`;
      actions=state.resourceView==='clusters'?'':B('＋ Create Resource','create-resource',wd(),'primary');
    }else crumb='<strong>操作审计</strong>';
    return `<header class="header"><div class="crumb">${crumb}</div><div class="header-tools">${actions}<span class="demo-mark">离线原型 V2.1</span><a class="help" href="01-page-spec.md" target="_blank">ⓘ Help</a><span class="avatar" title="Demo operator">D</span></div></header>`;
  }
  function render(){
    const focus=document.activeElement?.dataset.control,pos=document.activeElement?.selectionStart;
    $('#workspace').innerHTML=`${rail()}<main class="main">${header()}<div class="page">${state.section==='apps'?(state.appId?appShell():appList()):state.section==='resources'?resourceShell():auditPage()}</div></main>${state.menu?`<div class="popover">${B('Custom app<small>Connect a git repository to deploy a custom application</small>','create-app')}${B('已有镜像应用<small>导入固定镜像 digest，复用部署流程</small>','create-image-app')}</div>`:''}<details class="review"><summary>Demo</summary><div class="review-body"><label>角色${select('role',['operator','viewer'],state.role)}</label><label>数据场景${select('scenario',['normal','empty','offline'],state.scenario)}</label><label>任务结果${select('outcome',['success','failure','unknown'],state.outcome)}</label>${B('重置演示','reset')}<a href="../references/devtron-live/gallery.html" target="_blank">真实实例截图对照 ↗</a><small>全部业务数据与写入均为本地模拟。</small></div></details>`;
    $('.review-body').insertAdjacentHTML('beforeend',`<label>构建日志${select('log-storage',['retained','runtime-only'],state.logStorage||'retained')}</label>`);
    if(focus){const e=document.querySelector(`[data-control="${focus}"]`);e?.focus();if(typeof pos==='number'&&e?.setSelectionRange)e.setSelectionRange(pos,pos);}
  }
  function appList(){
    const items=state.apps.filter(a=>(a.name.includes(state.query)||a.project.includes(state.query))&&(state.projectFilter==='all'||a.configured===false));
    return `<div class="toolbar"><input data-control="app-search" aria-label="搜索应用" placeholder="⌕ Search by app name" value="${esc(state.query)}">${B('☰ Filter','filter-apps')}<span class="right muted">⟳ A few seconds ago</span>${B('↓ Export CSV','export-apps','','link')}</div>${state.filter?`<div class="filter-panel"><label>配置状态 ${select('app-filter',['all','not-configured'],state.projectFilter)}</label>${B('Clear','clear-filters','','link')}</div>`:''}${items.length?table(['APP NAME ↑','ENVIRONMENT','CLUSTER','NAMESPACE','LAST DEPLOYED AT',''],items.map(a=>{const env=a.cdEnvs[0],deployed=state.deployments.some(d=>d.appId===a.id&&d.status==='succeeded');return `<tr><td>${L(esc(a.name),`${APP}/${a.id}/${env?'details/'+env:'edit/'+(a.mode==='image'?'base-config':'materials')}`,'list-name')}</td><td>${env||'Not configured'}</td><td>${env?clusterName(clusterFor(env)):''}</td><td>${env?ns(env):''}</td><td>${deployed?'9 hours ago':env?'Not deployed':''}</td><td>${L('⚙',`${APP}/${a.id}/edit/workflow`)}</td></tr>`;})):empty('No applications found','清空搜索或调整筛选。')}`;
  }
  function appShell(){
    if(!app())return empty('Application not found','请返回应用列表。');
    const tabs=[['overview','Overview'],['details','App Details'],['trigger','Build & Deploy'],['ci-details','Build History'],['cd-details','Deployment History'],['edit','⚒ Configurations']];
    const pathFor=k=>k==='edit'?appPath(k,'/workflow'):k==='details'?appPath(k,`/${boundEnvs().includes(state.env)?state.env:boundEnvs()[0]||state.env}`):appPath(k);
    const views={overview,details:appDetails,trigger:()=>workflow(false),'ci-details':()=>history(false),'cd-details':()=>history(true),edit:configuration};
    return `<nav class="tabs" aria-label="Application navigation">${tabs.map(([k,label])=>L(label,pathFor(k),state.page===k?'active':'')).join('')}</nav>${views[state.page]?views[state.page]():empty('页面不存在','从顶部页签继续。')}`;
  }
  function overview(){
    const a=app();return `<div class="about-layout"><aside class="about-meta"><h2>${esc(a.name)}</h2><p class="muted">${esc(a.description||'Write a short description for this application')}</p><p><small>Project</small><br>${esc(a.project)}</p><p><small>Created by</small><br>Demo operator</p><p><small>Code source</small><br>${esc(a.mode==='image'?'External image':a.name)}</p><p><small>Tags</small><br>service / commerce</p></aside><section class="about-main"><div class="tabs">${['about','environments','readme'].map(t=>B(t[0].toUpperCase()+t.slice(1),'overview-tab',`data-tab="${t}"`,state.overviewTab===t?'active':'')).join('')}</div>${state.overviewTab==='environments'?table(['ENVIRONMENT','STATUS','TARGET',''],a.cdEnvs.map(env=>`<tr><td>${env}</td><td>${badge(state.deployments.some(d=>d.appId===a.id&&d.env===env)?'Healthy':'pending')}</td><td>${clusterName(clusterFor(env))} / ${ns(env)}</td><td>${L('App Details',appPath('details',`/${env}`))}</td></tr>`)):`<div class="panel"><h3>${state.overviewTab==='readme'?'Readme':'Describe this application'}</h3><div class="gap"></div><p>${esc(a.description||'应用独立构建，按环境部署。先在 Configurations 配置交付流程，再从 Build & Deploy 执行。')}</p></div>`}</section></div>`;
  }
  function configuration(){
    const focused=['base-config','env-override'].includes(state.config),envOverride=state.config==='env-override';
    const item=(label,key)=>configLocked(key)?`<span class="locked-config" title="先保存前面的配置">${label}<span>♙</span></span>`:L(label,appPath('edit',`/${key}`),state.config===key?'active':'');
    const a=app(),progress=setup(a),progressPanel=!a.configured?`<div class="setup-progress"><small>${progress.done}/${progress.total} Completed</small><progress max="${progress.total}" value="${progress.done}" aria-label="配置完成进度"></progress><span>${{materials:'Git Repository','docker-build-config':'Build Configuration','base-config':'Base Configurations',workflow:'Workflow Editor'}[state.config]||'Application setup'}</span></div>`:'';
    const sidebar=focused?`${L('‹ '+(envOverride?state.env:'Base Configurations'),appPath('edit','/workflow'))}<hr>${B('⇄ Compare With…','compare-config')}<hr>${['deployment','configmaps','secrets'].map(k=>B({deployment:'Deployment Template',configmaps:'▸ ConfigMaps',secrets:'▸ Secrets'}[k],'base-tab',`data-tab="${k}"`,state.baseTab===k?'active':'')).join('')}`:`${item('Git Repository','materials')}${item('Build Configuration','docker-build-config')}${item('Base Configurations','base-config')}${item('Workflow Editor','workflow')}<hr>${item('External Links','external-links')}<hr><div class="caption">ENVIRONMENT OVERRIDES</div>${envs.map(env=>L(env,appPath('edit',`/env-override/${env}`))).join('')}<div class="bottom"></div>${B('Delete Application','delete-app',wd(),'danger')}`;
    let content;
    if(configLocked(state.config))content=empty('Complete previous configuration','先保存 Git Repository、Build Configuration 和 Base Configurations。')+L('Continue setup',appPath('edit',!a.saved.git?'/materials':!a.saved.build?'/docker-build-config':'/base-config'),'setup-continue');
    else if(envOverride&&!boundEnvs().includes(state.env))content=empty('Environment is not configured','请先创建该环境的部署流水线。');
    else if(state.config==='workflow')content=workflow(true);
    else if(focused)content=baseConfiguration(envOverride);
    else if(state.config==='materials')content=`<div class="git-workspace"><div class="page-title"><div><h2>Git Repositories</h2><p class="muted">Manage source code repositories for this application.</p></div>${a.repo?B('Edit','edit-git',wd(),'link'):''}</div>${a.mode==='image'?empty('External image source','已有镜像模式无需 Git 仓库。'):a.repo?`<div class="panel row spread"><div><strong>${esc(a.repo.split('/').pop().replace(/\.git$/,''))}</strong><span class="subline">${esc(a.repo)}</span><span class="subline">${a.gitAccount==='public'?'Public HTTPS':'Project credential reference'}</span></div><span class="tag green">Saved</span></div>`:`<div class="notice sample-hint"><strong>Looking to deploy a sample application?</strong><p>可填入你自己的 HTTPS Git 仓库，或使用此次参考仓库。</p>${B('Use hello-world sample','sample-repository','','link')}</div><form id="git-form" class="panel">${gitFields(a)}<div class="row"><button class="primary" ${wd()}>Save</button></div></form>`}</div><div class="form-footer">${B('Next →','setup-next',`${!a.saved.git||state.dirty?'disabled':''}`,'primary')}</div>`;
    else if(state.config==='docker-build-config')content=buildConfiguration();
    else content=empty('External Links','首版不提供外部工具配置。');
    const actualSidebar=sidebar.replace(envs.map(env=>L(env,appPath('edit',`/env-override/${env}`))).join(''),boundEnvs().length?boundEnvs().map(env=>L(env,appPath('edit',`/env-override/${env}`))).join(''):'<p class="env-explanation">Environment overrides allow you to manage environment specific configurations after you’ve created deployment pipelines.</p>');
    return `<div class="split"><aside class="side config-nav">${focused?'':progressPanel}${actualSidebar}</aside><section class="surface config-surface">${content}</section></div>`;
  }
  function gitFields(a){return `<h3>${a.repo?'Edit':'Add'} Git Repository</h3><div class="gap"></div><div class="form-grid"><div class="field"><label class="required" for="git-account">Git Account</label><select id="git-account" name="gitAccount"><option value="public">Public HTTPS (Github / GitLab)</option><option disabled>Project credential · 待接入</option></select></div>${input('Git Repo URL (use https)','repo',a.repo,'url','pattern="https://.+"')}</div><details><summary>Repository options</summary><div class="gap"></div>${input('Default branch (CI can override)','branch',a.branch||'master')}<label class="radio"><input type="checkbox" disabled>Exclude paths · 后续范围</label><label class="radio"><input type="checkbox" disabled>Set clone directory · 单仓库首版固定为工作区根目录</label><label class="radio"><input type="checkbox" disabled>Pull submodules recursively · 后续范围</label></details>`;}
  function buildConfiguration(){
    const a=app();return `<form id="build-config-form" class="config-form"><div class="section"><h2 class="config-title">Build Configuration</h2><h3>Store container image at</h3><div class="gap"></div><div class="form-grid">${input('Container Registry','registry',a.registry)}${input('Container Repository','imageRepository',a.imageRepository)}</div><h3>How do you want to build the container image?</h3><div class="config-choice"><div class="choice active"><strong>◉ I have a Dockerfile</strong><p>Requires a Dockerfile, gives full control of the build process.</p></div><div class="choice"><strong>Create Dockerfile</strong><p>模板生成：后续范围</p></div><div class="choice"><strong>Build without Dockerfile</strong><p>Buildpacks：后续范围</p></div></div><p class="muted">Repository: ${esc(a.repo)} · 路径均相对仓库根目录，不自动检测 Dockerfile。</p><div class="gap"></div><div class="form-grid">${input('Dockerfile Path (Relative)','dockerfile',a.dockerfile)}${input('Build Context Path (Relative)','context',a.context)}</div><details><summary>Advanced options</summary><div class="gap"></div>${input('Target platform','platform',a.platform)}</details></div><div class="form-footer"><small class="grow">Configuration v${a.version} · 本地草稿</small><button name="intent" value="save" ${wd()}>Save Configuration</button><button name="intent" value="next" class="primary" ${wd()}>Save & Next →</button></div></form>`;
  }
  function valuesYaml(a,env=false){if(a.chartType==='Job')return `# One-shot application workload, separate from the CI runner Job\njob:\n  completions: 1\n  parallelism: 1\n  backoffLimit: ${(env?a.overrides[state.env]:a).backoffLimit??a.backoffLimit??0}\n  activeDeadlineSeconds: ${(env?a.overrides[state.env]:a).jobDeadline??a.jobDeadline??300}\n  restartPolicy: Never\nservice:\n  enabled: false\ningress:\n  enabled: false\n`;return `# Podry application values — local sample\nreplicaCount: ${env?a.overrides[state.env].replicas:a.replicas}\nimage:\n  repository: ${a.imageRepository}\n  pullPolicy: IfNotPresent\nservice:\n  port: ${a.port}\nresources:\n  requests:\n    cpu: 100m\n    memory: 128Mi\n  limits:\n    cpu: 1\n    memory: 512Mi\ningress:\n  enabled: true\n  host: ${a.overrides[state.env].host}\nreadinessProbe:\n  httpGet:\n    path: /healthz\n    port: ${a.port}\n` ;}
  function baseConfiguration(override){
    const a=app(),o=a.overrides[state.env];
    if(state.baseTab!=='deployment')return `<div class="padded"><div class="page-title"><h2>${state.baseTab==='secrets'?'Secrets':'ConfigMaps'}</h2>${state.baseTab==='configmaps'?B('＋ Add ConfigMap','configmap-form',wd(),'primary'):''}</div>${state.baseTab==='secrets'?empty('Secret values are redacted','凭据使用版本引用；原型不采集真实敏感信息。'):`<div class="panel">checkout-config <span class="subline">LOG_LEVEL: info · 以文件或环境变量挂载</span></div>`}</div>`;
    return `<div class="editor-shell"><div class="tabs"><span class="row">${override?'Inherited':'Configuration'}</span>${override?B(o.enabled?'Override configured':'No override','enable-override',wd(),''):''}${B('Dry run','dry-run')}</div><div class="editor-toolbar">${B('GUI','config-mode','data-mode="gui"',state.configMode==='gui'?'primary':'')}${B('YAML','config-mode','data-mode="yaml"',state.configMode==='yaml'?'primary':'')}<small>Chart</small><select aria-label="Chart type" data-control="chart-type" ${a.saved.base||override?'disabled':''}><option ${a.chartType==='Deployment'?'selected':''}>Deployment</option><option ${a.chartType==='Job'?'selected':''}>Job</option><option disabled>CronJob · 后续范围</option></select><small>Version</small>1.0.0${override?'<span class="tag">Inherited from Base Configuration</span>':''}</div><div class="notice ${a.repo.includes('docker-library/hello-world')&&a.chartType==='Deployment'?'warning':''}">${a.saved.base?'Chart type cannot be changed once saved.':a.repo.includes('docker-library/hello-world')?'hello-world 运行后退出，请选择 Job 模板；Deployment 模板适用于常驻服务。':'选择工作负载模板；第一次保存后固定类型。'}</div>${state.configMode==='yaml'?`<textarea class="editor" data-control="config-yaml" aria-label="Deployment template YAML" ${override&&!o.enabled?'readonly':''}>${esc(valuesYaml(a,override))}</textarea>`:`<form id="values-form" class="padded form-grid">${a.chartType==='Job'?input('Backoff limit','backoffLimit',(override?o:a).backoffLimit??a.backoffLimit??0,'number','min="0" max="10"')+input('Active deadline (seconds)','jobDeadline',(override?o:a).jobDeadline??a.jobDeadline??300,'number','min="30" max="86400"'):input('Replicas','replicas',override?o.replicas:a.replicas,'number','min="0" max="100"')+input('Service Port','port',a.port,'number','min="1" max="65535"')+input('Ingress Host','host',o.host)}</form>`}<div class="form-footer"><small class="grow">配置 v${a.version} ${override?'· 环境配置 v'+o.version:''}</small>${B('Save Changes','save-values',`${wd()} ${override&&!o.enabled?'disabled':''}`)}${!override?B('Save & Next →','save-values-next',wd(),'primary'):''}</div></div>`;
  }
  function workflow(edit){
    const a=app(),build=state.builds.find(b=>b.appId===a.id),image=a.mode==='image';
    if(!a.ci&&!a.cdEnvs.length)return `<div class="workflow-empty">${empty('Workflows','Workflows consist of pipelines from build to deployment stages of an application.')}${edit?B('＋ New Workflow','new-workflow',wd(),'primary'):L('Configure Workflow',appPath('edit','/workflow'),'primary setup-continue')}</div>`;
    const source=`<div class="flow-node"><small>${image?'Webhook':'Git Repository'}</small><strong>${image?'External source':'◇ /'+esc(a.name)}</strong>${image?'':`<span class="subline">⑂ ${esc(a.branch)}</span>`}</div>`;
    const ci=!a.ci?'':`<span class="flow-arrow"></span><div class="flow-node pipeline"><span class="mode">${a.ciTrigger||'MANUAL'}</span><small>Build</small><strong>ci-${esc(a.name)}</strong>${edit?B('⚙','edit-ci',wd(),'node-config'):`<div class="node-state">${build?badge(build.status):'<span class="status pending">Not Triggered</span>'} ${build?L('/ Details',appPath('ci-details')):''}</div>${B('Select Material','select-material',`${wd()} ${buildReady(a)?'':'disabled'}`)}`}</div>`;
    const cd=a.cdEnvs.length?`<div class="flow-branch">${a.cdEnvs.map(env=>{const d=state.deployments.find(d=>d.appId===a.id&&d.env===env);return `<div class="flow-node pipeline"><span class="mode">${a.overrides[env].trigger||'MANUAL'}</span><small>Deploy${edit?'':a.chartType==='Job'?': Job':': Rolling'}</small><strong>${env}</strong>${edit?B('⚙','edit-cd',`data-env="${env}" ${wd()}`,'node-config'):`<div class="node-state">${badge(d?.status||'pending')} ${d?B('/ Details','deployment-env',`data-env="${env}"`,'link'):''}</div>${B('Select Image','select-image',`data-env="${env}" ${wd()}`)}`}</div>`;}).join('')}</div>`:'';
    return `<div class="workflow-list">${edit?`<div class="page-title"><h2>Workflow Editor ⓘ</h2>${B('＋ Add Deployment Pipeline','add-cd',`${wd()} ${a.cdEnvs.length===envs.length?'disabled':''}`)}</div>`:''}<div class="workflow-title">wf-${esc(a.name)}</div><div class="workflow-canvas ${edit?'editing':''}">${source}${ci}${cd?'<span class="flow-arrow"></span>'+cd:''}</div>${!a.cdEnvs.length?'<div class="notice">Build-only workflow · 尚无部署步骤，请在 Workflow Editor 添加 Deployment Pipeline。</div>':''}${a.drift?'<div class="notice warning">集群资源有临时修改。发布时请 Review 配置差异。</div>':''}</div>`;
  }
  function history(cd){
    const items=(cd?state.deployments:state.builds).filter(x=>x.appId===state.appId&&(!cd||x.env===state.env));
    const active=items.find(x=>x.id===state.historyId)||items[0];
    const tabs=cd?['source','configuration']:['logs','source','artifacts'];
    const tab=tabs.includes(state.historyTab)?state.historyTab:tabs[0];
    let body=empty(cd?'No deployment history':'No build history','先从 Build & Deploy 执行。');
    if(active){
      const artifact=state.artifacts.find(a=>a.id===active.artifactId);
      const timeline=`<div class="timeline"><div class="timeline-line">${badge('succeeded')} <strong>Triggered ${cd?'· Deployment → '+state.env:''}</strong><span class="muted">19 Nov 2026, 10:42 AM · demo operator</span></div><div class="timeline-line">${badge(active.status)} <span>${cd?'Release #':'Build #'}${active.number} · config v${active.configVersion}${cd?'':' · attempt '+active.attempt}</span></div><div class="row">${active.status==='unknown'?B('核对执行结果','reconcile',`data-id="${active.id}" data-cd="${cd}" ${wd()}`):!cd&&['failed','canceled'].includes(active.status)?B('Retry','retry-build',`data-id="${active.id}" ${wd()}`):!cd&&['queued','running'].includes(active.status)?B('Cancel build','cancel-build',`data-id="${active.id}" ${wd()}`):cd&&active.status==='succeeded'?B('Rollback','rollback',`data-id="${active.id}" ${wd()}`)+B('Promote to production','promote',`data-id="${active.id}" ${wd()}`):''}</div></div>`;
      let content;
      if(tab==='logs')content=active.logs?`<pre class="read-code dark">${esc(active.logs.join('\n'))}</pre>`:empty('Logs not available','该执行没有可用归档日志；构建结果和产物独立保留。Demo 的 runtime-only 可重现此状态。');
      else if(tab==='configuration')content=`<pre class="read-code">${esc(`# Immutable release snapshot\nworkload: ${active.chartType||'Deployment'}\nreleaseName: ${active.releaseName||app().name}\nconfigVersion: ${active.configVersion}\nenvironment: ${active.env}\nreplicas: ${active.replicas}\nhost: ${active.host}\nimage: ${artifact?.imageRef||''}`)}</pre>`;
      else if(tab==='artifacts')content=artifact?`<div class="padded"><h3>Container image</h3><div class="gap"></div><code style="overflow-wrap:anywhere">${esc(artifact.imageRef)}</code></div>`:empty('No artifacts','此构建没有可发布产物。');
      else content=cd?empty('Data not available','真实实例的外部镜像发布没有源代码详情。'): `<div class="padded"><h3>Source</h3><div class="gap"></div><p>Repository: ${esc(app().repo)}</p><p>Commit: <code>${esc(active.commit)}</code></p><p>Branch: ${esc(app().branch)}</p></div>`;
      body=`${timeline}<div class="tabs history-tabs">${tabs.map(t=>B(t[0].toUpperCase()+t.slice(1),'history-tab',`data-tab="${t}" data-id="${active.id}"`,tab===t?'active':'')).join('')}</div><div class="history-content ${tab==='logs'?'dark':''}">${content}</div>`;
    }
    return `<div class="split"><aside class="side history-side"><div class="history-select"><label>${cd?'Select Environment':'Select Pipeline'}</label>${cd?select('history-env',boundEnvs(),state.env):'<select aria-label="Select Pipeline"><option>ci-'+esc(app().name)+'</option></select>'}</div>${items.map(x=>B(`${badge(x.status)}　19 Nov 2026, 10:${x.number} AM<span class="subline">${cd?'Deploy · #':'Build #'}${x.number} · demo operator</span>`,'history-select',`data-id="${x.id}"`,(active?.id===x.id?'active ':'')+'history-row')).join('')}</aside><section class="history-main">${body}</section></div>`;
  }
  const kindGroups={'Workloads':['CronJob','DaemonSet','Deployment','Job','Pod','ReplicaSet','StatefulSet'],'Config & Storage':['ConfigMap','Secret','PersistentVolumeClaim'],'Networking':['Service','Ingress'],'RBAC':['Role','RoleBinding'],'Custom Resource':['Certificate']};
  function resourceTree(){
    const btn=(k,child=false)=>B(esc(k),'kind',`data-kind="${k}"`,`${state.kind===k?'active ':''}${child?'child':''}`);
    return `<aside class="side resource-tree"><input class="jump" data-control="kind-search" placeholder="⌕ Jump to Kind" aria-label="Jump to Kind" value="${esc(state.jump)}">${['Node','Event','Namespace'].filter(k=>k.toLowerCase().includes(state.jump.toLowerCase())).map(k=>btn(k)).join('')}${Object.entries(kindGroups).map(([group,kinds])=>`<div class="tree-group">${state.jump?'':B((state.groups.includes(group)?'⌄ ':'› ')+group,'tree-group',`data-group="${group}"`)}${state.groups.includes(group)||state.jump?kinds.filter(k=>k.toLowerCase().includes(state.jump.toLowerCase())).map(k=>btn(k,true)).join(''):''}</div>`).join('')}</aside>`;
  }
  function resourceShell(){
    if(state.resourceView==='clusters')return `<div class="toolbar"><input placeholder="⌕ Search clusters" aria-label="搜索集群" data-control="cluster-search" value="${esc(state.query)}"><strong>All Clusters</strong><span class="right muted">Last refreshed 1s ago</span>${B('Refresh','refresh','','link')}</div><div class="stats"><div><strong>2/2</strong>Healthy</div><div><strong>1/2</strong>Non-Production</div></div>${table(['CLUSTER','STATUS','TYPE','NODES','K8S VERSION','CPU CAPACITY','MEMORY CAPACITY'],[cid,cid2].filter(c=>clusterName(c).includes(state.query)).map(c=>`<tr><td>${L(clusterName(c),`${RB}/${c}/node/k8sEmptyGroup`,'list-name')}</td><td>${badge('Healthy')}</td><td>${c===cid?'Non Production':'Production'}</td><td>${c===cid?'2':'1'}</td><td>v1.32.0</td><td>8</td><td>16Gi</td></tr>`))}`;
    const current=state.resources.find(r=>r.id===state.resourceId);
    const tab=(label,path,active,close='')=>`<div class="worktab ${active?'active':''}">${B(esc(label),'go',`data-path="${esc(path)}"`)}${close?B('×','close-resource-tab',`data-id="${close}" aria-label="关闭资源页签"`,'tab-close'):''}</div>`;
    const worktabs=`<div class="worktabs" aria-label="Resource workspace tabs">${tab('◉ Overview',`${RB}/${state.clusterId}/overview`,state.resourceView==='overview')}${tab('⬡ '+state.kind,resourceListPath(),state.resourceView==='list')}${tab('▣',`${RB}/${state.clusterId}/terminal`,state.resourceView==='terminal')}${state.resourceTabs.map(id=>{const r=state.resources.find(r=>r.id===id);return r?tab(r.kind.toLowerCase()+'/'+r.name,resourcePath(r),current?.id===id,id):'';}).join('')}</div>`;
    let content;
    if(state.resourceView==='detail')content=resourceDetail(current);
    else if(state.resourceView==='missing')content=empty('Resource no longer exists','关闭旧页签或返回资源列表。');
    else if(state.resourceView==='overview')content=`<div class="padded"><h2>${clusterName(state.clusterId)}</h2><div class="gap"></div><div class="stats"><div><strong>Healthy</strong>Connection status</div><div><strong>${state.clusterId===cid?2:1}</strong>Nodes</div><div><strong>v1.32.0</strong>Kubernetes version · mock</div></div>${B('Browse Nodes','kind','data-kind="Node"')}</div>`;
    else if(state.resourceView==='terminal')content=terminalView('cluster');
    else content=`<div class="split">${resourceTree()}<section class="surface" style="display:flex;flex-direction:column">${resourceList(false)}</section></div>`;
    return worktabs+content;
  }
  function resourceList(isApp){
    const cl=isApp?clusterFor(state.env):state.clusterId,namespace=isApp?ns(state.env):state.namespace;
    let rows=state.resources.filter(r=>r.clusterId===cl&&r.kind===state.kind&&(state.kind==='Node'||namespace==='all'||r.namespace===namespace)&&(!isApp||r.appId===state.appId)&&r.name.includes(state.query));
    if(state.scenario==='empty')rows=[];
    const toolbar=`<div class="toolbar"><input aria-label="搜索资源" data-control="resource-search" placeholder="⌕ Search ${esc(state.kind)}" value="${esc(state.query)}">${state.kind==='Node'?'':isApp?`<span class="tag">${namespace}</span>`:select('namespace',['all','shop-dev','shop-staging','shop-prod'],state.namespace)}<span class="right muted">⟳ 1s ago</span>${B('Refresh','refresh','','link')}</div>`;
    if(state.scenario==='offline')return toolbar+empty('Cluster connection failed','模拟连接失败，旧资源不视为最新状态。')+`<div class="padded">${B('Reconnect','reconnect')}</div>`;
    const node=state.kind==='Node',pod=state.kind==='Pod';
    const headers=node?['NAME','STATUS','ROLES','CPU USAGE','MEM USAGE','K8S VERSION','PODS','AGE']:pod?['NAME','NAMESPACE','READY','STATUS','RESTARTS','AGE','IP','NODE']:['NAME','NAMESPACE','STATUS','READY','AGE',''];
    const cells=r=>{const name=B(esc(r.name),'open-resource',`data-id="${r.id}"`,'link list-name');if(node)return `<td>${name}</td><td>${badge(r.status)}</td><td>${r.name.includes('control')?'control-plane':'worker'}</td><td>248m</td><td>2.02Gi</td><td>v1.32.0</td><td>9</td><td>25d</td>`;if(pod)return `<td>${name}${isApp?`<span class="subline">${['logs','terminal','events','manifest'].map(t=>B(t[0].toUpperCase()+t.slice(1),'open-resource',`data-id="${r.id}" data-tab="${t}"`,'link')).join(' ')}</span>`:''}</td><td>${r.namespace}</td><td>${r.status==='Succeeded'?'0/1':'1/1'}</td><td>${badge(r.status)}</td><td>0</td><td>9h</td><td>10.42.1.82</td><td>dev-worker-01</td>`;return `<td>${name}</td><td>${r.namespace}</td><td>${badge(r.status)}</td><td>${r.replicas||'—'}</td><td>9h</td><td>${r.kind==='Deployment'?B('⋯','resource-menu',`data-id="${r.id}"`):''}</td>`;};
    return toolbar+(rows.length?table(headers,rows.map(r=>`<tr>${cells(r)}</tr>`)):empty('No matching resources','切换 Kind、Namespace 或搜索条件。'));
  }
  function appDetails(){
    const a=app(),d=state.deployments.find(d=>d.appId===a.id&&d.env===state.env);
    if(!a.cdEnvs.length)return empty('No deployment pipeline configured','创建部署流水线后，这里才会出现目标环境和运行资源。')+L('Go to Workflow Editor',appPath('edit','/workflow'),'setup-continue');
    if(!a.cdEnvs.includes(state.env))return empty('Environment is not configured','请选择已绑定的环境。')+L(a.cdEnvs[0],appPath('details',`/${a.cdEnvs[0]}`),'setup-continue');
    const tabs=(state.appResourceTabs||[]).map(id=>resourceById(id)).filter(r=>r&&r.appId===a.id&&r.namespace===ns(state.env));
    const r=resourceById();
    return `<div class="runtime-header"><div class="row"><span class="tag">ENV</span>${select('runtime-env',a.cdEnvs,state.env)}<div class="grow"></div>${B('Deploy','select-image',`data-env="${state.env}" ${wd()}`,'primary')}</div><div class="runtime-status"><div class="runtime-card"><small>Application Status</small><strong>${badge(d?.status==='succeeded'?(d.chartType==='Job'?'Complete':'Healthy'):d?.status||'pending')}</strong></div><div class="runtime-card"><small>Deployment status</small><strong>${badge(d?.status||'pending')}</strong><span class="subline">${d?'9 hours ago by demo operator':'尚未部署'}</span></div></div></div><div class="worktabs app-worktabs"><div class="worktab ${!r?'active':''}">${B('⬡ K8s Resources','go',`data-path="${appPath('details',`/${state.env}/k8s-resources/${state.kind.toLowerCase()}`)}"`)}</div>${tabs.map(item=>`<div class="worktab ${r?.id===item.id?'active':''}">${B(esc(item.kind.toLowerCase()+'/'+item.name),'go',`data-path="${appResourcePath(item)}"`)}${B('×','close-app-resource-tab',`data-id="${item.id}" aria-label="关闭应用资源页签"`,'tab-close')}</div>`).join('')}</div>${r?resourceDetail(r):`<div class="split">${resourceTree()}<section class="surface" style="display:flex;flex-direction:column">${resourceList(true)}</section></div>`}<div class="scope-footer"><span>Cluster: ${clusterName(clusterFor(state.env))}　 Namespace: ${ns(state.env)}</span>${B('All resources ↗','all-resources')}</div>`;
  }
  function manifest(r){if(r.kind==='Job')return `apiVersion: batch/v1\nkind: Job\nmetadata:\n  name: ${r.name}\n  namespace: ${r.namespace}\nspec:\n  backoffLimit: ${r.backoffLimit??0}\n  activeDeadlineSeconds: ${r.jobDeadline??300}\n  template:\n    spec:\n      restartPolicy: Never\n      containers:\n      - name: app\n        image: ${r.image}\nstatus:\n  conditions:\n  - type: Complete\n    status: \"True\"\n`;return r.manifest||`apiVersion: ${r.kind==='Deployment'?'apps/v1':'v1'}\nkind: ${r.kind}\nmetadata:\n  name: ${r.name}\n${r.namespace?'  namespace: '+r.namespace+'\n':''}  resourceVersion: "${r.rv}"\n  labels:\n    app: checkout-api\n${r.kind==='Secret'?'# Secret values redacted\ntype: Opaque\n':r.kind==='ConfigMap'?`data:\n  LOG_LEVEL: ${r.value}\n`:`spec:\n${r.kind==='Deployment'?'  replicas: '+r.replicas+'\n  template:\n    spec:\n      containers:\n      - name: app\n        image: '+r.image:'  containers:\n  - name: app\n    image: '+(r.image||'registry.example.test/system@'+sha('a'))}\nstatus:\n  phase: ${r.status}\n`}`;}
  function resourceDetail(r){
    if(!r)return empty('Resource not found');const pod=r.kind==='Pod',editable=['Deployment','ConfigMap'].includes(r.kind);
    const tabs=['manifest','events',...(pod?['logs','terminal']:[])];const t=tabs.includes(state.resourceTab)?state.resourceTab:'manifest';
    const path=state.section==='apps'?appResourcePath:resourcePath;
    const toolbar=`<div class="tabs">${tabs.map(tab=>L(tab[0].toUpperCase()+tab.slice(1),path(r,tab),tab===t?'active':'')).join('')}<div class="resource-actions">${t==='manifest'?`<label><input type="checkbox" checked>Hide Managed Fields</label>${editable?B(state.editing?'Cancel edit':'♢ Edit live manifest','edit-manifest',wd(),'link'):''}`:''}${r.kind==='Deployment'?B('Scale','scale-resource',wd(),'link')+B('Restart','restart-resource',wd(),'link'):''}${B('♧ Delete','delete-resource',wd(),'danger link')}</div></div>`;
    let body;
    if(t==='manifest')body=`<textarea class="editor dark" data-control="resource-yaml" aria-label="Live resource manifest" ${!state.editing?'readonly':''}>${esc(state.yamlDraft||manifest(r))}</textarea>${state.editing?`<div class="form-footer"><small class="grow">仅模拟 replicas / image / LOG_LEVEL；resourceVersion ${r.rv}</small>${B('Review changes','review-manifest',wd(),'primary')}</div>`:''}`;
    else if(t==='events')body=empty('Events not available','参考实例当前没有该资源事件；真实实现按 UID 查询。');
    else if(t==='logs')body=`<div class="log-toolbar">${B(state.logsPaused?'▶ Resume':'Ⅱ Pause','pause-logs')}<label>Container <select aria-label="Container"><option>app</option></select></label><label><input type="checkbox">Prev. container</label><select aria-label="Log lines"><option>500 lines</option><option>1000 lines</option></select>${B('↓ Download','download-logs','','link')}</div><pre class="read-code dark">${esc(mockLogs(r))}${state.logsPaused?'\n[Paused — simulated]':''}</pre><div class="scope-footer">${state.logsPaused?'Paused':'Connected'} · local sample</div>`;
    else body=r.status==='Succeeded'?empty('Container has completed','已结束的任务容器无法打开终端。'):terminalView(r.name);
    return `<section class="resource-detail">${toolbar}${body}</section>`;
  }
  function mockLogs(r){if(r.status==='Succeeded')return '[local sample] Hello from the one-shot demo container.\n[local sample] Process exited with code 0.\n预置日志，无真实连接。';return `[Nov 19 2026 11:55:17] ${r.name}: starting application\n[Nov 19 2026 11:55:18] INFO listening on :8080\n[Nov 19 2026 11:55:19] GET /checkout 200 12ms\n[Nov 19 2026 11:55:20] GET /healthz 200 1ms\n\n[offline prototype] 预置日志，无真实日志连接。`;}
  function terminalView(target){return `<div class="notice">模拟终端 · ${esc(target)} · 仅支持 help / pwd / ls / date / clear，不执行 shell。</div><pre id="terminal-output" class="read-code dark">${esc(state.terminalLines.join('\n')||'Podry demo terminal\n$ type help')}</pre><form id="terminal-form"><input name="command" class="terminal-input" aria-label="Terminal command" placeholder="$ help" autocomplete="off" ${wd()}></form>`;}
  function auditPage(){return `<div class="padded"><h2>操作审计 · 本地模拟会话</h2></div>${state.audit.length?table(['TIME','ACTION','TARGET'],state.audit.map(e=>`<tr><td>${esc(e.at)}</td><td>${esc(e.action)}</td><td>${esc(e.target)}</td></tr>`)):empty('No audit records','先进行一次模拟操作。')}`;}
  // Right-hand sheets retain the originating page and URL, as in the observed UI.
  function sheet(title,body,footer){const d=$('#drawer');d.innerHTML=`<header class="sheet-head"><h2 id="drawer-title">${title}</h2>${B('×','close-sheet','aria-label="Close panel"','sheet-close')}</header><div class="sheet-body">${body}</div><footer class="sheet-footer">${footer}</footer>`;if(!d.open)d.showModal();}
  function syncSheet(){
    if(!state.sheet){$('#drawer').close();return;}
    if(state.sheet==='create')return createSheet();
    if(!app()&&!['create-resource'].includes(state.sheet)){state.sheet=null;$('#drawer').close();return;}
    if(state.sheet==='material')return materialSheet();
    if(state.sheet==='image')return imageSheet();
    if(['ci','cd'].includes(state.sheet))return pipelineSheet(state.sheet==='cd');
    if(state.sheet==='git')return sheet('Git Repository',`<form id="git-form" class="sheet-form"><div class="panel">${gitFields(app())}</div></form>`,`<small class="muted">仅保存到本页内存</small><button form="git-form" class="primary" ${wd()}>Save Git Repository</button>`);
    if(state.sheet==='workflow')return workflowSheet();
    if(state.sheet==='create-resource')return sheet('Create Kubernetes Resource',`<div class="notice">Multi YAML supported in Devtron. 本原型只演示单个 ConfigMap，Apply 后进入本地预览。</div><textarea class="editor" data-control="create-resource-yaml" aria-label="New resource YAML">apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: demo-config\n  namespace: shop-dev\ndata:\n  LOG_LEVEL: info\n</textarea>`,`<small class="muted">不会向集群提交</small><div class="footer-actions">${B('Cancel','close-sheet')}${B('Apply','preview-create-resource',wd(),'primary')}</div>`);
    state.sheet=null;$('#drawer').close();
  }
  function createSheet(){
    const clone=state.createMode==='clone';
    sheet('Create Application',`<div class="split"><aside class="sheet-side">${B('♧ Create from Scratch','create-mode','data-mode="scratch"',!clone?'active':'')}${B('▣ Clone application','create-mode','data-mode="clone"',clone?'active':'')}<hr><p>应用代表一个软件项目或服务，承载代码、构建、配置和部署环境。</p><p>Applications are not environment specific and can be deployed to multiple environments.</p></aside><form id="create-app-form" class="sheet-form"><div class="panel"><div class="form-grid"><div class="field"><label class="required" for="create-project">Project</label><select id="create-project" name="project"><option>commerce</option><option>platform</option></select></div>${input('Application name','name','')}</div>${clone?`<div class="field"><label>Clone from</label><select name="cloneId">${state.apps.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select><small>只克隆配置，不复制构建、发布与资源。</small></div>`:''}<div class="field"><label>Description</label><textarea name="description" rows="4" placeholder="Write a description for this application"></textarea></div><details><summary>Add tags to application</summary><div class="gap"></div><input name="tags" placeholder="service=checkout"></details></div></form></div>`,`<small class="muted">创建后进入配置向导</small><button type="submit" form="create-app-form" class="primary" ${wd()}>Create Application</button>`);
  }
  const commits=[['c1c836d','ci: 固定构建镜像引用并优化部署配置'],['324f74c','feat: 应用配置页面与环境绑定'],['737995c','fix: 更新容器健康检查'],['9bd8e0e','feat: 初始化服务']];
  function materialSheet(){
    const a=app(),available=state.materialState==='ready',items=commits.filter(([hash])=>hash.includes(state.commitSearch));sheet(`Build Pipeline 'ci-${esc(a.name)}'`,`<div class="split"><aside class="sheet-side"><small>Git Repository</small><div class="gap"></div><strong>◇ /${esc(a.name)}</strong><p>⑂ ${esc(a.branch)}</p><small>${available?'Updated a minute ago':'Source unavailable'}</small></aside><div class="sheet-form"><div class="row spread"><strong>⑂ ${esc(a.branch)}</strong><input data-control="commit-search" placeholder="⌕ Search by commit hash" value="${esc(state.commitSearch)}"></div><div class="gap"></div>${available?(items.length?items.map(([hash,msg])=>B(`<span class="selected-check">${state.commit===hash?'●':'○'}</span><span class="tag mono">${hash}</span><div class="commit-message">${msg}</div><small>Demo developer · 19 Nov 2026, 10:42 AM</small>`,'choose-commit',`data-commit="${hash}"`, `commit ${state.commit===hash?'selected':''}`)).join(''):empty('No matching commits','清空搜索后重新选择。')):empty(state.materialState==='empty'?'No commits found':'Unable to load commits',state.materialState==='empty'?'分支没有可用提交；检查分支名称。':'Git 服务暂时不可达；保存过仓库地址不代表当前能够拉取代码。')+B('Retry','retry-material',wd())}<div class="gap"></div><small>以上为本地模拟提交；不会连接真实 Git 仓库。</small></div></div>`,`<small class="muted">固定提交 → 构建不可变镜像产物</small>${B('▷ Start Build','start-build',`${wd()} ${available&&items.some(([hash])=>hash===state.commit)&&buildReady(a)?'':'disabled'}`,'primary')}`);
  }
  function imageSheet(){
    const items=state.artifacts.filter(a=>a.appId===state.appId&&a.commit.includes(state.imageSearch));
    if(!state.selectedArtifact&&items[0])state.selectedArtifact=items[0].id;
    if(!items.some(a=>a.id===state.selectedArtifact))state.selectedArtifact=items[0]?.id||null;
    sheet(`Deploy to ${state.env}`,`<div class="sheet-form"><div class="row spread"><strong>Select Image</strong><input data-control="image-search" placeholder="⌕ Search by image tag" value="${esc(state.imageSearch)}"></div><div class="gap"></div>${items.length?items.map((a,i)=>B(`<span class="selected-check">${state.selectedArtifact===a.id?'●':'○'}</span>${i===0?'<span class="tag green">Latest</span>':''}<span class="tag">${a.commit}</span><span class="subline mono">${esc(a.digest)}</span>`,'choose-image',`data-id="${a.id}"`,`image-option ${state.selectedArtifact===a.id?'selected':''}`)).join(''):empty(state.imageSearch?'No matching images':'No Image Available',state.imageSearch?'调整搜索条件。':'Please trigger CI pipeline and find the image here for deployment.')}${app().mode==='image'?B('导入示例固定镜像','import-image',wd()):''}${targetBusy()?'<div class="notice warning">当前目标已被执行任务占用。结果未知时先到 Deployment History 核对。</div>':''}</div>`,`<div class="row"><span class="tag">Deploy: Last saved config v${app().version}</span>${B('REVIEW','review-deploy',`${!state.selectedArtifact?'disabled':''}`,'link')}</div>${B('🚀 Deploy','review-deploy',`${wd()} ${!state.selectedArtifact||targetBusy()?'disabled':''}`,'primary')}`);
  }
  function workflowTemplates(){const image=app().mode==='image';modal('Workflow templates',`<p>Select a template to create a workflow</p><div class="workflow-templates">${image?B('<strong>Deploy Image from External Service</strong><span>导入固定镜像，部署到所选环境。</span>','workflow-template','data-template="image"','workflow-template'):B('<strong>Build & Deploy from Source Code</strong><span>Build container image from a Git repo and deploy to an environment.</span><small>主要流程 · 同时创建 CI 和 Deploy 步骤</small>','workflow-template','data-template="combined"','workflow-template recommended')+B('<strong>Build from Source Code</strong><span>仅构建镜像，之后可单独添加部署步骤。</span>','workflow-template','data-template="ci"','workflow-template')}<small>Linked Build Pipeline、Create Job 工作流和多 CI 编排为后续范围。应用 Job 工作负载模板可在 Base Configurations 选择。</small></div>`);}
  function environmentFields(selected='',creating=true){const a=app(),options=creating?envs.filter(env=>!a.cdEnvs.includes(env)):a.cdEnvs;return `<h3>Select environment to deploy</h3><div class="gap"></div><div class="form-grid"><div class="field"><label class="required" for="workflow-env">Environment</label><select id="workflow-env" name="env" data-control="workflow-env" required ${creating?'':'disabled'}><option value="">Select environment</option>${options.map(env=>`<option value="${env}" ${env===selected?'selected':''}>${env}</option>`).join('')}</select>${!creating?`<input type="hidden" name="env" value="${selected}">`:''}</div>${input('Namespace','namespace',selected?ns(selected):'','text','readonly')}</div><div class="form-grid">${input('Cluster','clusterName',selected?clusterName(clusterFor(selected)):'','text','readonly')}${input('Helm release name','releaseName',selected?(a.overrides[selected].releaseName||a.name.slice(0,53).replace(/-$/,'')):a.name.slice(0,53).replace(/-$/,''),'text','pattern="[a-z][a-z0-9-]{1,51}[a-z0-9]"')}</div><label class="radio"><input type="radio" name="trigger" value="AUTO" ${selected==='development'&&a.overrides[selected].trigger==='AUTO'?'checked':''} ${selected!=='development'?'disabled':''}>Automatic · development only</label><label class="radio"><input type="radio" name="trigger" value="MANUAL" ${selected!=='development'||a.overrides[selected].trigger!=='AUTO'?'checked':''}>Manual</label>`;}
  function workflowSheet(){const a=app(),combined=state.workflowTemplate==='combined',image=state.workflowTemplate==='image';sheet(combined?'Build and deploy from source code':image?'Deploy image from external service':'Create build pipeline',`<form id="workflow-template-form" class="sheet-form"><div class="panel">${image?'':`<h3>Select code source to build image</h3><p class="muted">${esc(a.repo)}</p><div class="gap"></div><div class="form-grid"><div class="field"><label>Source Type</label><select disabled><option>Branch Fixed</option></select></div>${input('Branch Name','branch',a.branch)}</div>`}${combined||image?environmentFields():''}<p class="muted">You can add additional configurations after creating the workflow.</p></div></form>`,`<small class="muted">${combined?'一次保存 CI + 环境绑定 + CD，未提交前不生成任何节点。':'仅保存本地定义。'}</small><button form="workflow-template-form" class="primary" ${wd()}>${combined||image?'Create Workflow':'Create Pipeline'}</button>`);}
  function pipelineSheet(cd){
    const a=app();const stages=cd?['pre-deployment','build','post-deployment']:['pre-build','build','post-build'];
    const stageLabel=k=>k==='build'?(cd?'Deployment stage':'Build stage'):k.replace('-', ' ')+' stage';
    const body=state.stage==='build'?`<form id="pipeline-form" class="sheet-form"><div class="panel">${input('Pipeline Name','pipelineName',cd?'deploy-'+state.env:'ci-'+a.name)}${cd?environmentFields(state.pipelineCreate?'':state.env,!!state.pipelineCreate)+`<div class="gap"></div><h3>Deployment Strategy</h3><div class="gap"></div><span class="tag">${a.chartType==='Job'?'JOB · Wait for Complete':'ROLLING · DEFAULT'}</span><div class="gap"></div><label class="radio"><input type="checkbox" checked disabled>Pull container image with image digest</label><small>Podry 固定以 digest 发布。</small>`:`<h3>Select code source</h3><div class="gap"></div><strong>◇ ${esc(a.name)}</strong><div class="gap"></div><div class="form-grid"><div class="field"><label>Source Type</label><select><option>Branch Fixed</option></select></div>${input('Branch Name','branch',a.branch)}</div><label class="radio"><input type="radio" name="ciTrigger" value="AUTO" ${a.ciTrigger==='AUTO'?'checked':''}>Automatically</label><label class="radio"><input type="radio" name="ciTrigger" value="MANUAL" ${a.ciTrigger!=='AUTO'?'checked':''}>Manually</label><h3>Override Options</h3><div class="gap"></div><div class="form-grid">${input('Dockerfile Path','dockerfile',a.dockerfile)}${input('Build Context','context',a.context)}</div>${input('Container Repository','imageRepository',a.imageRepository)}`}</div></form>`:empty('Stage configuration','本期聚焦镜像构建与发布，自定义前后置任务后续实现。');
    sheet((state.pipelineCreate?'Create':'Edit')+(cd?' deployment pipeline':' build pipeline'),`<div class="tabs sheet-tabs">${stages.map(k=>B(stageLabel(k),'stage-tab',`data-stage="${k}"`,state.stage===k?'active':'')).join('')}</div><div class="split"><aside class="sheet-side"><small>${cd?'DEPLOYMENT':'TRIGGER BUILD PIPELINE'}</small><p>通过配置节点编辑，执行入口位于 Build & Deploy。</p></aside>${body}</div>`,`<small class="muted">只修改本地配置草稿</small>${state.stage==='build'?'<button form="pipeline-form" class="primary" '+wd()+'>'+(state.pipelineCreate?'Create Pipeline':'Update Pipeline')+'</button>':B('Back to main stage','stage-tab','data-stage="build"')}`);
  }
  function modal(title,body,footer){const d=$('#modal');d.innerHTML=`<header class="sheet-head"><h2 id="modal-title">${title}</h2>${B('×','close-modal','aria-label="Close dialog"','sheet-close')}</header><div class="modal-body">${body}</div><footer class="modal-footer">${B('Cancel','close-modal')}${footer||''}</footer>`;d.showModal();}
  function deploymentPreview(kind='deploy',source=null){
    if(!allowed()||targetBusy())return toast('当前角色不可发布或目标已被占用。');
    const a=app(),art=state.artifacts.find(a=>a.id===(source?.artifactId||state.selectedArtifact));if(!art)return toast('Select an image first.');
    const env=kind==='promote'?'production':state.env,o=a.overrides[env];
    if(!a.cdEnvs.includes(env))return toast('目标环境尚未配置 Deployment Pipeline。');
    if(state.deployments.some(d=>d.appId===a.id&&d.env===env&&['queued','observing','unknown'].includes(d.status)))return toast('目标已被占用，请先核对任务。');
    state.preview={kind,artifactId:art.id,env,chartType:kind==='rollback'?source.chartType||a.chartType:a.chartType,releaseName:o.releaseName||a.name,jobDeadline:kind==='rollback'?source.jobDeadline:o.jobDeadline??a.jobDeadline??300,backoffLimit:kind==='rollback'?source.backoffLimit:o.backoffLimit??a.backoffLimit??0,configVersion:kind==='rollback'?source.configVersion:a.version,replicas:kind==='rollback'?source.replicas:o.replicas,host:kind==='rollback'?source.host:o.host,sourceId:source?.id||null};
    modal('Review deployment',table(['FIELD','VALUE'],[['Environment',env],['Cluster',clusterName(clusterFor(env))],['Namespace',ns(env)],['Release',state.preview.releaseName],['Workload',state.preview.chartType],['Image',art.imageRef],['Configuration','v'+state.preview.configVersion],...(a.chartType==='Job'?[['Completion policy','Job Complete = True'],['Active deadline',state.preview.jobDeadline+'s']]:[['Replicas',state.preview.replicas],['Ingress',state.preview.host]]),['Operation',kind]].map(([k,v])=>`<tr><td>${k}</td><td style="white-space:normal;overflow-wrap:anywhere">${esc(v)}</td></tr>`))+`<div class="gap"></div><div class="notice">${a.drift?'集群存在临时变更，发布会按此配置快照覆盖。':'已固定镜像 digest 与配置快照。'} ${a.chartType==='Job'?'确认将执行一次新任务；回滚或晋级也会运行新的任务，不能撤销任务产生的外部影响。':'此确认步骤是 Podry 的发布约定。'}</div>`,B('Confirm Deploy','confirm-deploy',wd(),'primary'));
  }
  function finishBuild(b){b.status='succeeded';const art={id:uuid(),appId:b.appId,digest:sha((b.number%16).toString(16)),commit:b.commit,imageRef:`${b.imageRepository}@${sha((b.number%16).toString(16))}`};state.artifacts.unshift(art);b.artifactId=art.id;(b.logs||=[]).push('[push] '+art.digest);b.logState=b.logStorage==='runtime-only'?'runtime_only':'archived';if(b.logState==='runtime_only')b.logs=null;}
  function beginBuild(existing=null){
    if(!allowed())return;const a=app(),outcome=state.outcome;
    if(!buildReady(a)||(!existing&&state.materialState!=='ready'))return toast('请先配置 CI 并加载可用提交。');
    if(existing&&!['failed','canceled'].includes(existing.status))return;
    const b=existing||{id:uuid(),appId:a.id,number:state.serial++,commit:state.commit,configVersion:a.version,attempt:0,imageRepository:a.imageRepository};
    if(existing)(b.attempts||=[]).push({attempt:b.attempt,status:b.status,logs:[...(b.logs||[])]});
    if(!existing)state.builds.unshift(b);b.attempt++;b.status='queued';b.logStorage=state.logStorage||'retained';b.logState='runtime';b.logs=['[queue] Build #'+b.number,'[source] fixed commit '+b.commit];b.imageRepository||=a.imageRepository;
    const attempt=b.attempt;state.historyId=b.id;logAudit(existing?'build.retry':'build.trigger',a.name);$('#drawer').close();state.sheet=null;go(appPath('ci-details',`/${b.id}/logs`));
    later(()=>{if(b.status!=='queued'||b.attempt!==attempt)return;b.status='running';b.logs.push('[build] BuildKit building image');render();},300);
    later(()=>{if(b.status!=='running'||b.attempt!==attempt)return;if(outcome==='success')finishBuild(b);else {b.status=outcome==='unknown'?'unknown':'failed';b.logs.push('[observe] '+b.status);}render();},1000);
  }
  function confirmDeploy(){
    if(!allowed()||!state.preview)return;const p=state.preview,a=app();
    if(state.deployments.some(d=>d.appId===a.id&&d.env===p.env&&['queued','observing','unknown'].includes(d.status)))return toast('目标已被占用。');
    if(p.kind!=='rollback'&&p.configVersion!==a.version)return toast('配置已变化，请重新预览。');
    const d={...p,id:uuid(),appId:a.id,number:state.serial++,status:'queued'},outcome=state.outcome;state.deployments.unshift(d);state.env=p.env;logAudit('deployment.'+p.kind,a.name+'/'+p.env);state.preview=null;$('#modal').close();$('#drawer').close();state.sheet=null;go(appPath('cd-details',`/${d.id}/configuration`));
    later(()=>{d.status='observing';render();},250);later(()=>{d.status=outcome==='success'?'succeeded':outcome==='unknown'?'unknown':'failed';if(d.status==='succeeded'){a.drift=false;syncResources(d);}render();},1000);
  }
  function syncResources(d){const art=state.artifacts.find(a=>a.id===d.artifactId),a=state.apps.find(a=>a.id===d.appId),existing=state.resources.filter(r=>r.appId===d.appId&&r.namespace===ns(d.env));if(d.chartType==='Job'){
      for(const [kind,name,status] of [['Job',`${a.name}-${d.number}`,'Complete'],['Pod',`${a.name}-${d.number}-demo`,'Succeeded']])state.resources.push({id:uuid(),clusterId:clusterFor(d.env),namespace:ns(d.env),kind,name,status,rv:6000+state.serial++,appId:d.appId,replicas:1,image:art.imageRef,backoffLimit:d.backoffLimit,jobDeadline:d.jobDeadline});
    }else if(!existing.length){for(const [kind,status] of [['Deployment','Available'],['Pod','Running']])state.resources.push({id:uuid(),clusterId:clusterFor(d.env),namespace:ns(d.env),kind,name:kind==='Pod'?a.name+'-demo':a.name,status,rv:6000+state.serial++,appId:d.appId,replicas:d.replicas,image:art.imageRef});
    }else existing.forEach(r=>{r.image=art.imageRef;r.replicas=d.replicas;r.rv++;r.manifest=null;});}
  function markChange(r,action){r.rv++;if(r.appId)state.apps.find(a=>a.id===r.appId).drift=true;logAudit(action,r.name);}
  function resourceById(id){return state.resources.find(r=>r.id===(id||state.resourceId));}
  function handleAction(action,e){
    const d=e.dataset;
    if(action==='go')return go(d.path);
    if(action==='create-menu'){state.menu=!state.menu;return render();}
    if(action==='create-app'||action==='create-image-app'){state.menu=false;state.createMode='scratch';state.newMode=action==='create-image-app'?'image':'git';return openSheet('create');}
    if(action==='create-mode'){state.createMode=d.mode;return createSheet();}
    if(action==='close-sheet')return closeSheet();
    if(action==='close-modal'){$('#modal').close();state.preview=null;return;}
    if(action==='filter-apps'){state.filter=!state.filter;return render();}
    if(action==='clear-filters'){state.projectFilter='all';state.query='';return render();}
    if(action==='export-apps'){const csv='name,project,configured\n'+state.apps.map(a=>[a.name,a.project,a.configured].join(',')).join('\n');return download('podry-apps.csv',csv);}
    if(action==='env-filter')return modal('Environments',boundEnvs().length?boundEnvs().map(env=>`<label class="radio"><input type="checkbox" checked disabled>${env}</label>`).join(''):empty('No environments','先在 Workflow Editor 创建部署流水线。'));
    if(action==='overview-tab'){state.overviewTab=d.tab;return render();}
    if(action==='edit-git')return openSheet('git');
    if(action==='edit-ci'||action==='edit-cd'){state.pipelineCreate=false;if(d.env)state.env=d.env;return openSheet(action==='edit-ci'?'ci':'cd');}
    if(action==='setup-next'){if(!app().saved.git||state.dirty)return;return go(appPath('edit','/docker-build-config'));}
    if(action==='sample-repository'){const e=$('#git-form [name=repo]');e.value='https://github.com/docker-library/hello-world';$('#git-form [name=branch]').value='master';state.dirty=true;return;}
    if(action==='new-workflow')return workflowTemplates();
    if(action==='workflow-template'){state.workflowTemplate=d.template;$('#modal').close();return openSheet('workflow');}
    if(action==='add-cd'){if(app().cdEnvs.length===envs.length)return;state.pipelineCreate=true;return openSheet('cd');}
    if(action==='workflow-success-close')return $('#modal').close();
    if(action==='workflow-success-build'){$('#modal').close();return go(appPath('trigger'));}
    if(action==='workflow-success-override'){$('#modal').close();return go(appPath('edit',`/env-override/${state.env}`));}
    if(action==='stage-tab'){state.stage=d.stage;return pipelineSheet(state.sheet==='cd');}
    if(action==='select-material'){if(!buildReady(app()))return toast('Configure a CI pipeline first.');state.commitSearch='';state.materialState=state.scenario==='offline'?'error':state.scenario==='empty'?'empty':'ready';state.commit=state.materialState==='ready'?commits[0][0]:null;return openSheet('material');}
    if(action==='retry-material'){state.materialState='ready';state.commit=commits[0][0];state.commitSearch='';return materialSheet();}
    if(action==='choose-commit'){state.commit=d.commit;return materialSheet();}
    if(action==='start-build')return beginBuild();
    if(action==='retry-build')return beginBuild(state.builds.find(b=>b.id===d.id));
    if(action==='cancel-build'){const b=state.builds.find(b=>b.id===d.id);if(!allowed()||!b||!['queued','running'].includes(b.status))return;b.status='canceling';logAudit('build.cancel',b.id);render();return later(()=>{b.status='canceled';render();},400);}
    if(action==='select-image'){state.env=d.env||state.env;if(!boundEnvs().includes(state.env))return toast('先创建目标环境的部署流水线。');state.selectedArtifact=null;state.imageSearch='';return openSheet('image');}
    if(action==='choose-image'){state.selectedArtifact=d.id;return imageSheet();}
    if(action==='review-deploy')return deploymentPreview();
    if(action==='confirm-deploy')return confirmDeploy();
    if(action==='rollback'||action==='promote')return deploymentPreview(action,state.deployments.find(x=>x.id===d.id));
    if(action==='import-image'){if(!allowed())return;state.artifacts.unshift({id:uuid(),appId:state.appId,digest:sha('c'),commit:'external-demo',imageRef:`${app().imageRepository}@${sha('c')}`});state.selectedArtifact=state.artifacts[0].id;logAudit('artifact.import',app().name);return imageSheet();}
    if(action==='deployment-env'){state.env=d.env;state.historyId=null;return go(appPath('cd-details'));}
    if(action==='history-select')return go(appPath(state.page,`/${d.id}/${state.page==='ci-details'?'logs':'source'}`));
    if(action==='history-tab')return go(appPath(state.page,`/${d.id}/${d.tab}`));
    if(action==='reconcile'){const x=(d.cd==='true'?state.deployments:state.builds).find(x=>x.id===d.id);if(!allowed()||x?.status!=='unknown')return;if(d.cd==='true'){x.status='succeeded';syncResources(x);}else finishBuild(x);logAudit('execution.reconcile',x.id);return render();}
    if(action==='base-tab'){state.baseTab=d.tab;return render();}
    if(action==='config-mode'){state.configMode=d.mode;return render();}
    if(action==='enable-override'){if(!allowed())return;app().overrides[state.env].enabled=true;return render();}
    if(action==='compare-config')return modal('Compare configurations',`<h3>Base → ${state.env}</h3><div class="gap"></div><pre class="diff">replicaCount: ${app().replicas} → ${app().overrides[state.env].replicas}\nhost: ${esc(app().overrides[state.env].host)}</pre>`);
    if(action==='dry-run')return modal('Dry run · local preview','<p>真实实现会渲染 Chart 并返回服务端校验。此原型仅展示本地 values，不向集群发出请求。</p><div class="gap"></div><pre class="diff">'+esc(valuesYaml(app()))+'</pre>');
    if(action==='save-values'||action==='save-values-next')return saveValues(action==='save-values-next');
    if(action==='configmap-form')return modal('ConfigMap configuration','<p>配置应从应用草稿生成；此处展示已有样例。实时资源修改请进入 Resource Browser。</p>');
    if(action==='delete-app')return modal('Delete Application','<p>该原型保留入口，不执行应用删除。应用删除与卸载资源的产品策略见接口文档。</p>');
    if(action==='tree-group'){state.groups=state.groups.includes(d.group)?state.groups.filter(x=>x!==d.group):[...state.groups,d.group];return render();}
    if(action==='kind'){state.kind=d.kind;state.query='';if(state.section==='apps')return go(appPath('details',`/${state.env}/k8s-resources/${state.kind.toLowerCase()}`));state.resourceId=null;return go(resourceListPath());}
    if(action==='open-resource'){const r=resourceById(d.id);if(!r)return;return go(state.section==='apps'?appResourcePath(r,d.tab||'manifest'):resourcePath(r,d.tab||'manifest'));}
    if(action==='close-app-resource-tab'){state.appResourceTabs=(state.appResourceTabs||[]).filter(id=>id!==d.id);if(state.resourceId===d.id)return go(appPath('details',`/${state.env}/k8s-resources/${state.kind.toLowerCase()}`));return render();}
    if(action==='close-resource-tab'){state.resourceTabs=state.resourceTabs.filter(id=>id!==d.id);if(state.resourceId===d.id)return go(resourceListPath());return render();}
    if(action==='all-resources'){if(state.clusterId!==clusterFor(state.env))state.resourceTabs=[];state.clusterId=clusterFor(state.env);state.namespace=ns(state.env);return go(resourceListPath());}
    if(action==='refresh')return toast('模拟数据已刷新；未连接远程集群。');
    if(action==='reconnect'){state.scenario='normal';return render();}
    if(action==='edit-manifest'){if(!allowed())return;state.editing=!state.editing;state.yamlDraft='';return render();}
    if(action==='review-manifest')return reviewManifest();
    if(action==='confirm-manifest'){if(!allowed()||!state.preview)return;const r=resourceById();if(r.rv!==state.preview.rv)return toast('resourceVersion 已变化，请重新读取。');if(state.preview.replicas!==undefined)r.replicas=state.preview.replicas;if(state.preview.image)r.image=state.preview.image;if(state.preview.value)r.value=state.preview.value;markChange(r,'resource.patch');state.editing=false;state.yamlDraft='';state.preview=null;$('#modal').close();return render();}
    if(action==='pause-logs'){state.logsPaused=!state.logsPaused;return render();}
    if(action==='download-logs')return download('podry-demo.log',mockLogs(resourceById()));
    if(action==='resource-menu'){state.resourceId=d.id;return modal('Deployment actions',B('Scale','scale-resource',wd())+' '+B('Restart','restart-resource',wd())+' '+B('Delete','delete-resource',wd(),'danger'));}
    if(action==='scale-resource'){const r=resourceById();return modal('Scale '+esc(r.name),`<form id="scale-form">${input('Replicas','replicas',r.replicas,'number','min="0" max="100"')}</form>`,'<button form="scale-form" class="primary" '+wd()+'>Scale</button>');}
    if(action==='restart-resource'||action==='delete-resource'){const r=resourceById();if(!r)return;state.pendingAction=action;return modal(action==='delete-resource'?'Delete Resource':'Restart Deployment',`<p>${esc(r.kind+'/'+r.name)}</p><div class="gap"></div>${input('Type resource name to confirm','confirmName','')}<p class="muted">仅改变本地样例${action==='restart-resource'?'；不修改镜像或配置版本':''}。</p>`,B('Confirm','confirm-resource-action',wd(),'danger'));}
    if(action==='confirm-resource-action'){const r=resourceById();if(!allowed()||$('#f-confirmName')?.value!==r.name)return toast('请输入完整资源名称。');if(state.pendingAction==='delete-resource'){state.resources=state.resources.filter(x=>x.id!==r.id);state.resourceTabs=state.resourceTabs.filter(x=>x!==r.id);state.appResourceTabs=(state.appResourceTabs||[]).filter(x=>x!==r.id);logAudit('resource.delete',r.name);$('#modal').close();return go(state.section==='apps'?appPath('details',`/${state.env}/k8s-resources/${state.kind.toLowerCase()}`):resourceListPath());}markChange(r,'resource.restart');$('#modal').close();return render();}
    if(action==='create-resource')return openSheet('create-resource');
    if(action==='preview-create-resource')return previewCreate();
    if(action==='confirm-create-resource'){if(!allowed()||!state.preview)return;const r=state.preview;if(state.resources.some(x=>x.clusterId===r.clusterId&&x.namespace===r.namespace&&x.name===r.name&&x.kind===r.kind))return toast('同名 ConfigMap 已存在。');state.resources.push({...r,id:uuid(),rv:6000+state.serial++,status:'Active'});logAudit('resource.create',r.name);state.preview=null;$('#modal').close();$('#drawer').close();state.sheet=null;state.namespace=r.namespace;state.kind='ConfigMap';return go(resourceListPath());}
    if(action==='reset'){timers.forEach(clearTimeout);timers=[];$('#drawer').close();$('#modal').close();state=initial();return go(`${APP}/list`);}
  }
  function saveValues(next=false){
    if(!allowed())return;const a=app(),override=state.config==='env-override',o=a.overrides[state.env];
    if(override&&!o.enabled)return;
    if(a.repo.includes('docker-library/hello-world')&&a.chartType==='Deployment'&&!a.saved.base)return toast('此示例运行后退出，请先选择 Job 模板。');
    if(a.chartType==='Job'){
      const v=state.configMode==='gui'?new FormData($('#values-form')):null,text=v?'':$('[data-control=config-yaml]').value;
      const backoffLimit=Number(v?v.get('backoffLimit'):text.match(/^  backoffLimit:\s*(\d+)\s*$/m)?.[1]),jobDeadline=Number(v?v.get('jobDeadline'):text.match(/^  activeDeadlineSeconds:\s*(\d+)\s*$/m)?.[1]);
      if(!Number.isInteger(backoffLimit)||backoffLimit<0||backoffLimit>10||!Number.isInteger(jobDeadline)||jobDeadline<30||jobDeadline>86400)return toast('Job 示例仅接受 backoffLimit 0–10、activeDeadlineSeconds 30–86400。');
      if(v&&!$('#values-form').reportValidity())return;
      if(!v&&(!/^  completions: 1$/m.test(text)||!/^  parallelism: 1$/m.test(text)||!/^  restartPolicy: Never$/m.test(text)))return toast('Job 原型固定 completions=1、parallelism=1、restartPolicy=Never。');
      Object.assign(override?o:a,{backoffLimit,jobDeadline});if(override)o.version++;
    }else{
    let replicas,port,host;
    if(state.configMode==='gui'){const f=$('#values-form');if(!f.reportValidity())return;const v=new FormData(f);replicas=Number(v.get('replicas'));port=Number(v.get('port'));host=v.get('host');}
    else{const text=$('[data-control=config-yaml]').value;replicas=Number(text.match(/^replicaCount:\s*(\d+)\s*$/m)?.[1]);port=Number(text.match(/^  port:\s*(\d+)\s*$/m)?.[1]);host=text.match(/^  host:\s*([^\s]+)\s*$/m)?.[1];}
    if(!Number.isInteger(replicas)||replicas<0||replicas>100||!port||port>65535||!host)return toast('原型仅接受合法 replicaCount / port / host；不支持通用 YAML 解析。');
    if(override){o.replicas=replicas;o.host=host;o.version++;}else{a.replicas=replicas;a.port=port;}
    }
    if(!override)a.saved.base=true;refreshSetup(a);a.version++;state.dirty=false;logAudit('config.save',a.name);if(next)go(appPath('edit','/workflow'));else render();toast('Configuration saved locally · v'+a.version);
  }
  function bindEnvironment(f,creating){
    const a=app(),env=String(f.get('env')||''),releaseName=String(f.get('releaseName')||'').trim(),trigger=f.get('trigger')||'MANUAL';
    if(!envs.includes(env)||(creating&&a.cdEnvs.includes(env)))return toast('请选择一个尚未绑定的环境。'),false;
    if(!/^[a-z][a-z0-9-]{1,51}[a-z0-9]$/.test(releaseName))return toast('Helm releaseName 需为 3–53 位小写字母、数字或连字符。'),false;
    if(env!=='development'&&trigger==='AUTO')return toast('测试与生产环境仅支持手动发布。'),false;
    if(state.apps.some(other=>other.id!==a.id&&other.cdEnvs.includes(env)&&(other.overrides[env].releaseName||other.name)===releaseName))return toast('此集群 / Namespace / releaseName 已被其他应用绑定。'),false;
    if(creating)a.cdEnvs.push(env);Object.assign(a.overrides[env],{releaseName,trigger});state.env=env;return true;
  }
  function workflowCreated(){modal('Deployment pipeline created',`<p>What do you want to do next?</p><div class="workflow-templates">${B('<strong>Deploy this app on '+esc(state.env)+'</strong><span>Go to Build & Deploy →</span>','workflow-success-build','','workflow-template')}${B('<strong>Override deployment configurations</strong><span>Go to environment override →</span>','workflow-success-override','','workflow-template')}</div>`,B('Close','workflow-success-close'));$('#modal .modal-footer [data-action=close-modal]')?.remove();}
  function reviewManifest(){
    if(!allowed()||!state.editing)return;const r=resourceById(),text=$('[data-control=resource-yaml]').value;state.yamlDraft=text;
    // Keep edits deliberately narrow, and validate the resource identity.
    if(!text.includes('name: '+r.name)||!text.includes('kind: '+r.kind))return toast('不能修改资源身份。');
    const p={rv:r.rv};
    if(r.kind==='Deployment'){p.replicas=Number(text.match(/^\s+replicas:\s*(\d+)\s*$/m)?.[1]);p.image=text.match(/^\s+image:\s*(\S+)\s*$/m)?.[1];if(!Number.isInteger(p.replicas)||p.replicas<0||p.replicas>100||!p.image)return toast('请检查 replicas 与 image。');}
    else if(r.kind==='ConfigMap'){p.value=text.match(/^\s+LOG_LEVEL:\s*(\w+)\s*$/m)?.[1];if(!p.value)return toast('仅支持 LOG_LEVEL。');}
    else return;
    state.preview=p;modal('Review live manifest changes',`<div class="notice warning">临时修改不会自动变成应用配置；后续发布可能覆盖。</div><div class="gap"></div><pre class="diff">${esc(r.kind==='Deployment'?`replicas: ${r.replicas} → ${p.replicas}\nimage: ${p.image}`:`LOG_LEVEL: ${r.value} → ${p.value}`)}</pre>`,B('Apply changes','confirm-manifest',wd(),'primary'));
  }
  function previewCreate(){
    if(!allowed())return;const t=$('[data-control=create-resource-yaml]').value;
    if(!/^kind:\s*ConfigMap\s*$/m.test(t)||t.includes('\n---'))return toast('此原型仅支持一个 ConfigMap。');
    const name=t.match(/^  name:\s*([a-z0-9-]+)\s*$/m)?.[1],namespace=t.match(/^  namespace:\s*([a-z0-9-]+)\s*$/m)?.[1],value=t.match(/^  LOG_LEVEL:\s*(\w+)\s*$/m)?.[1];if(!name||!namespace||!value)return toast('请提供合法 name / namespace / LOG_LEVEL。');
    state.preview={clusterId:state.clusterId,kind:'ConfigMap',name,namespace,value};modal('Review resource creation',`<pre class="diff">${esc(t)}</pre><div class="gap"></div><p>Target: ${clusterName(state.clusterId)}</p>`,B('Create in demo','confirm-create-resource',wd(),'primary'));
  }
  function download(name,text){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  document.addEventListener('click',e=>{const target=e.target.closest('[data-action]');if(target&&!target.disabled){e.preventDefault();handleAction(target.dataset.action,target);}});
  document.addEventListener('input',e=>{
    const c=e.target.dataset.control;
    if(['app-search','resource-search','cluster-search'].includes(c)){state.query=e.target.value;render();}
    if(c==='kind-search'){state.jump=e.target.value;render();}
    if(c==='commit-search'||c==='image-search'){const pos=e.target.selectionStart;state[c==='commit-search'?'commitSearch':'imageSearch']=e.target.value;c==='commit-search'?materialSheet():imageSheet();const next=$(`[data-control=${c}]`);next.focus();next.setSelectionRange(pos,pos);}
    if(c==='resource-yaml')state.yamlDraft=e.target.value;
    if(e.target.closest('#build-config-form,#git-form,#pipeline-form,#workflow-template-form,#values-form')||c==='config-yaml')state.dirty=true;
  });
  document.addEventListener('change',e=>{
    const c=e.target.dataset.control,v=e.target.value;
    if(c==='chart-type'){if(app().saved.base)return;app().chartType=v;state.dirty=true;return render();}
    if(c==='workflow-env'){
      const f=e.target.closest('form');f.querySelector('[name=namespace]').value=v?ns(v):'';f.querySelector('[name=clusterName]').value=v?clusterName(clusterFor(v)):'';
      const auto=f.querySelector('[name=trigger][value=AUTO]'),manual=f.querySelector('[name=trigger][value=MANUAL]');auto.disabled=v!=='development';if(auto.disabled){auto.checked=false;manual.checked=true;}state.dirty=true;return;
    }
    if(c==='log-storage'){state.logStorage=v;return;}
    if(['role','scenario','outcome'].includes(c)){state[c]=v;render();if(state.sheet)syncSheet();}
    if(c==='namespace'){state.namespace=v;go(resourceListPath());}
    if(c==='cluster'){state.clusterId=v;state.namespace='all';state.resourceTabs=[];state.query='';go(`${RB}/${v}/node/k8sEmptyGroup`);}
    if(c==='app-filter'){state.projectFilter=v;render();}
    if(c==='history-env'){state.env=v;state.historyId=null;go(appPath('cd-details'));}
    if(c==='runtime-env'){go(appPath('details',`/${v}`));}
  });
  document.addEventListener('submit',e=>{
    e.preventDefault();const form=e.target;if(!form.reportValidity()||!allowed())return;const f=new FormData(form);
    if(form.id==='create-app-form'){
      const name=String(f.get('name')).trim();if(!/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(name))return toast('名称需为 3–63 位小写字母、数字或连字符，并以字母或数字结尾。');if(state.apps.some(a=>a.name===name))return toast('Application already exists.');
      const base=state.apps.find(a=>a.id===f.get('cloneId'))||state.apps[0],a=structuredClone(base);a.id=uuid();a.name=name;a.project=f.get('project');a.description=f.get('description');a.mode=state.createMode==='clone'?base.mode:state.newMode||'git';a.configured=false;a.version=1;a.drift=false;a.ci=false;a.cdEnvs=[];a.ciTrigger='MANUAL';a.imageRepository='registry.example.test/'+a.project+'/'+name;a.overrides=Object.fromEntries(envs.map(env=>[env,{replicas:1,host:`${name}.${env}.example.test`,version:1,enabled:false,trigger:'MANUAL'}]));if(state.createMode!=='clone'){a.repo='';a.branch='';a.saved={git:false,build:false,base:false};a.chartType='Deployment';a.dockerfile='Dockerfile';a.context='.';}state.apps.push(a);logAudit('application.create',name);state.sheet=null;$('#drawer').close();go(`${APP}/${a.id}/edit/${a.mode==='image'?'base-config':'materials'}`);
    }else if(form.id==='git-form'){
      const a=app(),url=String(f.get('repo')).trim();try{const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)throw Error();}catch{return toast('请输入 HTTPS 仓库地址，不在 URL 中嵌入用户名或口令。');}
      a.repo=url;a.gitAccount=f.get('gitAccount');a.branch=String(f.get('branch')||a.branch||'main').trim();a.saved.git=true;a.version++;state.dirty=false;refreshSetup(a);logAudit('config.git',a.name);closeSheet();
    }else if(form.id==='build-config-form'){
      const a=app();if(!a.saved.git)return toast('先保存 Git 仓库。');
      for(const key of ['dockerfile','context']){const path=String(f.get(key)).trim();if(path.startsWith('/')||path.includes('\\')||path.split('/').includes('..'))return toast('构建路径必须位于 Git 工作区内。');}
      for(const key of ['registry','imageRepository','dockerfile','context','platform'])a[key]=String(f.get(key)).trim();a.saved.build=true;a.version++;state.dirty=false;refreshSetup(a);logAudit('config.build',a.name);if(e.submitter?.value==='next')go(appPath('edit','/base-config'));else render();toast('Build configuration saved locally.');
    }else if(form.id==='workflow-template-form'){
      const a=app(),kind=state.workflowTemplate;if(configLocked('workflow')||a.ci||a.cdEnvs.length)return toast('请先完成配置；首版仅支持一条 CI。');
      const branch=String(f.get('branch')||'').trim();if(kind!=='image'&&!branch)return toast('Branch Name is required.');
      if(kind!=='ci'&&!bindEnvironment(f,true))return;
      if(kind!=='image'){a.ci=true;a.branch=branch;}a.version++;state.dirty=false;refreshSetup(a);logAudit('workflow.create.'+kind,a.name);closeSheet();if(kind!=='ci')workflowCreated();
    }else if(form.id==='pipeline-form'){
      const a=app(),cd=state.sheet==='cd';if(!cd){for(const key of ['branch','dockerfile','context','imageRepository'])a[key]=f.get(key);a.ciTrigger=f.get('ciTrigger');}else if(!bindEnvironment(f,!!state.pipelineCreate))return;
      const created=cd&&state.pipelineCreate;a.version++;state.dirty=false;refreshSetup(a);logAudit('config.pipeline',a.name);closeSheet();if(created)workflowCreated();
    }
    else if(form.id==='scale-form'){const r=resourceById();r.replicas=Number(f.get('replicas'));markChange(r,'resource.scale');$('#modal').close();render();}
    else if(form.id==='terminal-form'){const cmd=String(f.get('command')).trim();if(cmd==='clear')state.terminalLines=[];else{const output={help:'Demo commands: help, pwd, ls, date, clear. 不执行 shell。',pwd:'/workspace/demo',ls:'app  config  README.md',date:'2026-11-19 · demo clock'}[cmd]||'Unsupported demo command; no command was executed.';state.terminalLines.push('$ '+cmd,output);}render();$('.terminal-input')?.focus();}
  });
  $('#drawer').addEventListener('cancel',e=>{e.preventDefault();closeSheet();});
  $('#modal').addEventListener('close',()=>{state.preview=null;});
  window.addEventListener('hashchange',readRoute);
  window.addEventListener('beforeunload',e=>{if(state.dirty){e.preventDefault();e.returnValue='';}});
  window.podryPrototype={getState:()=>structuredClone(state),render,reset:()=>{timers.forEach(clearTimeout);state=initial();go(`${APP}/list`);}};
  if(!location.hash)location.hash=`${APP}/list`;else readRoute();
})();
