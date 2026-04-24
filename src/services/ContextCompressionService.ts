import { Chunk, PluginSettings } from '../types/index';
import { JsonMetadataStore } from './Storage';

export interface CompressedContext {
  chunks: Chunk[];
  totalChars: number;
  compressionRatio: number;
}

// 上下文压缩服务
export class ContextCompressionService {
  private metadataStore: JsonMetadataStore;
  private getSettings: () => PluginSettings;

  constructor(metadataStore: JsonMetadataStore, getSettings: () => PluginSettings) {
    this.metadataStore = metadataStore;
    this.getSettings = getSettings;
  }

  async compress(
    chunkIds: string[],
    query: string,
    maxChars?: number
  ): Promise<CompressedContext> {
    const settings = this.getSettings();
    const limit = maxChars || settings.maxContextChars;

    // 1. 加载所有 chunks
    const chunks: Chunk[] = [];
    for (const id of chunkIds) {
      const chunk = await this.metadataStore.getChunkById(id);
      if (chunk) {
        chunks.push(chunk);
      }
    }

    if (chunks.length === 0) {
      return { chunks: [], totalChars: 0, compressionRatio: 0 };
    }

    // 2. Parent-Child Chunk 扩展
    const expandedChunks = await this.expandToParentChunks(chunks);

    // 3. Sentence Window 提取
    const windowedChunks = this.applySentenceWindow(expandedChunks, query);

    // 4. Token Budget 控制
    const finalChunks = this.applyTokenBudget(windowedChunks, limit);

    const totalChars = finalChunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
    const originalChars = chunks.reduce((sum, chunk) => sum + chunk.content.length, 0);

    return {
      chunks: finalChunks,
      totalChars,
      compressionRatio: originalChars > 0 ? totalChars / originalChars : 1
    };
  }

  // Parent-Child Chunk: 扩展到父级 chunk（同一 section）
  private async expandToParentChunks(chunks: Chunk[]): Promise<Chunk[]> {
    const expanded = new Map<string, Chunk>();

    for (const chunk of chunks) {
      // 添加当前 chunk
      expanded.set(chunk.id, chunk);

      // 查找同一文件、同一 section 的其他 chunks
      const siblings = await this.metadataStore.getChunksByPath(chunk.path);

      for (const sibling of siblings) {
        if (sibling.sectionPath === chunk.sectionPath) {
          expanded.set(sibling.id, sibling);
        }
      }
    }

    return Array.from(expanded.values());
  }

  // Sentence Window: 提取包含关键词的句子窗口
  private applySentenceWindow(chunks: Chunk[], query: string): Chunk[] {
    const queryTerms = query.toLowerCase().split(/\s+/);

    return chunks.map(chunk => {
      const sentences = this.splitIntoSentences(chunk.content);
      const relevantSentences: string[] = [];

      for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        const sentenceLower = sentence.toLowerCase();

        // 检查是否包含查询词
        const hasQueryTerm = queryTerms.some(term => sentenceLower.includes(term));

        if (hasQueryTerm) {
          // 添加前后各一句（窗口大小 = 3）
          const start = Math.max(0, i - 1);
          const end = Math.min(sentences.length, i + 2);

          for (let j = start; j < end; j++) {
            if (!relevantSentences.includes(sentences[j])) {
              relevantSentences.push(sentences[j]);
            }
          }
        }
      }

      // 如果没有匹配的句子，保留前几句
      if (relevantSentences.length === 0) {
        relevantSentences.push(...sentences.slice(0, 3));
      }

      return {
        ...chunk,
        content: relevantSentences.join(' ')
      };
    });
  }

  private splitIntoSentences(text: string): string[] {
    // 简单的句子分割
    return text
      .split(/[。！？.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }

  // Token Budget: 控制总字符数
  private applyTokenBudget(chunks: Chunk[], maxChars: number): Chunk[] {
    const result: Chunk[] = [];
    let currentChars = 0;

    for (const chunk of chunks) {
      if (currentChars + chunk.content.length <= maxChars) {
        result.push(chunk);
        currentChars += chunk.content.length;
      } else {
        // 尝试截断最后一个 chunk
        const remainingChars = maxChars - currentChars;
        if (remainingChars > 100) {
          result.push({
            ...chunk,
            content: chunk.content.slice(0, remainingChars) + '...'
          });
        }
        break;
      }
    }

    return result;
  }

  // 去重（基于内容相似度）
  deduplicate(chunks: Chunk[]): Chunk[] {
    const seen = new Set<string>();
    const result: Chunk[] = [];

    for (const chunk of chunks) {
      // 使用内容的前 100 个字符作为指纹
      const fingerprint = chunk.content.slice(0, 100).toLowerCase().replace(/\s+/g, '');

      if (!seen.has(fingerprint)) {
        seen.add(fingerprint);
        result.push(chunk);
      }
    }

    return result;
  }

  // 按文档分组（保持上下文连贯性）
  groupByDocument(chunks: Chunk[]): Map<string, Chunk[]> {
    const groups = new Map<string, Chunk[]>();

    for (const chunk of chunks) {
      const key = `${chunk.path}:${chunk.sectionPath}`;
      const group = groups.get(key) || [];
      group.push(chunk);
      groups.set(key, group);
    }

    // 每组内按行号排序
    for (const [key, group] of groups.entries()) {
      group.sort((a, b) => a.startLine - b.startLine);
      groups.set(key, group);
    }

    return groups;
  }
}
