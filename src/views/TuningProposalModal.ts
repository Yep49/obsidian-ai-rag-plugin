import { App, Modal, Notice } from 'obsidian';
import { TuningProposal } from '../types/index';

interface TuningProposalModalOptions {
  proposal: TuningProposal;
  language?: 'zh-CN' | 'en';
  onApply: () => Promise<{ reportPath: string }>;
  onDismiss: () => Promise<void>;
}

export class TuningProposalModal extends Modal {
  private options: TuningProposalModalOptions;

  constructor(app: App, options: TuningProposalModalOptions) {
    super(app);
    this.options = options;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('ai-rag-tuning-modal');
    const t = (zh: string, en: string) => this.options.language === 'en' ? en : zh;

    contentEl.createEl('h3', { text: t('建议调整参数', 'Suggested Parameter Tuning') });
    contentEl.createEl('p', { text: this.options.proposal.summary });

    const metrics = contentEl.createDiv({ cls: 'ai-rag-muted' });
    metrics.setText(
      t(
        `最近反馈 ${this.options.proposal.metrics.totalFeedback} 条，其中负反馈 ${this.options.proposal.metrics.negativeFeedback} 条，平均耗时 ${this.options.proposal.metrics.avgTotalMs.toFixed(0)}ms`,
        `Recent feedback: ${this.options.proposal.metrics.totalFeedback} items, ${this.options.proposal.metrics.negativeFeedback} negative, average latency ${this.options.proposal.metrics.avgTotalMs.toFixed(0)}ms`
      )
    );

    const reasonsTitle = contentEl.createEl('h4', { text: t('原因', 'Reasons') });
    reasonsTitle.addClass('ai-rag-tuning-heading');
    const reasonsList = contentEl.createEl('ul');
    this.options.proposal.reasons.forEach(reason => {
      reasonsList.createEl('li', { text: reason });
    });

    const settingsTitle = contentEl.createEl('h4', { text: t('建议改动', 'Suggested changes') });
    settingsTitle.addClass('ai-rag-tuning-heading');
    const settingList = contentEl.createEl('ul');
    Object.entries(this.options.proposal.suggestedSettings).forEach(([key, value]) => {
      settingList.createEl('li', { text: `${key}: ${value}` });
    });

    const actions = contentEl.createDiv({ cls: 'ai-rag-correction-actions' });
    const laterBtn = actions.createEl('button', { text: t('稍后处理', 'Later') });
    const applyBtn = actions.createEl('button', { text: t('应用建议', 'Apply suggestion'), cls: 'mod-cta' });

    laterBtn.addEventListener('click', async () => {
      await this.options.onDismiss();
      this.close();
    });

    applyBtn.addEventListener('click', async () => {
      applyBtn.disabled = true;
      applyBtn.setText(t('应用中...', 'Applying...'));
      try {
        const { reportPath } = await this.options.onApply();
        new Notice(t(`已应用建议，报告已生成: ${reportPath}`, `Applied suggestion. Report generated: ${reportPath}`));
        this.close();
      } catch (error) {
        console.error('应用调参建议失败:', error);
        new Notice(t(`应用失败: ${error instanceof Error ? error.message : String(error)}`, `Apply failed: ${error instanceof Error ? error.message : String(error)}`));
        applyBtn.disabled = false;
        applyBtn.setText(t('应用建议', 'Apply suggestion'));
      }
    });
  }

  onClose() {
    this.contentEl.empty();
  }
}
