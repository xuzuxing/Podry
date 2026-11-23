import type { PipelineTask, TaskContainerConfig } from '@/types'

export function newContainerConfig(): TaskContainerConfig {
  return {
    command: '', args: [], mountCustomScript: false, scriptMountPath: '', ports: [],
    mountSource: false, sourceMountPath: '/sourcecode', mountHost: false, hostPaths: [],
  }
}
/** 旧版 Container 只有脚本；读入时保留其脚本语义，首次编辑后保存结构化配置。 */
export function containerConfigOf(task: PipelineTask): TaskContainerConfig {
  return task.container ?? {
    ...newContainerConfig(), mountCustomScript: true, scriptMountPath: '/script.sh',
    command: '/bin/sh', args: ['/script.sh'],
  }
}
export function outputPathsOf(task: PipelineTask): string[] {
  return task.outputDirectoryPaths ?? task.artifactPaths.split(',').map(path => path.trim()).filter(Boolean)
}
const absolutePath = (path: string): boolean => path.startsWith('/') && !/[\r\n\0]/.test(path)
export function taskExecutionErrors(task: PipelineTask): string[] {
  const errors: string[] = []
  if (task.execution === 'shell' && !task.script.trim()) errors.push('请填写任务脚本')
  if (task.execution === 'container') {
    const config = containerConfigOf(task)
    if (!task.image.trim()) errors.push('请填写 Container image')
    if (config.mountCustomScript) {
      if (!task.script.trim()) errors.push('请填写任务脚本')
      if (!absolutePath(config.scriptMountPath) || config.scriptMountPath.endsWith('/')) errors.push('脚本挂载路径必须是绝对文件路径')
    }
    if (config.args.some(value => !value.trim())) errors.push('Args 不能包含空参数')
    const hosts = new Set<string>()
    config.ports.forEach((port, index) => {
      if ([port.hostPort, port.containerPort].some(value => !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)) errors.push(`端口映射 ${index + 1}：端口必须是 1–65535 的整数`)
      if (hosts.has(String(Number(port.hostPort)))) errors.push('Host port 不能重复')
      hosts.add(String(Number(port.hostPort)))
    })
    if (config.mountSource && !absolutePath(config.sourceMountPath)) errors.push('源码挂载目录必须是绝对路径')
    if (config.mountHost) {
      if (!config.hostPaths.length) errors.push('请至少添加一条主机目录映射')
      config.hostPaths.forEach((path, index) => {
        if (!absolutePath(path.hostPath) || !absolutePath(path.containerPath)) errors.push(`目录映射 ${index + 1}：主机和容器路径均须为绝对路径`)
      })
    }
  }
  const paths = outputPathsOf(task)
  paths.forEach((path, index) => {
    if (!path.trim()) errors.push(`产物路径 ${index + 1} 不能为空`)
    if (path.trim().startsWith('/devtroncd')) errors.push('产物路径不能使用保留目录 /devtroncd')
  })
  return errors
}
