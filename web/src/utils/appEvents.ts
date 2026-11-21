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
