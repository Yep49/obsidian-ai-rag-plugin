import { WikiPage } from '../types/index';
import { WikiService } from './WikiService';

export class WikiGraphSearchService {
  private wikiService: WikiService;

  constructor(wikiService: WikiService) {
    this.wikiService = wikiService;
  }

  async search(question: string, maxPages = 8): Promise<WikiPage[]> {
    if (!this.wikiService?.isInitialized()) {
      return [];
    }

    const seedPages = await this.wikiService.searchWiki(question);
    const allPages = await this.wikiService.getAllPages();
    const aliases = this.buildAliasMap(allPages);
    const byPath = new Map(allPages.map(page => [page.path, page]));
    const results = new Map<string, WikiPage>();

    for (const page of seedPages.slice(0, Math.max(1, Math.floor(maxPages / 2)))) {
      results.set(page.path, page);
      for (const linkedPath of this.resolveLinks(page, aliases)) {
        const linkedPage = byPath.get(linkedPath);
        if (linkedPage && results.size < maxPages) {
          results.set(linkedPage.path, linkedPage);
        }
      }

      for (const backlinkPath of page.backlinks) {
        const backlinkPage = byPath.get(backlinkPath);
        if (backlinkPage && results.size < maxPages) {
          results.set(backlinkPage.path, backlinkPage);
        }
      }
    }

    if (results.size === 0) {
      for (const page of this.simpleKeywordRank(question, allPages).slice(0, maxPages)) {
        results.set(page.path, page);
      }
    }

    return Array.from(results.values()).slice(0, maxPages);
  }

  buildContext(pages: WikiPage[], maxChars = 5000): string {
    let context = '';
    let used = 0;

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const body = this.stripEnvelope(page.content).substring(0, 1200);
      const entry = `[W${i + 1}] ${page.title} | type=${page.type} | path=${page.path}\n${body}\n\n`;
      if (used + entry.length > maxChars) {
        break;
      }
      context += entry;
      used += entry.length;
    }

    return context;
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

  private resolveLinks(page: WikiPage, aliases: Map<string, string>): string[] {
    const paths: string[] = [];
    for (const link of page.links) {
      const target = link.split('|')[0].trim().toLowerCase();
      const path = aliases.get(target);
      if (path && path !== page.path) {
        paths.push(path);
      }
    }
    return paths;
  }

  private simpleKeywordRank(question: string, pages: WikiPage[]): WikiPage[] {
    const terms = question
      .toLowerCase()
      .split(/[\s,，。！？、；：""''（）()[\]]+/)
      .filter(term => term.length > 1);

    return pages
      .map(page => {
        const haystack = `${page.title}\n${page.content}`.toLowerCase();
        const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
        return { page, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(item => item.page);
  }

  private stripEnvelope(content: string): string {
    return content
      .replace(/^---[\s\S]*?---\n/, '')
      .replace(/^#\s+.+\n/, '')
      .trim();
  }
}
