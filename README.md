# AI RAG + LLM Wiki - Obsidian Plugin

一个面向 Obsidian 的 AI 知识库插件：既保留高级 RAG 检索问答，也新增持久 LLM Wiki 层，让 AI 把原始资料持续整理成可积累、可审计、可互链的 Markdown Wiki。

## 面向新手的中文教程

- [小白使用教程](docs/USER_GUIDE_ZH.md)：从安装、配置 API、构建索引到日常提问、导入 Wiki、保存 FAQ。
- [底层原理图解](docs/ARCHITECTURE_ZH.md)：用流程图解释 RAG、Embedding、Wiki、FAQ、日志和隐私边界。

> 隐私提醒：本插件不会内置 API Key。构建索引、提问、导入 Wiki 时，会把必要文本发送到你自己配置的 AI API 服务。自动索引和自动导入默认关闭，建议确认笔记隐私范围后再开启。

## ✨ 核心特性

### 🔍 主流最佳实践检索链路

```
Query → Analysis → Multi-Recall → Fusion → Rerank → Compression → Results
```

- **Query Analysis** - Standalone question、Multi-query、Filter inference
- **Multi-Recall** - Dense + Sparse + Feedback + Meta 四路召回
- **Fusion** - RRF / Weighted / Distribution-based 融合算法
- **Rerank** - LLM-based 重排序
- **Context Compression** - Parent-child chunks、Sentence window、Token budget

### 🎯 5 个增强功能

1. **ASK Vault 可复制** - 一键复制答案到剪贴板
2. **纠正按钮 + 反馈学习** - 纠正错误答案，自动向量化并加入召回
3. **AI 全库总结元数据库** - AI 生成笔记摘要，作为独立召回通道
4. **自动增量索引** - 文件变化自动更新索引，2秒防抖，批量处理
5. **用户问答方式学习** - 高频术语统计，触发词选择性加载，性能优化

### 📊 稳定性与评测

- **日志记录** - 记录每次查询的完整链路
- **评测指标** - Retrieval Relevance、Groundedness、Citation Accuracy
- **网络容错** - 自动重试、超时控制、指数退避
- **错误处理** - 友好的错误提示和降级策略

### 🧠 持久 LLM Wiki

- **三层结构** - raw sources 保持只读，`_wiki/` 由 LLM 维护，`_wiki/CLAUDE.md` 作为 schema 说明书
- **来源摘要** - 每次导入先生成 `sources/` 页面，把原始笔记编译成可引用证据
- **实体/概念融合** - 新资料会融合进已有 entity/concept 页面，而不是直接覆盖旧知识
- **冲突标记** - 新旧信息不一致时保留双方说法，并记录到冲突/待核实列表
- **索引与日志** - 自动维护 `index.md` 和 `log.md`，形成可导航、可追踪的知识演化记录
- **Wiki 审计** - 检查无入链孤岛、缺失交叉引用、矛盾、过时信息和知识空白

## 🚀 快速开始

### 安装

1. 下载最新版本
2. 解压到 `.obsidian/plugins/obsidian-ai-rag-plugin/`
3. 在 Obsidian 设置中启用插件

### 配置

1. 打开设置页
2. 填写 API 配置：
   - API Base URL（OpenAI-compatible）
   - API Key
   - Embedding Model（如 `text-embedding-ada-002`）
   - Chat Model（如 `gpt-4`）

3. 调整索引配置：
   - Chunk Size（默认 800）
   - Overlap（默认 150）
   - Top K（默认 6）
   - 文件变更时自动索引默认关闭，建议确认隐私范围后再开启

### 使用

#### 1. 构建索引

运行命令：`构建 AI 索引`（英文命令：`Build AI Index`）

首次使用需要全量构建索引，之后会自动增量更新。

#### 2. 语义搜索

运行命令：`语义搜索`（英文命令：`Semantic Search`）

输入问题，返回相关文档片段。

#### 3. 问答

运行命令：`知识库提问`（英文命令：`Ask Vault`）

输入问题，返回答案 + 引用来源。

#### 4. 侧边栏

运行命令：`打开 AI RAG 侧边栏`（英文命令：`Open AI RAG Sidebar`）

打开侧边栏，进行连续对话。

#### 5. 元数据索引（可选）

运行命令：`构建元数据索引`（英文命令：`Build Meta Index (AI Summary)`）

AI 分析每篇笔记生成元数据，提升"这是什么笔记"类问题的召回。

#### 6. 初始化 LLM Wiki

运行命令：`初始化 Wiki`（英文命令：`Initialize Wiki`）

插件会创建：

- `_wiki/CLAUDE.md` - Wiki 维护规则
- `_wiki/index.md` - 内容索引
- `_wiki/log.md` - 时间线日志
- `_wiki/sources/` - 原始来源摘要
- `_wiki/entities/` - 实体页
- `_wiki/concepts/` - 概念页
- `_wiki/summaries/` - 主题综述
- `_wiki/syntheses/` - 高价值问答/综合分析

#### 7. 导入来源到 Wiki

运行命令：`导入当前笔记到 Wiki`（英文命令：`Ingest Current Note to Wiki`），或右键 Markdown 文件选择 `导入到 Wiki`。

导入时插件会读取原始笔记但不改动原文，然后创建来源摘要页、更新相关实体/概念页、维护索引和日志。开启设置里的 `自动导入` 后，非 Wiki 笔记变更会在短暂防抖后自动导入。

#### 8. 查询与审计 Wiki

- `查询 Wiki` - 基于已整理的 Wiki 页面回答问题，可将高价值答案归档为 synthesis 页面
- `浏览 Wiki` - 浏览、搜索、筛选 Wiki 页面
- `审计 Wiki` - 生成 Wiki 体检报告
- `自动修复孤立页面` - 为无入链页面补充相关链接和入口

## 📖 功能详解

### 检索链路

#### Query Analysis
- **Standalone Question** - 处理追问，改写为独立问题
- **Multi-Query** - 生成查询变体，提升召回覆盖率
- **Filter Inference** - 推断标签和路径过滤条件

#### Multi-Recall
- **Dense Recall** - 向量检索（主要）
- **Sparse Recall** - BM25 词法检索（主要）
- **Feedback Recall** - 反馈记忆召回（辅助，权重 0.5）
- **Meta Recall** - 元数据召回（辅助，权重 0.6）

#### Fusion
- **RRF** - Reciprocal Rank Fusion
- **Weighted** - 加权融合
- **Distribution-based** - 基于分布的融合

#### Rerank
- **LLM-based** - 使用 LLM 重排序候选结果

#### Context Compression
- **Parent-Child Chunks** - 扩展到父级 chunk
- **Sentence Window** - 提取包含关键词的句子窗口
- **Token Budget** - 控制总字符数

### 增强功能

#### 1. 复制按钮
- 位置：Ask Vault 和侧边栏的答案区域
- 功能：一键复制答案到剪贴板

#### 2. 纠正 + 反馈学习
- 位置：答案区域的"✏️ 纠正"按钮
- 功能：
  - 输入正确答案
  - 关联相关笔记（可选）
  - 自动向量化并保存
  - 作为独立召回通道参与检索

#### 3. 元数据库
- 命令：`构建元数据索引`（英文命令：`Build Meta Index (AI Summary)`）
- 生成内容：
  - `summary` - 一句话总结
  - `userRelation` - 这是用户的什么
  - `autoTags` - 自动标签
  - `noteCategory` - 笔记分类
- 用途：提升"这是什么笔记"类问题的召回

#### 4. 自动增量索引
- 监听文件变化（create/modify/delete/rename）
- 2秒防抖，避免频繁索引
- 批量处理（每批 5 个文件）
- 配置变化时提示重建

#### 5. 用户模式学习
- 高频术语统计
- 触发词识别（词频 > 5）
- 选择性加载（命中触发词才使用高级分析）
- 性能优化：普通问题 0 次 LLM 调用

### 评测与日志

#### 评测指标
- **Retrieval Relevance** - 召回相关性
- **Groundedness** - 答案基于上下文的程度
- **Citation Accuracy** - 引用准确性（基于用户纠正率）
- **Response Time** - 平均响应时间

#### 查看指标
运行命令：`Show Evaluation Metrics`

#### 查看日志
运行命令：`Show Recent Query Logs`

## 🛠️ 开发

### 构建

```bash
npm install
npm run build
```

### 开发模式

```bash
npm run dev
```

### 部署

```bash
# 复制文件到 Obsidian 插件目录
cp main.js manifest.json styles.css "path/to/.obsidian/plugins/obsidian-ai-rag-plugin/"
```

## 📊 性能优化

### 触发词选择性加载

| 场景 | 原方案 | 优化后 |
|------|--------|--------|
| 普通问题 | 3次 LLM | 0次 LLM |
| 命中触发词 | 3次 LLM | 3次 LLM |
| 追问 | 3次 LLM | 1次 LLM |

### 防抖与批处理

- 文件变化 2 秒防抖
- 每批处理 5 个文件
- 避免 API 限流

### 网络容错

- 自动重试（最多 3 次）
- 超时控制（30 秒）
- 指数退避（Rate Limit）

## 🔒 隐私与数据发送

- 插件不会内置任何 API Key；用户需要在本地 Obsidian 设置中自行配置。
- 构建向量索引会把笔记分块发送到你配置的 Embedding API。
- 提问、导入 Wiki、生成摘要会把问题和必要上下文发送到你配置的 Chat API。
- 自动索引和 Wiki 自动导入默认关闭，建议确认笔记隐私范围后再开启。
- 遇到疑似密码、密钥、令牌等敏感内容时，插件会提示跳过或标记为私密。

## 📝 数据文件

所有数据存储在 `.obsidian/plugins/obsidian-ai-rag-plugin/data/`：

- `manifest.json` - 索引元信息
- `chunks.json` - 文档分块
- `embeddings.json` - 向量数据
- `files.json` - 文件元数据
- `feedbacks.json` - 反馈记录
- `feedback-embeddings.json` - 反馈向量
- `meta-notes.json` - 元数据记录
- `meta-embeddings.json` - 元数据向量
- `user-patterns.json` - 用户模式
- `query-logs.json` - 查询日志

## ⚙️ 配置项

### API 配置
- `apiBaseUrl` - API 地址
- `apiKey` - API 密钥
- `embeddingModel` - 向量模型
- `chatModel` - 对话模型

### 索引配置
- `chunkSize` - 分块大小（默认 800）
- `overlap` - 重叠大小（默认 150）
- `autoIndexOnFileChange` - 自动增量索引（默认 false）

### 检索配置
- `topK` - 返回结果数（默认 6）
- `enableHybridSearch` - 混合检索（默认 true）
- `maxContextChars` - 最大上下文长度（默认 6000）

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可

MIT License

## 🙏 致谢

本插件基于主流 RAG 最佳实践构建，参考了多个开源项目和论文。
