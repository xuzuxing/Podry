# Kubernetes 资源读取与 Pod 日志

日期：2026-11-20。继管理配置与 Git 接口后，交付 B2 的真实 Kubernetes 只读适配。共 **48 个可用操作，28 个计划操作**；正式数据库迁移仍为版本 3，无新增表。实现位于 `internal/kubernetes`、`internal/resource` 和 `internal/platform/connection.go`，查询通过 pgx/v5 + sqlc。

## 接口

以下路径统一加 `/api/clusters/{clusterId}`；均要求 Bearer Token。

| 方法和路径 | 行为 |
| --- | --- |
| `POST /connection-tests` | 平台管理员显式读取 `/version`，保存 connected/unavailable、serverVersion、checkedAt；HTTP 200 表示测试完成，业务状态见 status |
| `GET /discovery` | 核心版本及每组 preferredVersion 的资源类型，过滤子资源和未授权类型；verbs 仅返回当前提供的 get/list |
| `GET /namespaces` | 授权 Namespace 的 name/uid/phase；精确授权只逐个读取获授权 Namespace，不拉取所有名称再过滤 |
| `GET /resources` | GVR、namespace、selectors、limit、continueToken；返回 items、continueToken、resourceVersion，不提供 total |
| `GET /resource` | GVR、namespace、name；可选 uid/resourceVersion 前置校验，返回 ref、kind、status、manifest、data、ownerRefs |
| `GET /events` | 先确认对象 UID，再按 involvedObject.uid 查询核心 Events；同时要求目标和 core/events 的 resource.view |
| `GET /pod-logs` | namespace/name/uid/container 必填，支持 tailLines、sinceSeconds、previous、follow；NDJSON log/end/error |

核心 API 的 `group` 必须显式传空字符串，如 `?group=&version=v1&resource=pods`。其他组使用 `group=apps`、`group=example.test`，直接读取可使用该组实际提供的非首选版本。资源请求按 Discovery 的 namespaced 和 verbs 构造路径，不猜测 Kind 的复数形式。

namespace 授权 `"*"` 仅覆盖 Namespace 内对象，`""` 专指集群作用域。精确 Namespace 授权的用户查询列表必须指定获授权 namespace；省略 namespace 的全 Namespace 查询要求匹配资源的 `"*"` grant。不通过扩大上游查询再过滤来模拟授权。授权资源支持 `core/pods`、`apps/deployments` 或 CRD 的 `group/plural`，不支持子资源路径。

Namespace 选择器是特殊的最小元信息投影：获授权精确 Namespace 的用户可读取这些 Namespace 的名称/UID/phase；具备 namespaced 通配授权或 cluster-scope `core/namespaces` 查看权的用户可列出全部 Namespace 元信息。它不授予 Namespace 对象的通用读取权限。

## 连接凭据与 TLS

仍通过 `POST /api/credentials` 创建平台级 `kind=kubeconfig, teamId=null` 凭据，再通过 `POST /api/clusters` 引用。凭据只写入 AES-256-GCM 密文和不可变版本；列表与轮换响应不返回 payload。

两种认证方式互斥：Token，或 Base64 PEM 客户端证书与匹配私钥。支持完整证书链。结构示例中的值全部是占位符：

```json
{
  "name": "测试集群连接",
  "kind": "kubeconfig",
  "teamId": null,
  "payload": {
    "apiServer": "https://cluster.example.test:6443",
    "clientCertificateData": "<Base64 PEM 客户端证书链>",
    "clientKeyData": "<Base64 PEM 私钥>",
    "insecureSkipTLSVerify": true
  }
}
```

`insecureSkipTLSVerify` 默认 false；按本次测试要求显式设为 true，跳过服务端证书校验。该选项逐凭据生效，不改变 Git、Registry 或全局 HTTP 客户端。false 时必须提供有效 `certificateAuthorityData`，true 时可以省略 CA；若提供仍校验其 Base64/PEM 格式。客户端证书和私钥在保存时验证格式及配对关系，实际 Kubernetes 权限在读取时由 API Server 判定。

不接受原始 kubeconfig YAML、exec、auth-provider、文件路径、未知字段、重定向或客户端临时传来的集群地址。轮换保留 apiServer，更新集群绑定/轮换凭据均重置旧连接观察。每次请求独立创建客户端并关闭空闲连接，没有永久缓存旧凭据。

连接测试与资源读取在网络 I/O 前结束数据库事务，完成后重验用户、grant、集群绑定及凭据版本。轮换期间完成的旧请求返回 409，不能将旧版本连接观察覆盖新状态。无权用户在目标读取前拒绝；确认动态类型作用域可能需要读取 Discovery 元信息。

## 投影、分页与预算

Secret 的 manifest 和 data 都只保留元信息、类型和键名；移除 data/stringData 值和全部 annotations。所有对象移除 managedFields 及 last-applied annotation。普通资源/CRD 仍返回其获授权内容，不声称自动识别所有业务字段中的秘密。

manifest 为格式化 JSON，可作为 YAML 1.2 读取。status 优先采用 phase，否则采用为 True 的 Failed/Complete/Ready/Available/Progressing 条件，无法判断时返回 unknown；不替代未来发布执行器的 generation/副本数就绪判断。ownerRefs 通过其 apiVersion/Kind 在 Discovery 中解析 GVR，保留 UID，不读取 owner 对象，也不据此授予 owner 权限。已消失或无法映射的类型不会编造复数名，原始 ownerReferences 仍保留在 data.metadata 中。每个对象最多 8 个 owner 引用，每页最多额外发现 16 个 owner API 版本。

limit 默认 100，范围 1–500。Kubernetes 原始 continue 被包装为 HMAC-SHA256 令牌，10 分钟有效，绑定用户/tokenVersion、集群/凭据版本、grant 集合、GVR、namespace、selector 和 limit。翻页必须保留这些参数；配置/授权变化后从首页重新查询。Kubernetes 过期继续令牌返回 410。

普通 API 总时限 25 秒，单次远端 JSON 读取 10 秒/8 MiB，连接/TLS 握手 5 秒，响应头 10 秒；拒绝上游重定向。Discovery 最多 256 个 API 版本、6 个并发、每版本 2048 个类型。部分 API 组失败明确返回 discovery_incomplete，不将缺失类型伪装成完整空列表。Namespace 最多 20 页、每页 500；精确 Namespace 最多 500 个。Events 最多 10 页、每页 500，超预算明确报错。

## 日志流

`pod.logs` 独立授权，不要求附加 resource.view；上游执行身份仍须能 GET Pod 和读取 pods/log。先验证 Pod UID 及普通/init/ephemeral 容器成员关系，再打开日志，并在输出前复验 UID。Kubernetes 的 Pod 日志 API 按名字读取、没有 UID 原子前置条件；前后检查和周期检查缩小替换窗口，不能宣称远端原子保证。

默认 tailLines=200、previous=false、follow=false，tailLines 为 1–10000，sinceSeconds 为 1–604800。请求固定 timestamps=true，返回真实上游时间戳及 message；无可解析时间戳时 timestamp 为空字符串。流开始前使用标准 HTTP 错误，开始后用 `type=error`，自然结束用 `type=end`。不提供日志持久归档或断点恢复；应用日志内容本身不承诺通用脱敏，平台审计及普通日志只记录目标身份与结果，不记录日志正文。

容器尚未启动或指定的历史实例无日志时，上游可能拒绝合法日志请求，此时返回 `422 pod_logs_unavailable`；它与本地 `validation_failed` 分开，不返回伪造空日志，也不回显上游原文。

每进程最多 16 个并发流、每用户 2 个，最长 5 分钟且不超过访问 Token 有效期；上游读取最多 20 MiB、单行小于 64 KiB、每次写入 5 秒（NDJSON 编码后字节数可能增加）。每 5 秒在最多 3 秒的检查上下文中重验授权、凭据版本和 Pod 身份。用户停用、登出、撤权、凭据轮换或同名 Pod 替换后关闭活动流；客户端取消会取消上游读取。并发限制目前是单进程限制，部署多个副本时分别计算。

调用示例：

```powershell
$headers = @{ Authorization = "Bearer $accessToken" }
$clusterApi = "$baseUrl/api/clusters/$clusterId"
Invoke-RestMethod -Method Post -Uri "$clusterApi/connection-tests" -Headers $headers
Invoke-RestMethod -Uri "$clusterApi/discovery" -Headers $headers
Invoke-RestMethod -Uri "$clusterApi/namespaces" -Headers $headers
Invoke-RestMethod -Uri "$clusterApi/resources?group=&version=v1&resource=pods&namespace=demo&limit=100" -Headers $headers
# 流式客户端应使用带 Authorization 的 Fetch ReadableStream，并在离开页面时 Abort。
```

## 验证与边界

使用 `./scripts/test-backend.ps1`：原生 go vet/build，交叉编译 Linux 集成测试及真实服务二进制，在隔离 PostgreSQL 16.15 容器执行。TLS fixture 是真实 HTTPS 服务，覆盖 Token/mTLS、可信/不可信 CA、显式跳过校验、动态 CRD、namespace/集群 scope、Secret 双投影、UID/resourceVersion、Events、游标隔离、凭据轮换竞争、NDJSON、Pod 替换、日志撤权与并发上限。

`TestLiveKubernetesReadOnly` 默认跳过；提供 `PODRY_TEST_KUBE_PAYLOAD` 环境变量时才使用真实集群。凭据仅经进程环境传入隔离测试，测试数据库和容器结束后清理；只请求版本、Discovery、Namespace、Pod 列表/详情/Events 及少量日志，输出版本、数量和结果，不输出对象、私钥或日志内容。真实测试结果在本节下方记录。

2026-11-20 隔离测试及原远端集群验证记录（后续切换本地 k3d、新域名入口及最终可用集群的记录见下方；最终真实只读联调已通过）：

| 检查 | 结果与证据边界 |
| --- | --- |
| 隔离完整后端测试 | 29 个主测试 + 6 个 Token 子测试通过；真实集群用例默认跳过。包含既有迁移、权限、应用配置、Git 和新增的 9 个 Kubernetes 测试；日志不可用错误分类补充后，9 个 Kubernetes 测试定向重验全部通过 |
| 静态及生成检查 | go vet/build 通过；sqlc vet 通过，重新生成的查询哈希一致；文档结构检查通过（31 Markdown、354 本地链接、76 操作、238 schema 引用） |
| 真实集群连接 | 用户提供的客户端证书/私钥认证，显式跳过服务端 TLS 校验；返回 `v1.37.2+k3s1` |
| 真实资源读取 | 读取 5 个 Namespace、6 个 Pod 的首个有界页面、按 UID 获取 Pod 详情及 14 条相关事件；修复了真实 typed list 省略单项 apiVersion/kind 的兼容情况 |
| 真实 Discovery | `metrics.k8s.io/v1beta1` 上游不可用，接口按约定返回 `503 discovery_incomplete`；没有声称取得完整类型清单。其他核心 GVR 可独立读取 |
| 真实日志 | 采样的 6 个 Pod 全为 Pending，尚无运行中容器，上游拒绝日志读取；未获得真实日志正文。正常日志、previous/follow、结束、撤权、过期、取消、Pod 替换、并发/单行限制使用 HTTPS fixture 验证 |

原远端集群用例因上述 Discovery/日志条件返回失败，不能当作真实集群全通过。

### 切换本地 k3d

2026-11-20 按用户要求改用本地 kubeconfig 的当前 context `k3d-k3s-server`，以客户端证书认证，逐凭据显式设置 `insecureSkipTLSVerify=true`。不再使用此前远端集群凭据。通过 `kubectl config view --minify --flatten --raw -o json` 将当前配置读取到进程内存，提取结构化 payload，经 `PODRY_TEST_KUBE_PAYLOAD` 传给隔离测试，结束后恢复环境变量；未修改原 kubeconfig，也未将证书或私钥写入仓库。

该 kubeconfig 的地址为 `https://host.docker.internal:6443`，本次 Linux 测试容器可直接访问。在 Windows 宿主机上读取该地址超时；后续只读诊断通过命令行临时覆盖 `--server=https://127.0.0.1:6443` 访问已发布的端口，仍显式跳过 TLS 校验。地址应按后端实际运行位置选择，原文件保持不变。

| 本地 k3d 检查 | 本次结果 |
| --- | --- |
| 构建与连接 | go vet/build 通过；客户端证书认证成功，版本为 `v1.35.5+k3s1` |
| 真实资源读取 | 4 个 Namespace、5 个 Pod 的首个有界页面、按 UID 获取 Pod 详情以及 11 条相关事件均成功 |
| Discovery | `metrics.k8s.io/v1beta1` 不可用，返回 `503 discovery_incomplete`；APIService 条件为 `Available=False, reason=MissingEndpoints` |
| Pod 日志 | 5 个 Pod 均为 Pending，容器处于 `ContainerCreating`；日志请求返回 `422 pod_logs_unavailable`，没有取得真实日志正文 |
| 只读环境诊断 | 2 个节点均为 Ready，无内存/磁盘/PID 压力；Pod 已分配节点。Warning Events 为 `FailedCreatePodSandBox`：拉取 `docker.io/rancher/mirrored-pause:3.6` 时发生 `TLS handshake timeout` |
| 定向真实集群测试 | `TestLiveKubernetesReadOnly` 执行失败，失败项为 Discovery 和日志；不能记为全通过 |

本地集群需先恢复节点到镜像仓库的访问，或通过用户选定的镜像来源为节点提供所需镜像；待容器启动、metrics API 可用后再重验。这里的仓库 TLS 握手超时属于节点拉取镜像的网络问题，后端凭据中的跳过 API Server TLS 校验不会改变节点的镜像拉取行为。本次仅只读诊断，未修改集群网络、镜像配置、工作负载或 metrics-server。

### 新的 instabox 域名入口

2026-11-20 随后改用用户新提供的 kubeconfig 中的 instabox HTTPS 域名入口和客户端证书/私钥，仍逐凭据设置 `insecureSkipTLSVerify=true`。凭据仅保存在测试进程内存及隔离测试环境中，没有覆盖本地 kubeconfig、登记到开发服务或写入仓库。

| 新入口检查 | 本次结果 |
| --- | --- |
| 静态构建 | go vet/build 通过，Linux 集成测试与服务二进制编译成功 |
| 后端真实连接测试 | `TestLiveKubernetesReadOnly` 在连接检查处失败，尚未执行 Discovery、Namespace、Pod、Events 或日志读取 |
| 独立只读诊断 | Windows 宿主机以同一客户端证书、私钥及跳过 TLS 校验访问 `/version`、`/api`、`/apis`，均返回 HTTP 400，Content-Type 为 `text/plain; charset=utf-8` |
| 上游错误确认 | `/version` 响应为 `Client sent an HTTP request to an HTTPS server.`，说明转发链路中有 HTTP 请求到达 HTTPS 端口；无法从本次响应确认 Kubernetes 版本或集群内资源状态 |

该入口目前无法完成 Kubernetes HTTPS/mTLS 访问。需提供能将客户端 TLS 握手直达 API Server 的 TCP/TLS 透传入口，或通过 SSH 隧道转发到 API Server，再执行只读联调。仅跳过服务端证书校验不能改变转发链路的 HTTP/HTTPS 协议，也不能替代客户端证书认证。本次没有修改后端 TLS 实现、降低集群认证要求或更改远端转发配置。此前本地 k3d 的 Pending 和镜像拉取问题属于上一环境的历史实测，不能据此判断新入口后的集群状态。

### 使用 docs/k3s.yaml 的最终验证

2026-11-20 按用户最新指定，改用 `docs/k3s.yaml` 当前 context `default` 的集群。读取配置后仅在内存中提取 API Server、客户端证书及私钥，显式设置 `insecureSkipTLSVerify=true`，通过进程环境传入隔离测试。未修改源 kubeconfig，未复制其证书、私钥或服务地址到代码及本验证文档，也未更改开发服务已有集群登记。

| 最终集群检查 | 本次结果 |
| --- | --- |
| 静态构建 | go vet/build 通过，Linux 集成测试与服务二进制编译成功 |
| 连接测试 | 客户端证书认证成功，版本为 `v1.37.2+k3s1` |
| Discovery | HTTP 200，返回 105 种当前可读取资源类型 |
| Namespace 与 Pod 列表 | 读取 4 个 Namespace、8 个 Pod 的首个有界页面；其中 5 个 Running、3 个 Succeeded |
| Pod 详情与 Events | 按 UID 获取 Pod 详情成功；相关 Events 查询成功，所选对象返回 0 条事件 |
| Pod 日志 | 运行中容器的 `tailLines=2, follow=false` 真实请求成功，NDJSON 正常结束；未输出日志正文 |
| 定向真实集群测试 | `TestLiveKubernetesReadOnly` 通过，覆盖本批 7 个接口；集群交互仅为读取 |

此前远端、本地 k3d 及域名转发入口的失败记录保留为历史证据，不再作为当前集群的阻塞项。此结果确认上述有界读取流程可用；非空事件、持续 follow、previous、撤权、并发限制等其他条件仍以此前 HTTPS fixture 测试为证据，没有将其扩展为本次真实集群覆盖。

连接凭据、登记和测试账户仅存在于本次隔离测试数据库，未修改开发服务已有数据；测试容器与临时二进制已清理。定向重验可使用 `./scripts/test-backend.ps1 -TestPattern '^TestLiveKubernetesReadOnly$'`；应通过进程秘密环境注入 payload，不把真实值写入脚本。上述隔离完整测试为此前执行记录，本次切换仅重跑静态构建及真实集群定向测试。

本批不创建、更新或删除 Kubernetes 资源；应用资源归属接口仍等待发布资源 UID 清单，构建/产物/发布执行、Secret reveal、终端、资源写入与日志归档仍按后续阶段开发。未修改 `web/`。

后续更新：B4 构建、产物和日志执行已在 [09](09-build-execution.md) 实现并通过隔离测试；真实 CI 等待环境联调。本页保留 Kubernetes 只读批次的历史计数与证据。
