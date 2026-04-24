import { OpenAiCompatibleLlmClient } from './ApiClients';

/**
 * LLM 调用失败记录
 */
export interface LlmFailureRecord {
  id: string;
  timestamp: number;
  operation: string;
  prompt: string;
  error: string;
  retryCount: number;
}

/**
 * LlmRetryService - LLM 调用重试和错误处理服务
 */
export class LlmRetryService {
  private llmClient: OpenAiCompatibleLlmClient;
  private failureRecords: LlmFailureRecord[] = [];
  private maxRetries: number = 3;
  private retryDelay: number = 2000; // 2秒

  constructor(llmClient: OpenAiCompatibleLlmClient) {
    this.llmClient = llmClient;
  }

  /**
   * 带重试的 LLM 调用
   */
  async chatWithRetry(
    messages: Array<{ role: string; content: string }>,
    temperature: number = 0.3,
    operation: string = 'unknown'
  ): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await this.llmClient.chat(messages, temperature);
        return response;
      } catch (error) {
        lastError = error as Error;
        console.error(`LLM 调用失败 (尝试 ${attempt + 1}/${this.maxRetries}):`, error);

        // 如果不是最后一次尝试，等待后重试
        if (attempt < this.maxRetries - 1) {
          await this.delay(this.retryDelay * (attempt + 1)); // 指数退避
        }
      }
    }

    // 所有重试都失败，记录失败
    const failureId = this.recordFailure(operation, messages, lastError!);
    throw new Error(`LLM 调用失败，已记录失败 ID: ${failureId}. 原因: ${lastError?.message}`);
  }

  /**
   * 记录失败
   */
  private recordFailure(
    operation: string,
    messages: Array<{ role: string; content: string }>,
    error: Error
  ): string {
    const id = `failure_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const record: LlmFailureRecord = {
      id,
      timestamp: Date.now(),
      operation,
      prompt: JSON.stringify(messages),
      error: error.message,
      retryCount: this.maxRetries
    };

    this.failureRecords.push(record);

    // 限制记录数量，只保留最近100条
    if (this.failureRecords.length > 100) {
      this.failureRecords = this.failureRecords.slice(-100);
    }

    return id;
  }

  /**
   * 获取所有失败记录
   */
  getFailureRecords(): LlmFailureRecord[] {
    return [...this.failureRecords];
  }

  /**
   * 获取特定失败记录
   */
  getFailureById(id: string): LlmFailureRecord | null {
    return this.failureRecords.find(r => r.id === id) || null;
  }

  /**
   * 重新处理失败的调用
   */
  async retryFailure(id: string): Promise<string> {
    const record = this.getFailureById(id);
    if (!record) {
      throw new Error(`未找到失败记录: ${id}`);
    }

    const messages = JSON.parse(record.prompt);
    const response = await this.chatWithRetry(messages, 0.3, record.operation);

    // 成功后移除记录
    this.failureRecords = this.failureRecords.filter(r => r.id !== id);

    return response;
  }

  /**
   * 批量重试所有失败的调用
   */
  async retryAllFailures(): Promise<{
    succeeded: string[];
    failed: string[];
  }> {
    const succeeded: string[] = [];
    const failed: string[] = [];

    const recordsToRetry = [...this.failureRecords];

    for (const record of recordsToRetry) {
      try {
        await this.retryFailure(record.id);
        succeeded.push(record.id);
      } catch (error) {
        failed.push(record.id);
        console.error(`重试失败 ${record.id}:`, error);
      }

      // 避免 API 限流
      await this.delay(1000);
    }

    return { succeeded, failed };
  }

  /**
   * 清除所有失败记录
   */
  clearFailureRecords(): void {
    this.failureRecords = [];
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 设置最大重试次数
   */
  setMaxRetries(maxRetries: number): void {
    this.maxRetries = maxRetries;
  }

  /**
   * 设置重试延迟
   */
  setRetryDelay(delayMs: number): void {
    this.retryDelay = delayMs;
  }
}
