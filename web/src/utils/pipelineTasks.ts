import type { PipelineTask, TaskInputVariable, TaskVariableFormat, TaskOutputVariable } from '@/types'

import { taskExecutionErrors } from './taskExecution'

export const taskFormats = ['string', 'number', 'boolean', 'date'] as const
export const globalTaskVariables: TaskOutputVariable[] = [
  { key: 'APP_NAME', format: 'string', description: '应用名称' },
  { key: 'GIT_COMMIT', format: 'string', description: '提交 SHA' },
  { key: 'GIT_BRANCH', format: 'string', description: '构建分支' },
]
export interface TaskReference { value: string; label: string; taskId: string; variable: string; format: TaskVariableFormat }
export const copyTasks = (tasks: PipelineTask[]): PipelineTask[] => JSON.parse(JSON.stringify(tasks))
export function taskReferences(tasks: PipelineTask[]): TaskReference[] {
  return tasks.flatMap(task => (task.outputs ?? []).map(variable => ({
    value: JSON.stringify([task.id, variable.key]), label: `${task.name} / ${variable.key}`,
    taskId: task.id, variable: variable.key, format: variable.format ?? 'string',
  })))
}
export function taskValueError(value: string, format: TaskVariableFormat = 'string'): string {
  if (!value.trim()) return '请填写变量值'
  if (format === 'number' && !Number.isFinite(Number(value))) return '变量值必须是 Number'
  if (format === 'boolean' && !['true', 'false', 'True', 'False'].includes(value)) return '变量值必须是 true 或 false'
  if (format === 'date') {
    const day = value.slice(0,10)
    const timestamp = Date.parse(value)
    const dayTimestamp = Date.parse(day)
    if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) || !Number.isFinite(timestamp) || !Number.isFinite(dayTimestamp) || new Date(dayTimestamp).toISOString().slice(0,10) !== day) return '变量值必须是有效日期'
  }
  return ''
}
export function inputVariableError(variable: TaskInputVariable, previous: PipelineTask[]): string {
  if (variable.source === 'task') {
    const output = taskReferences(previous).find(item => item.taskId === variable.refTaskId && item.variable === variable.refVariable)
    if (!output) return '引用的前序任务输出不可用，请重新选择'
    if (output.format !== (variable.format ?? 'string')) return '引用变量类型不匹配'
    return ''
  }
  if (variable.source === 'global') {
    const global = globalTaskVariables.find(item => item.key === variable.value)
    if (!global) return '全局变量不可用'
    return (global.format ?? 'string') === (variable.format ?? 'string') ? '' : '全局变量类型不匹配'
  }
  return taskValueError(variable.value, variable.format)
}
export function validatePipelineTasks(pre: PipelineTask[], post: PipelineTask[]): Record<string, string[]> {
  const errors: Record<string, string[]> = {}
  const all = [...pre, ...post]
  all.forEach((task, index) => {
    const messages: string[] = taskExecutionErrors(task)
    if (!task.id || all.filter(item => item.id === task.id).length !== 1) messages.push('任务标识不能重复')
    if (!task.name.trim()) messages.push('请填写任务名称')
    if (!['shell','container'].includes(task.execution) || !['always','success','failure'].includes(task.condition)) messages.push('任务执行方式或运行条件无效')
    if (task.execution === 'container' && (task.outputs?.length || task.resultRule)) messages.push('Container 任务不支持脚本输出变量')
    for (const [label, variables] of [['输入', task.variables], ['输出', task.outputs ?? []]] as const) {
      for (const variable of variables) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable.key) || variable.key.length > 255) messages.push(`${label}变量名无效`)
        if (variables.filter(item => item.key === variable.key).length !== 1) messages.push(`${label}变量名不能重复`)
        if (!taskFormats.includes(variable.format ?? 'string')) messages.push(`${label}变量类型无效`)
      }
    }
    task.variables.forEach(variable => {
      if (variable.source && !['literal','global','task'].includes(variable.source)) messages.push('输入变量来源无效')
      const message = inputVariableError(variable, all.slice(0, index))
      if (message) messages.push(`${variable.key || '输入变量'}：${message}`)
    })
    for (const [group, variables, modes] of [[task.triggerRule, task.variables, ['trigger', 'skip']], [task.resultRule, task.outputs ?? [], ['pass', 'fail']]] as const) {
      if (!group) continue
      if (!modes.some(mode => mode === group.mode) || !group.conditions.length) messages.push('条件规则不能为空')
      for (const condition of group.conditions) {
        const variable = variables.find(item => item.key === condition.variable)
        if (!variable) { messages.push('条件引用的变量不存在'); continue }
        if (!['==', '!=', '<', '>', '<=', '>='].includes(condition.operator)) messages.push('条件运算符无效')
        if ((variable.format ?? 'string') !== 'number' && variable.format !== 'date' && !['==', '!='].includes(condition.operator)) messages.push('String / Boolean 只支持 == 和 !=')
        const message = taskValueError(condition.value, variable.format)
        if (message) messages.push(`条件：${message}`)
      }
    }
    if (messages.length) errors[task.id] = [...new Set(messages)]
  })
  return errors
}
