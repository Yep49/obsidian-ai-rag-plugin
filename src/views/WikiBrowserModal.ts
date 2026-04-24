import { App, Modal, Setting } from 'obsidian';
import { WikiService } from '../services/WikiService';
import { WikiPage, WikiPageType } from '../types/index';

/**
 * WikiBrowserModal - Wiki 浏览器界面
 * 支持浏览、筛选、排序所有 Wiki 页面
 */
export class WikiBrowserModal extends Modal {
  private wikiService: WikiService;
  private onOpenPage: (path: string) => void;
  private pages: WikiPage[] = [];
  private filteredPages: WikiPage[] = [];
  private currentFilter: WikiPageType | 'all' = 'all';
  private currentSort: 'title' | 'updated' | 'sources' = 'updated';
  private searchQuery: string = '';

  constructor(
    app: App,
    wikiService: WikiService,
    onOpenPage: (path: string) => void
  ) {
    super(app);
    this.wikiService = wikiService;
    this.onOpenPage = onOpenPage;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('wiki-browser-modal');

    contentEl.createEl('h2', { text: 'wiki 浏览器' });

    // 加载页面
    await this.loadPages();

    // 创建控制栏
    this.createControls(contentEl);

    // 创建统计信息
    this.createStats(contentEl);

    // 创建页面列表
    this.createPageList(contentEl);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  /**
   * 加载所有页面
   */
  private async loadPages() {
    this.pages = await this.wikiService.getAllPages();
    this.applyFilters();
  }

  /**
   * 创建控制栏
   */
  private createControls(container: HTMLElement) {
    const controlsContainer = container.createDiv({ cls: 'wiki-browser-controls' });

    // 搜索框
    const searchContainer = controlsContainer.createDiv({ cls: 'wiki-browser-search' });
    const searchInput = searchContainer.createEl('input', {
      type: 'text',
      placeholder: '搜索页面标题...',
      cls: 'wiki-browser-search-input'
    });

    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value.toLowerCase();
      this.applyFilters();
      this.refreshPageList();
    });

    // 筛选器
    const filterContainer = controlsContainer.createDiv({ cls: 'wiki-browser-filters' });

    new Setting(filterContainer)
      .setName('类型筛选')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('all', '全部')
          .addOption('faq', 'FAQ')
          .addOption('meta', 'meta')
          .addOption('relation', '关系')
          .addOption('source', '来源')
          .addOption('entity', '实体')
          .addOption('concept', '概念')
          .addOption('summary', '摘要')
          .addOption('synthesis', '综合')
          .setValue(this.currentFilter)
          .onChange((value) => {
            this.currentFilter = value as WikiPageType | 'all';
            this.applyFilters();
            this.refreshPageList();
          });
      });

    new Setting(filterContainer)
      .setName('排序方式')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('updated', '最近更新')
          .addOption('title', '标题')
          .addOption('sources', '引用数')
          .setValue(this.currentSort)
          .onChange((value) => {
            this.currentSort = value as 'title' | 'updated' | 'sources';
            this.applyFilters();
            this.refreshPageList();
          });
      });
  }

  /**
   * 创建统计信息
   */
  private createStats(container: HTMLElement) {
    const statsContainer = container.createDiv({ cls: 'wiki-browser-stats' });

    const stats = {
      total: this.pages.length,
      faq: this.pages.filter(p => p.type === 'faq').length,
      meta: this.pages.filter(p => p.type === 'meta').length,
      relations: this.pages.filter(p => p.type === 'relation').length,
      sources: this.pages.filter(p => p.type === 'source').length,
      entities: this.pages.filter(p => p.type === 'entity').length,
      concepts: this.pages.filter(p => p.type === 'concept').length,
      summaries: this.pages.filter(p => p.type === 'summary').length,
      syntheses: this.pages.filter(p => p.type === 'synthesis').length
    };

    const statsGrid = statsContainer.createDiv({ cls: 'wiki-stats-grid' });
    const statItems = [
      ['总计', stats.total],
      ['FAQ', stats.faq],
      ['meta', stats.meta],
      ['关系', stats.relations],
      ['来源', stats.sources],
      ['实体', stats.entities],
      ['概念', stats.concepts],
      ['摘要', stats.summaries],
      ['综合', stats.syntheses]
    ] as const;

    for (const [label, value] of statItems) {
      const statItem = statsGrid.createDiv({ cls: 'wiki-stat-item' });
      statItem.createSpan({ cls: 'wiki-stat-label', text: label });
      statItem.createSpan({ cls: 'wiki-stat-value', text: String(value) });
    }
  }

  /**
   * 创建页面列表
   */
  private createPageList(container: HTMLElement) {
    const listContainer = container.createDiv({ cls: 'wiki-browser-list' });
    this.renderPageList(listContainer);
  }

  /**
   * 渲染页面列表
   */
  private renderPageList(container: HTMLElement) {
    container.empty();

    if (this.filteredPages.length === 0) {
      container.createDiv({
        cls: 'wiki-browser-empty',
        text: '没有找到匹配的页面'
      });
      return;
    }

    container.createDiv({
      cls: 'wiki-browser-count',
      text: `显示 ${this.filteredPages.length} 个页面`
    });

    for (const page of this.filteredPages) {
      const pageCard = container.createDiv({ cls: 'wiki-browser-card' });

      // 标题和类型
      const header = pageCard.createDiv({ cls: 'wiki-browser-card-header' });
      header.createEl('h3', { text: page.title });

      header.createEl('span', {
        cls: `wiki-browser-badge wiki-browser-badge-${page.type}`,
        text: this.getTypeLabel(page.type)
      });

      // 元信息
      const meta = pageCard.createDiv({ cls: 'wiki-browser-card-meta' });
      meta.createEl('span', {
        cls: 'wiki-browser-meta-item',
        text: `📅 ${page.frontmatter.updated}`
      });

      if (page.frontmatter.category) {
        meta.createEl('span', {
          cls: 'wiki-browser-meta-item',
          text: `🏷️ ${page.frontmatter.category}`
        });
      }

      meta.createEl('span', {
        cls: 'wiki-browser-meta-item',
        text: `🔗 ${page.frontmatter.sources || 0} 引用`
      });

      // 内容预览
      const preview = this.extractPreview(page.content);
      if (preview) {
        pageCard.createDiv({
          cls: 'wiki-browser-card-preview',
          text: preview
        });
      }

      // 操作按钮
      const actions = pageCard.createDiv({ cls: 'wiki-browser-card-actions' });

      const openBtn = actions.createEl('button', {
        text: '打开',
        cls: 'mod-cta'
      });

      openBtn.addEventListener('click', () => {
        this.onOpenPage(page.path);
        this.close();
      });

      const copyPathBtn = actions.createEl('button', {
        text: '复制路径'
      });

      copyPathBtn.addEventListener('click', () => {
        void navigator.clipboard.writeText(page.path).then(() => {
          copyPathBtn.textContent = '已复制！';
          setTimeout(() => {
            copyPathBtn.textContent = '复制路径';
          }, 2000);
        }, error => {
          console.error('复制路径失败:', error);
        });
      });
    }
  }

  /**
   * 应用筛选和排序
   */
  private applyFilters() {
    let filtered = [...this.pages];

    // 类型筛选
    if (this.currentFilter !== 'all') {
      filtered = filtered.filter(p => p.type === this.currentFilter);
    }

    // 搜索筛选
    if (this.searchQuery) {
      filtered = filtered.filter(p =>
        p.title.toLowerCase().includes(this.searchQuery) ||
        p.content.toLowerCase().includes(this.searchQuery)
      );
    }

    // 排序
    filtered.sort((a, b) => {
      switch (this.currentSort) {
        case 'title':
          return a.title.localeCompare(b.title);
        case 'updated':
          return b.frontmatter.updated.localeCompare(a.frontmatter.updated);
        case 'sources':
          return (b.frontmatter.sources || 0) - (a.frontmatter.sources || 0);
        default:
          return 0;
      }
    });

    this.filteredPages = filtered;
  }

  /**
   * 刷新页面列表
   */
  private refreshPageList() {
    const listContainer = this.contentEl.querySelector('.wiki-browser-list');
    if (listContainer) {
      this.renderPageList(listContainer as HTMLElement);
    }
  }

  /**
   * 获取类型标签
   */
  private getTypeLabel(type: WikiPageType): string {
    const labels: Record<WikiPageType, string> = {
      faq: 'FAQ',
      meta: 'meta',
      relation: '关系',
      source: '来源',
      entity: '实体',
      concept: '概念',
      summary: '摘要',
      synthesis: '综合'
    };
    return labels[type] || type;
  }

  /**
   * 提取内容预览
   */
  private extractPreview(content: string): string {
    // 移除 frontmatter
    const withoutFm = content.replace(/^---[\s\S]*?---\n/, '');
    // 移除标题
    const withoutTitle = withoutFm.replace(/^#\s+.+\n/, '');
    // 提取第一段
    const paragraphs = withoutTitle.split('\n\n');
    const firstParagraph = paragraphs.find(p => p.trim().length > 0) || '';
    // 限制长度
    return firstParagraph.substring(0, 150).trim() + (firstParagraph.length > 150 ? '...' : '');
  }
}
