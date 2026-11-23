# Assemble the controlled binary cross-compiled from this checkout.
# The context must contain only podry-build-runner and the PUBLIC test CA.
FROM moby/buildkit@sha256:baf6138eb8c37644800c7c913fba051e840ebb9ba13eaf92d92ef9a1712d0b4c AS buildkit
FROM alpine/git@sha256:2306e2b05ee0ef99f5d25b0779f645b24ae9f91ba187107503592fcdfe78da3a
USER 0:0
COPY podry-test-ca.crt /usr/local/share/ca-certificates/podry-test-ca.crt
# alpine/git supplies the CA bundle, without update-ca-certificates.
RUN cat /usr/local/share/ca-certificates/podry-test-ca.crt >> /etc/ssl/certs/ca-certificates.crt
COPY --from=buildkit /usr/bin/buildctl /usr/local/bin/buildctl
COPY --chmod=0755 podry-build-runner /usr/local/bin/podry-build-runner
ENTRYPOINT ["/usr/local/bin/podry-build-runner"]
