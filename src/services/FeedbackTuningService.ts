import AiRagPlugin from '../main';
import { FeedbackEvent, PluginSettings, TuningDecision, TuningProposal } from '../types/index';
import { ObsidianJsonFileAdapter } from './Storage';

export class FeedbackTuningService {
  private plugin: AiRagPlugin;
  private adapter: ObsidianJsonFileAdapter;
  private basePath: string;
  private readonly feedbackEventsFile = 'feedback-events.json';
  private readonly tuningProposalsFile = 'tuning-proposals.json';
  private readonly tuningDecisionsFile = 'tuning-decisions.json';

  constructor(plugin: AiRagPlugin, adapter: ObsidianJsonFileAdapter, basePath: string) {
    this.plugin = plugin;
    this.adapter = adapter;
    this.basePath = basePath;
  }

  async recordFeedback(event: FeedbackEvent): Promise<{ proposal?: TuningProposal | null }> {
    const events = await this.loadFeedbackEvents();
    events.push(event);
    await this.saveFeedbackEvents(events);

    if (event.feedbackValue > 0) {
      return { proposal: null };
    }

    const proposal = await this.maybeCreateProposal(events);
    return { proposal };
  }

  async markCorrected(question: string, answer: string): Promise<void> {
    const events = await this.loadFeedbackEvents();
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (event.question === question && event.answer === answer && !event.corrected) {
        event.corrected = true;
        break;
      }
    }
    await this.saveFeedbackEvents(events);
  }

  async applyProposal(proposalId: string): Promise<{ proposal: TuningProposal; decision: TuningDecision; reportPath: string }> {
    const proposals = await this.loadProposals();
    const proposal = proposals.find(item => item.id === proposalId);
    if (!proposal) {
      throw new Error('找不到要应用的调参建议');
    }

    const beforeSettings = this.snapshotSettings(this.plugin.settings);
    const nextSettings: PluginSettings = {
      ...this.plugin.settings,
      ...proposal.suggestedSettings
    };

    this.normalizeSettings(nextSettings);
    this.plugin.settings = nextSettings;
    await this.plugin.saveSettings();
    this.plugin.rebuildServices();
    this.plugin.syncScheduler();
    this.plugin.refreshLocalizedCommandLabels();

    proposal.status = 'applied';
    const reportPath = await this.generateReport(proposal, beforeSettings, this.snapshotSettings(nextSettings));
    proposal.reportPath = reportPath;
    await this.saveProposals(proposals);

    const decisions = await this.loadDecisions();
    const decision: TuningDecision = {
      proposalId,
      decidedAt: Date.now(),
      status: 'applied',
      beforeSettings,
      afterSettings: this.snapshotSettings(nextSettings)
    };
    decisions.push(decision);
    await this.saveDecisions(decisions);

    return { proposal, decision, reportPath };
  }

  async dismissProposal(proposalId: string): Promise<void> {
    const proposals = await this.loadProposals();
    const proposal = proposals.find(item => item.id === proposalId);
    if (!proposal) {
      return;
    }

    proposal.status = 'dismissed';
    await this.saveProposals(proposals);

    const decisions = await this.loadDecisions();
    decisions.push({
      proposalId,
      decidedAt: Date.now(),
      status: 'dismissed',
      beforeSettings: this.snapshotSettings(this.plugin.settings),
      afterSettings: this.snapshotSettings(this.plugin.settings)
    });
    await this.saveDecisions(decisions);
  }

  async generateCurrentReport(): Promise<string> {
    const events = await this.loadFeedbackEvents();
    const proposals = await this.loadProposals();
    const currentSettings = this.snapshotSettings(this.plugin.settings);
    const negativeCount = events.filter(event => event.feedbackValue < 0).length;
    const avgTotalMs = this.average(events.map(event => event.timings?.total || 0));
    const markdown = `# Feedback Tuning Report

生成时间: ${new Date().toISOString()}

## 当前设置

\`\`\`json
${JSON.stringify(currentSettings, null, 2)}
\`\`\`

## 反馈统计

- 总反馈数: ${events.length}
- 负反馈数: ${negativeCount}
- 负反馈率: ${events.length > 0 ? ((negativeCount / events.length) * 100).toFixed(1) : '0.0'}%
- 平均总耗时: ${avgTotalMs.toFixed(0)}ms

## 最近建议

${proposals.slice(-5).reverse().map(proposal => `- ${new Date(proposal.createdAt).toLocaleString()} | ${proposal.status} | ${proposal.summary}`).join('\n') || '- 暂无'}
`;

    const path = `${this.basePath}/feedback-tuning-report-latest.md`;
    await this.write(path, markdown);
    return path;
  }

  private async maybeCreateProposal(events: FeedbackEvent[]): Promise<TuningProposal | null> {
    const recentEvents = events.slice(-12);
    if (recentEvents.length < 4) {
      return null;
    }

    const proposals = await this.loadProposals();
    const lastPending = [...proposals].reverse().find(item => item.status === 'pending');
    if (lastPending) {
      return null;
    }

    const negativeEvents = recentEvents.filter(event => event.feedbackValue < 0);
    const correctedNegatives = negativeEvents.filter(event => event.corrected);
    const negativeRate = negativeEvents.length / recentEvents.length;
    const avgTotalMs = this.average(recentEvents.map(event => event.timings?.total || 0));
    const avgRecallCount = this.average(recentEvents.map(event => event.wikiPageCount + event.vectorSourceCount));

    if (negativeEvents.length < 3 || negativeRate < 0.5) {
      return null;
    }

    const reasons: string[] = [];
    const suggestedSettings: TuningProposal['suggestedSettings'] = {};
    const current = this.plugin.settings;

    if (avgTotalMs > 9000) {
      reasons.push(`最近回答平均耗时 ${avgTotalMs.toFixed(0)}ms，整体偏慢。`);
      suggestedSettings.topK = Math.max(4, current.topK - 1);
      suggestedSettings.maxContextChars = Math.max(4500, current.maxContextChars - 800);
      suggestedSettings.vectorContextRatio = Math.max(0.2, Number((current.vectorContextRatio - 0.05).toFixed(2)));
    }

    if (avgRecallCount < 3) {
      reasons.push('最近负反馈里召回来源偏少，可能存在漏召回。');
      suggestedSettings.topK = Math.min(10, Math.max(suggestedSettings.topK ?? current.topK, current.topK + 1));
      suggestedSettings.wikiPriority = Number(Math.min(4, current.wikiPriority + 0.3).toFixed(2));
      suggestedSettings.wikiContextRatio = Math.min(0.55, Number((current.wikiContextRatio + 0.05).toFixed(2)));
    }

    if (correctedNegatives.length >= 2) {
      reasons.push('近期多次出现“负反馈后又纠正”的情况，说明答案结构或 FAQ 命中还有改进空间。');
      suggestedSettings.faqStrongMatchThreshold = Math.max(0.8, Number((current.faqStrongMatchThreshold - 0.02).toFixed(2)));
      suggestedSettings.answerTemplate = 'structured';
    }

    if (Object.keys(suggestedSettings).length === 0) {
      return null;
    }

    const proposal: TuningProposal = {
      id: `proposal-${Date.now()}`,
      createdAt: Date.now(),
      summary: '根据近期负反馈，建议调整检索与回答参数。',
      reasons,
      suggestedSettings,
      metrics: {
        totalFeedback: recentEvents.length,
        negativeFeedback: negativeEvents.length,
        negativeRate,
        avgTotalMs
      },
      status: 'pending'
    };

    proposals.push(proposal);
    await this.saveProposals(proposals);
    return proposal;
  }

  private async generateReport(
    proposal: TuningProposal,
    beforeSettings: TuningDecision['beforeSettings'],
    afterSettings: TuningDecision['afterSettings']
  ): Promise<string> {
    const events = await this.loadFeedbackEvents();
    const recentEvents = events.slice(-12);
    const path = `${this.basePath}/feedback-tuning-report-${proposal.id}.md`;
    const markdown = `# Feedback Tuning Report

生成时间: ${new Date().toISOString()}

## 建议摘要

${proposal.summary}

## 原因

${proposal.reasons.map(reason => `- ${reason}`).join('\n')}

## 应用前设置

\`\`\`json
${JSON.stringify(beforeSettings, null, 2)}
\`\`\`

## 应用后设置

\`\`\`json
${JSON.stringify(afterSettings, null, 2)}
\`\`\`

## 最近反馈快照

${recentEvents.map(event => `- ${new Date(event.createdAt).toLocaleString()} | ${event.feedbackValue > 0 ? '满意' : '不满意'} | ${event.question}`).join('\n') || '- 暂无'}
`;

    await this.write(path, markdown);
    return path;
  }

  private normalizeSettings(settings: PluginSettings): void {
    settings.topK = Math.max(3, Math.min(10, Math.round(settings.topK)));
    settings.maxContextChars = Math.max(3000, Math.min(12000, Math.round(settings.maxContextChars)));
    settings.wikiPriority = Math.max(1, Math.min(4, Number(settings.wikiPriority.toFixed(2))));
    settings.faqStrongMatchThreshold = Math.max(0.75, Math.min(0.95, Number(settings.faqStrongMatchThreshold.toFixed(2))));
    settings.wikiContextRatio = Math.max(0.2, Math.min(0.6, Number(settings.wikiContextRatio.toFixed(2))));
    settings.vectorContextRatio = Math.max(0.2, Math.min(0.6, Number(settings.vectorContextRatio.toFixed(2))));

    if (settings.wikiContextRatio + settings.vectorContextRatio > 0.9) {
      const total = settings.wikiContextRatio + settings.vectorContextRatio;
      settings.wikiContextRatio = Number(((settings.wikiContextRatio / total) * 0.9).toFixed(2));
      settings.vectorContextRatio = Number(((settings.vectorContextRatio / total) * 0.9).toFixed(2));
    }
  }

  private snapshotSettings(settings: PluginSettings): TuningDecision['beforeSettings'] {
    return {
      topK: settings.topK,
      maxContextChars: settings.maxContextChars,
      wikiPriority: settings.wikiPriority,
      faqStrongMatchThreshold: settings.faqStrongMatchThreshold,
      wikiContextRatio: settings.wikiContextRatio,
      vectorContextRatio: settings.vectorContextRatio,
      answerTemplate: settings.answerTemplate
    };
  }

  private average(values: number[]): number {
    const valid = values.filter(value => Number.isFinite(value) && value > 0);
    if (valid.length === 0) {
      return 0;
    }
    return valid.reduce((sum, value) => sum + value, 0) / valid.length;
  }

  private async loadFeedbackEvents(): Promise<FeedbackEvent[]> {
    return await this.readJson<FeedbackEvent[]>(`${this.basePath}/${this.feedbackEventsFile}`) || [];
  }

  private async saveFeedbackEvents(events: FeedbackEvent[]): Promise<void> {
    await this.writeJson(`${this.basePath}/${this.feedbackEventsFile}`, events);
  }

  private async loadProposals(): Promise<TuningProposal[]> {
    return await this.readJson<TuningProposal[]>(`${this.basePath}/${this.tuningProposalsFile}`) || [];
  }

  private async saveProposals(proposals: TuningProposal[]): Promise<void> {
    await this.writeJson(`${this.basePath}/${this.tuningProposalsFile}`, proposals);
  }

  private async loadDecisions(): Promise<TuningDecision[]> {
    return await this.readJson<TuningDecision[]>(`${this.basePath}/${this.tuningDecisionsFile}`) || [];
  }

  private async saveDecisions(decisions: TuningDecision[]): Promise<void> {
    await this.writeJson(`${this.basePath}/${this.tuningDecisionsFile}`, decisions);
  }

  private async readJson<T>(path: string): Promise<T | null> {
    try {
      const content = await this.adapter.read(path);
      const parsed: unknown = JSON.parse(content);
      return parsed as T;
    } catch {
      return null;
    }
  }

  private async writeJson(path: string, data: unknown): Promise<void> {
    await this.adapter.mkdir(this.basePath);
    await this.adapter.write(path, JSON.stringify(data, null, 2));
  }

  private async write(path: string, content: string): Promise<void> {
    await this.adapter.mkdir(this.basePath);
    await this.adapter.write(path, content);
  }
}
