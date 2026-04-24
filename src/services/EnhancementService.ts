import { App, Notice, TFile } from 'obsidian';
import {
  CorrectionContext,
  FeedbackEvent,
  FeedbackEmbedding,
  FeedbackEntry,
  MetaEmbedding,
  MetaNote,
  TuningProposal
} from '../types/index';
import AiRagPlugin from '../main';
import { UserPatternService } from './UserPatternService';
import { ObsidianJsonFileAdapter } from './Storage';
import { FAQService } from './FAQService';
import { SensitivityService } from './SensitivityService';
import { CorrectionModal } from '../views/CorrectionModal';
import { TuningProposalModal } from '../views/TuningProposalModal';
import { OpenAiCompatibleEmbeddingClient, OpenAiCompatibleHttpClient, OpenAiCompatibleLlmClient } from './ApiClients';

interface UpdateMetaOptions {
  promptSensitive?: boolean;
}

export class EnhancementService {
  private plugin: AiRagPlugin;
  private basePath: string;
  private app: App;
  private userPatternService: UserPatternService;
  private faqService?: FAQService;
  private sensitivityService?: SensitivityService;

  constructor(plugin: AiRagPlugin, basePath: string) {
    this.plugin = plugin;
    this.basePath = basePath;
    this.app = plugin.app;

    const adapter = new ObsidianJsonFileAdapter(this.app);
    this.userPatternService = new UserPatternService(adapter, basePath);
  }

  setFAQService(faqService: FAQService): void {
    this.faqService = faqService;
  }

  setSensitivityService(sensitivityService: SensitivityService): void {
    this.sensitivityService = sensitivityService;
  }

  t(zh: string, en: string): string {
    return this.plugin.t(zh, en);
  }

  addCopyButton(container: HTMLElement, text: string): HTMLButtonElement {
    const copyBtn = container.createEl('button', {
      text: this.t('复制', 'Copy'),
      cls: 'ai-rag-copy-button'
    });

    copyBtn.addEventListener('click', () => {
      void navigator.clipboard.writeText(text).then(() => {
        new Notice(this.t('已复制到剪贴板', 'Copied to clipboard'));
        copyBtn.textContent = this.t('已复制', 'Copied');
        window.setTimeout(() => copyBtn.textContent = this.t('复制', 'Copy'), 1600);
      }, error => {
        console.error('Copy failed:', error);
      });
    });

    return copyBtn;
  }

  addCorrectionButton(
    container: HTMLElement,
    context: CorrectionContext,
    onCorrected?: () => void
  ): HTMLButtonElement {
    const correctionBtn = container.createEl('button', {
      text: this.t('纠正', 'Correct'),
      cls: 'ai-rag-correction-button'
    });

    correctionBtn.addEventListener('click', () => {
      this.openCorrectionDialog(context, onCorrected);
    });

    return correctionBtn;
  }

  private openCorrectionDialog(
    context: CorrectionContext,
    onCorrected?: () => void
  ) {
    const initialSuggestions = this.collectSuggestedNotes(context);
    const modal = new CorrectionModal(this.app, {
      question: context.question,
      wrongAnswer: context.answer,
      initialSuggestions,
      language: this.plugin.settings.language,
      searchNotes: (query) => this.searchNotes(query, initialSuggestions),
      onSubmit: async (correction, linkedNotes) => {
        await this.saveFeedback(context.question, context.answer, correction, linkedNotes);
        onCorrected?.();
      }
    });

    modal.open();
  }

  addFeedbackButtons(
    container: HTMLElement,
    context: CorrectionContext
  ): { positive: HTMLButtonElement; negative: HTMLButtonElement } {
    const positiveBtn = container.createEl('button', {
      text: this.t('满意', 'Helpful'),
      cls: 'ai-rag-feedback-button'
    });
    const negativeBtn = container.createEl('button', {
      text: this.t('不满意', 'Not Helpful'),
      cls: 'ai-rag-feedback-button ai-rag-feedback-button-negative'
    });

    positiveBtn.addEventListener('click', () => {
      void this.recordFeedbackEvent(context, 1).then(() => {
        new Notice(this.t('已记录满意反馈', 'Positive feedback saved'));
      }, error => {
        console.error('Saving positive feedback failed:', error);
      });
    });

    negativeBtn.addEventListener('click', () => {
      void this.recordFeedbackEvent(context, -1).then((proposal) => {
        new Notice(this.t('已记录不满意反馈', 'Negative feedback saved'));
        if (proposal) {
          this.openTuningProposalModal(proposal);
        }
      }, error => {
        console.error('Saving negative feedback failed:', error);
      });
    });

    return { positive: positiveBtn, negative: negativeBtn };
  }

  async saveFeedback(
    question: string,
    wrongAnswer: string,
    correction: string,
    linkedNotes: string[]
  ) {
    const cleanLinkedNotes = Array.from(new Set(linkedNotes.map(path => path.trim()).filter(Boolean)));

    if (this.faqService) {
      await this.faqService.createFAQ(question, wrongAnswer, correction, cleanLinkedNotes);
      await this.plugin.feedbackTuningService?.markCorrected(question, wrongAnswer);
      return;
    }

    const feedbacksPath = `${this.basePath}/feedbacks.json`;
    const feedbacks = await this.readJSON<FeedbackEntry[]>(feedbacksPath) || [];

    let linkedContent = '';
    if (cleanLinkedNotes.length > 0) {
      const file = this.app.vault.getAbstractFileByPath(cleanLinkedNotes[0]);
      if (file instanceof TFile) {
        linkedContent = await this.app.vault.read(file);
      }
    }

    const combinedText = `问题: ${question}\n正确答案: ${correction}\n相关内容: ${linkedContent}`;
    const embedding = await this.getEmbedding(combinedText);

    const feedback: FeedbackEntry = {
      id: Date.now().toString(),
      question,
      wrongAnswer,
      correction,
      linkedNotes: cleanLinkedNotes,
      timestamp: Date.now(),
      content: combinedText
    };

    feedbacks.push(feedback);
    await this.writeJSON(feedbacksPath, feedbacks);

    const embeddingsPath = `${this.basePath}/feedback-embeddings.json`;
    const embeddings = await this.readJSON<FeedbackEmbedding[]>(embeddingsPath) || [];
    embeddings.push({ id: feedback.id, embedding });
    await this.writeJSON(embeddingsPath, embeddings);
    await this.plugin.feedbackTuningService?.markCorrected(question, wrongAnswer);
  }

  async buildMetaIndex(progressCallback?: (current: number, total: number, file: string) => void) {
    const files = this.app.vault.getMarkdownFiles()
      .filter(file => !this.plugin.isInsideWiki(file.path));
    const metaNotes: MetaNote[] = [];
    const metaEmbeddings: MetaEmbedding[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      progressCallback?.(i + 1, files.length, file.path);

      const content = await this.app.vault.read(file);
      const sensitiveDecision = this.sensitivityService
        ? await this.sensitivityService.decide(file.path, content)
        : 'process';

      if (sensitiveDecision === 'skip') {
        continue;
      }

      if (sensitiveDecision === 'private') {
        await this.sensitivityService?.markPrivate(file.path);
        await this.plugin.wikiIngestStateService?.markPrivate(file);
        metaNotes.push({
          path: file.path,
          summary: '私密笔记，正文未发送给 AI，未做正文向量化。',
          userRelation: '私密笔记',
          autoTags: ['private'],
          noteCategory: '私密',
          suggestedRelatedNotes: [],
          suggestedRelatedWikiPages: [],
          sourceWikiPath: null,
          isPrivate: true,
          mtime: file.stat.mtime
        });
        continue;
      }

      const meta = await this.generateMetadata(file.path, content);
      const metaText = `${meta.summary} ${meta.userRelation} ${meta.autoTags.join(' ')} ${meta.suggestedRelatedNotes.join(' ')} ${meta.suggestedRelatedWikiPages.join(' ')}`;
      const embedding = await this.getEmbedding(metaText);
      const sourceWikiPath = await this.getSourceWikiPath(file.path);

      metaNotes.push({
        path: file.path,
        ...meta,
        sourceWikiPath,
        mtime: file.stat.mtime
      });

      metaEmbeddings.push({
        path: file.path,
        embedding
      });

      await this.writeMetaWikiPage(file.path, { ...meta, sourceWikiPath }, file.stat.mtime);
    }

    await this.writeJSON(`${this.basePath}/meta-notes.json`, metaNotes);
    await this.writeJSON(`${this.basePath}/meta-embeddings.json`, metaEmbeddings);
    await this.writeRelationDocument(metaNotes);
  }

  async updateMetaForFile(filePath: string, options: UpdateMetaOptions = {}): Promise<MetaNote | null> {
    if (this.plugin.isInsideWiki(filePath)) {
      return null;
    }

    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile) || file.extension !== 'md') {
      return null;
    }

    const content = await this.app.vault.read(file);
    const promptSensitive = options.promptSensitive ?? true;
    const sensitiveDecision = this.sensitivityService
      ? promptSensitive
        ? await this.sensitivityService.decide(file.path, content)
        : this.sensitivityService.isSensitive(file.path, content)
          ? 'skip'
          : 'process'
      : 'process';

    const metaNotes = await this.readJSON<MetaNote[]>(`${this.basePath}/meta-notes.json`) || [];
    const metaEmbeddings = await this.readJSON<MetaEmbedding[]>(`${this.basePath}/meta-embeddings.json`) || [];
    const nextMetaNotes = metaNotes.filter(note => note.path !== file.path);
    const nextEmbeddings = metaEmbeddings.filter(item => item.path !== file.path);

    if (sensitiveDecision === 'skip') {
      await this.writeJSON(`${this.basePath}/meta-notes.json`, nextMetaNotes);
      await this.writeJSON(`${this.basePath}/meta-embeddings.json`, nextEmbeddings);
      await this.writeRelationDocument(nextMetaNotes);
      return null;
    }

    if (sensitiveDecision === 'private') {
      await this.sensitivityService?.markPrivate(file.path);
      await this.plugin.wikiIngestStateService?.markPrivate(file);
      nextMetaNotes.push({
        path: file.path,
        summary: '私密笔记，正文未发送给 AI，未做正文向量化。',
        userRelation: '私密笔记',
        autoTags: ['private'],
        noteCategory: '私密',
        suggestedRelatedNotes: [],
        suggestedRelatedWikiPages: [],
        sourceWikiPath: null,
        isPrivate: true,
        mtime: file.stat.mtime
      });
      await this.writeJSON(`${this.basePath}/meta-notes.json`, nextMetaNotes);
      await this.writeJSON(`${this.basePath}/meta-embeddings.json`, nextEmbeddings);
      await this.writeRelationDocument(nextMetaNotes);
      return nextMetaNotes.find(note => note.path === file.path) || null;
    }

    const meta = await this.generateMetadata(file.path, content);
    const metaText = `${meta.summary} ${meta.userRelation} ${meta.autoTags.join(' ')} ${meta.suggestedRelatedNotes.join(' ')} ${meta.suggestedRelatedWikiPages.join(' ')}`;
    const sourceWikiPath = await this.getSourceWikiPath(file.path);
    const metaNote = {
      path: file.path,
      ...meta,
      sourceWikiPath,
      mtime: file.stat.mtime
    };
    nextMetaNotes.push(metaNote);
    nextEmbeddings.push({
      path: file.path,
      embedding: await this.getEmbedding(metaText)
    });

    await this.writeMetaWikiPage(file.path, { ...meta, sourceWikiPath }, file.stat.mtime);
    await this.writeJSON(`${this.basePath}/meta-notes.json`, nextMetaNotes);
    await this.writeJSON(`${this.basePath}/meta-embeddings.json`, nextEmbeddings);
    await this.writeRelationDocument(nextMetaNotes);
    return metaNote;
  }

  private async generateMetadata(path: string, content: string): Promise<Omit<MetaNote, 'path' | 'mtime'>> {
    const candidateNotes = this.findSuggestedRawNotes(path);
    const candidateWikiPages = await this.findSuggestedWikiPages(path, content);
    const prompt = `分析这篇笔记并返回 JSON。

标题：${path}
内容：${content.substring(0, 2200)}

候选关联笔记：
${candidateNotes.length > 0 ? candidateNotes.map(note => `- ${note}`).join('\n') : '- 暂无'}

候选 Wiki 页面：
${candidateWikiPages.length > 0 ? candidateWikiPages.join('\n') : '- 暂无'}

返回格式：
{
  "summary": "一句话总结这篇笔记的核心内容",
  "userRelation": "这是用户的什么（如：服务器配置/灵感记录/小说笔记/方法论等）",
  "autoTags": ["标签1", "标签2", "标签3"],
  "noteCategory": "笔记分类",
  "suggestedRelatedNotes": ["从候选关联笔记中选择最相关的原始笔记路径"],
  "suggestedRelatedWikiPages": ["从候选 Wiki 页面中选择最相关的路径"]
}`;

    const response = await this.callLLM(prompt);
    try {
      const parsed = JSON.parse(response);
      return {
        summary: parsed.summary || '无法生成摘要',
        userRelation: parsed.userRelation || '未知',
        autoTags: Array.isArray(parsed.autoTags) ? parsed.autoTags : [],
        noteCategory: parsed.noteCategory || '未分类',
        suggestedRelatedNotes: Array.isArray(parsed.suggestedRelatedNotes) ? parsed.suggestedRelatedNotes : [],
        suggestedRelatedWikiPages: Array.isArray(parsed.suggestedRelatedWikiPages) ? parsed.suggestedRelatedWikiPages : []
      };
    } catch {
      return {
        summary: '无法生成摘要',
        userRelation: '未知',
        autoTags: [],
        noteCategory: '未分类',
        suggestedRelatedNotes: candidateNotes.slice(0, 3),
        suggestedRelatedWikiPages: candidateWikiPages.slice(0, 3).map(line => line.replace(/^- /, '').split(' | ')[0])
      };
    }
  }

  private async writeMetaWikiPage(
    path: string,
    meta: Omit<MetaNote, 'path' | 'mtime'>,
    mtime: number
  ): Promise<string | null> {
    if (!this.plugin.wikiService) {
      return null;
    }

    const title = `Meta - ${path.split('/').pop()?.replace(/\.md$/i, '') || path}`;
    const relatedTags = meta.autoTags.map(tag => `#${tag.replace(/\s+/g, '-')}`).join(' ');
    const relatedNotes = meta.suggestedRelatedNotes.length > 0
      ? meta.suggestedRelatedNotes.map(note => `- [[${note}]]`).join('\n')
      : '- 暂无';
    const relatedWikiPages = meta.suggestedRelatedWikiPages.length > 0
      ? meta.suggestedRelatedWikiPages.map(page => `- [[${page}]]`).join('\n')
      : '- 暂无';
    const sourcePage = meta.sourceWikiPath ? `- [[${meta.sourceWikiPath}]]` : '- 暂无';

    const content = `## 这页写什么
${meta.summary}

## 和用户的关联
${meta.userRelation}

## 分类
${meta.noteCategory}

## 自动标签
${relatedTags || '无'}

## 原始笔记
- [[${path}]]

## 对应 Source 页面
${sourcePage}

## 建议关联笔记
${relatedNotes}

## 建议关联 Wiki 页面
${relatedWikiPages}

## 更新时间
- ${new Date(mtime).toISOString()}
`;

    return await this.plugin.wikiService.createOrUpdatePage('meta', title, content, meta.noteCategory || 'Meta', 1);
  }

  private async writeRelationDocument(metaNotes: MetaNote[]): Promise<void> {
    if (!this.plugin.wikiService) {
      return;
    }

    let content = `## 笔记关系总览

本页由插件自动维护，用于查看原始笔记、对应 Source 页面、关联原始笔记和关联 Wiki 页面之间的关系。

| 原始笔记 | Source 页 | 关联原始笔记 | 关联 Wiki 页面 | 标签 | 分类 |
| --- | --- | --- | --- | --- | --- |
`;

    for (const note of metaNotes.sort((a, b) => a.path.localeCompare(b.path))) {
      const sourceLink = note.sourceWikiPath ? `[[${note.sourceWikiPath}]]` : '—';
      const rawNoteLinks = note.suggestedRelatedNotes.length > 0
        ? note.suggestedRelatedNotes.map(path => `[[${path}]]`).join('<br>')
        : '—';
      const wikiLinks = note.suggestedRelatedWikiPages.length > 0
        ? note.suggestedRelatedWikiPages.map(path => `[[${path}]]`).join('<br>')
        : '—';
      const tags = note.autoTags.length > 0
        ? note.autoTags.map(tag => `#${tag.replace(/\s+/g, '-')}`).join(' ')
        : '—';

      content += `| [[${note.path}]] | ${sourceLink} | ${rawNoteLinks} | ${wikiLinks} | ${tags} | ${note.noteCategory || '未分类'} |\n`;
    }

    await this.plugin.wikiService.createOrUpdatePage('relation', 'note-graph', content, '笔记关系', metaNotes.length);
  }

  async analyzeUserPattern(question: string) {
    await this.userPatternService.analyzeQuestion(question);
  }

  async detectTriggers(question: string): Promise<string[]> {
    return await this.userPatternService.detectTriggers(question);
  }

  async getUserPatternStats() {
    return await this.userPatternService.getStats();
  }

  async getFrequentTerms(limit = 10): Promise<string[]> {
    return await this.userPatternService.getFrequentTerms(limit);
  }

  private async recordFeedbackEvent(
    context: CorrectionContext,
    feedbackValue: 1 | -1
  ): Promise<TuningProposal | null> {
    if (!this.plugin.feedbackTuningService) {
      return null;
    }

    const event: FeedbackEvent = {
      id: `feedback-event-${Date.now()}`,
      question: context.question,
      answer: context.answer,
      sourceLayer: context.sourceLayer || 'hybrid',
      faqMatchCount: context.faqMatchCount || 0,
      wikiPageCount: context.wikiPageCount || context.wikiPages?.length || 0,
      vectorSourceCount: context.vectorSourceCount || context.citations.filter(citation => citation.sourceLayer === 'vector').length,
      timings: context.timings,
      feedbackValue,
      corrected: false,
      createdAt: Date.now()
    };

    const { proposal } = await this.plugin.feedbackTuningService.recordFeedback(event);
    return proposal || null;
  }

  private openTuningProposalModal(proposal: TuningProposal): void {
    const feedbackTuningService = this.plugin.feedbackTuningService;
    if (!feedbackTuningService) {
      return;
    }

    const modal = new TuningProposalModal(this.app, {
      proposal,
      language: this.plugin.settings.language,
      onApply: async () => {
        const result = await feedbackTuningService.applyProposal(proposal.id);
        return { reportPath: result.reportPath };
      },
      onDismiss: async () => {
        await feedbackTuningService.dismissProposal(proposal.id);
      }
    });
    modal.open();
  }

  private collectSuggestedNotes(context: CorrectionContext): string[] {
    const noteSet = new Set<string>();

    for (const citation of context.citations || []) {
      if (!this.plugin.isInsideWiki(citation.path) && /\.md$/i.test(citation.path)) {
        noteSet.add(citation.path);
      }
    }

    for (const note of context.suggestedLinkedNotes || []) {
      if (!this.plugin.isInsideWiki(note) && /\.md$/i.test(note)) {
        noteSet.add(note);
      }
    }

    for (const page of context.wikiPages || []) {
      for (const link of page.links || []) {
        const target = link.split('|')[0].trim().replace(/#.*$/, '');
        if (!this.plugin.isInsideWiki(target) && /\.md$/i.test(target)) {
          noteSet.add(target);
        }
      }
    }

    return Array.from(noteSet).slice(0, 8);
  }

  private searchNotes(query: string, preferred: string[] = []): string[] {
    const allNotes = this.app.vault.getMarkdownFiles()
      .map(file => file.path)
      .filter(path => !this.plugin.isInsideWiki(path));

    if (!query) {
      return Array.from(new Set(preferred.concat(allNotes))).slice(0, 12);
    }

    const lowerQuery = query.toLowerCase();
    const matched = allNotes
      .filter(path => path.toLowerCase().includes(lowerQuery))
      .sort((a, b) => a.length - b.length);

    return Array.from(new Set(preferred.concat(matched))).slice(0, 12);
  }

  private findSuggestedRawNotes(path: string): string[] {
    const files = this.app.vault.getMarkdownFiles()
      .map(file => file.path)
      .filter(candidate => candidate !== path && !this.plugin.isInsideWiki(candidate));
    const tokens = this.extractSearchTerms(path);

    return files
      .map(candidate => {
        const haystack = candidate.toLowerCase();
        const score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
        return { candidate, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map(item => item.candidate);
  }

  private async findSuggestedWikiPages(path: string, content: string): Promise<string[]> {
    if (!this.plugin.wikiService || !this.plugin.wikiService.isInitialized()) {
      return [];
    }

    const query = `${path.split('/').pop() || path} ${this.extractSearchTerms(content).slice(0, 5).join(' ')}`.trim();
    const pages = await this.plugin.wikiService.searchWiki(query);
    return pages.slice(0, 6).map(page => `- ${page.path} | ${page.title} | ${page.frontmatter.category}`);
  }

  private async getSourceWikiPath(path: string): Promise<string | null> {
    const entry = await this.plugin.wikiIngestStateService?.getEntry(path);
    return entry?.sourceWikiPath || null;
  }

  private extractSearchTerms(content: string): string[] {
    return Array.from(new Set(
      content.toLowerCase().match(/[\u4e00-\u9fff]{2,}|[a-z0-9][a-z0-9._-]{1,}/g) || []
    )).slice(0, 12);
  }

  private async getEmbedding(text: string): Promise<number[]> {
    const settings = this.plugin.settings;
    const baseUrl = (settings.embeddingApiBaseUrl || settings.apiBaseUrl).replace(/\/$/, '');
    const apiKey = settings.embeddingApiKey || settings.apiKey;
    const httpClient = new OpenAiCompatibleHttpClient(baseUrl, apiKey);
    const embeddingClient = new OpenAiCompatibleEmbeddingClient(httpClient, settings.embeddingModel);
    return embeddingClient.embed(text);
  }

  private async callLLM(prompt: string): Promise<string> {
    const settings = this.plugin.settings;
    const httpClient = new OpenAiCompatibleHttpClient(settings.apiBaseUrl, settings.apiKey);
    const llmClient = new OpenAiCompatibleLlmClient(httpClient, settings.chatModel);
    return llmClient.chat([{ role: 'user', content: prompt }], 0.3);
  }

  private async readJSON<T>(path: string): Promise<T | null> {
    try {
      const content = await this.app.vault.adapter.read(path);
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private async writeJSON(path: string, data: unknown): Promise<void> {
    const parent = path.substring(0, path.lastIndexOf('/'));
    if (parent) {
      try {
        await this.app.vault.adapter.mkdir(parent);
      } catch {
        // ignore existing directory
      }
    }
    await this.app.vault.adapter.write(path, JSON.stringify(data, null, 2));
  }
}
