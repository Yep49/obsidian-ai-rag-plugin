import { App, Modal, Notice } from 'obsidian';
import { SearchResult } from '../types/index';
import { Retriever } from '../services/Retriever';

export class SearchModal extends Modal {
  retriever: Retriever;
  onSelect: (result: SearchResult) => void;
  private inputEl!: HTMLTextAreaElement;
  private resultsEl!: HTMLElement;

  constructor(app: App, retriever: Retriever, onSelect: (result: SearchResult) => void) {
    super(app);
    this.retriever = retriever;
    this.onSelect = onSelect;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('ai-rag-modal');

    contentEl.createEl('h2', { text: '语义搜索' });

    // 输入区域
    const inputPanel = contentEl.createDiv({ cls: 'ai-rag-panel' });
    this.inputEl = inputPanel.createEl('textarea', {
      placeholder: '输入搜索关键词或问题...'
    });
    this.inputEl.style.width = '100%';
    this.inputEl.style.minHeight = '80px';
    this.inputEl.style.marginBottom = '10px';

    const searchBtn = inputPanel.createEl('button', { text: '搜索' });
    searchBtn.addEventListener('click', () => this.performSearch());

    // 结果区域
    this.resultsEl = contentEl.createDiv({ cls: 'ai-rag-panel' });
    this.resultsEl.createDiv({
      cls: 'ai-rag-empty-state',
      text: '输入关键词开始搜索'
    });
  }

  async performSearch() {
    const query = this.inputEl.value.trim();
    if (!query) {
      new Notice('请输入搜索内容');
      return;
    }

    this.resultsEl.empty();
    this.resultsEl.createDiv({
      cls: 'ai-rag-loading',
      text: '搜索中...'
    });

    try {
      const results = await this.retriever.search(query);

      this.resultsEl.empty();

      if (results.length === 0) {
        this.resultsEl.createDiv({
          cls: 'ai-rag-empty-state',
          text: '未找到相关结果'
        });
        return;
      }

      const resultList = this.resultsEl.createDiv({ cls: 'ai-rag-result-list' });

      results.forEach((result, index) => {
        const card = resultList.createDiv({ cls: 'ai-rag-result-card' });

        // 标题和分数
        const header = card.createDiv();
        header.createEl('strong', { text: `${index + 1}. ${result.chunk.title}` });
        header.createEl('span', {
          text: ` (${result.score.toFixed(3)})`,
          cls: 'ai-rag-score'
        });

        // 路径
        if (result.chunk.sectionPath) {
          card.createDiv({
            text: result.chunk.sectionPath,
            cls: 'ai-rag-muted'
          });
        }

        // 内容片段
        const snippet = card.createDiv({ cls: 'ai-rag-snippet' });
        snippet.setText(result.snippet || result.chunk.content.slice(0, 200));

        // 位置信息
        const location = card.createDiv({ cls: 'ai-rag-location' });
        location.setText(`${result.chunk.path}:${result.chunk.startLine}`);

        // 点击打开
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => {
          this.onSelect(result);
          this.close();
        });
      });

    } catch (error) {
      console.error('Search error:', error);
      this.resultsEl.empty();
      this.resultsEl.createDiv({
        cls: 'ai-rag-error-state',
        text: `搜索失败: ${error}`
      });
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
