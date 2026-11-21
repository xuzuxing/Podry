# 本地 Gitea、Registry 与 podry-demo

日期：2026-11-20。用户本轮指定本地 Gitea、匿名 Registry 和最小 Go 示例；随后确认远端集群尚未互通，要求先实现业务，后续再提供互通环境。本批不向远端 K3s 提交构建或发布。

## 示例源码

源码位于 [docs/example/podry-demo](../example/podry-demo/README.md)，独立 Go module，不影响 Podry 主模块的依赖。

```text
podry-demo/
  cmd/podry-demo/main.go
  internal/server/router.go
  embed.go
  web/dist/index.html
  go.mod / go.sum
  Dockerfile / .dockerignore / .gitignore
```

Go + chi 提供 `GET /ping`，返回 `pong`；根路径返回 embed 嵌入页面。应用固定监听 `:8080`，多阶段 Dockerfile 使用固定 digest 的 Go 编译镜像和 scratch 运行镜像，非 root 运行，无额外前端编译步骤。

## HTTP 开发服务接入

本地服务检查：Gitea `http://localhost:3000/api/v1/version` 返回 200、版本 28.4.0；Registry `http://localhost:5000/v2/` 返回 200。认证信息只用于本地连接，不写入源码、示例环境文件或验证记录。

新增环境配置（只包含地址）：

```dotenv
PODRY_HTTP_ALLOWED_HOSTS=localhost:3000,localhost:5000
```

按 URL 的完整 host:port 精确匹配，没有通配符，不自动允许其他端口或同名子域。默认空列表继续拒绝所有 HTTP Git/Registry。API 保存、Git reader、构建计划与 Runner 使用一致的协议校验；不修改 Kubernetes HTTPS/mTLS 规则。HTTP endpoint 的放行决定写入不可变 executionSpec，旧 Attempt 不受当前地址列表变化影响；新 Attempt 重新校验当前配置。

Registry 可使用 `credentialId=null`，Git 私有仓库沿用加密凭据中的 username/token（本地账号密码也以该字段存储）。Runner 使用 ASKPASS，不把认证信息写进仓库 URL；源码拉取、API Git 查询和 Registry 复核均拒绝重定向。仅 HTTP Registry 的 BuildKit image exporter 增加 `registry.insecure=true`，HTTPS 继续正常校验证书。

应用配置建议：

| 配置 | 值 |
| --- | --- |
| Git | `http://localhost:3000/admin/podry-demo.git`，分支 main；先推送示例源码 |
| Registry | `http://localhost:5000`，匿名 |
| Dockerfile / context | `Dockerfile` / `.` |
| imageRepository | `podry-demo` |
| platform | `linux/amd64`，与后续 BuildKit/节点匹配 |
| buildArgs | 需要时设置 `GOPROXY=https://goproxy.cn,direct` |
| CI | 手动 build_only，使用提交接口返回的完整 SHA |

上述 localhost 地址只适用于宿主机访问。未来 Kubernetes 构建需要把 Git/Registry 换成 Pod、BuildKit 和后端共同可达的地址，同时更新精确放行列表。BuildKit endpoint、固定 digest 的受控 runner 镜像仍按 [B4 配置](09-build-execution.md) 提供。

## 当前验证边界

已完成示例 `go vet ./...`、`go build ./...` 和后端完整回归 `./scripts/test-backend.ps1`：40 个顶层测试、6 个 Token 子测试通过；1 个真实集群测试因未配置 `PODRY_TEST_KUBE_PAYLOAD` 跳过。HTTP 用例使用真实 PostgreSQL 与受控 Git/Kubernetes/Registry fixture，覆盖默认拒绝、精确地址放行、私有 Git 查询、冻结协议选择、Registry digest 落账、无凭据 URL 与禁止危险协议。

本地 Gitea 已创建专用私有空仓库 `admin/podry-demo`。创建临时 Git 副本并推送的组合命令被自动审批拦截（仅返回 blocked by policy），因此本轮不把仓库创建等同于代码已推送。Windows 临时进程启动和验证组合命令也被拦截；不将其计为通过。示例源码保存在上述目录，可以独立检查和使用。

本地 Docker 构建首次因默认 Go 代理不可达失败；追加 `--build-arg GOPROXY=https://goproxy.cn,direct` 后成功。使用 Docker Desktop 内置 BuildKit 完成以下验证：

| 检查 | 结果 |
| --- | --- |
| 构建与推送 | `localhost:5000/podry-demo:ci-smoke-20261120` 成功 |
| Registry digest | `sha256:88380bb6c6afb423c83a9f9f932ed51c6f1133360e83063f0f6c52c8c13a9d6e` |
| 按不可变 digest 拉取 | 成功 |
| Registry manifest 校验 | 对原始 527 字节计算 SHA-256，与响应 `Docker-Content-Digest` 和推送 digest 一致 |
| 容器 HTTP | 映射到宿主机 `127.0.0.1:18080`，`GET /ping` 返回 200 与 `pong`，`GET /` 返回 200 与嵌入的 `podry-demo` 页面 |

验证容器结束后清理；示例镜像保留在本地 Registry。以上证明示例可构建、运行和推送，不代表 Podry 已在远端执行构建。真实 Gitea → Kubernetes Job → BuildKit → Registry 的完整 CI 链路、受控 runner 实际执行、Helm CD 发布均尚未验收。
