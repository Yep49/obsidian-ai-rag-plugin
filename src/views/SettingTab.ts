import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import AiRagPlugin from '../main';

interface ProviderConfig {
  name: string;
  baseUrl: string;
  models: string[];
  embeddingModels: string[];
}

const COMMON_PROVIDERS: ProviderConfig[] = [
  {
    name: 'OpenAI 官方',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4', 'gpt-3.5-turbo', 'gpt-4-turbo'],
    embeddingModels: ['text-embedding-ada-002', 'text-embedding-3-small', 'text-embedding-3-large']
  },
  {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    embeddingModels: []
  },
  {
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
    embeddingModels: ['text-embedding-v1', 'text-embedding-v2']
  },
  {
    name: '智谱 AI',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4', 'glm-3-turbo'],
    embeddingModels: ['embedding-2', 'embedding-3']
  },
  {
    name: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct', 'meta-llama/Llama-3.3-70B-Instruct'],
    embeddingModels: ['BAAI/bge-m3', 'BAAI/bge-large-zh-v1.5', 'sentence-transformers/all-MiniLM-L6-v2']
  }
];

export class AiRagSettingTab extends PluginSettingTab {
  plugin: AiRagPlugin;
  private providers = COMMON_PROVIDERS;

  constructor(app: App, plugin: AiRagPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private getProviderByBaseUrl(baseUrl: string): ProviderConfig | undefined {
    return this.providers.find(provider => provider.baseUrl === baseUrl);
  }

  private getProviderByName(name: string): ProviderConfig | undefined {
    return this.providers.find(provider => provider.name === name);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const isZh = this.plugin.settings.language !== 'en';
    const t = {
      title: isZh ? 'AI RAG 搜索设置' : 'AI RAG Search Settings',
      language: isZh ? '语言 / Language' : 'Language / 语言',
      languageDesc: isZh ? '选择设置页和插件界面语言' : 'Choose the settings and plugin UI language',
      commandLanguage: isZh ? 'Obsidian 命令语言' : 'Obsidian Command Language',
      commandLanguageDesc: isZh ? '选择命令面板中本插件命令显示中文或英文' : 'Choose whether this plugin shows command palette commands in Chinese or English',
      apiSection: isZh ? 'API 配置' : 'API Configuration',
      provider: isZh ? '服务商' : 'Provider',
      providerDesc: isZh ? '选择常用 API 服务商' : 'Pick a common API provider',
      custom: isZh ? '自定义' : 'Custom',
      apiBaseUrl: isZh ? 'API Base URL' : 'API Base URL',
      apiBaseUrlDesc: isZh ? '聊天 / 问答 API 地址' : 'Chat / QA API endpoint URL',
      apiKey: isZh ? 'API 密钥' : 'API Key',
      apiKeyDesc: isZh ? '你的 API 密钥' : 'Your API key',
      chatModel: isZh ? '对话模型' : 'Chat Model',
      chatModelDesc: isZh ? '用于对话 / 问答的模型' : 'Model for chat / QA',
      customChatModel: isZh ? '自定义对话模型' : 'Custom Chat Model',
      embeddingModel: isZh ? '嵌入模型' : 'Embedding Model',
      embeddingModelDesc: isZh ? '用于生成向量嵌入的模型' : 'Model for embeddings',
      customEmbeddingModel: isZh ? '自定义嵌入模型' : 'Custom Embedding Model',
      embeddingSection: isZh ? 'Embedding 配置' : 'Embedding Configuration',
      embeddingProvider: isZh ? 'Embedding 服务商' : 'Embedding Provider',
      embeddingProviderDesc: isZh ? '选择 Embedding API 服务商' : 'Select embedding API provider',
      embeddingNone: isZh ? '不使用（跟随上面的 API）' : 'None (use above API)',
      embeddingApiBaseUrl: isZh ? 'Embedding API Base URL' : 'Embedding API Base URL',
      embeddingApiBaseUrlDesc: isZh ? 'Embedding API 端点地址' : 'Embedding API endpoint URL',
      embeddingApiKey: isZh ? 'Embedding API 密钥' : 'Embedding API Key',
      embeddingApiKeyDesc: isZh ? 'Embedding API 密钥' : 'Embedding API key',
      embeddingCustomModel: isZh ? '自定义嵌入模型' : 'Custom Embedding Model',
      indexSection: isZh ? '索引设置' : 'Index Settings',
      chunkSize: isZh ? '分块大小' : 'Chunk Size',
      chunkSizeDesc: isZh ? '每个文本块的字符数' : 'Characters per chunk',
      overlap: isZh ? '重叠字符数' : 'Overlap Characters',
      overlapDesc: isZh ? '相邻文本块之间的重叠字符数' : 'Overlap between adjacent chunks',
      autoIndex: isZh ? '文件变更时自动索引' : 'Auto Index on File Change',
      autoIndexDesc: isZh ? '文件修改时自动更新索引' : 'Update index when files change',
      searchSection: isZh ? '搜索设置' : 'Search Settings',
      topK: isZh ? '返回结果数量' : 'Top K',
      topKDesc: isZh ? '最终返回的搜索结果数量' : 'Number of final search results',
      hybridSearch: isZh ? '启用混合搜索' : 'Enable Hybrid Search',
      hybridSearchDesc: isZh ? '结合向量搜索和关键词搜索' : 'Combine vector search and keyword search',
      maxContext: isZh ? '最大上下文字符数' : 'Max Context Characters',
      maxContextDesc: isZh ? 'RAG 问答时的最大上下文长度' : 'Max context length for RAG QA',
      answerSection: isZh ? '回答与反馈优化' : 'Answer and Feedback Tuning',
      faqThreshold: isZh ? 'FAQ 强命中阈值' : 'FAQ Strong Match Threshold',
      faqThresholdDesc: isZh ? '越低越容易直接使用 FAQ 直答' : 'Lower values make FAQ direct answers easier to trigger',
      wikiRatio: isZh ? 'Wiki 上下文比例' : 'Wiki Context Ratio',
      wikiRatioDesc: isZh ? '分配给 Wiki 图谱上下文的比例' : 'Portion of context budget reserved for Wiki graph context',
      vectorRatio: isZh ? '向量上下文比例' : 'Vector Context Ratio',
      vectorRatioDesc: isZh ? '分配给向量召回上下文的比例' : 'Portion of context budget reserved for vector recall context',
      answerTemplate: isZh ? '回答模板' : 'Answer Template',
      answerTemplateDesc: isZh ? '结构化回答更清晰，简洁回答更紧凑' : 'Structured answers are clearer; concise answers are tighter',
      answerTemplateStructured: isZh ? '结构化' : 'Structured',
      answerTemplateConcise: isZh ? '简洁' : 'Concise',
      advancedSection: isZh ? '高级搜索' : 'Advanced Search',
      advancedDesc: isZh ? '包含查询分析、多路召回、重排序、上下文压缩等高级功能' : 'Includes query analysis, multi-recall, reranking, and context compression',
      wikiSection: isZh ? 'Wiki 设置' : 'Wiki Settings',
      wikiDesc: isZh ? 'LLM Wiki：使用 LLM 维护结构化知识库，持久化知识积累' : 'LLM Wiki: use an LLM to maintain a structured knowledge base',
      wikiEnable: isZh ? '启用 Wiki' : 'Enable Wiki',
      wikiEnableDesc: isZh ? '启用持久 LLM Wiki 功能' : 'Enable persistent LLM Wiki support',
      wikiPath: isZh ? 'Wiki 路径' : 'Wiki Path',
      wikiPathDesc: isZh ? 'Wiki 目录路径（相对于 vault 根目录）' : 'Wiki directory path relative to the vault root',
      wikiAutoIngest: isZh ? '自动导入' : 'Auto Ingest',
      wikiAutoIngestDesc: isZh ? '文件变更后自动把非 Wiki 笔记导入到 Wiki（实验性，可能消耗 API）' : 'Automatically ingest changed non-Wiki notes into the Wiki (experimental, may use API credits)',
      wikiPriority: isZh ? 'Wiki 优先级' : 'Wiki Priority',
      wikiPriorityDesc: isZh ? 'Wiki 页面在检索中的权重提升倍数（1.0 = 无提升）' : 'Wiki page priority multiplier in search (1.0 = no boost)'
    };

    containerEl.createEl('h2', { text: t.title });

    new Setting(containerEl)
      .setName(t.language)
      .setDesc(t.languageDesc)
      .addDropdown(dropdown => dropdown
        .addOption('zh-CN', '中文')
        .addOption('en', 'English')
        .setValue(this.plugin.settings.language || 'zh-CN')
        .onChange(async (value) => {
          this.plugin.settings.language = value as 'zh-CN' | 'en';
          await this.plugin.saveSettings();
          this.plugin.refreshLocalizedCommandLabels();
          new Notice(value === 'zh-CN' ? '语言已切换为中文' : 'Language switched to English');
          this.display();
        }));

    new Setting(containerEl)
      .setName(t.commandLanguage)
      .setDesc(t.commandLanguageDesc)
      .addDropdown(dropdown => dropdown
        .addOption('zh-CN', '中文')
        .addOption('en', 'English')
        .setValue(this.plugin.settings.commandLanguage || this.plugin.settings.language || 'zh-CN')
        .onChange(async (value) => {
          this.plugin.settings.commandLanguage = value as 'zh-CN' | 'en';
          await this.plugin.saveSettings();
          this.plugin.refreshLocalizedCommandLabels();
          new Notice(value === 'zh-CN' ? '命令语言已切换为中文' : 'Command language switched to English');
        }));

    containerEl.createEl('h3', { text: t.apiSection });

    const currentProvider = this.getProviderByBaseUrl(this.plugin.settings.apiBaseUrl);

    new Setting(containerEl)
      .setName(t.provider)
      .setDesc(t.providerDesc)
      .addDropdown(dropdown => {
        dropdown.addOption('custom', t.custom);
        this.providers.forEach(provider => {
          dropdown.addOption(provider.name, provider.name);
        });

        dropdown.setValue(currentProvider ? currentProvider.name : 'custom');
        dropdown.onChange(async (value) => {
          if (value === 'custom') {
            this.plugin.settings.provider = 'custom';
            await this.plugin.saveSettings();
            return;
          }

          const provider = this.getProviderByName(value);
          if (!provider) {
            return;
          }

          this.plugin.settings.provider = provider.name;
          this.plugin.settings.apiBaseUrl = provider.baseUrl;
          if (provider.models.length > 0) {
            this.plugin.settings.chatModel = provider.models[0];
          }
          if (provider.embeddingModels.length > 0) {
            this.plugin.settings.embeddingModel = provider.embeddingModels[0];
          }
          await this.plugin.saveSettings();
          this.plugin.rebuildServices();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName(t.apiBaseUrl)
      .setDesc(t.apiBaseUrlDesc)
      .addText(text => text
        .setPlaceholder('https://api.openai.com/v1')
        .setValue(this.plugin.settings.apiBaseUrl)
        .onChange(async (value) => {
          this.plugin.settings.apiBaseUrl = value.trim();
          await this.plugin.saveSettings();
          this.plugin.rebuildServices();
          this.display();
        }));

    new Setting(containerEl)
      .setName(t.apiKey)
      .setDesc(t.apiKeyDesc)
      .addText(text => text
        .setPlaceholder('sk-...')
        .setValue(this.plugin.settings.apiKey)
        .onChange(async (value) => {
          this.plugin.settings.apiKey = value.trim();
          await this.plugin.saveSettings();
          this.plugin.rebuildServices();
        }));

    new Setting(containerEl)
      .setName(t.chatModel)
      .setDesc(t.chatModelDesc)
      .addDropdown(dropdown => {
        if (currentProvider && currentProvider.models.length > 0) {
          currentProvider.models.forEach(model => {
            dropdown.addOption(model, model);
          });
          dropdown.addOption('custom', t.custom);
          dropdown.setValue(currentProvider.models.includes(this.plugin.settings.chatModel) ? this.plugin.settings.chatModel : 'custom');
          dropdown.onChange(async (value) => {
            if (value === 'custom') {
              this.display();
              return;
            }
            this.plugin.settings.chatModel = value;
            await this.plugin.saveSettings();
            this.plugin.rebuildServices();
            this.display();
          });
        } else {
          dropdown.addOption('custom', t.custom);
          dropdown.setValue('custom');
          dropdown.onChange(() => {
            this.display();
          });
        }
      });

    if (!currentProvider || currentProvider.models.length === 0 || !currentProvider.models.includes(this.plugin.settings.chatModel)) {
      new Setting(containerEl)
        .setName(t.customChatModel)
        .setDesc(t.chatModelDesc)
        .addText(text => text
          .setPlaceholder('gpt-3.5-turbo')
          .setValue(this.plugin.settings.chatModel)
          .onChange(async (value) => {
            this.plugin.settings.chatModel = value.trim();
            await this.plugin.saveSettings();
            this.plugin.rebuildServices();
          }));
    }

    containerEl.createEl('h3', { text: t.embeddingSection });

    const currentEmbeddingProvider = this.getProviderByBaseUrl(this.plugin.settings.embeddingApiBaseUrl || '');

    new Setting(containerEl)
      .setName(t.embeddingProvider)
      .setDesc(t.embeddingProviderDesc)
      .addDropdown(dropdown => {
        dropdown.addOption('none', t.embeddingNone);
        this.providers.forEach(provider => {
          if (provider.embeddingModels.length > 0) {
            dropdown.addOption(provider.name, provider.name);
          }
        });
        dropdown.addOption('custom', t.custom);

        const selected = !this.plugin.settings.embeddingApiBaseUrl
          ? 'none'
          : currentEmbeddingProvider
            ? currentEmbeddingProvider.name
            : 'custom';

        dropdown.setValue(selected);
        dropdown.onChange(async (value) => {
          if (value === 'none') {
            this.plugin.settings.embeddingApiBaseUrl = '';
            this.plugin.settings.embeddingApiKey = '';
            await this.plugin.saveSettings();
            this.plugin.rebuildServices();
            this.display();
            return;
          }

          if (value === 'custom') {
            this.display();
            return;
          }

          const provider = this.getProviderByName(value);
          if (!provider) {
            return;
          }

          this.plugin.settings.embeddingApiBaseUrl = provider.baseUrl;
          if (provider.embeddingModels.length > 0) {
            this.plugin.settings.embeddingModel = provider.embeddingModels[0];
          }
          await this.plugin.saveSettings();
          this.plugin.rebuildServices();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName(t.embeddingApiBaseUrl)
      .setDesc(t.embeddingApiBaseUrlDesc)
      .addText(text => text
        .setPlaceholder('https://api.siliconflow.cn/v1')
        .setValue(this.plugin.settings.embeddingApiBaseUrl || '')
        .onChange(async (value) => {
          this.plugin.settings.embeddingApiBaseUrl = value.trim();
          await this.plugin.saveSettings();
          this.plugin.rebuildServices();
          this.display();
        }));

    new Setting(containerEl)
      .setName(t.embeddingApiKey)
      .setDesc(t.embeddingApiKeyDesc)
      .addText(text => text
        .setPlaceholder('sk-...')
        .setValue(this.plugin.settings.embeddingApiKey || '')
        .onChange(async (value) => {
          this.plugin.settings.embeddingApiKey = value.trim();
          await this.plugin.saveSettings();
          this.plugin.rebuildServices();
        }));

    new Setting(containerEl)
      .setName(t.embeddingModel)
      .setDesc(t.embeddingModelDesc)
      .addDropdown(dropdown => {
        if (currentEmbeddingProvider && currentEmbeddingProvider.embeddingModels.length > 0) {
          currentEmbeddingProvider.embeddingModels.forEach(model => {
            dropdown.addOption(model, model);
          });
          dropdown.addOption('custom', t.custom);
          dropdown.setValue(currentEmbeddingProvider.embeddingModels.includes(this.plugin.settings.embeddingModel) ? this.plugin.settings.embeddingModel : 'custom');
          dropdown.onChange(async (value) => {
            if (value === 'custom') {
              this.display();
              return;
            }
            this.plugin.settings.embeddingModel = value;
            await this.plugin.saveSettings();
            this.showRebuildWarning(isZh ? '嵌入模型已更改' : 'Embedding model changed');
            this.display();
          });
        } else {
          dropdown.addOption('custom', t.custom);
          dropdown.setValue('custom');
          dropdown.onChange(() => {
            this.display();
          });
        }
      });

    if (!currentEmbeddingProvider || currentEmbeddingProvider.embeddingModels.length === 0 || !currentEmbeddingProvider.embeddingModels.includes(this.plugin.settings.embeddingModel)) {
      new Setting(containerEl)
        .setName(t.customEmbeddingModel)
        .setDesc(t.embeddingModelDesc)
        .addText(text => text
          .setPlaceholder('BAAI/bge-m3')
          .setValue(this.plugin.settings.embeddingModel)
          .onChange(async (value) => {
            this.plugin.settings.embeddingModel = value.trim();
            await this.plugin.saveSettings();
            this.showRebuildWarning(isZh ? '嵌入模型已更改' : 'Embedding model changed');
          }));
    }

    containerEl.createEl('h3', { text: t.indexSection });

    new Setting(containerEl)
      .setName(t.chunkSize)
      .setDesc(t.chunkSizeDesc)
      .addText(text => text
        .setPlaceholder('800')
        .setValue(String(this.plugin.settings.chunkSize))
        .onChange(async (value) => {
          this.plugin.settings.chunkSize = parseInt(value) || 800;
          await this.plugin.saveSettings();
          this.showRebuildWarning(isZh ? '分块大小已更改' : 'Chunk size changed');
        }));

    new Setting(containerEl)
      .setName(t.overlap)
      .setDesc(t.overlapDesc)
      .addText(text => text
        .setPlaceholder('150')
        .setValue(String(this.plugin.settings.overlap))
        .onChange(async (value) => {
          this.plugin.settings.overlap = parseInt(value) || 150;
          await this.plugin.saveSettings();
          this.showRebuildWarning(isZh ? '重叠字符数已更改' : 'Overlap changed');
        }));

    new Setting(containerEl)
      .setName(t.autoIndex)
      .setDesc(t.autoIndexDesc)
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoIndexOnFileChange)
        .onChange(async (value) => {
          this.plugin.settings.autoIndexOnFileChange = value;
          await this.plugin.saveSettings();
          this.plugin.syncScheduler();
        }));

    containerEl.createEl('h3', { text: t.searchSection });

    new Setting(containerEl)
      .setName(t.topK)
      .setDesc(t.topKDesc)
      .addText(text => text
        .setPlaceholder('6')
        .setValue(String(this.plugin.settings.topK))
        .onChange(async (value) => {
          this.plugin.settings.topK = parseInt(value) || 6;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(t.hybridSearch)
      .setDesc(t.hybridSearchDesc)
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableHybridSearch)
        .onChange(async (value) => {
          this.plugin.settings.enableHybridSearch = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(t.maxContext)
      .setDesc(t.maxContextDesc)
      .addText(text => text
        .setPlaceholder('6000')
        .setValue(String(this.plugin.settings.maxContextChars))
        .onChange(async (value) => {
          this.plugin.settings.maxContextChars = parseInt(value) || 6000;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl('h3', { text: t.answerSection });

    new Setting(containerEl)
      .setName(t.faqThreshold)
      .setDesc(t.faqThresholdDesc)
      .addText(text => text
        .setPlaceholder('0.88')
        .setValue(String(this.plugin.settings.faqStrongMatchThreshold))
        .onChange(async (value) => {
          this.plugin.settings.faqStrongMatchThreshold = parseFloat(value) || 0.88;
          await this.plugin.saveSettings();
          this.plugin.rebuildServices();
        }));

    new Setting(containerEl)
      .setName(t.wikiRatio)
      .setDesc(t.wikiRatioDesc)
      .addText(text => text
        .setPlaceholder('0.35')
        .setValue(String(this.plugin.settings.wikiContextRatio))
        .onChange(async (value) => {
          this.plugin.settings.wikiContextRatio = parseFloat(value) || 0.35;
          await this.plugin.saveSettings();
          this.plugin.rebuildServices();
        }));

    new Setting(containerEl)
      .setName(t.vectorRatio)
      .setDesc(t.vectorRatioDesc)
      .addText(text => text
        .setPlaceholder('0.35')
        .setValue(String(this.plugin.settings.vectorContextRatio))
        .onChange(async (value) => {
          this.plugin.settings.vectorContextRatio = parseFloat(value) || 0.35;
          await this.plugin.saveSettings();
          this.plugin.rebuildServices();
        }));

    new Setting(containerEl)
      .setName(t.answerTemplate)
      .setDesc(t.answerTemplateDesc)
      .addDropdown(dropdown => dropdown
        .addOption('structured', t.answerTemplateStructured)
        .addOption('concise', t.answerTemplateConcise)
        .setValue(this.plugin.settings.answerTemplate)
        .onChange(async (value) => {
          this.plugin.settings.answerTemplate = value as 'structured' | 'concise';
          await this.plugin.saveSettings();
          this.plugin.rebuildServices();
        }));

    containerEl.createEl('h3', { text: t.advancedSection });
    containerEl.createEl('p', {
      text: t.advancedDesc,
      cls: 'setting-item-description'
    });

    new Setting(containerEl)
      .setName(isZh ? '启用查询分析' : 'Enable Query Analysis')
      .setDesc(isZh ? '独立问题生成、查询变体、过滤器推断' : 'Standalone question generation, query variants, and filter inference')
      .addToggle(toggle => toggle
        .setValue(true)
        .setDisabled(true));

    new Setting(containerEl)
      .setName(isZh ? '启用重排序' : 'Enable Reranking')
      .setDesc(isZh ? '使用 LLM 对候选结果重新排序以提高相关性' : 'Use an LLM to rerank candidates for better relevance')
      .addToggle(toggle => toggle
        .setValue(true)
        .setDisabled(true));

    new Setting(containerEl)
      .setName(isZh ? '启用上下文压缩' : 'Enable Context Compression')
      .setDesc(isZh ? '父子文本块、句子窗口、token 预算管理' : 'Parent/child blocks, sentence windows, and token budget management')
      .addToggle(toggle => toggle
        .setValue(true)
        .setDisabled(true));

    containerEl.createEl('h3', { text: t.wikiSection });
    containerEl.createEl('p', {
      text: t.wikiDesc,
      cls: 'setting-item-description'
    });

    new Setting(containerEl)
      .setName(t.wikiEnable)
      .setDesc(t.wikiEnableDesc)
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableWiki)
        .onChange(async (value) => {
          this.plugin.settings.enableWiki = value;
          await this.plugin.saveSettings();
          this.plugin.rebuildServices();

          if (value) {
            new Notice(isZh ? 'Wiki 已启用，请运行 "Initialize Wiki" 命令初始化' : 'Wiki enabled. Run the "Initialize Wiki" command to initialize it.');
          }
        }));

    new Setting(containerEl)
      .setName(t.wikiPath)
      .setDesc(t.wikiPathDesc)
      .addText(text => text
        .setPlaceholder('_wiki')
        .setValue(this.plugin.settings.wikiPath)
        .onChange(async (value) => {
          this.plugin.settings.wikiPath = value || '_wiki';
          await this.plugin.saveSettings();
          this.plugin.rebuildServices();
        }));

    new Setting(containerEl)
      .setName(t.wikiAutoIngest)
      .setDesc(t.wikiAutoIngestDesc)
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.wikiAutoIngest)
        .onChange(async (value) => {
          this.plugin.settings.wikiAutoIngest = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName(t.wikiPriority)
      .setDesc(t.wikiPriorityDesc)
      .addText(text => text
        .setPlaceholder('1.5')
        .setValue(String(this.plugin.settings.wikiPriority))
        .onChange(async (value) => {
          this.plugin.settings.wikiPriority = parseFloat(value) || 1.5;
          await this.plugin.saveSettings();
        }));
  }

  private showRebuildWarning(reason: string) {
    new Notice(`⚠️ ${reason}。请运行 "Build AI Index" 命令重建索引以应用新设置。`, 8000);
  }
}
