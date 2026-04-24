import { OpenAiCompatibleLlmClient } from './ApiClients';
import { PluginSettings } from '../types/index';
import { JsonMetadataStore } from './Storage';
import { UserPatternService } from './UserPatternService';

// 查询分析结果
export interface QueryAnalysis {
  standaloneQuestion: string;
  queryVariants: string[];
  inferredFilters?: {
    tags?: string[];
    paths?: string[];
  };
}

// 查询分析服务
export class QueryAnalysisService {
  private llmClient: OpenAiCompatibleLlmClient;
  private metadataStore: JsonMetadataStore;
  private getSettings: () => PluginSettings;
  private userPatternService?: UserPatternService;

  constructor(
    llmClient: OpenAiCompatibleLlmClient,
    metadataStore: JsonMetadataStore,
    getSettings: () => PluginSettings,
    userPatternService?: UserPatternService
  ) {
    this.llmClient = llmClient;
    this.metadataStore = metadataStore;
    this.getSettings = getSettings;
    this.userPatternService = userPatternService;
  }

  async analyzeQuery(query: string, conversationHistory?: Array<{ role: string; content: string }>): Promise<QueryAnalysis> {
    // 0. 检测触发词（轻量级优化）
    let shouldUseAdvancedAnalysis = true;

    if (this.userPatternService) {
      const triggers = await this.userPatternService.detectTriggers(query);

      // 只有命中触发词或是追问时，才使用高级分析
      const isFollowUp = this.detectFollowUp(query);
      shouldUseAdvancedAnalysis = triggers.length > 0 || isFollowUp;
    }

    // 1. Standalone Question（处理追问）
    const standaloneQuestion = shouldUseAdvancedAnalysis
      ? await this.generateStandaloneQuestion(query, conversationHistory)
      : query;

    // 2. Multi-Query / Query Rewrite（生成查询变体）
    const queryVariants = shouldUseAdvancedAnalysis
      ? await this.generateQueryVariants(standaloneQuestion)
      : [standaloneQuestion];

    // 3. Metadata Filter Inference（推断过滤条件）
    const inferredFilters = await this.inferFilters(standaloneQuestion);

    return {
      standaloneQuestion,
      queryVariants,
      inferredFilters
    };
  }

  private async generateStandaloneQuestion(
    query: string,
    conversationHistory?: Array<{ role: string; content: string }>
  ): Promise<string> {
    // 如果没有历史对话，直接返回原问题
    if (!conversationHistory || conversationHistory.length === 0) {
      return query;
    }

    // 检查是否是追问（包含代词、指代词等）
    const isFollowUp = this.detectFollowUp(query);
    if (!isFollowUp) {
      return query;
    }

    // 使用 LLM 改写为独立问题
    const prompt = `Given the conversation history and a follow-up question, rewrite the follow-up question to be a standalone question that can be understood without the conversation context.

Conversation History:
${conversationHistory.slice(-3).map(msg => `${msg.role}: ${msg.content}`).join('\n')}

Follow-up Question: ${query}

Standalone Question:`;

    try {
      const standalone = await this.llmClient.chat([
        { role: 'user', content: prompt }
      ], 0.3);

      return standalone.trim();
    } catch (error) {
      console.error('Failed to generate standalone question:', error);
      return query; // 失败时返回原问题
    }
  }

  private detectFollowUp(query: string): boolean {
    const followUpIndicators = [
      '它', '他', '她', '这个', '那个', '这些', '那些',
      '上面', '前面', '刚才', '之前',
      'it', 'this', 'that', 'these', 'those', 'above', 'previous'
    ];

    const lowerQuery = query.toLowerCase();
    return followUpIndicators.some(indicator => lowerQuery.includes(indicator));
  }

  private async generateQueryVariants(query: string): Promise<string[]> {
    const variants = [query]; // 始终包含原始查询

    try {
      const prompt = `Generate 2-3 alternative phrasings of the following question that preserve the same meaning but use different words or perspectives. Return only the alternative questions, one per line.

Original Question: ${query}

Alternative Questions:`;

      const response = await this.llmClient.chat([
        { role: 'user', content: prompt }
      ], 0.7);

      const alternatives = response
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('Alternative'))
        .slice(0, 3);

      variants.push(...alternatives);
    } catch (error) {
      console.error('Failed to generate query variants:', error);
    }

    return variants;
  }

  private async inferFilters(query: string): Promise<{ tags?: string[]; paths?: string[] } | undefined> {
    // 简单的关键词匹配推断
    const filters: { tags?: string[]; paths?: string[] } = {};

    // 提取可能的标签
    const tagMatches = query.match(/#([a-zA-Z0-9_\u4e00-\u9fa5]+)/g);
    if (tagMatches) {
      filters.tags = tagMatches.map(tag => tag.substring(1));
    }

    // 提取可能的路径
    const pathMatches = query.match(/(?:in|from|under)\s+([a-zA-Z0-9_\-\/]+)/gi);
    if (pathMatches) {
      filters.paths = pathMatches.map(match => match.split(/\s+/).pop()!);
    }

    return Object.keys(filters).length > 0 ? filters : undefined;
  }

  // 应用过滤器到检索结果
  applyFilters(
    results: Array<{ id: string; score: number; chunk?: any }>,
    filters?: { tags?: string[]; paths?: string[] }
  ): Array<{ id: string; score: number; chunk?: any }> {
    if (!filters) {
      return results;
    }

    return results.filter(result => {
      if (!result.chunk) return true;

      // 标签过滤
      if (filters.tags && filters.tags.length > 0) {
        const hasMatchingTag = filters.tags.some(tag =>
          result.chunk.tags?.includes(tag)
        );
        if (!hasMatchingTag) return false;
      }

      // 路径过滤
      if (filters.paths && filters.paths.length > 0) {
        const hasMatchingPath = filters.paths.some(path =>
          result.chunk.path?.includes(path)
        );
        if (!hasMatchingPath) return false;
      }

      return true;
    });
  }
}
