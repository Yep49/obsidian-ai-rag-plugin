import { ItemView, WorkspaceLeaf, Notice, MarkdownRenderer } from 'obsidian';
import AiRagPlugin from '../main';
import { Citation, CorrectionContext } from '../types/index';

export const AI_RAG_SIDEBAR_VIEW = 'ai-rag-sidebar-view';

interface Message {
  role: 'user' | 'ai';
  content: string;
  citations?: Citation[];
  correctionContext?: CorrectionContext;
}

export class AiRagSidebarView extends ItemView {
  plugin: AiRagPlugin;
  private chatEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private messages: Message[] = [];

  constructor(leaf: WorkspaceLeaf, plugin: AiRagPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return AI_RAG_SIDEBAR_VIEW;
  }

  getDisplayText(): string {
    return this.plugin.t('AI RAG 助手', 'AI RAG Assistant');
  }

  getIcon(): string {
    return 'message-circle';
  }

  async onOpen() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('ai-rag-sidebar');

    const header = container.createDiv({ cls: 'ai-rag-sidebar-header' });
    header.createEl('h4', { text: this.plugin.t('AI RAG 助手', 'AI RAG Assistant') });

    this.chatEl = container.createDiv({ cls: 'ai-rag-sidebar-chat' });
    this.renderWelcome();

    const inputContainer = container.createDiv({ cls: 'ai-rag-sidebar-input' });

    this.inputEl = inputContainer.createEl('textarea', {
      cls: 'ai-rag-sidebar-textarea',
      placeholder: this.plugin.t('向你的知识库提问...', 'Ask your vault...')
    });
    this.inputEl.rows = 3;

    const btnRow = inputContainer.createDiv({ cls: 'ai-rag-sidebar-btn-row' });

    const sendBtn = btnRow.createEl('button', { text: this.plugin.t('发送', 'Send') });
    sendBtn.addEventListener('click', () => void this.sendMessage());

    const clearBtn = btnRow.createEl('button', { text: this.plugin.t('清空', 'Clear') });
    clearBtn.addEventListener('click', () => this.clearChat());

    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void this.sendMessage();
      }
    });
  }

  private renderWelcome() {
    this.chatEl.empty();
    const welcome = this.chatEl.createDiv({ cls: 'ai-rag-bubble ai-rag-bubble-ai' });
    welcome.createDiv({ cls: 'ai-rag-bubble-label', text: 'AI' });
    welcome.createDiv({
      cls: 'ai-rag-bubble-content',
      text: this.plugin.t('你好！我是你的知识库助手。有什么可以帮你的吗？', 'Hi! I am your vault assistant. What can I help you with?')
    });
  }

  private async sendMessage() {
    const question = this.inputEl.value.trim();
    if (!question) {
      new Notice(this.plugin.t('请输入问题', 'Please enter a question'));
      return;
    }

    await this.addMessage({ role: 'user', content: question });
    this.inputEl.value = '';

    const loadingBubble = this.chatEl.createDiv({ cls: 'ai-rag-bubble ai-rag-bubble-ai' });
    loadingBubble.createDiv({ cls: 'ai-rag-bubble-label', text: 'AI' });
    loadingBubble.createDiv({ cls: 'ai-rag-bubble-content', text: this.plugin.t('思考中...', 'Thinking...') });

    try {
      const result = await this.plugin.ragChat.ask(question);
      loadingBubble.remove();

      await this.addMessage({
        role: 'ai',
        content: result.answer,
        citations: result.citations,
        correctionContext: {
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
        }
      });

      await this.plugin.enhancementService.analyzeUserPattern(question);
    } catch (error) {
      console.error('Chat error:', error);
      loadingBubble.remove();
      await this.addMessage({
        role: 'ai',
        content: this.plugin.t(`抱歉，出现错误：${error}`, `Sorry, an error occurred: ${error}`)
      });
    }
  }

  private async addMessage(message: Message) {
    this.messages.push(message);

    const bubble = this.chatEl.createDiv({
      cls: `ai-rag-bubble ai-rag-bubble-${message.role}`
    });

    bubble.createDiv({
      cls: 'ai-rag-bubble-label',
      text: message.role === 'user' ? '你' : 'AI'
    });

    const content = bubble.createDiv({ cls: 'ai-rag-bubble-content markdown-rendered' });
    if (message.role === 'ai') {
      await MarkdownRenderer.renderMarkdown(message.content, content, '', this);
    } else {
      content.setText(message.content);
    }

    if (message.role === 'ai') {
      const actions = bubble.createDiv({ cls: 'ai-rag-sidebar-actions' });
      this.plugin.enhancementService.addCopyButton(actions, message.content);

      if (message.correctionContext) {
        this.plugin.enhancementService.addCorrectionButton(
          actions,
          message.correctionContext,
          () => new Notice(this.plugin.t('感谢反馈，下次类似问题会优先走 FAQ', 'Thanks. Similar questions will prefer FAQ next time.'))
        );
        this.plugin.enhancementService.addFeedbackButtons(actions, message.correctionContext);
      }
    }

    if (message.citations && message.citations.length > 0) {
      const citationsDiv = bubble.createDiv({ cls: 'ai-rag-sidebar-citations' });
      citationsDiv.createEl('strong', { text: this.plugin.t('引用：', 'Sources:') });

      message.citations.slice(0, 6).forEach((citation, index) => {
        const link = citationsDiv.createEl('a', {
          text: `[${index + 1}] ${citation.title}`,
          cls: 'ai-rag-sidebar-citation-link'
        });
        link.addEventListener('click', () => {
          this.plugin.openCitation(citation);
        });
        if (index < message.citations!.length - 1) {
          citationsDiv.appendText(' ');
        }
      });
    }

    this.chatEl.scrollTop = this.chatEl.scrollHeight;
  }

  private clearChat() {
    this.messages = [];
    this.renderWelcome();
  }

  async onClose() {
    // no-op
  }
}
