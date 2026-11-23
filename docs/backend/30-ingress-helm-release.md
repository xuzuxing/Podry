# Ingress 随 CI/CD 与 Helm 发布

日期：2026-11-22。此前手工入口虽然可以访问，但没有经过 Podry 配置、发布快照和 Helm。按用户要求，补齐受控 TLS 配置后，重新跑完第三轮真实 Git → BuildKit → Registry → Helm 链路，并撤掉手工入口。

## 本次结果

| 对象 | 实际结果 |
| --- | --- |
| 应用配置 | v4，Deployment，内置 Chart 1.1.0 |
| Build | ac8bf0ec-c916-4c89-89db-019c40775cdb，succeeded |
| Attempt | 90d38668-efc0-41d0-aae0-cea89b770354，源码与构建容器 exit 0 |
| Artifact | 7dc308b9-fd17-4ecb-a957-6725cde8208c，source=build |
| Deployment | 62eef8aa-03c0-4c23-b4f2-af2cdea513bc，succeeded |
| Helm | namespace=podry-cicd-live，release=podry-demo-live，revision=3，Chart=1.1.0，deployed |
| Ingress | podry-demo-live，UID=dd498a43-713a-4807-9776-4780550e0997，Helm 所有权及本次 deployment-id 一致 |
| 证书 | podry-demo-live-tls，Ready=True，ownerReference 指向本次 Helm Ingress |
| 公网访问 | https://app.podry.dev/ 为 200，包含 embed 页面；/ping 为 200 pong；正常 DNS、HTTPS 校验开启 |
| 旧入口 | podry-demo-live-public 已删除；同 namespace 内该域名只剩一个 Ingress 路由 |

验证包括读取 Helm release Secret 中存储的 Chart/manifest，确认 TLS Ingress 确实属于 revision 3；撤掉手工入口后再直接访问域名成功。前两轮验收原始记录不改写，见 [29](29-live-cicd-acceptance.md)。新一轮仍使用同一源码 SHA，镜像 digest 与前两轮相同。

[公开证据摘录](evidence/2026-11-22-ingress-helm.json) 包含真实 Build/Job/Artifact/Deployment 身份、Helm 版本、Ingress/证书归属及 HTTP 结果。本机原始验收文件为 D:/Temp/podry-live-cicd-20261122/acceptance-ingress.json，辅助验证为 ingress-release-evidence.json；未复制凭据或 TLS 私钥至仓库。

## 业务配置与版本兼容

新增 `internal/chart/charts/podry-tls`，元数据仍为 podry，版本为 1.1.0；Chart 1.0.0 的文件与原 SHA-256 保持不变。渲染与历史归档校验按版本选择经批准的包，未知版本拒绝执行。没有修改历史发布快照的 canonical 字段顺序。

Chart 1.1.0 接受以下受控 Ingress 字段，不开放任意 annotations：

```json
{
  "enabled": true,
  "host": "app.podry.dev",
  "className": "traefik",
  "tlsSecretName": "podry-demo-live-tls",
  "clusterIssuer": "podry-test-ca"
}
```

className、tlsSecretName、clusterIssuer 为可选 DNS 子域名，空字符串省略配置；非空 clusterIssuer 必须同时配置 tlsSecretName，且集群需要已安装 cert-manager 和现有 ClusterIssuer。也可以只引用已有 TLS Secret。enabled=true 仍要求 Service 已启用且 host 非空；Job 不接受 Ingress。Chart 1.0.0 拒绝新增的三个字段，环境覆盖不能绕过版本校验。

完整 base 请求样例见 [app-release-values.json](../../tools/cicd-live/app-release-values.json)。对目标应用先 GET 当前配置，向 `PUT /api/apps/{appId}/config` 提交样例并加入当前 expectedVersion；它保存新版本，不自动部署。本轮随后通过 [验收脚本](../../scripts/test-cicd-live.mjs) 的新 output 文件触发真实 Build、新 Artifact、发布预览和确认，由后端 Helm Worker 下发 Ingress。

普通预览、自动部署、晋级和 setup 现均传递所选 Chart 版本；回滚继续采用来源快照的历史归档。OpenAPI 更新为 V1.23.0，仍为 79 个 HTTP 操作，无数据库迁移。

## 本批验证

- `go test ./internal/chart ./internal/application ./internal/release -count=1` 通过，包含 TLS 渲染、归档版本与旧包摘要、无效字段/名称和环境覆盖校验。
- `scripts/test-backend.ps1` 仅选六个集成用例，通过 go vet、go build、Linux 服务/测试二进制编译以及隔离 PostgreSQL 测试：TLS 预览与确认、旧版预览、环境覆盖、自动部署冻结快照、晋级及历史 Job 回滚。日志 ingress-targeted.log。上述兼容性用例使用 fixture，不是相应业务的真实远端验收。
- 第三轮完整真实链路通过：固定 SHA、Job/Pod 身份与退出结果、Registry 原始 manifest 摘要与 blob 可用性、Artifact、Helm upgrade、工作负载 Pod imageID/Ready、日志归档和 port-forward HTTP。
- 随后读取实际 Helm 存储，核对 Ingress/TLS、Chart 版本、所有权与证书；删除手工入口后，正常域名 HTTPS 请求成功。

这次仅优雅重启并更新独立测试 API 的二进制。开发数据库、默认后台开关、web 均未修改；没有 Git 提交或推送，没有重跑全量集成测试。证书仍使用用户已信任的测试 CA，节点 CA 的重启持久性、T23 故障矩阵及 T24 生产恢复/安全 GC 的待验收边界保持不变。
