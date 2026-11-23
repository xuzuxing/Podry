<script setup lang="ts">
import type { ConfigEntryItem } from '@/utils/configEntries'
import { entryData } from '@/utils/configEntries'
defineProps<{ items: ConfigEntryItem[]; selected: string; override: boolean; creating: boolean; label: string }>()
defineEmits<{ select: [name: string]; create: [] }>()
</script>
<template>
  <aside class="entry-list">
    <div class="entry-list__heading"><t-button size="small" variant="text" :aria-label="`新建 ${label}`" @click="$emit('create')">+ 新建 {{label}}</t-button></div>
    <button v-if="creating" class="entry-list__item entry-list__item--active" @click="$emit('create')">新建 {{ label }}<small>尚未保存</small></button>
    <button v-for="item in items" :key="item.name" class="entry-list__item" :class="{'entry-list__item--active': !creating && selected === item.name}" @click="$emit('select',item.name)"><span>{{ item.name }}</span><small>{{ Object.keys(entryData(item.effective)).length }} 个键<span v-if="override"> · {{ item.base ? item.own ? '已覆盖' : '继承' : '环境独有' }}</span></small></button>
    <p v-if="!items.length && !creating">暂无 {{ label }}</p>
  </aside>
</template>
<style scoped>
.entry-list{margin:0 8px 8px;background:#fff;overflow:auto;max-height:calc(100vh - 340px)}.entry-list__heading{display:flex;align-items:center;padding:2px 18px;font-size:12px}.entry-list__item{display:flex;flex-direction:column;gap:4px;width:100%;border:0;background:none;padding:10px 16px 10px 30px;color:#3b444c;text-align:left;cursor:pointer;font:inherit;font-size:12px;border-radius:4px;overflow-wrap:anywhere}.entry-list__item small{font-size:11px;color:#767d84}.entry-list__item:hover{background:#f3f6fa}.entry-list__item--active{background:#e8f2ff;color:#0066cc}.entry-list p{padding:8px 18px;color:#767d84;font-size:12px}
</style>
