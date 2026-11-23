param(
    [Parameter(Mandatory = $true)][string]$Kubeconfig,
    [Parameter(Mandatory = $true)][string]$ImageRef,
    [Parameter(Mandatory = $true)][string]$EvidencePath,
    [switch]$InsecureKubernetes,
    [switch]$UseExistingTestDatabase
)

# Explicit live acceptance: creates an isolated database and random namespace.
# Never enables cleanup in the development API. The image must exit successfully
# without arguments, support Linux/amd64, and allow anonymous pulls.
$ErrorActionPreference = 'Stop'
if ($UseExistingTestDatabase -and -not $env:PODRY_TEST_DATABASE_URL) {
    throw 'UseExistingTestDatabase requires PODRY_TEST_DATABASE_URL for a dedicated PostgreSQL server with CREATEDB.'
}
if ($ImageRef -notmatch '^[a-z0-9][a-z0-9./:_-]*@sha256:[0-9a-f]{64}$') {
    throw 'ImageRef must contain an immutable sha256 digest.'
}
$resolvedKubeconfig = (Resolve-Path -LiteralPath $Kubeconfig).Path
$resolvedEvidence = [IO.Path]::GetFullPath($EvidencePath)
if ((Test-Path -LiteralPath $resolvedEvidence) -or -not (Test-Path -LiteralPath ([IO.Path]::GetDirectoryName($resolvedEvidence)) -PathType Container)) {
    throw 'EvidencePath must be a new file in an existing directory; each run owns fresh fixtures.'
}

# Only import inline credentials. Do not execute kubeconfig auth plugins or read
# arbitrary certificate/token files. The raw config stays in process memory.
$rawConfig = & kubectl --kubeconfig $resolvedKubeconfig config view --raw -o json 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Unable to read the selected kubeconfig.' }
$kube = ($rawConfig -join "`n") | ConvertFrom-Json
$context = @($kube.contexts | Where-Object { $_.name -eq $kube.'current-context' })
if ($context.Count -ne 1) { throw 'Select exactly one current kubeconfig context.' }
$cluster = @($kube.clusters | Where-Object { $_.name -eq $context[0].context.cluster })
$user = @($kube.users | Where-Object { $_.name -eq $context[0].context.user })
if ($cluster.Count -ne 1 -or $user.Count -ne 1) { throw 'The context must reference one cluster and one user.' }
$clusterConfig = $cluster[0].cluster
$userConfig = $user[0].user
if ($userConfig.exec -or $userConfig.'auth-provider' -or $userConfig.tokenFile -or $userConfig.'client-certificate' -or $userConfig.'client-key' -or $clusterConfig.'certificate-authority') {
    throw 'Live cleanup accepts inline token or client certificate credentials only.'
}
$payload = @{ apiServer = $clusterConfig.server; insecureSkipTLSVerify = [bool]($InsecureKubernetes -or $clusterConfig.'insecure-skip-tls-verify') }
if ($clusterConfig.'certificate-authority-data') { $payload.certificateAuthorityData = $clusterConfig.'certificate-authority-data' }
if ($userConfig.token) { $payload.token = $userConfig.token }
if ($userConfig.'client-certificate-data') { $payload.clientCertificateData = $userConfig.'client-certificate-data' }
if ($userConfig.'client-key-data') { $payload.clientKeyData = $userConfig.'client-key-data' }
if (-not $payload.token -and (-not $payload.clientCertificateData -or -not $payload.clientKeyData)) {
    throw 'The selected context has no supported inline authentication.'
}

$savedCleanupEnvironment = @{}
$cleanupEnvironment = @{
    PODRY_TEST_CLEANUP_LIVE = '1'
    PODRY_TEST_KUBE_PAYLOAD = ($payload | ConvertTo-Json -Compress -Depth 10)
    PODRY_TEST_CLEANUP_IMAGE = $ImageRef
    PODRY_TEST_CLEANUP_EVIDENCE = $resolvedEvidence
}
try {
    foreach ($key in $cleanupEnvironment.Keys) {
        $savedCleanupEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
        [Environment]::SetEnvironmentVariable($key, $cleanupEnvironment[$key], 'Process')
    }
    if ($UseExistingTestDatabase) {
        Push-Location (Join-Path $PSScriptRoot '..')
        try {
            go test ./tests/integration -count=1 -run '^TestResourceCleanupLive$' -v -timeout 600s
            if ($LASTEXITCODE -ne 0) { throw 'Live cleanup acceptance failed.' }
        } finally { Pop-Location }
    } else {
        & (Join-Path $PSScriptRoot 'test-backend.ps1') -Native -TestPattern '^TestResourceCleanupLive$'
    }
} finally {
    foreach ($key in $savedCleanupEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($key, $savedCleanupEnvironment[$key], 'Process')
    }
}
