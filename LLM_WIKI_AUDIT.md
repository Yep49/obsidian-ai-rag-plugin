# LLM Wiki 适配扫描与优化报告

日期: 2026-04-23

## 扫描结论

原插件已经具备 RAG 检索、Wiki 查询、Wiki 导入和审计雏形，但更接近“RAG 插件附带 Wiki 功能”，还没有完全落实“让 AI 长期维护一个会积累的个人 Wiki”。

## 发现的不符合项

1. 初始化不会把 schema 写入用户 Wiki。仓库里有 `_wiki/CLAUDE.md`，但 `Initialize Wiki` 只创建 `index.md` 和 `log.md`。
2. 缺少 `sources/` 来源摘要层。导入只创建实体/概念页，没有为每个原始来源生成可引用的证据页。
3. 更新已有页面时会直接用新内容覆盖旧内容，容易丢掉历史积累。
4. `wikiAutoIngest` 只是设置项，没有真正监听文件变化并导入 Wiki。
5. 审计里的“孤立页面”判断的是无外链，而 LLM Wiki 更需要检查“无入链”。
6. `index.md` 没有来源分类，不能完整体现 raw source -> Wiki 编译链路。
7. Wiki 页面更新回调调用了不存在的 `enqueueUpdate`，导致 Wiki 更新后触发 RAG 增量索引可能失败。
8. 自动索引调度器卸载监听时使用了新的 `bind` 函数引用，可能导致监听器没有被正确移除。
9. README 和 manifest 仍然把插件描述为单纯 RAG，没有表达持久 Wiki 的核心定位。

## 已完成优化

1. `Initialize Wiki` 现在会创建 `_wiki/CLAUDE.md`，内置 LLM Wiki 维护规则。
2. 新增 `_wiki/sources/`，并把 `source` 加入 Wiki 页面类型、索引、浏览器和统计。
3. 导入笔记时先创建来源摘要页，再创建或更新实体/概念页。
4. 更新已有实体/概念页时，先让 LLM 融合新旧内容，保留旧知识并标记冲突。
5. 每次导入会追加 `ingest` 日志，记录来源摘要、创建页、更新页和冲突数量。
6. `wikiAutoIngest` 现在会监听非 Wiki Markdown 的创建/修改，并防抖自动导入。
7. 审计改为按入链检测孤岛，自动修复会同时补相关链接和反向入口。
8. 修复 Wiki 更新触发 RAG 索引的 `enqueueUpdate` 缺失问题。
9. 修复索引调度器监听器释放问题，避免重复监听。
10. README、manifest、package 描述已更新为 RAG + 持久 LLM Wiki。

## 验证

- TypeScript 检查通过: `node node_modules/typescript/bin/tsc -noEmit -skipLibCheck`
- 生产 bundle 已生成: `node esbuild.config.mjs production`

## 注意

原始桌面 RAR 未被修改。优化结果在当前解压目录中，后续可复制 `main.js`、`manifest.json`、`styles.css` 到 Obsidian 插件目录测试。
