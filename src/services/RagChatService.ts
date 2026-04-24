import { Citation, LayeredAskResult, PluginSettings } from '../types/index';
import { Retriever } from './Retriever';
import { OpenAiCompatibleLlmClient } from './ApiClients';
import { LoggingService } from './LoggingService';
import { FAQService, FAQSearchMatch } from './FAQService';
import { WikiGraphSearchService } from './WikiGraphSearchService';

export class RagChatService {
  private retriever: Retriever;
  private llmClient: OpenAiCompatibleLlmClient;
  private maxContextChars: number;
  private loggingService?: LoggingService;
  private faqService?: FAQService;
  private wikiGraphSearch?: WikiGraphSearchService;
  private getSettings?: () => PluginSettings;

  constructor(
    retriever: Retriever,
    llmClient: OpenAiCompatibleLlmClient,
    maxContextChars: number,
    loggingService?: LoggingService,
    faqService?: FAQService,
    wikiGraphSearch?: WikiGraphSearchService,
    getSettings?: () => PluginSettings
  ) {
    this.retriever = retriever;
    this.llmClient = llmClient;
    this.maxContextChars = maxContextChars;
    this.loggingService = loggingService;
    this.faqService = faqService;
    this.wikiGraphSearch = wikiGraphSearch;
    this.getSettings = getSettings;
  }

  async ask(question: string): Promise<LayeredAskResult> {
    const totalStart = performance.now();
    const faqStart = performance.now();
    const faqMatches = this.faqService ? await this.faqService.search(question, 3) : [];
    const faqTime = performance.now() - faqStart;
    const bestFAQ = faqMatches[0];

    if (this.faqService?.isStrongMatch(bestFAQ)) {
      await this.loggingService?.endQuery();
      return {
        answer: bestFAQ!.entry.correction,
        citations: this.buildFAQCitations(bestFAQ!),
        sourceLayer: 'faq',
        faqMatches,
        wikiPages: [],
        suggestedLinkedNotes: bestFAQ?.entry.linkedNotes || [],
        timings: {
          faq: faqTime,
          wiki: 0,
          vector: 0,
          llm: 0,
          total: performance.now() - totalStart
        }
      };
    }

    const wikiStart = performance.now();
    const vectorStart = performance.now();
    const [wikiResult, vectorResult] = await Promise.all([
      (async () => {
        try {
          return this.wikiGraphSearch ? await this.wikiGraphSearch.search(question, 8) : [];
        } catch (error) {
          console.warn('Wiki graph search failed:', error);
          return [];
        }
      })(),
      (async () => {
        try {
          return await this.retriever.search(question);
        } catch (error) {
          console.warn('Vector/RAG search failed, answer will use FAQ/Wiki context only:', error);
          return [];
        }
      })()
    ]);
    const wikiTime = performance.now() - wikiStart;
    const vectorTime = performance.now() - vectorStart;
    const wikiPages = wikiResult;
    const vectorResults = vectorResult.slice(0, 4);

    if (faqMatches.length === 0 && wikiPages.length === 0 && vectorResults.length === 0) {
      await this.loggingService?.endQuery();
      return {
        answer: '抱歉，我在 FAQ、Wiki 和向量索引中都没有找到相关信息来回答这个问题。',
        citations: [],
        sourceLayer: 'hybrid',
        faqMatches: [],
        wikiPages: [],
        suggestedLinkedNotes: [],
        timings: {
          faq: faqTime,
          wiki: wikiTime,
          vector: vectorTime,
          llm: 0,
          total: performance.now() - totalStart
        }
      };
    }

    const settings = this.getSettings ? this.getSettings() : undefined;
    const wikiContextRatio = settings?.wikiContextRatio ?? 0.35;
    const vectorContextRatio = settings?.vectorContextRatio ?? 0.35;
    const faqContext = this.buildFAQContext(faqMatches);
    const wikiContext = this.wikiGraphSearch?.buildContext(wikiPages, Math.floor(this.maxContextChars * wikiContextRatio)) || '';
    const vectorContext = this.buildContext(vectorResults, Math.floor(this.maxContextChars * vectorContextRatio));
    const prompt = this.buildPrompt(question, faqContext, wikiContext, vectorContext);

    const llmStart = performance.now();
    const answer = await this.llmClient.chat([
      {
        role: 'system',
        content: 'You answer from a layered personal knowledge base. Priority: confirmed FAQ first, then maintained Wiki graph pages, then vector/RAG raw-note evidence. If layers disagree, say so and prefer confirmed FAQ. Answer in the same language as the question.'
      },
      {
        role: 'user',
        content: prompt
      }
    ], 0.3);
    const llmTime = performance.now() - llmStart;

    const citations: Citation[] = [
      ...faqMatches.slice(0, 2).flatMap(match => this.buildFAQCitations(match)),
      ...wikiPages.slice(0, 4).map(page => ({
        path: page.path,
        title: page.title,
        sectionPath: 'Wiki',
        snippet: page.content.slice(0, 200),
        sourceLayer: 'wiki' as const
      })),
      ...vectorResults.slice(0, 4).map(result => ({
        path: result.chunk.path,
        title: result.chunk.title,
        heading: result.chunk.heading,
        sectionPath: result.chunk.sectionPath,
        startLine: result.chunk.startLine,
        endLine: result.chunk.endLine,
        snippet: result.snippet || result.chunk.content.slice(0, 200),
        sourceLayer: 'vector' as const
      }))
    ];

    // 记录引用（使用 chunk ID 而不是路径）
    this.loggingService?.logCitations(vectorResults.map(r => r.chunk.id));

    // 结束日志记录
    await this.loggingService?.endQuery();

    const suggestedLinkedNotes = Array.from(new Set([
      ...faqMatches.flatMap(match => match.entry.linkedNotes),
      ...vectorResults.map(result => result.chunk.path),
      ...this.collectRawNotesFromWikiPages(wikiPages),
      ...citations
        .map(citation => citation.path)
        .filter(path => !this.isLikelyWikiPath(path))
    ])).slice(0, 8);

    const sourceLayer = faqMatches.length === 0 && wikiPages.length === 0 && vectorResults.length > 0
      ? 'vector'
      : 'hybrid';

    return {
      answer,
      citations,
      sourceLayer,
      faqMatches,
      wikiPages,
      suggestedLinkedNotes,
      timings: {
        faq: faqTime,
        wiki: wikiTime,
        vector: vectorTime,
        llm: llmTime,
        total: performance.now() - totalStart
      },
      wikiSources: wikiPages.map(page => page.path),
      vectorSources: vectorResults.map(result => result.chunk.path)
    };
  }

  private buildContext(searchResults: any[], maxChars = this.maxContextChars): string {
    let context = '';
    let currentLength = 0;

    for (let i = 0; i < searchResults.length; i++) {
      const result = searchResults[i];
      const chunk = result.chunk;

      const entry = `[${i + 1}] ${chunk.title}${chunk.sectionPath ? ' > ' + chunk.sectionPath : ''}\n${chunk.content}\n\n`;

      if (currentLength + entry.length > maxChars) {
        break;
      }

      context += entry;
      currentLength += entry.length;
    }

    return context;
  }

  private buildFAQContext(matches: FAQSearchMatch[]): string {
    if (matches.length === 0) {
      return '';
    }

    return matches.map((match, index) =>
      `[F${index + 1}] score=${match.score.toFixed(3)} exact=${match.exact}\n` +
      `Question: ${match.entry.question}\n` +
      `Confirmed answer: ${match.entry.correction}\n` +
      `FAQ page: ${match.entry.wikiPath}\n`
    ).join('\n');
  }

  private buildFAQCitations(match: FAQSearchMatch): Citation[] {
    const citations: Citation[] = [];
    const primaryPath = match.entry.wikiPath || match.entry.linkedNotes[0];
    if (primaryPath) {
      citations.push({
        path: primaryPath,
        title: match.entry.question,
        sectionPath: 'FAQ',
        snippet: match.entry.correction.slice(0, 200),
        sourceLayer: 'faq'
      });
    }

    for (const notePath of match.entry.linkedNotes) {
      citations.push({
        path: notePath,
        title: notePath.split('/').pop() || notePath,
        sectionPath: 'FAQ linked note',
        snippet: `关联 FAQ: ${match.entry.question}`,
        sourceLayer: 'faq'
      });
    }

    return citations;
  }

  private buildPrompt(question: string, faqContext: string, wikiContext: string, vectorContext: string): string {
    const answerTemplate = this.getSettings ? this.getSettings().answerTemplate : 'structured';
    const formatBlock = answerTemplate === 'concise'
      ? `请用 Markdown 输出，结构尽量紧凑，至少包含：

## 结论

## 依据`
      : `请用 Markdown 输出，结构固定为：

## 结论

## 要点

## 依据

## 引用`;
    return `请基于以下三层上下文回答问题。优先级严格为：
1. FAQ：用户确认/纠正过的答案，最高优先级。
2. Wiki：已经整理过的知识图谱页面。
3. Vector：原始笔记和索引召回，用于补充证据。

如果 FAQ 与其他来源冲突，优先 FAQ，并说明存在冲突。
请尽量引用来源标记，例如 [F1]、[W1]、[1]。
${formatBlock}

FAQ context:
${faqContext || '无'}

Wiki graph context:
${wikiContext || '无'}

Vector/RAG context:
${vectorContext || '无'}

Question: ${question}

Answer:`;
  }

  private collectRawNotesFromWikiPages(pages: any[]): string[] {
    const rawNotes: string[] = [];
    for (const page of pages) {
      for (const link of page.links || []) {
        const target = link.split('|')[0].trim().replace(/#.*$/, '');
        if (!this.isLikelyWikiPath(target) && /\.md$/i.test(target)) {
          rawNotes.push(target);
        }
      }
    }
    return rawNotes;
  }

  private isLikelyWikiPath(path: string): boolean {
    return path === '_wiki' || path.startsWith('_wiki/');
  }
}
