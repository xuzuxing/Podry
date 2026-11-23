/** 配置/工作流保存后的轻量通知：配置布局据此刷新 setup 进度。 */
type SetupHandler = (appId: string) => void

const handlers = new Set<SetupHandler>()

export function onSetupChanged(handler: SetupHandler): () => void {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}

export function notifySetupChanged(appId: string): void {
  handlers.forEach((handler) => handler(appId))
}

/** 概览元信息保存后刷新应用页头与项目内切换目录。 */
const applicationHandlers = new Set<SetupHandler>()
export function onApplicationChanged(handler: SetupHandler): () => void {
  applicationHandlers.add(handler)
  return () => { applicationHandlers.delete(handler) }
}
export function notifyApplicationChanged(appId: string): void {
  applicationHandlers.forEach(handler => handler(appId))
}
