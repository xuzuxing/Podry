# 真实自动部署与跨环境晋级

后续状态（2026-11-22）：本应用继续进行[不同版本升级与回滚验收](33-live-version-upgrade-and-rollback.md)，当前基础配置已到 v8。原自动目标的一次后续升级仍 unknown、保留占用；新增第三个手动绑定完成升级/回滚。本文件记录的是此前 v3/两个绑定的成功快照，不能按旧数量或当前发布指针重复生成其历史证据。

日期：2026-11-22。独立测试 API、PostgreSQL v17 与 `podry-cicd-live` 命名空间中，已通过真实 Gitea → Job → BuildKit → Registry → Artifact → 非生产自动部署，再将同一 Artifact 晋级到另一个非生产环境。两个 Helm release 均 deployed、Pod Ready，Service `/ping` 返回 `200 pong`，embed 首页为 200。公开证据见 [验收摘录](evidence/2026-11-22-auto-deploy-promotion.json)。

这是两个环境绑定在同一集群、同一 namespace 中的发布验收；不代表跨集群隔离、不同版本回退或 T23/B6 全部完成。原 `app.podry.dev` 应用未改配置或重新发布，本次两个新 release 均不创建公网 Ingress。

## 配置与真实结果

沿用 [基础验收](29-live-cicd-acceptance.md) 的测试项目、Git/集群凭据、Registry、namespace grant、BuildKit 和固定 digest runner。创建独立应用 `podry-demo-auto`，基础配置 v3、Chart 1.1.0、Deployment、Service port 80，镜像仓库 `podry-live/podry-demo-auto`。两条 CD 在构建前均已保存，workflowVersion=2；配置保存没有启动构建或发布。

| 对象 | 结果 |
| --- | --- |
| 应用 | `ab5637b3-a81a-483f-906e-37c304178c63` |
| Build / Attempt | `d9af03c9-1af9-4531-91d3-a531293aa905` / 1，succeeded |
| Git main SHA | `d63cda0d80dd31829b88b281fdc6a8362c06a6f0`，由 resolvedRef 冻结 |
| Artifact | `9e82f21c-b65d-4d9f-915e-2ddd65770a46`，source=build |
| 镜像 digest | `sha256:7bb647dade725b06faeeba2df326be0339a8423b151a02109e599c79b7282e71` |
| 自动开发环境 binding | `f2352d05-9d87-4d9d-a6ae-94e9de7859b5`，release `podry-demo-auto`，revision 1 |
| 自动 Deployment | `d93568b2-a110-45b4-827b-163ed03954ca`，succeeded |
| 手动预发环境 binding | `95466e1a-ede7-43de-900f-b759ee162c72`，release `podry-demo-staging`，revision 1 |
| 晋级 Deployment | `09d02d2a-26d5-4652-8e30-15ceabe34b8a`，succeeded，kind=promote |

自动环境显式设置 `production=false, autoDeployAllowed=true`，binding.autoDeploy=true，CD 启用 `on_ci_success` 并明确关联同应用 CI。构建准入立即观察到 waiting 意图；成功后原意图 dispatched，自动产生唯一 ReleaseRequest。验收器在此路径没有调用手动预览或发布确认接口。数据库只读核对 configVersion=3、workflowVersion=2、CI/CD/binding version=1；委托用户与保存工作流的授权用户、发布请求者一致。

自动发布后，通过 `POST /api/deployments/{sourceId}/promote` 请求另一个环境。目标环境为非生产、autoDeployAllowed=false，绑定和 CD 均保持手动。晋级使用同一 Artifact/digest，sourceDeploymentId 指向成功的自动发布，没有新建 Build 或 Attempt。两个绑定分别覆盖 `env.PODRY_TEST_ENV=development/staging`，真实 Deployment 中的环境变量不同，镜像相同；两个 binding 的 currentDeploymentId 分别指向各自成功发布。

Registry 原始 manifest 字节摘要、HEAD blob、runner 终止结果与 Artifact 一致；构建 Job/Pod UID 与退出码核对通过，日志 archived。只读解码 Helm release Secret，核对 Chart 1.1.0、revision 1、deployed；证据只保留必要字段，没有输出 Secret 原文或完整 Values。Pod 实际 imageID 与 Artifact imageRef 相同。HTTP 使用本地 Service port-forward，未测试这两个新应用的公网访问。

## 复现与续跑

先按 [自动部署合同](24-ci-auto-deploy.md) 创建允许自动部署的非生产环境，保存 Git/Build/Base 三节配置，再使用 `build_deploy` 模板：

```json
{
  "template": "build_deploy",
  "expectedConfigVersion": 3,
  "expectedWorkflowVersion": 0,
  "ci": {"manual": true, "push": false, "branch": "main", "webhookCredentialId": null},
  "deployment": {
    "binding": {
      "environmentId": "<显式允许自动部署的环境 UUID>",
      "target": {"clusterId": "<集群 UUID>", "namespace": "podry-cicd-live", "releaseName": "podry-demo-auto"},
      "overrideValues": {"env": {"PODRY_TEST_ENV": "development"}},
      "autoDeploy": true
    },
    "definition": {"triggerMode": "on_ci_success", "upstreamPipelineId": null, "deployTimeoutSeconds": 600}
  }
}
```

模板在同一事务解析上游 CI。创建第二个非生产手动环境，使用 `add_deploy` 模板、当前 expectedWorkflowVersion，省略 ci，设置新 environmentId/releaseName、autoDeploy=false、triggerMode=manual，并覆盖 staging 环境变量。所有配置在触发 Build 前完成，避免整个工作流版本变化使原自动意图失效。模板响应 bindings 包含所有绑定，按 environmentId 选择新增绑定。

已扩展 [可续跑验收器](../../scripts/test-cicd-live.mjs)，支持自动部署和来源晋级，继续复用 Registry、Job、Pod、日志和 HTTP 核对：

```powershell
# PODRY_LIVE_TOKEN 由当前进程环境注入，不写实际值到命令或仓库。
node --use-system-ca scripts/test-cicd-live.mjs `
  --api http://127.0.0.1:15000 `
  --app ab5637b3-a81a-483f-906e-37c304178c63 `
  --binding f2352d05-9d87-4d9d-a6ae-94e9de7859b5 --auto-deploy `
  --kubeconfig docs/k3s.yaml --insecure-kubernetes `
  --output D:/Temp/podry-live-cicd-20261122/acceptance-auto.json

# 上一条全部通过后，复用其 Build 和自动 Deployment，向手动 binding 晋级。
node --use-system-ca scripts/test-cicd-live.mjs `
  --api http://127.0.0.1:15000 `
  --app ab5637b3-a81a-483f-906e-37c304178c63 `
  --binding 95466e1a-ede7-43de-900f-b759ee162c72 `
  --build-id d9af03c9-1af9-4531-91d3-a531293aa905 `
  --promote-from d93568b2-a110-45b4-827b-163ed03954ca `
  --kubeconfig docs/k3s.yaml --insecure-kubernetes `
  --output D:/Temp/podry-live-cicd-20261122/acceptance-promote.json
```

这些 UUID 和 output 属于本次测试实例；新环境替换成自己的对象。相同 output 才是续跑；换 output 的自动路径会创建新 Build。`--auto-deploy` 不调用手动确认，`--promote-from` 强制要求 --build-id 和手动目标，不能与自动模式混用。原手动模式及旧证据仍可使用；续跑不得更换 API、应用、绑定、模式或来源。证据文件应保存在仓库外。

自动模式先保存准入参数与幂等键，再提交构建；准入后立即核对持久意图，重复原构建请求返回同一 Build。派发后只读取其 requestId/Deployment，不因 unknown 或等待超时创建替代任务。晋级先核对成功来源、应用、Artifact、镜像及不同 binding，持久化目标配置版本，再按原幂等键提交；续跑要求返回原 Request/Deployment。

## 重启与幂等证据

两次发布完成后优雅 stop/start 独立 API。启动过程中首次续跑遇到 fetch failed；待 `/readyz=200` 后，沿原 output 顺序续跑自动路径与晋级路径，均再次通过。没有删除旧证据、创建新 Attempt 或重发 Helm。两份验收记录 passes 均为 2。只读查询本应用的记录数量，重启前后完全相同：

| 记录 | 重启前 | 续跑后 |
| --- | --- | --- |
| Build / Attempt / Artifact | 1 / 1 / 1 | 1 / 1 / 1 |
| 自动部署意图 | 1 | 1 |
| Preview / Snapshot | 2 / 2 | 2 / 2 |
| ReleaseRequest / Deployment | 2 / 2 | 2 / 2 |

两条内部 Preview 分别来自自动准入和晋级业务，不是额外的手动确认。该观察证明已成功业务的持久身份与幂等续跑；没有注入准入事务中断、提交响应丢失、进程强杀或多实例并发，不能宣称这些恢复场景已通过。

原 Job 发布 `ab649289-cfbe-4b2d-b9f4-7a30a1f36ae2` 仍 unknown，`podry-job-live` 的 activeDeploymentId 仍指向它。没有修改历史状态或清除占用。原手动 Ingress 验收文件缺少新模式字段，沿原文件续跑仍通过，使用原 Build/Deployment，Helm revision 保持 3；正常 DNS/TLS 访问 `https://app.podry.dev/ping` 为 `200 pong`。默认四个后台开关和开发数据库未修改；只有独立 API 启用构建/发布。无新增 Go 业务修改或数据库迁移，没有重跑全量 Go 集成；本批验证为脚本语法/help、真实链路/重启续跑、旧手动模式兼容性、文档链接、编码/秘密与差异空白检查。

后续优先验证不同 digest 升级及完整历史配置回退、T23 故障/权限矩阵和 unknown 核对；Gitea/GitLab Webhook、持续健康真实验收、T24 生产恢复与安全 GC 仍待开发或验收。未修改前端、未暂存/提交/推送主仓库。
