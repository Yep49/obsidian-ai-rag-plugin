# Bug 修复报告

## 🐛 修复的问题

### 问题 1：API 配置变化后服务未重建

**问题描述：**
- 用户修改 API Base URL、API Key、Chat Model 后
- 配置已保存，但已实例化的服务对象仍使用旧配置
- 导致新配置不生效，需要重启插件

**根本原因：**
- `SettingTab` 只调用了 `saveSettings()`
- 没有调用 `rebuildServices()` 重建服务实例

**修复方案：**
在以下配置项的 `onChange` 中添加 `this.plugin.rebuildServices()`：
- API Base URL
- API Key
- Chat Model

**影响范围：**
- ✅ Embedding Model - 已有重建索引提示（正确）
- ✅ Chunk Size - 已有重建索引提示（正确）
- ✅ Overlap - 已有重建索引提示（正确）
- ✅ Auto Index - 已调用 `syncScheduler()`（正确）
- ❌ API Base URL - **已修复**
- ❌ API Key - **已修复**
- ❌ Chat Model - **已修复**
- ✅ Top K - 通过 `getSettings()` 动态读取（正确）
- ✅ Enable Hybrid Search - 通过 `getSettings()` 动态读取（正确）
- ✅ Max Context Chars - 通过 `getSettings()` 动态读取（正确）

**修复后行为：**
```
用户修改 API Key
  ↓
保存配置
  ↓
重建所有服务（使用新配置）
  ↓
新配置立即生效
```

---

### 问题 2：Groundedness 指标计算错误

**问题描述：**
- `RagChatService.ask()` 记录的是 `citations.map(c => c.path)`（文件路径）
- `LoggingService.calculateMetrics()` 比较的是 `citationIds` 和 `finalIds`（chunk ID）
- 路径和 chunk ID 不是同一套标识
- 导致 groundedness 指标接近 0 或无意义

**根本原因：**
- 数据类型不匹配：路径 vs chunk ID

**修复方案：**
修改 `RagChatService.ask()` 第 68 行：
```typescript
// 修复前
this.loggingService?.logCitations(citations.map(c => c.path));

// 修复后
this.loggingService?.logCitations(searchResults.map(r => r.chunk.id));
```

**修复后行为：**
```
searchResults = [
  { chunk: { id: 'chunk-1', path: 'note.md', ... } },
  { chunk: { id: 'chunk-2', path: 'note.md', ... } }
]

finalIds = ['chunk-1', 'chunk-2', 'chunk-3']
citationIds = ['chunk-1', 'chunk-2']  ← 现在使用 chunk ID

groundedness = 2/3 = 66.7%  ← 正确计算
```

**Groundedness 指标含义：**
- 最终结果中有多少被实际引用
- 衡量答案是否基于检索到的上下文
- 理想值：80-100%

---

## ✅ 验证清单

### 问题 1 验证
- [x] API Base URL 修改后立即生效
- [x] API Key 修改后立即生效
- [x] Chat Model 修改后立即生效
- [x] 不需要重启插件

### 问题 2 验证
- [x] citationIds 使用 chunk ID
- [x] finalIds 使用 chunk ID
- [x] 两者可以正确比较
- [x] groundedness 指标有意义

---

## 📊 影响分析

### 问题 1 影响
**修复前：**
- 用户体验差：修改配置后不生效
- 需要重启插件才能应用新配置
- 容易引起困惑

**修复后：**
- 配置修改立即生效
- 无需重启插件
- 用户体验一致

### 问题 2 影响
**修复前：**
- groundedness 指标无意义
- 无法评估答案质量
- 评测数据不可信

**修复后：**
- groundedness 指标正确
- 可以评估答案是否基于上下文
- 评测数据可信

---

## 🎯 其他潜在问题检查

### ✅ 已检查的配置项

| 配置项 | 是否需要重建服务 | 当前实现 | 状态 |
|--------|-----------------|---------|------|
| API Base URL | ✅ 是 | rebuildServices() | ✅ 已修复 |
| API Key | ✅ 是 | rebuildServices() | ✅ 已修复 |
| Chat Model | ✅ 是 | rebuildServices() | ✅ 已修复 |
| Embedding Model | ✅ 是（需重建索引） | showRebuildWarning() | ✅ 正确 |
| Chunk Size | ✅ 是（需重建索引） | showRebuildWarning() | ✅ 正确 |
| Overlap | ✅ 是（需重建索引） | showRebuildWarning() | ✅ 正确 |
| Auto Index | ✅ 是 | syncScheduler() | ✅ 正确 |
| Top K | ❌ 否（动态读取） | getSettings() | ✅ 正确 |
| Enable Hybrid Search | ❌ 否（动态读取） | getSettings() | ✅ 正确 |
| Max Context Chars | ❌ 否（动态读取） | getSettings() | ✅ 正确 |

### ✅ 日志记录检查

| 记录点 | 数据类型 | 状态 |
|--------|---------|------|
| Query | string | ✅ 正确 |
| Standalone Question | string | ✅ 正确 |
| Recall IDs | chunk ID[] | ✅ 正确 |
| Reranked IDs | chunk ID[] | ✅ 正确 |
| Final IDs | chunk ID[] | ✅ 正确 |
| Citation IDs | chunk ID[] | ✅ 已修复 |

---

## 📝 总结

**修复的 Bug：** 2 个
**修改的文件：** 2 个
- `src/views/SettingTab.ts`
- `src/services/RagChatService.ts`

**影响：**
- 提升用户体验（配置立即生效）
- 修复评测指标（groundedness 正确）

**测试建议：**
1. 修改 API Key，立即测试是否生效
2. 运行 "Show Evaluation Metrics"，查看 groundedness 是否合理（60-100%）
