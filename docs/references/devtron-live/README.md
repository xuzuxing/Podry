# Devtron 测试实例观察记录

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
| 01 | [应用列表](01-application-list.png) | 搜索、Filter、Create；未配置应用与已部署应用同表。 |
| 02 | [创建类型菜单](02-create-menu.png) | Create 先打开 Custom app / Chart store / Job 菜单。 |
| 03 | [创建应用抽屉](03-create-application.png) | 右侧大抽屉，左说明与创建/克隆，右项目名称表单，底部固定按钮；未提交。 |
| 04 | [应用运行详情](04-app-details.png) | 环境选择、健康/部署状态、K8s Resources、Pod 快捷操作、All resources。 |
| 05 | [构建与部署画布](05-build-deploy.png) | 执行入口与配置入口分离；样例含外部镜像部署和独立 CI 两个流程。 |
| 06 | [工作流配置画布](06-workflow-editor.png) | 配置左侧菜单、画布节点编辑与添加控件。 |
| 07 | [Git 仓库配置](07-git-repository.png) | 独立仓库卡片与 Add Git Repository。 |
| 08 | [构建配置](08-build-configuration.png) | Registry / Repository、Dockerfile 与 Context、构建方式、保存按钮。 |
| 09 | [基础部署配置](09-base-configuration.png) | 聚焦侧栏：返回、Compare、Deployment Template / ConfigMaps / Secrets；GUI / YAML / Dry run。 |
| 10 | [选择构建提交](10-select-material.png) | 右侧大抽屉，左仓库分支、右提交卡片、底部 Start Build；未启动构建。 |
| 11 | [选择部署镜像](11-select-image.png) | 右侧大抽屉：当前环境、镜像单选、底部 Last saved config / Review / Deploy；未发布。 |
| 12 | [构建历史与日志空态](12-build-history.png) | 左流水线和执行列表、右时间线与 Logs / Source / Artifacts；存储未配置，日志不可用。 |
| 13 | [发布历史与源信息空态](13-deployment-history.png) | 左环境与时间列表、右发布状态、Source / Configuration；来源信息不可用。 |
| 14 | [资源浏览器集群入口](14-resource-clusters.png) | 集群健康统计和集群表格；点击集群进入 Nodes。 |
| 15 | [节点列表](15-cluster-nodes.png) | 现场导航落在 node/longhorn.io，页面渲染 Nodes；记录实际路由，不据此推断 Node 所属 API group。 |
| 16 | [Pod 资源列表](16-resource-pods.png) | 分类树 Workloads 展开、Pod 表格、All namespaces。 |
| 17 | [资源 Manifest 页签](17-resource-manifest.png) | 全宽详情，顶部保留 Overview / Pod / 资源页签，内层 Manifest / Events / Logs / Terminal。 |
| 18 | [资源事件空态](18-resource-events.png) | Events not available；没有补造事件。 |
| 19 | [资源日志](19-resource-logs.png) | 容器、previous、行数、日志正文与连接状态。未进入终端。 |
| 20 | [创建 K8s 资源抽屉](20-create-resource.png) | 右侧 YAML 抽屉，提示多文档，底部 Cancel / Apply；未输入或提交。 |
| 21 | [Namespace 筛选与页签保留](21-namespace-filter.png) | 列表筛选为 dev，之前打开的资源页签仍保留。 |
| 22 | [编辑 CI 节点](22-ci-node-edit.png) | 右侧管线编辑抽屉，Pre-build / Build / Post-build，代码来源和构建覆盖；未保存。 |
| 23 | [编辑 CD 节点](23-cd-node-edit.png) | 右侧部署管线编辑抽屉，目标环境、Namespace、触发方式、Rolling、digest 开关；未保存。 |
| 24 | [环境继承配置](24-environment-override.png) | 环境聚焦导航、Inherited / No override / Dry run、基础配置来源；未保存。 |
| 25 | [应用概览](25-app-overview.png) | 左应用元信息，右 About / Environments / Readme。 |
| 26 | [应用内资源日志页签](26-app-resource-logs.png) | 仍保留应用头部、环境、状态、K8s Resources 与资源页签；没有跳出到全局 Resource Browser。 |
| 27 | [应用内资源 Manifest](27-app-resource-manifest.png) | 应用资源详情与全局资源浏览器复用内容，但保留应用上下文；未编辑。 |

## 现场限制与 Podry 差异

1. 实例已存在一个外部镜像部署流程和一个独立 CI；本期 Podry 仍限定一 CI 多 CD，以及已有镜像交付，未增加任意流程引擎。
2. 历史 CI 日志显示未配置存储，不能将其替换为成功日志来证明现场能力。外部镜像的 Source 显示 Data not available；资源 Events 当前也为空。
3. 截图 15 的节点路由实际落在 node/longhorn.io，但渲染的是 Nodes。此处如实保留，不将路径中的 group 当作 Kubernetes Node 的 API 语义。
4. 资源创建抽屉宣告支持多 YAML；本地原型明确只支持单个 ConfigMap。
5. 生产手动发布、固定 digest、Review 后单独确认、未知结果保留占用，是 Podry 已确认的业务约定；未在远程实例执行这些写入。
6. 本地原型没有复刻 Devtron 品牌、Chart 商店、Job 平台、指标监控和全部高级字段。它对齐本次两项核心需求的操作结构，业务仍用合成数据。

原始截图与本地原型截图分别保存，不能互相替代验证结果。
