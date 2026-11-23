<script setup lang="ts">
import { shallowRef } from 'vue'
import type { ComparisonManifest } from '@/utils/configComparisonManifest'
import ConfigurationYamlDiff from '@/components/application/ConfigurationYamlDiff.vue'

defineProps<{ left: ComparisonManifest; right: ComparisonManifest; leftLabel: string; rightLabel: string }>()
const changesOnly = shallowRef(false)
</script>

<template>
  <section class="comparison-manifest" aria-label="Manifest 对比">
    <div v-if="left.error || right.error" class="comparison-manifest__unavailable">
      <t-icon name="info-circle" size="32px" /><strong>无法生成所选版本的清单预览</strong>
      <p v-if="left.error" role="alert">基准：{{ left.error }}</p><p v-if="right.error" role="alert">对比：{{ right.error }}</p>
      <p>可切回 Configuration 查看完整配置，或重新选择版本。</p>
    </div>
    <template v-else>
      <div class="comparison-manifest__toolbar"><strong>Generated Manifest</strong><t-checkbox v-model="changesOnly">仅显示差异</t-checkbox><span>只读 · 本地 Mock</span></div>
      <div class="comparison-manifest__notices"><p>{{ left.notice }}</p><p>{{ right.notice }}</p></div>
      <ConfigurationYamlDiff :left="left.text" :right="right.text" :left-label="leftLabel" :right-label="rightLabel" :changes-only="changesOnly" />
    </template>
  </section>
</template>

<style scoped>
.comparison-manifest{display:flex;flex:1;flex-direction:column;min-width:0;min-height:0;margin:0 20px 20px;border:1px solid #dce1e7;border-radius:4px;overflow:hidden}.comparison-manifest__toolbar{display:flex;flex:none;align-items:center;gap:16px;padding:10px 12px;background:#fafbfc;border-bottom:1px solid #dce1e7;font-size:12px}.comparison-manifest__toolbar strong{font-weight:500}.comparison-manifest__toolbar>span{margin-left:auto;color:#767d84;font-size:11px}.comparison-manifest__notices{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);flex:none;background:#f7fafc;border-bottom:1px solid #dce1e7}.comparison-manifest__notices p{margin:0;padding:6px 12px;color:#767d84;font-size:11px;line-height:16px;overflow-wrap:anywhere}.comparison-manifest__unavailable{display:flex;flex:1;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:24px;color:#767d84;text-align:center;font-size:12px}.comparison-manifest__unavailable strong{color:#3b444c;font-size:14px;font-weight:500}.comparison-manifest__unavailable p{margin:0;overflow-wrap:anywhere}.comparison-manifest__unavailable [role=alert]{color:#d54941}
</style>
