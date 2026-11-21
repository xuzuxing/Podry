# 已有镜像导入与镜像应用

日期：2026-11-21。E04 提前实现镜像导入、镜像应用和 `external_image` 手动工作流；本批镜像实现之后的应用克隆已补齐，见 [克隆记录](19-application-cloning.md)。正式迁移要求 v11，28 张业务表。构建/发布 Worker 继续默认关闭，未修改开发数据库或访问用户提供的真实服务。

## 接口与使用流程

`POST /api/apps/{appId}/artifacts` 要求 app.configure 权限和 `Idempotency-Key`（8–200 个可打印 ASCII 字符），成功返回 201 Artifact：

```json
{"registryId":"a1000000-0000-4000-8000-000000000001","imageRef":"registry.example.test/team/demo:latest"}
```

imageRef 必须显式包含所选 Registry 的主机及端口；支持 tag、完整小写 sha256 digest，省略 tag 时使用 latest。不接受 URL、内嵌凭据、查询参数、片段、路径越界或其他 Registry 主机。公开 Registry 无需凭据，私有 Registry 沿用平台级 registry 凭据配置。请求体不接收明文口令。

可在 Git 应用或镜像应用中导入。响应 `source=external`、`buildId=null`，imageRef 为 `repository@sha256:...`；不伪造 Build/Attempt，不创建发布任务。产物列表沿用原 GET 接口。不同幂等键允许保存同一 digest 的独立导入历史。

镜像应用通过 `POST /apps` 的 `sourceMode=image` 创建，只保存 base 配置，拒绝 Git/Build 配置。setup 返回 base/workflow 两步，total=2，canBuild=false。配置完整不代表已有可发布产物。`external_image` 模板只适用于镜像应用，原子创建 Binding/CD，CI 省略、CD upstreamPipelineId=null，仍只支持手动部署；`add_deploy` 可向已有镜像工作流追加另一环境的 CD。Git 应用继续使用 build_only/build_deploy 和引用已有 CI 的 add_deploy。

导入后可直接调用部署预览，冻结准确 digest；确认、晋级、回滚复用现有快照和持久 Helm Worker。默认关闭执行器时，预览可用，确认/晋级/回滚仍返回 503 且不创建任务。保存应用、配置、模板和查询 setup 不连接 Registry。

## Registry 内容验证

- 默认验证 HTTPS 证书。HTTP 仅允许 `PODRY_HTTP_ALLOWED_HOSTS` 中显式指定的主机:端口；没有全局跳过 SSL 的选项。
- 支持 Basic 与 Bearer pull 认证。平台口令仅发送给配置的 Registry 精确 origin；外部 HTTPS token realm 只接受匿名 token 请求。HTTP token realm 仅允许同一已放行 Registry origin。不跟随 manifest 或 token HTTP 重定向。
- 接受 OCI image manifest/index 与 Docker schema 2 manifest/list。验证 schemaVersion、mediaType、config/layer/index descriptor 的结构与 sha256；拒绝旧 schema、artifactType 和无效 descriptor。索引最多 1000 项。
- 直接对返回的 manifest 原始字节计算 sha256，校验请求 digest 和可选 Docker-Content-Digest。tag 读取后额外按计算得到的 digest 读取并验证，避免把可变 tag 当作固定产物。
- index/list 保留父 digest，不挑选架构、不递归下载子 manifest 或 blob。当前仅支持 sha256 descriptor；不证明各 blob 仍可拉取、不提供镜像签名或漏洞扫描，也不自动配置集群拉取凭据。
- 总时限 20 秒，单请求 10 秒，manifest 最大 8 MiB，token 响应最大 64 KiB。读取失败不保留业务记录或幂等占位。

常见错误：422 validation_failed / registry_authentication_failed / registry_manifest_not_found / registry_manifest_invalid；503 registry_unavailable / registry_rate_limited / artifact_digest_mismatch；409 revision_conflict / idempotency_conflict。错误不回显远端响应、口令或 token。

## 事务、权限与迁移

第一段短事务检查当前用户、项目配置权限、应用未归档、Registry 策略和凭据作用域，取得准确密文版本。网络读取在事务外完成。第二段事务重验权限、归档状态、Registry 地址和凭据 ID/版本/可解密性，再原子写入 Artifact、审计及幂等结果。读取期间发生轮换、撤权或归档时拒绝落账；同键并发只产生一份产物。

同键重放返回原 201，检查当前应用权限和导入时冻结的凭据作用域，不重连 Registry，也不依赖最新凭据可解密。发布预览、确认及晋级/回滚（含重放）同样检查导入凭据的当前引用作用域；不会因为 Registry 后来更换凭据而替换历史引用。

v11 将 Artifact 的 Build/Attempt 引用改为可空，增加 Registry、准确凭据版本、导入用户等内部来源字段；保留 Build 产物既有约束，产物继续不可修改。外部产物必须没有 Build/Attempt 且包含 Registry/导入者，凭据 ID/版本成对出现并引用 secret_versions。存在镜像应用或外部产物时拒绝降级，不删除历史记录。启动不自动迁移，需按实际部署安排显式升级。

## 验证边界

本批使用本地 HTTP/TLS Registry fixture 与隔离 PostgreSQL 验证认证、digest 固定、幂等、错误和权限竞态，以及镜像应用到离线预览/发布请求、产物晋级和回滚。具体最终结果记录在根目录 [开发进度](../../DEVELOPMENT_PROGRESS.md)。这些检查不代表真实 Registry、BuildKit、镜像拉取或 Kubernetes 发布验收。
