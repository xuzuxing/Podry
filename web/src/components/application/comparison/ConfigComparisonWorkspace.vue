<script setup lang="ts">
import { useConfigComparison } from '@/composables/useConfigComparison'
import { comparisonTypeLabels } from '@/utils/configComparison'
import ConfigurationDiff from '@/components/application/ConfigurationDiff.vue'
import ComparisonVersionSelector from './ComparisonVersionSelector.vue'
import ComparisonFileNav from './ComparisonFileNav.vue'
import ComparisonManifestPanel from './ComparisonManifestPanel.vue'
import ScopedVariablesToggle from '../ScopedVariablesToggle.vue'

const { catalog, loading, error, load, heading, search, changedOnly, descending, leftSelection, rightSelection, left, right, environmentOptions, leftVersions, rightVersions, resourceType, resourceName, files, visibleFiles, selectedFile, selectionError, leftValue, rightValue, leftManifest, rightManifest, tab, selectTab, updateSide, swap, selectFile, backTarget, showVariables, hasVariables, toggleVariables } = useConfigComparison()
</script>

<template>
  <section class="comparison-workspace cmp">
    <header class="comparison-workspace__header">
      <RouterLink :to="backTarget" class="comparison-workspace__back" aria-label="返回配置来源"><t-icon name="chevron-left" size="18px" /></RouterLink>
      <h1>{{ heading }}</h1><span class="comparison-workspace__readonly">只读配置对比</span><span class="comparison-workspace__spacer" />
      <t-button variant="text" size="small" :loading="loading" @click="load"><template #icon><t-icon name="refresh" /></template>刷新</t-button>
      <RouterLink :to="backTarget" class="comparison-workspace__close">关闭</RouterLink>
    </header>
    <div v-if="loading" class="comparison-workspace__state"><t-loading text="加载配置版本…" /></div>
    <div v-else-if="error" class="comparison-workspace__state"><t-icon name="error-circle" size="32px" /><p role="alert">{{ error }}</p><t-button @click="load">重试</t-button></div>
    <template v-else-if="catalog">
      <div class="comparison-workspace__body">
        <ComparisonFileNav v-model:search="search" v-model:changed-only="changedOnly" v-model:descending="descending" :tab="tab" :files="files" :visible-files="visibleFiles" :resource-type="resourceType" :resource-name="resourceName" @select="selectFile" @tab-change="selectTab" />
        <main class="comparison-workspace__main">
          <div class="comparison-workspace__selectors cmp__selector">
            <ComparisonVersionSelector side="left" :selection="leftSelection" :environments="environmentOptions" :versions="leftVersions" :result="left" @change="updateSide('left', $event)" />
            <t-button variant="text" shape="square" aria-label="交换两侧" class="comparison-workspace__swap" @click="swap"><t-icon name="swap" /></t-button>
            <ComparisonVersionSelector side="right" :selection="rightSelection" :environments="environmentOptions" :versions="rightVersions" :result="right" @change="updateSide('right', $event)" />
            <div v-if="hasVariables && tab === 'configuration'" class="comparison-workspace__variables"><ScopedVariablesToggle :model-value="showVariables" @update:model-value="toggleVariables" /></div>
          </div>
          <div v-if="left.error || right.error" class="comparison-workspace__state comparison-workspace__invalid">
            <t-icon name="info-circle" size="32px" /><strong>无法对比所选版本</strong><p v-if="left.error" role="alert">基准：{{ left.error }}</p><p v-if="right.error" role="alert">对比：{{ right.error }}</p><p>{{ hasVariables && showVariables ? '可点击变量按钮隐藏解析值，查看原始配置；或重新选择版本。' : '请选择有效环境与版本后继续。' }}</p>
          </div>
          <div v-else-if="selectionError" class="comparison-workspace__state"><t-icon name="file-unknown" size="32px" /><p role="alert">{{ selectionError }}</p><t-button variant="outline" @click="selectFile('deployment')">查看部署模板</t-button></div>
          <template v-else>
            <div class="comparison-workspace__file-heading"><t-icon :name="resourceType === 'secrets' ? 'lock-on' : 'file-code'" /><strong>{{ resourceName || comparisonTypeLabels[resourceType] }}</strong><span v-if="selectedFile?.added">仅对比侧存在</span><span v-else-if="selectedFile?.removed">仅基准侧存在</span></div>
            <p class="comparison-workspace__hint cmp__desc">{{ tab === 'manifest' ? '本地 Mock 预览；未执行 Helm 或 Kubernetes 校验。Secret 只展示键和遮蔽值，不代表明文相同。' : resourceType === 'secrets' ? 'Secret 仅对比键和挂载方式，遮蔽值不代表明文相同。' : '对比两侧有效配置，已保存配置包含基础继承和环境覆盖。' }}</p>
            <ComparisonManifestPanel v-if="tab === 'manifest'" :left="leftManifest" :right="rightManifest" :left-label="left.label" :right-label="right.label" />
            <ConfigurationDiff v-else :left="leftValue" :right="rightValue" :left-label="left.label" :right-label="right.label" />
          </template>
        </main>
      </div>
    </template>
  </section>
</template>

<style scoped>
.comparison-workspace__variables{display:flex;align-self:stretch;align-items:center;flex:none;padding:0 12px;border-left:1px solid #dce1e7}
.comparison-workspace{display:flex;flex-direction:column;height:calc(100dvh - 102px);min-height:480px;background:#fff;color:#000a14;overflow:hidden}.comparison-workspace__header{display:flex;align-items:center;gap:12px;height:48px;min-height:48px;padding:0 20px;border-bottom:1px solid #dce1e7}.comparison-workspace__header h1{margin:0;font-size:14px;font-weight:600}.comparison-workspace__back{display:grid;place-items:center;width:24px;height:24px;color:#596168;border:1px solid #d0d4d9;border-radius:4px}.comparison-workspace__readonly{font-size:11px;color:#767d84}.comparison-workspace__spacer{flex:1}.comparison-workspace__close{font-size:12px;color:#596168;border:1px solid #d0d4d9;border-radius:4px;padding:5px 12px}.comparison-workspace__close:hover{background:#f7fafc}.comparison-workspace__body{display:flex;flex:1;min-height:0;min-width:0}.comparison-workspace__main{display:flex;flex:1;flex-direction:column;min-width:0;min-height:0;overflow:hidden}.comparison-workspace__selectors{display:flex;align-items:center;flex:none;min-width:0;background:#fafbfc;border-bottom:1px solid #dce1e7}.comparison-workspace__swap{flex:none}.comparison-workspace__file-heading{display:flex;align-items:center;gap:8px;padding:14px 20px 0;font-size:13px;min-height:32px;flex:none}.comparison-workspace__file-heading strong{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:500}.comparison-workspace__file-heading>span{font-size:11px;color:#b77800}.comparison-workspace__hint{padding:8px 20px 12px;margin:0;color:#767d84;font-size:11px;line-height:18px;flex:none}.comparison-workspace__state{display:flex;flex:1;min-height:0;align-items:center;justify-content:center;flex-direction:column;padding:24px;gap:12px;color:#767d84;font-size:12px;text-align:center}.comparison-workspace__state p{margin:0;overflow-wrap:anywhere}.comparison-workspace__state strong{color:#3b444c;font-size:14px;font-weight:500}.comparison-workspace__state [role=alert]{color:#d54941}.comparison-workspace :deep(.configuration-diff){margin:0 20px 20px}.comparison-workspace :deep(.configuration-diff__toolbar){gap:12px}.comparison-workspace :deep(.cmp__table th:first-child){width:28%}
</style>
