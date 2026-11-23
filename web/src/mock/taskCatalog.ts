import type { PipelineTask, TaskInputVariable, TaskOutputVariable } from '@/types'

import { newContainerConfig } from '@/utils/taskExecution'

export interface TaskPluginVersion {
  version: string
  inputs: TaskInputVariable[]
  outputs: TaskOutputVariable[]
  script: string
}
export interface TaskPlugin {
  id: string
  name: string
  description: string
  tag: string
  versions: TaskPluginVersion[]
}
/** 本地示例目录，用于验证插件选择和版本参数表单；不是 Devtron 远程插件元数据。 */
export const taskCatalog: TaskPlugin[] = [
  {
    id: 'mock-npm', name: 'Execute npm scripts', tag: 'Build',
    description: '配置工作目录中的 npm 命令，收集测试结果。',
    versions: [
      { version: 'mock-v2', inputs: [{key:'COMMAND', value:'test', format:'string'}, {key:'CI', value:'true', format:'boolean'}], outputs: [{key:'EXIT_CODE', format:'number', description:'命令退出码'}], script: 'npm run "$COMMAND"\nexport EXIT_CODE=$?\n' },
      { version: 'mock-v1', inputs: [{key:'COMMAND', value:'test', format:'string'}], outputs: [{key:'EXIT_CODE', format:'number', description:'命令退出码'}], script: 'npm run "$COMMAND"\nexport EXIT_CODE=$?\n' },
    ],
  },
  {
    id: 'mock-http', name: 'HTTP request', tag: 'Utilities',
    description: '配置 HTTP 请求地址和超时，输出响应状态码。',
    versions: [
      { version: 'mock-v1', inputs: [{key:'URL',value:'',format:'string'}, {key:'TIMEOUT',value:'30',format:'number'}], outputs: [{key:'STATUS_CODE',format:'number',description:'HTTP 响应状态码'}], script: 'export STATUS_CODE=$(curl --max-time "$TIMEOUT" -s -o /dev/null -w "%{http_code}" "$URL")\n' },
    ],
  },
]

export function createTask(execution: PipelineTask['execution'], count: number): PipelineTask {
  return { id: crypto.randomUUID(), name: `Task ${count + 1}`, execution, script: '#!/bin/sh\nset -eu\n', image: '', workingDirectory: './', condition: 'success', variables: [], outputs: [], artifactPaths: '', ...(execution === 'container' ? { container: newContainerConfig() } : {}) }
}
export function applyTaskPlugin(task: PipelineTask, plugin: TaskPlugin, version: TaskPluginVersion): PipelineTask {
  return {
    ...task, plugin: { id: plugin.id, version: version.version }, execution: 'shell', script: version.script,
    variables: version.inputs.map(input => {
      const old = task.variables.find(item => item.key === input.key && (item.format ?? 'string') === input.format)
      return { ...input, ...(old ?? {}) }
    }),
    outputs: version.outputs.map(output => ({ ...output })),
  }
}
