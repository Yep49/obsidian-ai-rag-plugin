import { App, Modal, Notice } from 'obsidian';
import { LinkSuggestion } from '../types/index';

interface LinkSuggestionModalOptions {
  sourcePath: string;
  suggestions: LinkSuggestion[];
  language?: 'zh-CN' | 'en';
  onApply: (targetPaths: string[]) => Promise<void>;
}

export class LinkSuggestionModal extends Modal {
  private options: LinkSuggestionModalOptions;
  private selected = new Set<string>();

  constructor(app: App, options: LinkSuggestionModalOptions) {
    super(app);
    this.options = options;
    options.suggestions.forEach(item => this.selected.add(item.targetPath));
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('ai-rag-link-modal');
    const t = (zh: string, en: string) => this.options.language === 'en' ? en : zh;

    contentEl.createEl('h3', { text: t('发现可关联笔记', 'Suggested related notes') });
    contentEl.createEl('p', { text: `${t('当前笔记', 'Current note')}: ${this.options.sourcePath}` });

    const list = contentEl.createDiv({ cls: 'ai-rag-link-suggestion-list' });
    this.options.suggestions.forEach(item => {
      const row = list.createDiv({ cls: 'ai-rag-link-suggestion-row' });
      const checkbox = row.createEl('input', { type: 'checkbox' });
      checkbox.checked = true;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          this.selected.add(item.targetPath);
        } else {
          this.selected.delete(item.targetPath);
        }
      });

      const body = row.createDiv({ cls: 'ai-rag-link-suggestion-body' });
      body.createEl('strong', { text: item.targetPath });
      body.createDiv({ cls: 'ai-rag-muted', text: `${item.reason} · ${t('分数', 'score')} ${item.score.toFixed(2)}` });
    });

    const actions = contentEl.createDiv({ cls: 'ai-rag-correction-actions' });
    const laterBtn = actions.createEl('button', { text: t('稍后', 'Later') });
    const selectedBtn = actions.createEl('button', { text: t('关联选中项', 'Link selected') });
    const allBtn = actions.createEl('button', { text: t('一键关联全部', 'Link all'), cls: 'mod-cta' });

    laterBtn.addEventListener('click', () => this.close());

    selectedBtn.addEventListener('click', () => {
      const targets = Array.from(this.selected);
      if (targets.length === 0) {
        new Notice(t('请先至少选择一条关联笔记', 'Please select at least one suggested note'));
        return;
      }
      void this.apply(targets);
    });

    allBtn.addEventListener('click', () => {
      void this.apply(this.options.suggestions.map(item => item.targetPath));
    });
  }

  onClose() {
    this.contentEl.empty();
  }

  private async apply(targetPaths: string[]) {
    const t = (zh: string, en: string) => this.options.language === 'en' ? en : zh;
    try {
      await this.options.onApply(targetPaths);
      new Notice(t('已应用双向链接', 'Bidirectional links applied'));
      this.close();
    } catch (error) {
      console.error('应用双向链接失败:', error);
      new Notice(t(`应用双向链接失败: ${error instanceof Error ? error.message : String(error)}`, `Applying bidirectional links failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  }
}
