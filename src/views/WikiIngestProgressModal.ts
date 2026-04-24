import { App, Modal } from 'obsidian';
import { WikiIngestResult } from '../types/index';

/**
 * WikiIngestProgressModal - Wiki 导入进度弹窗（支持交互模式）
 */
export class WikiIngestProgressModal extends Modal {
  private progressBar!: HTMLDivElement;
  private progressText!: HTMLDivElement;
  private currentFileText!: HTMLDivElement;
  private detailsText!: HTMLDivElement;
  private etaText!: HTMLDivElement;
  private percentageText!: HTMLDivElement;
  private interactiveMode: boolean = false;
  private continueButton?: HTMLButtonElement;
  private stopButton?: HTMLButtonElement;
  private startTime: number = 0;
  private continueResolve?: (value: boolean) => void;

  constructor(app: App, interactiveMode: boolean = false) {
    super(app);
    this.interactiveMode = interactiveMode;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('wiki-ingest-progress-modal');

    contentEl.createEl('h2', { text: 'Wiki 导入进度' });

    // 进度条容器
    const progressContainer = contentEl.createDiv({ cls: 'wiki-progress-container' });

    // 百分比显示
    this.percentageText = progressContainer.createDiv({
      cls: 'wiki-progress-percentage',
      text: '0%'
    });

    this.progressText = progressContainer.createDiv({
      cls: 'wiki-progress-text',
      text: '0 / 0'
    });

    const progressBarContainer = progressContainer.createDiv({
      cls: 'wiki-progress-bar-container'
    });

    this.progressBar = progressBarContainer.createDiv({
      cls: 'wiki-progress-bar'
    });

    this.currentFileText = progressContainer.createDiv({
      cls: 'wiki-current-file',
      text: '准备中...'
    });

    // 预估时间
    this.etaText = progressContainer.createDiv({
      cls: 'wiki-eta-text',
      text: ''
    });

    // 详情容器
    this.detailsText = contentEl.createDiv({
      cls: 'wiki-ingest-details',
      text: ''
    });

    // 交互模式按钮
    if (this.interactiveMode) {
      const buttonContainer = contentEl.createDiv({ cls: 'wiki-interactive-buttons' });

      this.continueButton = buttonContainer.createEl('button', {
        text: '继续下一个',
        cls: 'mod-cta'
      });

      this.stopButton = buttonContainer.createEl('button', {
        text: '停止导入'
      });

      this.continueButton.addEventListener('click', () => {
        if (this.continueResolve) {
          this.continueResolve(true);
          this.continueResolve = undefined;
        }
        this.continueButton!.disabled = true;
      });

      this.stopButton.addEventListener('click', () => {
        if (this.continueResolve) {
          this.continueResolve(false);
          this.continueResolve = undefined;
        }
        this.stopButton!.disabled = true;
      });

      // 初始禁用按钮
      this.continueButton.disabled = true;
      this.stopButton.disabled = false;
    }

    // 记录开始时间
    this.startTime = Date.now();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  /**
   * 更新进度
   */
  updateProgress(current: number, total: number, currentFile: string) {
    const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

    this.progressText.textContent = `${current} / ${total}`;
    this.percentageText.textContent = `${percentage}%`;
    this.progressBar.style.width = `${percentage}%`;
    this.currentFileText.textContent = `正在处理: ${currentFile}`;

    // 计算预估剩余时间
    if (current > 0 && current < total) {
      const elapsed = Date.now() - this.startTime;
      const avgTime = elapsed / current;
      const remaining = Math.round((total - current) * avgTime / 1000);

      if (remaining > 60) {
        const minutes = Math.floor(remaining / 60);
        const seconds = remaining % 60;
        this.etaText.textContent = `预计剩余: ${minutes}分${seconds}秒`;
      } else {
        this.etaText.textContent = `预计剩余: ${remaining}秒`;
      }
    }
  }

  /**
   * 更新详情
   */
  updateDetails(details: string) {
    this.detailsText.textContent = details;
  }

  /**
   * 显示当前文件的处理结果（交互模式）
   * 返回 Promise，等待用户点击继续或停止
   */
  showFileResult(result: WikiIngestResult): Promise<boolean> {
    const summary = `
创建页面: ${result.createdPages.length}
${result.createdPages.map(p => `  - ${p.type}: ${p.title}`).join('\n')}

更新页面: ${result.updatedPages.length}
${result.updatedPages.map(p => `  - ${p.type}: ${p.title}`).join('\n')}

${result.conflicts.length > 0 ? `冲突: ${result.conflicts.length}\n${result.conflicts.map(c => `  - ${c.issue}`).join('\n')}` : ''}
    `.trim();

    this.detailsText.textContent = summary;

    // 启用按钮
    if (this.continueButton) {
      this.continueButton.disabled = false;
    }
    if (this.stopButton) {
      this.stopButton.disabled = false;
    }

    // 返回 Promise，等待用户操作
    return new Promise((resolve) => {
      this.continueResolve = resolve;
    });
  }

  /**
   * 完成
   */
  complete(summary: string) {
    this.progressBar.style.width = '100%';
    this.percentageText.textContent = '100%';
    this.currentFileText.textContent = '✅ 导入完成！';
    this.etaText.textContent = '';
    this.detailsText.textContent = summary;

    // 禁用交互按钮
    if (this.continueButton) {
      this.continueButton.disabled = true;
    }
    if (this.stopButton) {
      this.stopButton.disabled = true;
    }

    // 3 秒后自动关闭
    setTimeout(() => {
      this.close();
    }, 3000);
  }
}
