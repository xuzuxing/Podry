/** 仅用于 payment-worker 的显式示例目录，不代表 Devtron 服务端作用域优先级。 */
export function mockScopedVariables(appId: string, environment: string): Record<string, string> {
  if (appId !== 'a-payment') return {}
  return { 'payment-region': environment === 'e-prod' ? 'cn-shanghai' : 'cn-hangzhou', 'payment-queue': environment === 'e-prod' ? 'payments-prod' : 'payments-dev' }
}
