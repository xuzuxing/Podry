export interface ResourceRow {
  id: string
  name: string
  namespace: string
  kind: string
  status: string
  age: string
  group: string
  /** 按 Kind 变化的列值 */
  fields: Record<string, string>
  sortValues?: Record<string, string | number | null>
}

export interface ResourceColumn { key: string; label: string; width?: number; mandatory?: boolean }
export type ResourceAction = 'delete' | 'restart' | 'scale' | 'cordon' | 'uncordon' | 'drain' | 'taints'
