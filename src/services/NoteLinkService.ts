import { App, TFile } from 'obsidian';
import { LinkApplyRequest, LinkSuggestion, MetaNote } from '../types/index';

const RELATED_NOTES_HEADINGS = ['## 相关笔记', '## Related Notes'];

export class NoteLinkService {
  private app: App;
  private lastSuggestionSignatures = new Map<string, string>();
  private isWikiPath: (path: string) => boolean;

  constructor(app: App, isWikiPath: (path: string) => boolean) {
    this.app = app;
    this.isWikiPath = isWikiPath;
  }

  async buildSuggestions(filePath: string, meta: MetaNote): Promise<LinkSuggestion[]> {
    const sourceFile = this.app.vault.getAbstractFileByPath(filePath);
    if (!(sourceFile instanceof TFile)) {
      return [];
    }

    const existingLinks = await this.getRelatedLinks(filePath);
    const suggestions = new Map<string, LinkSuggestion>();
    const sourceContent = await this.app.vault.read(sourceFile);

    const addSuggestion = (targetPath: string, reason: string, score: number, from: LinkSuggestion['from']) => {
      if (!targetPath || targetPath === filePath || existingLinks.includes(targetPath)) {
        return;
      }
      const existing = suggestions.get(targetPath);
      if (!existing || score > existing.score) {
        suggestions.set(targetPath, {
          sourcePath: filePath,
          targetPath,
          reason,
          score,
          from
        });
      }
    };

    for (const path of meta.suggestedRelatedNotes || []) {
      addSuggestion(path, '来自 AI 的笔记关联建议', 0.95, 'meta');
    }

    for (const wikiPath of meta.suggestedRelatedWikiPages || []) {
      const wikiFile = this.app.vault.getAbstractFileByPath(wikiPath);
      if (!(wikiFile instanceof TFile)) {
        continue;
      }

      const wikiContent = await this.app.vault.read(wikiFile);
      const linkedRawNotes = (wikiContent.match(/\[\[([^\]]+)\]\]/g) || [])
        .map(link => link.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0].trim())
        .filter(path => path && !this.isWikiPath(path) && path !== filePath && /\.md$/i.test(path));

      for (const rawPath of linkedRawNotes) {
        addSuggestion(rawPath, '来自关联 Wiki 页面', 0.88, 'wiki');
      }
    }

    const tokens = this.extractTokens(`${filePath} ${meta.summary} ${meta.userRelation} ${meta.autoTags.join(' ')} ${sourceContent.slice(0, 2000)}`);
    const files = this.app.vault.getMarkdownFiles()
      .filter(file => file.path !== filePath && !this.isWikiPath(file.path));

    for (const file of files) {
      const haystack = `${file.path} ${file.basename}`.toLowerCase();
      const score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
      if (score > 0) {
        addSuggestion(file.path, '文件名和主题词匹配', Math.min(0.8, score / Math.max(tokens.length, 1)), 'filename');
      }
    }

    return Array.from(suggestions.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }

  shouldPrompt(filePath: string, suggestions: LinkSuggestion[]): boolean {
    if (suggestions.length === 0) {
      return false;
    }

    const signature = suggestions.map(item => item.targetPath).sort().join('|');
    const previous = this.lastSuggestionSignatures.get(filePath);
    if (previous === signature) {
      return false;
    }

    this.lastSuggestionSignatures.set(filePath, signature);
    return true;
  }

  async applyBidirectionalLinks(request: LinkApplyRequest): Promise<{ updated: string[]; skipped: string[] }> {
    const updated = new Set<string>();
    const skipped = new Set<string>();

    for (const targetPath of request.targetPaths) {
      const sourceFile = this.app.vault.getAbstractFileByPath(request.sourcePath);
      const targetFile = this.app.vault.getAbstractFileByPath(targetPath);

      if (!(sourceFile instanceof TFile) || !(targetFile instanceof TFile)) {
        skipped.add(targetPath);
        continue;
      }

      await this.upsertRelatedLink(sourceFile, targetPath);
      await this.upsertRelatedLink(targetFile, request.sourcePath);
      updated.add(request.sourcePath);
      updated.add(targetPath);
    }

    return {
      updated: Array.from(updated),
      skipped: Array.from(skipped)
    };
  }

  async getRelatedLinks(filePath: string): Promise<string[]> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      return [];
    }

    const content = await this.app.vault.read(file);
    const section = this.findRelatedSection(content);
    if (!section) {
      return [];
    }

    return Array.from(new Set(
      (section.body.match(/\[\[([^\]]+)\]\]/g) || [])
        .map(link => link.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0].trim())
    ));
  }

  private async upsertRelatedLink(file: TFile, targetPath: string): Promise<void> {
    const content = await this.app.vault.read(file);
    const relatedLinks = await this.getRelatedLinks(file.path);
    if (relatedLinks.includes(targetPath)) {
      return;
    }

    const nextLinks = Array.from(new Set([...relatedLinks, targetPath])).sort();
    const renderedSection = `${RELATED_NOTES_HEADINGS[0]}\n${nextLinks.map(path => `- [[${path}]]`).join('\n')}`;
    const section = this.findRelatedSection(content);

    let nextContent: string;
    if (!section) {
      nextContent = `${content.trim()}\n\n${renderedSection}\n`;
    } else {
      nextContent = `${content.slice(0, section.start)}${renderedSection}${content.slice(section.end)}`;
    }

    await this.app.vault.modify(file, nextContent);
  }

  private findRelatedSection(content: string): { start: number; end: number; body: string } | null {
    const lines = content.split('\n');
    let startLine = -1;
    let endLine = lines.length;

    for (let i = 0; i < lines.length; i++) {
      if (RELATED_NOTES_HEADINGS.includes(lines[i].trim())) {
        startLine = i;
        for (let j = i + 1; j < lines.length; j++) {
          if (/^##\s+/.test(lines[j])) {
            endLine = j;
            break;
          }
        }
        break;
      }
    }

    if (startLine === -1) {
      return null;
    }

    const start = lines.slice(0, startLine).join('\n').length + (startLine > 0 ? 1 : 0);
    const end = lines.slice(0, endLine).join('\n').length + (endLine > 0 ? 1 : 0);
    return {
      start,
      end,
      body: lines.slice(startLine, endLine).join('\n')
    };
  }

  private extractTokens(value: string): string[] {
    return Array.from(new Set(
      value.toLowerCase().match(/[\u4e00-\u9fff]{2,}|[a-z0-9][a-z0-9._-]{1,}/g) || []
    )).slice(0, 12);
  }
}
