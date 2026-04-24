import {App, TFile } from 'obsidian';
import { WikiService } from './WikiService';
import { WikiPage, WikiAuditReport } from '../types/index';
import { OpenAiCompatibleLlmClient } from './ApiClients';

interface PageAuditResponse {
  contradictions?: WikiAuditReport['contradictions'];
  outdatedInfo?: WikiAuditReport['outdatedInfo'];
}

function isContradiction(value: unknown): value is WikiAuditReport['contradictions'][number] {
  return typeof value === 'object' && value !== null &&
    typeof (value as { page1?: unknown }).page1 === 'string' &&
    typeof (value as { page2?: unknown }).page2 === 'string' &&
    typeof (value as { issue?: unknown }).issue === 'string';
}

function isOutdatedInfo(value: unknown): value is WikiAuditReport['outdatedInfo'][number] {
  return typeof value === 'object' && value !== null &&
    typeof (value as { page?: unknown }).page === 'string' &&
    typeof (value as { reason?: unknown }).reason === 'string';
}

/**
 * WikiAuditor - Wiki 审计服务
 * 检查页面矛盾、孤立页面、缺失交叉引用、过时信息和知识空白
 */
export class WikiAuditor {
  private app: App;
  private wikiService: WikiService;
  private llmClient: OpenAiCompatibleLlmClient;

  constructor(
    app: App,
    wikiService: WikiService,
    llmClient: OpenAiCompatibleLlmClient
  ) {
    this.app = app;
    this.wikiService = wikiService;
    this.llmClient = llmClient;
  }

  /**
   * 执行完整的 Wiki 审计
   */
  async auditWiki(): Promise<WikiAuditReport> {
    const pages = await this.wikiService.getAllPages();

    const report: WikiAuditReport = {
      contradictions: [],
      orphanPages: [],
      missingLinks: [],
      outdatedInfo: [],
      dataGaps: []
    };

    // 1. 检查孤立页面（无入链）
    report.orphanPages = this.findOrphanPages(pages);

    // 2. 检查缺失的交叉引用
    report.missingLinks = this.findMissingLinks(pages);

    // 3. 使用 LLM 检查矛盾和过时信息
    const llmChecks = await this.llmAuditPages(pages);
    report.contradictions = llmChecks.contradictions;
    report.outdatedInfo = llmChecks.outdatedInfo;

    // 4. 识别知识空白
    report.dataGaps = await this.identifyDataGaps(pages);

    return report;
  }

  /**
   * 查找孤立页面（没有其他页面链接到它）
   */
  private findOrphanPages(pages: WikiPage[]): string[] {
    const inbound = new Set<string>();
    const aliasesByTarget = new Map<string, string>();

    for (const page of pages) {
      const aliases = [
        page.path,
        page.path.replace(/\.md$/i, ''),
        page.title,
        page.path.split('/').pop() || page.title,
        (page.path.split('/').pop() || page.title).replace(/\.md$/i, '')
      ];

      for (const alias of aliases) {
        aliasesByTarget.set(alias.toLowerCase(), page.path);
      }
    }

    for (const page of pages) {
      for (const link of page.links) {
        const target = link.split('|')[0].trim().toLowerCase();
        const targetPath = aliasesByTarget.get(target);
        if (targetPath && targetPath !== page.path) {
          inbound.add(targetPath);
        }
      }
    }

    return pages
      .filter(page => !inbound.has(page.path))
      .map(page => page.path);
  }

  /**
   * 查找缺失的交叉引用
   * 例如：页面 A 提到概念 B，但没有链接到 B 的页面
   */
  private findMissingLinks(pages: WikiPage[]): Array<{page: string; missingConcept: string}> {
    const missingLinks: Array<{page: string; missingConcept: string}> = [];

    for (const page of pages) {
      // 提取页面内容中的关键词（简化版）
      const content = page.content.toLowerCase();

      // 检查是否提到其他页面但没有链接
      for (const otherPage of pages) {
        if (otherPage.path === page.path) continue;

        const otherTitle = otherPage.title.toLowerCase();
        if (content.includes(otherTitle) && !page.links.some(link => link.toLowerCase().includes(otherTitle))) {
          missingLinks.push({
            page: page.path,
            missingConcept: otherPage.title
          });
        }
      }
    }

    return missingLinks;
  }

  /**
   * 使用 LLM 检查页面矛盾和过时信息
   */
  private async llmAuditPages(pages: WikiPage[]): Promise<{
    contradictions: Array<{page1: string; page2: string; issue: string}>;
    outdatedInfo: Array<{page: string; reason: string}>;
  }> {
    const contradictions: Array<{page1: string; page2: string; issue: string}> = [];
    const outdatedInfo: Array<{page: string; reason: string}> = [];

    // 分批处理，避免一次性处理太多页面
    const batchSize = 10;
    for (let i = 0; i < pages.length; i += batchSize) {
      const batch = pages.slice(i, i + batchSize);

      // 构建审计提示
      const pagesContext = batch.map((p, idx) =>
        `[${idx + 1}] ${p.title} (${p.path})\n${p.content.substring(0, 500)}`
      ).join('\n\n');

      const prompt = `你是一个知识库审计员。请审查以下 Wiki 页面，识别：
1. 页面之间的矛盾（相同主题的不同说法）
2. 可能过时的信息（提到旧版本、已废弃的技术等）

Wiki 页面:
${pagesContext}

请以 JSON 格式返回：
{
  "contradictions": [
    {"page1": "页面1路径", "page2": "页面2路径", "issue": "矛盾描述"}
  ],
  "outdatedInfo": [
    {"page": "页面路径", "reason": "过时原因"}
  ]
}

如果没有发现问题，返回空数组。请直接返回 JSON，不要有其他文字。`;

      try {
        const response = await this.llmClient.chat(
          [{ role: 'user', content: prompt }],
          0.3
        );

        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]) as unknown as PageAuditResponse;
          contradictions.push(...(Array.isArray(result.contradictions) ? result.contradictions.filter(isContradiction) : []));
          outdatedInfo.push(...(Array.isArray(result.outdatedInfo) ? result.outdatedInfo.filter(isOutdatedInfo) : []));
        }
      } catch (error) {
        console.error('LLM 审计失败:', error);
      }

      // 避免 API 限流
      await new Promise(resolve => activeWindow.setTimeout(resolve, 1000));
    }

    return { contradictions, outdatedInfo };
  }

  /**
   * 识别知识空白
   * 通过分析现有页面的主题，识别可能缺失的相关主题
   */
  private async identifyDataGaps(pages: WikiPage[]): Promise<string[]> {
    const dataGaps: string[] = [];

    // 提取所有类别
    const categories = new Set(pages.map(p => p.frontmatter.category));

    // 使用 LLM 识别知识空白
    const categoriesText = Array.from(categories).join(', ');
    const titlesText = pages.map(p => p.title).slice(0, 50).join(', ');

    const prompt = `你是一个知识库分析师。当前 Wiki 包含以下类别和主题：

类别: ${categoriesText}
主题示例: ${titlesText}

基于这些现有内容，请识别可能缺失的相关主题或概念（最多5个）。

请以 JSON 数组格式返回：
["缺失主题1", "缺失主题2", ...]

请直接返回 JSON，不要有其他文字。`;

    try {
      const response = await this.llmClient.chat(
        [{ role: 'user', content: prompt }],
        0.5
      );

      const jsonMatch = response.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        const gaps = JSON.parse(jsonMatch[0]) as unknown;
        if (Array.isArray(gaps)) {
          dataGaps.push(...gaps.filter((gap): gap is string => typeof gap === 'string'));
        }
      }
    } catch (error) {
      console.error('识别知识空白失败:', error);
    }

    return dataGaps;
  }

  /**
   * 生成审计报告的 Markdown 格式（增强版，带优先级和操作按钮）
   */
  generateReportMarkdown(report: WikiAuditReport): string {
    const today = new Date().toISOString().split('T')[0];

    // 计算优先级分数
    const priorityScore = this.calculatePriorityScore(report);

    let markdown = `# Wiki 审计报告

生成时间: ${today}

## 总览

| 类型 | 数量 | 优先级 |
|------|------|--------|
| 孤立页面 | ${report.orphanPages.length} | ${priorityScore.orphanPages} |
| 缺失链接 | ${report.missingLinks.length} | ${priorityScore.missingLinks} |
| 页面矛盾 | ${report.contradictions.length} | ${priorityScore.contradictions} |
| 过时信息 | ${report.outdatedInfo.length} | ${priorityScore.outdatedInfo} |
| 知识空白 | ${report.dataGaps.length} | ${priorityScore.dataGaps} |

---

## 1. 🔴 高优先级：页面矛盾 (${report.contradictions.length})

发现以下页面之间存在矛盾，需要立即处理：

`;

    for (const contradiction of report.contradictions) {
      markdown += `### [[${contradiction.page1}]] ⚔️ [[${contradiction.page2}]]
- **问题**: ${contradiction.issue}
- **操作**:
  - [ ] 审查两个页面的内容
  - [ ] 决定保留哪个版本或合并
  - [ ] 更新相关引用

`;
    }

    markdown += `---

## 2. 🟠 中优先级：过时信息 (${report.outdatedInfo.length})

这些页面可能包含过时信息：

`;

    for (const outdated of report.outdatedInfo) {
      markdown += `### [[${outdated.page}]]
- **原因**: ${outdated.reason}
- **操作**:
  - [ ] 验证信息是否确实过时
  - [ ] 更新为最新内容
  - [ ] 添加更新日期标记

`;
    }

    markdown += `---

## 3. 🟡 中优先级：缺失的交叉引用 (${report.missingLinks.length})

这些页面提到了其他概念但没有链接：

`;

    // 按页面分组
    const linksByPage = new Map<string, string[]>();
    for (const link of report.missingLinks) {
      if (!linksByPage.has(link.page)) {
        linksByPage.set(link.page, []);
      }
      linksByPage.get(link.page)!.push(link.missingConcept);
    }

    for (const [page, concepts] of linksByPage) {
      markdown += `### [[${page}]]
- **缺失链接**: ${concepts.join(', ')}
- **操作**:
  - [ ] 在页面中添加 [[链接]]
  - [ ] 验证链接的相关性

`;
    }

    markdown += `---

## 4. 🟢 低优先级：孤立页面 (${report.orphanPages.length})

这些页面没有其他页面链接进来，可能需要补充入链或合并到更合适的主题页：

`;

    for (const page of report.orphanPages) {
      markdown += `- [[${page}]]
  - [ ] 添加相关链接
`;
    }

    markdown += `\n---

## 5. 💡 建议：知识空白 (${report.dataGaps.length})

建议添加以下主题以完善知识库：

`;

    for (const gap of report.dataGaps) {
      markdown += `- **${gap}**
  - [ ] 创建新页面
  - [ ] 从现有笔记中提取相关内容
`;
    }

    markdown += `\n---

## 📋 批量操作建议

### 快速修复（预计 < 1 小时）
1. 修复前 5 个缺失链接
2. 为前 3 个孤立页面添加链接

### 中期任务（预计 1-3 小时）
1. 解决所有页面矛盾
2. 更新过时信息

### 长期规划（预计 > 3 小时）
1. 填补所有知识空白
2. 完善所有交叉引用

---

**审计完成** ✅
`;

    return markdown;
  }

  /**
   * 计算各类问题的优先级分数
   */
  private calculatePriorityScore(report: WikiAuditReport): {
    orphanPages: string;
    missingLinks: string;
    contradictions: string;
    outdatedInfo: string;
    dataGaps: string;
  } {
    return {
      orphanPages: report.orphanPages.length > 10 ? '🟡 中' : '🟢 低',
      missingLinks: report.missingLinks.length > 20 ? '🟠 中高' : report.missingLinks.length > 5 ? '🟡 中' : '🟢 低',
      contradictions: report.contradictions.length > 0 ? '🔴 高' : '🟢 低',
      outdatedInfo: report.outdatedInfo.length > 5 ? '🟠 中高' : report.outdatedInfo.length > 0 ? '🟡 中' : '🟢 低',
      dataGaps: report.dataGaps.length > 10 ? '🟡 中' : '🟢 低'
    };
  }

  /**
   * 自动修复孤立页面（添加相关链接和反向入口）
   */
  async autoFixOrphanPages(orphanPaths: string[]): Promise<{
    fixed: string[];
    failed: Array<{ page: string; error: string }>;
  }> {
    const fixed: string[] = [];
    const failed: Array<{ page: string; error: string }> = [];

    for (const orphanPath of orphanPaths) {
      try {
        const page = await this.wikiService.readPage(orphanPath);
        if (!page) {
          failed.push({ page: orphanPath, error: '页面不存在' });
          continue;
        }

        // 使用 LLM 建议相关链接
        const suggestions = await this.suggestLinksForPage(page);

        if (suggestions.length > 0) {
          // 在孤立页面末尾添加"相关页面"部分
          const relatedSection = `\n\n## 相关页面\n\n${suggestions.map(s => `- [[${s}]]`).join('\n')}`;

          const file = this.app.vault.getAbstractFileByPath(orphanPath);
          if (file && file instanceof TFile) {
            const content = await this.app.vault.read(file);
            if (!content.includes('## 相关页面')) {
              await this.app.vault.modify(file, content + relatedSection);
            }
            await this.addInboundLinks(orphanPath, suggestions);
            fixed.push(orphanPath);
          }
        }
      } catch (error) {
        failed.push({
          page: orphanPath,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      // 避免 API 限流
      await new Promise(resolve => activeWindow.setTimeout(resolve, 1000));
    }

    return { fixed, failed };
  }

  /**
   * 为页面建议相关链接
   */
  private async suggestLinksForPage(page: WikiPage): Promise<string[]> {
    const allPages = await this.wikiService.getAllPages();
    const otherPages = allPages.filter(p => p.path !== page.path);

    const prompt = `你是一个知识库管理员。请为以下页面建议 3-5 个相关链接。

当前页面:
标题: ${page.title}
类型: ${page.type}
内容: ${page.content.substring(0, 500)}

可用页面:
${otherPages.slice(0, 20).map(p => `- ${p.title} (${p.type})`).join('\n')}

请返回最相关的页面标题（JSON 数组格式）：
["页面标题1", "页面标题2", ...]

请直接返回 JSON，不要有其他文字。`;

    try {
      const response = await this.llmClient.chat(
        [{ role: 'user', content: prompt }],
        0.3
      );

      const jsonMatch = response.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        const titles = JSON.parse(jsonMatch[0]) as unknown;
        // 转换标题为路径
        return (Array.isArray(titles) ? titles.filter((title): title is string => typeof title === 'string') : [])
          .map((title: string) => {
            const matchedPage = otherPages.find(p => p.title === title);
            return matchedPage ? matchedPage.path : null;
          })
          .filter((path): path is string => path !== null);
      }
    } catch (error) {
      console.error('建议链接失败:', error);
    }

    return [];
  }

  private async addInboundLinks(orphanPath: string, relatedPaths: string[]): Promise<void> {
    for (const relatedPath of relatedPaths.slice(0, 3)) {
      const relatedFile = this.app.vault.getAbstractFileByPath(relatedPath);
      if (!(relatedFile instanceof TFile)) {
        continue;
      }

      const content = await this.app.vault.read(relatedFile);
      if (content.includes(`[[${orphanPath}]]`)) {
        continue;
      }

      const backlink = `\n\n## 相关页面\n\n- [[${orphanPath}]]`;
      await this.app.vault.modify(relatedFile, content + backlink);
    }
  }
}
