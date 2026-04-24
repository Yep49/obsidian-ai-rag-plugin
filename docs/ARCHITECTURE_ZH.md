# AI RAG + LLM Wiki 底层原理图解

这份文档解释插件背后的工作机制。你不需要懂算法也能读懂。

## 1. 总体架构

```mermaid
flowchart TD
  A["Obsidian Markdown 笔记"] --> B["AI RAG 索引层"]
  A --> C["LLM Wiki 整理层"]
  B --> D["知识库提问 Ask Vault"]
  C --> D
  C --> E["查询 Wiki"]
  F["用户纠错 FAQ"] --> D
  D --> G["带引用的 AI 回答"]
  E --> H["_wiki/syntheses 可归档答案"]
```

插件有三类知识来源：

- 原始笔记：你的 Markdown 文件。
- RAG 索引：从原始笔记切块、向量化得到的检索数据。
- LLM Wiki：LLM 整理出来的 `_wiki/` Markdown 页面。

## 2. RAG 是什么

RAG 是 Retrieval-Augmented Generation，意思是“检索增强生成”。

普通 AI 问答：

```text
问题 -> AI 直接回答
```

RAG 问答：

```text
问题 -> 先从你的笔记里找资料 -> 把资料和问题一起交给 AI -> 回答
```

这样 AI 更容易基于你的资料回答，而不是凭空编。

## 3. 构建索引流程

```mermaid
flowchart TD
  A["扫描 Vault 中的 Markdown"] --> B["排除 _wiki/ 页面"]
  B --> C["读取笔记正文"]
  C --> D["按 chunkSize 和 overlap 分块"]
  D --> E["提取标题、标签、链接、行号"]
  E --> F["调用 Embedding API"]
  F --> G["保存 chunks.json"]
  F --> H["保存 embeddings.json"]
  E --> I["保存 files.json"]
  G --> J["可被语义搜索和知识库提问使用"]
  H --> J
```

关键文件保存在：

```text
.obsidian/plugins/obsidian-ai-rag-plugin/data/
```

主要文件：

- `chunks.json`：每个文本块的正文、来源路径、标题、行号。
- `embeddings.json`：每个文本块对应的向量。
- `files.json`：文件修改时间和分块 ID。
- `manifest.json`：索引版本、模型、分块参数。

## 4. Embedding 是什么

Embedding 可以理解为“把文字变成一串数字”。

例如：

```text
"公司服务器怎么配置" -> [0.12, -0.08, 0.33, ...]
```

语义相近的文本，数字向量也会更接近。插件用余弦相似度找最相近的笔记片段。

```mermaid
flowchart LR
  A["用户问题"] --> B["问题向量"]
  C["笔记片段 1"] --> D["片段向量 1"]
  E["笔记片段 2"] --> F["片段向量 2"]
  G["笔记片段 3"] --> H["片段向量 3"]
  B --> I["计算相似度"]
  D --> I
  F --> I
  H --> I
  I --> J["返回最相关片段"]
```

## 5. 知识库提问流程

```mermaid
flowchart TD
  A["用户输入问题"] --> B["FAQ 强匹配"]
  B -->|命中| C["直接返回已确认答案"]
  B -->|未命中| D["Wiki 图谱搜索"]
  B -->|未命中| E["向量检索 Dense Recall"]
  E --> F["关键词检索 Sparse Recall"]
  F --> G["反馈召回 Feedback Recall"]
  G --> H["元数据召回 Meta Recall"]
  D --> I["合并上下文"]
  H --> I
  I --> J["LLM 生成回答"]
  J --> K["附带引用来源"]
  K --> L["保存查询日志"]
```

插件的检索不是只有一种方式，而是多路召回：

- FAQ：你纠正过并确认的答案，优先级最高。
- Wiki：整理后的结构化知识。
- Dense Recall：向量语义检索。
- Sparse Recall：关键词检索。
- Feedback Recall：历史纠错记忆。
- Meta Recall：AI 摘要元数据。

## 6. 混合搜索为什么更稳

向量检索擅长理解意思，比如“服务器登录方式”和“SSH 连接”可能语义接近。

关键词检索擅长精确命中，比如 IP、产品名、命令、报错信息。

混合搜索把两者结合：

```mermaid
flowchart LR
  A["问题"] --> B["向量检索"]
  A --> C["关键词检索"]
  B --> D["候选结果"]
  C --> D
  D --> E["RRF 融合排序"]
  E --> F["最终上下文"]
```

## 7. LLM Wiki 的工作方式

传统 RAG 每次都临时找片段，知识不会被真正整理。LLM Wiki 会把重要知识沉淀成 Markdown 页面。

```mermaid
flowchart TD
  A["原始笔记"] --> B["LLM 分析"]
  B --> C["来源摘要 sources/"]
  B --> D["实体页 entities/"]
  B --> E["概念页 concepts/"]
  B --> F["主题综述 summaries/"]
  C --> G["更新 index.md"]
  D --> G
  E --> G
  F --> G
  G --> H["记录 log.md"]
```

Wiki 页面类型：

- `sources/`：原始来源摘要，连接原文和 Wiki。
- `entities/`：人物、组织、项目、工具、产品、地点。
- `concepts/`：理论、方法、原则、模式。
- `summaries/`：跨多个来源的主题综述。
- `syntheses/`：值得长期保存的问答和综合分析。
- `faq/`：用户确认过的标准答案。
- `meta/`：每篇原始笔记的整理性说明。
- `relations/`：笔记和 Wiki 的关系表。

## 8. 导入 Wiki 的详细流程

```mermaid
sequenceDiagram
  participant U as 用户
  participant O as Obsidian 插件
  participant L as LLM API
  participant W as _wiki 目录

  U->>O: 导入当前笔记到 Wiki
  O->>O: 检查是否是 Wiki 页面
  O->>O: 检测疑似敏感内容
  O->>L: 发送当前笔记和候选 Wiki 上下文
  L-->>O: 返回 JSON 分析结果
  O->>W: 写入 sources 页面
  O->>W: 创建或更新 entities/concepts/summaries
  O->>W: 更新 index.md
  O->>W: 追加 log.md
  O-->>U: 显示导入结果
```

## 9. FAQ 为什么优先级最高

FAQ 来自用户纠错，是“人确认过的答案”。所以插件问答时会先查 FAQ。

```mermaid
flowchart TD
  A["用户问题"] --> B{"FAQ 是否强匹配"}
  B -->|是| C["返回 FAQ 正确答案"]
  B -->|否| D["继续查 Wiki 和向量索引"]
```

这能让插件越用越贴合你的知识库。

## 10. 敏感内容处理

插件会检测这些关键词或模式：

- password
- passwd
- api key
- secret
- token
- private key
- 密码
- 密钥
- 令牌
- 身份证
- 银行卡

遇到疑似敏感笔记时，手动任务会提示你选择：

- 跳过：不处理这篇笔记。
- 正常处理：发送正文给 AI。
- 标记为私密：不发送正文，只在 Wiki 里记录一个私密占位页。

后台自动任务遇到敏感内容会跳过，不会弹大量确认框。

## 11. 数据保存在哪里

插件运行数据保存在：

```text
你的 Vault/.obsidian/plugins/obsidian-ai-rag-plugin/data/
```

Wiki 页面保存在：

```text
你的 Vault/_wiki/
```

插件设置保存在：

```text
你的 Vault/.obsidian/plugins/obsidian-ai-rag-plugin/data.json
```

注意：`data.json` 里可能包含 API Key，不要上传到 GitHub。

## 12. 哪些内容会发送到 API

会发送：

- 构建索引时的笔记分块。
- 提问时的问题和检索到的上下文。
- 导入 Wiki 时的当前笔记内容。
- 生成元数据索引时的笔记内容。
- 重排序或压缩上下文时的候选片段。

不会自动发送：

- 整个电脑文件。
- 没有被扫描到的非 Vault 文件。
- 默认关闭状态下的自动索引和自动导入任务。

## 13. 为什么要保留 main.js

Obsidian 插件安装时需要：

```text
manifest.json
main.js
styles.css
```

所以仓库里保留编译后的 `main.js`，方便普通用户直接下载安装。开发者也可以从 `src/` 重新构建。

## 14. 一句话总结

AI RAG 负责“从原始笔记里找证据回答”，LLM Wiki 负责“把长期知识整理成可积累的 Markdown 百科”，FAQ 负责“记住用户确认过的正确答案”。
