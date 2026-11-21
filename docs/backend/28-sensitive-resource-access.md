# Secret 明文与 Pod 终端

日期：2026-11-21–2026-11-22。补齐 E09 的三个 HTTP 操作；WebSocket 沿用 [终端协议](../api/01-api-spec.md#5-pod-终端协议)。不新增表或迁移，数据库仍为 v17。

- `POST /api/clusters/{clusterId}/secrets/reveal`：独立 `secret.reveal`，精确 core/v1 Secret、namespace/name/UID/resourceVersion、1–64 个唯一 key、1–500 字理由。仅返回指定 key 的 Base64 bytes，缺失 key 整体拒绝。读取前和释放结果前检查当前账号、成员、授权、凭据；审计与最终检查同事务。值和理由原文不落库、不记录、不进入幂等缓存；响应 no-store。
- `POST /api/clusters/{clusterId}/exec-sessions`：独立 `pod.exec`，精确 core/v1 Pod UID、容器和 command 数组；不隐式添加 shell。返回 30 秒一次性票据和同源 WebSocket 路径。创建不执行命令；握手消费后才建立 Kubernetes exec。
- `DELETE /api/exec-sessions/{sessionId}`：仅当前拥有者；关闭待连接或活动会话，取消上游并释放资源。无会话或其他用户统一 404。

票据使用 32 字节随机值，服务端只保存摘要；通过 `Sec-WebSocket-Protocol: podry.exec.v1, ticket.<ticket>` 传递，仅回显 `podry.exec.v1`，禁止 query 票据。票据是创建者的短期连接能力，服务端从会话恢复用户身份并重新检查账号/授权，不依赖浏览器不能设置的 Authorization 头。若握手携带 Authorization，仍须匹配创建者的当前身份。错误 Origin/应用协议不消费票据；通过来源、应用协议和票据检查后原子消费，后续传输握手或上游失败也不能重放。

HTTP 创建与 WebSocket 必须使用同一 Origin；有 Origin 的创建请求也必须同源，WebSocket 必须有该 Origin。默认按直接请求的 scheme/Host 校验。HTTPS 反向代理可显式设置 `PODRY_PUBLIC_ORIGIN=https://podry.example.com`，只接受这个精确 Origin，不接受路径、query、fragment 或内嵌凭据；客户端 Forwarded/X-Forwarded-* 不参与判断。配置为空时适用于直连或保留同源 Host 的 HTTP 代理。票据、命令、终端内容禁止出现在网关访问日志中。

JSON 文本帧沿用 stdin/resize/close 与 stdout/stderr/exit/error。最大输入帧 64 KiB、输入/输出各 20 MiB；命令最多 32 项、共 8 KiB，容器名严格验证。stdin 额外队列最多 4 帧，目标不读输入时仍能检测浏览器断开；队列满以 exec_input_backpressure 关闭，不能无限缓冲。TTY 模式合并 stderr；resize 仅用于 TTY，尺寸 1–4096。写入有 5 秒期限。会话在登录到期、10 分钟输入空闲或最长 1 小时后关闭；每 5 秒重验当前账号/权限/凭据及 Pod UID/容器，替换或撤权关闭。全局最多 16 个、每用户最多 2 个会话，待握手也计入；和日志配额独立。

会话是单实例进程内临时资源，不持久化命令或票据。未消费票据到期自动回收；断线、DELETE、协议错误、预算耗尽、退出和服务 drain 取消并回收上游。重启后旧 session/ticket 失效。多实例需要粘性路由，当前不支持跨实例恢复。终端是用户显式动作，不受四个默认关闭的后台 Worker 开关控制。

上游使用锁定 client-go 的 SPDY remotecommand、POST pods/exec、TLS/mTLS/token 与禁止重定向；集群身份需要 pods get 和 pods/exec create。握手响应有 10 秒时限，取消会关闭原始连接；拒绝响应直接关闭，不读取无界错误 body。正常 UTF-8 在流块/帧边界保留，其他二进制按 JSON 字符串的替代字符语义显示。Kubernetes exec 没有 UID 条件写入，平台只能在连接前与连接后持续核对 UID；同名 Pod 在最终核对与上游接受之间替换仍有竞态，不能声称原子 UID 执行保证。命令不会自动重试。

创建、连接、显式关闭的审计成功后才继续对应动作。结束审计遵守既有 accepted/succeeded/failed/denied/unknown 枚举：收到退出码才记 succeeded/failed；中途断线/撤销无法确认进程结果时记 unknown。结束记录失败仅输出无敏感内容的警告，不能撤回已经执行的命令。终端内容、argv 和票据不进入这些审计。

Secret 请求示例（`uid`、`resourceVersion` 必须替换为当前对象身份）：

```json
{"ref":{"group":"","version":"v1","resource":"secrets","namespace":"demo","name":"credentials","uid":"current-uid","resourceVersion":"7"},"keys":["password"],"reason":"排查连接失败"}
```

终端创建请求示例：

```json
{"ref":{"group":"","version":"v1","resource":"pods","namespace":"demo","name":"demo","uid":"current-pod-uid","resourceVersion":""},"container":"app","command":["/bin/sh"],"tty":true}
```

浏览器使用响应建立连接，路径与网页同源；连接失败需重新创建会话，不重放已消费的票据：

```js
const url = new URL(session.webSocketPath, location.origin);
url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const socket = new WebSocket(url, ['podry.exec.v1', `ticket.${session.ticket}`]);
socket.onopen = () => socket.send(JSON.stringify({type:'resize', cols:120, rows:36}));
// 输入：socket.send(JSON.stringify({type:'stdin', data:'ls\n'}));
// 页面离开：关闭 socket；也可带 Bearer 调用 DELETE /api/exec-sessions/{sessionId}。
```

验证使用隔离 PostgreSQL、本机 HTTPS/SPDY/WebSocket fixture，不接触真实集群或真实 CI/CD；最终验证结果记录于根开发进度。

## 最终验证（2026-11-22）

新增 15 个顶层、32 个子用例已通过，覆盖三个 HTTP 操作和实际 WebSocket/SPDY 的输入、输出、TTY、退出、票据/身份/权限/UID、预算、取消和回收。最终代码的全量用例按清单分段核对：187 个顶层、160 个子用例通过，1 个真实集群用例跳过，遗漏 0。单次全量原 600 秒预算耗尽；补跑剩余 42 个实际用例成功，不能称为单次全量退出码 0。脚本总预算已提高为 900 秒。

结束审计枚举与 stdin 背压问题已修正；内部包/命令包、最终 resource/config 专项、go vet/build、Linux 编译、最小数据库角色、sqlc vet、独立 OpenAPI 重生成及静态检查通过。真实集群、前后端联调和 CI/CD 未验收。日志与完整过程见 [开发进度](../../DEVELOPMENT_PROGRESS.md)。
