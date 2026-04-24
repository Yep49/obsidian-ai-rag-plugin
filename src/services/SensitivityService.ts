import { App, Modal } from 'obsidian';
import { WikiService } from './WikiService';

export type SensitiveDecision = 'process' | 'private' | 'skip';

export class SensitivityService {
  private app: App;
  private wikiService: WikiService;

  private static readonly SENSITIVE_PATTERNS = [
    /password\s*[:=]/i,
    /passwd\s*[:=]/i,
    /api[_-]?key\s*[:=]/i,
    /secret\s*[:=]/i,
    /token\s*[:=]/i,
    /private[_-]?key/i,
    /-----BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/i,
    /密码\s*[:：]/,
    /密钥\s*[:：]/,
    /令牌\s*[:：]/,
    /身份证/,
    /银行卡/
  ];

  constructor(app: App, wikiService: WikiService) {
    this.app = app;
    this.wikiService = wikiService;
  }

  isSensitive(path: string, content: string): boolean {
    const haystack = `${path}\n${content}`;
    return SensitivityService.SENSITIVE_PATTERNS.some(pattern => pattern.test(haystack));
  }

  async decide(path: string, content: string): Promise<SensitiveDecision> {
    if (!this.isSensitive(path, content)) {
      return 'process';
    }

    return new Promise(resolve => {
      const modal = new SensitiveDecisionModal(this.app, path, resolve);
      modal.open();
    });
  }

  async markPrivate(path: string): Promise<string> {
    if (!this.wikiService.isInitialized()) {
      await this.wikiService.initializeWikiStructure();
    }

    const fileName = path.split('/').pop() || path;
    const title = `私密笔记 - ${fileName.replace(/\.md$/i, '')}`;
    const date = new Date().toISOString().split('T')[0];
    const content = `## 私密笔记

此笔记被用户标记为私密，不发送给 AI，不生成正文摘要，不做正文向量化。

## 原始位置

- [[${path}]]

## 标记时间

- ${date}
`;

    const wikiPath = await this.wikiService.createOrUpdatePage('meta', title, content, '私密笔记', 0);
    await this.wikiService.addLogEntry({
      timestamp: Date.now(),
      date,
      action: 'private',
      title: path,
      details: `- 标记为私密笔记: [[${wikiPath}]]`
    });

    return wikiPath;
  }
}

class SensitiveDecisionModal extends Modal {
  private path: string;
  private resolveDecision: (decision: SensitiveDecision) => void;
  private resolved = false;

  constructor(app: App, path: string, resolveDecision: (decision: SensitiveDecision) => void) {
    super(app);
    this.path = path;
    this.resolveDecision = resolveDecision;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: '检测到疑似敏感笔记' });
    contentEl.createEl('p', {
      text: `文件：${this.path}`
    });
    contentEl.createEl('p', {
      text: '请选择如何处理。标记为私密后，不会把正文发送给 AI，也不会对正文做向量化。'
    });

    const buttons = contentEl.createDiv({ attr: { style: 'display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;' } });

    const skipBtn = buttons.createEl('button', { text: '跳过' });
    const processBtn = buttons.createEl('button', { text: '正常处理' });
    const privateBtn = buttons.createEl('button', { text: '标记为私密', cls: 'mod-cta' });

    skipBtn.addEventListener('click', () => this.resolve('skip'));
    processBtn.addEventListener('click', () => this.resolve('process'));
    privateBtn.addEventListener('click', () => this.resolve('private'));
  }

  onClose() {
    if (!this.resolved) {
      this.resolveDecision('skip');
      this.resolved = true;
    }
    this.contentEl.empty();
  }

  private resolve(decision: SensitiveDecision) {
    if (!this.resolved) {
      this.resolveDecision(decision);
      this.resolved = true;
    }
    this.close();
  }
}
