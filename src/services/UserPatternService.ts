import { UserPattern } from '../types/index';
import { ObsidianJsonFileAdapter } from './Storage';

// 用户模式学习服务
export class UserPatternService {
  private adapter: ObsidianJsonFileAdapter;
  private basePath: string;
  private pattern?: UserPattern;

  constructor(adapter: ObsidianJsonFileAdapter, basePath: string) {
    this.adapter = adapter;
    this.basePath = basePath;
  }

  // 加载用户模式
  async load(): Promise<UserPattern> {
    if (this.pattern) {
      return this.pattern;
    }

    const path = `${this.basePath}/user-patterns.json`;
    try {
      const content = await this.adapter.read(path);
      const parsed: unknown = JSON.parse(content);
      this.pattern = parsed as UserPattern;
    } catch {
      this.pattern = this.getDefaultPattern();
    }

    return this.pattern;
  }

  // 保存用户模式
  async save(pattern: UserPattern): Promise<void> {
    this.pattern = pattern;
    const path = `${this.basePath}/user-patterns.json`;
    await this.adapter.write(path, JSON.stringify(pattern, null, 2));
  }

  // 分析问题并更新模式
  async analyzeQuestion(question: string): Promise<void> {
    const pattern = await this.load();

    // 1. 提取关键词并更新词频
    const keywords = this.extractKeywords(question);
    for (const keyword of keywords) {
      pattern.frequentTerms[keyword] = (pattern.frequentTerms[keyword] || 0) + 1;
    }

    // 2. 更新触发词（词频 > 5）
    pattern.triggerWords = Object.keys(pattern.frequentTerms)
      .filter(term => pattern.frequentTerms[term] > 5)
      .sort((a, b) => pattern.frequentTerms[b] - pattern.frequentTerms[a])
      .slice(0, 50); // 保留前 50 个

    // 3. 识别问题模板
    const template = this.extractQuestionTemplate(question);
    if (template && !pattern.questionTemplates.includes(template)) {
      pattern.questionTemplates.push(template);

      // 最多保留 20 个模板
      if (pattern.questionTemplates.length > 20) {
        pattern.questionTemplates.shift();
      }
    }

    // 4. 更新时间戳
    pattern.lastUpdated = Date.now();

    await this.save(pattern);
  }

  // 检测触发词
  async detectTriggers(question: string): Promise<string[]> {
    const pattern = await this.load();
    const questionLower = question.toLowerCase();

    return pattern.triggerWords.filter(trigger =>
      questionLower.includes(trigger.toLowerCase())
    );
  }

  // 获取高频术语（用于查询扩展）
  async getFrequentTerms(limit = 10): Promise<string[]> {
    const pattern = await this.load();

    return Object.entries(pattern.frequentTerms)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([term]) => term);
  }

  // 记录上下文（用于追问）
  async recordContext(key: string, values: string[]): Promise<void> {
    const pattern = await this.load();

    pattern.contextMemory[key] = values;

    // 限制上下文记忆数量
    const keys = Object.keys(pattern.contextMemory);
    if (keys.length > 10) {
      delete pattern.contextMemory[keys[0]];
    }

    await this.save(pattern);
  }

  // 获取上下文
  async getContext(key: string): Promise<string[] | undefined> {
    const pattern = await this.load();
    return pattern.contextMemory[key];
  }

  // 清理旧数据（超过 30 天）
  async cleanup(): Promise<void> {
    const pattern = await this.load();
    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;

    if (now - pattern.lastUpdated > thirtyDays) {
      // 重置为默认
      this.pattern = this.getDefaultPattern();
      await this.save(this.pattern);
    }
  }

  // 提取关键词
  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
      '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
      '自己', '这', '那', '什么', '怎么', '为什么', '哪里', '谁', '吗', '呢', '吧',
      'the', 'is', 'at', 'which', 'on', 'a', 'an', 'as', 'are', 'was', 'were',
      'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
      'would', 'should', 'could', 'may', 'might', 'must', 'can', 'what', 'where',
      'when', 'why', 'how', 'who', 'which'
    ]);

    return text
      .toLowerCase()
      .split(/[\s,，。！？、；：""''（）[\]]+/)
      .filter(word => word.length > 1 && !stopWords.has(word))
      .slice(0, 10);
  }

  // 提取问题模板
  private extractQuestionTemplate(question: string): string | undefined {
    // 识别常见问题模式
    const patterns = [
      /^(什么是|what is|what's)/i,
      /^(如何|怎么|how to|how do)/i,
      /^(为什么|why)/i,
      /^(在哪|where)/i,
      /^(谁|who)/i,
      /^(有没有|是否|do you have|is there)/i
    ];

    for (const pattern of patterns) {
      if (pattern.test(question)) {
        return pattern.source;
      }
    }

    return undefined;
  }

  private getDefaultPattern(): UserPattern {
    return {
      frequentTerms: {},
      questionTemplates: [],
      preferredAnswerStyle: 'detailed',
      triggerWords: [],
      contextMemory: {},
      lastUpdated: Date.now()
    };
  }

  // 获取统计信息
  async getStats(): Promise<{
    totalQuestions: number;
    uniqueTerms: number;
    triggerWords: number;
    templates: number;
  }> {
    const pattern = await this.load();

    const totalQuestions = Object.values(pattern.frequentTerms).reduce((sum, count) => sum + count, 0);

    return {
      totalQuestions,
      uniqueTerms: Object.keys(pattern.frequentTerms).length,
      triggerWords: pattern.triggerWords.length,
      templates: pattern.questionTemplates.length
    };
  }
}
