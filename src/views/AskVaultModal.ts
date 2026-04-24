import { App, Modal, Notice, MarkdownRenderer } from 'obsidian';
import { Citation, CorrectionContext } from '../types/index';
import { RagChatService } from '../services/RagChatService';
import { EnhancementService } from '../services/EnhancementService';
import AiRagPlugin from '../main';

export class AskVaultModal extends Modal {
  plugin: AiRagPlugin;
  ragChat: RagChatService;
  enhancementService: EnhancementService;
  onCitationClick: (citation: Citation) => void;
  private inputEl!: HTMLTextAreaElement;
  private answerContainerEl!: HTMLElement;

  constructor(
    app: App,
    plugin: AiRagPlugin,
    ragChat: RagChatService,
    enhancementService: EnhancementService,
    onCitationClick: (citation: Citation) => void
  ) {
    super(app);
    this.plugin = plugin;
    this.ragChat = ragChat;
    this.enhancementService = enhancementService;
    this.onCitationClick = onCitationClick;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('ai-rag-modal');

    contentEl.createEl('h2', { text: this.plugin.t('知识库提问', 'Ask vault') });

    const inputPanel = contentEl.createDiv({ cls: 'ai-rag-panel' });
    this.inputEl = inputPanel.createEl('textarea', {
      placeholder: this.plugin.t('向你的知识库提问...', 'Ask your vault...')
    });
    this.inputEl.addClass('ai-rag-input');

    this.inputEl.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void this.performAsk();
      }
    });

    const askBtn = inputPanel.createEl('button', { text: this.plugin.t('发送', 'Send'), cls: 'mod-cta' });
    askBtn.addEventListener('click', () => void this.performAsk());

    this.answerContainerEl = contentEl.createDiv({ cls: 'ai-rag-panel' });
    this.answerContainerEl.createDiv({
      cls: 'ai-rag-empty-state',
      text: this.plugin.t('输入问题开始提问', 'Ask a question to get started')
    });
  }

  async performAsk() {
    const question = this.inputEl.value.trim();
    if (!question) {
      new Notice(this.plugin.t('请输入问题', 'Please enter a question'));
      return;
    }

    this.answerContainerEl.empty();
    this.answerContainerEl.createDiv({
      cls: 'ai-rag-loading',
      text: this.plugin.t('思考中...', 'Thinking...')
    });

    try {
      const result = await this.ragChat.ask(question);
      this.answerContainerEl.empty();

      const answerDiv = this.answerContainerEl.createDiv({ cls: 'ai-rag-answer-container' });
      const header = answerDiv.createDiv({ cls: 'ai-rag-answer-header' });
      const actions = header.createDiv({ cls: 'ai-rag-answer-actions' });

      this.enhancementService.addCopyButton(actions, result.answer);
      const correctionContext: CorrectionContext = {
        question,
        answer: result.answer,
        sourceLayer: result.sourceLayer,
        faqMatchCount: result.faqMatches?.length || 0,
        wikiPageCount: result.wikiPages?.length || 0,
        vectorSourceCount: result.vectorSources?.length || 0,
        citations: result.citations,
        wikiPages: result.wikiPages || [],
        suggestedLinkedNotes: result.suggestedLinkedNotes || [],
        timings: result.timings
      };
      this.enhancementService.addCorrectionButton(actions, correctionContext, () => {
        new Notice(this.plugin.t('感谢反馈，下次类似问题会优先走 FAQ', 'Thanks. Similar questions will prefer FAQ next time.'));
      });
      this.enhancementService.addFeedbackButtons(actions, correctionContext);

      header.createDiv({
        cls: 'ai-rag-source-chip',
        text: result.sourceLayer === 'faq'
          ? this.plugin.t('FAQ 直答', 'FAQ direct answer')
          : this.plugin.t('FAQ + wiki + 向量', 'FAQ + wiki + vector')
      });

      const timings = result.timings;
      if (timings) {
        answerDiv.createDiv({
          cls: 'ai-rag-muted ai-rag-timings',
          text: this.plugin.t(
            `FAQ ${timings.faq.toFixed(0)}ms · wiki ${timings.wiki.toFixed(0)}ms · 向量 ${timings.vector.toFixed(0)}ms · LLM ${timings.llm.toFixed(0)}ms · 总计 ${timings.total.toFixed(0)}ms`,
            `FAQ ${timings.faq.toFixed(0)}ms · wiki ${timings.wiki.toFixed(0)}ms · vector ${timings.vector.toFixed(0)}ms · LLM ${timings.llm.toFixed(0)}ms · total ${timings.total.toFixed(0)}ms`
          )
        });
      }

      const answerText = answerDiv.createDiv({ cls: 'ai-rag-answer-text markdown-rendered' });
      await MarkdownRenderer.render(this.app, result.answer, answerText, '', this.plugin);

      if (result.citations.length > 0) {
        this.renderCitations(answerDiv, result.citations);
      }

      await this.enhancementService.analyzeUserPattern(question);
    } catch (error) {
      console.error('Ask error:', error);
      this.answerContainerEl.empty();
      this.answerContainerEl.createDiv({
        cls: 'ai-rag-error-state',
        text: this.plugin.t(`提问失败: ${error}`, `Ask failed: ${error}`)
      });
    }
  }

  private renderCitations(container: HTMLElement, citations: Citation[]): void {
    const citationsDiv = container.createDiv({ cls: 'ai-rag-citation-list' });
    citationsDiv.createEl('h4', { text: this.plugin.t('引用来源', 'Sources') });

    const groups: Array<{ title: string; items: Citation[] }> = [
      { title: 'FAQ', items: citations.filter(citation => citation.sourceLayer === 'faq') },
      { title: 'wiki', items: citations.filter(citation => citation.sourceLayer === 'wiki') },
      { title: this.plugin.t('向量', 'vector'), items: citations.filter(citation => citation.sourceLayer === 'vector') }
    ];

    for (const group of groups) {
      if (group.items.length === 0) {
        continue;
      }

      const groupEl = citationsDiv.createDiv({ cls: 'ai-rag-citation-group' });
      groupEl.createDiv({ cls: 'ai-rag-citation-group-title', text: group.title });

      group.items.forEach((citation, index) => {
        const citationCard = groupEl.createDiv({ cls: 'ai-rag-citation' });
        const citationHeader = citationCard.createDiv({ cls: 'ai-rag-citation-header' });
        citationHeader.createEl('strong', { text: `[${index + 1}] ${citation.title}` });
        citationHeader.createDiv({ cls: 'ai-rag-muted', text: citation.sectionPath });

        const snippet = citationCard.createDiv({ cls: 'ai-rag-snippet' });
        snippet.setText(citation.snippet);

        const location = citationCard.createDiv({ cls: 'ai-rag-location' });
        location.setText(`${citation.path}${citation.startLine ? `:${citation.startLine}` : ''}`);

        citationCard.addEventListener('click', () => {
          this.onCitationClick(citation);
        });
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
