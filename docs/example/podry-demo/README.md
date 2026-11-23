# podry-demo

用于 Podry CI/CD 联调的最小 Go + chi + embed 应用，监听 `:8080`。

- `GET /ping`：返回纯文本 `pong`。
- `GET /version`：返回编译时版本标记，默认 `dev`；构建参数 `APP_VERSION` 可覆盖，用于核对升级和镜像回滚。
- `GET /`：返回编译进二进制的 `web/dist/index.html`。

```powershell
go run ./cmd/podry-demo
curl.exe http://localhost:8080/ping
```

```powershell
docker build -t localhost:5000/podry-demo:local .
docker push localhost:5000/podry-demo:local
docker run --rm -p 18080:8080 localhost:5000/podry-demo:local
curl.exe http://localhost:18080/ping
```

如果构建容器不能访问默认 Go 代理，可追加 `--build-arg GOPROXY=https://goproxy.cn,direct`；应用 Build 配置也可以通过非敏感 buildArgs 设置 GOPROXY。

版本验收示例：`docker build --build-arg APP_VERSION=live-v2 -t localhost:5000/podry-demo:v2 .`，或在 Podry 的 buildArgs 中设置 `APP_VERSION=live-v2`。访问 `/version` 应返回 `live-v2`。较早 main 的历史镜像还没有此接口，回滚到该镜像后 `/version` 返回 404，`/ping` 仍返回 pong。

应用 Build 配置使用仓库根目录作为 context、`Dockerfile` 作为构建文件，imageRepository 为 `podry-demo`。Registry 和 Git 地址应从执行环境可达；构建 Pod 内的 localhost 指向 Pod 自身。前端文件已随源码提供，无需 Node 或前端构建步骤。

## 一次性 Job 示例

`cmd/podry-job` 打印 `podry-job: pong` 后以退出码 0 结束，用于验证 Helm Job 发布及历史快照重新执行。常驻 Web 服务继续使用原来的 `Dockerfile`。

```powershell
go run ./cmd/podry-job
docker build -f Dockerfile.job -t localhost:5000/podry-job:local .
docker run --rm localhost:5000/podry-job:local
```

Job 应用的 Build 配置选择 `Dockerfile.job`、context=`.` 和单独的镜像仓库；Base 配置选择 workloadKind=`Job`，无需 Service 或 Ingress。

`BUILD_HOLD_SECONDS` 是专用于真实构建取消验收的等待步骤，默认 0，接受 0–300 的整秒数；例如 buildArgs 中设置 `BUILD_HOLD_SECONDS=90`。只有日志出现实际执行输出 `#步骤 时间 podry-live-build-hold:90` 后才发起取消，不能把日志打印的 Dockerfile 命令当作已执行。正常构建保持默认值。对应验收器见 [构建动作脚本](../../../scripts/test-cicd-actions-live.mjs)。
