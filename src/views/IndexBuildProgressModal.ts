import { App, Modal } from 'obsidian';
import { BuildProgress } from '../types/index';

export class IndexBuildProgressModal extends Modal {
  private progressEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private percentEl!: HTMLElement;
  private fileEl!: HTMLElement;
  private progressBar!: HTMLElement;
  private metaEl!: HTMLElement;
  private actionsEl!: HTMLElement;

  constructor(app: App) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('ai-rag-build-progress');

    // 标题
    contentEl.createEl('h2', { text: '构建 AI 索引' });

    // 状态标签
    this.statusEl = contentEl.createDiv({ cls: 'ai-rag-build-status is-running' });
    this.statusEl.setText('构建中...');

    // 百分比
    this.percentEl = contentEl.createDiv({ cls: 'ai-rag-build-percent' });
    this.percentEl.setText('0%');

    // 进度条
    this.progressEl = contentEl.createDiv({ cls: 'ai-rag-progress-track' });
    this.progressBar = this.progressEl.createDiv({ cls: 'ai-rag-progress-bar' });
    this.progressBar.style.width = '0%';

    // 当前文件
    this.fileEl = contentEl.createDiv({ cls: 'ai-rag-build-file ai-rag-muted' });
    this.fileEl.setText('准备中...');

    // 元信息
    this.metaEl = contentEl.createDiv({ cls: 'ai-rag-build-meta' });

    // 操作按钮
    this.actionsEl = contentEl.createDiv({ cls: 'ai-rag-build-actions' });
  }

  updateProgress(progress: BuildProgress) {
    const percent = Math.round((progress.current / progress.total) * 100);

    this.percentEl.setText(`${percent}%`);
    this.progressBar.style.width = `${percent}%`;
    this.fileEl.setText(`${progress.phase}: ${progress.currentFile}`);

    this.metaEl.empty();
    this.metaEl.createDiv().setText(`进度: ${progress.current} / ${progress.total}`);
    this.metaEl.createDiv().setText(`阶段: ${progress.phase}`);
  }

  markCompleted(success: boolean, message: string) {
    this.statusEl.removeClass('is-running');

    if (success) {
      this.statusEl.addClass('is-success');
      this.statusEl.setText('✓ 完成');
      this.percentEl.setText('100%');
      this.progressBar.style.width = '100%';
    } else {
      this.statusEl.addClass('is-error');
      this.statusEl.setText('✗ 失败');
    }

    this.fileEl.setText(message);

    // 添加关闭按钮
    this.actionsEl.empty();
    const closeBtn = this.actionsEl.createEl('button', { text: '关闭' });
    closeBtn.addEventListener('click', () => this.close());
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
