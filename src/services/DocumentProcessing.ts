import { App, TFile } from 'obsidian';

// Vault 扫描器
export class ObsidianVaultScanner {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  scanMarkdownFiles(): TFile[] {
    return this.app.vault.getMarkdownFiles();
  }

  async readFile(file: TFile): Promise<string> {
    return await this.app.vault.read(file);
  }
}

// 文档元数据提取
export interface DocumentMetadata {
  title: string;
  headings: string[];
  tags: string[];
  links: string[];
}

export function extractMetadata(content: string, filename: string): DocumentMetadata {
  const title = filename.replace(/\.md$/, '');
  const headings: string[] = [];
  const tags = new Set<string>();
  const links = new Set<string>();

  const lines = content.split('\n');

  for (const line of lines) {
    // 提取标题
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      headings.push(headingMatch[2].trim());
    }

    // 提取标签
    const tagMatches = line.matchAll(/#([a-zA-Z0-9_\u4e00-\u9fa5]+)/g);
    for (const match of tagMatches) {
      tags.add(match[1]);
    }

    // 提取 wikilinks
    const linkMatches = line.matchAll(/\[\[([^\]]+)\]\]/g);
    for (const match of linkMatches) {
      links.add(match[1].split('|')[0].trim());
    }
  }

  return {
    title,
    headings,
    tags: Array.from(tags),
    links: Array.from(links)
  };
}

// 文档分块
export interface ChunkOptions {
  chunkSize: number;
  overlap: number;
}

export interface RawChunk {
  content: string;
  startLine: number;
  endLine: number;
  heading?: string;
  sectionPath: string;
}

export class DocumentChunker {
  private options: ChunkOptions;

  constructor(options: ChunkOptions) {
    this.options = options;
  }

  chunk(content: string, metadata: DocumentMetadata): RawChunk[] {
    const lines = content.split('\n');
    const chunks: RawChunk[] = [];

    let currentHeading: string | undefined;
    let currentSection: string[] = [];
    let sectionStartLine = 0;
    const headingStack: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 检测标题
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        // 保存之前的 section
        if (currentSection.length > 0) {
          chunks.push(...this.splitSection(
            currentSection.join('\n'),
            sectionStartLine,
            i - 1,
            currentHeading,
            this.buildSectionPath(headingStack)
          ));
        }

        // 更新标题栈
        const level = headingMatch[1].length;
        const heading = headingMatch[2].trim();

        // 弹出更深层级的标题
        while (headingStack.length >= level) {
          headingStack.pop();
        }
        headingStack.push(heading);

        currentHeading = heading;
        currentSection = [line];
        sectionStartLine = i;
      } else {
        currentSection.push(line);
      }
    }

    // 保存最后一个 section
    if (currentSection.length > 0) {
      chunks.push(...this.splitSection(
        currentSection.join('\n'),
        sectionStartLine,
        lines.length - 1,
        currentHeading,
        this.buildSectionPath(headingStack)
      ));
    }

    return chunks;
  }

  private splitSection(
    content: string,
    startLine: number,
    endLine: number,
    heading: string | undefined,
    sectionPath: string
  ): RawChunk[] {
    const chunks: RawChunk[] = [];
    const normalizedForCheck = this.replaceInvalidControlChars(content).trim();

    if (!normalizedForCheck) {
      return chunks;
    }

    // 如果内容小于 chunk size，直接返回
    if (content.length <= this.options.chunkSize) {
      chunks.push({
        content,
        startLine,
        endLine,
        heading,
        sectionPath
      });
      return chunks;
    }

    // 否则按 chunk size 分割
    const lines = content.split('\n');
    let currentLines: string[] = [];
    let currentLength = 0;
    let chunkStartLine = startLine;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineLength = line.length + 1; // +1 for newline

      if (currentLength + lineLength > this.options.chunkSize && currentLines.length > 0) {
        // 保存当前 chunk
        chunks.push({
          content: currentLines.join('\n'),
          startLine: chunkStartLine,
          endLine: startLine + i - 1,
          heading,
          sectionPath
        });

        // 开始新 chunk，保留 overlap
        const overlapLines = Math.floor(this.options.overlap / 50); // 假设平均每行 50 字符
        currentLines = currentLines.slice(-overlapLines);
        currentLength = currentLines.reduce((sum, l) => sum + l.length + 1, 0);
        chunkStartLine = startLine + i - overlapLines;
      }

      currentLines.push(line);
      currentLength += lineLength;
    }

    // 保存最后一个 chunk
    if (currentLines.length > 0) {
      chunks.push({
        content: currentLines.join('\n'),
        startLine: chunkStartLine,
        endLine,
        heading,
        sectionPath
      });
    }

    return chunks;
  }

  private buildSectionPath(headingStack: string[]): string {
    return headingStack.length > 0 ? headingStack.join(' > ') : '';
  }

  private replaceInvalidControlChars(content: string): string {
    return content
      .split('')
      .map(char => this.isInvalidControlChar(char) ? ' ' : char)
      .join('');
  }

  private isInvalidControlChar(char: string): boolean {
    const code = char.charCodeAt(0);
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
  }
}

// 生成唯一 ID
export function generateChunkId(path: string, startLine: number, content: string): string {
  // 简单的哈希函数
  const hash = (str: string) => {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h = h & h;
    }
    return Math.abs(h).toString(16).padStart(8, '0');
  };

  const combined = `${path}:${startLine}:${content.substring(0, 100)}`;
  return hash(combined).repeat(4); // 32 字符
}

// 计算内容哈希
export function computeContentHash(content: string): string {
  let h = 0;
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) - h) + content.charCodeAt(i);
    h = h & h;
  }
  return Math.abs(h).toString(16).padStart(8, '0').repeat(4);
}
