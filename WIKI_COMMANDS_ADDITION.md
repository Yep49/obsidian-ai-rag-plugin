// 在 main.ts 中添加 Wiki 审计命令

// 在现有的 Wiki 命令后添加：

this.addCommand({
  id: 'wiki-audit',
  name: 'Audit Wiki',
  callback: async () => {
    if (!this.settings.enableWiki) {
      new Notice('请先在设置中启用 Wiki 功能');
      return;
    }

    if (!this.wikiService.isInitialized()) {
      new Notice('请先初始化 Wiki');
      return;
    }

    if (!this.settings.apiKey) {
      new Notice('请先在设置页填写 API Key');
      return;
    }

    new Notice('开始审计 Wiki...');

    try {
      const { WikiAuditor } = await import('./services/WikiAuditor');
      const auditor = new WikiAuditor(
        this.app,
        this.wikiService,
        new OpenAiCompatibleLlmClient(
          new OpenAiCompatibleHttpClient(this.settings.apiBaseUrl, this.settings.apiKey),
          this.settings.chatModel
        )
      );

      const report = await auditor.auditWiki();
      const markdown = auditor.generateReportMarkdown(report);

      // 保存审计报告
      const reportPath = `${this.settings.wikiPath}/audit-report-${new Date().toISOString().split('T')[0]}.md`;
      await this.app.vault.create(reportPath, markdown);

      new Notice(`审计完成！报告已保存到: ${reportPath}`);
      this.app.workspace.openLinkText(reportPath, '', false);
    } catch (error) {
      console.error('Wiki 审计失败:', error);
      new Notice('Wiki 审计失败');
    }
  }
});

this.addCommand({
  id: 'wiki-retry-failures',
  name: 'Retry Failed LLM Calls',
  callback: async () => {
    if (!this.settings.enableWiki) {
      new Notice('请先在设置中启用 Wiki 功能');
      return;
    }

    const retryService = this.wikiBuilder.getRetryService();
    const failures = retryService.getFailureRecords();

    if (failures.length === 0) {
      new Notice('没有失败的 LLM 调用记录');
      return;
    }

    new Notice(`发现 ${failures.length} 个失败记录，开始重试...`);

    try {
      const result = await retryService.retryAllFailures();
      new Notice(`重试完成！成功: ${result.succeeded.length}, 失败: ${result.failed.length}`);
    } catch (error) {
      console.error('重试失败:', error);
      new Notice('重试失败');
    }
  }
});
