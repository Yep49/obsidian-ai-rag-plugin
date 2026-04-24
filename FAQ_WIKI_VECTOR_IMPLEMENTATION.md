# FAQ 优先 + Wiki 图谱 + 向量搜索实现说明

日期: 2026-04-23

## 已实现

- Ask Vault 和侧边栏问答现在按 `FAQ -> Wiki 图谱 -> 向量/RAG` 顺序组织上下文。
- 纠正按钮现在创建正式 FAQ 页面，并写入 FAQ JSON 与 FAQ embedding。
- FAQ 强命中规则：完全匹配或相似度 >= 0.88 时直接返回用户确认答案。
- `_wiki/` 新增并支持 `faq/`、`meta/`、`relations/`。
- Meta Index 会为非 Wiki 笔记生成 `_wiki/meta/` 整理页，并维护 `_wiki/relations/note-graph.md`。
- 检测疑似密码、密钥、token、私密账号等内容时，会询问用户：正常处理、标记私密、跳过。
- 私密笔记只记录私密 meta，不发送正文给 AI，不做正文向量化。
- 自动索引排除 `_wiki/` 生成页，避免 Wiki 自己反复触发自己。
- 新增普通笔记变更时可自动更新 meta 与关系文档；开启 Wiki 自动导入时也会导入并更新 meta。

## 核心文件

- `src/services/FAQService.ts`
- `src/services/WikiGraphSearchService.ts`
- `src/services/SensitivityService.ts`
- `src/services/RagChatService.ts`
- `src/services/EnhancementService.ts`
- `src/services/WikiService.ts`
- `src/main.ts`

## 验证

- TypeScript 检查通过：`node node_modules/typescript/bin/tsc -noEmit -skipLibCheck`
- 生产构建通过：`npm run build`
- 生产依赖审计通过：`npm audit --omit=dev`
