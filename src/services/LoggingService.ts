import { ObsidianJsonFileAdapter } from './Storage';

// 查询日志条目
export interface QueryLogEntry {
  timestamp: number;
  query: string;
  standaloneQuestion?: string;
  recallIds: string[];
  rerankedIds: string[];
  finalIds: string[];
  citationIds: string[];
  userCorrection?: {
    correctedAnswer: string;
    linkedNotes: string[];
  };
  responseTime: number;
}

// 评测指标
export interface EvalMetrics {
  retrievalRelevance: number; // 召回相关性
  groundedness: number; // 答案基于上下文的程度
  citationAccuracy: number; // 引用准确性
  responseTime: number; // 响应时间
}

// 日志和评测服务
export class LoggingService {
  private adapter: ObsidianJsonFileAdapter;
  private basePath: string;
  private currentLog?: QueryLogEntry;

  constructor(adapter: ObsidianJsonFileAdapter, basePath: string) {
    this.adapter = adapter;
    this.basePath = basePath;
  }

  // 开始记录查询
  startQuery(query: string): void {
    this.currentLog = {
      timestamp: Date.now(),
      query,
      recallIds: [],
      rerankedIds: [],
      finalIds: [],
      citationIds: [],
      responseTime: 0
    };
  }

  // 记录 standalone question
  logStandaloneQuestion(standaloneQuestion: string): void {
    if (this.currentLog) {
      this.currentLog.standaloneQuestion = standaloneQuestion;
    }
  }

  // 记录召回结果
  logRecall(ids: string[]): void {
    if (this.currentLog) {
      this.currentLog.recallIds = ids;
    }
  }

  // 记录重排序结果
  logRerank(ids: string[]): void {
    if (this.currentLog) {
      this.currentLog.rerankedIds = ids;
    }
  }

  // 记录最终结果
  logFinal(ids: string[]): void {
    if (this.currentLog) {
      this.currentLog.finalIds = ids;
    }
  }

  // 记录引用
  logCitations(ids: string[]): void {
    if (this.currentLog) {
      this.currentLog.citationIds = ids;
    }
  }

  // 记录用户纠正
  logCorrection(correctedAnswer: string, linkedNotes: string[]): void {
    if (this.currentLog) {
      this.currentLog.userCorrection = {
        correctedAnswer,
        linkedNotes
      };
    }
  }

  // 结束记录并保存
  async endQuery(): Promise<void> {
    if (!this.currentLog) {
      return;
    }

    try {
      this.currentLog.responseTime = Date.now() - this.currentLog.timestamp;

      // 加载现有日志
      const logs = await this.loadLogs();

      // 添加新日志
      logs.push(this.currentLog);

      // 限制日志数量（最多保留 1000 条）
      if (logs.length > 1000) {
        logs.shift();
      }

      // 保存
      await this.saveLogs(logs);
    } catch (error) {
      console.warn('[AI RAG] Failed to save query log. Continuing without blocking the answer.', error);
    } finally {
      this.currentLog = undefined;
    }
  }

  // 加载日志
  async loadLogs(): Promise<QueryLogEntry[]> {
    const path = `${this.basePath}/query-logs.json`;
    try {
      const content = await this.adapter.read(path);
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  // 保存日志
  private async saveLogs(logs: QueryLogEntry[]): Promise<void> {
    const path = `${this.basePath}/query-logs.json`;
    await this.adapter.mkdir(this.basePath);
    await this.adapter.write(path, JSON.stringify(logs, null, 2));
  }

  // 计算评测指标
  async calculateMetrics(): Promise<EvalMetrics> {
    const logs = await this.loadLogs();

    if (logs.length === 0) {
      return {
        retrievalRelevance: 0,
        groundedness: 0,
        citationAccuracy: 0,
        responseTime: 0
      };
    }

    // 1. 召回相关性：重排序后保留的比例
    let retrievalRelevanceSum = 0;
    let retrievalCount = 0;

    for (const log of logs) {
      if (log.recallIds.length > 0 && log.rerankedIds.length > 0) {
        const retained = log.rerankedIds.filter(id => log.recallIds.includes(id)).length;
        retrievalRelevanceSum += retained / log.recallIds.length;
        retrievalCount++;
      }
    }

    const retrievalRelevance = retrievalCount > 0 ? retrievalRelevanceSum / retrievalCount : 0;

    // 2. Groundedness：最终结果中被引用的比例
    let groundednessSum = 0;
    let groundednessCount = 0;

    for (const log of logs) {
      if (log.finalIds.length > 0 && log.citationIds.length > 0) {
        const cited = log.citationIds.filter(id => log.finalIds.includes(id)).length;
        groundednessSum += cited / log.finalIds.length;
        groundednessCount++;
      }
    }

    const groundedness = groundednessCount > 0 ? groundednessSum / groundednessCount : 0;

    // 3. 引用准确性：有用户纠正的比例（越低越好，这里取反）
    const correctionCount = logs.filter(log => log.userCorrection).length;
    const citationAccuracy = 1 - (correctionCount / logs.length);

    // 4. 平均响应时间
    const avgResponseTime = logs.reduce((sum, log) => sum + log.responseTime, 0) / logs.length;

    return {
      retrievalRelevance,
      groundedness,
      citationAccuracy,
      responseTime: avgResponseTime
    };
  }

  // 获取统计信息
  async getStats(): Promise<{
    totalQueries: number;
    avgResponseTime: number;
    correctionRate: number;
    recentQueries: string[];
  }> {
    const logs = await this.loadLogs();

    const totalQueries = logs.length;
    const avgResponseTime = logs.reduce((sum, log) => sum + log.responseTime, 0) / (logs.length || 1);
    const correctionRate = logs.filter(log => log.userCorrection).length / (logs.length || 1);
    const recentQueries = logs.slice(-10).map(log => log.query).reverse();

    return {
      totalQueries,
      avgResponseTime,
      correctionRate,
      recentQueries
    };
  }

  // 清空日志
  async clearLogs(): Promise<void> {
    await this.saveLogs([]);
  }
}
