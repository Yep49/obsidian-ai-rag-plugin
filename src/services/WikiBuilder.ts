import { App, TFile } from 'obsidian';
import { WikiService } from './WikiService';
import { OpenAiCompatibleLlmClient } from './ApiClients';
import { WikiIngestResult, WikiIndexEntry, WikiPage, WikiPageType } from '../types/index';
import { LlmRetryService } from './LlmRetryService';
import { JsonExtractor } from './JsonExtractor';
import { WikiGraphSearchService } from './WikiGraphSearchService';
import { WikiIngestStateService } from './WikiIngestStateService';

interface WikiAnalysisItem {
  name: string;
  category: string;
  content: string;
}

interface WikiAnalysis {
  sourceSummary: WikiAnalysisItem | null;
  entities: WikiAnalysisItem[];
  concepts: WikiAnalysisItem[];
  summaryPages: WikiAnalysisItem[];
  relatedWikiPages: string[];
  relatedRawNotes: string[];
  conflicts: Array<{ topic: string; issue: string }>;
}

const WIKI_PAGE_FOLDERS: Record<WikiPageType, string> = {
  source: 'sources',
  entity: 'entities',
  concept: 'concepts',
  summary: 'summaries',
  synthesis: 'syntheses',
  faq: 'faq',
  meta: 'meta',
  relation: 'relations'
};

/**
 * WikiBuilder - 使用 LLM 分析笔记并构建 Wiki
 */
export class WikiBuilder {
  private app: App;
  private wikiService: WikiService;
  private llmClient: OpenAiCompatibleLlmClient;
  private retryService: LlmRetryService;
  private wikiGraphSearch?: WikiGraphSearchService;
  private ingestState?: WikiIngestStateService;

  constructor(
    app: App,
    wikiService: WikiService,
    llmClient: OpenAiCompatibleLlmClient,
    wikiGraphSearch?: WikiGraphSearchService,
    ingestState?: WikiIngestStateService
  ) {
    this.app = app;
    this.wikiService = wikiService;
    this.llmClient = llmClient;
    this.retryService = new LlmRetryService(llmClient);
    this.wikiGraphSearch = wikiGraphSearch;
    this.ingestState = ingestState;
  }

  /**
   * 导入单个笔记到 Wiki
   */
  async ingestNote(filePath: string, options: { force?: boolean } = {}): Promise<WikiIngestResult> {
    if (this.wikiService.isWikiFile(filePath)) {
      console.warn(`警告: 尝试导入 Wiki 页面 ${filePath}，已跳过。`);
      const skipped = this.createEmptyIngestResult();
      skipped.skippedFiles.push(filePath);
      return skipped;
    }

    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) {
      throw new Error(`文件不存在: ${filePath}`);
    }

    if (!options.force && this.ingestState && await this.ingestState.shouldSkip(filePath)) {
      const skipped = this.createEmptyIngestResult();
      skipped.skippedFiles.push(filePath);
      return skipped;
    }

    const content = await this.app.vault.read(file);

    // 使用 LLM 分析笔记
    const analysis = await this.analyzeNote(filePath, content);

    const result = this.createEmptyIngestResult();
    result.conflicts.push(...analysis.conflicts.map(conflict => ({
      page: conflict.topic,
      issue: conflict.issue
    })));

    const sourceSummary = analysis.sourceSummary || {
      name: file.basename,
      category: '原始来源',
      content: `${content.substring(0, 800)}`
    };

    const sourcePagePath = await this.upsertPage(
      'source',
      sourceSummary.name || file.basename,
      this.buildSourcePageContent(filePath, sourceSummary.content, analysis.relatedWikiPages, analysis.relatedRawNotes),
      sourceSummary.category || '原始来源',
      filePath,
      undefined,
      result
    );
    result.sourcePagePath = sourcePagePath;

    // 创建/更新实体页面
    for (const entity of analysis.entities) {
      await this.upsertPage(
        'entity',
        entity.name,
        this.ensureSourceLinks(entity.content, filePath, sourcePagePath),
        entity.category,
        filePath,
        sourcePagePath,
        result
      );
    }

    // 创建/更新概念页面
    for (const concept of analysis.concepts) {
      await this.upsertPage(
        'concept',
        concept.name,
        this.ensureSourceLinks(concept.content, filePath, sourcePagePath),
        concept.category,
        filePath,
        sourcePagePath,
        result
      );
    }

    // 创建/更新摘要页面
    for (const summary of analysis.summaryPages) {
      await this.upsertPage(
        'summary',
        summary.name,
        this.ensureSourceLinks(summary.content, filePath, sourcePagePath),
        summary.category,
        filePath,
        sourcePagePath,
        result
      );
    }

    const today = new Date().toISOString().split('T')[0];
    await this.wikiService.addLogEntry({
      timestamp: Date.now(),
      date: today,
      action: 'ingest',
      title: filePath,
      details:
        `- 来源摘要: [[${sourcePagePath}]]\n` +
        `- 创建页面: ${result.createdPages.length}\n` +
        `- 更新页面: ${result.updatedPages.length}\n` +
        `- 相关 Wiki 页面: ${analysis.relatedWikiPages.length}\n` +
        `- 相关原始笔记: ${analysis.relatedRawNotes.length}\n` +
        `- 冲突/待核实: ${result.conflicts.length}`
    });

    if (this.ingestState) {
      await this.ingestState.markIngested(file, sourcePagePath);
    }

    return result;
  }

  private createEmptyIngestResult(): WikiIngestResult {
    return {
      sourcesCreated: [],
      sourcesUpdated: [],
      entitiesCreated: [],
      entitiesUpdated: [],
      conceptsCreated: [],
      conceptsUpdated: [],
      summariesCreated: [],
      summariesUpdated: [],
      createdPages: [],
      updatedPages: [],
      skippedFiles: [],
      conflicts: []
    };
  }

  private async upsertPage(
    type: WikiPageType,
    title: string,
    incomingContent: string,
    category: string,
    rawSourcePath: string,
    sourcePagePath: string | undefined,
    result: WikiIngestResult
  ): Promise<string> {
    const existingPath = this.getPagePath(type, title);
    const existingPage = await this.wikiService.readPage(existingPath);
    const isUpdate = Boolean(existingPage);
    let nextContent = incomingContent;
    let sources = Math.max(1, (existingPage?.frontmatter.sources || 0) + (type === 'source' ? 0 : 1));

    if (existingPage && type !== 'source') {
      const merged = await this.mergeWithExistingPage(existingPage, incomingContent, rawSourcePath, sourcePagePath);
      nextContent = merged.content;
      result.conflicts.push(...merged.conflicts.map(issue => ({
        page: existingPage.path,
        issue
      })));
    }

    if (type === 'source' && existingPage) {
      sources = Math.max(1, existingPage.frontmatter.sources || 1);
    }

    const path = await this.wikiService.createOrUpdatePage(
      type,
      title,
      nextContent,
      category,
      sources
    );

    this.recordPageChange(type, title, path, isUpdate, result);
    return path;
  }

  private recordPageChange(
    type: WikiPageType,
    title: string,
    path: string,
    isUpdate: boolean,
    result: WikiIngestResult
  ): void {
    if (isUpdate) {
      result.updatedPages.push({ type, title, path });
    } else {
      result.createdPages.push({ type, title, path });
    }

    if (type === 'source') {
      (isUpdate ? result.sourcesUpdated : result.sourcesCreated).push(title);
    } else if (type === 'entity') {
      (isUpdate ? result.entitiesUpdated : result.entitiesCreated).push(title);
    } else if (type === 'concept') {
      (isUpdate ? result.conceptsUpdated : result.conceptsCreated).push(title);
    } else if (type === 'summary') {
      (isUpdate ? result.summariesUpdated : result.summariesCreated).push(title);
    }
  }

  private getPagePath(type: WikiPageType, title: string): string {
    return `${this.wikiService.getWikiPath()}/${WIKI_PAGE_FOLDERS[type]}/${this.wikiService.sanitizeFileName(title)}.md`;
  }

  private ensureSourceLinks(content: string, rawSourcePath: string, sourcePagePath?: string): string {
    let nextContent = content || '';

    if (!nextContent.includes(`[[${rawSourcePath}]]`)) {
      nextContent += `\n\n## 来源\n\n- [[${rawSourcePath}]]`;
    }

    if (sourcePagePath && !nextContent.includes(`[[${sourcePagePath}]]`)) {
      nextContent += `\n- 来源摘要: [[${sourcePagePath}]]`;
    }

    return nextContent.trim();
  }

  private buildSourcePageContent(
    rawSourcePath: string,
    summaryBody: string,
    relatedWikiPages: string[],
    relatedRawNotes: string[]
  ): string {
    const wikiLinks = relatedWikiPages.length > 0
      ? relatedWikiPages.map(path => `- [[${path}]]`).join('\n')
      : '- 暂无';
    const rawLinks = relatedRawNotes.length > 0
      ? relatedRawNotes.map(path => `- [[${path}]]`).join('\n')
      : '- 暂无';

    return `## 摘要与整理
${this.stripGeneratedHeadings(summaryBody)}

## 相关 Wiki 页面
${wikiLinks}

## 相关原始笔记
${rawLinks}

## 来源与证据
- 原始笔记: [[${rawSourcePath}]]`;
  }

  private stripGeneratedHeadings(content: string): string {
    return (content || '')
      .replace(/^#\s+.+$/gm, '')
      .trim();
  }

  private async mergeWithExistingPage(
    existingPage: WikiPage,
    incomingContent: string,
    rawSourcePath: string,
    sourcePagePath?: string
  ): Promise<{ content: string; conflicts: string[] }> {
    const existingBody = this.stripWikiEnvelope(existingPage.content, existingPage.title);
    const sourceLink = sourcePagePath ? `[[${sourcePagePath}]]` : `[[${rawSourcePath}]]`;
    const prompt = `你是 LLM Wiki 维护员。请把“新来源信息”融合进已有 Wiki 页面，形成新的页面正文。

页面标题: ${existingPage.title}
页面路径: ${existingPage.path}
新来源: ${sourceLink}
原始来源: [[${rawSourcePath}]]

已有页面正文:
\`\`\`
${existingBody.substring(0, 6000)}
\`\`\`

新来源信息:
\`\`\`
${incomingContent.substring(0, 4000)}
\`\`\`

要求：
1. 返回的是页面正文，不要包含 YAML frontmatter，也不要包含一级标题。
2. 保留已有有效信息，不要直接覆盖成新摘要。
3. 把新信息整合到合适小节，补充内部链接和来源引用。
4. 如果新旧信息冲突，保留两边说法，添加“## 冲突/待核实”小节并说明来源。
5. 删除明显重复的段落，但不要删除仍有价值的历史信息。

请返回 JSON：
{
  "content": "融合后的完整 Markdown 正文",
  "conflicts": ["冲突或待核实事项；没有则空数组"]
}`;

    try {
      const response = await this.retryService.chatWithRetry(
        [{ role: 'user', content: prompt }],
        0.2,
        'mergeWikiPage'
      );

      const merged = JsonExtractor.extractSafe(response, null);
      if (merged && typeof merged.content === 'string') {
        return {
          content: merged.content,
          conflicts: Array.isArray(merged.conflicts) ? merged.conflicts : []
        };
      }
    } catch (error) {
      console.error('融合 Wiki 页面失败，使用追加降级策略:', error);
    }

    const today = new Date().toISOString().split('T')[0];
    return {
      content: `${existingBody}\n\n## ${today} 更新\n\n来源: ${sourceLink}\n\n${incomingContent}`.trim(),
      conflicts: []
    };
  }

  private stripWikiEnvelope(content: string, title: string): string {
    return content
      .replace(/^---[\s\S]*?---\n/, '')
      .replace(new RegExp(`^#\\s+${this.escapeRegExp(title)}\\s*\\n?`, 'm'), '')
      .trim();
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 使用 LLM 分析笔记
   */
  private async analyzeNote(
    filePath: string,
    content: string
  ): Promise<WikiAnalysis> {
    const wikiPath = this.wikiService.getWikiPath();
    if (this.wikiService.isWikiFile(filePath)) {
      console.warn(`警告: 尝试分析 Wiki 页面 ${filePath}，这可能会修改 Wiki 内容。已跳过。`);
      return {
        sourceSummary: null,
        entities: [],
        concepts: [],
        summaryPages: [],
        relatedWikiPages: [],
        relatedRawNotes: [],
        conflicts: []
      };
    }

    // 读取 CLAUDE.md 规则（如果存在）
    let claudeRules = '';
    const claudeMdPath = `${wikiPath}/CLAUDE.md`;
    const claudeMdFile = this.app.vault.getAbstractFileByPath(claudeMdPath);

    if (claudeMdFile && claudeMdFile instanceof TFile) {
      claudeRules = await this.app.vault.read(claudeMdFile);
    }

    let indexContext = '';
    const indexFile = this.app.vault.getAbstractFileByPath(`${wikiPath}/index.md`);
    if (indexFile && indexFile instanceof TFile) {
      indexContext = (await this.app.vault.read(indexFile)).substring(0, 3000);
    }

    const candidateWikiPages = await this.findCandidateWikiPages(filePath, content);
    const candidateRawNotes = await this.findCandidateRawNotes(filePath, content);
    const candidateWikiText = candidateWikiPages.length > 0
      ? candidateWikiPages.map(page => `- ${page.title} | ${page.path} | ${page.frontmatter.category}`).join('\n')
      : '- 暂无';
    const candidateRawText = candidateRawNotes.length > 0
      ? candidateRawNotes.map(path => `- ${path}`).join('\n')
      : '- 暂无';

    const prompt = `你是一个 LLM Wiki 知识库管理员。请分析以下原始来源，把它编译进一个持久 Wiki，而不是只做临时 RAG 摘要。

${claudeRules ? `## Wiki 维护规则\n${claudeRules}\n\n` : ''}笔记路径: ${filePath}

现有 Wiki 索引摘录:
${indexContext || '当前没有可用索引。'}

候选 Wiki 页面:
${candidateWikiText}

候选原始笔记:
${candidateRawText}

笔记内容:
\`\`\`
${content.substring(0, 6000)}
\`\`\`

请按照以下格式返回 JSON：

{
  "sourceSummary": {
    "name": "来源摘要标题，优先使用原始笔记标题",
    "category": "原始来源分类，如 文章、会议记录、论文、网页剪藏、笔记",
    "content": "来源摘要页正文。包含：摘要、核心事实、值得沉淀的知识点、来源链接 [[${filePath}]]。使用 Markdown。"
  },
  "entities": [
    {
      "name": "实体名称",
      "category": "实体分类（如：人物、组织、项目、工具、产品、地点）",
      "content": "实体页面的新增知识。包含基本信息、关键属性、相关链接、来源 [[${filePath}]]。使用 Markdown。"
    }
  ],
  "concepts": [
    {
      "name": "概念名称",
      "category": "概念分类（如：技术、方法论）",
      "content": "概念页面的新增知识。包含定义、核心要点、应用场景、相关链接、来源 [[${filePath}]]。使用 Markdown。"
    }
  ],
  "summaryPages": [
    {
      "name": "适合沉淀的主题综述标题",
      "category": "主题摘要",
      "content": "摘要页面的新增内容。用于跨来源的主题总结。"
    }
  ],
  "relatedWikiPages": ["最相关的 Wiki 页面路径，如 _wiki/concepts/RAG.md"],
  "relatedRawNotes": ["最相关的原始笔记路径，如 folder/note.md"],
  "conflicts": [
    {
      "topic": "可能冲突的主题",
      "issue": "新来源与现有索引或常识中可能不一致之处；没有则返回空数组"
    }
  ]
}

注意：
1. sourceSummary 必须返回，作为 raw source 与 Wiki 的桥梁
2. 只识别重要实体和概念，不要为碎片细节建页
3. 不要重复复制同一段内容到多个页面，优先用 [[内部链接]]
4. 每个 content 都必须包含原始来源链接：[[${filePath}]]
5. relatedWikiPages 必须优先从候选 Wiki 页面里选；relatedRawNotes 必须优先从候选原始笔记里选
6. summaryPages 只有在真的值得沉淀成主题综述时才返回
7. 如果没有识别到实体、概念或关系，返回空数组
${claudeRules ? '6. 严格遵守上述 Wiki 维护规则\n' : ''}
请直接返回 JSON，不要有其他文字。`;

    try {
      const response = await this.retryService.chatWithRetry(
        [{ role: 'user', content: prompt }],
        0.3,
        'analyzeNote'
      );

      // 使用 JsonExtractor 提取和验证 JSON
      const analysis = JsonExtractor.extractAndValidate(response, ['sourceSummary', 'entities', 'concepts']);
      return {
        sourceSummary: analysis.sourceSummary || null,
        entities: Array.isArray(analysis.entities) ? analysis.entities : [],
        concepts: Array.isArray(analysis.concepts) ? analysis.concepts : [],
        summaryPages: Array.isArray(analysis.summaryPages) ? analysis.summaryPages : [],
        relatedWikiPages: Array.isArray(analysis.relatedWikiPages) ? analysis.relatedWikiPages : [],
        relatedRawNotes: Array.isArray(analysis.relatedRawNotes) ? analysis.relatedRawNotes : [],
        conflicts: Array.isArray(analysis.conflicts) ? analysis.conflicts : []
      };
    } catch (error) {
      console.error('分析笔记失败:', error);
      return {
        sourceSummary: null,
        entities: [],
        concepts: [],
        summaryPages: [],
        relatedWikiPages: [],
        relatedRawNotes: [],
        conflicts: []
      };
    }
  }

  private async findCandidateWikiPages(filePath: string, content: string): Promise<WikiPage[]> {
    const query = `${filePath.split('/').pop() || filePath} ${this.extractSearchTerms(content).slice(0, 6).join(' ')}`.trim();
    const pages = this.wikiGraphSearch
      ? await this.wikiGraphSearch.search(query, 6)
      : await this.wikiService.searchWiki(query);
    return pages.filter(page => page.path !== filePath).slice(0, 6);
  }

  private async findCandidateRawNotes(filePath: string, content: string): Promise<string[]> {
    const files = this.app.vault.getMarkdownFiles()
      .filter(file => file.path !== filePath && !this.wikiService.isWikiFile(file.path));
    const tokens = this.extractSearchTerms(`${filePath}\n${content}`);

    return files
      .map(file => {
        const haystack = `${file.path} ${file.basename}`.toLowerCase();
        const score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
        return { path: file.path, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(item => item.path);
  }

  private extractSearchTerms(content: string): string[] {
    return Array.from(new Set(
      (content.toLowerCase().match(/[\u4e00-\u9fff]{2,}|[a-z0-9][a-z0-9._-]{1,}/g) || []).slice(0, 20)
    ));
  }

  /**
   * 批量导入笔记（支持交互模式）
   */
  async batchIngest(
    filePaths: string[],
    progressCallback?: (current: number, total: number, file: string) => void,
    interactiveMode: boolean = false,
    interactiveCallback?: (result: WikiIngestResult) => Promise<boolean>,
    options: { force?: boolean } = {}
  ): Promise<WikiIngestResult> {
    const totalResult = this.createEmptyIngestResult();

    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i];

      if (progressCallback) {
        progressCallback(i + 1, filePaths.length, filePath);
      }

      try {
        const result = await this.ingestNote(filePath, options);

        totalResult.sourcesCreated.push(...result.sourcesCreated);
        totalResult.sourcesUpdated.push(...result.sourcesUpdated);
        totalResult.entitiesCreated.push(...result.entitiesCreated);
        totalResult.entitiesUpdated.push(...result.entitiesUpdated);
        totalResult.conceptsCreated.push(...result.conceptsCreated);
        totalResult.conceptsUpdated.push(...result.conceptsUpdated);
        totalResult.summariesCreated.push(...result.summariesCreated);
        totalResult.summariesUpdated.push(...result.summariesUpdated);
        totalResult.createdPages.push(...result.createdPages);
        totalResult.updatedPages.push(...result.updatedPages);
        totalResult.skippedFiles.push(...result.skippedFiles);
        totalResult.conflicts.push(...result.conflicts);

        // 交互模式：每处理一个笔记后暂停，等待用户确认
        if (interactiveMode && i < filePaths.length - 1 && interactiveCallback) {
          const shouldContinue = await interactiveCallback(result);
          if (!shouldContinue) {
            // 用户选择停止
            console.log('用户停止了批量导入');
            break;
          }
        }
      } catch (error) {
        console.error(`导入失败: ${filePath}`, error);
        totalResult.conflicts.push({
          page: filePath,
          issue: `导入失败: ${error instanceof Error ? error.message : String(error)}`
        });
      }

      // 避免 API 限流，每个文件之间延迟 1 秒
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return totalResult;
  }

  /**
   * 重建索引
   */
  async rebuildIndex(): Promise<void> {
    const pages = await this.wikiService.getAllPages();
    const entries: WikiIndexEntry[] = [];

    for (const page of pages) {
      // 提取描述（第一段内容）
      const description = this.extractDescription(page.content);

      entries.push({
        title: page.title,
        path: page.path,
        description,
        type: page.type,
        category: page.frontmatter.category,
        updated: page.frontmatter.updated
      });
    }

    await this.wikiService.updateIndex(entries);
  }

  /**
   * 提取描述（第一段内容）
   */
  private extractDescription(content: string): string {
    // 移除 frontmatter
    const withoutFm = content.replace(/^---[\s\S]*?---\n/, '');

    // 移除标题
    const withoutTitle = withoutFm.replace(/^#\s+.+\n/, '');

    // 提取第一段
    const paragraphs = withoutTitle.split('\n\n');
    const firstParagraph = paragraphs.find(p => p.trim().length > 0) || '';

    // 限制长度
    return firstParagraph.substring(0, 100).trim() + (firstParagraph.length > 100 ? '...' : '');
  }

  /**
   * 查询 Wiki 并生成综合答案
   */
  async queryWiki(question: string): Promise<{
    answer: string;
    sources: string[];
    shouldArchive: boolean;
  }> {
    // 搜索相关 Wiki 页面
    const pages = this.wikiGraphSearch
      ? await this.wikiGraphSearch.search(question, 8)
      : await this.wikiService.searchWiki(question);

    if (pages.length === 0) {
      return {
        answer: '未找到足够相关的 Wiki 页面。',
        sources: [],
        shouldArchive: false
      };
    }

    // 构建上下文
    let context = '';
    const sources: string[] = [];

    for (let i = 0; i < Math.min(pages.length, 8); i++) {
      const page = pages[i];
      context += `[W${i + 1}] ${page.title} | ${page.path}\n${page.content.substring(0, 1200)}\n\n`;
      sources.push(page.path);
    }

    // 读取 CLAUDE.md 规则
    let claudeRules = '';
    const claudeMdPath = `${this.wikiService.getWikiPath()}/CLAUDE.md`;
    const claudeMdFile = this.app.vault.getAbstractFileByPath(claudeMdPath);

    if (claudeMdFile && claudeMdFile instanceof TFile) {
      claudeRules = await this.app.vault.read(claudeMdFile);
    }

    // 使用 LLM 生成答案，并让它判断是否值得归档
    const prompt = `基于以下 Wiki 页面回答问题。

${claudeRules ? `## Wiki 维护规则\n${claudeRules}\n\n` : ''}问题: ${question}

Wiki 内容:
${context}

请先简短列出命中的相关页面，再给出综合答案。使用 Markdown，结构固定为：

## 相关页面
- [W1] 页面名

## 结论

## 要点

## 依据

引用来源使用 [W1], [W2]。

然后，判断这个问答是否值得归档为 synthesis 页面。归档标准：
1. 答案综合了多个来源的信息
2. 问题具有一定的复杂性和深度
3. 答案对未来查询有参考价值
4. 不是简单的事实查询

请按以下格式返回 JSON：
{
  "answer": "综合答案内容",
  "shouldArchive": true/false,
  "archiveReason": "归档或不归档的理由"
}

请直接返回 JSON，不要有其他文字。`;

    try {
      const response = await this.retryService.chatWithRetry(
        [{ role: 'user', content: prompt }],
        0.3,
        'queryWiki'
      );

      // 使用 JsonExtractor 提取 JSON，带降级处理
      try {
        const result = JsonExtractor.extractAndValidate(response, ['answer', 'shouldArchive']);
        return {
          answer: result.answer,
          sources,
          shouldArchive: result.shouldArchive || false
        };
      } catch (extractError) {
        // 降级处理：直接使用响应作为答案
        console.warn('JSON 提取失败，使用原始响应:', extractError);
        return {
          answer: response,
          sources,
          shouldArchive: this.shouldArchiveQuestion(question, response)
        };
      }
    } catch (error) {
      console.error('生成答案失败:', error);
      return {
        answer: '生成答案时出错。',
        sources,
        shouldArchive: false
      };
    }
  }

  /**
   * 判断问题是否值得归档
   */
  private shouldArchiveQuestion(question: string, answer: string): boolean {
    // 简单规则：问题长度 > 10 且答案长度 > 100
    return question.length > 10 && answer.length > 100;
  }

  /**
   * 归档问答为综合页面
   */
  async archiveQuery(
    question: string,
    answer: string,
    sources: string[]
  ): Promise<string> {
    const title = question.substring(0, 50);
    const sourcesText = sources.map((s, i) => `${i + 1}. [[${s}]]`).join('\n');

    const content = `## 问题
${question}

## 综合答案
${answer}

## 证据链
${sourcesText}`;

    const path = await this.wikiService.createOrUpdatePage(
      'synthesis',
      title,
      content,
      '问答',
      sources.length
    );

    // 更新索引
    await this.rebuildIndex();

    // 添加日志
    const today = new Date().toISOString().split('T')[0];
    await this.wikiService.addLogEntry({
      timestamp: Date.now(),
      date: today,
      action: 'query',
      title: question,
      details: `- 创建综合页面\n- 引用 ${sources.length} 个来源`
    });

    return path;
  }

  /**
   * 生成主题摘要
   * 分析多个相关页面，生成综合性的主题摘要
   */
  async generateSummary(
    topic: string,
    category: string = '主题摘要'
  ): Promise<string> {
    // 搜索相关页面
    const pages = await this.wikiService.searchWiki(topic);

    if (pages.length === 0) {
      throw new Error(`未找到与主题 "${topic}" 相关的页面`);
    }

    // 构建上下文（最多使用 10 个页面）
    let context = '';
    const sources: string[] = [];

    for (let i = 0; i < Math.min(pages.length, 10); i++) {
      const page = pages[i];
      context += `## ${page.title} (${page.type})\n${page.content.substring(0, 1500)}\n\n`;
      sources.push(page.path);
    }

    // 读取 CLAUDE.md 规则
    let claudeRules = '';
    const claudeMdPath = `${this.wikiService.getWikiPath()}/CLAUDE.md`;
    const claudeMdFile = this.app.vault.getAbstractFileByPath(claudeMdPath);

    if (claudeMdFile && claudeMdFile instanceof TFile) {
      claudeRules = await this.app.vault.read(claudeMdFile);
    }

    // 使用 LLM 生成摘要
    const prompt = `你是一个知识库管理员。请基于以下相关页面，生成一个关于 "${topic}" 的综合性主题摘要。

${claudeRules ? `## Wiki 维护规则\n${claudeRules}\n\n` : ''}相关页面内容:
${context}

请生成一个结构化的主题摘要，包含：
1. 主题概述（2-3 句话）
2. 核心要点（3-5 个要点）
3. 关键实体和概念（列出相关的实体和概念）
4. 相关链接（使用 [[页面路径]] 格式）

请按以下格式返回 JSON：
{
  "title": "摘要标题（简洁明了）",
  "overview": "主题概述",
  "keyPoints": ["要点1", "要点2", "要点3"],
  "relatedEntities": ["实体1", "实体2"],
  "relatedConcepts": ["概念1", "概念2"],
  "content": "完整的摘要内容（Markdown 格式，包含所有章节）"
}

注意：
1. 摘要应该综合多个来源的信息
2. 突出主题的核心价值和关键信息
3. 使用清晰的 Markdown 格式
4. 在 content 中包含相关页面的链接
${claudeRules ? '5. 严格遵守上述 Wiki 维护规则\n' : ''}
请直接返回 JSON，不要有其他文字。`;

    try {
      const response = await this.retryService.chatWithRetry(
        [{ role: 'user', content: prompt }],
        0.3,
        'generateSummary'
      );

      // 使用 JsonExtractor 提取 JSON
      const result = JsonExtractor.extractAndValidate(response, [
        'title',
        'overview',
        'keyPoints',
        'content'
      ]);

      // 创建摘要页面
      const path = await this.wikiService.createOrUpdatePage(
        'summary',
        result.title,
        result.content,
        category,
        sources.length
      );

      // 添加日志
      const today = new Date().toISOString().split('T')[0];
      await this.wikiService.addLogEntry({
        timestamp: Date.now(),
        date: today,
        action: 'summary',
        title: result.title,
        details: `- 生成主题摘要\n- 综合 ${sources.length} 个来源\n- 主题: ${topic}`
      });

      return path;
    } catch (error) {
      console.error('生成摘要失败:', error);
      throw new Error(`生成摘要失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 批量生成摘要
   * 为指定的主题列表生成摘要
   */
  async batchGenerateSummaries(
    topics: Array<{ topic: string; category?: string }>,
    progressCallback?: (current: number, total: number, topic: string) => void
  ): Promise<{ success: string[]; failed: Array<{ topic: string; error: string }> }> {
    const success: string[] = [];
    const failed: Array<{ topic: string; error: string }> = [];

    for (let i = 0; i < topics.length; i++) {
      const { topic, category } = topics[i];

      if (progressCallback) {
        progressCallback(i + 1, topics.length, topic);
      }

      try {
        const path = await this.generateSummary(topic, category);
        success.push(path);
      } catch (error) {
        failed.push({
          topic,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      // 避免 API 限流
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return { success, failed };
  }

  /**
   * 获取重试服务（用于访问失败记录）
   */
  getRetryService(): LlmRetryService {
    return this.retryService;
  }
}
