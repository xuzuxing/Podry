# 不同镜像版本升级与历史配置回滚

2026-11-22 后续：业务 Secret 历史恢复已在新目标完成真实验证，SecretRef v1 → v2 → v1，回滚时凭据当前版本 v3 保留；首个 Secret 目标升级仍 pending/unknown，详见 [结果与边界](35-live-secret-history-rollback.md)。本文下方保留此前无业务 Secret 的验收时点。

日期：2026-11-22。新测试目标 `podry-demo-rollback` 已通过真实旧版发布 → 新版升级 → 历史快照回滚，Helm revision 1 → 2 → 3。升级前后 Git SHA 和镜像 digest 均不同；回滚恢复旧 digest、归档 Chart 1.0.0、一个副本及旧环境变量，实际 Pod 与 HTTP 核对通过。证据见 [公开摘录](evidence/2026-11-22-version-upgrade-rollback.json)。

本批修复 Helm 单步重复 Discovery 的性能问题，新增 [可续跑回滚验收器](../../scripts/test-cicd-rollback-live.mjs)；未修改前端、开发数据库、默认执行开关，未提交或推送主仓库。仍有两个历史 unknown 发布保留占用，不能把本次新目标成功描述为它们已恢复。

## 示例版本与真实构建

给 [示例 router](../example/podry-demo/internal/server/router.go) 增加 `/version`，默认 dev，由 Dockerfile 的 `APP_VERSION` 经 Go linker 注入。测试仓库独立分支 `podry-live-upgrade-20261122` 只更新 router 和 Dockerfile；main 保持原 SHA，没有此接口。新版 buildArgs 设置 `APP_VERSION=live-v2`，因此可用真实响应区分二进制。`/ping` 与 embed 首页保持可用。

| 版本 | Git SHA | Artifact / 镜像 digest |
| --- | --- | --- |
| 旧版 | `d63cda0d80dd31829b88b281fdc6a8362c06a6f0` | `9e82f21c-b65d-4d9f-915e-2ddd65770a46` / `sha256:7bb647dade725b06faeeba2df326be0339a8423b151a02109e599c79b7282e71` |
| 新版 | `6b67938cce173480758eb117ae8c65492a6ce0a8` | `570602ee-ca55-4352-a3cd-5e19d0f530d3` / `sha256:0854f257cde81a5d0f8e84a2d2135e02e88a5df54ffea5cb6f3a7ccbde0f0b4c` |

新版 Build `2a8b34ec-372d-4e71-bba7-3c069bc43654` 真实执行 Gitea → Job → BuildKit → Registry，成功产生第二个 Artifact；旧 Artifact 来自 [此前自动部署验收](32-live-auto-deploy-and-promotion.md)。两个产物均核对 Registry 原始 manifest 摘要、blob 可读、runner 终止结果、Pod UID 与归档日志。本次后续晋级、升级与回滚都复用这两个 Artifact，没有重复构建。

## Discovery 超时与修复

第一次将新版自动发布至原 `podry-demo-auto` 时进入 unknown：Deployment `6ab5a26c-80aa-4782-b792-0410abbc8051`，errorCode=release_resource_identity_conflict。只读查询显示 release 仍为 revision 1、旧版 Pod 仍运行，没有 revision 2 Secret；这些观察不能证明请求从未产生任何写入。

用准确归档 Chart/Values、相同 20 秒 context 和 8 秒 HTTP 时限执行 Helm upgrade server dry-run，并在诊断 Transport 拒绝所有非 GET/HEAD 请求。诊断复现反复读取 `/api`、`/apis`，最终构建新清单时超时。原 getter 每次 ToDiscoveryClient/ToRESTMapper 都创建新缓存；Helm upgrade 多次 Build 重复发现 API。只在同一提交步复用 Discovery 和 RESTMapper 后，相同只读诊断通过，没有延长业务时限或放宽资源身份检查。

`internal/release/helm.go` 的 newGetter 现在为单次 action.Configuration 共享缓存；下一次 worker step 仍创建新实例，沿用该步的凭据和 context，不缓存跨步权限或延长 lease。现有传输层继续禁止 context 取消后的请求。新增单元测试通过真实 HTTP Discovery 与 Kubernetes manifest Build，验证每步三次 Build 仅发现一次 API；第二步重新发现，且没有写请求。

release 单元测试通过后，仅优雅更新独立测试 API 二进制。三个隔离 PostgreSQL 定向集成用例及脚本包含的 vet/build/Linux 编译通过：FrozenSecretsSuccessAndHistory、TargetSerializationAndUnknownRecovery、RollbackHistoricalJobAndWorker。未重跑全量 Go 集成；这些 fixture 结果与后续真实执行分别记录。

原 unknown 不重新提交、不改 SQL 状态或清占用。创建第三个手动非生产环境绑定 `72dbfd37-d36e-4e39-ab40-c460bacc858d`，在相同应用/namespace 中使用新 release `podry-demo-rollback` 完成验收。

## 新目标的发布与回滚

| 阶段 | Deployment | Helm / Chart | 配置 / 绑定版本 | 实际配置与 HTTP |
| --- | --- | --- | --- | --- |
| 旧 Artifact 晋级 | `fae6e208-523a-4b54-a6dc-5a5578392ff0` | 1 / 1.0.0 | 7 / 1 | 一个副本，APP_RELEASE=v1，PODRY_TEST_ENV=rollback-v1；/version 404 |
| 新 Artifact 手动升级 | `cd4f7ba0-01af-4902-922a-96f8492793b1` | 2 / 1.1.0 | 8 / 2 | 两个副本，APP_RELEASE=v2，PODRY_TEST_ENV=rollback-v2；两个 Pod 的 /version 均为 live-v2 |
| 从第一条历史发布回滚 | `2b008fa0-d75c-42a3-9cc6-8677189609eb` | 3 / 1.0.0 | 7 / 1 | 一个副本、旧 digest、全部历史 Values；/version 404，/ping 200 pong |

首次通过 promote 复用旧 Artifact，采用目标当前配置 v7，未复用原环境目标；升级使用新 Artifact，预览/确认采用配置 v8。修正通用验收器的手动分支：使用已有 Build 时，发布 expectedConfigVersion 应冻结当前应用配置，不能误用 Artifact 的构建配置版本。证据分别记录 build.configVersion 和 releaseConfigVersion。

回滚调用 `POST /api/deployments/{历史 Deployment}/rollback`，来源是第一条成功发布。请求 kind=rollback，sourceDeploymentId 指向该历史发布，新 Request/Deployment 身份不同；没有调用 Helm CLI rollback 或直接修改 Kubernetes 工作负载。

只读解码三份 Helm release Secret 后核对：历史 Chart 包摘要为 1.0.0 → 1.1.0 → 1.0.0，回滚包摘要与第一份一致；回滚的完整业务 Values 和 Chart 内容与第一份严格相等。平台 deploymentId、snapshotSHA256 等执行身份按新发布生成，不拿身份字段差异冒充业务配置差异。

工作负载核对镜像、replicas、观察 generation、Ready 数量和全部普通 env；按本次 deployment-id 过滤非删除中的 Pod，逐个验证实际 imageID、`/version` 和 `/ping`，并再次检查 Service 响应。证据不保存 Helm Values 原文，只保留摘要、环境变量名称及必要身份；本例没有业务 Secret 引用。

回滚恢复的是历史运行快照。当前应用配置仍为 v8，binding 仍为 v2，Git 分支、APP_VERSION=live-v2 与最新环境覆盖没有被改回；currentDeploymentId 指向成功回滚。下一次人工触发新构建或发布会使用当前配置，不能把发布回滚当作源码或配置编辑器回退。

## 验收器与幂等续跑

先用 [通用验收器](../../scripts/test-cicd-live.mjs) 在同一手动 binding 完成两个版本，保留两个成功 output。回滚工具专用于 podry-demo 版本夹具：旧版 /version=404、新版为指定纯文本标记；要求同应用/绑定、不同 Build/SHA/digest、按时间递增的 Helm revision。

```powershell
# Token 仅从 PODRY_LIVE_TOKEN 环境注入；替换成本次环境自己的路径和身份。
node --use-system-ca scripts/test-cicd-rollback-live.mjs `
  --api http://127.0.0.1:15000 `
  --baseline D:/Temp/podry-live-cicd-20261122/acceptance-version-baseline.json `
  --upgrade D:/Temp/podry-live-cicd-20261122/acceptance-version-upgrade.json `
  --upgrade-version live-v2 `
  --kubeconfig docs/k3s.yaml --insecure-kubernetes `
  --output D:/Temp/podry-live-cicd-20261122/acceptance-version-rollback.json
```

首次执行先核对当前成功升级、两个 Pod 的版本与实际业务配置，再持久化准入证据和幂等键，最后请求回滚。原 output 续跑复用相同 key/Request/Deployment，不重复升级，也不因 unknown 新建请求。观察阶段最长 900 秒，超时保留证据供核对；启动后不依赖本机 kubeconfig 的凭据进入后端，kubectl 只用于本机验收读取。

同 output 第二次执行通过，passes=2。按应用范围只读查询，续跑前后均为 2 Build / 2 Attempt / 2 Artifact / 2 Intent / 6 Request / 6 Deployment。六次发布包含此前自动发布、预发晋级、本次较早 unknown、新目标的旧版晋级/新版升级/回滚；不能把全部六条当作成功。本次没有强杀、丢包、提交响应丢失或多实例故障注入。

## 保留状态与剩余范围

- `podry-job-live`：较早 Job Deployment `ab649289-cfbe-4b2d-b9f4-7a30a1f36ae2` 仍 unknown 且占用目标。
- `podry-demo-auto`：本次较早自动升级 `6ab5a26c-80aa-4782-b792-0410abbc8051` 仍 unknown 且占用目标；原 revision 1 继续运行。
- `podry-demo-rollback`：当前 revision 3 / Chart 1.0.0 / 旧镜像 / 一个副本，成功回滚。
- 原 `app.podry.dev` 未重新发布，正常 DNS 与 TLS 校验的 HTTPS `/ping` 仍为 `200 pong`。

脚本语法/help、真实构建与三个发布步骤、回滚幂等续跑、文档/链接/编码/秘密与空白检查已通过。T23 仍需真实响应丢失/强杀/部分写入/凭据轮换撤权/新 UID/目标并发等矩阵；业务 Secret 历史版本恢复、unknown 核对处置、GitLab/Gitea Webhook、持续健康、T24 生产恢复与安全 GC 仍待开发或验收。T23/B6 未整体结项。
