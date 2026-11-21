# Devtron 迁移逐项对账清单

版本：V1.0 · 日期：2026-11-20 · 对照物：`docs/prototype/01-page-spec.md`、`docs/references/devtron-live/*`、`devtron-dashboard` 源码
状态：✅ 已有 / 🚧 部分 / ❌ 缺失

> 用途：把"截图驱动"改成"清单驱动"。每轮开发按本清单自上而下清账，清完打勾并注明文件。

## 1. 应用详情（运行详情）`views/apps/AppResourcesView.vue`

| # | 功能点 | 参照 | 现状 |
| --- | --- | --- | --- |
| 1.1 | 环境条：ENV 选择 + 部署按钮 | 04 | ✅ |
| 1.2 | 环境条：复制链接 / 刷新 / 环境切换图标 | 04 | ✅ |
| 1.3 | Application Status 卡 + Details | 04 | ✅ |
| 1.4 | Deployment Status 卡 + Details（状态/时间/操作人） | 04 | ✅ |
| 1.5 | 状态抽屉：Application Status / Deployment Status 双页签 | 04 | ✅ |
| 1.6 | 状态抽屉：资源表 KIND/NAME/STATUS/MESSAGE + All/healthy 过滤 | 04 | ✅ |
| 1.7 | Monitoring 区块（CPU/Memory/2xx/3xx/5xx/Throughput/Latency） | 04 | ✅ |
| 1.8 | K8s Resources / Log Analyzer 同级页签 | 16 | ✅ |
| 1.9 | 资源点开为应用内页签（不跳出应用） | 16 | ✅ |
| 1.10 | Deployment → ReplicaSet → Pod → Containers 层级 + 分组标题 | 16 | ✅ |
| 1.11 | Pod 的 New Pods / Old Pods 子页签 | 16 | ✅ |
| 1.12 | 每行按类型给操作（Manifest / Logs / Terminal / Events） | 16 | ✅ |
| 1.13 | Service 展示 URL 列 + ENDPOINTS / ENDPOINTSLICE 分组 | 16 | ✅ |
| 1.14 | 底部上下文条（Cluster / Namespace / All resources / Cluster terminal） | 16 | ✅ |
| 1.15 | Log Analyzer：Pod/容器选择、Live、搜索 | 16 | ✅（下载并入 Logs 页签） |

## 2. 资源浏览器（集群）`views/clusters/*`

| # | 功能点 | 参照 | 现状 |
| --- | --- | --- | --- |
| 2.1 | 集群列表 + 4 指标条 | 14 | ✅ |
| 2.2 | 工作区页签：Overview / 当前 Kind / 资源页签 | 15 | ✅ |
| 2.3 | Overview 页（集群元信息 + CPU/Memory 卡 + Readme） | 15 | ✅ |
| 2.4 | 左列表：Nodes / Events / Namespaces + 分类分组 | 16 | ✅ |
| 2.5 | Jump to Kind 搜索框（跳转 Kind） | 16 | ✅ |
| 2.6 | Kind 列表按类型不同列 | 15/16 | ✅ |
| 2.7 | Node 列表额外列 Roles/Version | 15 | ✅ |
| 2.8 | Pod 列表额外列 Ready/Restarts/Node | 16 | ✅ |
| 2.9 | Deployment/StatefulSet 列 Ready + 状态 | 16 | ✅（Up-to-date 需后端字段） |
| 2.10 | Service 列 Type/Cluster-IP/Ports；Ingress 列 Hosts | 16 | ✅ |
| 2.11 | ConfigMap/Secret 列 Keys；PVC 列 Capacity/Access Modes | 16 | ✅ |
| 2.12 | Job/CronJob 列 Completions、Schedule | 16 | ✅（Duration/Last Schedule 需后端字段） |
| 2.13 | 名称列复制按钮 + 行内 ⋮ 菜单 | 16 | ✅ |
| 2.14 | Events 聚合页 | 16 | ✅ |
| 2.15 | Namespace 列表页签 | 16 | ✅ |
| 2.16 | Create Resource（YAML 大抽屉 + Cancel/Apply + Dry run） | 20 | ✅ |
| 2.17 | 集群终端（mock 会话 + kubectl 只读） | 16 | ✅ |
| 2.18 | 节点详情页（Summary/YAML/Node Conditions + Cordon/Drain/Taints） | 15 | ✅ |
| 2.19 | 切换集群清空旧集群页签 | spec §7.10 | ✅ |

## 3. 资源详情（共享组件）`components/resource/ResourceDetailPanel.vue`

| # | 功能点 | 参照 | 现状 |
| --- | --- | --- | --- |
| 3.1 | Manifest / Events / Logs / Terminal（Logs+Terminal 仅 Pod） | 17 | ✅ |
| 3.2 | Hide Managed Fields / Edit live manifest / Diff / Apply | 17 | ✅ |
| 3.3 | Secret 明文读取（授权 + 审计） | P2 | ✅ |
| 3.4 | Logs：容器 / previous / 行数 / 暂停恢复 / 下载 | spec §7.8 | ✅ |
| 3.5 | Deployment 的 Scale / Restart 显式确认 | spec §7.7 | ✅ |
| 3.6 | Pod 行内快捷 Manifest/Logs/Terminal/Events | 16 | ✅ |

## 4. 构建 / 发布 / 配置 / 历史

| # | 功能点 | 参照 | 现状 |
| --- | --- | --- | --- |
| 4.1 | 构建部署流程图（Source → CI → 多 CD + AUTO） | 05 | ✅ |
| 4.2 | Select Material / Select Image 抽屉 + Review | 05 | ✅ |
| 4.3 | 发布策略（滚动/灰度/蓝绿） | P2 | ✅ |
| 4.4 | 构建历史（左记录右详情 + 日志 + 取消/重试） | 12 | ✅ |
| 4.5 | 发布历史（状态/镜像/配置版本 + 晋级/回滚/未知核对） | 13 | ✅ |
| 4.6 | 配置五节（Git/构建/基础/工作流/覆盖）+ 版本与冲突 | 07–09 | ✅ |
| 4.7 | 基础配置 GUI/YAML 双模式 | 08 | ✅ |
| 4.8 | Git 保存后才解锁「保存并下一步」 | spec §4 | ✅ |
| 4.9 | 构建配置「保存」停留 /「保存并下一步」进 Base | spec §4 | ✅ |
| 4.10 | Base Configurations 内 ConfigMaps / Secrets 入口 | 08/24 | ✅（只读列表，编辑走资源页签） |
| 4.11 | 管线编辑抽屉（前置 / 主阶段 / 后置） | 09 | ✅（主阶段可编辑，前后置为范围说明） |
| 4.12 | 构建发布图：顶部流水线名称下拉快速切换 | 05/10 | ✅ |
| 4.13 | 构建发布图：节点 ⋮ 支持编辑流水线 / 历史 | 10 | ✅ |
| 4.14 | 流水线模板仅保留「源码构建部署」「镜像部署」两种 | 05 | ✅ |

## 5. 平台与横切

| # | 功能点 | 现状 |
| --- | --- | --- |
| 5.1 | 操作记录 / 设置（成员、集群、环境、凭据、仓库） | ✅ |
| 5.2 | 登录 + mock 会话 | ✅ |
| 5.3 | 全局搜索（应用/集群/项目，/ 聚焦） | ✅ |
| 5.4 | Chart Store / 应用模板 | ❌ 已标注延期 |
| 5.5 | DORA / 成本报表 | ❌ 缺数据源 |

## 清理计划（按优先级）

| 批次 | 内容 | 状态 |
| --- | --- | --- |
| B1 | 2.5 Jump to Kind、2.6–2.12 按 Kind 列、3.4 Logs 容器/previous/行数/暂停 | ✅ 已完成 |
| B2 | 1.7 Monitoring 区块、1.15 Log Analyzer 容器/Live、2.16 Create Resource 抽屉化 | ✅ 已完成 |
| B3 | 4.7 基础配置 YAML 双模式、5.3 全局搜索 | ✅ 已完成 |
| B4 | Chart Store、DORA/成本 | 延期 |

## 6. 业务交互补全（对照 devtron-dashboard 源码二次盘点）

参照：ppDetails/sourceInfo/EnvironmentSelector、RotatePodsModal、ScaleWorkloadsModal、k8Resource/nodeType/PodPopup、NodeDelete、
odeDetail

| # | 交互 | Devtron 出处 | 现状 |
| --- | --- | --- | --- |
| 6.1 | Restart workloads（勾选工作负载后重建 Pod） | RotatePodsModal | ✅ |
| 6.2 | Hibernate / Unhibernate（副本缩 0 / 恢复） | ScaleWorkloadsModal | ✅ |
| 6.3 | Delete release（输入应用名二次确认） | EnvironmentSelector | ✅ |
| 6.4 | Pod 行 ⋮：Check vulnerabilities（CVE 列表） | PodPopup | ✅ |
| 6.5 | Pod 行 ⋮：View Events / View Container Logs / Delete | PodPopup | ✅ |
| 6.6 | 工作负载行 ⋮：重启 / 扩缩容 | k8Resource 行操作 | ✅ |
| 6.7 | 节点行 ⋮：Cordon / Uncordon、Drain | nodeDetail | ✅ |
| 6.8 | 资源行 ⋮：查看日志（Pod） | k8Resource | ✅ |
| 6.9 | 外部监控 Links 列（Grafana/Kibana 等） | NodeLevelExternalLinks | ⏸ 依赖环境外链配置，暂不做 |
| 6.10 | 应用级 Notes 抽屉（编辑说明） | NotesDrawer | ⏸ 待确认是否需要 |
| 6.11 | 资源列表批量勾选 + 批量删除 | NodeDelete 批量 | ⏸ 待确认是否需要 |
| 6.12 | 应用列表 Clone / Delete app | app 列表 | ⏸ 待确认是否需要 |