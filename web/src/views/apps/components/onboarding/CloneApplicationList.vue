<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { Application, Project } from '@/types'
const props=defineProps<{applications:Application[];projects:Project[];loading:boolean;error:string}>()
const emit=defineEmits<{select:[id:string];retry:[];scratch:[]}>()
const query=shallowRef('')
const filtered=computed(()=>props.applications.filter(app=>app.name.toLowerCase().includes(query.value.trim().toLowerCase())))
const projectNames=computed(()=>new Map(props.projects.map(project=>[project.id,project.name])))
</script>
<template>
  <section class="clone-list">
    <div class="clone-list__head"><h3>选择要克隆的应用</h3><t-input v-if="applications.length" v-model="query" clearable aria-label="搜索克隆源应用" placeholder="搜索应用名称"><template #prefix-icon><t-icon name="search" /></template></t-input></div>
    <div v-if="loading" class="clone-list__state"><t-loading text="加载源应用…" /></div>
    <div v-else-if="error" class="clone-list__state" role="alert"><t-icon name="error-circle" size="36px" /><p>{{error}}</p><t-button variant="outline" @click="emit('retry')">重新加载</t-button></div>
    <div v-else-if="!applications.length" class="clone-list__state"><t-icon name="file-copy" size="42px" /><h3>还没有可克隆的应用</h3><p>先从零创建一个应用，再复用它的配置。</p><t-button @click="emit('scratch')">从零创建</t-button></div>
    <div v-else-if="!filtered.length" class="clone-list__state"><t-icon name="search" size="42px" /><h3>没有匹配的应用</h3><t-button variant="text" @click="query=''">清空搜索</t-button></div>
    <div v-else class="clone-list__cards">
      <button v-for="application in filtered" :key="application.id" type="button" class="clone-card" :aria-label="`克隆 ${application.name}`" @click="emit('select',application.id)"><span class="clone-card__icon"><t-icon name="application" size="24px" /></span><span class="clone-card__content"><strong>{{application.name}}</strong><span v-if="application.description" class="clone-card__description">{{application.description}}</span><small>{{projectNames.get(application.projectId)??application.projectId}} · {{application.sourceMode==='git'?'源码构建':'容器镜像'}}</small></span><t-icon name="chevron-right" /></button>
    </div>
  </section>
</template>
<style scoped>
.clone-list{display:flex;flex:1;flex-direction:column;min-height:0}.clone-list__head{display:flex;flex-direction:column;gap:12px;padding:20px;flex:none}.clone-list__head h3{font-size:15px;margin:0;line-height:22px}.clone-list__cards{display:flex;flex-direction:column;gap:12px;overflow:auto;min-height:0;padding:0 20px 20px}.clone-card{display:flex;align-items:center;gap:12px;border:1px solid #dce1e7;border-radius:8px;padding:16px;background:#fff;cursor:pointer;text-align:left;color:#000a14;width:100%}.clone-card:hover,.clone-card:focus-visible{border-color:#0066cc;background:#f8fbff}.clone-card__icon{width:40px;height:40px;display:flex;align-items:center;justify-content:center;background:#e8f1ff;color:#0066cc;border-radius:8px;flex:none}.clone-card__content{display:flex;flex:1;flex-direction:column;gap:5px;min-width:0}.clone-card strong{font-size:13px;overflow-wrap:anywhere}.clone-card__description{font-size:12px;color:#596168;overflow-wrap:anywhere;white-space:pre-wrap}.clone-card small{font-size:11px;color:#767d84}.clone-list__state{display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:32px;text-align:center;font-size:13px;color:#767d84}.clone-list__state h3,.clone-list__state p{margin:0}.clone-list__state h3{font-size:15px;color:#3b444c}
</style>
