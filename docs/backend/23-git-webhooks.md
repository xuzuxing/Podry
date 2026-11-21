# GitHub Push Webhook 与构建准入

日期：2026-11-21。E02 第一批业务实现，新增 `POST /api/webhooks/git/github/{pipelineId}`，正式迁移 v15、33 张业务表；OpenAPI V1.17.0 为 74 implemented / 3 planned。仅接入 GitHub Push 到现有持久 Build/Attempt；该首批未开放 `on_ci_success`、`autoDeploy=true`；后续已由 [v16 自动部署](24-ci-auto-deploy.md) 补齐，GitLab/Gitea 仍未开放，生产环境继续手动发布。真实 Git、BuildKit、Registry、Kubernetes 和 B6 验收按用户安排暂缓。

## 配置与调用

先通过现有凭据接口创建团队或平台作用域的 `kind=secret` 凭据，payload **只允许**：

```json
{"data":{"webhookSecret":"replace-with-a-random-secret-of-at-least-32-bytes"}}
```

webhookSecret 为 32–256 字节单行字符串；它独立于 Git 拉取凭据，不能混用，不能进入 Job 的执行输入。使用 GitHub 仓库 Webhook 设置中的同一 Secret，Content type 选 application/json，事件选择 Push，Payload URL 使用上述接口。服务需能够被 GitHub 访问；本批没有创建或修改远端 Webhook。

模板的 `ci` 和工作流保存的 CI `definition` 均可配置：

```json
{"manual":true,"push":true,"branch":"main","webhookCredentialId":"<secret-credential-uuid>"}
```

至少启用 manual/push 之一。push=true 必须有 webhookCredentialId；push=false 必须为 null。Push-only 可以保存，setup.canBuild=false，手动构建拒绝。branch 必须与当前应用 Git 分支相同。工作流可以在 Worker 关闭时保存；保存 Push 需要可用的加密密钥及有效的 Secret 结构和作用域。

保存工作流的用户明确承担 Push 授权身份，要求项目配置与构建权限。每次保存 Push CI 都更新授权用户、单条 pipeline.version 和仓库 URL；包括保存整个工作流时 CI 一同保存的情形。GitHub sender 不能决定平台用户，管理员权限也不由匿名请求生成。授权与浏览器 token 过期/退出独立；禁用账号、移除团队/项目资格、关闭 CI、关闭 push 或归档应用均阻止新的准入。排队后的执行还由原有 Build Worker 重验账号与项目权限。

## 验签、过滤及返回

- 首批 provider 只接受 `github`；`gitlab`/`gitea` 明确返回 422 webhook_provider_unsupported。
- 原始 body 上限 1 MiB；必须 application/json。要求单值 X-GitHub-Delivery（规范 UUID）、X-GitHub-Event、X-Hub-Signature-256。对原始字节计算 HMAC-SHA256，以常量时间比较；不使用 Bearer，也不接受 URL 中的认证参数。
- 先验签再解析 JSON；拒绝重复键、多对象、非对象、过深嵌套。允许供应商增加未知字段，业务字段只读取精确键名。错误不回显 payload、签名或 Secret。
- 新 push 需要 ref、完整小写 40 位 SHA-1 after、boolean deleted 和 repository.clone_url。精确匹配 `refs/heads/<branch>`；其他分支、tag、删除、零 SHA、其他仓库均持久返回 ignored。合法非 push 事件（如 ping）同样 ignored。非法 body 不占用 Delivery。
- 仓库按 scheme、host、区分大小写的路径比较；host 不区分大小写，允许末尾 `/` 或 `.git` 差异。不使用仓库名称猜测身份，不接受带账号、query、fragment 的地址。配置仓库变更必须重新保存工作流授权。
- 不请求远程 Git 历史；签名和仓库匹配只证明事件准入，不证明提交可拉取。Build 冻结 signed after，runner 后续在已配置仓库 checkout 此 SHA；不存在或无法拉取的 SHA 会由真实构建失败表达。HTTP 请求不访问 Kubernetes/Registry。

成功统一返回 202，区分：

```json
{"deliveryId":"<github-delivery-uuid>","status":"accepted","buildId":"<build-uuid>"}
```

或 status=ignored、buildId=null。accepted 只表示构建已持久入队；查询现有 Build/Attempt/Artifact 接口获取执行证据。构建环境关闭返回 503 build_environment_unavailable，不保存投递与构建，可用原 Delivery 重试。三个 Worker 的默认关闭值不变。

## 去重、事务与恢复

`pipeline_push_authorizations` 保存 pipeline、授权用户、流水线版本及仓库授权；`webhook_deliveries` 仅保存 provider/pipeline/Delivery、请求摘要、构建引用、状态与时间。摘要覆盖 event 头及原始 body；不保存 payload、sender、仓库事件内容、签名或密钥。数据库触发器禁止修改或删除投递历史。

使用现有 user/team/project/application 锁串行化准入和工作流/成员变更；等待锁后重读用户授权、pipeline 和当前配置，最终锁定并比较签名凭据版本，轮换冲突整体回滚。配置验证、冻结执行输入、Build/Attempt、Delivery 和安全审计同事务提交；任一失败都不占用 Delivery，也不产生孤立构建。

同 provider/pipeline/Delivery 且同摘要重放原响应；不同 body 或 event 返回 409 webhook_delivery_conflict。同 SHA 的不同 Delivery 视作独立触发，不做提交级合并。签名及当前授权仍须有效；CI 禁用或凭据轮换后，旧签名不能用历史记录绕过校验。合法重放不依赖当前 Worker 开关或 Git 在线状态，也不重复审计。有任何投递历史的 CI 不能物理删除，可以禁用或关闭 Push，以保留去重身份；已有 Build 的流水线继续受原外键约束保护。

服务重建后直接读取持久记录；执行继续复用原 Build Worker 的 lease/revision、Job 身份和 unknown 核对，不增加内存回调或第二套执行器。新配置不改写旧 Build 的冻结输入。签名只覆盖 body，GitHub Delivery/event 头不在签名内；TLS、签名密钥保密和 provider 投递身份是信任边界，接口没有声称提供 commit 级防重放。

备份须包含两个新表、Build/Attempt 和 audit_events，保留原凭据密钥。恢复保持三个 Worker 关闭，核对干净 v15 后按既有恢复流程处理。v15 有任何投递历史或 Push 配置时拒绝降级，避免遗忘去重或让旧二进制误读配置。开发数据库未迁移。

最小服务角色增量：

```sql
GRANT SELECT, INSERT ON webhook_deliveries TO podry_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON pipeline_push_authorizations TO podry_service;
```

## 验证与下一步

集成测试入口为 `tests/integration/webhooks_test.go`，使用隔离 PostgreSQL、Git fixture、HTTPS Kubernetes/Registry fixture；验证计数在根 [开发进度](../../DEVELOPMENT_PROGRESS.md) 记录。包含验签字节边界、忽略过滤、原子回滚、并发同 Delivery、服务重建、Worker 关闭后重试、权限撤销/等待锁重验、Secret 轮换、Push-only 和历史降级保护。

后续 v16 已实现 E02 on_ci_success、显式非生产策略、固定上游/产物/版本、持久发布准入、权限重验、去重与恢复，见 [自动部署](24-ci-auto-deploy.md)。生产仍手动；真实供应商投递和真实 CI/CD 继续独立待验收。
