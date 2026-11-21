# Supply immutable, architecture-compatible image references (name@sha256:...).
# RUNTIME_IMAGE must already provide git, CA certificates and /bin/sh.
ARG GO_IMAGE
ARG BUILDKIT_IMAGE
ARG RUNTIME_IMAGE
FROM ${GO_IMAGE} AS compile
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY internal ./internal
COPY cmd/podry-build-runner ./cmd/podry-build-runner
RUN CGO_ENABLED=0 go build -trimpath -o /out/podry-build-runner ./cmd/podry-build-runner
FROM ${BUILDKIT_IMAGE} AS buildkit
FROM ${RUNTIME_IMAGE}
COPY --from=compile /out/podry-build-runner /usr/local/bin/podry-build-runner
COPY --from=buildkit /usr/bin/buildctl /usr/local/bin/buildctl
USER 0:0
ENTRYPOINT ["/usr/local/bin/podry-build-runner"]
