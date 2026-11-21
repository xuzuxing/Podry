// OpenAPI design source. Generates a documentation artifact, never runtime routes.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ref = name => ({ $ref: `#/components/schemas/${name}` });
const str = (extra = {}) => ({ type: 'string', ...extra });
const uuid = () => str({ format: 'uuid' });
const integer = (minimum = 0) => ({ type: 'integer', minimum });
const bool = () => ({ type: 'boolean' });
const date = () => str({ format: 'date-time' });
const array = items => ({ type: 'array', items });
const map = () => ({ type: 'object', additionalProperties: true });
const choice = (values, extra = {}) => str({ enum: values.split(' '), ...extra });
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const list = name => obj({ items: array(ref(name)), total: integer(), page: integer(1), pageSize: integer(1) });
const buildStates = 'queued running canceling succeeded failed canceled unknown';
const deployStates = 'queued submitting observing succeeded failed unknown';
const schemas = {
  Error: obj({ error: obj({ code: str(), message: str() }) }),
  User: obj({ id: uuid(), email: str({ format: 'email' }), name: str(), isSuperAdmin: bool() }),
  LoginInput: obj({ email: str({ format: 'email' }), password: str({ minLength: 1, writeOnly: true }) }),
  LoginResult: obj({ accessToken: str(), expiresAt: date(), user: ref('User') }),
  Team: obj({ id: uuid(), name: str() }),
  Project: obj({ id: uuid(), teamId: uuid(), name: str() }),
  ProjectInput: obj({ teamId: uuid(), name: str({ minLength: 1 }) }),
  Member: obj({ userId: uuid(), role: choice('admin developer operator viewer') }),
  Cluster: obj({ id: uuid(), name: str(), apiServer: str({ format: 'uri' }), credentialId: uuid(), connectionStatus: choice('unknown connected unavailable'), serverVersion: nullable(str()), lastCheckedAt: nullable(date()) }),
  ClusterInput: obj({ name: str({ minLength: 1 }), apiServer: str({ format: 'uri' }), credentialId: uuid() }),
  ClusterPatch: obj({ name: str(), credentialId: uuid() }, []),
  ConnectionTest: obj({ status: choice('connected unavailable'), serverVersion: nullable(str()), message: str(), checkedAt: date() }),
  Environment: obj({ id: uuid(), name: str(), production: bool(), autoDeployAllowed:bool() }),
  EnvironmentInput: obj({ name: str({ minLength: 1 }), production: bool(), autoDeployAllowed:{type:'boolean',default:false,description:'Current P0 requires false for all environments. Automatic deployment remains deferred.'} },['name','production']),
  Credential: obj({ id: uuid(), name: str(), kind: choice('git registry kubeconfig secret'), teamId: nullable(uuid()), version: integer(1) }),
  GitCredentialPayload: obj({ username: str({minLength:1}), token: str({minLength:1,writeOnly:true}) }),
  RegistryCredentialPayload: obj({ username: str({minLength:1}), password: str({minLength:1,writeOnly:true}) }),
  KubeconfigCredentialPayload: {...obj({ apiServer: str({format:'uri',pattern:'^https://'}), certificateAuthorityData: str({minLength:1,contentEncoding:'base64'}), token: str({minLength:1,writeOnly:true}),clientCertificateData:str({minLength:1,contentEncoding:'base64',writeOnly:true}),clientKeyData:str({minLength:1,contentEncoding:'base64',writeOnly:true}),insecureSkipTLSVerify:{type:'boolean',default:false,description:'Explicit per-credential TLS verification bypass for a trusted test endpoint.'} },['apiServer']),allOf:[{oneOf:[{required:['token'],not:{anyOf:[{required:['clientCertificateData']},{required:['clientKeyData']}]}},{required:['clientCertificateData','clientKeyData'],not:{required:['token']}}]},{if:{properties:{insecureSkipTLSVerify:{const:true}},required:['insecureSkipTLSVerify']},then:{},else:{required:['certificateAuthorityData']}}]},
  SecretCredentialPayload: obj({ data: {type:'object',minProperties:1,maxProperties:100,additionalProperties:str({writeOnly:true})} }),
  CredentialInput: {...obj({ name: str(), kind: choice('git registry kubeconfig secret'), teamId: nullable(uuid()), payload: { oneOf:['GitCredentialPayload','RegistryCredentialPayload','KubeconfigCredentialPayload','SecretCredentialPayload'].map(ref), writeOnly:true, description:'Encrypted AES-256-GCM version. Kubernetes accepts a structured HTTPS endpoint with either Token or inline client certificate/key and optional explicit insecureSkipTLSVerify. No raw YAML, exec, auth-provider or file references. kubeconfig requires teamId=null.' } }),allOf:['git','registry','kubeconfig','secret'].map((kind,i)=>({if:{properties:{kind:{const:kind}}},then:{properties:{payload:ref(['GitCredentialPayload','RegistryCredentialPayload','KubeconfigCredentialPayload','SecretCredentialPayload'][i])}}}))},
  CredentialUpdate: obj({ expectedVersion: integer(1), payload: { oneOf:['GitCredentialPayload','RegistryCredentialPayload','KubeconfigCredentialPayload','SecretCredentialPayload'].map(ref),writeOnly:true,description:'Must match stored credential kind. Retains previous versions. kubeconfig rotation keeps apiServer unchanged.' } }),
  Registry: obj({ id: uuid(), name: str(), endpoint: str({ format: 'uri' }), credentialId: nullable(uuid()) }),
  RegistryInput: obj({ name: str(), endpoint: str({ format: 'uri',pattern:'^https?://',description:'HTTPS by default. HTTP requires an exact host:port entry in PODRY_HTTP_ALLOWED_HOSTS. Anonymous registries use credentialId=null.' }), credentialId: nullable(uuid()) }),
  ResourceGrant: obj({ id: uuid(), principalType: choice('user team project'), principalId: uuid(), clusterId: uuid(), namespace: str(), resources: array(str()), actions: array(str()) }),
  ResourceGrantInput: obj({ principalType: choice('user team project'), principalId: uuid(), namespace: str({description:'Exact Namespace, * for all namespaced targets, or empty string for cluster scope. * never grants cluster scope.'}), resources: { ...array(str({pattern:'^(\\*|[a-z0-9.-]+/[a-z0-9-]+)$',description:'Discovery group/plural; core resources use core/plural. CRDs accepted, subresources rejected.'})), minItems: 1,maxItems:128 }, actions: { ...array(choice('resource.view resource.write resource.delete pod.logs pod.exec secret.reveal node.manage')), minItems: 1 } }),
  Application: obj({ id: uuid(), projectId: uuid(), name: str(), description: str(), sourceMode: choice('git image'), health: choice('unknown progressing healthy completed degraded stopped', {description:'Derived from binding observations refreshed by application resource reads. Expires after 60 seconds; a new execution/revision, binding edit or cluster credential rotation invalidates the observation. Release success alone does not imply healthy. Archived applications report stopped.'}), archivedAt: nullable(date()), updatedAt: date() }),
  ApplicationInput: obj({ projectId: uuid(), name: str({ pattern: '^[a-z][a-z0-9-]{1,61}[a-z0-9]$' }), description: str(), sourceMode: choice('git image'),cloneFromAppId:uuid() }, ['projectId', 'name', 'sourceMode']),
  ApplicationPatch: obj({ description: str(), archived: bool() }, []),
  GitConfig: obj({ repositoryUrl: str({ format: 'uri', pattern: '^https?://',description:'HTTPS by default. HTTP requires an exact host:port entry in PODRY_HTTP_ALLOWED_HOSTS. Embedded credentials and redirects are rejected.' }), branch: str(), credentialId: nullable(uuid()), accountMode: choice('public credential') }),
  GitBranch: obj({ name: str(), headSha: str({ pattern: '^[0-9a-f]{40}([0-9a-f]{24})?$' }), isDefault: bool() }),
  GitCommit: obj({ sha: str({ pattern: '^[0-9a-f]{40}([0-9a-f]{24})?$' }), subject: str(), authorName: str(), committedAt: date() }),
  GitBranchList: obj({ items: array(ref('GitBranch')), nextCursor: nullable(str()), configVersion: integer(1), observedAt: date() }),
  GitCommitList: obj({ items: array(ref('GitCommit')), nextCursor: nullable(str()), configVersion: integer(1), resolvedRef: str({description:'本次查询分支 tip 的完整 SHA；空仓库为空字符串。'}), observedAt: date() }),
  BuildConfig: obj({ dockerfile: str(), context: str(), registryId: uuid(), imageRepository: str(), platform: choice('linux/amd64 linux/arm64'), timeoutSeconds: { type: 'integer', minimum: 60, maximum: 14400 }, buildArgs: { type: 'object', additionalProperties: str() }, checkScript: str() }, ['dockerfile', 'context', 'registryId', 'imageRepository', 'platform', 'timeoutSeconds', 'buildArgs']),
  ChartConfig: obj({ workloadKind: choice('Deployment Job'), chartVersion: str({ minLength: 1,description:'Built-in chart 1.0.0 supports offline Helm SDK rendering. Live Helm release execution is not enabled yet.' }) }),
  SecretRef: obj({ credentialId: uuid(), version: integer(1), targetKey: str() }),
  DeployValues: {
    type: 'object', additionalProperties: true,
    properties: { replicaCount: integer(), containerPort: { type: 'integer', minimum: 1, maximum: 65535 }, resources: map(), service: map(), ingress: map(), env: map(), volumes: array(map()), job: obj({completions:{const:1},parallelism:{const:1},restartPolicy:{const:'Never'},backoffLimit:{type:'integer',minimum:0,maximum:10},activeDeadlineSeconds:{type:'integer',minimum:30,maximum:86400}}) },
    description: 'Current subset: replicaCount, containerPort, resources.requests/limits.cpu/memory, non-sensitive literal env, service.enabled/port/type=ClusterIP, ingress.enabled/host, and Job single-run fields. volumes and all unknown/reserved image/ownership fields are rejected. Sensitive values use versioned secretRefs; targetKey is the environment key and must not duplicate literal env. Job rejects Deployment/service/ingress fields.'
  },
  AppConfig: obj({ appId: uuid(), version: integer(), gitConfig: nullable(ref('GitConfig')), buildConfig: nullable(ref('BuildConfig')), chartConfig: nullable(ref('ChartConfig')), deployValues: ref('DeployValues'), secretRefs: array(ref('SecretRef')) }),
  ConfigInput: {...obj({ expectedVersion: integer(), section:choice('git build base'), gitConfig:ref('GitConfig'), buildConfig:ref('BuildConfig'), chartConfig:ref('ChartConfig'), deployValues:ref('DeployValues'), secretRefs:array(ref('SecretRef')) },['expectedVersion','section']),allOf:[{if:{properties:{section:{const:'git'}}},then:{required:['gitConfig']}},{if:{properties:{section:{const:'build'}}},then:{required:['buildConfig']}},{if:{properties:{section:{const:'base'}}},then:{required:['chartConfig','deployValues','secretRefs']}}],description:'Save exactly one section, merge other sections from the expected snapshot, then append one config version. Reject fields belonging to another section. First save expects version 0.'},
  SetupBlocker:obj({code:str(),message:str(),targetSection:choice('git build base workflow')}),
  SetupStep:obj({key:choice('git build base workflow'),status:choice('complete pending blocked not_required'),blockers:array(ref('SetupBlocker'))}),
  ApplicationSetup:obj({appId:uuid(),configVersion:integer(),workflowVersion:integer(),completed:integer(),total:integer(1),steps:array(ref('SetupStep')),canBuild:bool(),deployableBindingIds:{...array(uuid()),description:'Local candidates require an enabled release executor/CD, a verified build artifact, valid render inputs, deploy role, target write grants including Helm Secret storage, and usable exact credential/Secret versions. No network probe or release task is performed. Preview and confirmation revalidate the selected inputs and target occupancy.'},nextSection:nullable(choice('git build base workflow'))}),
  Target: obj({ clusterId: uuid(), namespace: str({ minLength: 1,maxLength:63 }), releaseName: str({ minLength: 3,maxLength:53,pattern:'^[a-z][a-z0-9-]{1,51}[a-z0-9]$' }) }),
  Binding: obj({ id: uuid(), appId: uuid(), environmentId: uuid(), target: ref('Target'), overrideValues: ref('DeployValues'), version: integer(1), autoDeploy: bool(), currentDeploymentId: nullable(uuid()) }),
  BindingInput: obj({ environmentId: uuid(), target: ref('Target'), overrideValues: ref('DeployValues'), autoDeploy: bool() }),
  BindingUpdate: obj({ expectedVersion: integer(1), overrideValues: ref('DeployValues'), autoDeploy: bool() }),
  CIDefinition: obj({ manual: bool(), push: bool(), branch: str(), webhookCredentialId: nullable(uuid()) }),
  CDDefinition: obj({ triggerMode: choice('manual on_ci_success'), upstreamPipelineId: nullable(uuid()), deployTimeoutSeconds: { type: 'integer', minimum: 60, maximum: 7200 } }),
  Pipeline: obj({ id: uuid(), appId: uuid(), kind: choice('ci cd'), bindingId: nullable(uuid()), enabled: bool(), version: integer(1), definition: { oneOf: [ref('CIDefinition'), ref('CDDefinition')], description: 'Must match kind. Production bindings require manual in V1.' } }),
  Workflow: obj({ version: integer(), items: array(ref('Pipeline')) }),
  WorkflowInput: obj({ expectedVersion: integer(), items: array(obj({ id: nullable(uuid()), kind: choice('ci cd'), bindingId: nullable(uuid()), enabled: bool(), definition: { oneOf: [ref('CIDefinition'), ref('CDDefinition')] } })) }),
  WorkflowTemplateInput:{...obj({template:choice('build_deploy build_only external_image add_deploy'),expectedConfigVersion:integer(1),expectedWorkflowVersion:integer(),ci:ref('CIDefinition'),deployment:obj({binding:ref('BindingInput'),definition:ref('CDDefinition')})},['template','expectedConfigVersion','expectedWorkflowVersion']),allOf:[{if:{properties:{template:{const:'build_deploy'}}},then:{required:['ci','deployment']}},{if:{properties:{template:{const:'build_only'}}},then:{required:['ci'],not:{required:['deployment']}}},{if:{properties:{template:{enum:['external_image','add_deploy']}}},then:{required:['deployment'],not:{required:['ci']}}}],description:'Atomic template transaction. Null CD upstream in build_deploy is resolved to the newly created CI ID. add_deploy references the existing CI. No builds/deployments are started by saving a template.'},
  WorkflowTemplateResult:obj({workflow:ref('Workflow'),bindings:array(ref('Binding')),setup:ref('ApplicationSetup')}),
  BuildInput: obj({ commitSha: str({ pattern: '^[0-9a-f]{40}$',description:'Full lowercase SHA-1 reachable from the configured CI branch. SHA-256 repositories are not yet supported.' }), expectedConfigVersion: integer(1) }),
  Build: obj({ id: uuid(), appId: uuid(), status: choice(buildStates), commitSha: str(), configVersion: integer(1), attemptNo: integer(1), artifactId: nullable(uuid()), createdAt: date() }),
  BuildAttempt: obj({ id: uuid(), buildId: uuid(), attemptNo: integer(1), status: choice(buildStates), jobName: str(), jobUid: nullable(str()), startedAt: nullable(date()), finishedAt: nullable(date()), errorCode: nullable(str()), logAvailability:choice('runtime archived unavailable expired') }),
  Artifact: obj({ id: uuid(), appId: uuid(), buildId: nullable(uuid()), source: choice('build external'), imageRepository: str(), digest: str({ pattern: '^sha256:[0-9a-f]{64}$' }), imageRef: str(), createdAt: date() }),
  ArtifactInput: obj({ imageRef: str({ description: 'Registry reference to resolve and pin. Mutable tags are resolved server-side.' }), registryId: uuid() }),
  DeploymentPreviewInput: obj({ bindingId: uuid(), artifactId: uuid(), expectedConfigVersion: integer(1) }),
  Diff: obj({ before: str(), after: str() }),
  DeploymentPreview: obj({ previewId: uuid(), expiresAt: date(), imageRef: str(), target: ref('Target'), valuesRedacted: map(), diff: ref('Diff'), warnings: array(str()) }),
  PreviewConfirm: obj({ previewId: uuid() }),
  ReleaseRequest: obj({ requestId: uuid(), status: choice('queued executing succeeded failed unknown'), kind: choice('deploy promote rollback'), bindingId: uuid(), snapshotId: uuid(), deploymentId: nullable(uuid()), createdAt: date() }),
  Deployment: obj({ id: uuid(), requestId: uuid(), appId: uuid(), bindingId: uuid(), artifactId: uuid(), imageRef: str(), configVersion: integer(1), status: choice(deployStates), kind: choice('deploy promote rollback'), sourceDeploymentId: nullable(uuid()), helmRevision: nullable(integer(1)), createdAt: date(), startedAt: nullable(date()), finishedAt: nullable(date()), errorCode: nullable(str()) }),
  PromoteInput: obj({ bindingId: uuid(), expectedConfigVersion: integer(1) }),
  RollbackInput: obj({ reason: str({ minLength: 1 }) }),
  ResourceRef: obj({ group: str(), version: str(), resource: str(), namespace: str(), name: str(), uid: str(), resourceVersion: str() }, ['group', 'version', 'resource', 'name']),
  ResourceType: obj({ group: str(), version: str(), resource: str(), kind: str(), namespaced: bool(), verbs: array(str()), category: str() }),
  Namespace: obj({ name: str(), uid: str(), phase: str() }),
  ResourceObject: obj({ ref: ref('ResourceRef'), kind: str(), status: str(), manifest: str({description:'Formatted JSON manifest (valid YAML 1.2); Secret values and annotations removed.'}), data: map(), ownerRefs: array(ref('ResourceRef')) }),
  ResourceList: obj({ items: array(ref('ResourceObject')), continueToken: nullable(str()), resourceVersion: str() }),
  ResourceEvent: obj({ type: str(), reason: str(), message: str(), count: integer(), lastSeenAt: nullable(date()) }),
  ManifestDocument: obj({ manifest: str(), expectedUid: str(), expectedResourceVersion: str() }, ['manifest']),
  ResourceDryRunInput: obj({ documents: { ...array(ref('ManifestDocument')), minItems: 1, maxItems: 50 } }),
  ResourcePreviewItem: obj({ index: integer(), ref: nullable(ref('ResourceRef')), action: choice('create update'), diff: ref('Diff'), valid: bool(), error: nullable(ref('Error')) }),
  ResourcePreview: obj({ previewId: uuid(), expiresAt: date(), items: array(ref('ResourcePreviewItem')) }),
  ResourceApplyInput: obj({ previewId: uuid(), stopOnError: bool() }, ['previewId']),
  ResourceActionInput: obj({ action: choice('delete restart scale'), ref: ref('ResourceRef'), replicas: integer(), propagationPolicy: choice('Foreground Background Orphan') }, ['action', 'ref']),
  ResourceOperationItem: obj({ index: integer(), status: choice('succeeded failed skipped'), ref: nullable(ref('ResourceRef')), error: nullable(ref('Error')) }),
  ResourceOperation: obj({ id: uuid(), status: choice('queued running succeeded failed partial unknown'), items: array(ref('ResourceOperationItem')), createdAt: date() }),
  SecretRevealInput: obj({ ref: ref('ResourceRef'), keys: { ...array(str()), minItems: 1 }, reason: str({ minLength: 1 }) }),
  SecretRevealResult: obj({ values: { type: 'object', additionalProperties: str({ description: 'Base64-encoded bytes; do not log.' }) } }),
  ExecInput: obj({ ref: ref('ResourceRef'), container: str(), command: { ...array(str()), minItems: 1 }, tty: bool() }),
  ExecSession: obj({ sessionId: uuid(), expiresAt: date(), webSocketPath: str(), ticket: str({ description: 'Single-use 30-second ticket. Never log.' }) }),
  WebhookResult: obj({ deliveryId: str(), status: choice('ignored accepted'), buildId: nullable(uuid()) }),
  AuditEvent: obj({ id: uuid(), actorId: nullable(uuid()), action: str(), target: map(), result: choice('accepted succeeded failed denied unknown'), createdAt: date() }),
};
for (const name of ['Application', 'Build', 'Artifact', 'Deployment', 'AuditEvent']) schemas[`${name}Page`] = list(name);

const query = (name, schema = str(), required = false, description) => ({ name, in: 'query', required, schema, ...(description ? { description } : {}) });
const pagination = [query('page', { type: 'integer', minimum: 1, default: 1 }), query('pageSize', { type: 'integer', minimum: 1, maximum: 100, default: 20 }), query('keyword')];
const resourceQuery = [query('group', str(), true), query('version', str(), true), query('resource', str(), true), query('namespace'), query('name', str(), true), query('uid'), query('resourceVersion')];
const paths = {};
function operation(method, path, id, summary, responseSchema, options = {}) {
  const parameters = [...path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => ({ name, in: 'path', required: true, schema: name === 'provider' ? choice('github gitlab') : uuid() }));
  parameters.push(...(options.parameters || []));
  if (options.idempotent) parameters.push({ name: 'Idempotency-Key', in: 'header', required: true, schema: str({ minLength: 8, maxLength: 200 }) });
  const code = options.status || (method === 'post' ? '201' : '200');
  const success = { description: code === '202' ? 'Accepted; poll returned task identity.' : code === '204' ? 'No content.' : 'Success.' };
  if (responseSchema) success.content = { 'application/json': { schema: typeof responseSchema === 'string' ? ref(responseSchema) : responseSchema } };
  if (options.stream) success.content = { 'application/x-ndjson': { schema: str(), example: '{"type":"log","message":"sample"}\n{"type":"end"}\n' } };
  const spec = {
    operationId: id, summary, tags: [options.tag || path.split('/')[1]],
    description: options.description || `${summary}。服务端校验目标归属和权限；完整业务规则见 01-api-spec.md。`,
    'x-permission': options.permission || 'authenticated',
    parameters,
    responses: { [code]: success, default: { description: 'Error. Includes validation/auth/permission/conflict/unavailable responses.', content: { 'application/json': { schema: ref('Error') } } } }
  };
  if (options.body) spec.requestBody = { required: true, content: { 'application/json': { schema: typeof options.body === 'string' ? ref(options.body) : options.body } } };
  if (options.public) spec.security = [];
  if (options.noStore) success.headers = { 'Cache-Control': { schema: str(), description: 'Always no-store.' } };
  (paths[path] ||= {})[method] = spec;
}

operation('post','/auth/login','login','登录','LoginResult',{body:'LoginInput',public:true,status:'200',noStore:true});
operation('get','/auth/me','getCurrentUser','读取当前身份','User');
operation('post','/auth/logout','logout','退出并使 Token 版本失效',null,{status:'204'});
operation('get','/teams','listTeams','列出可访问团队',array(ref('Team')));
operation('post','/teams','createTeam','创建团队','Team',{body:obj({name:str()}),permission:'platform.admin'});
operation('get','/projects','listProjects','列出可访问项目',array(ref('Project')),{parameters:[query('teamId',uuid())]});
operation('post','/projects','createProject','创建项目','Project',{body:'ProjectInput',permission:'team.admin'});
for (const scope of ['teams','projects']) {
  const prefix = scope === 'teams' ? 'Team' : 'Project';
  const key = scope === 'teams' ? 'teamId' : 'projectId';
  operation('get',`/${scope}/{${key}}/members`,`list${prefix}Members`,'读取成员',array(ref('Member')),{permission:`${scope === 'teams' ? 'team' : 'project'}.admin`});
  operation('post',`/${scope}/{${key}}/members`,`upsert${prefix}Member`,'关联已有用户或调整角色','Member',{body:'Member',permission:`${scope === 'teams' ? 'team' : 'project'}.admin`});
  operation('delete',`/${scope}/{${key}}/members/{userId}`,`remove${prefix}Member`,'移除成员关联',null,{status:'204',permission:`${scope === 'teams' ? 'team' : 'project'}.admin`});
}
operation('get','/clusters','listClusters','列出授权集群',array(ref('Cluster')));
operation('post','/clusters','createCluster','接入集群','Cluster',{body:'ClusterInput',permission:'platform.admin'});
operation('get','/clusters/{clusterId}','getCluster','读取集群','Cluster');
operation('patch','/clusters/{clusterId}','updateCluster','更新集群凭据引用','Cluster',{body:'ClusterPatch',permission:'platform.admin'});
operation('post','/clusters/{clusterId}/connection-tests','testClusterConnection','测试集群连接','ConnectionTest',{status:'200',permission:'platform.admin',description:'Connection adapter is deferred. Currently returns 503 cluster_client_unavailable after authorization and existence validation. Does not perform network I/O or change lastCheckedAt/status.'});
operation('get','/clusters/{clusterId}/resource-grants','listResourceGrants','读取资源授权',array(ref('ResourceGrant')),{permission:'platform.admin'});
operation('post','/clusters/{clusterId}/resource-grants','createResourceGrant','授予资源权限','ResourceGrant',{body:'ResourceGrantInput',permission:'platform.admin'});
operation('delete','/clusters/{clusterId}/resource-grants/{grantId}','deleteResourceGrant','撤销资源权限',null,{status:'204',permission:'platform.admin'});
for (const [path, name, input, permission] of [['environments','Environment','EnvironmentInput','platform.admin'],['credentials','Credential','CredentialInput','credential.manage'],['registries','Registry','RegistryInput','platform.admin']]) {
  operation('get',`/${path}`,`list${name}s`,`列出${name}`,array(ref(name)),{noStore:path==='credentials'});
  operation('post',`/${path}`,`create${name}`,`创建${name}`,name,{body:input,permission,noStore:path==='credentials'});
}
operation('put','/credentials/{credentialId}','rotateCredential','轮换凭据并保留版本','Credential',{body:'CredentialUpdate',permission:'credential.manage',noStore:true});
operation('get','/apps','listApplications','应用列表','ApplicationPage',{parameters:[...pagination,query('projectId',uuid()),query('environmentId',uuid()),query('health')],permission:'app.view'});
operation('post','/apps','createApplication','创建应用','Application',{body:'ApplicationInput',permission:'app.configure'});
operation('get','/apps/{appId}','getApplication','应用详情','Application',{permission:'app.view'});
operation('patch','/apps/{appId}','updateApplication','更新描述或归档','Application',{body:'ApplicationPatch',permission:'app.configure'});
operation('get','/apps/{appId}/config','getAppConfig','读取配置版本','AppConfig',{parameters:[query('version',integer(1))],permission:'app.view'});
operation('put','/apps/{appId}/config','saveAppConfig','创建配置版本','AppConfig',{body:'ConfigInput',permission:'app.configure'});
operation('get','/apps/{appId}/setup','getApplicationSetup','读取派生的配置进度与执行前置条件','ApplicationSetup',{permission:'app.view'});
operation('post','/apps/{appId}/workflow-templates','createWorkflowFromTemplate','从模板原子创建 CI 和部署绑定','WorkflowTemplateResult',{body:'WorkflowTemplateInput',idempotent:true,permission:'app.configure',description:'Checks source mode, section prerequisites, optimistic versions and all target grants. build_deploy creates one CI, one binding and its CD in one transaction. New workflow creation with an existing CI is rejected with workflow_exists; add_deploy adds a binding/CD using that existing CI. No execution is triggered.'});
operation('get','/apps/{appId}/git/branches','listGitBranches','Select Material 查询仓库分支','GitBranchList',{parameters:[query('keyword'),query('cursor'),query('limit',{type:'integer',minimum:1,maximum:100,default:20})],permission:'build.trigger',noStore:true,description:'按应用当前 Git 配置使用服务端凭据读取 HTTPS smart Git 分支；不接受任意 repositoryUrl。keyword 不区分大小写，按分支名升序。游标有效 5 分钟，绑定用户、配置/凭据版本与筛选；分支快照变化返回 409 git_ref_changed。读取预算超限返回 503 git_query_limit。'});
operation('get','/apps/{appId}/git/commits','listGitCommits','Select Material 查询分支提交','GitCommitList',{parameters:[query('ref',str(),true),query('shaPrefix',str({pattern:'^[0-9a-f]{7,64}$'})),query('cursor'),query('limit',{type:'integer',minimum:1,maximum:100,default:20})],permission:'build.trigger',noStore:true,description:'只读已配置 HTTPS smart Git 仓库。ref 仅接受分支名；shaPrefix 只查该分支可达的完整历史。按提交时间降序、同时间 SHA 升序。resolvedRef 是分支 tip 完整 SHA；空仓库 items=[]、resolvedRef=""。游标绑定分支 tip、用户、配置/凭据版本和筛选；tip 变化返回 409 git_ref_changed，读取期间配置/凭据变化返回 409 revision_conflict。响应不含作者邮箱。当前适配 SHA-1 仓库，SHA-256 仓库尚未支持；不产生 Build。'});
operation('get','/apps/{appId}/environments','listAppBindings','列出环境绑定',array(ref('Binding')),{permission:'app.view'});
operation('post','/apps/{appId}/environments','createAppBinding','创建环境绑定','Binding',{body:'BindingInput',permission:'app.configure'});
operation('put','/apps/{appId}/environments/{bindingId}','updateAppBinding','更新环境覆盖','Binding',{body:'BindingUpdate',permission:'app.configure'});
operation('get','/apps/{appId}/pipelines','getWorkflow','读取工作流','Workflow',{permission:'app.view'});
operation('put','/apps/{appId}/pipelines','saveWorkflow','保存工作流','Workflow',{body:'WorkflowInput',permission:'app.configure'});
operation('get','/apps/{appId}/builds','listBuilds','构建历史','BuildPage',{parameters:pagination,permission:'app.view'});
operation('post','/apps/{appId}/builds','triggerBuild','触发固定提交构建','Build',{body:'BuildInput',status:'202',idempotent:true,permission:'build.trigger'});
operation('get','/builds/{buildId}','getBuild','构建详情','Build',{permission:'app.view'});
operation('get','/builds/{buildId}/attempts','listBuildAttempts','读取独立构建尝试历史',array(ref('BuildAttempt')),{permission:'app.view'});
for (const action of ['cancel','retry']) operation('post',`/builds/{buildId}/${action}`,`${action}Build`,action==='cancel'?'申请取消构建':'创建新的构建尝试','Build',{status:'202',idempotent:true,permission:'build.trigger'});
operation('get','/builds/{buildId}/logs','streamBuildLogs','读取构建日志',null,{stream:true,parameters:[query('attemptNo',integer(1)),query('follow',bool()),query('cursor')],permission:'app.view'});
operation('get','/apps/{appId}/artifacts','listArtifacts','构建和导入产物','ArtifactPage',{parameters:pagination,permission:'app.view'});
operation('post','/apps/{appId}/artifacts','importArtifact','解析并导入已有镜像产物','Artifact',{body:'ArtifactInput',permission:'app.configure'});
operation('post','/apps/{appId}/deployment-previews','previewDeployment','发布配置预览','DeploymentPreview',{body:'DeploymentPreviewInput',permission:'deploy.trigger',description:'Offline built-in Chart rendering from a verified artifact. Freezes config, binding, workflow/CD, chart archive/checksum, credential versions and execution identity. Expires in 10 minutes. Diff compares the last successful platform snapshot, not live Kubernetes resources; warnings make this boundary explicit. Secret targetKey selects the same-named key from the exact credential version and maps it to a container environment variable. No Git, Registry or Kubernetes network access.'});
operation('get','/apps/{appId}/deployments','listDeployments','发布历史','DeploymentPage',{parameters:[...pagination,query('bindingId',uuid())],permission:'app.view'});
operation('post','/apps/{appId}/deployments','createReleaseRequest','确认预览并排队发布','ReleaseRequest',{body:'PreviewConfirm',status:'202',idempotent:true,permission:'deploy.trigger',description:'Rechecks actor, target grants, expiry and frozen versions, then creates an immutable snapshot, ReleaseRequest and reserved Deployment atomically. The durable Helm executor is opt-in via PODRY_RELEASE_ENABLED; disabled by default, returning 503 without consuming the preview or creating tasks. Same-key retries return the original accepted result. Workers serialize physical targets, preserve unknown occupancy, and observe frozen Helm execution identity, revision and resource UIDs without replaying ambiguous submissions. Real CI/CD acceptance is deferred.'});
operation('get','/release-requests/{requestId}','getReleaseRequest','查询发布请求','ReleaseRequest',{permission:'app.view'});
operation('get','/deployments/{deploymentId}','getDeployment','读取部署执行','Deployment',{permission:'app.view'});
operation('get','/deployments/{deploymentId}/diff','getDeploymentDiff','发布快照与当前资源差异','Diff',{permission:'app.view + resource.view',description:'Before is the normalized immutable desired manifest; after is the current cluster read of its recorded root identities. Both sides omit server bookkeeping, status, Secret values and Secret annotations. Requires resource.view for every root type. Missing live objects are omitted from after; unrecorded identities or replacement UIDs return 409. Upstream failures are errors, never an empty live manifest. Does not include descendant objects or promise Secret value comparison.'});
operation('post','/deployments/{deploymentId}/promote','promoteDeployment','同产物晋级目标环境','ReleaseRequest',{body:'PromoteInput',status:'202',idempotent:true,permission:'deploy.trigger'});
operation('post','/deployments/{deploymentId}/rollback','rollbackDeployment','基于历史快照创建回滚请求','ReleaseRequest',{body:'RollbackInput',status:'202',idempotent:true,permission:'deploy.trigger'});
operation('get','/apps/{appId}/resources','listApplicationResources','读取应用资源关系',array(ref('ResourceObject')),{parameters:[query('bindingId',uuid(),true)],permission:'app.view + resource.view',description:'Requires a binding belonging to the application. Reads recorded root UIDs on its current physical target, including known resources from failed/inflight executions. Traverses controller OwnerReferences through Deployment -> ReplicaSet -> Pod and Job -> Pod; labels alone never establish ownership. Intersects each type with current resource grants and filters unreadable objects. Missing objects are omitted; UID replacement returns 409. Secret data and annotations are redacted. Successful reads refresh a 60-second binding health observation; read failures invalidate the observation when its source is unchanged. This is read-through observation, without background polling or cluster writes.'});
operation('get','/clusters/{clusterId}/discovery','discoverResources','读取可访问 API 资源类型',array(ref('ResourceType')),{permission:'resource.view'});
operation('get','/clusters/{clusterId}/namespaces','listNamespaces','列出可访问 Namespace',array(ref('Namespace')),{permission:'resource.view'});
operation('get','/clusters/{clusterId}/resources','listResources','读取 Kubernetes 资源列表','ResourceList',{parameters:[query('group',str(),true),query('version',str(),true),query('resource',str(),true),query('namespace'),query('labelSelector'),query('fieldSelector'),query('limit',{type:'integer',minimum:1,maximum:500,default:100}),query('continueToken')],permission:'resource.view'});
operation('get','/clusters/{clusterId}/resource','getResource','读取 Kubernetes 对象','ResourceObject',{parameters:resourceQuery,permission:'resource.view'});
operation('get','/clusters/{clusterId}/events','listResourceEvents','读取对象事件',array(ref('ResourceEvent')),{parameters:resourceQuery,permission:'resource.view'});
operation('post','/clusters/{clusterId}/resources/dry-run','dryRunResources','校验并预览多文档 YAML','ResourcePreview',{body:'ResourceDryRunInput',permission:'resource.write'});
operation('post','/clusters/{clusterId}/resources/apply','applyResources','按预览执行资源写入','ResourceOperation',{body:'ResourceApplyInput',status:'202',idempotent:true,permission:'resource.write'});
operation('post','/clusters/{clusterId}/resource-actions','actOnResource','提交资源动作','ResourceOperation',{body:'ResourceActionInput',status:'202',idempotent:true,permission:'action-dependent resource permission'});
operation('get','/resource-operations/{operationId}','getResourceOperation','读取逐对象操作结果','ResourceOperation',{permission:'request owner + resource permission'});
operation('post','/clusters/{clusterId}/secrets/reveal','revealSecret','读取指定 Secret key','SecretRevealResult',{body:'SecretRevealInput',permission:'secret.reveal',noStore:true,status:'200'});
operation('get','/clusters/{clusterId}/pod-logs','streamPodLogs','读取 Pod 容器日志',null,{stream:true,parameters:[query('namespace',str(),true),query('name',str(),true),query('uid',str(),true),query('container',str(),true),query('tailLines',{type:'integer',minimum:1,maximum:10000,default:200}),query('sinceSeconds',{type:'integer',minimum:1,maximum:604800}),query('previous',{type:'boolean',default:false}),query('follow',{type:'boolean',default:false})],permission:'pod.logs'});
operation('post','/clusters/{clusterId}/exec-sessions','createExecSession','创建短期 Pod 终端会话','ExecSession',{body:'ExecInput',permission:'pod.exec',noStore:true});
operation('delete','/exec-sessions/{sessionId}','closeExecSession','关闭当前用户的终端会话',null,{status:'204',permission:'session owner'});
operation('post','/webhooks/git/{provider}/{pipelineId}','receiveGitWebhook','接收已验签的 Push Webhook','WebhookResult',{body:map(),status:'202',public:true,permission:'provider signature',parameters:[{name:'X-GitHub-Delivery',in:'header',schema:str()},{name:'X-Hub-Signature-256',in:'header',schema:str()},{name:'X-Gitlab-Event-UUID',in:'header',schema:str()},{name:'X-Gitlab-Token',in:'header',schema:str()}],description:'Requires provider-specific delivery identity and signature/token verification. GitHub HMAC uses the original request bytes; GitLab token is compared in constant time. Never log raw payload secrets.'});
operation('get','/audit-events','listAuditEvents','读取授权范围审计','AuditEventPage',{parameters:[...pagination,query('projectId',uuid()),query('clusterId',uuid()),query('action')],permission:'audit.view'});

// Runtime coverage is explicit; a registered unavailable adapter is not a completed operation.
const implemented = new Set(['login','getCurrentUser','logout','listTeams','createTeam','listProjects','createProject','listTeamMembers','upsertTeamMember','removeTeamMember','listProjectMembers','upsertProjectMember','removeProjectMember','listAuditEvents','listClusters','createCluster','getCluster','updateCluster','listResourceGrants','createResourceGrant','deleteResourceGrant','listEnvironments','createEnvironment','listCredentials','createCredential','rotateCredential','listRegistrys','createRegistry','listApplications','createApplication','getApplication','updateApplication','getAppConfig','saveAppConfig','getApplicationSetup','createWorkflowFromTemplate','listAppBindings','getWorkflow','saveWorkflow','listGitBranches','listGitCommits']);
for(const id of ['testClusterConnection','discoverResources','listNamespaces','listResources','getResource','listResourceEvents','streamPodLogs'])implemented.add(id);
for(const id of ['listBuilds','triggerBuild','getBuild','listBuildAttempts','streamBuildLogs','listArtifacts'])implemented.add(id);
for(const id of ['previewDeployment','listDeployments','getReleaseRequest','getDeployment','createReleaseRequest'])implemented.add(id);
for(const id of ['getDeploymentDiff','listApplicationResources'])implemented.add(id);
for (const methods of Object.values(paths)) for (const operation of Object.values(methods)) operation['x-implementation'] = implemented.has(operation.operationId) ? 'implemented' : 'planned';
const document = {
  openapi: '3.1.0', info: { title: 'Podry V1 API Design', version: '1.8.0', description: '61 operations implemented; 15 remain planned and unregistered. Adds UID-owned application resources and descendants, normalized live diff, 60-second read-through health observations, and local setup deployment candidates. Includes offline Helm previews and opt-in durable Helm execution/reconciliation. Build and release workers remain disabled by default; real CI/CD acceptance is deferred until infrastructure is available. Git and Registry use HTTPS by default; development HTTP requires explicit host:port allowlisting. General Kubernetes writes and background health polling remain deferred. See docs/backend/13-application-observation.md.' },
  servers: [{ url: '/api' }], security: [{ bearerAuth: [] }], paths,
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } }, schemas }
};
const output = fileURLToPath(new URL('../api/openapi.json', import.meta.url));
writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
console.log(`Generated ${Object.values(paths).reduce((n, p) => n + Object.keys(p).length, 0)} operations, ${Object.keys(schemas).length} schemas.`);
