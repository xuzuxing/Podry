# 新应用实测、完整流水线与缺口补齐

日期：首次 2026-11-19，补拍 2026-11-20，Asia/Shanghai。入口：[44 张截图画廊](gallery.html)、[直接查看新增 27–44](gallery.html#step-27)、[路由/变更/哈希索引](manifest.json)、[当前原型](../../prototype/index.html)、[页面规格](../../prototype/01-page-spec.md)。前一轮 [27 张只读截图](../devtron-live/README.md) 是另一批证据，其“未保存”边界不适用于首次新建应用操作。

## 2026-11-20 补拍：构建、选镜像、发布与资源

原画廊只到 26，25/26 是前一天的 Git 超时和首次无镜像，后续页面当时没有采集。本次登录原测试应用 `podry-hello-world #4`，新增 **18 张现场截图（27–44）**，保留原图和原编号，不用新状态覆盖历史记录。

进入时完整工作流 CI #4 已显示成功。构建记录中的 **build #6** 使用 `master / 522bcd2`，产物为 `registry.xuzuxing.cn/podry/hello-world:522bcd2f-4-6`，镜像选择页同时能看到 `522bcd2f-4-5`。Git 提交现已可以加载；本次没有触发新构建。

访问期间，已有 CD #3 部署记录先显示 **In progress**，随后转为 **Succeeded**；页面显示触发时间 **2026-11-20 11:25**、完成时间 **11:28**。应用资源页显示 **1 个健康 Job、2 个 COMPLETED Pod**，日志包含 `Hello from Docker!`，事件包含所选镜像的拉取与容器启动。以上是本次实际页面观察；本次没有点击 Deploy，不能仅凭页面的 `admin` 名称推断执行来自本轮或某个具体操作者。

| 截图 | 补充内容 |
| --- | --- |
| [27](27-current-workflow-build-succeeded.png)、[28](28-material-recovered.png) | 当前构建成功画布、Git 提交恢复加载与可用的 Start Build |
| [29](29-final-ci-artifacts.png)、[30](30-final-ci-logs.png)、[31](31-final-ci-source.png) | 完整 CI 的产物、无归档日志提示、代码来源 |
| [32](32-select-image-available.png)、[33](33-image-source-info.png) | 可选镜像、展开镜像提交信息 |
| [34](34-deployment-review-config.png)、[35](35-deployment-review-manifest.png) | REVIEW 配置对比、Manifest Output |
| [36](36-deployment-history-source.png)、[37](37-deployment-history-config.png) | 部署进行中来源、随后成功的配置记录入口 |
| [38](38-app-details-completed-pods.png)、[39](39-app-job-completed.png) | 发布成功的应用详情、已完成 Pod 与健康 Job |
| [40](40-pod-hello-world-logs.png)、[41](41-pod-events.png)、[42](42-pod-manifest.png) | Pod 日志、事件、只读 Manifest 首屏 |
| [43](43-deployment-history-succeeded.png)、[44](44-workflow-build-deploy-succeeded.png) | 成功部署的来源追溯、Build 与 Deploy 均成功的最终画布 |

预览 Manifest 中仍显示 `IMAGE_REPO:IMAGE_TAG` 占位，不能当作已提交资源的镜像身份；实际镜像 tag 由部署历史与 Pod 事件交叉确认。本次未验证远程 digest、回滚、跨环境发布或终端。Pod 日志是样例程序固定输出，不能用其中介绍 Docker 的文字推断集群执行时实际运行过 `docker run`。

## 2026-11-19 首次远程结果（历史记录）

已在用户测试 Devtron 中创建并保留 `podry-hello-world`，应用 ID **4**，项目 **default**。最终通过用户指定的 **Build & Deploy from Source Code** 模板创建完整工作流：

```text
应用：podry-hello-world #4
工作流：wf-4-lxij #5
Git hello-world / master
  → Build：ci-4-8m9v #4，MANUAL
  → Deploy：CD #3，default 环境，MANUAL
    → default_cluster / default Namespace
```

保存了公开 Git 仓库、构建配置、基础 Chart、完整 CI/CD 定义；没有修改既有 beaconix 应用或共享 Registry/Cluster 设置。构建配置为 Registry `registry`、Repository `podry/hello-world`、Dockerfile `amd64/Dockerfile`、Context `amd64`。Devtron 的目标平台未显式设置，采用 CI 节点平台；不能将其写成已验证的多架构构建。

基础 Chart 选择 `Job & CronJob 1.6.0`，仅保存配置，未渲染或执行应用发布。该 Chart 的默认参数和真正执行结果没有通过集群验收，不能据名称认定已经成功运行一次性 Job。

初始探索误选了仅构建模板，创建 CI #3 并运行 build #3，结果 **Succeeded**，产物 tag 为 `registry.xuzuxing.cn/podry/hello-world:522bcd2f-3-3`。用户指出缺 Deploy 后，实际改用完整模板建立工作流 #5，并删除本次创建的临时 CI #3 / 工作流 #4。仅构建流程的截图保留为过程证据，不能作为最终设计或最终工作流执行成功的证明。删除后的历史接口可用性未再检查。

当日最终 CI #4 查询 Git 提交时出现 `curl 28` / `github.com:443` 连接超时，Start Build 被禁用；因此当日没有发起第二次构建。CD #3 的 Select Image 显示 **No Image Available**，要求先运行该 CI。当日没有点击真实 Deploy，未验证最终工作流的端到端发布，也没有在真实集群验证应用 Job Complete、晋级或回滚。截图 23/24 是当日最终完整配置，25/26 是执行前阻塞，16 仅属于已替换的初始 CI。2026-11-20 的后续观察见上方补拍记录。

## 仓库核对

通过 GitHub 官方 REST / raw 内容只读核对：

- [仓库信息](https://api.github.com/repos/docker-library/hello-world)：default_branch 为 master。
- [amd64 目录](https://api.github.com/repos/docker-library/hello-world/contents/amd64)：包含 Dockerfile 与已提交的 hello 二进制。
- [Dockerfile](https://github.com/docker-library/hello-world/blob/master/amd64/Dockerfile)：FROM scratch、COPY hello /、CMD /hello；构建上下文必须使 hello 文件位于 COPY 根目录。

这次没有修改 Git 仓库。hello-world 用于展示一次性容器运行，不是常驻 HTTP 服务。Podry 新增的 Job 应用模板服务于这个部署场景；CronJob 调度、Devtron 的 Create Job 工作流平台仍为后续范围。

## 发现及补齐

下表“补齐”指本地原型和设计文档。它们没有接入 Podry 业务后端。

| 缺口 | 现场依据 | 本次结果 |
| --- | --- | --- |
| 新应用被当作已配置应用 | 02、07 | 新建无 CI/CD/环境；0/4 引导、前置条件锁、直达路由校验 |
| 首次 Git 交互不符 | 02、03 | 首条内嵌表单，Git Account / HTTPS，保存后卡片与 Next |
| 保存和下一步混在一起 | 03–07 | Git Save/Next、Build Save & Next、Base Save & Next 分开推进 |
| Dockerfile/Context 默认不适用于样例 | 04、11 | 构建路径显式填写，相对根目录、禁止越界，目标平台明确 |
| 持续服务与一次性任务混淆 | 05、06 | 基础模板支持 Deployment / Job，首次保存锁定类型；Job 等待 Complete |
| 没有 New Workflow 空态 | 07、08 | 空工作流→模板选择→右侧创建表单 |
| 把仅构建当完整流程 | 19、23、24 | 主模板为 Build & Deploy from Source Code，一次创建 CI + Binding + CD |
| 环境自动出现、目标关联不明确 | 09、10、13、21 | 必选环境，Namespace/Cluster 关联，只按已建 CD 显示覆盖入口 |
| 创建后没有下一步引导 | 22 | 成功弹窗引导 Build & Deploy / Environment Override |
| Git 错误仍能构建 | 25 | 错误、空提交、搜索无结果区分；无有效选中提交禁止 Start Build |
| 新部署可选到旧/其他应用的镜像 | 26 | 初次 No Image Available；镜像限定当前应用；隐藏项不保留为选中值 |
| 无历史日志被误解为构建失败 | 16、17 | Build 结果、Artifact、logAvailability 分离；Demo 支持 runtime-only |
| 保存整份配置可能覆盖未配置部分 | 页面多次独立保存 | ConfigInput 按 section 合并为新版本；Base 显式保存事实由 chartConfig 区分 |
| 完整模板可能留下半个工作流 | 完整模板一体表单 | 新增原子模板接口与事务设计，失败不留下 CI/Binding/CD 残片；尚无数据库执行证明 |

## 对应交付

- [产品说明](../../product/01-product-spec.md)：首次引导、完整模板、一次性 Job 与执行资格。
- [页面规格](../../prototype/01-page-spec.md)：内嵌首条 Git 表单、进度、模板弹窗、创建抽屉、成功引导、错误状态。
- [接口文档](../../api/01-api-spec.md)：setup、workflow-templates、分节配置保存、Git/日志错误。
- [数据模型](../../data/01-data-model.md)：chart_config、派生进度、物理目标、模板事务与 Job 身份。
- [技术架构](../../architecture/01-architecture.md)：模板创建事务、Job 发布观察和 Git 获取边界。
- [浏览器检查结果](../../delivery/prototype-check.json)：仅本地模拟；完整创建、构建、部署链路和异常状态。

## 使用原型复现主要路径

1. Create → Custom app，填应用名并创建。
2. Git 页面点击 Use hello-world sample，Save，再 Next。
3. Build 填 Dockerfile=`amd64/Dockerfile`、Context=`amd64`、Target platform=`linux/amd64`；Save & Next。
4. Base 的 Chart 选 Job；Save & Next。
5. New Workflow → **Build & Deploy from Source Code**，确认 branch=`master`，显式选 development，查看关联 Namespace/Cluster；Create Workflow。
6. 成功提示选 Build & Deploy。此时同时有 Build、Deploy 两个节点；先打开 Select Image 可以看到初次无产物。
7. Select Material → 选择模拟提交 → Start Build。需要重现现场问题时，在 Demo 把数据场景设为 offline；设 runtime-only 可模拟成功但历史日志不可用。
8. 返回 Build & Deploy → Select Image → Review → Confirm Deploy → App Details，查看本地 Job Complete / Pod Succeeded。

步骤 7/8 在原型里完全离线，仅模拟业务状态；不能用模拟完成弥补远程 Git 超时或未执行真实发布的证据。

## 观察方法及边界

使用临时隔离的本机 Chrome Headless，通过 CDP 执行真实 UI 点击、读取页面、保存 PNG；不是 REA Evidence。每次采集均使用独立临时认证 profile，并在结束后关闭浏览器、清理 profile。项目不保存账号密码、认证头、Cookie、Token、认证存储或 kubeconfig。截图只保留页面可见业务信息、公开 Git 提交元数据，以及本次测试 Pod 的日志、事件和 Manifest 首屏；未采集网络响应正文。

首次新建应用曾触发真实 CI，会创建 worker 资源，因此 2026-11-19 操作不能称为纯只读；写操作限于这个新测试应用及其临时流水线。2026-11-20 补拍只读取已有执行与资源，没有触发构建、发布、回滚、保存配置或远程终端。两轮均未通过 Resource Browser 执行资源写操作。所有截图、路由、尺寸、SHA-256、新增图的采集时间和远程变更边界列在 manifest。
