import { App, TFile, TFolder } from 'obsidian';
import {
  WikiPage,
  WikiPageType,
  WikiPageFrontmatter,
  WikiIndexEntry,
  WikiLogEntry,
  SearchResult
} from '../types/index';

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

const DEFAULT_WIKI_SCHEMA = `# Wiki 维护规则

本文件是 LLM Wiki 的说明书。LLM 负责维护 Wiki 层；原始笔记、网页剪藏、PDF 摘录和会议记录是 raw sources，只读，不应被插件自动改写。

## 核心原则

1. Wiki 是持久、累积的知识层，不是一次性 RAG 检索结果。
2. 导入新来源时，先创建 source 摘要页，再更新相关 entity/concept/summary/synthesis 页面。
3. 更新已有页面时要融合新旧信息，保留来源、时间和不确定性；不要用新摘要直接覆盖旧知识。
4. 发现新旧说法冲突时，保留两种说法并添加“冲突/待核实”小节，说明来源和需要确认的问题。
5. 每个页面应有清晰的 frontmatter、内部链接和来源引用。

## 三层结构

- raw sources: 原始资料，只读，是证据层。
- wiki: LLM 生成和维护的 Markdown 页面。
- schema: 本文件，定义维护规则和操作流程。

## 目录约定

- sources/: 每个原始来源的摘要、关键点、可复用证据。
- faq/: 用户纠正后确认过的问答，优先级最高。
- meta/: 每篇原始笔记的整理性说明，不改写原文。
- relations/: 笔记和 Wiki 页面之间的关系总表。
- entities/: 人物、组织、项目、工具、产品、地点等具体对象。
- concepts/: 理论、方法、原则、模式等抽象知识。
- summaries/: 主题综述、学习路径、领域地图。
- syntheses/: 值得保留的问答、比较、决策分析。
- index.md: 内容索引，按类型列出页面和一句话描述。
- log.md: 时间线日志，使用“## [YYYY-MM-DD] action | title”格式。

## Ingest 工作流

1. 阅读来源，提取来源摘要、关键事实、实体、概念和潜在冲突。
2. 为来源创建 sources 页面，链接回原始笔记。
3. 对已有实体/概念页面做融合更新；新页面才创建。
4. 添加双链，避免孤立页面。
5. 更新 index.md，并在 log.md 追加 ingest 记录。

## Query 工作流

1. 先读 index.md 定位相关页面。
2. 读取相关 Wiki 页面综合回答，并给出来源。
3. 如果答案有长期价值，归档为 syntheses 页面。

## Lint 工作流

定期检查页面矛盾、无入链页面、缺失交叉引用、过时信息和知识空白。
`;

/**
 * WikiService - Wiki 系统核心服务
 * 负责 Wiki 页面的创建、更新、读取和管理
 */
export class WikiService {
  private app: App;
  private wikiPath: string;
  private indexCache: WikiIndexEntry[] | null = null;
  private pagesCache: Map<string, WikiPage> | null = null;
  private cacheTimestamp: number = 0;
  private cacheTTL: number = 60000; // 1分钟缓存
  private onPageUpdated?: (filePath: string) => void;

  constructor(app: App, wikiPath: string = '_wiki') {
    this.app = app;
    this.wikiPath = this.normalizeWikiPath(wikiPath);
  }

  getWikiPath(): string {
    return this.wikiPath;
  }

  isWikiFile(filePath: string): boolean {
    return filePath === this.wikiPath || filePath.startsWith(`${this.wikiPath}/`);
  }

  /**
   * 设置页面更新回调（用于触发 RAG 索引更新）
   */
  setPageUpdateCallback(callback: (filePath: string) => void): void {
    this.onPageUpdated = callback;
  }

  /**
   * 初始化 Wiki 目录结构
   */
  async initializeWikiStructure(): Promise<void> {
    const folders = [
      this.wikiPath,
      `${this.wikiPath}/faq`,
      `${this.wikiPath}/meta`,
      `${this.wikiPath}/relations`,
      `${this.wikiPath}/sources`,
      `${this.wikiPath}/entities`,
      `${this.wikiPath}/concepts`,
      `${this.wikiPath}/summaries`,
      `${this.wikiPath}/syntheses`
    ];

    for (const folder of folders) {
      const folderExists = this.app.vault.getAbstractFileByPath(folder);
      if (!folderExists) {
        await this.app.vault.createFolder(folder);
      }
    }

    // 创建 index.md 和 log.md
    await this.ensureIndexFile();
    await this.ensureLogFile();
    await this.ensureSchemaFile();

  }

  /**
   * 确保 index.md 存在
   */
  private async ensureIndexFile(): Promise<void> {
    const indexPath = `${this.wikiPath}/index.md`;
    const indexFile = this.app.vault.getAbstractFileByPath(indexPath);

    if (!indexFile) {
      const today = new Date().toISOString().split('T')[0];
      const content = `# Wiki 索引

最后更新: ${today}

## 来源 (Sources)

## FAQ

## Meta

## 关系 (Relations)

## 实体 (Entities)

## 概念 (Concepts)

## 摘要 (Summaries)

## 综合 (Syntheses)

---

**统计**: 0 FAQ | 0 Meta | 0 关系 | 0 来源 | 0 实体 | 0 概念 | 0 摘要 | 0 综合 | 共 0 页
`;
      await this.app.vault.create(indexPath, content);
    }
  }

  /**
   * 确保 log.md 存在
   */
  private async ensureLogFile(): Promise<void> {
    const logPath = `${this.wikiPath}/log.md`;
    const logFile = this.app.vault.getAbstractFileByPath(logPath);

    if (!logFile) {
      const today = new Date().toISOString().split('T')[0];
      const content = `# Wiki 更新日志

## [${today}] init | 初始化 Wiki 系统
- 创建目录结构
- 创建 index.md、log.md 和 CLAUDE.md
`;
      await this.app.vault.create(logPath, content);
    }
  }

  /**
   * 确保 schema 文件存在。该文件是 LLM Wiki 的操作说明书。
   */
  private async ensureSchemaFile(): Promise<void> {
    const schemaPath = `${this.wikiPath}/CLAUDE.md`;
    const schemaFile = this.app.vault.getAbstractFileByPath(schemaPath);

    if (!schemaFile) {
      await this.app.vault.create(schemaPath, DEFAULT_WIKI_SCHEMA);
    }
  }

  /**
   * 创建或更新 Wiki 页面
   */
  async createOrUpdatePage(
    type: WikiPageType,
    title: string,
    content: string,
    category: string,
    sources: number = 1
  ): Promise<string> {
    const folder = WIKI_PAGE_FOLDERS[type];
    const fileName = this.sanitizeFileName(title);
    await this.ensureFolder(`${this.wikiPath}/${folder}`);
    const filePath = `${this.wikiPath}/${folder}/${fileName}.md`;

    const today = new Date().toISOString().split('T')[0];

    // 检查文件是否存在
    const existingFile = this.app.vault.getAbstractFileByPath(filePath);

    let frontmatter: WikiPageFrontmatter;
    let isUpdate = false;

    if (existingFile && existingFile instanceof TFile) {
      // 更新现有页面
      const existingContent = await this.app.vault.read(existingFile);
      const existingFrontmatter = this.parseFrontmatter(existingContent);

      frontmatter = {
        ...existingFrontmatter,
        updated: today,
        sources
      };
      isUpdate = true;
    } else {
      // 创建新页面
      frontmatter = {
        type,
        category,
        created: today,
        updated: today,
        sources
      };
    }

    const fullContent = this.buildPageContent(title, frontmatter, content);

    if (existingFile && existingFile instanceof TFile) {
      await this.app.vault.modify(existingFile, fullContent);
    } else {
      await this.app.vault.create(filePath, fullContent);
    }

    // 清除缓存，避免 backlinks 和关系索引过期
    this.clearCache();

    // 自动更新索引和日志
    await this.autoUpdateIndexAndLog(type, title, filePath, isUpdate);

    return filePath;
  }

  /**
   * 自动更新索引和日志（在创建/更新页面后调用）
   */
  private async autoUpdateIndexAndLog(
    type: WikiPageType,
    title: string,
    filePath: string,
    isUpdate: boolean
  ): Promise<void> {
    try {
      // 重建索引
      const pages = await this.getAllPages();
      const entries: WikiIndexEntry[] = [];

      for (const page of pages) {
        const description = this.extractDescriptionFromContent(page.content);
        entries.push({
          title: page.title,
          path: page.path,
          description,
          type: page.type,
          category: page.frontmatter.category,
          updated: page.frontmatter.updated
        });
      }

      await this.updateIndex(entries);

      // 添加日志条目
      const today = new Date().toISOString().split('T')[0];
      await this.addLogEntry({
        timestamp: Date.now(),
        date: today,
        action: 'update',
        title: title,
        details: `- ${isUpdate ? '更新' : '创建'} ${type} 页面: [[${filePath}]]`
      });

      // 触发 RAG 索引更新回调
      if (this.onPageUpdated) {
        this.onPageUpdated(filePath);
      }
    } catch (error) {
      console.error('自动更新索引和日志失败:', error);
    }
  }

  /**
   * 从内容中提取描述
   */
  private extractDescriptionFromContent(content: string): string {
    const withoutFm = content.replace(/^---[\s\S]*?---\n/, '');
    const withoutTitle = withoutFm.replace(/^#\s+.+\n/, '');
    const paragraphs = withoutTitle.split('\n\n');
    const firstParagraph = paragraphs.find(p => p.trim().length > 0) || '';
    return firstParagraph.substring(0, 100).trim() + (firstParagraph.length > 100 ? '...' : '');
  }

  /**
   * 构建页面完整内容（包含 frontmatter）
   */
  private buildPageContent(
    title: string,
    frontmatter: WikiPageFrontmatter,
    content: string
  ): string {
    const fm = `---
type: ${frontmatter.type}
category: ${frontmatter.category}
created: ${frontmatter.created}
updated: ${frontmatter.updated}
sources: ${frontmatter.sources}${frontmatter.question ? `\nquestion: ${frontmatter.question}` : ''}
---

# ${title}

${content}`;
    return fm;
  }

  /**
   * 解析 frontmatter
   */
  private parseFrontmatter(content: string): WikiPageFrontmatter {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
      return {
        type: 'concept',
        category: 'Unknown',
        created: new Date().toISOString().split('T')[0],
        updated: new Date().toISOString().split('T')[0],
        sources: 0
      };
    }

    const fmText = fmMatch[1];
    const lines = fmText.split('\n');
    const fm: Record<string, string> = {};

    for (const line of lines) {
      const [key, ...valueParts] = line.split(':');
      if (key && valueParts.length > 0) {
        fm[key.trim()] = valueParts.join(':').trim();
      }
    }

    return {
      type: (fm.type || 'concept') as WikiPageType,
      category: fm.category || 'Unknown',
      created: fm.created || new Date().toISOString().split('T')[0],
      updated: fm.updated || new Date().toISOString().split('T')[0],
      sources: parseInt(fm.sources) || 0,
      question: fm.question
    };
  }

  /**
   * 清理文件名（移除特殊字符）
   */
  sanitizeFileName(name: string): string {
    return name
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 100);
  }

  private normalizeWikiPath(path: string): string {
    return (path || '_wiki').replace(/^\/+|\/+$/g, '') || '_wiki';
  }

  /**
   * 读取 Wiki 页面
   */
  async readPage(path: string): Promise<WikiPage | null> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file || !(file instanceof TFile)) {
      return null;
    }

    const content = await this.app.vault.read(file);
    const frontmatter = this.parseFrontmatter(content);
    const title = this.extractTitle(content);
    const links = this.extractLinks(content);

    return {
      path,
      type: frontmatter.type,
      title,
      frontmatter,
      content,
      links,
      backlinks: [] // 需要单独计算
    };
  }

  /**
   * 提取标题
   */
  private extractTitle(content: string): string {
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1] : 'Untitled';
  }

  /**
   * 提取内部链接
   */
  private extractLinks(content: string): string[] {
    const linkRegex = /\[\[([^\]]+)\]\]/g;
    const links: string[] = [];
    let match;

    while ((match = linkRegex.exec(content)) !== null) {
      links.push(match[1]);
    }

    return links;
  }

  /**
   * 更新索引文件
   */
  async updateIndex(entries: WikiIndexEntry[]): Promise<void> {
    const indexPath = `${this.wikiPath}/index.md`;
    const indexFile = this.app.vault.getAbstractFileByPath(indexPath);

    if (!indexFile || !(indexFile instanceof TFile)) {
      await this.ensureIndexFile();
      return;
    }

    const today = new Date().toISOString().split('T')[0];

    // 按类型分组
    const grouped: Record<WikiPageType, WikiIndexEntry[]> = {
      source: [],
      entity: [],
      concept: [],
      summary: [],
      synthesis: [],
      faq: [],
      meta: [],
      relation: []
    };

    for (const entry of entries) {
      grouped[entry.type].push(entry);
    }

    // 构建索引内容
    let content = `# Wiki 索引

最后更新: ${today}

## 来源 (Sources)

`;

    for (const entry of grouped.source) {
      content += `- [${entry.title}](${entry.path}) — ${entry.description}\n`;
    }

    content += `\n## FAQ\n\n`;

    for (const entry of grouped.faq) {
      content += `- [${entry.title}](${entry.path}) — ${entry.description}\n`;
    }

    content += `\n## Meta\n\n`;

    for (const entry of grouped.meta) {
      content += `- [${entry.title}](${entry.path}) — ${entry.description}\n`;
    }

    content += `\n## 关系 (Relations)\n\n`;

    for (const entry of grouped.relation) {
      content += `- [${entry.title}](${entry.path}) — ${entry.description}\n`;
    }

    content += `\n## 实体 (Entities)

`;

    for (const entry of grouped.entity) {
      content += `- [${entry.title}](${entry.path}) — ${entry.description}\n`;
    }

    content += `\n## 概念 (Concepts)

`;

    for (const entry of grouped.concept) {
      content += `- [${entry.title}](${entry.path}) — ${entry.description}\n`;
    }

    content += `\n## 摘要 (Summaries)

`;

    for (const entry of grouped.summary) {
      content += `- [${entry.title}](${entry.path}) — ${entry.description}\n`;
    }

    content += `\n## 综合 (Syntheses)

`;

    for (const entry of grouped.synthesis) {
      content += `- [${entry.title}](${entry.path}) — ${entry.description}\n`;
    }

    const stats = `
---

**统计**: ${grouped.faq.length} FAQ | ${grouped.meta.length} Meta | ${grouped.relation.length} 关系 | ${grouped.source.length} 来源 | ${grouped.entity.length} 实体 | ${grouped.concept.length} 概念 | ${grouped.summary.length} 摘要 | ${grouped.synthesis.length} 综合 | 共 ${entries.length} 页
`;

    content += stats;

    await this.app.vault.modify(indexFile, content);
    this.indexCache = entries;
  }

  /**
   * 添加日志条目
   */
  async addLogEntry(entry: WikiLogEntry): Promise<void> {
    const logPath = `${this.wikiPath}/log.md`;
    const logFile = this.app.vault.getAbstractFileByPath(logPath);

    if (!logFile || !(logFile instanceof TFile)) {
      await this.ensureLogFile();
      return;
    }

    const existingContent = await this.app.vault.read(logFile);
    const logLine = `\n## [${entry.date}] ${entry.action} | ${entry.title}\n${entry.details}\n`;

    await this.app.vault.modify(logFile, existingContent + logLine);
  }

  /**
   * 搜索 Wiki 页面（增强版，集成 Retriever）
   */
  async searchWiki(query: string, retriever?: { search(query: string): Promise<SearchResult[]> }): Promise<WikiPage[]> {
    // 如果提供了 Retriever，使用混合搜索
    if (retriever) {
      try {
        const searchResults = await retriever.search(query);
        const wikiPages: WikiPage[] = [];

        for (const result of searchResults) {
          // 只返回 Wiki 路径下的结果
          if (this.isWikiFile(result.chunk.path)) {
            const page = await this.readPage(result.chunk.path);
            if (page) {
              wikiPages.push(page);
            }
          }
        }

        return wikiPages;
      } catch (error) {
        console.error('使用 Retriever 搜索失败，降级到简单搜索:', error);
      }
    }

    const pages = await this.getAllPages();
    const tokens = this.tokenizeQuery(query);
    const normalizedQuery = query.trim().toLowerCase();

    return pages
      .map(page => ({
        page,
        score: this.scorePage(page, normalizedQuery, tokens)
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(item => item.page);
  }

  /**
   * 获取所有 Wiki 页面（带缓存）
   */
  async getAllPages(): Promise<WikiPage[]> {
    // 检查缓存是否有效
    const now = Date.now();
    if (this.pagesCache && (now - this.cacheTimestamp) < this.cacheTTL) {
      return Array.from(this.pagesCache.values());
    }

    const pages: WikiPage[] = [];
    const folders = Object.values(WIKI_PAGE_FOLDERS);

    for (const folder of folders) {
      const folderPath = `${this.wikiPath}/${folder}`;
      const folderObj = this.app.vault.getAbstractFileByPath(folderPath);

      if (folderObj && folderObj instanceof TFolder) {
        for (const file of folderObj.children) {
          if (file instanceof TFile && file.extension === 'md') {
            const page = await this.readPage(file.path);
            if (page) {
              pages.push(page);
            }
          }
        }
      }
    }

    const aliasMap = this.buildAliasMap(pages);
    const byPath = new Map(pages.map(page => [page.path, page]));

    for (const page of pages) {
      page.backlinks = [];
      page.links = Array.from(new Set(page.links));
    }

    for (const page of pages) {
      const resolvedLinks = this.resolveWikiLinks(page.links, aliasMap)
        .filter(linkPath => linkPath !== page.path);

      for (const linkPath of resolvedLinks) {
        const target = byPath.get(linkPath);
        if (target && !target.backlinks.includes(page.path)) {
          target.backlinks.push(page.path);
        }
      }
    }

    // 更新缓存
    this.pagesCache = new Map(pages.map(p => [p.path, p]));
    this.cacheTimestamp = now;

    return pages;
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.indexCache = null;
    this.pagesCache = null;
    this.cacheTimestamp = 0;
  }

  /**
   * 检查 Wiki 是否已初始化
   */
  isInitialized(): boolean {
    const requiredPaths = [
      this.wikiPath,
      ...Object.values(WIKI_PAGE_FOLDERS).map(folder => `${this.wikiPath}/${folder}`)
    ];
    return requiredPaths.every(path => this.app.vault.getAbstractFileByPath(path) instanceof TFolder);
  }

  private async ensureFolder(path: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFolder) {
      return;
    }
    await this.app.vault.createFolder(path);
  }

  /**
   * 获取 Wiki 统计信息
   */
  async getStats(): Promise<{
    faq: number;
    meta: number;
    relations: number;
    sources: number;
    entities: number;
    concepts: number;
    summaries: number;
    syntheses: number;
    total: number;
  }> {
    const pages = await this.getAllPages();
    const stats = {
      faq: 0,
      meta: 0,
      relations: 0,
      sources: 0,
      entities: 0,
      concepts: 0,
      summaries: 0,
      syntheses: 0,
      total: pages.length
    };

    for (const page of pages) {
      if (page.type === 'faq') stats.faq++;
      else if (page.type === 'meta') stats.meta++;
      else if (page.type === 'relation') stats.relations++;
      else if (page.type === 'source') stats.sources++;
      else if (page.type === 'entity') stats.entities++;
      else if (page.type === 'concept') stats.concepts++;
      else if (page.type === 'summary') stats.summaries++;
      else if (page.type === 'synthesis') stats.syntheses++;
    }

    return stats;
  }

  private tokenizeQuery(query: string): string[] {
    const tokens = query.toLowerCase().match(/[\u4e00-\u9fff]{2,}|[a-z0-9][a-z0-9._-]{1,}/g) || [];
    const unique = Array.from(new Set(tokens));
    if (query.trim()) {
      unique.unshift(query.trim().toLowerCase());
    }
    return Array.from(new Set(unique));
  }

  private scorePage(page: WikiPage, normalizedQuery: string, tokens: string[]): number {
    const title = page.title.toLowerCase();
    const path = page.path.toLowerCase();
    const category = (page.frontmatter.category || '').toLowerCase();
    const content = page.content.toLowerCase();
    const backlinks = page.backlinks.join(' ').toLowerCase();
    const links = page.links.join(' ').toLowerCase();
    let score = 0;

    if (normalizedQuery && title.includes(normalizedQuery)) score += 10;
    if (normalizedQuery && path.includes(normalizedQuery)) score += 8;
    if (normalizedQuery && category.includes(normalizedQuery)) score += 4;

    for (const token of tokens) {
      if (title.includes(token)) score += 6;
      if (path.includes(token)) score += 4;
      if (category.includes(token)) score += 3;
      if (links.includes(token)) score += 2;
      if (backlinks.includes(token)) score += 2;
      if (content.includes(token)) score += token === normalizedQuery ? 3 : 1;
    }

    if (page.type === 'relation' || page.type === 'meta') {
      score += 1;
    }

    return score;
  }

  private buildAliasMap(pages: WikiPage[]): Map<string, string> {
    const aliases = new Map<string, string>();
    for (const page of pages) {
      const fileName = page.path.split('/').pop() || page.title;
      for (const alias of [
        page.path,
        page.path.replace(/\.md$/i, ''),
        page.title,
        fileName,
        fileName.replace(/\.md$/i, '')
      ]) {
        aliases.set(alias.toLowerCase(), page.path);
      }
    }
    return aliases;
  }

  private resolveWikiLinks(links: string[], aliasMap: Map<string, string>): string[] {
    const resolved: string[] = [];
    for (const link of links) {
      const target = link.split('|')[0].trim().replace(/#.*$/, '').toLowerCase();
      const resolvedPath = aliasMap.get(target);
      if (resolvedPath) {
        resolved.push(resolvedPath);
      }
    }
    return resolved;
  }
}
