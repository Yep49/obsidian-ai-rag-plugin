import { SearchResult, Chunk, PluginSettings } from '../types/index';
import { OpenAiCompatibleEmbeddingClient } from './ApiClients';
import { JsonMetadataStore, JsonVectorStore } from './Storage';
import { QueryAnalysisService, QueryFilters } from './QueryAnalysisService';
import { FusionService, RecallResult } from './FusionService';
import { LlmRerankService, RerankCandidate } from './RerankService';
import { ContextCompressionService } from './ContextCompressionService';
import { FeedbackRecallService } from './FeedbackRecallService';
import { MetaRecallService } from './MetaRecallService';
import { LoggingService } from './LoggingService';

// 向量检索服务
export class VectorSearchService {
  private embeddingClient: OpenAiCompatibleEmbeddingClient;
  private vectorStore: JsonVectorStore;

  constructor(embeddingClient: OpenAiCompatibleEmbeddingClient, vectorStore: JsonVectorStore) {
    this.embeddingClient = embeddingClient;
    this.vectorStore = vectorStore;
  }

  async search(query: string, topK: number): Promise<RecallResult[]> {
    const queryEmbedding = await this.embeddingClient.embed(query);
    const results = await this.vectorStore.search(queryEmbedding, topK);

    return results.map(r => ({
      id: r.id,
      score: r.score,
      source: 'dense'
    }));
  }
}

// 词法检索服务（BM25-like）
export class LexicalSearchService {
  private metadataStore: JsonMetadataStore;

  constructor(metadataStore: JsonMetadataStore) {
    this.metadataStore = metadataStore;
  }

  async search(query: string, topK: number): Promise<RecallResult[]> {
    const chunks = await this.metadataStore.loadChunks();
    const queryTerms = this.tokenize(query.toLowerCase());

    const scores = chunks.map(chunk => {
      const chunkTerms = this.tokenize(chunk.content.toLowerCase());
      const score = this.computeBM25(queryTerms, chunkTerms, chunks.length);

      return { id: chunk.id, score, source: 'sparse' as const };
    });

    // 按分数降序排序
    scores.sort((a, b) => b.score - a.score);

    return scores.slice(0, topK);
  }

  private tokenize(text: string): string[] {
    return text
      .split(/[\s,，。！？、；：""''（）[\]]+/)
      .filter(word => word.length > 0);
  }

  private computeBM25(queryTerms: string[], docTerms: string[], totalDocs: number): number {
    const k1 = 1.5;
    const b = 0.75;
    const avgDocLength = 100;

    let score = 0;

    for (const term of queryTerms) {
      const termFreq = docTerms.filter(t => t === term).length;
      const docFreq = 1;

      const idf = Math.log((totalDocs - docFreq + 0.5) / (docFreq + 0.5) + 1);
      const tf = (termFreq * (k1 + 1)) / (termFreq + k1 * (1 - b + b * (docTerms.length / avgDocLength)));

      score += idf * tf;
    }

    return score;
  }
}

// 主检索器（升级版）
export class Retriever {
  private vectorSearch: VectorSearchService;
  private lexicalSearch: LexicalSearchService;
  private metadataStore: JsonMetadataStore;
  private queryAnalysis?: QueryAnalysisService;
  private fusionService: FusionService;
  private rerankService?: LlmRerankService;
  private compressionService?: ContextCompressionService;
  private feedbackRecall?: FeedbackRecallService;
  private metaRecall?: MetaRecallService;
  private loggingService?: LoggingService;
  private getSettings: () => PluginSettings;

  constructor(
    vectorSearch: VectorSearchService,
    lexicalSearch: LexicalSearchService,
    metadataStore: JsonMetadataStore,
    getSettings: () => PluginSettings,
    queryAnalysis?: QueryAnalysisService,
    rerankService?: LlmRerankService,
    compressionService?: ContextCompressionService,
    feedbackRecall?: FeedbackRecallService,
    metaRecall?: MetaRecallService,
    loggingService?: LoggingService
  ) {
    this.vectorSearch = vectorSearch;
    this.lexicalSearch = lexicalSearch;
    this.metadataStore = metadataStore;
    this.getSettings = getSettings;
    this.queryAnalysis = queryAnalysis;
    this.fusionService = new FusionService();
    this.rerankService = rerankService;
    this.compressionService = compressionService;
    this.feedbackRecall = feedbackRecall;
    this.metaRecall = metaRecall;
    this.loggingService = loggingService;
  }

  async search(query: string, conversationHistory?: Array<{ role: string; content: string }>): Promise<SearchResult[]> {
    const settings = this.getSettings();

    // 开始日志记录
    this.loggingService?.startQuery(query);

    // 1. Query Analysis（查询理解）
    let effectiveQuery = query;
    let queryVariants = [query];
    let filters: QueryFilters | undefined;

    if (this.queryAnalysis) {
      const analysis = await this.queryAnalysis.analyzeQuery(query, conversationHistory);
      effectiveQuery = analysis.standaloneQuestion;
      queryVariants = analysis.queryVariants;
      filters = analysis.inferredFilters;

      // 记录 standalone question
      this.loggingService?.logStandaloneQuestion(effectiveQuery);
    }

    // 2. Multi-Recall（多路召回）
    const recallTopK = settings.topK * 3; // 召回更多候选
    const allRecalls: RecallResult[] = [];

    // 2.1 Dense Recall（向量检索）
    for (const variant of queryVariants) {
      const denseResults = await this.vectorSearch.search(variant, recallTopK);
      allRecalls.push(...denseResults);
    }

    // 2.2 Sparse Recall（词法检索）
    if (settings.enableHybridSearch) {
      const sparseResults = await this.lexicalSearch.search(effectiveQuery, recallTopK);
      allRecalls.push(...sparseResults);
    }

    // 2.3 Feedback Recall（反馈记忆召回 - 低权重）
    if (this.feedbackRecall) {
      const feedbackResults = await this.feedbackRecall.search(effectiveQuery, Math.floor(recallTopK / 2));

      // 将反馈结果转换为 chunk IDs（通过关联笔记）
      for (const fbResult of feedbackResults) {
        const feedback = await this.feedbackRecall.getFeedbackById(fbResult.id);
        if (feedback && feedback.linkedNotes.length > 0) {
          // 查找关联笔记的 chunks
          for (const notePath of feedback.linkedNotes) {
            const chunks = await this.metadataStore.getChunksByPath(notePath);
            chunks.forEach(chunk => {
              allRecalls.push({
                id: chunk.id,
                score: fbResult.score * 0.5, // 降低权重
                source: 'feedback'
              });
            });
          }
        }
      }
    }

    // 2.4 Meta Recall（元数据召回 - 用于"这是什么笔记"类问题）
    if (this.metaRecall) {
      const metaResults = await this.metaRecall.search(effectiveQuery, Math.floor(recallTopK / 2));

      // 将元数据结果转换为 chunk IDs
      for (const metaResult of metaResults) {
        const chunks = await this.metadataStore.getChunksByPath(metaResult.id);
        chunks.forEach(chunk => {
          allRecalls.push({
            id: chunk.id,
            score: metaResult.score * 0.6, // 中等权重
            source: 'meta'
          });
        });
      }
    }

    // 3. Fusion（融合）
    const fusedResults = this.fusionService.reciprocalRankFusion(
      [allRecalls],
      60
    );

    // 记录召回结果
    this.loggingService?.logRecall(fusedResults.slice(0, 20).map(r => r.id));

    // 应用过滤器
    let filteredResults = fusedResults;
    if (this.queryAnalysis && filters) {
      // 先加载 chunks
      const resultsWithChunks = await this.loadChunks(filteredResults);
      const filtered = this.queryAnalysis.applyFilters(resultsWithChunks, filters);
      // 保留 source 字段
      filteredResults = filtered.map(r => ({
        id: r.id,
        score: r.score,
        source: fusedResults.find(f => f.id === r.id)?.source || 'unknown'
      }));
    }

    // 4. Rerank（重排序）
    let finalResults = filteredResults.slice(0, settings.topK * 5); // 候选数

    if (this.rerankService && finalResults.length > settings.topK) {
      const candidates: RerankCandidate[] = [];

      for (const result of finalResults) {
        const chunk = await this.metadataStore.getChunkById(result.id);
        if (chunk) {
          candidates.push({
            id: chunk.id,
            content: chunk.content,
            metadata: chunk
          });
        }
      }

      const reranked = await this.rerankService.rerank(effectiveQuery, candidates, settings.topK);
      finalResults = reranked.map(r => ({ id: r.id, score: r.score, source: 'reranked' }));

      // 记录重排序结果
      this.loggingService?.logRerank(finalResults.map(r => r.id));
    } else {
      finalResults = finalResults.slice(0, settings.topK);
    }

    // 5. Context Compression（上下文压缩）
    let chunkIds = finalResults.map(r => r.id);

    if (this.compressionService) {
      const compressed = await this.compressionService.compress(chunkIds, effectiveQuery);
      chunkIds = compressed.chunks.map(c => c.id);
    }

    // 记录最终结果
    this.loggingService?.logFinal(chunkIds);

    // 6. 构建最终结果
    const searchResults: SearchResult[] = [];

    for (const id of chunkIds) {
      const chunk = await this.metadataStore.getChunkById(id);
      if (chunk) {
        const scoreInfo = finalResults.find(r => r.id === id);
        let score = scoreInfo?.score || 0;

        // 应用 Wiki 优先级权重
        const settings = this.getSettings();
        const wikiPath = (settings.wikiPath || '_wiki').replace(/^\/+|\/+$/g, '') || '_wiki';
        if (settings.enableWiki && (chunk.path === wikiPath || chunk.path.startsWith(`${wikiPath}/`))) {
          score = score * settings.wikiPriority;
        }

        searchResults.push({
          chunk,
          score,
          snippet: this.extractSnippet(chunk.content, effectiveQuery)
        });
      }
    }

    // 按分数重新排序（因为应用了 Wiki 权重）
    searchResults.sort((a, b) => b.score - a.score);

    return searchResults;
  }

  private async loadChunks(results: RecallResult[]): Promise<Array<RecallResult & { chunk?: Chunk }>> {
    const withChunks: Array<RecallResult & { chunk?: Chunk }> = [];

    for (const result of results) {
      const chunk = await this.metadataStore.getChunkById(result.id);
      withChunks.push({ ...result, chunk: chunk || undefined });
    }

    return withChunks;
  }

  private extractSnippet(content: string, query: string, maxLength = 200): string {
    const queryTerms = query.toLowerCase().split(/\s+/);
    const contentLower = content.toLowerCase();

    let bestPos = 0;
    let bestScore = 0;

    for (let i = 0; i < content.length - maxLength; i += 50) {
      const window = contentLower.substring(i, i + maxLength);
      const score = queryTerms.filter(term => window.includes(term)).length;

      if (score > bestScore) {
        bestScore = score;
        bestPos = i;
      }
    }

    let snippet = content.substring(bestPos, bestPos + maxLength);

    if (bestPos > 0) {
      snippet = '...' + snippet.substring(snippet.indexOf(' ') + 1);
    }
    if (bestPos + maxLength < content.length) {
      snippet = snippet.substring(0, snippet.lastIndexOf(' ')) + '...';
    }

    return snippet;
  }
}
