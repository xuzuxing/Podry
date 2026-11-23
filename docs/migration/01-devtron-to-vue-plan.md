# Devtron Dashboard → Podry Web 布局与交互复刻方案

版本：V3.0 / 日期：2026-11-22 / 状态：当前前端开发基线。

## 当前决定

以用户提供的 `D:/workspace/devtron-dashboard` 为布局、菜单层次和交互的准绳，使用 Vue 3 Composition API、TypeScript、TDesign 重写。Podry 现有页面与 Devtron 不一致时，先对齐 Devtron，后续产品调整另行决定。

范围为 Application Management，以及 Infrastructure Management 下的 Kubernetes 资源管理。Chart Store、Security Center、成本平台、AI 等独立模块不因复刻导航而进入本次范围。应用内的配置、工作流、运行资源、构建与发布历史属于主路径；不能以旧版“轻量化”决定为由省略相应布局和操作。

当前 `web/` 是已有 Vue 工程，继续补齐现有实现，不作为空工程处理。保留 Podry 品牌与现有业务标识，不移植 React 组件或 Devtron 后端协议。前端目前使用本地 Mock API；接口对接与真实集群执行必须单独验收，不能从可点击页面推断已接入。

## 组件与数据流

| 区域 | 责任与实现落点 |
| --- | --- |
| 导航壳 | `AppShell.vue` 负责外框、单一页头与插槽；`ManagerNavigation.vue` 管理两个 Manager 的悬停菜单；`GlobalSearch.vue` 管理键盘搜索 |
| 应用列表 | `ApplicationList.vue` 组合筛选和表格；`useApplicationList.ts` 负责 URL、数据加载和 CSV；删除确认与克隆抽屉独立 |
| 工作流 | `WorkflowSection.vue` 维护 CI/CD 关联；`TriggerGraph.vue` 共用编辑/执行画布；`PipelineStageEditor.vue` 通过 props/emits 编辑任务数组 |
| 资源工作区 | 集群/应用维持各自上下文；`resourceTabs` 保存页签；列表、详情共用 `ResourceActionDialog.vue`；动作完成后刷新同一 Mock 数据源 |
| 数据 | 页面 → `src/api/index.ts` → `src/mock/data.ts`；新增前端 Mock 方法不能直接视为已有 HTTP 合同 |

## 验收顺序

1. 对照本地 Devtron 源码和已有实例截图确认布局、入口、打开方式及关闭行为。
2. 使用 TDesign 实现表格、筛选、选择、菜单、抽屉和确认，避免只弹“已提交”但数据不变。
3. 验证 URL 恢复、跨上下文隔离、保存后读回、错误和重试路径。
4. 运行类型检查、生产构建、页面巡检和关键交互脚本，留下截图与结果。
5. 后端接入后重新验证权限、真实 Discovery、YAML 校验、日志流、exec 和资源变更。

最新源代码对照、已补齐内容、验证记录和剩余差异统一见 [布局与交互对账](04-devtron-layout-interaction-parity.md)。[逐项清单](03-devtron-parity-checklist.md) 的“已有”只代表前端/Mock 实现存在，不代表完整 Devtron 等价或真实后端验收。

## 历史方案

下面保留 2026-11-20 的方案用于溯源。其“轻量化”、空工程假设、旧导航、Terminal/资源写入延期及其他前端交互简化决定已被 V3.0 基线覆盖，不再约束当前实现。业务合同和后端执行边界仍需按相应后端文档核验。

<details>
<summary>查看 V2.0 历史方案</summary>

# Devtron Dashboard → Podry Web 轻量化迁移方案

版本：V2.0 / 日期：2026-11-20\
状态：**当前首版实现基线**\
参考项目：`D:\workspace\devtron-dashboard`（Devtron Dashboard 1.22.0）\
目标工程：`web/`（Vite + Vue 3）

逐模块源码事实见 [参考项目清单与逐模块对照](02-devtron-inventory.md)。旧方案的范围收敛已经合并到本文，不再维护第二份当前迁移方案。

## 0. 决策摘要

本迁移采用 **信息架构移植 + Vue 重写**。Devtron React 源码只作为行为和布局参考，不复制 React 组件、内部公共库、全局 CSS 或 Devtron 后端协议。

首版围绕一条交付闭环建设：

```text
项目 → 应用 → 配置源代码 → 构建镜像 → 发布环境 → 查看运行资源
```

首版需要复现的 Devtron 能力是：

- 应用列表、创建、归档和跨项目搜索；
- Git、Build、Base、Workflow、环境绑定配置；
- 选择提交、触发构建、查看日志和镜像产物；
- 固定 digest、目标环境和配置版本后发布；
- 构建历史、发布历史、环境状态和失败原因；
- 集群、Namespace、Workload、Pod、Manifest、Events、Logs 查看；
- 基础权限、操作审计和明确的空态/错误态。

Deployment Metrics、Chart Store、Security Center、Application Groups、Bulk Edit、GitOps/Argo/Flux、任意 DAG、Terminal 和复杂 Kubernetes 写操作不进入首版关键路径。

旧版本方案中约 206 人日的 F0–F6 全量路线继续保留为长期能力清单；本文不再把它作为首版承诺。

## 1. 迁移边界

### 1.1 参考项目的可迁移部分

| Devtron 事实 | Podry 处理 |
| --- | --- |
| React 19 + React Router + `fe-common-lib` | Vue 3 `<script setup lang="ts">` + Vue Router + 本地组件实现 |
| Application Management 信息架构 | 保留应用列表、应用头部、横向页签和配置子导航 |
| Build & Deploy 工作台 | 保留 Source → CI → Artifact → CD 的主流程 |
| 左列表右详情历史页面 | 保留构建历史和发布历史布局 |
| Resource Browser | 保留集群、资源分类、详情页签和应用内资源上下文 |
| 共享表格、筛选、抽屉、空态、错误态 | 用 TDesign 和 Podry 自有组件实现 |
| Devtron API 包封、Cookie 鉴权、SSE/SockJS | 不复制，以 Podry OpenAPI 和日志/终端合同为准 |

### 1.2 业务合同优先级

业务规则、状态机、权限动作、版本语义和敏感信息边界依次以这些文档为准：

1. [产品说明](../product/01-product-spec.md)；
2. [流程与状态](../product/02-workflows-and-states.md)；
3. [接口约定](../api/01-api-spec.md)；
4. [数据模型](../data/01-data-model.md)。

Devtron 只决定页面结构、交互位置和用户理解方式。

### 1.3 当前工程假设

本文按 `web/` 是一个 Vite + Vue 3 空项目编写。实现时以当前 checkout 为准，不假设历史原型目录、独立入口、Mock Store 或旧布局仍然存在。若复用现有原型，只能按本文的路由、状态和 API 边界接管。

## 2. 首版范围

### P0：交付闭环

| 模块 | 必须完成 |
| --- | --- |
| 项目与应用 | 项目列表、项目内应用列表、跨项目应用搜索、创建、归档 |
| 应用配置 | Git 源、构建配置、基础部署配置、环境绑定、工作流 |
| 构建 | 选择分支或固定 commit、触发构建、阶段状态、日志、镜像 digest |
| 发布 | 选择 digest、目标环境、目标配置、发布确认、发布状态 |
| 历史 | 构建历史、发布历史、日志、产物、配置快照、目标信息 |
| 运行查看 | 集群、Namespace、Deployment/Job/Pod、Manifest、Events、Pod Logs |
| 权限与审计 | `app.view`、`app.configure`、`build.trigger`、`deploy.trigger`、`resource.view`、关键操作记录 |

### P1：日常可用性

- 多环境发布和环境覆盖；
- 构建取消、失败重试、发布未知结果核对；
- 基于成功快照的晋级和回滚；
- ConfigMap 创建与受控更新；
- Manifest Review/Diff/Apply；
- 资源重启、扩缩容和删除确认；
- 集群连接测试、凭据引用和 Registry 配置。

### P2：后续能力

- Deployment Metrics、DORA、成本和趋势报表；
- Chart Store、应用模板、插件和策略市场；
- Security Center、漏洞扫描和高级安全策略；
- Application Groups、Bulk Edit、GitOps/Argo/Flux；
- 灰度、蓝绿、审批、自定义前置/后置阶段；
- Pod/集群 Terminal、复杂长连接交互；
- StatefulSet、CronJob、跨集群比较和高级调度。

## 3. 信息架构与菜单

### 3.1 全局菜单

```text
Podry
├── 工作台
│   ├── 项目
│   └── 应用
├── 集群资源
│   ├── 集群
│   └── 资源浏览器
├── 操作记录
└── 平台设置（管理员）
    ├── 团队与成员
    ├── 集群接入
    └── 基础环境
```

构建、发布、流水线和环境覆盖属于具体应用，不做成全局一级菜单。普通用户不显示平台设置，菜单可见性与接口权限同时生效。

### 3.2 应用内菜单

```text
应用名称
├── 概览
├── 构建发布
├── 构建历史
├── 发布历史
├── 配置
└── 运行资源
```

配置内部使用聚焦导航：

```text
配置
├── Git 源
├── 构建配置
├── 基础部署配置
├── 工作流
└── 环境覆盖
```

运行资源保留应用名称、当前环境和部署状态。用户选择“全部资源”时才进入全局资源浏览器。

### 3.3 资源工作区

```text
集群资源
├── 集群列表
└── 集群工作区
    ├── 概览
    ├── Nodes
    ├── Workloads
    │   ├── Deployments
    │   ├── Jobs
    │   └── Pods
    ├── Networking
    │   ├── Services
    │   └── Ingresses
    ├── Config & Storage
    │   ├── ConfigMaps
    │   └── Secrets
    └── Events
```

首版资源详情页签为 `Manifest | Events | Logs`。Terminal 保留独立权限和连接生命周期，延后实现。

## 4. 路由合同

页面路由使用 history 模式，临时抽屉使用 query 参数，筛选和页签可通过 URL 恢复。

| 路径 | 页面 | 菜单归属 |
| --- | --- | --- |
| `/` | 项目列表 | 工作台 / 项目 |
| `/apps` | 跨项目应用列表 | 工作台 / 应用 |
| `/projects/:projectId` | 项目详情 | 工作台 / 项目 |
| `/projects/:projectId/apps/:appId/overview` | 应用概览 | 应用页签 |
| `/projects/:projectId/apps/:appId/trigger` | 构建发布 | 应用页签 |
| `/projects/:projectId/apps/:appId/builds` | 构建历史 | 应用页签 |
| `/projects/:projectId/apps/:appId/deployments` | 发布历史 | 应用页签 |
| `/projects/:projectId/apps/:appId/config/git` | Git 源 | 配置子页 |
| `/projects/:projectId/apps/:appId/config/build` | 构建配置 | 配置子页 |
| `/projects/:projectId/apps/:appId/config/base` | 基础部署配置 | 配置子页 |
| `/projects/:projectId/apps/:appId/config/workflow` | 工作流 | 配置子页 |
| `/projects/:projectId/apps/:appId/config/overrides/:environment?` | 环境覆盖 | 配置子页 |
| `/projects/:projectId/apps/:appId/resources/:environment?` | 应用运行资源 | 应用页签 |
| `/clusters` | 集群列表 | 集群资源 |
| `/clusters/:clusterId/overview` | 集群概览 | 集群工作区 |
| `/clusters/:clusterId/resources/:group/:resource` | 资源列表 | 集群工作区 |
| `/clusters/:clusterId/resources/:group/:resource/:namespace/:name/:tab` | 资源详情 | 集群工作区 |
| `/audit` | 操作记录 | 操作记录 |
| `/members` | 团队与成员 | 平台设置 |
| `/settings` | 基础环境设置 | 平台设置 |

路由元信息至少包含 `title`、`icon`、`hidden`、`activeMenu`、`perm` 和 `tab`。详情页使用 `activeMenu` 点亮父级菜单，隐藏路由不重复出现在侧栏。

资源列表请求必须携带 Discovery 返回的 GVR。不能从 Kind 名称猜复数、API 版本或可写性。资源页签身份包含集群、GVR、Namespace、名称和读取到的 UID；切换集群时清理旧页签和连接状态。

## 5. 页面与组件边界

### 5.1 应用域

| Vue 文件 | 职责 | 主要输入/输出 |
| --- | --- | --- |
| `views/apps/ApplicationListView.vue` | 应用列表编排、筛选和导航 | 读取列表，触发创建/打开 |
| `components/app/ApplicationTable.vue` | 表格展示 | `rows`，触发 `open/configure/build` |
| `components/app/CreateApplicationDrawer.vue` | 创建和克隆应用 | `v-model:open`，触发 `created` |
| `layouts/app/ApplicationShell.vue` | 应用头部和页签 | `application`，驱动路由 |
| `components/app/ApplicationHeader.vue` | 面包屑、环境摘要、页签 | `application`、`tab` |
| `views/apps/ApplicationOverviewView.vue` | 应用摘要和环境状态 | `appId` |
| `views/apps/ApplicationResourcesView.vue` | 应用内资源上下文 | `appId`、`environment` |

### 5.2 配置与流水线

| Vue 文件 | 职责 |
| --- | --- |
| `views/apps/config/ApplicationConfigLayout.vue` | 配置聚焦布局、步骤门控、保存状态 |
| `components/config/GitConfigSection.vue` | Git 源配置 |
| `components/config/BuildConfigSection.vue` | Dockerfile、Context、Registry 和构建限制 |
| `components/config/BaseConfigSection.vue` | Deployment/Job 基础配置 |
| `components/config/WorkflowConfigSection.vue` | 一 CI 多 CD 的工作流配置 |
| `components/config/EnvironmentOverridesSection.vue` | 环境覆盖和合并来源 |
| `components/pipeline/BuildDeployCanvas.vue` | 执行画布，不负责配置保存 |
| `components/pipeline/WorkflowEditor.vue` | 配置画布，不触发执行 |
| `components/pipeline/MaterialSelectDrawer.vue` | 固定提交选择 |
| `components/pipeline/ImageSelectDrawer.vue` | 固定 digest 选择 |
| `components/pipeline/DeploymentReviewDialog.vue` | 固定目标和配置快照后确认发布 |

### 5.3 资源域

| Vue 文件 | 职责 |
| --- | --- |
| `views/clusters/ClusterListView.vue` | 集群列表和连接状态 |
| `views/clusters/ClusterWorkspaceView.vue` | 集群工作区、分类树和动态页签 |
| `components/resource/ResourceListWorkspace.vue` | 资源列表、Namespace 和搜索 |
| `components/resource/ResourceDetailPage.vue` | Manifest、Events、Logs 页签 |
| `components/resource/ManifestViewer.vue` | 首版只读 Manifest |
| `components/resource/EventsTable.vue` | 资源事件 |
| `components/resource/PodLogViewer.vue` | 日志加载、暂停和下载入口 |

### 5.4 跨域基础组件

| Vue 文件 | 职责 |
| --- | --- |
| `layouts/AppShell.vue` | 全局布局、顶部栏和侧栏 |
| `layouts/GlobalNavRail.vue` | 一级模块导航和折叠 |
| `components/pro/PageHeader.vue` | 标题、面包屑和操作区 |
| `components/pro/FilterBar.vue` | 筛选、URL 同步和筛选标签 |
| `components/pro/EmptyState.vue` | 空结果和清空筛选 |
| `components/pro/ErrorState.vue` | 重试和错误上下文 |
| `components/pro/StatusTag.vue` | 构建、发布、资源状态 |
| `stores/session.ts` | 当前用户、角色和授权范围 |
| `stores/navigation.ts` | 菜单展开、当前模块和资源页签 |
| `stores/application.ts` | 应用详情、配置和执行记录缓存 |
| `stores/resource-browser.ts` | Discovery、Namespace、列表和详情缓存 |

## 6. 数据流与门控

页面状态使用“页面 → composable → Pinia → API adapter → Podry API”的单向路径：

```text
ApplicationListView
  → useApplicationList()
    → applicationStore
      → api/applications.ts
        → /api/apps
```

API adapter 负责把后端 DTO 转换为页面模型，模板不直接依赖接口包封结构。页面模型至少包含：

```ts
type ApplicationSummary = {
  id: string
  projectId: string
  name: string
  sourceMode: 'git' | 'image'
  health: 'healthy' | 'degraded' | 'not-configured'
  environments: EnvironmentBinding[]
}
```

配置区使用服务端派生的 setup 状态：

```text
GET /api/apps/:appId/setup
  → steps
  → canBuild
  → deployableBindingIds
  → blockers
```

前端只渲染 `complete/pending/blocked/not_required`，不再维护第二个 `configured` 真值。未解锁路由显示锁定原因。配置写入携带 `expectedConfigVersion` 或 `expectedWorkflowVersion`，409 冲突保留表单并提示重新读取。

构建和发布的输入必须可追溯：

```text
Build = commit SHA + build config version + image digest
Release = image digest + binding + merged config snapshot + operator
```

发布未知结果保留目标占用，必须核对后才能继续，不由前端自动重复提交。

## 7. Devtron 模块到 Vue 的迁移方式

| Devtron 参考 | Vue 处理 | 首版 |
| --- | --- | --- |
| `components/app/list-new/AppList.tsx` | 重写 `ApplicationListView.vue` + `ApplicationTable.vue` | P0 |
| `components/app/details/AppHeader.tsx` | 重写 `ApplicationHeader.vue` | P0 |
| `app/Overview/Overview.tsx` | 重写 `ApplicationOverviewView.vue` | P0 |
| `triggerView/TriggerView.tsx` | 重写 `BuildDeployCanvas.vue` | P0 |
| `cIDetails/CIDetails.tsx` | 重写 `BuildHistoryView.vue` | P0 |
| `cdDetails/CDDetails.tsx` | 重写 `DeploymentHistoryView.vue` | P0 |
| `AppConfig.tsx` / `AppComposeRouter.tsx` | 重写 `ApplicationConfigLayout.vue` | P0 |
| `workflowEditor/Workflow.tsx` | 重写固定一 CI 多 CD 画布 | P0 |
| `ResourceBrowser/*` | 重写资源列表和详情工作区 | P0 只读 |
| `NodeDetailTabs/*` | 重写 Manifest、Events、Logs | P0 |
| `Terminal.tsx` / SockJS | 使用 Podry WS/ticket 合同 | P2 |
| `DeploymentTemplate.tsx` 大型 GUI/YAML 编辑器 | 先用结构化表单和只读 Manifest | P1 |
| `GlobalConfiguration/*` | 只取团队、集群、环境和 Registry 的必要子集 | P1 |

可参考的纯逻辑包括 Kubernetes 名称校验、标签校验、资源树建模、时间格式化和 YAML 转换；实现时逐函数重写，不复制 React 文件。

## 8. 依赖与工程约束

基础依赖保持：

```text
vue + vue-router + pinia + axios + tdesign-vue-next + less
```

按页面需要再添加：

- P0：日期格式化和 YAML 解析；
- P1：CodeMirror、Diff、虚拟列表；
- P2：xterm、WebSocket ticket、复杂日志流。

不引入 Devtron 的 `@devtron-labs/devtron-fe-common-lib`、`dc__*` 工具类、React Router、React Query、SockJS、品牌资产或其遥测和 Feature Flag 体系。

## 9. 实施顺序

### 阶段 A：应用闭环

实现全局菜单、项目/应用列表、应用头部、概览、应用配置入口和构建发布页。先用本地 Mock 验证路由、空态、错误态和权限可见性。

### 阶段 B：配置与历史

实现 Git、Build、Base、Workflow、环境绑定、构建历史和发布历史。接入 setup 门控、固定 commit/digest、版本冲突和发布确认。

### 阶段 C：资源查看

实现集群列表、Discovery、资源分类、Namespace、资源列表、Manifest、Events 和 Pod Logs。先验证真实查询和权限，不把资源写入、终端和长连接同时推进。

### 阶段 D：增强能力

按 API 合同逐项增加重试、回滚、Manifest Apply、资源操作、集群接入、审计增强和必要的长连接。

## 10. 验收标准

首版完成的判据：

1. 用户可以从项目进入应用，并通过应用页签完成配置、构建、发布和历史查看。
2. 构建和发布输入均可追溯到固定提交、digest、目标环境和配置版本。
3. 配置未完成、没有镜像、权限不足、请求失败和结果未知时，界面给出明确状态和下一步动作。
4. 应用内运行资源能够进入 Manifest、Events 和 Logs，并保留应用与环境上下文。
5. 菜单只显示用户有权访问的模块，管理员设置不会出现在普通用户菜单中。
6. Mock、API 合同、真实后端、真实 Git/Registry/Kubernetes 和用户验收分别记录。

不以 Devtron 页面数量、源码文件数量或完整菜单数量作为完成标准，以用户能否稳定完成一次“代码到环境”的交付闭环作为主要标准。

## 11. 文档关系与当前决策

- 本文是当前首版迁移方案。
- `02-devtron-inventory.md` 是 Devtron 源码事实和可追溯证据，不是首版功能承诺。
- `docs/references/01-devtron-mapping.md` 记录真实实例、公开源码和 Podry 方案的差异。
- `docs/prototype/04-localization.md` 规定中文术语和交互本土化，不因参考 Devtron 而恢复英文导航。
- `docs/delivery/03-vue-validation.md` 的浏览器检查只证明本地 Mock 原型交互，不证明真实后端或集群能力。

本文只规定前端迁移边界，不修改 Go 后端、数据库迁移或 API 合同。


</details>
