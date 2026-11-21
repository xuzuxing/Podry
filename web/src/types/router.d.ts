import 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    public?: boolean
    hidden?: boolean
    activeMenu?: string
    tab?: string
  }
}

export {}
