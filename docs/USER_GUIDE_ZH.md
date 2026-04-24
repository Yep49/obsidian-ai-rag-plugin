# AI RAG + LLM Wiki 小白使用教程

这份教程写给第一次使用 Obsidian AI 知识库插件的人。你可以把插件理解成两个助手：

- AI RAG 助手：帮你从原始笔记里找证据，再基于证据回答问题。
- LLM Wiki 管理员：帮你把零散笔记整理成 `_wiki/` 里的长期知识库。

## 1. 安装插件

### 手动安装

1. 下载插件发布包。
2. 解压后，把插件文件夹放到你的 Vault：

```text
你的 Vault/.obsidian/plugins/obsidian-ai-rag-plugin/
```

3. 确认文件夹里至少有：

```text
manifest.json
main.js
styles.css
```

4. 打开 Obsidian。
5. 进入 `设置` -> `第三方插件`。
6. 关闭安全模式，启用 `AI RAG + LLM Wiki`。

### 从源码开发

```bash
npm install
npm run build
```

然后把 `manifest.json`、`main.js`、`styles.css` 放进插件目录。

## 2. 首次配置

打开 Obsidian 设置里的 `AI RAG + LLM Wiki`。

需要配置：

- API Base URL：你的 OpenAI-compatible 接口地址。
- API Key：你的 API 密钥。
- Chat Model：用于回答、总结、整理 Wiki 的模型。
- Embedding Model：用于把笔记和问题转成向量的模型。
- 命令语言：选择 `中文` 或 `English`。

推荐先保持这些设置：

- 文件变更时自动索引：关闭。
- Wiki 自动导入：关闭。
- Chunk Size：800。
- Overlap：150。
- Top K：6。
- 启用混合搜索：开启。

## 3. 第一次使用流程

### 第一步：构建 AI 索引

打开命令面板：

- macOS：`Cmd + P`
- Windows/Linux：`Ctrl + P`

运行：

```text
AI RAG + LLM Wiki: 构建 AI 索引
```

插件会做这些事：

1. 扫描非 `_wiki/` 的 Markdown 笔记。
2. 把笔记切成小块。
3. 调用 Embedding API 生成向量。
4. 保存索引到插件自己的 `data/` 目录。

没有构建索引时，`知识库提问` 很可能找不到资料。

### 第二步：知识库提问

运行：

```text
AI RAG + LLM Wiki: 知识库提问
```

适合问：

- 我的笔记里有没有讲过某个主题？
- 某个概念怎么解释？
- 某个项目有哪些注意事项？
- 帮我基于笔记总结一个方案。

回答里会带引用来源，你可以点回原始笔记检查。

### 第三步：语义搜索

运行：

```text
AI RAG + LLM Wiki: 语义搜索
```

它只返回相关笔记片段，不让 AI 写长答案。适合你想自己看原文时使用。

### 第四步：打开侧边栏

运行：

```text
AI RAG + LLM Wiki: 打开 AI RAG 侧边栏
```

适合连续对话。比如先问“这个项目是什么”，再问“有哪些风险”。

## 4. LLM Wiki 使用流程

LLM Wiki 是插件的长期知识库层。它会在你的 Vault 里创建 `_wiki/` 文件夹，里面都是普通 Markdown 文件。

### 初始化 Wiki

运行：

```text
AI RAG + LLM Wiki: 初始化 Wiki
```

会创建：

```text
_wiki/
├── CLAUDE.md
├── index.md
├── log.md
├── faq/
├── meta/
├── relations/
├── sources/
├── entities/
├── concepts/
├── summaries/
└── syntheses/
```

### 导入当前笔记到 Wiki

打开一篇值得长期沉淀的笔记，运行：

```text
AI RAG + LLM Wiki: 导入当前笔记到 Wiki
```

插件会：

1. 读取当前笔记。
2. 让 LLM 判断其中的重要实体、概念、主题。
3. 创建来源摘要页。
4. 创建或更新实体页、概念页、主题综述页。
5. 更新 `_wiki/index.md` 和 `_wiki/log.md`。

原始笔记不会被改写。

### 查询 Wiki

运行：

```text
AI RAG + LLM Wiki: 查询 Wiki
```

它优先基于 `_wiki/` 里已经整理好的知识回答。适合问更稳定、更体系化的问题。

### 浏览 Wiki

运行：

```text
AI RAG + LLM Wiki: 浏览 Wiki
```

可以查看、搜索、筛选 Wiki 页面。

### 审计 Wiki

运行：

```text
AI RAG + LLM Wiki: 审计 Wiki
```

用于检查：

- 有没有孤立页面。
- 有没有缺少交叉引用。
- 有没有冲突或待核实内容。
- 有没有知识空白。

### 自动修复孤立页面

运行：

```text
AI RAG + LLM Wiki: 自动修复孤立页面
```

插件会尝试给没有入链的 Wiki 页面补充相关链接。

## 5. FAQ 和纠错功能

当 AI 回答错了，你可以通过纠错功能保存一条 FAQ。

FAQ 的作用：

- 以后遇到相似问题，优先使用你确认过的正确答案。
- FAQ 优先级高于普通 Wiki 和向量检索。
- FAQ 会保存到 `_wiki/faq/`。

适合保存：

- 固定操作流程。
- 项目规则。
- 常见问题标准答案。
- 你纠正过的 AI 错误。

## 6. 所有主要命令

| 中文命令 | 英文命令 | 用途 |
| --- | --- | --- |
| 打开 AI RAG 侧边栏 | Open AI RAG Sidebar | 打开侧边栏连续对话 |
| 构建 AI 索引 | Build AI Index | 扫描笔记并建立向量索引 |
| 语义搜索 | Semantic Search | 搜索相关片段 |
| 知识库提问 | Ask Vault | 基于笔记回答问题 |
| 构建元数据索引 | Build Meta Index (AI Summary) | 为笔记生成 AI 摘要和元数据 |
| 显示索引队列状态（调试） | Show Index Queue Status (Debug) | 查看索引队列 |
| 立即处理索引队列（调试） | Flush Index Queue (Debug) | 立刻处理索引队列 |
| 显示用户提问模式统计 | Show User Pattern Stats | 查看常问模式 |
| 显示评测指标 | Show Evaluation Metrics | 查看检索和回答质量指标 |
| 显示最近查询日志 | Show Recent Query Logs | 查看最近查询记录 |
| 初始化 Wiki | Initialize Wiki | 创建 `_wiki/` 结构 |
| 查询 Wiki | Query Wiki | 基于 Wiki 回答问题 |
| 导入当前笔记到 Wiki | Ingest Current Note to Wiki | 导入当前笔记 |
| 重新导入当前笔记到 Wiki | Re-ingest Current Note to Wiki | 强制重新导入当前笔记 |
| 一键导入全部笔记到 Wiki | Batch Ingest All Notes to Wiki | 批量导入所有非 Wiki 笔记 |
| 交互式批量导入 Wiki | Batch Ingest (Interactive Mode) | 可交互控制批量导入 |
| 显示 Wiki 统计 | Show Wiki Stats | 查看 Wiki 页面数量 |
| 浏览 Wiki | Browse Wiki | 浏览和筛选 Wiki |
| 生成 Wiki 总结 | Generate Wiki Summary | 生成主题总结 |
| 审计 Wiki | Audit Wiki | 检查 Wiki 健康度 |
| 自动修复孤立页面 | Auto-fix Orphan Pages | 给孤立页面补链 |
| 生成反馈调参报告 | Generate Feedback Tuning Report | 汇总反馈和调参建议 |

## 7. 推荐工作流

### 日常查资料

1. 写笔记。
2. 定期运行 `构建 AI 索引`。
3. 用 `知识库提问` 或 `语义搜索`。

### 长期沉淀知识

1. 运行 `初始化 Wiki`。
2. 挑重要笔记运行 `导入当前笔记到 Wiki`。
3. 用 `查询 Wiki` 做体系化问答。
4. 定期运行 `审计 Wiki`。

### 纠正 AI

1. 用 `知识库提问`。
2. 如果回答错了，保存正确答案为 FAQ。
3. 下次类似问题会优先使用 FAQ。

## 8. 隐私和安全

插件不会自带 API Key，也不会偷偷上传整个 Vault。

但这些操作会发送文本到你配置的 API：

- 构建 AI 索引：发送笔记分块给 Embedding API。
- 知识库提问：发送问题和检索到的上下文给 Chat API。
- 导入 Wiki：发送当前笔记内容给 Chat API。
- 构建元数据索引：发送笔记内容给 Chat API。

建议：

- 不要把密码、密钥、身份证、银行卡等敏感信息放进要处理的笔记。
- 自动索引和自动导入默认关闭，确认安全后再开启。
- 遇到敏感提示时，优先选择跳过或标记为私密。

## 9. 常见问题

### 为什么提问没有结果？

通常是还没有运行 `构建 AI 索引`，或者 Embedding API 配置不正确。

### 为什么回答不准？

可能是索引过旧、相关笔记没有被索引、问题太模糊，或者模型没有拿到足够上下文。可以先用 `语义搜索` 看看检索结果是否正确。

### Wiki 和普通 RAG 有什么区别？

普通 RAG 每次临时从原始笔记里找片段。Wiki 会先把知识整理成结构化页面，之后基于这些页面回答，更适合长期积累。

### 可以手动编辑 `_wiki/` 吗？

可以。`_wiki/` 里的页面都是普通 Markdown。

### 可以删除 `_wiki/` 吗？

可以。删除后重新运行 `初始化 Wiki` 即可。

### 为什么默认关闭自动索引和自动导入？

因为这些功能可能自动处理大量笔记并消耗 API，也可能涉及隐私。手动确认更适合新手。
