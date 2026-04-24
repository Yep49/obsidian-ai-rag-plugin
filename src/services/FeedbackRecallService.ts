import { OpenAiCompatibleEmbeddingClient } from './ApiClients';
import { ObsidianJsonFileAdapter } from './Storage';
import { FeedbackEntry, FeedbackEmbedding } from '../types/index';
import { RecallResult } from './FusionService';

// 反馈召回服务
export class FeedbackRecallService {
  private embeddingClient: OpenAiCompatibleEmbeddingClient;
  private adapter: ObsidianJsonFileAdapter;
  private basePath: string;

  constructor(
    embeddingClient: OpenAiCompatibleEmbeddingClient,
    adapter: ObsidianJsonFileAdapter,
    basePath: string
  ) {
    this.embeddingClient = embeddingClient;
    this.adapter = adapter;
    this.basePath = basePath;
  }

  async search(query: string, topK: number): Promise<RecallResult[]> {
    try {
      // 加载反馈数据
      const feedbacks = await this.loadFeedbacks();
      const embeddings = await this.loadEmbeddings();

      if (feedbacks.length === 0 || embeddings.length === 0) {
        return [];
      }

      // 生成查询向量
      const queryEmbedding = await this.embeddingClient.embed(query);

      // 计算相似度
      const results = embeddings.map(item => {
        const score = this.cosineSimilarity(queryEmbedding, item.embedding);
        return {
          id: item.id,
          score,
          source: 'feedback' as const
        };
      });

      // 排序并返回 top K
      results.sort((a, b) => b.score - a.score);

      return results.slice(0, topK);
    } catch (error) {
      console.error('Feedback recall failed:', error);
      return [];
    }
  }

  async getFeedbackById(id: string): Promise<FeedbackEntry | null> {
    const feedbacks = await this.loadFeedbacks();
    return feedbacks.find(f => f.id === id) || null;
  }

  private async loadFeedbacks(): Promise<FeedbackEntry[]> {
    const path = `${this.basePath}/feedbacks.json`;
    try {
      const content = await this.adapter.read(path);
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  private async loadEmbeddings(): Promise<FeedbackEmbedding[]> {
    const path = `${this.basePath}/feedback-embeddings.json`;
    try {
      const content = await this.adapter.read(path);
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator > 0 ? dotProduct / denominator : 0;
  }
}
