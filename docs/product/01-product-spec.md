# 产品说明

版本：V1.2 / 原型 V2.1 · 2026-11-19 · 关联：[流程与状态](02-workflows-and-states.md)、[页面规格](../prototype/01-page-spec.md)、[新应用实测与缺口](../references/devtron-onboarding/README.md)。

## 1. 定位与目标

为个人开发者和中小团队提供轻量的云原生交付工作台。开发者完成代码到镜像、镜像到多环境发布；运维人员按集群查看和管理 Kubernetes 资源。两种入口可以相互跳转，状态与权限保持一致。

首版要回答：代码构建出了什么镜像？哪个环境运行哪个版本？发布失败在哪一步？如何恢复历史版本？集群中的异常资源为何异常、可以如何处理？

业务流程参考用户部署的 Devtron，见 [真实观察记录](../references/devtron-live/README.md)。页面于 2026-11-20 按中文研发团队习惯调整，当前交互以 [中文团队适配](../prototype/04-localization.md) 与 [页面规格](../prototype/01-page-spec.md) 为准：配置集中在“应用配置”；日常执行进入“构建发布”工作台，左侧选择代码并构建，右侧按环境选择镜像发布；历史采用左列表右详情；应用内与集群内资源详情分别保留各自上下文的动态页签。

不以完整移植 Devtron 为目标。首版不建设插件市场、Chart 商店、完整监控平台、跨集群同步、任意 DAG 引擎、Argo CD / Argo Workflows 集成。

## 2. 术语与归属

| 术语 | 定义 |
| --- | --- |
| 团队 Team | 业务归属与成员授权边界 |
| 项目 Project | 团队内的应用集合与项目权限边界 |
| 应用 Application | 独立构建和部署单元；不再创建平行 Component 实体 |
| 环境 Environment | 全局逻辑阶段，例如 development、staging、production；页面分别显示开发环境、预发布环境、生产环境，接口保留原始标识 |
| 环境绑定 Binding | 应用在某环境的实际目标：Cluster、Namespace、releaseName |
| CI 流水线 | Git 源、构建配置与触发规则；首版每应用最多一条启用的 CI |
| CD 流水线 | 某个环境绑定的发布策略；首版每绑定一条 |
| 构建 Build | 针对固定提交与构建配置的一次任务；重试新建执行尝试 |
| 镜像产物 Artifact | 镜像仓库地址、digest、来源构建和提交 |
| 发布请求 Release Request | 固定产物、目标配置和操作人的不可变交付意图 |
| 部署 Deployment | 对一次发布请求进行的实际提交与观察；与 K8s Deployment Kind 区分 |
| 漂移 Drift | 集群实时资源与最近成功发布快照存在差异 |

## 3. 角色与权限

角色是初始权限集合，最终以服务端的项目授权和资源目标授权交集为准。

| 角色 | 应用能力 | 资源能力 |
| --- | --- | --- |
| 平台管理员 | 平台设置、全部项目授权、凭据和集群管理 | 授权范围内的集群级管理 |
| 项目管理员 | 应用和流水线配置、项目成员管理 | 仅已授予的集群/Namespace/资源操作 |
| 开发者 | 查看、配置草稿、触发 CI；按授权发布目标环境 | 可授予查看和日志权限 |
| 运维人员 | 按授权发布、晋级、回滚 | 可授予编辑、重启、扩缩容、终端权限 |
| 观察者 | 只读应用、构建、发布历史 | 只读资源；日志、Secret 值、终端均不隐含授权 |

权限动作至少区分 `app.view`、`app.configure`、`build.trigger`、`deploy.trigger`、`resource.view`、`resource.write`、`resource.delete`、`pod.logs`、`pod.exec`、`secret.reveal`、`node.manage`。通用 YAML 写入必须校验 GVR、Namespace、对象内容及对应 Kubernetes 操作；不得通过提交 RoleBinding、Pod 或跨 Namespace 文档绕过授权。

首版账户由管理员 CLI 创建和停用，无自助注册。平台管理员由初始化命令创建，无内置默认口令。HTTP 仅提供登录、当前身份和退出。团队/项目管理员只能关联已有用户；具体 CLI 在实现阶段补充。

## 4. 首版功能清单

### 4.1 应用管理

| 编号 | 功能 | 规则 |
| --- | --- | --- |
| APP-01 | 列表与搜索 | 项目、应用名称、环境、健康状态筛选，分页 |
| APP-02 | 创建与归档 | 支持 Git 构建模式、已有镜像模式；归档不自动删除集群资源 |
| APP-03 | Git 源 | 一仓库、默认分支、凭据引用、构建目录；凭据不返回明文 |
| APP-04 | 构建配置 | Dockerfile、Context、Build Args、镜像仓库、超时与资源限制 |
| APP-05 | 部署配置 | 显式选择 Deployment 或一次性 Job；前者配置端口、副本、探针、Service、Ingress，后者配置执行截止时间和失败重试上限 |
| APP-06 | 配置覆盖 | 基础配置与环境覆盖，展示合并后配置与差异；保存产生配置版本 |
| APP-07 | 工作流 | 一条 CI 连接多个 CD；点击节点配置，显示最新执行状态 |
| APP-08 | 运行资源 | 资源树、Pod、事件、日志、终端，复用资源浏览器组件 |
| APP-09 | 首次配置引导 | Git 模式 0/4→4/4：Git、Build、Base、完整 Workflow；按保存事实计算，无默认环境；镜像模式跳过 Git/Build，为 0/2→2/2 |
| APP-10 | 从模板创建工作流 | 主流程为 Build & Deploy from Source Code；一次确认原子创建 CI、环境绑定和 CD；仅构建是独立可选流程，不能冒充完整流程 |

### 4.2 CI

| 编号 | 功能 | 规则 |
| --- | --- | --- |
| CI-01 | 手动构建 | 指定分支后解析并固定 commit SHA，或直接指定 commit SHA |
| CI-02 | Webhook | 首版支持 GitHub、GitLab Push；验签、Delivery ID 去重、分支过滤 |
| CI-03 | 执行 | 独立 Namespace 的 Kubernetes Job；拉取代码、可选检查脚本、BuildKit 构建推送 |
| CI-04 | 进度与日志 | 阶段状态、耗时、实时日志、归档日志；日志脱敏尽力而为，禁止主动输出凭据 |
| CI-05 | 取消与重试 | 取消先确认 Job 终止；重试产生新的 attempt，不改写既有执行历史 |
| CI-06 | 产物 | 保存 digest、提交 SHA、构建版本、来源；已有镜像模式校验 Registry digest 后导入 |

### 4.3 CD

| 编号 | 功能 | 规则 |
| --- | --- | --- |
| CD-01 | 绑定环境 | 选择已授权集群/Namespace、releaseName；首版每应用每逻辑环境一个绑定 |
| CD-02 | 发布确认 | 固定产物、Chart 版本、配置版本、Secret 版本引用，展示目标与差异 |
| CD-03 | 自动部署 | 可配置 CI 成功自动发布开发环境；测试与生产首版手动触发 |
| CD-04 | 环境晋级 | 从成功发布记录选择产物；目标环境配置仍独立生成快照 |
| CD-05 | 状态观察 | 区分提交中、就绪观察、成功、失败、未知；Helm 返回不直接等同业务就绪 |
| CD-06 | 历史与回滚 | 选择同绑定的成功历史快照，新建回滚请求；缺失敏感配置版本时阻止并明确提示 |
| CD-07 | 并发与恢复 | 按物理 Helm 目标串行；未知结果保留占用，先核对实际状态 |

首版内置模板覆盖 Deployment、一次性 Job、Service、Ingress、ConfigMap 与已有 Secret 引用。Job 是应用部署的工作负载类型，与构建执行器使用的 Kubernetes Job 分开。Job 模板固定单次任务（completions=1、parallelism=1、restartPolicy=Never），默认无 Service、Ingress、HTTP 探针；以 Job Complete=True 判断成功，以 Failed/截止时间判断失败。每次发布使用新的执行名称，不修改已经运行的 Job Pod 模板。第一次显式保存基础配置后锁定工作负载类型，版本可按兼容策略升级。

StatefulSet、CronJob 调度、Chart 导入、部署前后 Hook、审批、灰度、蓝绿为后续扩展，不影响浏览器查看已有相关资源。此次远程选用 Devtron 的 Job & CronJob Chart，并不表示已验证其发布或将整个定时任务平台纳入首版。

### 4.5 新应用到首次发布

1. 创建应用只写基础信息。初始没有环境绑定、CI、CD 或运行资源；不能从其他应用继承默认运行状态。
2. 首次 Git 表单直接内嵌页面。公开 HTTPS 仓库可不选凭据；私有仓库只选已有凭据引用。保存成功展示仓库卡片，解锁 Next；保存 URL 不等于分支查询或实际克隆成功。
3. Build Configuration 配置 Registry、镜像 Repository、相对 Dockerfile/Context、单目标平台。路径不能越出仓库。hello-world 示例使用 `master`、`amd64/Dockerfile`、`amd64`、`linux/amd64`；不假定根目录有 Dockerfile。
4. Base Configurations 显式选模板并保存。hello-world 运行后退出，原型引导选择 Job。页面默认值本身不算完成一步。
5. Workflow Editor 初始为空，New Workflow 选择 **Build & Deploy from Source Code**。表单同时要求固定分支和一个部署环境；Namespace/Cluster 来源于所选目标，releaseName 默认由应用名生成，提交前检查物理目标冲突。服务端在事务内同时建立 CI、Binding、CD，失败不留下半个流程。
6. 完成后出现一个 Build 和一个 Deploy 节点，环境覆盖菜单仅展示实际绑定。成功提示提供 Build & Deploy / Environment Override。额外环境通过 Add Deployment Pipeline 显式添加，不预建三个 CD。
7. Select Material 查询成功并选中提交后才能 Start Build。源不可达、认证失败、分支不存在、无匹配提交分别提示；失败不能创建构建。产生镜像前 Select Image 显示 No Image Available，不能点击 Deploy。
8. 构建结果、镜像产物与日志可用性分别展示；构建成功但无归档日志不算失败。最终发布仍需固定 digest、目标和配置快照后确认。

仅构建流程允许停在 3/4，仍可执行 CI；“配置完成度”不能作为统一执行权限开关。canBuild 依赖 Git/Build/CI；canDeploy 依赖所选 Binding/CD、Base 和可用产物。Clone 复制源应用的配置快照，清除执行记录、产物、运行资源及目标绑定，必须重新确认环境后才可发布。

### 4.4 Kubernetes 资源管理

| 编号 | 功能 | 规则 |
| --- | --- | --- |
| RB-01 | 集群接入与切换 | 保存加密凭据、测试连接；无权限、离线、凭据失效分别提示 |
| RB-02 | 动态资源发现 | Discovery 决定 GVR、命名空间作用域及支持的 verbs；支持 CRD 实例 |
| RB-03 | 列表 | Namespace、名称、标签筛选；分页使用 Kubernetes continue Token |
| RB-04 | 详情与关系 | 概览、YAML、事件、关联资源；用 UID 和 OwnerReference 识别对象 |
| RB-05 | YAML 创建编辑 | 多文档、Dry Run、Diff、确认；逐对象反馈，禁止宣称跨对象事务 |
| RB-06 | 删除 | 显示 Kind、Namespace、名称、影响与级联策略；UID 前置条件防止误删重建对象 |
| RB-07 | 重启与扩缩容 | 仅适用 Kind；HPA 管理的对象不直接覆盖其副本控制 |
| RB-08 | Pod 日志 | 容器、tail、since、previous、follow；断线提示与重连 |
| RB-09 | Pod 终端 | 容器、命令、TTY、resize；独立授权，离开页面关闭会话 |
| RB-10 | Node 与存储 | 首版 Node 查看、Pod 关联；PVC/PV/StorageClass 状态及绑定关系 |

资源分组包含 Workloads、Networking、Config & Storage、RBAC、Administration、Custom Resources。指标服务缺失时 CPU/内存使用量标为不可用，不影响管理。

## 5. 数据保护与审计

- Git Token、Registry 口令、kubeconfig、Webhook Secret 加密保存；加密主密钥独立于数据库备份。
- Secret 默认只返回 key 和版本元信息；明文读取独立接口、独立授权且审计，响应禁止缓存。
- 敏感配置引用采用版本；发布快照不复制明文。历史版本不可用时，不声称能够完整回滚。
- 修改应用配置、触发/取消构建、发布/回滚、资源写入/删除、Secret 查看、终端创建都产生审计记录。
- 权限拒绝不返回对方团队的应用名称、凭据、Secret 或资源详情。

## 6. 非功能边界

第一版按单实例 Podry + PostgreSQL + 持久日志卷部署。构建并发和每集群资源查询并发可配置，列表按需获取；不会为所有集群所有 Kind 预先建立全量缓存。

连接和执行均有独立超时。切换集群、Namespace、应用或容器时取消旧请求及流连接，清除不属于新上下文的详情；缓存键必须包括目标和用户权限上下文。

## 7. 首版验收结果

场景 A：创建应用 → Git Push → 产出固定 digest → 开发环境部署 → 运行资源 → 生产晋级 → 回滚。

场景 B：切换集群 → 定位异常资源 → 事件/日志/终端 → YAML 或重启 → 恢复状态 → 审计与配置差异。

详细可执行用例见 [开发与验收计划](../delivery/01-plan-and-acceptance.md)。
