import { OpenAiCompatibleLlmClient } from './ApiClients';
import { PluginSettings } from '../types/index';

export interface RerankCandidate {
  id: string;
  content: string;
  metadata?: any;
}

export interface RerankResult {
  id: string;
  score: number;
  originalRank: number;
}

// LLM-based Rerank Service
export class LlmRerankService {
  private llmClient: OpenAiCompatibleLlmClient;
  private getSettings: () => PluginSettings;

  constructor(llmClient: OpenAiCompatibleLlmClient, getSettings: () => PluginSettings) {
    this.llmClient = llmClient;
    this.getSettings = getSettings;
  }

  async rerank(
    query: string,
    candidates: RerankCandidate[],
    topK: number
  ): Promise<RerankResult[]> {
    if (candidates.length === 0) {
      return [];
    }

    // 如果候选数量小于等于 topK，直接返回
    if (candidates.length <= topK) {
      return candidates.map((candidate, index) => ({
        id: candidate.id,
        score: 1 - (index / candidates.length),
        originalRank: index
      }));
    }

    try {
      // 使用 LLM 进行重排序
      const prompt = this.buildRerankPrompt(query, candidates);
      const response = await this.llmClient.chat([
        { role: 'user', content: prompt }
      ], 0.1);

      // 解析 LLM 返回的排序结果
      const rankings = this.parseRerankResponse(response, candidates);

      return rankings.slice(0, topK);
    } catch (error) {
      console.error('Rerank failed, falling back to original order:', error);

      // 失败时返回原始顺序
      return candidates.slice(0, topK).map((candidate, index) => ({
        id: candidate.id,
        score: 1 - (index / candidates.length),
        originalRank: index
      }));
    }
  }

  private buildRerankPrompt(query: string, candidates: RerankCandidate[]): string {
    const candidateList = candidates
      .map((candidate, index) => `[${index}] ${candidate.content.slice(0, 300)}`)
      .join('\n\n');

    return `Given a query and a list of document passages, rank the passages by their relevance to the query. Return only the indices of the passages in order of relevance (most relevant first), separated by commas.

Query: ${query}

Passages:
${candidateList}

Ranking (indices only, comma-separated):`;
  }

  private parseRerankResponse(response: string, candidates: RerankCandidate[]): RerankResult[] {
    // 提取数字
    const indices = response
      .match(/\d+/g)
      ?.map(num => parseInt(num))
      .filter(idx => idx >= 0 && idx < candidates.length) || [];

    // 去重
    const uniqueIndices = Array.from(new Set(indices));

    // 添加未出现的索引（保持原顺序）
    const missingIndices = candidates
      .map((_, idx) => idx)
      .filter(idx => !uniqueIndices.includes(idx));

    const allIndices = [...uniqueIndices, ...missingIndices];

    // 构建结果
    return allIndices.map((originalIdx, newRank) => ({
      id: candidates[originalIdx].id,
      score: 1 - (newRank / allIndices.length),
      originalRank: originalIdx
    }));
  }
}

// Cross-Encoder Rerank (占位符，未来可接入专门的 rerank 模型)
export class CrossEncoderRerankService {
  async rerank(
    query: string,
    candidates: RerankCandidate[],
    topK: number
  ): Promise<RerankResult[]> {
    // TODO: 接入 cross-encoder 模型
    // 例如：BAAI/bge-reranker-large

    // 目前返回原始顺序
    return candidates.slice(0, topK).map((candidate, index) => ({
      id: candidate.id,
      score: 1 - (index / candidates.length),
      originalRank: index
    }));
  }
}
