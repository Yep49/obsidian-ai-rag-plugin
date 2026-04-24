import { Plugin, Notice, TFile, TAbstractFile, MarkdownView, Modal } from 'obsidian';
import { PluginSettings, Citation, MetaNote, SearchResult } from './types/index';
import { AiRagSettingTab } from './views/SettingTab';
import { AiRagSidebarView, AI_RAG_SIDEBAR_VIEW } from './views/SidebarView';
import { SearchModal } from './views/SearchModal';
import { AskVaultModal } from './views/AskVaultModal';
import { IndexBuildProgressModal } from './views/IndexBuildProgressModal';
import { WikiQueryModal } from './views/WikiQueryModal';
import { WikiIngestProgressModal } from './views/WikiIngestProgressModal';
import { WikiBrowserModal } from './views/WikiBrowserModal';
import { IndexBuilder } from './services/IndexBuilder';
import { Retriever, VectorSearchService, LexicalSearchService } from './services/Retriever';
import { RagChatService } from './services/RagChatService';
import { IndexScheduler } from './services/IndexScheduler';
import { EnhancementService } from './services/EnhancementService';
import { WikiService } from './services/WikiService';
import { WikiBuilder } from './services/WikiBuilder';
import { FAQService } from './services/FAQService';
import { WikiGraphSearchService } from './services/WikiGraphSearchService';
import { SensitivityService } from './services/SensitivityService';
import { WikiIngestStateService } from './services/WikiIngestStateService';
import { FeedbackTuningService } from './services/FeedbackTuningService';
import { NoteLinkService } from './services/NoteLinkService';
import { ObsidianVaultScanner } from './services/DocumentProcessing';
import { OpenAiCompatibleHttpClient, OpenAiCompatibleEmbeddingClient, OpenAiCompatibleLlmClient } from './services/ApiClients';
import { ObsidianJsonFileAdapter, JsonIndexManifestStore, JsonMetadataStore, JsonVectorStore } from './services/Storage';
import { QueryAnalysisService } from './services/QueryAnalysisService';
import { LlmRerankService } from './services/RerankService';
import { ContextCompressionService } from './services/ContextCompressionService';
import { FeedbackRecallService } from './services/FeedbackRecallService';
import { MetaRecallService } from './services/MetaRecallService';
import { UserPatternService } from './services/UserPatternService';
import { LoggingService } from './services/LoggingService';
import { LinkSuggestionModal } from './views/LinkSuggestionModal';

const DEFAULT_SETTINGS: PluginSettings = {
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  chatModel: 'gpt-3.5-turbo',
  embeddingModel: 'text-embedding-ada-002',
  provider: 'openai-compatible',
  chunkSize: 800,
  overlap: 150,
  topK: 6,
  enableHybridSearch: true,
  autoIndexOnFileChange: false,
  maxContextChars: 6000,
  language: 'zh-CN',
  embeddingApiBaseUrl: '',
  embeddingApiKey: '',
  maxFileChars: 8000,
  // Wiki 默认设置
  enableWiki: true,
  wikiPath: '_wiki',
  wikiAutoIngest: false,
  wikiPriority: 2,
  faqStrongMatchThreshold: 0.88,
  wikiContextRatio: 0.35,
  vectorContextRatio: 0.35,
  answerTemplate: 'structured'
};

export default class AiRagPlugin extends Plugin {
  settings!: PluginSettings;
  indexBuilder!: IndexBuilder;
  retriever!: Retriever;
  ragChat!: RagChatService;
  indexScheduler!: IndexScheduler;
  enhancementService!: EnhancementService;
  wikiService?: WikiService;
  wikiBuilder?: WikiBuilder;
  faqService?: FAQService;
  wikiGraphSearch?: WikiGraphSearchService;
  sensitivityService?: SensitivityService;
  wikiIngestStateService?: WikiIngestStateService;
  feedbackTuningService!: FeedbackTuningService;
  noteLinkService!: NoteLinkService;

  private schedulerBound = false;
  private indexBuildInProgress = false;
  private indexBuildModal?: IndexBuildProgressModal;
  private wikiAutoIngestTimers: Map<string, number> = new Map();

  t(zh: string, en: string): string {
    return this.settings?.language === 'en' ? en : zh;
  }

  commandT(zh: string, en: string): string {
    const language = this.settings?.commandLanguage || this.settings?.language;
    return language === 'en' ? en : zh;
  }

  async onload() {
    await this.loadSettings();
    this.rebuildServices();
    this.syncScheduler();

    // 设置页
    this.addSettingTab(new AiRagSettingTab(this.app, this));

    // 注册侧边栏视图
    this.registerView(AI_RAG_SIDEBAR_VIEW, (leaf) => new AiRagSidebarView(leaf, this));

    // 添加 Ribbon 图标
    this.addRibbonIcon('message-circle', this.t('AI RAG 助手', 'AI RAG assistant'), () => {
      void this.activateSidebarView();
    });

    // 注册右键菜单
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof TFile && file.extension === 'md') {
          // 添加 Wiki 导入选项
          if (this.settings.enableWiki && !this.isInsideWiki(file.path)) {
            menu.addItem((item) => {
              item
                .setTitle(this.t('导入到 wiki', 'Ingest to wiki'))
                .setIcon('book-plus')
                .onClick(() => {
                  void this.ingestNoteWithFeedback(file.path, true);
                });
            });
          }

          // 添加语义搜索选项
          menu.addItem((item) => {
            item
              .setTitle('在此文件中语义搜索')
              .setIcon('search')
              .onClick(() => {
                void (async () => {
                  if (!this.settings.apiKey) {
                    new Notice('请先在设置页填写 API key');
                    return;
                  }
                  if (!await this.ensureIndexReady()) {
                    return;
                  }
                  new SearchModal(this.app, this.retriever, (result) => {
                    void this.openSearchResult(result);
                  }).open();
                })();
              });
          });
        }
      })
    );

    // Wiki 自动导入：只监听 raw source 层，绝不自动处理 Wiki 自身页面
    this.registerEvent(this.app.vault.on('create', (file) => this.scheduleWikiAutoIngest(file)));
    this.registerEvent(this.app.vault.on('modify', (file) => this.scheduleWikiAutoIngest(file)));

    // 命令：打开侧边栏
    this.addCommand({
      id: 'open-ai-rag-sidebar',
      name: this.commandT('打开 AI RAG 侧边栏', 'Open AI RAG sidebar'),
      callback: () => {
        void this.activateSidebarView();
      }
    });

    // 命令：构建索引
    this.addCommand({
      id: 'build-ai-index',
      name: this.commandT('构建 AI 索引', 'Build AI index'),
      callback: async () => {
        if (!this.settings.apiKey) {
          new Notice('请先在设置页填写 API key。');
          return;
        }
        if (this.indexBuildInProgress) {
          if (this.indexBuildModal) {
            this.indexBuildModal.open();
          }
          new Notice('AI 索引正在构建中。');
          return;
        }
        await this.runFullIndexBuild();
      }
    });

    // 命令：语义搜索
    this.addCommand({
      id: 'semantic-search',
      name: this.commandT('语义搜索', 'Semantic search'),
      callback: async () => {
        if (!this.settings.apiKey) {
          new Notice('请先在设置页填写 API key。');
          return;
        }
        if (!await this.ensureIndexReady()) {
          return;
        }
        new SearchModal(this.app, this.retriever, (result) => {
          void this.openSearchResult(result);
        }).open();
      }
    });

    // 命令：Ask Vault
    this.addCommand({
      id: 'ask-vault',
      name: this.commandT('知识库提问', 'Ask vault'),
      callback: () => {
        if (!this.settings.apiKey) {
          new Notice('请先在设置页填写 API key。');
          return;
        }
        new AskVaultModal(this.app, this, this.ragChat, this.enhancementService, (citation) => {
          void this.openCitation(citation);
        }).open();
      }
    });

    // 命令：构建元数据索引
    this.addCommand({
      id: 'build-meta-index',
      name: this.commandT('构建元数据索引', 'Build meta index (AI summary)'),
      callback: async () => {
        if (!this.settings.apiKey) {
          new Notice('请先在设置页填写 API key。');
          return;
        }
        await this.enhancementService.buildMetaIndex((current, total, file) => {
          new Notice(`正在分析: ${file} (${current}/${total})`);
        });
        new Notice('元数据索引构建完成！');
      }
    });

    // 命令：查看索引队列状态（调试用）
    this.addCommand({
      id: 'show-index-queue',
      name: this.commandT('显示索引队列状态（调试）', 'Show index queue status (debug)'),
      callback: () => {
        const queueSize = this.indexScheduler.getQueueSize();
        const isEnabled = this.settings.autoIndexOnFileChange;
        new Notice(
          `Auto index: ${isEnabled ? 'enabled' : 'disabled'}\nQueue size: ${queueSize}`,
          5000
        );
      }
    });

    // 命令：手动刷新队列（调试用）
    this.addCommand({
      id: 'flush-index-queue',
      name: this.commandT('立即处理索引队列（调试）', 'Flush index queue (debug)'),
      callback: async () => {
        new Notice('Flushing index queue...');
        await this.indexScheduler.flush();
        new Notice('Index queue flushed!');
      }
    });

    // 命令：查看用户模式统计
    this.addCommand({
      id: 'show-user-pattern-stats',
      name: this.commandT('显示用户提问模式统计', 'Show user pattern stats'),
      callback: async () => {
        const stats = await this.enhancementService.getUserPatternStats();
        const frequentTerms = await this.enhancementService.getFrequentTerms(5);

        new Notice(
          `User pattern stats:\n` +
          `Total questions: ${stats.totalQuestions}\n` +
          `Unique terms: ${stats.uniqueTerms}\n` +
          `Trigger words: ${stats.triggerWords}\n` +
          `Templates: ${stats.templates}\n` +
          `Top terms: ${frequentTerms.join(', ')}`,
          10000
        );
      }
    });

    // 命令：查看评测指标
    this.addCommand({
      id: 'show-eval-metrics',
      name: this.commandT('显示评测指标', 'Show evaluation metrics'),
      callback: async () => {
        // 需要从 retriever 或 ragChat 获取 loggingService
        // 这里简化处理，直接创建一个新实例
        const adapter = new ObsidianJsonFileAdapter(this.app);
        const basePath = `${this.app.vault.configDir}/plugins/${this.manifest.id}/data`;
        const loggingService = new LoggingService(adapter, basePath);

        const metrics = await loggingService.calculateMetrics();
        const stats = await loggingService.getStats();

        new Notice(
          `Evaluation metrics:\n` +
          `Retrieval relevance: ${(metrics.retrievalRelevance * 100).toFixed(1)}%\n` +
          `Groundedness: ${(metrics.groundedness * 100).toFixed(1)}%\n` +
          `Citation accuracy: ${(metrics.citationAccuracy * 100).toFixed(1)}%\n` +
          `Avg response time: ${metrics.responseTime.toFixed(0)}ms\n\n` +
          `Total queries: ${stats.totalQueries}\n` +
          `Correction rate: ${(stats.correctionRate * 100).toFixed(1)}%`,
          15000
        );
      }
    });

    // 命令：查看查询日志
    this.addCommand({
      id: 'show-query-logs',
      name: this.commandT('显示最近查询日志', 'Show recent query logs'),
      callback: async () => {
        const adapter = new ObsidianJsonFileAdapter(this.app);
        const basePath = `${this.app.vault.configDir}/plugins/${this.manifest.id}/data`;
        const loggingService = new LoggingService(adapter, basePath);

        const stats = await loggingService.getStats();

        new Notice(
          `Recent queries:\n` +
          stats.recentQueries.slice(0, 5).map((q, i) => `${i + 1}. ${q}`).join('\n'),
          10000
        );
      }
    });

    // Wiki 命令
    this.addCommand({
      id: 'init-wiki',
      name: this.commandT('初始化 wiki', 'Initialize wiki'),
      callback: async () => {
        if (!this.settings.enableWiki) {
          new Notice('请先在设置中启用 wiki 功能');
          return;
        }
        const wikiServices = this.getWikiServices();
        if (!wikiServices) {
          return;
        }

        try {
          await wikiServices.wikiService.initializeWikiStructure();
          new Notice('wiki 初始化完成！');
        } catch (error) {
          console.error('wiki 初始化失败:', error);
          new Notice('wiki 初始化失败');
        }
      }
    });

    this.addCommand({
      id: 'wiki-query',
      name: this.commandT('查询 wiki', 'Query wiki'),
      callback: () => {
        if (!this.settings.enableWiki) {
          new Notice('请先在设置中启用 wiki 功能');
          return;
        }
        const wikiServices = this.getWikiServices();
        if (!wikiServices) {
          return;
        }

        if (!wikiServices.wikiService.isInitialized()) {
          new Notice('请先初始化 wiki（运行 Initialize wiki 命令）');
          return;
        }

        new WikiQueryModal(
          this.app,
          wikiServices.wikiBuilder,
          wikiServices.wikiService,
          (path) => {
            void this.app.workspace.openLinkText(path, '', false);
          }
        ).open();
      }
    });

    this.addCommand({
      id: 'wiki-ingest-current',
      name: this.commandT('导入当前笔记到 wiki', 'Ingest current note to wiki'),
      callback: async () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
          new Notice('请先打开一个笔记');
          return;
        }

        if (this.isInsideWiki(activeFile.path)) {
          new Notice('不能导入 wiki 页面');
          return;
        }

        await this.ingestNoteWithFeedback(activeFile.path, true);
      }
    });

    this.addCommand({
      id: 'wiki-reingest-current',
      name: this.commandT('重新导入当前笔记到 wiki', 'Re-ingest current note to wiki'),
      callback: async () => {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
          new Notice('请先打开一个笔记');
          return;
        }

        if (this.isInsideWiki(activeFile.path)) {
          new Notice('不能导入 wiki 页面');
          return;
        }

        await this.ingestNoteWithFeedback(activeFile.path, true);
      }
    });

    this.addCommand({
      id: 'wiki-batch-ingest',
      name: this.commandT('一键导入全部笔记到 wiki', 'Batch ingest all notes to wiki'),
      callback: async () => {
        if (!this.settings.enableWiki) {
          new Notice('请先在设置中启用 wiki 功能');
          return;
        }
        const wikiServices = this.getWikiServices();
        if (!wikiServices) {
          return;
        }

        if (!this.settings.apiKey) {
          new Notice('请先在设置页填写 API key');
          return;
        }

        // 获取所有笔记
        const files = this.app.vault.getMarkdownFiles();
        let filePaths = files
          .filter(f => !this.isInsideWiki(f.path))
          .map(f => f.path);
        filePaths = await this.filterProcessableFiles(filePaths, false);

        if (filePaths.length === 0) {
          new Notice('没有可导入的笔记');
          return;
        }

        const progressModal = new WikiIngestProgressModal(this.app);
        progressModal.open();

        try {
          const result = await wikiServices.wikiBuilder.batchIngest(
            filePaths,
            (current, total, file) => {
              progressModal.updateProgress(current, total, file);
            },
            false,
            undefined,
            { force: false }
          );

          const summary = `批量导入完成！
- 创建 ${result.sourcesCreated.length} 个来源摘要
- 更新 ${result.sourcesUpdated.length} 个来源摘要
- 创建 ${result.entitiesCreated.length} 个实体
- 更新 ${result.entitiesUpdated.length} 个实体
- 创建 ${result.conceptsCreated.length} 个概念
- 更新 ${result.conceptsUpdated.length} 个概念
- 跳过 ${result.skippedFiles.length} 个已处理笔记`;

          progressModal.complete(summary);
        } catch (error) {
          console.error('批量导入失败:', error);
          new Notice('批量导入失败');
          progressModal.close();
        }
      }
    });

    this.addCommand({
      id: 'wiki-batch-ingest-interactive',
      name: this.commandT('交互式批量导入 wiki', 'Batch ingest (interactive mode)'),
      callback: async () => {
        if (!this.settings.enableWiki) {
          new Notice('请先在设置中启用 wiki 功能');
          return;
        }
        const wikiServices = this.getWikiServices();
        if (!wikiServices) {
          return;
        }

        if (!this.settings.apiKey) {
          new Notice('请先在设置页填写 API key');
          return;
        }

        // 获取所有笔记
        const files = this.app.vault.getMarkdownFiles();
        let filePaths = files
          .filter(f => !this.isInsideWiki(f.path))
          .map(f => f.path);
        filePaths = await this.filterProcessableFiles(filePaths, false);

        if (filePaths.length === 0) {
          new Notice('没有可导入的笔记');
          return;
        }

        const progressModal = new WikiIngestProgressModal(this.app, true);
        progressModal.open();

        try {
          const result = await wikiServices.wikiBuilder.batchIngest(
            filePaths,
            (current, total, file) => {
              progressModal.updateProgress(current, total, file);
            },
            true,
            (fileResult) => {
              // 显示当前文件结果，等待用户确认
              return progressModal.showFileResult(fileResult);
            },
            { force: false }
          );

          const summary = `批量导入完成！
- 创建 ${result.sourcesCreated.length} 个来源摘要
- 更新 ${result.sourcesUpdated.length} 个来源摘要
- 创建 ${result.entitiesCreated.length} 个实体
- 更新 ${result.entitiesUpdated.length} 个实体
- 创建 ${result.conceptsCreated.length} 个概念
- 更新 ${result.conceptsUpdated.length} 个概念
- 跳过 ${result.skippedFiles.length} 个已处理笔记`;

          progressModal.complete(summary);
        } catch (error) {
          console.error('批量导入失败:', error);
          new Notice('批量导入失败');
          progressModal.close();
        }
      }
    });

    this.addCommand({
      id: 'wiki-stats',
      name: this.commandT('显示 wiki 统计', 'Show wiki stats'),
      callback: async () => {
        if (!this.settings.enableWiki) {
          new Notice('请先在设置中启用 wiki 功能');
          return;
        }
        const wikiServices = this.getWikiServices();
        if (!wikiServices) {
          return;
        }

        if (!wikiServices.wikiService.isInitialized()) {
          new Notice('wiki 尚未初始化');
          return;
        }

        const stats = await wikiServices.wikiService.getStats();

        new Notice(
          `wiki 统计:\n` +
          `FAQ: ${stats.faq}\n` +
          `Meta: ${stats.meta}\n` +
          `关系: ${stats.relations}\n` +
          `来源: ${stats.sources}\n` +
          `实体: ${stats.entities}\n` +
          `概念: ${stats.concepts}\n` +
          `摘要: ${stats.summaries}\n` +
          `综合: ${stats.syntheses}\n` +
          `总计: ${stats.total}`,
          5000
        );
      }
    });

    this.addCommand({
      id: 'wiki-browse',
      name: this.commandT('浏览 wiki', 'Browse wiki'),
      callback: () => {
        if (!this.settings.enableWiki) {
          new Notice('请先在设置中启用 wiki 功能');
          return;
        }
        const wikiServices = this.getWikiServices();
        if (!wikiServices) {
          return;
        }

        if (!wikiServices.wikiService.isInitialized()) {
          new Notice('请先初始化 wiki');
          return;
        }

        new WikiBrowserModal(
          this.app,
          wikiServices.wikiService,
          (path) => {
            void this.app.workspace.openLinkText(path, '', false);
          }
        ).open();
      }
    });

    this.addCommand({
      id: 'wiki-generate-summary',
      name: this.commandT('生成 wiki 总结', 'Generate wiki summary'),
      callback: async () => {
        if (!this.settings.enableWiki) {
          new Notice('请先在设置中启用 wiki 功能');
          return;
        }
        const wikiServices = this.getWikiServices();
        if (!wikiServices) {
          return;
        }

        if (!this.settings.apiKey) {
          new Notice('请先在设置页填写 API key');
          return;
        }

        if (!wikiServices.wikiService.isInitialized()) {
          new Notice('请先初始化 wiki');
          return;
        }

        // 简单的输入对话框
        const topic = await this.promptForInput('请输入主题名称');
        if (!topic) {
          return;
        }

        try {
          new Notice('正在生成摘要...');
          const path = await wikiServices.wikiBuilder.generateSummary(topic);
          new Notice(`摘要已生成: ${path}`, 5000);

          // 打开生成的摘要
          await this.app.workspace.openLinkText(path, '', false);
        } catch (error) {
          console.error('生成摘要失败:', error);
          new Notice(`生成摘要失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    });

    this.addCommand({
      id: 'wiki-audit',
      name: this.commandT('审计 wiki', 'Audit wiki'),
      callback: async () => {
        if (!this.settings.enableWiki) {
          new Notice('请先在设置中启用 wiki 功能');
          return;
        }
        const wikiServices = this.getWikiServices();
        if (!wikiServices) {
          return;
        }

        if (!this.settings.apiKey) {
          new Notice('请先在设置页填写 API key');
          return;
        }

        if (!wikiServices.wikiService.isInitialized()) {
          new Notice('请先初始化 wiki');
          return;
        }

        try {
          new Notice('正在审计 wiki...');

          // 创建审计器
          const httpClient = new OpenAiCompatibleHttpClient(
            this.settings.apiBaseUrl,
            this.settings.apiKey
          );
          const llmClient = new OpenAiCompatibleLlmClient(
            httpClient,
            this.settings.chatModel
          );

          const { WikiAuditor } = await import('./services/WikiAuditor');
          const auditor = new WikiAuditor(this.app, wikiServices.wikiService, llmClient);

          const report = await auditor.auditWiki();
          const markdown = auditor.generateReportMarkdown(report);

          // 保存报告
          const reportPath = `${this.settings.wikiPath}/audit-report.md`;
          const reportFile = this.app.vault.getAbstractFileByPath(reportPath);

          if (reportFile && reportFile instanceof TFile) {
            await this.app.vault.modify(reportFile, markdown);
          } else {
            await this.app.vault.create(reportPath, markdown);
          }

          new Notice('审计完成！报告已保存', 5000);
          await this.app.workspace.openLinkText(reportPath, '', false);
        } catch (error) {
          console.error('审计失败:', error);
          new Notice(`审计失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    });

    this.addCommand({
      id: 'wiki-auto-fix-orphans',
      name: this.commandT('自动修复孤立页面', 'Auto-fix orphan pages'),
      callback: async () => {
        if (!this.settings.enableWiki) {
          new Notice('请先在设置中启用 wiki 功能');
          return;
        }
        const wikiServices = this.getWikiServices();
        if (!wikiServices) {
          return;
        }

        if (!this.settings.apiKey) {
          new Notice('请先在设置页填写 API key');
          return;
        }

        if (!wikiServices.wikiService.isInitialized()) {
          new Notice('请先初始化 wiki');
          return;
        }

        try {
          new Notice('正在修复孤立页面...');

          // 创建审计器
          const httpClient = new OpenAiCompatibleHttpClient(
            this.settings.apiBaseUrl,
            this.settings.apiKey
          );
          const llmClient = new OpenAiCompatibleLlmClient(
            httpClient,
            this.settings.chatModel
          );

          const { WikiAuditor } = await import('./services/WikiAuditor');
          const auditor = new WikiAuditor(this.app, wikiServices.wikiService, llmClient);

          // 先找出孤立页面
          const report = await auditor.auditWiki();
          const orphanPages = report.orphanPages;

          if (orphanPages.length === 0) {
            new Notice('没有发现孤立页面');
            return;
          }

          // 自动修复
          const result = await auditor.autoFixOrphanPages(orphanPages);

          new Notice(
            `修复完成！\n成功: ${result.fixed.length}\n失败: ${result.failed.length}`,
            5000
          );
        } catch (error) {
          console.error('自动修复失败:', error);
          new Notice(`自动修复失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    });

    this.addCommand({
      id: 'generate-feedback-tuning-report',
      name: this.commandT('生成反馈调参报告', 'Generate feedback tuning report'),
      callback: async () => {
        if (!this.feedbackTuningService) {
          new Notice(this.t('反馈调参服务尚未就绪', 'Feedback tuning service is not ready'));
          return;
        }

        const reportPath = await this.feedbackTuningService.generateCurrentReport();
        new Notice(
          this.t(`已生成反馈调参报告：${reportPath}`, `Feedback tuning report generated: ${reportPath}`),
          6000
        );
      }
    });
  }

  private getWikiServices(): { wikiService: WikiService; wikiBuilder: WikiBuilder } | null {
    if (!this.wikiService || !this.wikiBuilder) {
      new Notice(this.t('wiki 服务尚未就绪，请检查设置。', 'wiki services are not ready. Check settings.'));
      return null;
    }

    return {
      wikiService: this.wikiService,
      wikiBuilder: this.wikiBuilder
    };
  }

  /**
   * 简单的输入提示框
   */
  private async promptForInput(prompt: string): Promise<string | null> {
    return new Promise((resolve) => {
      const modal = new (class extends Modal {
        onOpen() {
          const { contentEl } = this;
          contentEl.empty();
          contentEl.createEl('h3', { text: prompt });

          const input = contentEl.createEl('input', {
            type: 'text',
            cls: 'ai-rag-prompt-input'
          });

          const buttonContainer = contentEl.createDiv({ cls: 'ai-rag-prompt-actions' });

          const confirmBtn = buttonContainer.createEl('button', { text: '确定', cls: 'mod-cta' });
          const cancelBtn = buttonContainer.createEl('button', { text: '取消' });

          confirmBtn.addEventListener('click', () => {
            resolve(input.value.trim() || null);
            this.close();
          });

          cancelBtn.addEventListener('click', () => {
            resolve(null);
            this.close();
          });

          input.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
              resolve(input.value.trim() || null);
              this.close();
            } else if (e.key === 'Escape') {
              resolve(null);
              this.close();
            }
          });

          input.focus();
        }

        onClose() {
          const { contentEl } = this;
          contentEl.empty();
        }
      })(this.app);

      modal.open();
    });
  }

  private async ingestNoteWithFeedback(filePath: string, force: boolean): Promise<void> {
    if (!this.settings.enableWiki) {
      new Notice('请先在设置中启用 wiki 功能');
      return;
    }
    const wikiServices = this.getWikiServices();
    if (!wikiServices) {
      return;
    }

    if (!this.settings.apiKey) {
      new Notice('请先在设置页填写 API key');
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      new Notice('找不到要导入的笔记');
      return;
    }

    if (!await this.confirmSensitiveProcessing(file.path, force)) {
      return;
    }

    new Notice(force ? '正在导入到 wiki...' : '正在检查并导入到 wiki...');
    const result = await wikiServices.wikiBuilder.ingestNote(file.path, { force });
    if (result.skippedFiles.length > 0) {
      new Notice('这篇笔记已经导入过，已自动跳过。');
      return;
    }

    const metaNote = await this.enhancementService.updateMetaForFile(file.path);
    await this.syncSourceRelatedNotes(file.path);
    await this.maybeSuggestBidirectionalLinks(file.path, metaNote);
    const summary = `导入完成！
- source 页: ${result.sourcePagePath ? '1' : '0'}
- 创建 ${result.entitiesCreated.length} 个实体
- 更新 ${result.entitiesUpdated.length} 个实体
- 创建 ${result.conceptsCreated.length} 个概念
- 更新 ${result.conceptsUpdated.length} 个概念
- 创建 ${result.summariesCreated.length} 个摘要
- 更新 ${result.summariesUpdated.length} 个摘要`;

    new Notice(summary, 6000);
  }

  private scheduleWikiAutoIngest(file: TAbstractFile): void {
    if (
      !this.settings.enableWiki ||
      !this.settings.apiKey ||
      (!this.settings.wikiAutoIngest && !this.settings.autoIndexOnFileChange)
    ) {
      return;
    }

    if (!(file instanceof TFile) || file.extension !== 'md' || this.isInsideWiki(file.path)) {
      return;
    }

    const existingTimer = this.wikiAutoIngestTimers.get(file.path);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }

    const timer = window.setTimeout(() => {
      this.wikiAutoIngestTimers.delete(file.path);
      if (this.settings.wikiAutoIngest) {
        void this.runWikiAutoIngest(file.path);
      } else if (this.settings.autoIndexOnFileChange) {
        void (async () => {
          const metaNote = await this.enhancementService.updateMetaForFile(file.path, { promptSensitive: false });
          await this.syncSourceRelatedNotes(file.path);
          await this.maybeSuggestBidirectionalLinks(file.path, metaNote);
        })();
      }
    }, 5000);

    this.wikiAutoIngestTimers.set(file.path, timer);
  }

  private async runWikiAutoIngest(filePath: string): Promise<void> {
    if (!this.settings.enableWiki || !this.settings.wikiAutoIngest || !this.wikiBuilder || !this.wikiService) {
      return;
    }

    if (this.isInsideWiki(filePath)) {
      return;
    }

    try {
      if (!this.wikiService.isInitialized()) {
        await this.wikiService.initializeWikiStructure();
      }

      if (!await this.confirmSensitiveProcessing(filePath)) {
        return;
      }

      const result = await this.wikiBuilder.ingestNote(filePath, { force: false });
      if (result.skippedFiles.length > 0) {
        return;
      }
      const metaNote = await this.enhancementService.updateMetaForFile(filePath);
      await this.syncSourceRelatedNotes(filePath);
      await this.maybeSuggestBidirectionalLinks(filePath, metaNote);
      console.debug(
        `wiki 自动导入完成: ${filePath}，创建 ${result.createdPages.length} 页，更新 ${result.updatedPages.length} 页`
      );
    } catch (error) {
      console.error(`wiki 自动导入失败: ${filePath}`, error);
    }
  }

  private async confirmSensitiveProcessing(filePath: string, force: boolean = false): Promise<boolean> {
    if (!this.sensitivityService) {
      return true;
    }

    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      return false;
    }

    const content = await this.app.vault.read(file);
    const decision = await this.sensitivityService.decide(filePath, content);

    if (decision === 'process') {
      return true;
    }

    if (decision === 'private') {
      await this.sensitivityService.markPrivate(filePath);
      await this.wikiIngestStateService?.markPrivate(file);
      new Notice('已标记为私密笔记，不会发送给 AI 或做正文向量化。');
      return false;
    }

    if (!force) {
      await this.wikiIngestStateService?.markSkipped(file);
    }
    new Notice('已跳过该敏感笔记。');
    return false;
  }

  private async filterProcessableFiles(filePaths: string[], force: boolean): Promise<string[]> {
    const processable: string[] = [];
    for (const filePath of filePaths) {
      if (!force && this.wikiIngestStateService && await this.wikiIngestStateService.shouldSkip(filePath)) {
        continue;
      }
      if (await this.confirmSensitiveProcessing(filePath, force)) {
        processable.push(filePath);
      }
    }
    return processable;
  }

  isInsideWiki(filePath: string): boolean {
    const wikiPath = (this.settings.wikiPath || '_wiki').replace(/^\/+|\/+$/g, '') || '_wiki';
    return filePath === wikiPath || filePath.startsWith(`${wikiPath}/`);
  }

  onunload() {
    for (const timer of this.wikiAutoIngestTimers.values()) {
      window.clearTimeout(timer);
    }
    this.wikiAutoIngestTimers.clear();
    this.indexScheduler?.dispose();
    this.indexBuildModal?.close();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  refreshLocalizedCommandLabels() {
    const commandRegistry = (this.app as typeof this.app & {
      commands?: {
        commands?: Record<string, { name: string }>;
        updateCommands?: () => void;
      };
    }).commands;
    const commandMap = commandRegistry?.commands;
    if (!commandMap) {
      return;
    }

    for (const [id, name] of Object.entries(this.getLocalizedCommandNames())) {
      const fullId = `${this.manifest.id}:${id}`;
      if (commandMap[fullId]) {
        commandMap[fullId].name = name;
      }
    }

    commandRegistry?.updateCommands?.();
  }

  private getLocalizedCommandNames(): Record<string, string> {
    return {
      'open-ai-rag-sidebar': this.commandT('打开 AI RAG 侧边栏', 'Open AI RAG sidebar'),
      'build-ai-index': this.commandT('构建 AI 索引', 'Build AI index'),
      'semantic-search': this.commandT('语义搜索', 'Semantic search'),
      'ask-vault': this.commandT('知识库提问', 'Ask vault'),
      'build-meta-index': this.commandT('构建元数据索引', 'Build meta index (AI summary)'),
      'show-index-queue': this.commandT('显示索引队列状态（调试）', 'Show index queue status (debug)'),
      'flush-index-queue': this.commandT('立即处理索引队列（调试）', 'Flush index queue (debug)'),
      'show-user-pattern-stats': this.commandT('显示用户提问模式统计', 'Show user pattern stats'),
      'show-eval-metrics': this.commandT('显示评测指标', 'Show evaluation metrics'),
      'show-query-logs': this.commandT('显示最近查询日志', 'Show recent query logs'),
      'init-wiki': this.commandT('初始化 wiki', 'Initialize wiki'),
      'wiki-query': this.commandT('查询 wiki', 'Query wiki'),
      'wiki-ingest-current': this.commandT('导入当前笔记到 wiki', 'Ingest current note to wiki'),
      'wiki-reingest-current': this.commandT('重新导入当前笔记到 wiki', 'Re-ingest current note to wiki'),
      'wiki-batch-ingest': this.commandT('一键导入全部笔记到 wiki', 'Batch ingest all notes to wiki'),
      'wiki-batch-ingest-interactive': this.commandT('交互式批量导入 wiki', 'Batch ingest (interactive mode)'),
      'wiki-stats': this.commandT('显示 wiki 统计', 'Show wiki stats'),
      'wiki-browse': this.commandT('浏览 wiki', 'Browse wiki'),
      'wiki-generate-summary': this.commandT('生成 wiki 总结', 'Generate wiki summary'),
      'wiki-audit': this.commandT('审计 wiki', 'Audit wiki'),
      'wiki-auto-fix-orphans': this.commandT('自动修复孤立页面', 'Auto-fix orphan pages'),
      'generate-feedback-tuning-report': this.commandT('生成反馈调参报告', 'Generate feedback tuning report')
    };
  }

  rebuildServices() {
    this.indexScheduler?.dispose();
    this.schedulerBound = false;

    const basePath = `${this.app.vault.configDir}/plugins/${this.manifest.id}/data`;

    // 初始化存储适配器
    const adapter = new ObsidianJsonFileAdapter(this.app);
    const manifestStore = new JsonIndexManifestStore(adapter, basePath);
    const metadataStore = new JsonMetadataStore(adapter, basePath);
    const vectorStore = new JsonVectorStore(adapter, basePath);

    // 初始化扫描器
    const scanner = new ObsidianVaultScanner(this.app);

    // 初始化 API 客户端
    const httpClient = new OpenAiCompatibleHttpClient(
      this.settings.apiBaseUrl,
      this.settings.apiKey
    );
    const embeddingHttpClient = (this.settings.embeddingApiBaseUrl && this.settings.embeddingApiKey)
      ? new OpenAiCompatibleHttpClient(
          this.settings.embeddingApiBaseUrl,
          this.settings.embeddingApiKey
        )
      : httpClient;
    const embeddingClient = new OpenAiCompatibleEmbeddingClient(
      embeddingHttpClient,
      this.settings.embeddingModel
    );
    const llmClient = new OpenAiCompatibleLlmClient(
      httpClient,
      this.settings.chatModel
    );

    // 初始化索引构建器
    this.indexBuilder = new IndexBuilder(
      scanner,
      embeddingClient,
      metadataStore,
      vectorStore,
      manifestStore,
      this.settings
    );

    // 初始化高级检索服务
    const userPatternService = new UserPatternService(adapter, basePath);
    const loggingService = new LoggingService(adapter, basePath);

    const queryAnalysisService = new QueryAnalysisService(
      llmClient,
      metadataStore,
      () => this.settings,
      userPatternService
    );

    const rerankService = new LlmRerankService(
      llmClient,
      () => this.settings
    );

    const compressionService = new ContextCompressionService(
      metadataStore,
      () => this.settings
    );

    // 初始化反馈和元数据召回服务
    const feedbackRecall = new FeedbackRecallService(
      embeddingClient,
      adapter,
      basePath
    );

    const metaRecall = new MetaRecallService(
      embeddingClient,
      adapter,
      basePath
    );

    // 初始化检索服务
    const vectorSearch = new VectorSearchService(embeddingClient, vectorStore);
    const lexicalSearch = new LexicalSearchService(metadataStore);

    this.retriever = new Retriever(
      vectorSearch,
      lexicalSearch,
      metadataStore,
      () => this.settings,
      queryAnalysisService,
      rerankService,
      compressionService,
      feedbackRecall,
      metaRecall,
      loggingService
    );

    // 初始化 Wiki 服务
    this.wikiService = undefined;
    this.wikiBuilder = undefined;
    this.sensitivityService = undefined;
    this.faqService = undefined;
    this.wikiGraphSearch = undefined;
    this.wikiIngestStateService = undefined;

    if (this.settings.enableWiki) {
      this.wikiService = new WikiService(this.app, this.settings.wikiPath);
      this.sensitivityService = new SensitivityService(this.app, this.wikiService);
      this.wikiIngestStateService = new WikiIngestStateService(adapter, basePath);
      this.faqService = new FAQService(
        this.app,
        this.wikiService,
        embeddingClient,
        adapter,
        basePath,
        () => this.settings.faqStrongMatchThreshold
      );
      this.wikiGraphSearch = new WikiGraphSearchService(this.wikiService);
      this.wikiBuilder = new WikiBuilder(
        this.app,
        this.wikiService,
        llmClient,
        this.wikiGraphSearch,
        this.wikiIngestStateService
      );

      // 设置 wiki 页面更新回调，触发 RAG 索引更新
      this.wikiService.setPageUpdateCallback((filePath: string) => {
        if (this.settings.autoIndexOnFileChange) {
          console.debug(`wiki 页面更新: ${filePath}，触发 RAG 索引更新`);
          // 手动触发索引更新
          const file = this.app.vault.getAbstractFileByPath(filePath);
          if (file instanceof TFile) {
            this.indexScheduler.enqueueUpdate(file, 'modify');
          }
        }
      });
    }

    // 初始化 RAG 问答服务
    this.ragChat = new RagChatService(
      this.retriever,
      llmClient,
      this.settings.maxContextChars,
      loggingService,
      this.faqService,
      this.wikiGraphSearch,
      () => this.settings
    );

    // 初始化索引调度器
    this.indexScheduler = new IndexScheduler(this.app, this.indexBuilder, (path) => this.isInsideWiki(path));

    // 初始化增强服务
    this.enhancementService = new EnhancementService(this, basePath);
    this.feedbackTuningService = new FeedbackTuningService(this, adapter, basePath);
    this.noteLinkService = new NoteLinkService(this.app, (path) => this.isInsideWiki(path));
    if (this.faqService) {
      this.enhancementService.setFAQService(this.faqService);
    }
    if (this.sensitivityService) {
      this.enhancementService.setSensitivityService(this.sensitivityService);
    }
  }

  private async maybeSuggestBidirectionalLinks(filePath: string, metaNote: MetaNote | null): Promise<void> {
    if (!metaNote || metaNote.isPrivate || !this.noteLinkService) {
      return;
    }

    const suggestions = await this.noteLinkService.buildSuggestions(filePath, metaNote);
    if (!this.noteLinkService.shouldPrompt(filePath, suggestions)) {
      return;
    }

    new LinkSuggestionModal(this.app, {
      sourcePath: filePath,
      suggestions,
      language: this.settings.language,
      onApply: (targetPaths) => this.applySuggestedLinks(filePath, targetPaths)
    }).open();
  }

  private async applySuggestedLinks(sourcePath: string, targetPaths: string[]): Promise<void> {
    if (!this.noteLinkService) {
      return;
    }

    const result = await this.noteLinkService.applyBidirectionalLinks({
      sourcePath,
      targetPaths
    });

    for (const path of result.updated) {
      await this.enhancementService.updateMetaForFile(path);
      await this.syncSourceRelatedNotes(path);
    }

    if (result.updated.length > 0) {
      new Notice(
        this.t(`已更新 ${result.updated.length} 篇笔记的相关链接`, `Updated related links in ${result.updated.length} notes`),
        5000
      );
    }
  }

  private async syncSourceRelatedNotes(filePath: string): Promise<void> {
    if (!this.noteLinkService || !this.wikiService?.isInitialized()) {
      return;
    }

    const metaNote = await this.readMetaNote(filePath);
    if (!metaNote?.sourceWikiPath) {
      return;
    }

    const sourcePage = await this.wikiService.readPage(metaNote.sourceWikiPath);
    if (!sourcePage) {
      return;
    }

    const relatedLinks = await this.noteLinkService.getRelatedLinks(filePath);
    const mergedLinks = Array.from(new Set([...(metaNote.suggestedRelatedNotes || []), ...relatedLinks])).sort();
    const sectionBody = mergedLinks.length > 0
      ? mergedLinks.map(path => `- [[${path}]]`).join('\n')
      : '- 暂无';
    const nextContent = this.upsertMarkdownSection(sourcePage.content, '## 相关原始笔记', sectionBody);

    const file = this.app.vault.getAbstractFileByPath(metaNote.sourceWikiPath);
    if (file instanceof TFile && nextContent !== sourcePage.content) {
      await this.app.vault.modify(file, nextContent);
    }
  }

  private async readMetaNote(filePath: string): Promise<MetaNote | null> {
    const path = `${this.app.vault.configDir}/plugins/${this.manifest.id}/data/meta-notes.json`;
    try {
      const content = await this.app.vault.adapter.read(path);
      const notes = JSON.parse(content) as MetaNote[];
      return notes.find(note => note.path === filePath) || null;
    } catch {
      return null;
    }
  }

  private upsertMarkdownSection(content: string, heading: string, body: string): string {
    const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sectionRegex = new RegExp(`${escapedHeading}\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'm');
    const rendered = `${heading}\n${body}\n`;

    if (sectionRegex.test(content)) {
      return content.replace(sectionRegex, rendered);
    }

    return `${content.trim()}\n\n${rendered}`;
  }

  syncScheduler() {
    if (!this.settings.autoIndexOnFileChange && this.schedulerBound) {
      this.indexScheduler.dispose();
      this.indexScheduler = new IndexScheduler(this.app, this.indexBuilder, (path) => this.isInsideWiki(path));
      this.schedulerBound = false;
      return;
    }

    // 根据设置启动或停止调度器
    if (this.settings.autoIndexOnFileChange && !this.schedulerBound) {
      this.indexScheduler.start();
      this.schedulerBound = true;
    }
  }

  async runFullIndexBuild() {
    const progressModal = new IndexBuildProgressModal(this.app);
    this.indexBuildModal = progressModal;
    this.indexBuildInProgress = true;
    progressModal.open();

    try {
      const result = await this.indexBuilder.buildFullIndex((progress) => {
        progressModal.updateProgress(progress);
      });
      const message = `索引完成：${result.filesIndexed} 个文件，${result.chunksIndexed} 个 chunks。`;
      progressModal.markCompleted(true, message);
      new Notice(message, 8000);
    } catch (error) {
      console.error(error);
      const message = `构建 AI 索引失败: ${error}`;
      progressModal.markCompleted(false, message);
      new Notice(message, 8000);
    } finally {
      this.indexBuildInProgress = false;
      this.indexBuildModal = undefined;
    }
  }

  async ensureIndexReady(): Promise<boolean> {
    if (await this.indexBuilder.requiresFullRebuild()) {
      new Notice('当前索引不存在，或 embedding/chunk 配置已变化。请先执行 Build AI index。', 8000);
      return false;
    }
    return true;
  }

  async activateSidebarView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(AI_RAG_SIDEBAR_VIEW)[0];

    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        leaf = rightLeaf;
        await leaf.setViewState({ type: AI_RAG_SIDEBAR_VIEW, active: true });
      }
    }

    if (leaf) {
      await workspace.revealLeaf(leaf);
    }
  }

  async openSearchResult(result: SearchResult) {
    await this.openFileAtCitation({
      path: result.chunk.path,
      title: result.chunk.title,
      heading: result.chunk.heading,
      sectionPath: result.chunk.sectionPath,
      startLine: result.chunk.startLine,
      endLine: result.chunk.endLine,
      snippet: result.snippet ?? result.chunk.content.slice(0, 240)
    });
  }

  async openCitation(citation: Citation) {
    await this.openFileAtCitation(citation);
  }

  async openFileAtCitation(citation: Citation) {
    const file = this.app.vault.getAbstractFileByPath(citation.path);
    if (!(file instanceof TFile)) {
      new Notice(`找不到文件：${citation.path}`);
      return;
    }

    const leaf = this.app.workspace.getLeaf(true);
    await leaf.openFile(file);

    const view = leaf.view;
    if (!(view instanceof MarkdownView)) {
      return;
    }

    const editor = view.editor;
    const content = editor.getValue();
    const lines = content.split(/\r?\n/);

    const targetLine = this.resolveTargetLine(lines, citation);
    const safeLine = Math.max(0, Math.min(targetLine, Math.max(0, lines.length - 1)));
    const endLine = Math.max(safeLine, Math.min((citation.endLine ?? safeLine + 2) - 1, Math.max(0, lines.length - 1)));
    const endCh = lines[endLine]?.length ?? 0;

    editor.setSelection({ line: safeLine, ch: 0 }, { line: endLine, ch: endCh });
    editor.setCursor({ line: safeLine, ch: 0 });
    editor.scrollIntoView({ from: { line: safeLine, ch: 0 }, to: { line: endLine, ch: endCh } }, true);
  }

  private resolveTargetLine(lines: string[], citation: Citation): number {
    if (typeof citation.startLine === 'number' && citation.startLine > 0) {
      return citation.startLine - 1;
    }
    if (citation.heading) {
      const headingIndex = lines.findIndex((line) =>
        line.trim().replace(/^#+\s+/, '') === citation.heading
      );
      if (headingIndex >= 0) {
        return headingIndex;
      }
    }
    return 0;
  }
}
