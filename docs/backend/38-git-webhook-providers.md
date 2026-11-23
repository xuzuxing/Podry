# GitHub、Gitea、GitLab 与 Gitee Push Webhook

日期：2026-11-23。在既有 [GitHub 构建准入](23-git-webhooks.md) 上增加三个 provider，复用原持久 Build/Attempt、委托身份、锁顺序、凭据版本重验与安全审计。OpenAPI V1.24.0，仍为 79 个 HTTP 操作。正式迁移 v18，仅扩展 webhook_deliveries.provider 的 CHECK，仍为 36 张业务表；sqlc 查询和生成模型不变。

## 接入步骤

1. 通过现有凭据接口创建独立 `kind=secret` 凭据，团队/平台作用域规则不变。Secret 不使用 Git 拉取凭据，也不下发给 runner。
2. 保存 Git/构建配置及 CI，配置 `push=true`、正确 branch 和 webhookCredentialId。最后保存 CI 的用户承担 Push 委托；供应商 sender 不决定平台身份。
3. 在仓库 Webhook 设置填写 `https://<Podry 公网入口>/api/webhooks/git/<provider>/<CI pipeline UUID>`，选择 JSON、Push 事件并保持 TLS 校验。provider 是下表的小写值，UUID 是 CI pipeline ID，不是 app ID。
4. 供应商侧使用与凭据一致的认证方式和 Secret。返回 202 accepted 表示构建已入队，通过已有 Build/Attempt/Artifact 接口检查执行。ignored 同为 202，不生成 Build。

默认凭据结构保持兼容：

```json
{"data":{"webhookSecret":"replace-with-a-random-secret-of-at-least-32-bytes"}}
```

webhookSecret 为 32–256 字节单行字符串。可选 `data.webhookAuthMode` 仅接受 `signature` 或 `token`，不允许其他 payload/data 字段。认证模式来自服务端凭据，不从请求头推测，签名失败不能回退 Token。GitHub/Gitea 仅允许 signature；GitLab/Gitee 同时支持下表方式。

| provider | 认证 | 事件/投递身份 |
| --- | --- | --- |
| github | X-Hub-Signature-256=`sha256=<hex HMAC-SHA256(raw body)>` | X-GitHub-Event=push；X-GitHub-Delivery 为 UUID |
| gitea | X-Gitea-Signature=`<hex HMAC-SHA256(raw body)>`，没有 sha256= 前缀 | X-Gitea-Event=push；X-Gitea-Delivery 为 UUID |
| gitlab | 普通 Secret 默认恒定时间比较 X-Gitlab-Token；`whsec_` 前缀默认使用 Standard Webhooks 签名，也可显式选择模式 | X-Gitlab-Event=Push Hook；优先 webhook-id，其次 Idempotency-Key，最后兼容旧版 X-Gitlab-Event-UUID |
| gitee | 默认时间戳签名；密码方式需显式 webhookAuthMode=token，并恒定时间比较 X-Gitee-Token | X-Gitee-Event=Push Hook；无稳定 Delivery 头，平台计算事件内容摘要 |

GitLab 新版 Signing token 原样保存（含 `whsec_`）；对去前缀后的 Base64 解码密钥计算 `HMAC-SHA256(webhook-id + "." + webhook-timestamp + "." + raw body)`。webhook-signature 允许空格分隔多个 `v1,<Base64>` 签名；时间戳为秒，容忍前后 5 分钟。三个 Standard Webhooks 头均必需，不回退旧版投递 ID。旧版 Secret Token 模式不要求时间戳。旧版 Event UUID 在递归事件链中可能重复；优先使用稳定的 webhook-id/Idempotency-Key，不使用每次请求可能变化的 X-Gitlab-Webhook-UUID 去重。

Gitee 签名为 `URL-encode(Base64(HMAC-SHA256(secret, X-Gitee-Timestamp + "\n" + secret)))`。时间戳为毫秒，按官方约定容忍前后 1 小时。兼容原始 Base64 及 URL 编码 Base64，不将原始 `+` 解为空格。使用密码方式时凭据示例：

```json
{"data":{"webhookSecret":"replace-with-a-random-gitee-password-at-least-32-bytes","webhookAuthMode":"token"}}
```

Gitee 的官方签名没有覆盖 body；GitLab/Gitee Token 模式也没有 body MAC，必须依赖受信任 HTTPS 入口保护请求内容。不能将这些方式描述成原始 body 完整性验签。payload.password/sign/timestamp 仅为供应商数据，不能代替请求头认证；不持久化、不写入审计或执行输入。

## 过滤、身份与去重

- JSON 上限 1 MiB，仅 application/json。先认证后严格解析；拒绝重复键、多对象、null、数组、错误标量及过深嵌套。签名/Token/时间戳不允许重复头；身份头单值且长度有界。
- GitHub/Gitee 读取 ref、after、boolean deleted、repository.clone_url。Gitea 官方 PushPayload 没有 deleted，因此允许省略；若存在则必须 boolean。GitLab 读取 object_kind=push、ref、after、project.git_http_url，删除用零 SHA 识别。
- after 要求完整小写 40 位 SHA-1。只接受配置仓库和精确 refs/heads/branch；tag、删除、零 SHA、其他分支/仓库及其他合法事件均持久 ignored。仓库 scheme/host/path 比较与既有 GitHub 合同一致，不从仓库名或 sender 猜身份。
- GitHub/Gitea/GitLab 摘要覆盖事件头加原始 body；同 provider/pipeline/delivery 同摘要重放原始响应，不同摘要返回 409。不同 provider 的相同投递 ID 不冲突。GitHub/Gitea 的 event/delivery 头不在 body HMAC 内；GitLab Standard Webhooks 的 event 头也不在签名内，TLS 与供应商身份仍是信任边界。
- Gitee 没有已约定的稳定 Delivery 头，因此 deliveryId=`sha256:<digest>`：事件头加 JSON 规范化内容，去除顶层 password/sign/timestamp。对象键排序且使用 JSON number 保留整数精度。重签名、字段排序或空白变化重放同一结果；业务内容变化是新事件。完全相同的业务事件会合并，不能声称区分两个内容相同的独立投递。
- 当前授权、CI 启用/Push、凭据签名/模式及版本在重放时仍检查；时间戳签名仍需新鲜。重试需由供应商重新生成有效签名，不能用过期认证头重放。503 不消费投递身份。
- 新事件的当前 Git 配置/委托版本、构建就绪、冻结 SHA 与构建输入、Build/Attempt、Delivery 及审计同事务提交。审计失败整体回滚；同一 CI 并发相同投递只产生一个 Build/Attempt。
- 供应商 HTTP 请求不查询远程 Git、不写集群、不直接发布。成功构建后复用既有显式非生产 [on_ci_success](24-ci-auto-deploy.md) 策略；生产保持手动。

## 迁移、恢复与运行边界

运行新二进制前显式执行 `podry migrate up` 到干净 v18；API 启动不执行迁移，v17 和 dirty 均拒绝启动。新建库及既有库升级使用同一正式迁移。v18 降到 v17 时，只要存在任意非 GitHub Delivery（含 ignored）就拒绝，保留所有不可变历史，不能清除去重表后降级。失败迁移会按 migrate 原有行为留下 dirty 标识，需要操作者核实后按既有恢复合同处理。

没有新增数据库表、运行权限或 Worker；后台四开关默认值不变。服务重建直接读取投递记录，执行仍由原 Worker 租约/fencing/unknown 核对驱动。备份继续包含 webhook_deliveries、pipeline_push_authorizations、Build/Attempt、自动部署意图、审计及 Vault 密钥。

## 协议依据与验证范围

协议参考：

- [Gitea Webhooks](https://docs.gitea.com/usage/webhooks) 和 [PushPayload 定义](https://github.com/go-gitea/gitea/blob/main/modules/structs/hook.go)。
- [GitLab Webhooks](https://docs.gitlab.com/user/project/integrations/webhooks/) 和 [Push 事件](https://docs.gitlab.com/user/project/integrations/webhook_events/#push-events)。
- [Gitee 推送格式](https://help.gitee.com/webhook/gitee-webhook-push-data-format)、[Gitee 签名算法](https://help.gitee.com/webhook/how-to-verify-webhook-keys)。

单元测试覆盖真实供应商字段形态、HMAC/Standard Webhooks/Gitee 时间戳签名、Token、重复头、过期/未来时间戳、签名模式不降级、JSON 内容身份及 GitLab 投递 ID 优先级。隔离 PostgreSQL 集成测试验证 provider 路由、验签、过滤、503 重试、审计回滚、并发单构建、Worker fixture 执行、服务重建重放、重签名、凭据轮换、关闭 Push 与迁移历史保护。

本批测试使用隔离数据库、Git/HTTPS Kubernetes/Registry fixture，不代表 Gitea/GitLab/Gitee 真实供应商外部投递或真实 CI/CD 全链路验收；未创建远端仓库 Webhook、迁移开发库或重启现有测试 API。最终验证结果见根 [开发进度](../../DEVELOPMENT_PROGRESS.md)。
