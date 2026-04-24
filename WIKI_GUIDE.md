# LLM Wiki 功能使用指南

## 概述

LLM Wiki 是 AI RAG 插件的新功能，它将传统的 RAG（检索增强生成）升级为持久化的知识库系统。

### 核心理念

**传统 RAG**：每次查询都从原始文档重新检索，无知识积累
**LLM Wiki**：LLM 作为知识库管理员，维护结构化的 Wiki，知识只编译一次，持续更新

## 快速开始

### 1. 启用 Wiki 功能

1. 打开 Obsidian 设置
2. 找到 "AI RAG + LLM Wiki"
3. 滚动到 "Wiki 设置" 部分
4. 开启 "启用 Wiki" 开关
5. 插件会自动重新加载

### 2. 初始化 Wiki

1. 按 `Ctrl+P` / `Cmd+P` 打开命令面板
2. 输入 "初始化 Wiki"（英文命令：`Initialize Wiki`）
3. 执行命令
4. Wiki 目录结构将被创建在 `_wiki/` 文件夹中

### 3. 导入笔记到 Wiki

#### 方式 1：导入当前笔记
1. 打开任意笔记
2. 按 `Ctrl+P` / `Cmd+P` 打开命令面板
3. 输入 "导入当前笔记到 Wiki"（英文命令：`Ingest Current Note to Wiki`）
4. 等待 LLM 分析完成

#### 方式 2：批量导入所有笔记
1. 按 `Ctrl+P` / `Cmd+P` 打开命令面板
2. 输入 "一键导入全部笔记到 Wiki"（英文命令：`Batch Ingest All Notes to Wiki`）
3. 等待批量处理完成（会显示进度）

### 4. 查询 Wiki

1. 按 `Ctrl+P` / `Cmd+P` 打开命令面板
2. 输入 "查询 Wiki"（英文命令：`Query Wiki`）
3. 在弹窗中输入问题
4. 点击 "🔍 搜索 Wiki"
5. 查看答案和来源
6. 如果问题有价值，可以点击 "📝 归档为综合页面"

### 5. 查看 Wiki 统计

1. 按 `Ctrl+P` / `Cmd+P` 打开命令面板
2. 输入 "显示 Wiki 统计"（英文命令：`Show Wiki Stats`）
3. 查看 Wiki 中的页面统计

## Wiki 页面类型

### 1. 实体页面 (entities/)
描述具体对象，如服务器、工具、项目等

**示例**：
- `entities/服务器-47.93.15.87.md`
- `entities/Claude-Code-CLI.md`

### 2. 概念页面 (concepts/)
解释抽象概念，如技术原理、方法论等

**示例**：
- `concepts/RAG检索增强生成.md`
- `concepts/LLM-Wiki.md`

### 3. 摘要页面 (summaries/)
主题汇总，整合某个领域的知识

**示例**：
- `summaries/建站知识汇总.md`
- `summaries/AI工具使用汇总.md`

### 4. 综合页面 (syntheses/)
问答记录，保存有价值的问答

**示例**：
- `syntheses/如何学习WordPress.md`
- `syntheses/服务器配置指南.md`

## Wiki 目录结构

```
_wiki/
├── index.md              # Wiki 索引（自动维护）
├── log.md                # 更新日志（自动维护）
├── entities/             # 实体页面
├── concepts/             # 概念页面
├── summaries/            # 摘要页面
└── syntheses/            # 综合页面
```

## 设置选项

### Enable Wiki
启用或禁用 Wiki 功能

### Wiki Path
Wiki 目录路径（默认：`_wiki`）

### Auto Ingest
文件变更时自动导入到 Wiki（实验性功能，默认关闭）

### Wiki Priority
Wiki 页面在检索中的权重提升倍数（默认：1.5）
- 1.0 = 无提升
- 1.5 = 提升 50%
- 2.0 = 提升 100%

## 工作流程

### 导入流程
```
笔记 → LLM 分析 → 识别实体/概念 → 创建/更新 Wiki 页面 → 更新索引 → 记录日志
```

### 查询流程
```
问题 → 搜索 Wiki → 找到相关页面 → LLM 综合答案 → 显示结果 → 可选归档
```

## 注意事项

1. **API 成本**：每次导入和查询都会调用 LLM API，请注意成本
2. **处理时间**：批量导入大量笔记需要较长时间
3. **Wiki 维护**：Wiki 页面由 LLM 自动维护，但你可以手动编辑
4. **索引更新**：导入后会自动更新 `index.md` 和 `log.md`
5. **原始笔记**：导入不会修改原始笔记，只会创建 Wiki 页面

## 常见问题

### Q: Wiki 和传统 RAG 有什么区别？
A: 传统 RAG 每次都重新检索原始文档，Wiki 则维护结构化的知识库，知识持久化。

### Q: 我可以手动编辑 Wiki 页面吗？
A: 可以！Wiki 页面是普通的 Markdown 文件，你可以随时编辑。

### Q: 批量导入需要多长时间？
A: 取决于笔记数量和 API 速度。每个笔记之间有 1 秒延迟以避免限流。

### Q: Wiki 页面会被 RAG 索引吗？
A: 会的！Wiki 页面会被自动索引，并在检索时获得更高权重。

### Q: 如何删除 Wiki？
A: 直接删除 `_wiki/` 文件夹即可。

## 高级用法

### 手动创建 Wiki 页面
你可以在 `_wiki/` 目录下手动创建页面，格式如下：

```markdown
---
type: concept
category: 技术
created: 2026-04-22
updated: 2026-04-22
sources: 1
---

# 页面标题

页面内容...

## 相关链接
- [[其他页面]]
```

### 自定义 Wiki 路径
在设置中修改 "Wiki Path"，可以使用任意路径，如 `knowledge/`, `wiki/` 等。

### 集成到工作流
1. 每天导入新笔记：运行 "导入当前笔记到 Wiki"
2. 定期查询 Wiki：使用 "查询 Wiki" 命令
3. 查看统计：使用 "Show Wiki Stats" 命令

## 未来计划

- [ ] 审计功能：检查矛盾、孤立页面、缺失链接
- [ ] 自动导入：文件变更时自动导入
- [ ] Wiki 可视化：图谱视图
- [ ] 导出功能：导出为静态网站

## 反馈与支持

如有问题或建议，请在 GitHub 提交 Issue。
