# 参考项目清单与逐模块对照

版本 V2.0 / 日期：2026-11-20 · 配套方案：[Devtron Dashboard → Podry Web 轻量化迁移方案](01-devtron-to-vue-plan.md)
对象：`D:\workspace\devtron-dashboard`（Devtron Dashboard 1.22.0）

> 本文是**证据附录**：只记录可核对的事实（文件路径、行数、符号、端点、协议），供评审与执行时逐项核对。本文不代表 Podry 首版要完整实现 Devtron；业务取舍、菜单和 P0/P1/P2 边界见方案正文。

## 0. 采集方法与局限

| 项 | 说明 |
| --- | --- |
| 方式 | 只读静态阅读 + 脚本统计（`fs` 遍历、正则解析 `import` 块、行数统计）；未执行、未构建、未安装依赖 |
| 行数 | `split('\n').length` 计数，含空行与注释；仅 `.ts/.tsx`（另有说明处） |
| 符号频次 | 解析 `import { … } from '@devtron-labs/devtron-fe-common-lib'` 的成员并按文件去重计数 |
| **关键局限** | 仓库**无 `node_modules`**，共享库 `@devtron-labs/devtron-fe-common-lib@4.0.14-pre-2` 的源码不可见。因此：① `ROUTER_URLS`/`BASE_ROUTES` 的**字面前缀无法在本仓库核实**，只能给出常量名 + 仓库内可核实的相对段（如 `src/config/routes.ts` 的 `materials`、`docker-build-config`）；② 共享库内部行为（表格、筛选、Toast、`get/post`）只能由调用点特征推断，本文标注为“推断” |
| 结论边界 | 本文不证明 Devtron 的运行时行为，只描述"代码里写了什么"。真实交互以用户实例截图与 Podry 原型为准 |

## 1. 体量与模块分布

`src` 下 1,204 个 `.ts/.tsx`（不含根 `App.tsx`、`index.tsx`），合计约 **214,655 行**。

| 模块 | 文件 | 行数 | 说明 |
| --- | --- | ---: | --- |
| `components/app` | 132 | 35,519 | 应用详情、触发视图、CI/CD 详情、资源树 |
| `Pages/GlobalConfigurations` | 186 | 23,653 | 全局配置、授权（RBAC）、集群与环境 |
| `components/v2` | 100 | 23,554 | 2.0 期新组件（详情、values diff、Stack Manager） |
| `Pages/Applications` | 53 | 12,842 | 应用配置主体（DeploymentTemplate、ConfigMap/Secret） |
| `components/CIPipelineN` | 52 | 10,595 | CI 抽屉、前置任务、变量表 |
| `components/ApplicationGroup` | 42 | 9,200 | 应用组（**不在范围**） |
| `components/common` | 87 | 8,987 | 通用组件与 111 个工具函数（`helpers/Helpers.tsx` 1,059 行） |
| `Pages/Shared` | 50 | 7,778 | 跨页复用（ConfigMap/Secret、EnvironmentOverride） |
| `components/charts` | 31 | 7,216 | Chart Store（**不在范围**） |
| `components/ResourceBrowser` | 38 | 7,150 | 集群列表、Kind 树、资源列表 |
| `components/notifications` | 28 | 6,337 | 通知渠道（**不在范围**） |
| `components/ClusterNodes` | 30 | 5,988 | 节点、集群终端（xterm） |
| `components/cdPipeline` | 18 | 5,279 | CD 抽屉、迁移向导 |
| `components/ciConfig` | 19 | 4,985 | 构建配置 |
| `Pages/App` | 45 | 4,758 | 外部应用/Flux 等 |
| `components/workflowEditor` | 21 | 4,274 | 工作流画布与节点 |
| `components/security` | 38 | 3,882 | 安全中心（**不在范围**） |
| `components/ciPipeline` | 12 | 3,695 | 旧版 CI 组件 |
| `components/externalLinks` | 11 | 2,833 | 外部链接 |
| `components/dockerRegistry` | 4 | 2,661 | Registry 表单（单文件 1,940 行） |
| `components/gitOps` | 9 | 2,383 | GitOps（**不在范围**） |
| `Pages-Devtron-2.0/InfrastructureManagement` | 20 | 2,187 | 基础设施总览与资源浏览器壳 |
| `components/material` | 7 | 1,942 | Git 材料（Select Material） |
| `Pages/ChartStore` | 13 | 1,804 | Chart Store |
| `Pages-Devtron-2.0/ApplicationManagement` | 23 | 1,778 | 应用管理壳（Overview/Configurations 路由） |
| `components/Jobs` | 17 | 1,771 | 独立 Job 平台 |
| `components/scopedVariables` | 15 | 1,711 | 作用域变量 |
| `components/gitProvider` | 5 | 1,236 | Git 账号 |
| `components/Navigation` | 8 | 1,180 | 侧边导航 |
| `components/bulkEdits` | 5 | 1,079 | 批量编辑 |
| 其余（chartRepo、project、login、AppSelector、checkList、external-apps、License…） | 56 | 5,036 | 多为薄壳或不在范围 |

**最重的单文件**（前 8，均已排除 `__mocks__`）：`DeploymentTemplate.tsx` 2,017 · `dockerRegistry/Docker.tsx` 1,940 · `ChartValuesView.tsx` 1,849 · `cdPipeline/CDPipeline.tsx` 1,435 · `GitOpsConfiguration.tsx` 1,406 · `ConfigMapSecretContainer.tsx` 1,200 · `DevtronStackManager.component.tsx` 1,129 · `AddNotification.tsx` 1,060。其后为 `Helpers.tsx` 1,059、`ClusterNodes/NodeDetails.tsx` 1,036、`ClusterTerminal.tsx` 1,035、`AppPermissions.component.tsx` 1,026。

## 2. 路由与导航信息架构

### 2.1 嵌套层次

`App.tsx` → `components/common/navigation/NavigationRoutes.tsx`（域级）→ 域 Router（`ApplicationManagementRouter` / `InfrastructureManagementRouter` / `GlobalConfiguration` 内部路由）→ 子路由。仓内共 6 个 Router 文件承载全部路径；字面量在共享库的 `BASE_ROUTES`/`ROUTER_URLS` 中。

`App.tsx` 另有 3 条“落地路由”（Toast 可弹出）：`{approvalType}/approve`、`LICENSE_AUTH`、`LOGIN.ROOT/*`；其余全部落到 `<Route path="/*" element={<NavigationRoutes/>}/>`，未匹配由 `RedirectUserWithSentry` 多路兜底。

### 2.2 域级路由

| 域 | 页面组件 | 懒加载 |
| --- | --- | --- |
| `GLOBAL_CONFIG.ROOT/*` | `components/globalConfigurations/GlobalConfiguration.tsx` | 是 |
| `INFRASTRUCTURE_MANAGEMENT.ROOT/*` | `Pages-Devtron-2.0/InfrastructureManagement/InfrastructureManagementRouter.tsx` | 否 |
| `APPLICATION_MANAGEMENT.ROOT/*` | `Pages-Devtron-2.0/ApplicationManagement/ApplicationManagementRouter.tsx` | 否 |
| `SECURITY_CENTER.ROOT/*` | `components/security/Security.tsx`（34 行壳） | 否 |
| `AUTOMATION_AND_ENABLEMENT.ROOT/*` | `components/Jobs/Jobs.tsx` | 否 |
| `AUDIT_LOGS.ROOT/*` | 共享库 `AuditLogs` | — |
| `STACK_MANAGER.ROOT/*` | `components/v2/devtronStackManager/DevtronStackManager.tsx` | 是 |
| `GETTING_STARTED` | `components/onboardingGuide/OnboardingGuide.tsx` | 是 |
| EA 路由（`SOFTWARE_RELEASE_MANAGEMENT`、`NETWORK_STATUS_INTERFACE`、`COST_VISIBILITY`、`DATA_PROTECTION_MANAGEMENT`） | 共享库，被 `window._env_` 开关包裹 | — |

### 2.3 应用管理（`ApplicationManagementRouter.tsx`，46 行）

| 路由常量 | 页面 | 导航 |
| --- | --- | --- |
| `APPLICATION_MANAGEMENT.OVERVIEW` | `ApplicationManagement/Overview/Overview.tsx`（23 行壳） | ✅ Overview |
| `DEVTRON_APP.ROOT/*` → `DevtronAppRouter` | `components/app/list-new/AppList.tsx`（492，懒）、`components/app/details/main.tsx`（懒） | ✅ Devtron Applications |
| `APPLICATION_GROUP.ROOT/*` | `components/ApplicationGroup/AppGroupRoute.tsx` | ✅ Application Groups |
| `BULK_EDIT` | `components/bulkEdits/BulkEdits.tsx`（569） | ✅ Bulk Edit |
| `CONFIGURATIONS.ROOT/*` | `ApplicationManagement/Configurations/ConfigurationsRouter.tsx` | ✅ 二级菜单 |
| `APPLICATION_TEMPLATES.ROOT/*`、`POLICIES.ROOT/*` | 共享库（env 开关） | ✅ 条件显示 |

### 2.4 应用详情页签（`app/details/main.tsx`；导航项定义在 `AppHeader.tsx` L167–247）

| 页签 | 相对路由 | 组件 | 懒加载 |
| --- | --- | --- | --- |
| Overview | `OVERVIEW` | `components/app/Overview/Overview.tsx`（536） | 否 |
| App Details | `details/:envId?/*` | `app/details/appDetails/AppDetails.tsx`（649） | 是 |
| Build & Deploy | `TRIGGER/*` | `app/details/triggerView/TriggerView.tsx`（217） | 是 |
| Build History | `CI_DETAILS/:pipelineId?/:buildId?/*` | `app/details/cIDetails/CIDetails.tsx`（646） | 是 |
| Deployment History | `CD_DETAILS/:envId?/:pipelineId?/:triggerId?/*` | `app/details/cdDetails/CDDetails.tsx`（352） | 是 |
| Deployment Metrics | `DEPLOYMENT_METRICS/:envId?` | `app/details/metrics/DeploymentMetrics.tsx`（839） | 是 |
| Configurations | `CONFIGURATIONS/*` | `Pages/Applications/DevtronApps/Details/AppConfigurations/AppConfig.tsx` | 否 |
| 兜底 | `*` → `APP_DETAILS` | — | — |

页签容器：`AppHeader`（应用切换、环境/组过滤）+ `AppNavigation`（配置区折叠导航）+ `AppComposeRouter`（“上一步/下一步”阶段门控，`AppConfig.utils.ts` 的 `isUnlocked` 状态机）。

### 2.5 应用配置内部路由（`AppComposeRouter.tsx`；字面段取自 `src/config/routes.ts`，已核实）

| 阶段 | 相对段 | 组件 |
| --- | --- | --- |
| Git | `materials` | `components/material/MaterialList.tsx` |
| Build | `docker-build-config` | `components/ciConfig/CIConfig.tsx` |
| Base | `base-config/deployment-template` | `MainContent/DeploymentTemplate/DeploymentTemplate.tsx`（2,017） |
| Workflow | `workflow/*` | `components/workflowEditor/workflowEditor.tsx`（998） |
| ConfigMap | `base-config/configmap/:name?` | `Pages/Shared/ConfigMapSecret/ConfigMapSecret.wrapper` |
| Secret | `base-config/secret/:name?` | 同上（`CMSecretComponentType.Secret`） |
| 环境覆盖 | `env-override/:envId?/*` | `Pages/Shared/EnvironmentOverride/EnvironmentOverride.tsx` |
| 配置对比 | `:envId?/config-compare/:compareTo?/:resourceType/:resourceName?` | `MainContent/DeploymentConfigCompare` |
| GitOps | `gitops-config` | `components/gitOps/UserGitRepConfiguration.tsx` |
| 外部链接 | `external-links` | `components/externalLinks/ExternalLinks.tsx`（362） |

Job 视图复用同一 Router（无 `docker-build-config`/`deployment-template`，改走 `ci-job/:ciPipelineId/*`）。

### 2.6 工作流编辑器路由（`workflowEditor.tsx` L590–754）

`empty-workflow` · `:workflowId/edit` · `:workflowId/(linked-ci|ci-pipeline|webhook)/:ciPipelineId(/cd-pipeline/:cdPipelineId)` · `:workflowId/ci-pipeline/:ciPipelineId/*` · `:workflowId/ci-job/:ciPipelineId/*` · `:workflowId/webhook/:webhookId` · `:workflowId/linked-cd` · `:workflowId/ci-cd-pipeline`（打开 `CreateCICDPipeline` 抽屉）。

节点：`nodes/{CINode,CDNode,WebhookNode,StaticNode}.tsx`；画布 `workflowEditor/Workflow.tsx`（835），连线由共享库基于 `@xyflow/react` 支撑；审批节点在共享库 `ApprovalNodeEdge`。前置/后置任务在 CI/CD 抽屉内（`CIPipelineN/{PreBuild,TaskList,TaskDetailComponent,TaskTypeDetailComponent,ConditionContainer}.tsx`、`cdPipeline/BuildCD.tsx`）。

### 2.7 资源浏览器（`ResourceBrowserRouter.tsx`，31 行）

| 路由常量 | 页面 |
| --- | --- |
| `CLUSTER_LIST/*` | `components/ResourceBrowser/ResourceBrowser.tsx` |
| `CLUSTER_DETAILS.ROOT/*` | `ResourceList/ResourceList.tsx`（476） |
| ├ `OVERVIEW` | 集群概览 |
| ├ `MONITORING_DASHBOARD` | 监控（**不在范围**） |
| ├ `TERMINAL` | `ClusterNodes/ClusterTerminal.tsx`（1,035，xterm） |
| ├ `RESOURCE_RECOMMENDER` / `CLUSTER_UPGRADE` | 资源建议 / 集群升级（**不在范围**） |
| ├ `NODE_DETAIL/*` | `ClusterNodes/NodeDetails.tsx`（1,036） |
| ├ `K8S_RESOURCE_DETAIL/*` | `v2/appDetails/k8Resource/nodeDetail/NodeDetail.component.tsx`（666） |
| └ `K8S_RESOURCE_LIST` | `ResourceList/K8SResourceList.tsx`（325） |
| `INSTALLATION_CLUSTER` / `COMPARE_CLUSTERS` | 安装状态 / 集群比较（**不在范围**） |

资源详情页签枚举 `NodeDetailTab`：`SUMMARY` / `LOGS` / `MANIFEST` / `DESCRIBE` / `EVENTS` / `TERMINAL`，顺序由 `getNodeDetailTabs`（`nodeDetail.util.tsx` L42–53）按节点类型与是否资源浏览器页签决定。实现文件：`NodeDetailTabs/Logs.component.tsx`(824)、`LogViewer.component.tsx`(114)、`Manifest.component.tsx`(757)、`Events.component.tsx`(113)、`EventsTable.tsx`(145)、`Terminal.component.tsx`(257)、`terminal/Terminal.tsx`(302)、`EphemeralContainerDrawer.tsx`(502)、`CustomLogsModal.tsx`(360)。列表工具栏：`ResourceFilterOptions.tsx`、`ColumnSelector.tsx`、`NodeListSearchFilter.tsx`、`ResourceBrowserActionMenu.tsx`、`CreateResource.tsx`、`DeleteResourcePopup.tsx`、`Sidebar.tsx`（集群/命名空间树）。

### 2.8 全局配置（`GlobalConfiguration.tsx` L226–415）

Host URL · External Links · Chart Repository · Clusters & Environments（`Pages/GlobalConfigurations/ClustersAndEnvironments/ClusterList.tsx` 523 + `EnvironmentList.tsx` + `CreateCluster/` + `EditClusterDrawerContent.tsx`）· Container/OCI Registry（`dockerRegistry/Docker.tsx` 1,940）· Projects（`project/ProjectList.tsx`）· Plugins · Node Autoscaler · Authorization（`Pages/GlobalConfigurations/Authorization/*`，最重 `AppPermissions.component.tsx` 1,026）。

2.0 起 Git 账号迁至 **Application Management → Configurations**：`GIT_ACCOUNTS`(`gitProvider/GitProvider.tsx` 935)、`GITOPS`(`gitOps/GitOpsConfiguration.tsx` 1,406)、`NOTIFICATIONS`(`notifications/*`)、`DEPLOYMENT_CHARTS`、`SCOPED_VARIABLES`(`scopedVariables/ScopedVariables.tsx`)、`BUILD_INFRA`。

### 2.9 侧边导航 IA（`components/Navigation/constants.ts` 的 `NAVIGATION_LIST`）

| 一级 | 二级 |
| --- | --- |
| Application Management | Overview / Devtron Applications / Application Groups / Bulk Edit / Configurations（GitOps、Git Accounts、Deployment Charts、Notifications、Scoped Variables、Build Infra）/ Templates / Policies |
| Infrastructure Management | Overview / Applications / Chart Store / Resource Browser / Resource Watcher |
| Security Center | Overview / Vulnerabilities / Security Policies |
| Automation & Enablement | Jobs |
| Global Configuration | SSO Login Services / Host URL / External Links / Chart Repository / Cluster & Environments / Container Registry / Projects / Plugins / Authorization（User Permissions、Permission Groups、API Tokens） |
| Audit logs | 单链，`?sortBy=timeStamp&sortOrder=DESC` |

过滤维度：`isAvailableInEA`、`forceHideEnvKey`（如 `ENABLE_SCOPED_VARIABLES`、`FEATURE_AUDIT_LOG_ENABLE`）。渲染：`Navigation.tsx` / `NavGroup.tsx` / `NavItem.tsx` / `NavigationLogo.tsx`；应用切换器 `AppSelector/{AppSelector,ChartSelector}.tsx`。

**Global 级 vs App 级**：上表全部为 Global 级（整页、独立面包屑、`PageHeader` + `SideNavigation`）；App 级是 `/…/app/:appId/*` 下的 7 个页签，共享 `AppHeader`，页签内再套配置导航与阶段门控。

## 3. UI 组件库与关键交互组件

| 类别 | 包/路径 | 用途 |
| --- | --- | --- |
| 共享设计系统 | `@devtron-labs/devtron-fe-common-lib@4.0.14-pre-2`（ISC，npm 公开） | `GenericTable`、`GenericFilter`、`GenericEmptyState`、`CodeEditor`、`Drawer`、`ToastManager`、`TabGroup`、`SideNavigation`、`ConfirmationModal`、`Progressing`、`BreadCrumb`/`useBreadcrumb`、`PageHeader`、`showError`、`Button`/`Icon`、`useUrlFilters`、`ROUTER_URLS` |
| 路由 | `react-router-dom@6.30.3` | 嵌套路由、`generatePath` |
| 弹层 | `@tippyjs/react@4.2.6` + `tippy.js@6` | Tooltip / Popover |
| 选择 | `react-select@5.8.0`（含本地补丁 `patches/react-select+5.8.0.patch`） | 单选/多选/分组 |
| 长列表 | `react-virtualized@9.22.5` | 表格与列表虚拟化 |
| 终端 | `@xterm/xterm@^6` + `@xterm/addon-fit@^0.11` | Pod / 集群终端 |
| 编辑与 diff | `yaml@2.8.3`、`js-yaml@4.3.1`、`fast-json-patch@3.1.1`、CodeMirror 6（`@uiw/react-codemirror` + lang-yaml/json/lint/merge） | Manifest / values 编辑与差异 |
| 表单引擎 | `@rjsf/core|utils|validator-ajv8@6.4.1` | 部署模板 GUI（JSON-Schema） |
| 图表 | `chart.js@4.5.0`（transitive） | Deployment Metrics |
| 富文本 | `dompurify@3.4.13` | README / CVE 渲染 |
| 时间 | `dayjs@1.11.13` + `moment@2.29.4` | 并存（应统一为 dayjs） |
| 实时 | `sockjs-client@1.6.1`、`rxjs@7.8.2`（`src` 内实际未 import）、自有 `util/Subject.ts` | 终端 / 日志事件流 |
| 遥测 | `@sentry/*@7.x`、`react-ga4`、`react-gtm-module`、`@typeform/embed-react` | **不迁移** |

## 4. fe-common-lib 被导入符号频次（Top 40）

1,448 个不同符号；下表为高频项（括号内为引用文件数）。**这是 Vue 侧必须提供等价物的清单**。

| 符号 | 次数 | 符号 | 次数 |
| --- | ---: | --- | ---: |
| `ComponentSizeType` | 174 | `CustomInput` | 45 |
| `ROUTER_URLS` | 164 | `ButtonComponentType` | 44 |
| `ButtonVariantType` | 147 | `post` / `get` | 42 / 52 |
| `Icon` | 146 | `getUrlWithSearchParams` | 37 |
| `showError` | 127 | `CHECKBOX_VALUE` | 36 |
| `ButtonStyleType` | 115 | `handleAnalyticsEvent` | 34 |
| `ToastManager` | 114 | `SearchBar` | 33 |
| `ToastVariantType` | 113 | `Drawer` | 30 |
| `Progressing` | 109 | `stringComparatorBySortOrder` | 29 |
| `SelectPickerOptionType` | 102 | `Checkbox` / `FiltersTypeEnum` | 29 / 29 |
| `Button` | 98 | `DOCUMENTATION` | 28 |
| `useAsync` | 75 | `getIsRequestAborted` | 27 |
| `SelectPicker` | 73 | `DocLink` / `TabGroup` | 26 / 26 |
| `useMainContext` | 66 | `ConditionalWrap` / `SelectPickerVariantType` | 25 / 25 |
| `GenericEmptyState` | 64 | `PageHeader` / `useBreadcrumb` / `useUrlFilters` | 24 / 24 / 24 |
| `InfoBlock` | 59 | `ConfirmationModal` / `CodeEditor` | 22 / 22 |
| `ResponseType` | 59 | `GenericFilterEmptyState` / `useQuery` | 22 / 22 |
| `ErrorScreenManager` | 56 | `VisibleModal` | 22 |
| `ServerErrors` | 50 | `Table` / `Pagination` | 17 / 11 |
| `Tooltip` | 49 | `SortableTableHeaderCell` | 13 |

## 5. 服务层与协议

### 5.1 基础 URL 与请求封装

| 层 | 事实 | 证据 |
| --- | --- | --- |
| 运行时配置 | `window._env_`（后端注入，80+ flag） | `index.tsx` L107–186、`config.md` |
| 路由 base | `window.__BASE_URL__ = import.meta.env.BASE_URL \|\| '/dashboard'` | `index.tsx` L47–50 |
| API 前缀 | 共享库导出常量 `Host`（orchestrator 挂载路径）；用法 `${location.origin}${Host}…` | `Login.tsx`、`NavigationRoutes.tsx` |
| WS 前缀 | `window.__ORCHESTRATOR_ROOT__ = VITE_ORCHESTRATOR_ROOT \|\| 'orchestrator'` | `index.tsx` L49、`Terminal.tsx` |
| 业务路由常量 | `src/config/constants.ts` L34–317（150+ 条相对路径） | 已核实 |
| 请求方法 | `fetch` 封装的 `get/post/put/trash`（**无 axios、无 GraphQL**） | 全仓检索 |
| 响应包封 | `{ code, status, result, errors? }`，调用点普遍 `.then(r => r.result)` | `service.ts` 等 |
| 错误模型 | `ServerErrors` 类：`.code`、`.errors[]`（元素含 `userMessage`）、`.status`；常量 `API_STATUS_CODES` | 调用点 |
| 提示 | `showError(errors)` → `ToastManager.showToast({variant: error})`；抛错前先 toast 是主要惯例 | `ResourceBrowser.service.tsx` L153–157 |
| 鉴权 | **HttpOnly Cookie `argocd.token`** + `credentials:'include'`；**无 CSRF 机制** | `constants.ts` L28、`fetchWithFullRoute.ts` L33 |
| 超时 | 全局 `setGlobalAPITimeout(60000)`；触发类用 `TRIGGER_API_TIMEOUT` | `App.tsx` L153 |

### 5.2 状态管理（无 Redux）

| 机制 | 角色 | 证据 |
| --- | --- | --- |
| React Query v5（共享库封装） | 服务端数据缓存、轮询、失效 | `index.tsx` L212；`app/service.ts`（`queryKey:['dt-app-details',appId,envId]`、`refetchInterval`） |
| `MainContextProvider` / `useMainContext` | 会话级全局 flag（`serverMode`、`isSuperAdmin`、模块可用性） | `NavigationRoutes.tsx` |
| `IndexStore`（**类单例，非响应式**） | 跨路由共享“当前 App 详情 + 资源树” | `v2/appDetails/index.store.ts` |
| `useReducer` + `Subject` | 单页复杂状态、日志行流 | `DeploymentTemplate.tsx`、`util/Subject.ts` |
| URL query | 列表筛选/分页/排序 | `useUrlFilters`、`Utils.tsx` |

> 迁移提示：`IndexStore` 在 render 中同步读取、写后手动 refetch。Vue 侧必须换成 Pinia store（`storeToRefs`），否则资源树变化不触发重渲染。

### 5.3 长连接（三种协议并存）

| 能力 | 端点 | 协议 |
| --- | --- | --- |
| Pod 日志 | `GET k8s/pods/logs/{pod}?containerName&previous&follow&clusterId&namespace`（或 app 维度） | **SSE**：`new EventSource(url,{withCredentials:true})` |
| Pod 终端会话 | `GET k8s/pod/exec/session/{appId\|clusterId}/{ns}/{pod}/{shell}/{container}` → `result.SessionID` | REST |
| Pod 终端数据 | `SockJS(${__ORCHESTRATOR_ROOT__}/k8s/pod/exec/sockjs/ws/)` | **SockJS**；帧 `{Op:bind\|stdin\|resize}`，下行 `{Data}` 写 xterm |
| 集群终端 | `POST user/terminal/start`、`PUT user/terminal/update`、`PUT …/update/shell`、`POST …/disconnect`、`POST …/disconnectAndRetry`、`PUT …/stop`、`GET …/pod/manifest`、`GET …/pod/events` | REST 轮询（7s，重试 7 次） |
| 应用/Helm 列表流 | `GET {Host}/application?clusterIds=`、`GET {Host}/flux-application?clusterIds=` | **SSE** |
| 日志下载 | `GET k8s/pods/logs/download/{pod}` | REST 下载 |

**Go 侧要点**：`k8s/*` 统一 “clusterId + k8sRequest” 代理契约；应用维度用合成标识（`{clusterId}|{appId}|{envId}`）。Podry 合同改为 NDJSON（日志）+ WS/ticket（终端），见方案 §8.2。

### 5.4 主要 service 文件 → 领域

| 领域 | 文件 | 典型端点 |
| --- | --- | --- |
| 全局/应用配置 | `src/services/service.ts`（18KB） | `GET app/stage/status`、`GET app/get/{id}`、`GET app/ci-pipeline/{appId}`、`GET app/cd-pipeline/{appId}`、`GET app/app-wf/{appId}` |
| 应用详情/资源树 | `components/app/service.ts`、`appDetails.service.ts` | `POST app/list`、`GET app/v2/{app-id,env-id}`、`GET app/{appId}/resource-tree`、`GET app/deployment-status/timeline/…`、`POST app/ci-pipeline/trigger` |
| CI | `components/ciPipeline/ciPipeline.service.ts`（26KB） | `GET app/ci-pipeline/{appId}/{ciPipelineId}`、`POST app/ci-pipeline/patch`、`GET app/commit-info`、`POST app/ci-pipeline/refresh-material` |
| CD / 触发 | `components/cdPipeline/cdPipeline.service.ts`、`triggerView/workflow.service.ts`（36KB） | `POST app/cd-pipeline/patch`、`GET app/cd-pipeline/strategies/{appId}`、`GET app/app-wf/view/{appId}`、`GET app/vsm` |
| 集群/节点 | `components/ClusterNodes/clusterNodes.service.tsx` | `GET k8s/capacity/cluster/list`、`GET k8s/capacity/cluster/{id}`、`GET k8s/capacity/node/list?clusterId=`、`PUT k8s/capacity/node/taints/edit` |
| 资源浏览器 | `components/ResourceBrowser/ResourceBrowser.service.tsx` | `GET k8s/api-resources/{clusterId}`、`GET cluster/namespaces/{clusterId}`、共享库 `getK8sResourceList` |
| 资源详情 | `v2/appDetails/k8Resource/nodeDetail/nodeDetail.api.ts` | `POST k8s/resource`、`POST k8s/events`、`GET k8s/pods/logs/…`、`GET k8s/resources/ephemeralContainers` |
| 集群注册 | `Pages/GlobalConfigurations/ClustersAndEnvironments/cluster.service.ts` | `POST cluster/saveClusters`、`POST cluster/validate`、`POST cluster/auth-list`、`DELETE cluster` |
| 用户/RBAC | `Pages/GlobalConfigurations/Authorization/authorization.service.ts` | `GET user/v2`、`GET user/v2/{id}`、`GET user/role/group/v2`、`POST user/resource/options/{kind}/v1alpha1` |
| Chart / 通知 / 安全 | `components/{charts,notifications,security}/*.service.ts` | **不在范围** |

### 5.5 鉴权与 RBAC 要点

- 登录 `POST api/v1/session`，成功判据 `response.result.token`；会话校验 `GET devtron/auth/verify/v2` → `{emailId,isVerified,isSuperAdmin}`；401 跳 `/login/sso?continue=`。
- 超管判定**硬编码** `roles.includes('role:super-admin___')`——不可照抄，Podry 用 `platform admin` 角色与授权交集。
- 细粒度矩阵：`EntityTypes × ActionTypes(ADMIN/VIEW/MANAGER/TRIGGER) × ACCESS_TYPE_MAP(DEVTRON_APPS/HELM_APPS/ARGO_APPS/FLUX_APPS/JOBS)` + team/env/cluster/namespace/workflow/app 维度。
- 按钮级：`useGetUserRoles()` / `useMainContext().isSuperAdmin` 条件渲染；接口级 `POST env/{envId}/group/permission/check`；403/412 语义化处理。

## 6. 可直接直译的纯逻辑资产

零依赖、与 UI 无关，可逐函数对照实现（不是复制文件）：

| 文件 | 函数 | 用途 |
| --- | --- | --- |
| `components/common/helpers/Helpers.tsx` | `validateEmail`、`shallowEqual`、`deepEqual`、`mapByKey`、`asyncWrap`、`sortObjectArrayAlphabetically`、`convertToOptionsList`、`createGroupedItemsByKey`、`k8sStyledAgeToSeconds`（`3d2h`→秒）、`eventAgeComparator`、`getElapsedTime`、`highlightSearchedText`、`useJsonYaml`（JSON↔YAML + 校验） | 列表/表单/事件表基础 |
| `helpers/compareVersion.ts` | `getVersionArr`、`isVersionLessThanOrEqualToTarget`、`isChartRef3090OrBelow` | K8s / Chart 版本比较 |
| `helpers/{isSubset,isEmpty,utils}.tsx` | `isSubset`、`isEmpty`、`subtractArray`、`isArrayEqual`、`swap` | 表单与列表 diff |
| `helpers/time.ts` | `handleUTCTime`、`getTimeElapsed` | 时间格式化（迁移时统一 dayjs） |
| `util/Util.ts` | `replaceLastOddBackslash`、`safeTrim` | YAML 转义修补 |
| `util/Subject.ts` | `Subject<T>`（subscribe/publish/unsubscribeAll） | 日志流事件总线（Vue 用 `shallowRef` + `Set` 替代） |
| `config/constants.ts` | `PATTERNS`（NAMESPACE / KUBERNETES_KEY / KUBERNETES_VALUE / APP_NAME / CUSTOM_TAG / SCOPED_VARIABLE） | K8s 命名与标签校验（**必须照抄语义**） |
| `ResourceBrowser/Utils.tsx` | `getGroupedK8sObjectMap`、`convertResourceGroupListToK8sObjectList`、`parseNodeList`、`removeDefaultForStorageClass`、`sortEventListData`、`renderResourceValue` | 资源树建模（与 UI 解耦） |
| `scopedVariables/utils.tsx` | `parseIntoYAMLString`、`parseYAMLStringToObj`、`sortVariables`、`downloadData` | YAML 工具（部分可复用） |
| `ClusterNodes/NodeActions/utils.ts` | `getTaintsTableRows`、`validateUniqueTaintKey`、`getTaintsPayload` | 污点校验（首版 Node 只查看，延后） |
| `CIPipelineN/VariableDataTable/validations.ts` | `validateInputOutputVariableCell`、`validateVariableDataTableVariableKeys` | 变量表校验 |
| `Pages/Shared/ConfigMapSecret/utils.ts` | `getLockedYamlString`、`getYAMLWithStringifiedNumbers` | CM/Secret 视图模型 |

## 7. 参考项目排除项与首版取舍

| 类别 | 内容 | 证据 |
| --- | --- | --- |
| 企业版闭源 | `@devtron-labs/devtron-fe-lib`，统一经 `importComponentFromFELibrary('X', null, 'function')` 注入（License 弹窗、AI 解释、多集群视图等 20+ 处） | `Helpers.tsx` L775、`CLAUDE.md` L65–77 |
| License / Gatekeeper | `Pages/License/ActivateLicense.tsx`、`GATEKEEPER_URL`、`ROUTER_URLS.LICENSE_AUTH`、`FEATURE_PROMO_EMBEDDED_*` | `App.tsx` L36/L84–88 |
| 遥测 | Sentry 初始化与 `beforeSend` 过滤、`react-ga4`/`react-gtm-module`、PostHog、Typeform、`handleAnalyticsEvent`、登录计数上报 | `index.tsx` L20–104、`NavigationRoutes.tsx` L283–320 |
| 自身工程脚手架 | `.github/`、`.husky/`、`.lintstagedrc`、`.deepsource.toml`、`linter.py`、`Dockerfile`、`nginx*.conf`、`env.sh`、`patches/`、`.yarn/` | 目录清单 |
| K8S_CLIENT 模式 | `window._env_.K8S_CLIENT` 分支与 `.env.k8sApp`、`build-k8s-app` 脚本 | `index.tsx` L128 |
| 冗余依赖 | `moment`、`rxjs`（src 未 import）、`react-virtualized`、`command-line-parser`、`compute-histogram`、polyfill 插件 | `package.json` |
| Flag 体系 | 80+ `FEATURE_*` 运行时开关 | `.env`、`config.md` |
| 业务超范围 | Chart Store、Security Center、Application Groups、Bulk Edit、Migrate、GitOps/Argo/Flux、Notifications、Scoped Variables、Build Infra、Plugins、Stack Manager、Node Autoscaler、Deployment Metrics、Config Compare、集群比较/升级 | 见 [轻量化迁移方案](01-devtron-to-vue-plan.md) |

### 7.1 首版能力分层

| 层级 | 从参考项目保留的能力 | 处理方式 |
| --- | --- | --- |
| P0 | 应用列表、应用头部、配置分节、Build & Deploy、构建/发布历史、集群资源查看、Manifest、Events、Pod Logs | Vue 重写并接入 Podry 合同 |
| P1 | 环境覆盖、取消/重试、晋级/回滚、Manifest Diff/Apply、资源写操作、集群接入 | 等真实 API 和授权合同具备后逐项增加 |
| P2 | Deployment Metrics、Chart Store、Security Center、任意 DAG、Terminal、GitOps、插件与模板市场 | 不进入首版菜单和关键路径 |

参考源码中的纯逻辑（Kubernetes 命名校验、资源树建模、时间格式化和 YAML 转换）可以逐函数重写；React 组件和 Devtron 公共库不作为可复制资产。

## 8. 目标侧现状（`web/` 工程）

当前迁移按 `web/` 为 Vite + Vue 3 空项目处理。历史原型和旧工程目录可作为交互证据，但不构成当前目录结构或状态管理的前提。

### 8.1 空工程目标基线

当前不把历史 `web` 原型文件、独立入口或旧 Store 作为迁移前提。实现从空的 Vite + Vue 3 工程开始，先建立以下基础层：

| 层 | 首版目标 |
| --- | --- |
| App | `AppShell`、错误边界、全局 Provider |
| Layout | 顶部栏、可折叠全局导航、应用头部和资源工作区 |
| Router | history 路由、隐藏详情路由、`activeMenu`、`perm`、`tab` 元信息 |
| Store | session、navigation、application、resource-browser |
| API | 统一 RequestClient、领域 API adapter、错误映射和取消 |
| UI | PageHeader、FilterBar、Table、Drawer、EmptyState、ErrorState、StatusTag |
| Mock | 项目、应用、配置、构建、发布、集群和资源的最小数据集 |

### 8.2 首版页面目标

| 页面 | Devtron 参考 | Vue 首版处理 |
| --- | --- | --- |
| 项目/应用列表 | AppList | Vue 表格、搜索、项目筛选、创建抽屉 |
| 应用概览 | AppHeader + Overview | 应用头部、环境摘要和最近执行 |
| 构建发布 | TriggerView | 固定 Source → CI → Artifact → CD 工作台 |
| 构建/发布历史 | CIDetails / CDDetails | 左列表右详情、日志和产物/目标信息 |
| 应用配置 | AppConfig / AppComposeRouter | Git、Build、Base、Workflow、环境覆盖 |
| 运行资源 | AppDetails / ResourceBrowser | 应用上下文资源与全局资源共用详情组件 |
| 资源详情 | NodeDetailTabs | 首版 Manifest、Events、Logs |
| 审计 | AuditLogs | 只读操作记录 |

### 8.3 接管和重写边界

历史原型如存在，只能按以下方式接管：

| 内容 | 处理 |
| --- | --- |
| 页面布局和交互状态 | 可复用，改成命名路由和统一 Store |
| Devtron 形状的 hash 路由 | 改成本文约定的 history 路由 |
| 独立 Mock API/Store | 合并到正式 RequestClient、Pinia 和 API adapter |
| 全局原型 CSS | 按项目 token 重写，不继续覆盖全局 TDesign 令牌 |
| 字符串拼接 YAML | 使用经过校验的 YAML 解析器和模型 |
| DemoControls、虚拟角色和场景开关 | 删除，替换为真实权限和连接状态 |
| 受控资源写入、终端和长连接 | 延后到 P1/P2，并以 Podry API 合同为准 |

本文的目标侧事实只描述迁移起点，不声称 Vue 页面、后端接口或 Kubernetes 能力已经实现。
