import { App, TFile, TAbstractFile } from 'obsidian';
import { IndexBuilder } from './IndexBuilder';

interface QueuedUpdate {
  file?: TFile;
  path: string;
  type: 'create' | 'modify' | 'delete';
  timestamp: number;
}

export class IndexScheduler {
  private app: App;
  private indexBuilder: IndexBuilder;
  private shouldIgnore?: (path: string) => boolean;
  private disposed = false;
  private updateQueue: Map<string, QueuedUpdate> = new Map();
  private debounceTimer?: number;
  private isProcessing = false;
  private readonly DEBOUNCE_DELAY = 2000; // 2秒防抖
  private readonly BATCH_SIZE = 5; // 每批处理5个文件
  private readonly handleCreate = this.onFileCreate.bind(this);
  private readonly handleModify = this.onFileModify.bind(this);
  private readonly handleDelete = this.onFileDelete.bind(this);
  private readonly handleRename = this.onFileRename.bind(this);

  constructor(app: App, indexBuilder: IndexBuilder, shouldIgnore?: (path: string) => boolean) {
    this.app = app;
    this.indexBuilder = indexBuilder;
    this.shouldIgnore = shouldIgnore;
  }

  // 启动文件监听
  start() {
    if (this.disposed) {
      return;
    }

    // 监听文件创建
    this.app.vault.on('create', this.handleCreate);

    // 监听文件修改
    this.app.vault.on('modify', this.handleModify);

    // 监听文件删除
    this.app.vault.on('delete', this.handleDelete);

    // 监听文件重命名
    this.app.vault.on('rename', this.handleRename);

    console.debug('IndexScheduler: File watching started');
  }

  private onFileCreate(file: TAbstractFile) {
    if (!(file instanceof TFile) || file.extension !== 'md' || this.shouldIgnore?.(file.path)) {
      return;
    }

    this.queueUpdate(file, 'create');
  }

  private onFileModify(file: TAbstractFile) {
    if (!(file instanceof TFile) || file.extension !== 'md' || this.shouldIgnore?.(file.path)) {
      return;
    }

    this.queueUpdate(file, 'modify');
  }

  private onFileDelete(file: TAbstractFile) {
    if (!(file instanceof TFile) || file.extension !== 'md' || this.shouldIgnore?.(file.path)) {
      return;
    }

    this.queueUpdate(file, 'delete');
  }

  private onFileRename(file: TAbstractFile, oldPath: string) {
    if (!(file instanceof TFile) || file.extension !== 'md' || this.shouldIgnore?.(file.path)) {
      return;
    }

    // 重命名视为删除旧文件 + 创建新文件
    // 先删除旧路径的索引
    this.queueDeleteByPath(oldPath);

    // 再添加新文件
    this.queueUpdate(file, 'create');
  }

  private queueUpdate(file: TFile, type: 'create' | 'modify' | 'delete') {
    // 添加到队列（覆盖旧的更新）
    this.updateQueue.set(file.path, {
      file,
      path: file.path,
      type,
      timestamp: Date.now()
    });

    // 重置防抖计时器
    this.scheduleProcess();
  }

  enqueueUpdate(file: TFile, type: 'create' | 'modify' | 'delete') {
    if (this.shouldIgnore?.(file.path)) {
      return;
    }
    this.queueUpdate(file, type);
  }

  private queueDeleteByPath(path: string) {
    // 对于删除操作，我们需要记录路径
    this.updateQueue.set(path, {
      path,
      type: 'delete',
      timestamp: Date.now()
    });

    this.scheduleProcess();
  }

  private scheduleProcess() {
    if (this.debounceTimer) {
      window.clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = window.setTimeout(() => {
      void this.processQueue();
    }, this.DEBOUNCE_DELAY);
  }

  private async processQueue() {
    if (this.isProcessing || this.updateQueue.size === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      // 获取队列中的所有更新
      const updates = Array.from(this.updateQueue.values());
      this.updateQueue.clear();

      console.debug(`IndexScheduler: Processing ${updates.length} updates`);

      // 分批处理
      for (let i = 0; i < updates.length; i += this.BATCH_SIZE) {
        const batch = updates.slice(i, i + this.BATCH_SIZE);

        await Promise.all(
          batch.map(update => this.processUpdate(update))
        );
      }

      console.debug('IndexScheduler: Queue processed');
    } catch (error) {
      console.error('IndexScheduler: Error processing queue:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async processUpdate(update: QueuedUpdate) {
    try {
      switch (update.type) {
        case 'create':
        case 'modify':
          if (update.file) {
            await this.indexBuilder.updateFile(update.file);
          }
          break;
        case 'delete':
          await this.indexBuilder.deleteFile(update.path);
          break;
      }
    } catch (error) {
      console.error(`IndexScheduler: Error processing ${update.type} for ${update.path}:`, error);
    }
  }

  // 手动触发处理（用于测试）
  async flush() {
    if (this.debounceTimer) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }

    await this.processQueue();
  }

  dispose() {
    this.disposed = true;

    if (this.debounceTimer) {
      window.clearTimeout(this.debounceTimer);
    }

    // 移除事件监听
    this.app.vault.off('create', this.handleCreate);
    this.app.vault.off('modify', this.handleModify);
    this.app.vault.off('delete', this.handleDelete);
    this.app.vault.off('rename', this.handleRename);

    this.updateQueue.clear();

    console.debug('IndexScheduler: Disposed');
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  getQueueSize(): number {
    return this.updateQueue.size;
  }
}
