import { App } from 'obsidian';
import { FAQEmbedding, FAQEntry, FeedbackEntry } from '../types/index';
import { OpenAiCompatibleEmbeddingClient } from './ApiClients';
import { ObsidianJsonFileAdapter } from './Storage';
import { WikiService } from './WikiService';

export interface FAQSearchMatch {
  entry: FAQEntry;
  score: number;
  exact: boolean;
}

export class FAQService {
  private app: App;
  private wikiService: WikiService;
  private embeddingClient: OpenAiCompatibleEmbeddingClient;
  private adapter: ObsidianJsonFileAdapter;
  private basePath: string;
  private readonly faqPath = 'faq';
  private readonly legacyFeedbackPath = 'feedbacks.json';
  private getMatchThreshold?: () => number;

  private entriesCache: FAQEntry[] | null = null;
  private embeddingsCache: FAQEmbedding[] | null = null;
  private normalizedIndex: Map<string, FAQEntry> = new Map();

  constructor(
    app: App,
    wikiService: WikiService,
    embeddingClient: OpenAiCompatibleEmbeddingClient,
    adapter: ObsidianJsonFileAdapter,
    basePath: string,
    getMatchThreshold?: () => number
  ) {
    this.app = app;
    this.wikiService = wikiService;
    this.embeddingClient = embeddingClient;
    this.adapter = adapter;
    this.basePath = basePath;
    this.getMatchThreshold = getMatchThreshold;
  }

  async createFAQ(
    question: string,
    wrongAnswer: string,
    correction: string,
    linkedNotes: string[]
  ): Promise<FAQEntry> {
    const cleanQuestion = question.trim();
    const cleanCorrection = correction.trim();
    if (!cleanQuestion || !cleanCorrection) {
      throw new Error('问题和正确答案不能为空');
    }

    if (!this.wikiService.isInitialized()) {
      await this.wikiService.initializeWikiStructure();
    }

    await this.ensureLoaded();

    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const normalizedQuestion = this.normalize(cleanQuestion);
    const existing = this.normalizedIndex.get(normalizedQuestion);
    const id = existing?.id || `${now.getTime()}`;
    const title = `FAQ - ${this.truncateTitle(existing?.question || cleanQuestion)}`;
    const mergedLinkedNotes = Array.from(new Set([
      ...(existing?.linkedNotes || []),
      ...linkedNotes.map(path => path.trim()).filter(Boolean)
    ]));
    const linkedNotesText = mergedLinkedNotes.length > 0
      ? mergedLinkedNotes.map(path => `- [[${path}]]`).join('\n')
      : '- 无';

    const content = `## 问题
${cleanQuestion}

## 正确答案
${cleanCorrection}

## 错误答案
${wrongAnswer || existing?.wrongAnswer || '未记录'}

## 关联笔记
${linkedNotesText}

## 状态
- confirmed
`;

    const wikiPath = await this.wikiService.createOrUpdatePage('faq', title, content, 'FAQ', mergedLinkedNotes.length);

    const entry: FAQEntry = {
      id,
      question: cleanQuestion,
      normalizedQuestion,
      wrongAnswer: wrongAnswer || existing?.wrongAnswer || '',
      correction: cleanCorrection,
      linkedNotes: mergedLinkedNotes,
      wikiPath,
      status: 'confirmed',
      created: existing?.created || date,
      updated: date,
      content: this.buildEmbeddingText(cleanQuestion, cleanCorrection, mergedLinkedNotes)
    };

    const entries = (this.entriesCache || []).filter(item => item.id !== entry.id && item.normalizedQuestion !== normalizedQuestion);
    entries.push(entry);
    await this.saveEntries(entries);
    await this.upsertEmbedding(entry);

    await this.wikiService.addLogEntry({
      timestamp: Date.now(),
      date,
      action: 'faq',
      title: cleanQuestion,
      details: `- 更新 FAQ: [[${wikiPath}]]\n- 关联笔记: ${mergedLinkedNotes.length}`
    });

    return entry;
  }

  async search(question: string, topK = 3): Promise<FAQSearchMatch[]> {
    await this.ensureLoaded();
    const entries = this.entriesCache || [];
    if (entries.length === 0) {
      return [];
    }

    const normalizedQuestion = this.normalize(question);
    const exactEntry = this.normalizedIndex.get(normalizedQuestion);
    if (exactEntry) {
      return [{ entry: exactEntry, score: 1, exact: true }];
    }

    const embeddings = this.embeddingsCache || [];
    if (embeddings.length === 0) {
      return this.lexicalFallback(question, entries, topK);
    }

    const queryEmbedding = await this.embeddingClient.embed(question);
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    const matches: FAQSearchMatch[] = [];

    for (const item of embeddings) {
      const entry = byId.get(item.id);
      if (!entry) {
        continue;
      }
      matches.push({
        entry,
        score: this.cosineSimilarity(queryEmbedding, item.embedding),
        exact: false
      });
    }

    return matches
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  isStrongMatch(match: FAQSearchMatch | undefined): boolean {
    const threshold = this.getMatchThreshold ? this.getMatchThreshold() : 0.88;
    return Boolean(match && (match.exact || match.score >= threshold));
  }

  async rebuildFAQEmbeddings(): Promise<void> {
    await this.ensureLoaded();
    const entries = this.entriesCache || [];
    const embeddings: FAQEmbedding[] = [];

    for (const entry of entries) {
      embeddings.push({
        id: entry.id,
        embedding: await this.embeddingClient.embed(entry.content)
      });
    }

    await this.saveEmbeddings(embeddings);
  }

  async getExactMatch(question: string): Promise<FAQEntry | undefined> {
    await this.ensureLoaded();
    return this.normalizedIndex.get(this.normalize(question));
  }

  private async upsertEmbedding(entry: FAQEntry): Promise<void> {
    await this.ensureLoaded();
    const embeddings = this.embeddingsCache || [];
    const embedding = await this.embeddingClient.embed(entry.content);
    const existingIndex = embeddings.findIndex(item => item.id === entry.id);

    if (existingIndex >= 0) {
      embeddings[existingIndex] = { id: entry.id, embedding };
    } else {
      embeddings.push({ id: entry.id, embedding });
    }

    await this.saveEmbeddings(embeddings);
  }

  private lexicalFallback(question: string, entries: FAQEntry[], topK: number): FAQSearchMatch[] {
    const tokens = this.tokenize(question);
    return entries
      .map(entry => {
        const haystack = `${entry.question}\n${entry.correction}\n${entry.linkedNotes.join(' ')}`.toLowerCase();
        const score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0) / Math.max(tokens.length, 1);
        return { entry, score, exact: false };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.entriesCache && this.embeddingsCache) {
      return;
    }

    const entries = await this.loadEntriesFromDisk();
    const deduped = new Map<string, FAQEntry>();
    for (const entry of entries) {
      deduped.set(entry.normalizedQuestion, entry);
    }

    this.entriesCache = Array.from(deduped.values()).sort((a, b) => b.updated.localeCompare(a.updated));
    this.normalizedIndex = new Map(this.entriesCache.map(entry => [entry.normalizedQuestion, entry]));
    this.embeddingsCache = await this.loadEmbeddingsFromDisk();
  }

  private async loadEntriesFromDisk(): Promise<FAQEntry[]> {
    const currentEntries = await this.loadCurrentFaqEntries();
    const legacyEntries = await this.loadLegacyFeedbackEntries();
    return [...legacyEntries, ...currentEntries]
      .map(entry => ({
        ...entry,
        normalizedQuestion: entry.normalizedQuestion || this.normalize(entry.question)
      }));
  }

  private async loadCurrentFaqEntries(): Promise<FAQEntry[]> {
    const path = `${this.basePath}/${this.faqPath}/faq.json`;
    try {
      const content = await this.adapter.read(path);
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async loadLegacyFeedbackEntries(): Promise<FAQEntry[]> {
    const path = `${this.basePath}/${this.legacyFeedbackPath}`;
    try {
      const content = await this.adapter.read(path);
      const parsed = JSON.parse(content) as FeedbackEntry[];
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.map(entry => {
        const created = new Date(entry.timestamp || Date.now()).toISOString().split('T')[0];
        return {
          id: `legacy-${entry.id}`,
          question: entry.question,
          normalizedQuestion: this.normalize(entry.question),
          wrongAnswer: entry.wrongAnswer,
          correction: entry.correction,
          linkedNotes: entry.linkedNotes || [],
          wikiPath: '',
          status: 'confirmed',
          created,
          updated: created,
          content: entry.content || this.buildEmbeddingText(entry.question, entry.correction, entry.linkedNotes || [])
        } as FAQEntry;
      });
    } catch {
      return [];
    }
  }

  private async saveEntries(entries: FAQEntry[]): Promise<void> {
    this.entriesCache = entries;
    this.normalizedIndex = new Map(entries.map(entry => [entry.normalizedQuestion, entry]));
    await this.adapter.mkdir(`${this.basePath}/${this.faqPath}`);
    await this.adapter.write(
      `${this.basePath}/${this.faqPath}/faq.json`,
      JSON.stringify(entries, null, 2)
    );
  }

  private async loadEmbeddingsFromDisk(): Promise<FAQEmbedding[]> {
    const path = `${this.basePath}/${this.faqPath}/faq-embeddings.json`;
    try {
      const content = await this.adapter.read(path);
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async saveEmbeddings(embeddings: FAQEmbedding[]): Promise<void> {
    this.embeddingsCache = embeddings;
    await this.adapter.mkdir(`${this.basePath}/${this.faqPath}`);
    await this.adapter.write(
      `${this.basePath}/${this.faqPath}/faq-embeddings.json`,
      JSON.stringify(embeddings, null, 2)
    );
  }

  private buildEmbeddingText(question: string, correction: string, linkedNotes: string[]): string {
    return `问题: ${question}\n正确答案: ${correction}\n关联笔记: ${linkedNotes.join(', ')}`;
  }

  private truncateTitle(title: string): string {
    return title.replace(/\s+/g, ' ').substring(0, 60);
  }

  private normalize(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private tokenize(value: string): string[] {
    const matches = value.toLowerCase().match(/[\u4e00-\u9fff]{2,}|[a-z0-9][a-z0-9._-]{1,}/g);
    return Array.from(new Set(matches || []));
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

    if (!normA || !normB) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
