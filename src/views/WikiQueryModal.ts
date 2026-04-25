import {App, Modal, Notice, MarkdownRenderer, TFile, Component } from 'obsidian';
import { WikiBuilder } from '../services/WikiBuilder';
import { WikiService } from '../services/WikiService';

interface QueryHistory {
  question: string;
  timestamp: number;
  answer: string;
  sources: string[];
}

/**
 * WikiQueryModal - Wiki 查询弹窗（增强版）
 */
export class WikiQueryModal extends Modal {
  private wikiBuilder: WikiBuilder;
  private wikiService: WikiService;
  private onArchive?: (path: string) => void;
  private abortController?: AbortController;
  private queryHistory: QueryHistory[] = [];
  private readonly markdownRendererComponent = new Component();

  constructor(
    app: App,
    wikiBuilder: WikiBuilder,
    wikiService: WikiService,
    onArchive?: (path: string) => void
  ) {
    super(app);
    this.wikiBuilder = wikiBuilder;
    this.wikiService = wikiService;
    this.onArchive = onArchive;
    this.loadQueryHistory();
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('wiki-query-modal');
    this.markdownRendererComponent.load();

    // 标题
    contentEl.createEl('h2', { text: '知识库查询' });

    // 检查 Wiki 是否初始化
    if (!this.wikiService.isInitialized()) {
      this.showEmptyState(contentEl);
      return;
    }

    // 建议问题
    this.showSuggestions(contentEl);

    // 查询历史
    if (this.queryHistory.length > 0) {
      this.showHistory(contentEl);
    }

    // 输入框
    const inputContainer = contentEl.createDiv({ cls: 'wiki-query-input-container' });
    const input = inputContainer.createEl('textarea', {
      cls: 'wiki-query-input',
      attr: {
        placeholder: '输入你的问题... (Ctrl+Enter 搜索)',
        rows: '3'
      }
    });

    // 按钮容器
    const buttonContainer = contentEl.createDiv({ cls: 'wiki-query-buttons' });

    const searchButton = buttonContainer.createEl('button', {
      text: '🔍 搜索知识库',
      cls: 'mod-cta'
    });

    const cancelButton = buttonContainer.createEl('button', {
      text: '取消'
    });

    // 结果容器
    const resultContainer = contentEl.createDiv({ cls: 'wiki-query-result' });

    // 搜索按钮点击
    searchButton.addEventListener('click', () => {
      void this.performSearch(input, searchButton, buttonContainer, resultContainer);
    });

    // 取消按钮
    cancelButton.addEventListener('click', () => {
      this.close();
    });

    // 回车搜索
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        searchButton.click();
      } else if (e.key === 'Escape') {
        this.close();
      }
    });

    input.focus();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();

    // 取消正在进行的请求
    if (this.abortController) {
      this.abortController.abort();
    }
    this.markdownRendererComponent.unload();
  }

  /**
   * 显示空状态
   */
  private showEmptyState(contentEl: HTMLElement): void {
    const emptyState = contentEl.createDiv({ cls: 'wiki-empty-state' });
    emptyState.createEl('h3', { text: '📚 知识库还未初始化' });
    emptyState.createEl('p', { text: '点击下方按钮开始创建你的知识库' });

    const initButton = emptyState.createEl('button', {
      text: '🚀 初始化知识库',
      cls: 'mod-cta'
    });

    initButton.addEventListener('click', () => {
      initButton.disabled = true;
      initButton.textContent = '⏳ 初始化中...';

      void (async () => {
        try {
        await this.wikiService.initializeWikiStructure();
        new Notice('知识库初始化完成！');
        this.close();
        // 重新打开以显示正常界面
        new WikiQueryModal(this.app, this.wikiBuilder, this.wikiService, this.onArchive).open();
        } catch (error) {
        console.error('初始化失败:', error);
        new Notice('初始化失败');
        initButton.disabled = false;
        initButton.textContent = '🚀 初始化知识库';
        }
      })();
    });
  }

  /**
   * 显示建议问题
   */
  private showSuggestions(contentEl: HTMLElement): void {
    const suggestions = [
      '这个项目的主要技术栈是什么？',
      '如何配置开发环境？',
      '有哪些重要的概念需要了解？',
      '最近更新了什么内容？'
    ];

    const suggestionsContainer = contentEl.createDiv({ cls: 'wiki-suggestions' });
    suggestionsContainer.createEl('p', { text: '💡 试试这些问题：', cls: 'wiki-suggestions-title' });

    const chipsContainer = suggestionsContainer.createDiv({ cls: 'wiki-suggestion-chips' });

    for (const suggestion of suggestions) {
      const chip = chipsContainer.createEl('button', {
        text: suggestion,
        cls: 'wiki-suggestion-chip'
      });
      chip.addEventListener('click', () => {
        const input = this.contentEl.querySelector('.wiki-query-input') as HTMLTextAreaElement;
        if (input) {
          input.value = suggestion;
          const searchButton = this.contentEl.querySelector('.wiki-query-buttons button') as HTMLButtonElement;
          if (searchButton) {
            searchButton.click();
          }
        }
      });
    }
  }

  /**
   * 显示查询历史
   */
  private showHistory(contentEl: HTMLElement): void {
    const historyContainer = contentEl.createDiv({ cls: 'wiki-history' });
    const historyHeader = historyContainer.createDiv({ cls: 'wiki-history-header' });
    historyHeader.createEl('p', { text: '📜 最近查询：' });

    const clearButton = historyHeader.createEl('button', {
      text: '清空',
      cls: 'wiki-history-clear'
    });

    clearButton.addEventListener('click', () => {
      this.queryHistory = [];
      this.saveQueryHistory();
      historyContainer.remove();
      new Notice('已清空查询历史');
    });

    const historyList = historyContainer.createDiv({ cls: 'wiki-history-list' });

    // 只显示最近5条
    const recentHistory = this.queryHistory.slice(0, 5);

    for (const item of recentHistory) {
      const historyItem = historyList.createDiv({ cls: 'wiki-history-item' });
      historyItem.textContent = item.question;
      historyItem.addEventListener('click', () => {
        const input = this.contentEl.querySelector('.wiki-query-input') as HTMLTextAreaElement;
        if (input) {
          input.value = item.question;
        }
      });
    }
  }

  /**
   * 执行搜索
   */
  private async performSearch(
    input: HTMLTextAreaElement,
    searchButton: HTMLButtonElement,
    buttonContainer: HTMLElement,
    resultContainer: HTMLElement
  ): Promise<void> {
    const question = input.value.trim();
    if (!question) {
      new Notice('请输入问题');
      return;
    }

    // 创建 AbortController
    this.abortController = new AbortController();

    searchButton.disabled = true;
    searchButton.textContent = '⏳ 搜索中...';
    resultContainer.empty();

    // 添加取消按钮
    const cancelSearchButton = buttonContainer.createEl('button', {
      text: '❌ 取消',
      cls: 'wiki-cancel-button'
    });

    cancelSearchButton.addEventListener('click', () => {
      if (this.abortController) {
        this.abortController.abort();
        new Notice('已取消搜索');
      }
    });

    try {
      const result = await this.wikiBuilder.queryWiki(question);

      // 保存到历史
      this.saveToHistory(question, result.answer, result.sources);

      resultContainer.empty();

      // 显示答案
      await this.renderAnswer(resultContainer, question, result);

    } catch (error) {
      console.error('查询失败:', error);

      // 详细的错误提示
      let errorMsg = '查询失败，请重试';
      if (error instanceof Error) {
        if (error.message.includes('API key') || error.message.includes('401')) {
          errorMsg = '❌ API key 无效，请检查设置';
        } else if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
          errorMsg = '⏱️ 请求超时，请检查网络连接';
        } else if (error.message.includes('quota') || error.message.includes('429')) {
          errorMsg = '💳 API 配额已用完，请稍后再试';
        } else if (error.message.includes('network') || error.message.includes('ENOTFOUND')) {
          errorMsg = '🌐 网络连接失败，请检查网络';
        } else if (error.name === 'AbortError') {
          errorMsg = '已取消搜索';
        }
      }

      new Notice(errorMsg, 5000);

      const errorDiv = resultContainer.createDiv({ cls: 'wiki-error' });
      errorDiv.createEl('p', { text: errorMsg });

      // 添加重试按钮
      const retryButton = errorDiv.createEl('button', {
        text: '🔄 重试',
        cls: 'mod-cta'
      });

      retryButton.addEventListener('click', () => {
        void this.performSearch(input, searchButton, buttonContainer, resultContainer);
      });

    } finally {
      searchButton.disabled = false;
      searchButton.textContent = '🔍 搜索知识库';
      cancelSearchButton.remove();
      this.abortController = undefined;
    }
  }

  /**
   * 渲染答案
   */
  private async renderAnswer(
    resultContainer: HTMLElement,
    question: string,
    result: { answer: string; sources: string[]; shouldArchive: boolean }
  ): Promise<void> {
    // 答案区域
    const answerSection = resultContainer.createDiv({ cls: 'wiki-answer-section' });

    const answerHeader = answerSection.createDiv({ cls: 'wiki-answer-header' });
    answerHeader.createEl('h3', { text: '答案' });

    // 复制按钮
    const copyButton = answerHeader.createEl('button', {
      text: '📋 复制',
      cls: 'wiki-copy-button'
    });

    copyButton.addEventListener('click', () => {
      void navigator.clipboard.writeText(result.answer).then(() => {
        new Notice('已复制到剪贴板');
        copyButton.textContent = '✅ 已复制';
        activeWindow.setTimeout(() => {
          copyButton.textContent = '📋 复制';
        }, 2000);
      }, error => {
        console.error('复制失败:', error);
      });
    });

    const answerContent = answerSection.createDiv({ cls: 'wiki-answer-content' });

    // 使用 Obsidian 的 MarkdownRenderer
    await MarkdownRenderer.render(
      this.app,
      result.answer,
      answerContent,
      '',
      this.markdownRendererComponent
    );

    // 显示来源
    if (result.sources.length > 0) {
      const sourcesSection = resultContainer.createDiv({ cls: 'wiki-sources-section' });
      sourcesSection.createEl('h3', { text: '来源' });

      const sourcesList = sourcesSection.createEl('ul');
      for (const source of result.sources) {
        const li = sourcesList.createEl('li');

        // 只显示文件名，不显示完整路径
        const fileName = source.split('/').pop() || source;

        const link = li.createEl('a', {
          text: fileName,
          cls: 'wiki-source-link'
        });
        link.title = source; // 完整路径作为 tooltip
        link.addEventListener('click', () => {
          void this.app.workspace.openLinkText(source, '', false);
        });
      }
    }

    // 操作按钮
    const actionsContainer = resultContainer.createDiv({ cls: 'wiki-actions' });

    // 重新生成按钮
    const regenerateButton = actionsContainer.createEl('button', {
      text: '🔄 重新生成',
      cls: 'wiki-action-button'
    });

    regenerateButton.addEventListener('click', () => {
      const input = this.contentEl.querySelector('.wiki-query-input') as HTMLTextAreaElement;
      const searchButton = this.contentEl.querySelector('.wiki-query-buttons button') as HTMLButtonElement;
      const buttonContainer = this.contentEl.querySelector('.wiki-query-buttons') as HTMLElement;

      if (input && searchButton && buttonContainer) {
        void this.performSearch(input, searchButton, buttonContainer, resultContainer);
      }
    });

    // 归档按钮
    if (result.shouldArchive) {
      const archiveButton = actionsContainer.createEl('button', {
        text: '📝 归档',
        cls: 'mod-cta'
      });

      archiveButton.addEventListener('click', () => {
        archiveButton.disabled = true;
        archiveButton.textContent = '⏳ 归档中...';

        void (async () => {
          try {
          const path = await this.wikiBuilder.archiveQuery(
            question,
            result.answer,
            result.sources
          );

          new Notice('已归档到: ' + path);

          if (this.onArchive) {
            this.onArchive(path);
          }

          this.close();
          } catch (error) {
          console.error('归档失败:', error);
          new Notice('归档失败');
          archiveButton.disabled = false;
          archiveButton.textContent = '📝 归档';
          }
        })();
      });
    }

    // 图谱视图按钮
    const graphButton = actionsContainer.createEl('button', {
      text: '🗺️ 图谱',
      cls: 'wiki-action-button'
    });

    graphButton.addEventListener('click', () => {
      if (result.sources.length > 0) {
        const firstSource = result.sources[0];
        const file = this.app.vault.getAbstractFileByPath(firstSource);

        if (file instanceof TFile) {
          const appWithCommands = this.app as App & {
            commands?: { executeCommandById: (id: string) => unknown };
          };
          void this.app.workspace.getLeaf(false).openFile(file).then(() => {
            appWithCommands.commands?.executeCommandById('graph:open-local');
          }, error => {
            console.error('打开图谱失败:', error);
          });
        } else {
          new Notice('无法打开文件');
        }
      } else {
        new Notice('没有可用的来源页面');
      }
    });
  }

  /**
   * 加载查询历史
   */
  private loadQueryHistory(): void {
    try {
      const stored = this.app.loadLocalStorage('wiki-query-history') as QueryHistory[] | null;
      if (Array.isArray(stored)) {
        this.queryHistory = stored;
      }
    } catch (error) {
      console.error('加载查询历史失败:', error);
      this.queryHistory = [];
    }
  }

  /**
   * 保存查询历史
   */
  private saveQueryHistory(): void {
    try {
      this.app.saveLocalStorage('wiki-query-history', this.queryHistory);
    } catch (error) {
      console.error('保存查询历史失败:', error);
    }
  }

  /**
   * 保存到历史
   */
  private saveToHistory(question: string, answer: string, sources: string[]): void {
    const historyItem: QueryHistory = {
      question,
      timestamp: Date.now(),
      answer,
      sources
    };

    // 添加到开头
    this.queryHistory.unshift(historyItem);

    // 只保留最近50条
    if (this.queryHistory.length > 50) {
      this.queryHistory = this.queryHistory.slice(0, 50);
    }

    this.saveQueryHistory();
  }
}
