import { App, Modal, Notice } from 'obsidian';

interface CorrectionModalOptions {
  question: string;
  wrongAnswer: string;
  initialSuggestions: string[];
  language?: 'zh-CN' | 'en';
  searchNotes: (query: string) => string[];
  onSubmit: (correction: string, linkedNotes: string[]) => Promise<void>;
}

export class CorrectionModal extends Modal {
  private options: CorrectionModalOptions;
  private selectedNotes = new Set<string>();
  private correctionEl!: HTMLTextAreaElement;
  private searchEl!: HTMLInputElement;
  private selectedContainer!: HTMLElement;
  private suggestionsContainer!: HTMLElement;

  constructor(app: App, options: CorrectionModalOptions) {
    super(app);
    this.options = options;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('ai-rag-correction-modal');
    const t = (zh: string, en: string) => this.options.language === 'en' ? en : zh;

    contentEl.createEl('h3', { text: t('纠正答案', 'Correct answer') });
    contentEl.createEl('p', { text: `${t('原问题', 'Question')}: ${this.options.question}`, cls: 'ai-rag-correction-question' });

    this.correctionEl = contentEl.createEl('textarea', {
      cls: 'ai-rag-correction-textarea',
      attr: {
        placeholder: t('输入正确答案...', 'Enter the corrected answer...')
      }
    });

    contentEl.createEl('p', { text: t('关联笔记（可选）', 'Linked notes (optional)'), cls: 'ai-rag-correction-label' });
    this.searchEl = contentEl.createEl('input', {
      cls: 'ai-rag-correction-search',
      type: 'text',
      attr: {
        placeholder: t('搜索笔记路径或文件名', 'Search note paths or filenames')
      }
    });

    this.selectedContainer = contentEl.createDiv({ cls: 'ai-rag-correction-selected' });
    this.suggestionsContainer = contentEl.createDiv({ cls: 'ai-rag-correction-suggestions' });

    this.renderSelectedNotes();
    this.renderSuggestions('');

    this.searchEl.addEventListener('input', () => {
      this.renderSuggestions(this.searchEl.value.trim());
    });

    this.searchEl.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        const firstSuggestion = this.options.searchNotes(this.searchEl.value.trim())[0];
        if (firstSuggestion) {
          this.selectedNotes.add(firstSuggestion);
          this.renderSelectedNotes();
          this.renderSuggestions(this.searchEl.value.trim());
          this.searchEl.value = '';
        }
      }
    });

    const actions = contentEl.createDiv({ cls: 'ai-rag-correction-actions' });
    const cancelBtn = actions.createEl('button', { text: t('取消', 'Cancel') });
    const submitBtn = actions.createEl('button', { text: t('保存到 FAQ', 'Save to FAQ'), cls: 'mod-cta' });

    cancelBtn.addEventListener('click', () => this.close());
    submitBtn.addEventListener('click', () => {
      const correction = this.correctionEl.value.trim();
      if (!correction) {
        new Notice(t('请输入正确答案', 'Please enter the corrected answer'));
        return;
      }

      submitBtn.disabled = true;
      submitBtn.setText(t('保存中...', 'Saving...'));

      void (async () => {
        try {
        await this.options.onSubmit(correction, Array.from(this.selectedNotes));
        new Notice(t('已加入 FAQ，下次同类问题会优先直答', 'Added to FAQ. Similar questions will prefer direct FAQ answers.'));
        this.close();
        } catch (error) {
        console.error('保存 FAQ 失败:', error);
        new Notice(t(`保存 FAQ 失败: ${error instanceof Error ? error.message : String(error)}`, `Saving FAQ failed: ${error instanceof Error ? error.message : String(error)}`));
        submitBtn.disabled = false;
        submitBtn.setText(t('保存到 FAQ', 'Save to FAQ'));
        }
      })();
    });

    this.correctionEl.focus();
  }

  onClose() {
    this.contentEl.empty();
  }

  private renderSelectedNotes() {
    this.selectedContainer.empty();
    const t = (zh: string, en: string) => this.options.language === 'en' ? en : zh;
    if (this.selectedNotes.size === 0) {
      this.selectedContainer.createDiv({
        cls: 'ai-rag-correction-empty',
        text: t('还没有选择关联笔记', 'No linked notes selected yet')
      });
      return;
    }

    for (const note of this.selectedNotes) {
      const chip = this.selectedContainer.createDiv({ cls: 'ai-rag-correction-chip' });
      chip.createSpan({ text: note });
      const removeBtn = chip.createEl('button', { text: '×' });
      removeBtn.addEventListener('click', () => {
        this.selectedNotes.delete(note);
        this.renderSelectedNotes();
      });
    }
  }

  private renderSuggestions(query: string) {
    this.suggestionsContainer.empty();
    const t = (zh: string, en: string) => this.options.language === 'en' ? en : zh;
    const title = this.suggestionsContainer.createDiv({
      cls: 'ai-rag-correction-label',
      text: query ? t('搜索结果', 'Search results') : t('建议关联笔记', 'Suggested linked notes')
    });
    title.setAttr('data-role', 'label');

    const suggestions = this.options.searchNotes(query).filter(note => !this.selectedNotes.has(note)).slice(0, 10);
    if (suggestions.length === 0) {
      this.suggestionsContainer.createDiv({
        cls: 'ai-rag-correction-empty',
        text: t('没有更多可选笔记', 'No more notes to choose from')
      });
      return;
    }

    const list = this.suggestionsContainer.createDiv({ cls: 'ai-rag-correction-suggestion-list' });
    for (const note of suggestions) {
      const btn = list.createEl('button', {
        text: note,
        cls: 'ai-rag-correction-suggestion'
      });
      btn.addEventListener('click', () => {
        this.selectedNotes.add(note);
        this.renderSelectedNotes();
        this.renderSuggestions(this.searchEl.value.trim());
      });
    }
  }
}
