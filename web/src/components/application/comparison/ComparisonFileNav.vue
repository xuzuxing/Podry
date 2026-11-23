<script setup lang="ts">
import { computed } from 'vue'
import type { ComparisonFile, ComparisonResourceType } from '@/types/configComparison'
import { comparisonTypes, comparisonTypeLabels } from '@/utils/configComparison'

const props = defineProps<{ files: ComparisonFile[]; visibleFiles: ComparisonFile[]; resourceType: ComparisonResourceType; resourceName: string; search: string; changedOnly: boolean; descending: boolean; tab: 'configuration' | 'manifest' }>()
const emit = defineEmits<{ select: [type: ComparisonResourceType, name: string]; tabChange: [value: 'configuration' | 'manifest']; 'update:search': [value: string]; 'update:changedOnly': [value: boolean]; 'update:descending': [value: boolean] }>()
const groups = computed(() => (props.tab === 'manifest' ? ['manifest'] as const : comparisonTypes).map(type => ({ type, label: comparisonTypeLabels[type], items: props.visibleFiles.filter(item => item.type === type), count: props.files.filter(item => item.type === type && item.changed).length })))
const changeCount = computed(() => props.files.filter(item => item.changed).length)
</script>

<template>
  <aside class="comparison-nav">
    <div class="comparison-nav__tabs" role="tablist" aria-label="对比视图"><button type="button" role="tab" :aria-selected="tab === 'configuration'" @click="emit('tabChange', 'configuration')">Configuration</button><button type="button" role="tab" :aria-selected="tab === 'manifest'" @click="emit('tabChange', 'manifest')">Manifest</button></div>
    <div class="comparison-nav__head"><strong>{{ tab === 'manifest' ? '清单文件' : '配置文件' }}</strong><span>{{ changeCount }} 项变更</span><t-button v-if="tab === 'configuration'" size="small" variant="text" :aria-label="descending ? '按名称升序' : '按名称降序'" @click="emit('update:descending', !descending)"><t-icon :name="descending ? 'order-descending' : 'order-ascending'" /></t-button></div>
    <template v-if="tab === 'configuration'">
      <t-input :value="search" clearable placeholder="搜索配置文件" aria-label="搜索对比文件" class="comparison-nav__search" @change="emit('update:search', String($event))"><template #prefix-icon><t-icon name="search" /></template></t-input>
      <div class="comparison-nav__filter"><t-checkbox :checked="changedOnly" @change="emit('update:changedOnly', Boolean($event))">仅显示有变更的文件</t-checkbox></div>
    </template>
    <p v-else class="comparison-nav__help">由配置生成本地 Mock 清单，未执行 Helm 或服务端校验。K8s 版本差异可能影响真实模板输出。</p>
    <nav class="comparison-nav__files cmp__tabs" aria-label="配置文件导航">
      <section v-for="group in groups" :key="group.type" class="comparison-nav__group">
        <button v-if="group.type === 'configmaps' || group.type === 'secrets'" class="comparison-nav__group-title" type="button" :data-count="group.count" @click="emit('select', group.type, group.items[0]?.name ?? '')">{{ group.label }}</button>
        <button v-for="file in group.items" :key="file.key" type="button" class="comparison-nav__file" :class="{ 'is-active': file.type === resourceType && file.name === resourceName }" :title="file.label" @click="emit('select', file.type, file.name)">
          <t-icon :name="file.type === 'deployment' ? 'file-code' : file.type === 'secrets' ? 'lock-on' : 'file'" size="15px" /><span>{{ file.label }}</span><small v-if="file.added" class="is-added">A</small><small v-else-if="file.removed" class="is-removed">D</small><small v-else-if="file.changed" class="is-changed">M</small>
        </button>
        <p v-if="!group.items.length && !search && !changedOnly" class="comparison-nav__empty">无配置文件</p>
      </section>
      <p v-if="!visibleFiles.length" class="comparison-nav__empty">{{ search ? '没有匹配的配置文件' : '没有有变更的文件' }}</p>
    </nav>
  </aside>
</template>

<style scoped>
.comparison-nav__tabs{display:flex;flex:none;height:40px;border-bottom:1px solid #dce1e7}.comparison-nav__tabs button{flex:1;border:0;border-bottom:2px solid transparent;background:#fff;color:#596168;font:inherit;font-size:12px;cursor:pointer}.comparison-nav__tabs button[aria-selected=true]{border-bottom-color:#0066cc;color:#0066cc}.comparison-nav__tabs button:focus-visible{outline:2px solid #0066cc;outline-offset:-3px}.comparison-nav__help{margin:0;padding:8px 16px 12px;border-bottom:1px solid #edf1f5;color:#767d84;font-size:11px;line-height:18px}
.comparison-nav__group-title::after{content:attr(data-count);color:#959ba1;font-size:10px;font-weight:400}
.comparison-nav__file{font-family:inherit;font-size:12px;line-height:20px}
.comparison-nav{display:flex;flex-direction:column;width:256px;flex:none;min-height:0;border-right:1px solid #dce1e7;background:#fff}.comparison-nav__head{display:flex;align-items:center;gap:10px;padding:12px 16px 4px;min-height:38px;font-size:12px}.comparison-nav__head strong{font-weight:600}.comparison-nav__head>span{flex:1;color:#767d84;font-size:11px}.comparison-nav__search{width:calc(100% - 32px);margin:8px 16px}.comparison-nav__filter{padding:0 16px 12px;font-size:11px;border-bottom:1px solid #edf1f5}.comparison-nav__files{flex:1;min-height:0;overflow:auto;padding:8px 0}.comparison-nav__group-title{display:flex;align-items:center;gap:8px;width:100%;height:32px;padding:0 16px;background:none;border:0;color:#596168;text-align:left;font-size:12px;font-weight:600;cursor:pointer}.comparison-nav__group-title small{color:#959ba1;font-weight:400}.comparison-nav__file{display:flex;align-items:center;gap:8px;width:calc(100% - 16px);min-height:34px;margin:0 8px;padding:6px 10px;border:0;border-radius:4px;background:#fff;color:#3b444c;text-align:left;font:inherit;font-size:12px;line-height:20px;cursor:pointer}.comparison-nav__file>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.comparison-nav__file:hover{background:#f2f5f8}.comparison-nav__file.is-active{background:#eaf2fd;color:#0066cc}.comparison-nav__file small{font-size:10px}.is-changed{color:#b77800}.is-added{color:#15995c}.is-removed{color:#d54941}.comparison-nav__empty{padding:8px 18px;font-size:11px;color:#959ba1;margin:0}
</style>
