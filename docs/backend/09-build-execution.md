# 持久构建执行、产物与日志

历史记录：下文描述本批交付时点；2026-11-22 已完成两轮真实远端构建、推送和日志归档，最新证据与剩余故障验收见 [真实 CI/CD 验收](29-live-cicd-acceptance.md)。

日期：2026-11-20。B4 的服务端执行逻辑和六个 HTTP 接口已实现；本批验证使用真实 PostgreSQL 和 Git/Kubernetes/Registry fixture。**真实 BuildKit 构建、镜像推送及按 digest 拉取尚未验收**，等待用户部署环境后联调。本批没有向 `docs/k3s.yaml` 对应的真实集群写入资源。

当前 OpenAPI 共 76 个操作，54 个 implemented、22 个 planned。迁移版本为 4，共 22 张业务表；`docs/data/schema.sql` 的 31 张表仍是完整设计。此前 Kubernetes 只读实测见 [08](08-kubernetes-resources.md)，本页区分构建实现与真实 CI 验收。

## 接口与调用

所有路径带 `/api` 前缀，需要现有 Access Token。构建写入需要项目 developer/admin；构建历史、日志与产物沿用项目可见性，跨项目无权访问返回 404。

| 方法与路径 | 行为 |
| --- | --- |
| `POST /apps/{appId}/builds` | `Idempotency-Key` 必填；完整小写 40 位 SHA-1、expectedConfigVersion；持久化 Build、Attempt、冻结输入、审计及幂等响应后返回 202 |
| `GET /apps/{appId}/builds` | 按应用授权和时间分页 |
| `GET /builds/{buildId}` | 状态、当前 Attempt 编号、配置版本和产物 ID |
| `GET /builds/{buildId}/attempts` | Job 名/UID、时间、错误码、logAvailability；不返回执行输入和秘密 |
| `GET /builds/{buildId}/logs` | attemptNo、follow、cursor；NDJSON log/end/error |
| `GET /apps/{appId}/artifacts` | 按 digest 固定的产物与 imageRef；日志失效不隐藏产物 |

触发请求示例（SHA 和版本从当前 Git/配置接口获取）：

```http
POST /api/apps/{appId}/builds
Authorization: Bearer {accessToken}
Idempotency-Key: build-request-20261120-01
Content-Type: application/json

{"commitSha":"0123456789012345678901234567890123456789","expectedConfigVersion":2}
```

请求预检读取已配置 HTTPS Git 仓库，确认 SHA 属于手动 CI 分支可读历史；目前仅支持 SHA-1。Git/配置预检失败不会留下 Build 或幂等占位。提交事务重验配置、CI 版本、Git 凭据版本和权限。同键同输入重放原 202，不依赖 Git 仍在线；同键不同输入返回 409。202 表示意图已持久化，后续实际状态由 Worker 推进。

`setup.canBuild` 现在依据已启用且有效的执行环境配置、Git/Build 配置、手动 CI、平台匹配、未归档状态和当前 build 权限派生。它不主动探测 BuildKit、Registry 或集群，不承诺网络当前可达。发布资格仍等待 B5。

## 迁移与运行配置

保留既有凭据密钥、JWT 和数据库配置，先备份数据库，再使用现有显式迁移命令：

```powershell
go run ./cmd/podry migrate up
```

迁移 000004 新增 builds、build_attempts、artifacts、log_archives，约束应用/流水线/配置/产物归属，并用触发器保护冻结输入、已建立的 Job UID 和产物。服务只核对版本 4，不在启动时自动迁移。down 会删除本批业务数据；存在活动或 unknown 构建时不可据此停止外部 Job，不能将数据库回滚当作取消任务。

默认 `PODRY_BUILD_ENABLED=false`，历史及管理接口可以继续使用。启用 Worker 需要：

| 环境变量 | 配置 |
| --- | --- |
| PODRY_BUILD_ENABLED | `true` 启用 |
| PODRY_BUILD_CLUSTER_ID | 已登记的平台构建集群 UUID，不是 kubeconfig context 名 |
| PODRY_BUILD_NAMESPACE | 已存在的专用测试 Namespace |
| PODRY_BUILDKIT_ADDR | Job 网络可达的 `tcp://host:port` |
| PODRY_BUILD_RUNNER_IMAGE | 平台受控工具镜像，必须 `repository@sha256:64位摘要` |
| PODRY_BUILD_PLATFORM | `linux/amd64` 或 `linux/arm64`，需与应用构建配置及节点一致 |
| PODRY_BUILD_CONCURRENCY | 1–4，默认 1，每进程 Worker 数 |
| PODRY_DATA_DIR | 日志持久目录，默认 `.podry`；容器内须挂持久卷 |
| PODRY_CREDENTIAL_KEY | 原有 32 字节 Base64 密钥，启用构建时必填 |
| PODRY_HTTP_ALLOWED_HOSTS | 开发 HTTP Git/Registry 的精确 host:port 放行列表，逗号分隔；默认空 |

`docs/k3s.yaml` 是本地连接材料，不会自动登记到开发数据库。管理员需经现有凭据/集群接口登记平台级 Kubernetes 凭据与集群，并使用返回的 UUID。当前 Worker 在专用 Namespace 读/建/解除暂停 Job，读/建 ConfigMap、Secret，读取 Pod/日志；不会自动创建 Namespace。Registry 通过现有管理接口登记，其 ID 由应用 Build 配置引用。

Kubernetes 的跳过 TLS 校验继续是逐凭据选项，适用于用户指定的测试集群。Git/Registry 默认使用 HTTPS；本地 HTTP 开发服务仅允许 `PODRY_HTTP_ALLOWED_HOSTS` 显式列出的 host:port，完整校验仍拒绝 URL 内嵌凭据、query、fragment 和重定向。放行决定随 Attempt 冻结给 Runner，HTTP Registry 输出显式使用 `registry.insecure=true`，HTTPS 继续正常校验证书。Bearer token 支持同源凭据认证；跨源 realm 只允许 HTTPS 匿名请求，不转发 Registry 密码。HTTP realm 仅允许已批准 HTTP Registry 的同源地址。新增实现与本地示例见 [10](10-ci-local-demo.md)。

BuildKit 当前只支持受信任内部网络的 TCP endpoint，尚未实现 BuildKit mTLS、远端凭据或多平台模拟。需从构建 Pod 网络验证连通性；平台 API 可达不等于 Job 内能访问。请勿将未认证 BuildKit endpoint 暴露到公共网络。

## 受控工具镜像

源码在 `cmd/podry-build-runner/`，构建文件在 `tools/build-runner/Dockerfile`。从仓库根构建，先提供三个实际可用、固定 digest、架构相容的基础镜像：Go 编译镜像、含 `/usr/bin/buildctl` 的 BuildKit 镜像、含 git/CA certificates/`/bin/sh` 的运行时镜像。

```powershell
# 以下变量由部署环境提供真实 name@sha256:...，不使用可漂移基础镜像。
docker build -f tools/build-runner/Dockerfile --build-arg "GO_IMAGE=$env:PODRY_RUNNER_GO_IMAGE" --build-arg "BUILDKIT_IMAGE=$env:PODRY_RUNNER_BUILDKIT_IMAGE" --build-arg "RUNTIME_IMAGE=$env:PODRY_RUNNER_RUNTIME_IMAGE" -t $env:PODRY_RUNNER_PUSH_TAG .
docker push $env:PODRY_RUNNER_PUSH_TAG
# 将实际发布 digest 的完整镜像引用配置为 PODRY_BUILD_RUNNER_IMAGE。
```

本批未构建或发布该镜像。节点需要能够拉取工具镜像；目前 Job 未配置专用 imagePullSecrets，私有工具镜像的拉取认证需由节点运行环境另行提供。

source initContainer 以独立进程拉取固定 SHA，校验 HEAD、Context/Dockerfile 类型、路径及符号链接边界。Git 凭据经挂载文件和 ASKPASS 获取，不嵌入 URL/命令参数，不输出 Git 原始错误。build 容器调用固定 buildctl、dockerfile.v0，将应用 buildArgs 和 platform 显式传入；镜像使用每 Attempt 独立 tag 推送。

Job 不挂平台 ServiceAccount token，不传集群凭据；使用只读根文件系统、关闭提权、丢弃 capabilities、seccomp RuntimeDefault，并限制 CPU/内存和 emptyDir。Git 和 Registry 凭据位于任务专用 Secret。输入 ConfigMap/Secret 为 immutable，由 Job UID 控制归属。buildArgs 会出现在输入配置及构建过程，请使用非秘密值。

## 执行与恢复

executionSpec 固定应用/构建/Attempt、完整 SHA、配置内容、runner digest、BuildKit 地址、平台、限额以及集群/Git/Registry 凭据版本。凭据轮换或进程重启后继续读取原版本；不会用新值替换历史执行输入。

Worker 通过短事务 `FOR UPDATE SKIP LOCKED` 领取 60 秒租约，每次领取增加 revision，每个外部步骤最多 20 秒。状态写回检查 owner/revision/有效租约；过期 Worker 无法覆盖新状态。活动和 unknown Attempt 会在启动后继续领取。

1. 先持久化 `creating` 意图，再首次提交确定名称的 suspended Job。
2. 创建响应丢失时按原名称、输入 hash、Attempt ID 和已记录 UID 核对；Job 不可见进入 unknown，**不自动重新 POST Job**。
3. 准备 ConfigMap/Secret，部分成功时核对既有对象，随后按 UID/resourceVersion 解除暂停。
4. 实际启动前重验当前权限；明确撤权终止未启动工作，权限查询暂时失败保留 unknown。已启动 Job 继续观察实际结果，包括解除暂停响应丢失后撤权的情况。
5. 观察终态，从受控 build 容器读取小于 1 KiB 的版本化结果，校验 Attempt、镜像仓库和 digest；Registry 返回的 manifest 内容必须与 digest 匹配。
6. Build 成功状态、Attempt 终态及不可变 Artifact 在同一事务落账。Registry 暂时不可用时保留 unknown 并继续核对，不宣布成功。

同名异 UID/hash 对象不会被接管或覆盖。Job 使用 backoffLimit=0、restartPolicy=Never 和 activeDeadlineSeconds；平台不生成第二个 Job 身份，但这不是 Kubernetes 内部 Pod 执行恰好一次的保证。原批次未包含的取消/重试已在 [构建动作](17-build-actions.md) 实现；v19 增加默认关闭的 [Job/Secret/ConfigMap 自动清理](39-resource-cleanup.md)，不配置 TTL，不清理 unknown 的外部证据。

## 日志、游标与保留

日志按 source、build 阶段输出，runtime `follow` 使用两秒轮询的有界快照。单流最多五分钟且不越过 token 到期；每进程最多 16 个流、每用户 2 个，慢写入五秒截止。外部读取后和长输出期间重验当前授权，审计只记身份/开始结束，不记日志正文。

日志单次原始/归档预算 20 MiB、最多 100000 行，runtime 单行上限 64 KiB。读取前校验 Job UID、Pod owner，读取后重验 Pod UID。多 Pod 或身份不明确时返回 log_unavailable，不混合多个执行结果。

签名 cursor 绑定用户、tokenVersion、Attempt 和 Job UID，有效十分钟，保存偏移和已读前缀链摘要。runtime 到归档可沿用游标；内容减少/变化返回 409 log_cursor_changed，篡改、过期或跨用户返回 422。HTTP 已开始后错误改为 NDJSON error 帧；正常返回 end 帧及可继续的 cursor。

终态日志独立归档为 NDJSON，经临时文件、fsync、原子 rename 保存，在 PostgreSQL 记录大小、SHA-256、过期时间。当前保留期为归档成功后七天，失败在完成后七天内重试，超过预算/缺失/损坏时明确不可读取，**不改变成功产物**。过期清理只删除服务生成的确切 storage key，数据目录访问受 `os.OpenRoot` 约束；保留元数据。v19 外部资源清理另行校验归档或到期门槛，见 [资源清理](39-resource-cleanup.md)。多副本需要相同持久目录，当前尚未进行多副本运行验收。

## 验证与待验收

定向检查：`./scripts/test-backend.ps1 -TestPattern '^TestBuild'`。脚本执行 go vet/build，将 Linux 集成测试二进制放入隔离 PostgreSQL 16 容器。数据迁移与事务使用真实 PostgreSQL，HTTPS Git/Kubernetes/Registry 使用受控 fixture，不能替代 BuildKit 实际执行。

覆盖意图落库、同键重放、无幽灵构建、响应丢失恢复、部分依赖创建、冻结凭据、旧租约写回拦截、输入不可变、替换 UID 拒绝、撤权/已启动结果、无效结构化结果、Registry 复核恢复、历史授权、日志游标/归档校验/过期、路径和 symlink 越界。

2026-11-20 本轮验证记录：

| 检查 | 结果 |
| --- | --- |
| `./scripts/test-backend.ps1` | 38 个顶层测试及 6 个 Token 子测试通过；1 个真实集群测试因没有 PODRY_TEST_KUBE_PAYLOAD 跳过 |
| 构建定向测试 | 9 个新增 Build 测试及既有 build_only 工作流测试通过 |
| 静态编译 | go vet/build、Linux 集成测试和服务二进制编译通过 |
| 数据库 | 隔离 PostgreSQL 16 上正式迁移 up/down/up、升级、约束、事务及服务角色验证通过 |
| sqlc | vet 通过；重新 generate 后所有生成 Go 文件 SHA-256 不变 |
| 文档 | OpenAPI 生成 76 操作、91 schemas；32 Markdown、366 本地链接、238 schema 引用、31 张设计表结构检查通过 |
| 真实 CI | 未执行；没有发布工具镜像、调用真实 BuildKit 或写入用户真实集群 |

完整测试使用工作树当前代码，改动尚未提交。本轮没有修改 `web/` 或开发服务已有数据库，测试容器与临时二进制由脚本清理。

用户部署好后需补验：构建 Pod 到 Git/BuildKit/Registry 网络、工具镜像执行、最小 Dockerfile 构建并推送、Registry digest 与实际拉取一致、真实 Pod 日志归档，以及进程重启/响应丢失场景。B5 的预览、快照、Helm 发布、目标占用和应用资源归属仍待开发。
