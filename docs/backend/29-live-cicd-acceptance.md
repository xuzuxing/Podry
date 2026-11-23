# 真实 CI/CD 验收与复现

后续更新：按用户要求，公网入口已改为通过完整 CI/CD 和 Helm 发布，Chart 1.1.0 / Helm revision 3；手工 Ingress 已撤掉。当前结果见 [Ingress 随 Helm 发布](30-ingress-helm-release.md)。本页其余内容保留前两轮验收及随后手工入口验证的历史记录。

日期：2026-11-22。正式数据库基线 v17，OpenAPI V1.22.0。本轮在独立 PostgreSQL/API 实例及专用 Kubernetes namespace 中，完成两轮 **Gitea → Kubernetes Job → BuildKit → Registry → Helm Deployment** 真实链路。没有修改 Go 业务源码、开发数据库、默认后台开关或前端，也没有提交或推送 Git。

公开证据摘录见 [2026-11-22-cicd-live.json](evidence/2026-11-22-cicd-live.json)，可续跑的验收入口为 [scripts/test-cicd-live.mjs](../../scripts/test-cicd-live.mjs)。证据来自真实构建产物，没有导入 fixture Artifact。下列结论不代表 T23 故障矩阵、B6 或生产验收整体完成。

## 实际结果

| 检查 | 结果及边界 |
| --- | --- |
| Git | 从用户 Gitea 仓库读取 main 的真实提交，冻结完整 SHA；Job ConfigMap 输入与 Build/Attempt/App 身份一致 |
| CI | 两个 Build 各一个 Attempt、一个 Job；源码 init container 与 build container 均 exit 0；受控 runner 按 digest 固定，termination result 与 Artifact 一致 |
| Registry | BuildKit 真实推送；后端复核 digest；验收器另读原始 manifest 计算 SHA-256，检查子 manifest 及 config/layers 的 HEAD 响应 |
| CD | 第一轮 Helm install，第二轮 upgrade；同 release 的 revision 分别为 1、2，第二轮为 deployed |
| 工作负载 | Deployment 1/1 Ready；实际 Pod imageID 与 Artifact 完整 imageRef 一致 |
| HTTP | 通过临时 localhost port-forward 访问 ClusterIP Service：GET /ping 为 200 pong；GET / 为 200，包含 embed 页面 podry-demo。没有验收公网应用 Ingress |
| 观察与追溯 | Build、Artifact、Request、Deployment 和 binding 当前发布指针可追溯；应用资源与实时 Diff 接口读取成功。没有注入漂移或验收后台持续巡检 |
| 日志 | 两轮日志均 archived；NDJSON 含 log/end，无 error；分别读取 87/47 条日志帧。未等待七天归档过期 |
| 构建进程恢复 | 第一轮构建在运行时优雅 stop/start 独立 API 容器；恢复沿用同 Attempt 和 Job UID，最终成功。没有验证强杀或提交响应丢失 |
| 验收器续跑 | 第二轮成功后用同一证据文件续跑，仍通过；数据库保持 builds=2、attempts=2、artifacts=2、release_requests=2、deployments=2，Helm 保持 revision 2 |

两轮源提交均为 `d63cda0d80dd31829b88b281fdc6a8362c06a6f0`，镜像内容相同，因此第二轮证明重新构建及 Helm upgrade 路径，不证明应用版本变更或回滚。

| 对象 | 第一轮 | 第二轮 |
| --- | --- | --- |
| Build | `35d7f068-cb4d-4c82-8fc6-c6b45b7d7fce` | `cbd84d0c-102e-4474-bf08-d070fdc44b50` |
| Attempt | `cbdfa9f0-8c30-4ddf-9691-2f7fdb99c089` | `487806c8-47c0-4790-bd1a-5203e0764ecd` |
| Job UID | `17f8303d-4e4f-4b57-8e1f-8141d4b07a40` | `6128244b-0e6a-4c55-a012-4db10a6fc1a3` |
| Artifact | `ba7d99a4-5599-46e1-a828-5339ef327d84` | `301bf1c0-e417-4c4d-a909-a7a06e5b6649` |
| Deployment | `43568b48-c35e-4efc-b852-e321eb5376b5` | `7208662c-01ff-4411-ae0f-62014363ea4f` |
| Helm revision | 1（后续 superseded） | 2（deployed） |

应用镜像为 `registry.podry.dev/podry-live/podry-demo@sha256:7bb647dade725b06faeeba2df326be0339a8423b151a02109e599c79b7282e71`；真实执行使用的 runner 为 `registry.podry.dev/podry-live/runner@sha256:fecc5d048bd3d2041a67d156ed27719cbaa55b4b28ff20d84ee483dc46342309`。

## 隔离环境与保留资源

| 项目 | 本次值 |
| --- | --- |
| 后端基线 | 后端提交 b463fe6；工作树 HEAD 在并行前端提交后为 0664d55 |
| PostgreSQL | 16.15，独立数据库，显式迁移至 v17，CLI 创建随机管理员 |
| Go / Gitea | 1.27.3 / 1.27.0 |
| Registry | Zot，镜像 ghcr.io/project-zot/zot:v2.1.23，匿名测试仓库 |
| Kubernetes | K3s v1.37.2+k3s1；构建与发布使用同一集群、同一 namespace |
| BuildKit / buildctl | v0.35.1；rootless BuildKit 固定镜像 digest |
| Helm SDK / client-go | v3.20.1 / v0.35.1 |
| Namespace / release | podry-cicd-live / podry-demo-live |
| BuildKit endpoint | tcp://buildkit.podry-cicd-live.svc.cluster.local:1234 |
| 独立 API | Docker 容器 podry-cicd-live-api-20261122，监听宿主 127.0.0.1:15000 |
| 独立数据库 / 网络 | podry-cicd-live-db-20261122 / podry-cicd-live-20261122 |
| 本机证据目录 | D:/Temp/podry-live-cicd-20261122 |

保留独立 API、数据库、BuildKit、应用 Deployment、构建 Jobs 及其输入资源供核对。临时目录包含本机密码、Token、环境文件与集群连接信息，不能整体复制、上传或提交。仓库公开摘要仅选取身份、状态、digest、HTTP 和日志数量，不含凭据、日志正文或签名游标。

两个一次性节点 CA helper Pod 为 registry-trust-inspect、registry-trust-setup，均已 Completed；它们可单独删除。不要对未知或仍在执行的构建/发布做自动清理；Job/Secret/ConfigMap 的安全 GC 尚未实现。

## DNS 与各执行端的证书信任

用户修正本机解析并安装公开测试 CA 后，本机可直接访问 Gitea 和 Registry；集群内两个域名经 CoreDNS 指向 Traefik Service。Windows、Node、Linux 后端、runner、BuildKit 和节点 containerd 的 CA 信任分别配置：

- Windows Node 使用 `node --use-system-ca`，也可通过 `NODE_EXTRA_CA_CERTS` 指定公开 CA 文件。独立 Linux 后端使用 `SSL_CERT_FILE` 信任该 CA，并保留容器级域名映射；没有修改系统 hosts。
- runner 的 [Dockerfile](../../tools/cicd-live/runner.Dockerfile) 将公开 CA 追加到系统 bundle，使 git/buildctl 的 HTTPS 请求可验证证书；构建上下文仅放 runner 二进制和公开 CA。
- BuildKit 的 [buildkitd.toml](../../tools/cicd-live/buildkitd.toml) 使用 Registry 专用 CA 路径，挂载公开 CA；未将 Registry 配为 insecure。
- K3s 节点首次拉取真实 runner 出现 x509 unknown authority。只读确认 containerd 的 config_path 后，在此前不存在的 Registry 目录中新增公开 CA 与 hosts.toml，重试后同一 Pod 拉取成功。没有覆盖既有配置或重启节点。

本次节点新增文件：

```text
/var/lib/rancher/k3s/agent/etc/containerd/certs.d/registry.podry.dev/podry-test-ca.crt
/var/lib/rancher/k3s/agent/etc/containerd/certs.d/registry.podry.dev/hosts.toml
```

```toml
server = "https://registry.podry.dev"
[host."https://registry.podry.dev"]
  capabilities = ["pull", "resolve"]
  ca = "/var/lib/rancher/k3s/agent/etc/containerd/certs.d/registry.podry.dev/podry-test-ca.crt"
```

这是本测试节点可撤销的运行时配置；K3s 重新生成配置时可能需要重新应用，**尚未验证节点重启后的持久性**。不要将它视为已完成的生产节点证书管理方案。Kubernetes API 连接单独按此前要求显式跳过 TLS 校验；Git 和 Registry HTTPS 仍验证 CA。

Docker Desktop daemon 仍不信任此测试 CA，直接 HTTPS docker push 实际失败；本轮未重启 Docker 或全局关闭校验。runner 先推至已有本机匿名 Registry，再用临时工具校验并复制 blob/manifest 至目标 HTTPS Registry，最后复核目标 digest。该临时复制工具未作为产品能力交付；下节标准 push 步骤要求 Docker daemon 已信任目标 CA，不能仅以浏览器可访问判断就绪。

## 部署测试 BuildKit 与准备 runner

以下步骤用于可信的专用测试环境。先准备从可信渠道取得的**公开** CA 文件，不使用客户端私钥。以仓库根目录为工作目录，在 PowerShell 中执行：

```powershell
$testCa = 'D:/Temp/podry-live-cicd-20261122/podry-test-ca.crt'
kubectl --kubeconfig docs/k3s.yaml --insecure-skip-tls-verify=true create namespace podry-cicd-live --dry-run=client -o yaml |
  kubectl --kubeconfig docs/k3s.yaml --insecure-skip-tls-verify=true apply -f -
kubectl --kubeconfig docs/k3s.yaml --insecure-skip-tls-verify=true -n podry-cicd-live create configmap buildkit-config `
  --from-file=buildkitd.toml=tools/cicd-live/buildkitd.toml `
  --from-file="podry-test-ca.crt=$testCa" --dry-run=client -o yaml |
  kubectl --kubeconfig docs/k3s.yaml --insecure-skip-tls-verify=true apply -f -
kubectl --kubeconfig docs/k3s.yaml --insecure-skip-tls-verify=true apply -f tools/cicd-live/buildkit.yaml
kubectl --kubeconfig docs/k3s.yaml --insecure-skip-tls-verify=true -n podry-cicd-live rollout status deployment/buildkit --timeout=120s
```

[BuildKit 清单](../../tools/cicd-live/buildkit.yaml) 使用 uid/gid 1000、Unconfined seccomp/AppArmor、no-process-sandbox、关闭自动挂载 SA Token、ClusterIP 和仅同 namespace Pod 可访问的入站 NetworkPolicy。缓存为 6Gi emptyDir，资源限制为 1500m CPU/1Gi 内存。这不是生产多租户隔离、跨 namespace builder 或持久缓存验收；TCP builder 未启用 mTLS。

从本仓库编译受控 runner，创建一个新的、仅放构建材料的临时目录；不要把包含 private.json/state.json 的证据目录作为 Docker context：

```powershell
$runnerContext = Join-Path ([IO.Path]::GetTempPath()) ('podry-runner-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $runnerContext | Out-Null
$savedGoEnv = @{}
foreach ($name in 'GOOS','GOARCH','CGO_ENABLED') { $savedGoEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
  $env:GOOS = 'linux'; $env:GOARCH = 'amd64'; $env:CGO_ENABLED = '0'
  go build -trimpath -o (Join-Path $runnerContext 'podry-build-runner') ./cmd/podry-build-runner
  if ($LASTEXITCODE -ne 0) { throw 'Runner cross compilation failed' }
} finally {
  foreach ($name in $savedGoEnv.Keys) { [Environment]::SetEnvironmentVariable($name, $savedGoEnv[$name], 'Process') }
}
Copy-Item -LiteralPath $testCa -Destination (Join-Path $runnerContext 'podry-test-ca.crt')
docker build --file tools/cicd-live/runner.Dockerfile --tag registry.podry.dev/podry-live/runner:live $runnerContext
# 前提：Docker daemon 信任 Registry CA；本轮实际发布采用上文临时复制方式。
docker push registry.podry.dev/podry-live/runner:live
docker image inspect registry.podry.dev/podry-live/runner:live --format '{{json .RepoDigests}}'
```

后端配置必须使用最终 Registry 的 `repository@sha256:...`，不能使用可变 live tag。仓库 Dockerfile 已另行成功本地构建，包含显式 COPY chmod=0755；该复核镜像没有替换两轮已验收的 runner digest。

## 后端与验收器配置

使用独立测试数据库和新的密钥配置，显式迁移至 v17、通过 CLI 建立管理员；身份与迁移流程见 [基础实施](05-implementation.md)。按当前 [OpenAPI](../api/openapi.json) 创建团队/项目、加密 Git 与 Kubernetes 凭据、Registry、集群、环境、应用和手动 build_deploy binding。配置保存本身不执行任务。

本轮实际应用配置：Git URL 为用户提供的 podry-demo.git、branch=main；Dockerfile=Dockerfile、context=.、platform=linux/amd64、timeoutSeconds=900，buildArgs 含 GOPROXY=https://goproxy.cn,direct；镜像 repository=podry-live/podry-demo。Base 使用 Deployment/Chart 1.0.0、replicaCount=1、containerPort=8080、Service port=80、无 Secret 引用。绑定 autoDeploy=false，目标 namespace=podry-cicd-live、releaseName=podry-demo-live，发布超时 600 秒。当前测试项目使用此 namespace 的 resource.view/resource.write/pod.logs grant。

只为该测试 API 进程显式设置下列执行选项，其余数据库、JWT、加密密钥、CA 与持久日志目录按本机秘密配置提供：

```dotenv
PODRY_BUILD_ENABLED=true
PODRY_RELEASE_ENABLED=true
PODRY_BUILD_CLUSTER_ID=<API 中登记的集群 UUID>
PODRY_BUILD_NAMESPACE=podry-cicd-live
PODRY_BUILDKIT_ADDR=tcp://buildkit.podry-cicd-live.svc.cluster.local:1234
PODRY_BUILD_RUNNER_IMAGE=<已推送的受控 runner repository@sha256:digest>
PODRY_BUILD_PLATFORM=linux/amd64
PODRY_BUILD_CONCURRENCY=1
PODRY_RELEASE_CONCURRENCY=1
PODRY_RESOURCE_WRITES_ENABLED=false
PODRY_HEALTH_POLLING_ENABLED=false
```

验收器要求已配置的手动绑定、匿名可读 Registry、同一构建/发布集群及 namespace、Deployment 与 release 同名、Service port 80，以及 /ping 返回 pong 的示例项目。它不是通用多集群或任意应用验收器。需要本机 kubectl、可达 API、有效 Token 和可信 CA。

```powershell
# PODRY_LIVE_TOKEN 由当前进程环境注入，勿把实际值写入脚本或命令行。
node --use-system-ca scripts/test-cicd-live.mjs `
  --api http://127.0.0.1:15000 `
  --app d6b36233-d481-4465-b918-c822a7346d54 `
  --binding 17af250b-3e4a-4631-96c3-6f5ce1ab5fab `
  --kubeconfig docs/k3s.yaml --insecure-kubernetes `
  --output D:/Temp/podry-live-cicd-20261122/acceptance-complete.json
```

新环境需换成自身 UUID。新一轮测试使用新的 output 文件；续跑必须使用原文件，不删除或改写已记录身份。可用 `--build-id UUID` 接续既有真实构建；阶段轮询默认 1200 秒，可用 `--timeout-seconds` 设为 60–7200。unknown 保持观察，超时后保留证据，不能据此自动重发任务；配置变化或预览过期需人工核对。

脚本在变更请求前保存幂等键与已冻结选择，记录 Build/preview/request/deployment 身份，重跑复用；不会自动重试新 Attempt、取消任务或清理资源。Registry 请求不携带后端 Token，禁止重定向；port-forward 退出时回收。日志归档最多等待 90 秒，证据仅保存数量与响应摘要；响应 hash 不是归档原文件 hash，签名游标会使重读摘要变化。

## 验证与剩余工作

本批针对新增工具与文档执行：真实两轮链路及同证据续跑、`node --check`、`--help`、BuildKit YAML 集群端 dry-run、仓库 runner Dockerfile 实际构建、文档结构/链接及改动空白/编码检查。没有重跑此前耗时 Go 全量集成回归，也不将历史分段回归描述为本次结果。

下一步优先补充 T23 的真实故障与权限矩阵：提交响应丢失、强杀、部分写入、超时、凭据轮换/撤权、同名新 UID、同物理目标并发；其次验证有限 Job 工作负载发布、构建取消/重试、自动部署、晋级/回滚和跨环境。Gitea/GitLab Webhook 仍待开发，当前完成的是手动触发真实 Gitea 构建。T24 多实例/生产备份集合恢复、外部状态核对、安全 GC、证书持久管理及前后端联调均未完成。

## 后续补充：测试应用公网入口

同日曾直接创建独立 Ingress，名称 podry-demo-live-public，使用 Traefik，将 app.podry.dev 的 / 路由至 podry-demo-live:80。cert-manager 沿用 podry-test-ca ClusterIssuer，Certificate podry-demo-live-public-tls 当时已 Ready。该入口当时独立于 Helm release 管理，未改应用配置或增加新的发布记录；随后已按用户纠正撤掉，替换为 [Helm 管理的入口](30-ingress-helm-release.md)，旧手工清单不再保留为操作入口。

本机最终解析 app.podry.dev 为 154.37.218.78；通过 `node --use-system-ca` 直接请求域名（未覆盖 DNS、未跳过 HTTPS 证书校验），[应用首页](https://app.podry.dev/) 与 [ping](https://app.podry.dev/ping) 均为 200，ping 正文 pong，首页包含 podry-demo。Windows curl 首次因 Schannel 无法确定测试证书吊销状态失败，未计为通过。这里补充了公网入口访问验证；前文两轮 CI/CD 证据仍保留当时仅使用 port-forward 的原始范围。

参考官方配置：[BuildKit CA 配置](https://docs.docker.com/build/buildkit/configure/)、[rootless Kubernetes 示例](https://github.com/moby/buildkit/blob/master/examples/kubernetes/deployment%2Bservice.rootless.yaml)、[containerd hosts 配置](https://github.com/containerd/containerd/blob/main/docs/hosts.md)。
