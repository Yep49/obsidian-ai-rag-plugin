import { TFile } from 'obsidian';
import { ObsidianJsonFileAdapter } from './Storage';
import { WikiIngestStateEntry } from '../types/index';

export class WikiIngestStateService {
  private adapter: ObsidianJsonFileAdapter;
  private basePath: string;
  private cache: WikiIngestStateEntry[] | null = null;
  private readonly fileName = 'wiki-ingest-state.json';

  constructor(adapter: ObsidianJsonFileAdapter, basePath: string) {
    this.adapter = adapter;
    this.basePath = basePath;
  }

  async getEntry(path: string): Promise<WikiIngestStateEntry | undefined> {
    const entries = await this.loadEntries();
    return entries.find(entry => entry.path === path);
  }

  async shouldSkip(path: string): Promise<boolean> {
    const entry = await this.getEntry(path);
    return Boolean(entry && ['ingested', 'private', 'skipped'].includes(entry.status));
  }

  async markIngested(file: TFile, sourceWikiPath?: string): Promise<void> {
    await this.upsertEntry({
      path: file.path,
      lastIngestedMtime: file.stat.mtime,
      sourceWikiPath,
      status: 'ingested',
      updatedAt: Date.now()
    });
  }

  async markPrivate(file: TFile, sourceWikiPath?: string): Promise<void> {
    await this.upsertEntry({
      path: file.path,
      lastIngestedMtime: file.stat.mtime,
      sourceWikiPath,
      status: 'private',
      updatedAt: Date.now()
    });
  }

  async markSkipped(file: TFile): Promise<void> {
    await this.upsertEntry({
      path: file.path,
      lastIngestedMtime: file.stat.mtime,
      status: 'skipped',
      updatedAt: Date.now()
    });
  }

  async getAllEntries(): Promise<WikiIngestStateEntry[]> {
    return await this.loadEntries();
  }

  private async upsertEntry(entry: WikiIngestStateEntry): Promise<void> {
    const entries = await this.loadEntries();
    const nextEntries = entries.filter(existing => existing.path !== entry.path);
    nextEntries.push(entry);
    await this.saveEntries(nextEntries);
  }

  private async loadEntries(): Promise<WikiIngestStateEntry[]> {
    if (this.cache) {
      return this.cache;
    }

    const path = `${this.basePath}/${this.fileName}`;
    try {
      const content = await this.adapter.read(path);
      const parsed = JSON.parse(content) as unknown;
      this.cache = Array.isArray(parsed) ? parsed : [];
      return this.cache;
    } catch {
      this.cache = [];
      return this.cache;
    }
  }

  private async saveEntries(entries: WikiIngestStateEntry[]): Promise<void> {
    this.cache = entries;
    await this.adapter.mkdir(this.basePath);
    await this.adapter.write(
      `${this.basePath}/${this.fileName}`,
      JSON.stringify(entries, null, 2)
    );
  }
}
