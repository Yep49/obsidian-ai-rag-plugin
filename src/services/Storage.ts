import { App } from 'obsidian';
import { Chunk, IndexedFileMetadata, IndexManifest, StoredEmbedding } from '../types/index';

// JSON 文件适配器
export class ObsidianJsonFileAdapter {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  async read(path: string): Promise<string> {
    try {
      return await this.app.vault.adapter.read(path);
    } catch (error) {
      throw new Error(`Failed to read ${path}: ${error}`);
    }
  }

  async write(path: string, content: string): Promise<void> {
    try {
      const parentPath = path.split('/').slice(0, -1).join('/');
      if (parentPath) {
        await this.mkdir(parentPath);
      }
      await this.app.vault.adapter.write(path, content);
    } catch (error) {
      throw new Error(`Failed to write ${path}: ${error}`);
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.app.vault.adapter.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(path: string): Promise<void> {
    try {
      await this.app.vault.adapter.mkdir(path);
    } catch {
      // 目录可能已存在，忽略错误
    }
  }
}

// 索引清单存储
export class JsonIndexManifestStore {
  private adapter: ObsidianJsonFileAdapter;
  private basePath: string;

  constructor(adapter: ObsidianJsonFileAdapter, basePath: string) {
    this.adapter = adapter;
    this.basePath = basePath;
  }

  async load(): Promise<IndexManifest | null> {
    const path = `${this.basePath}/manifest.json`;
    if (!await this.adapter.exists(path)) {
      return null;
    }

    const content = await this.adapter.read(path);
    return JSON.parse(content) as IndexManifest;
  }

  async save(manifest: IndexManifest): Promise<void> {
    await this.adapter.mkdir(this.basePath);
    const path = `${this.basePath}/manifest.json`;
    await this.adapter.write(path, JSON.stringify(manifest, null, 2));
  }
}

// 元数据存储（chunks + files）
export class JsonMetadataStore {
  private adapter: ObsidianJsonFileAdapter;
  private basePath: string;

  constructor(adapter: ObsidianJsonFileAdapter, basePath: string) {
    this.adapter = adapter;
    this.basePath = basePath;
  }

  async loadChunks(): Promise<Chunk[]> {
    const path = `${this.basePath}/chunks.json`;
    if (!await this.adapter.exists(path)) {
      return [];
    }

    const content = await this.adapter.read(path);
    return JSON.parse(content) as Chunk[];
  }

  async saveChunks(chunks: Chunk[]): Promise<void> {
    await this.adapter.mkdir(this.basePath);
    const path = `${this.basePath}/chunks.json`;
    await this.adapter.write(path, JSON.stringify(chunks, null, 2));
  }

  async loadFiles(): Promise<IndexedFileMetadata[]> {
    const path = `${this.basePath}/files.json`;
    if (!await this.adapter.exists(path)) {
      return [];
    }

    const content = await this.adapter.read(path);
    return JSON.parse(content) as IndexedFileMetadata[];
  }

  async saveFiles(files: IndexedFileMetadata[]): Promise<void> {
    await this.adapter.mkdir(this.basePath);
    const path = `${this.basePath}/files.json`;
    await this.adapter.write(path, JSON.stringify(files, null, 2));
  }

  // 根据 ID 查找 chunk
  async getChunkById(id: string): Promise<Chunk | null> {
    const chunks = await this.loadChunks();
    return chunks.find(c => c.id === id) || null;
  }

  // 根据路径查找 chunks
  async getChunksByPath(path: string): Promise<Chunk[]> {
    const chunks = await this.loadChunks();
    return chunks.filter(c => c.path === path);
  }
}

// 向量存储
export class JsonVectorStore {
  private adapter: ObsidianJsonFileAdapter;
  private basePath: string;

  constructor(adapter: ObsidianJsonFileAdapter, basePath: string) {
    this.adapter = adapter;
    this.basePath = basePath;
  }

  async loadEmbeddings(): Promise<StoredEmbedding[]> {
    const path = `${this.basePath}/embeddings.json`;
    if (!await this.adapter.exists(path)) {
      return [];
    }

    const content = await this.adapter.read(path);
    return JSON.parse(content) as StoredEmbedding[];
  }

  async saveEmbeddings(embeddings: StoredEmbedding[]): Promise<void> {
    await this.adapter.mkdir(this.basePath);
    const path = `${this.basePath}/embeddings.json`;
    await this.adapter.write(path, JSON.stringify(embeddings, null, 2));
  }

  // 向量相似度搜索
  async search(queryEmbedding: number[], topK: number): Promise<Array<{ id: string; score: number }>> {
    const embeddings = await this.loadEmbeddings();

    const results = embeddings.map(item => ({
      id: item.chunk.id,
      score: this.cosineSimilarity(queryEmbedding, item.embedding)
    }));

    // 按分数降序排序
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, topK);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
