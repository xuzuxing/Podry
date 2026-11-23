/** 离线示例元数据；用于语言、版本、Builder 的联动，不代表上游实时目录。 */
export const buildpackCatalog = [
  { language: 'Node.js', versions: ['22.*', '20.*'], builder: 'paketobuildpacks/builder-jammy-base:latest', versionArgument: 'BP_NODE_VERSION' },
  { language: 'Java', versions: ['21', '17'], builder: 'paketobuildpacks/builder-jammy-base:latest', versionArgument: 'BP_JVM_VERSION' },
  { language: 'Python', versions: ['3.12.*', '3.11.*'], builder: 'paketobuildpacks/builder-jammy-base:latest', versionArgument: 'BP_CPYTHON_VERSION' },
  { language: 'Go', versions: ['1.24.*', '1.23.*'], builder: 'paketobuildpacks/builder-jammy-base:latest', versionArgument: 'BP_GO_VERSION' },
]
