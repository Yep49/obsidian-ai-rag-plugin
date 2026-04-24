import { TFile } from 'obsidian';
import { BuildProgress, BuildResult, Chunk, IndexedFileMetadata, IndexManifest, PluginSettings, StoredEmbedding } from '../types/index';
import { ObsidianVaultScanner, DocumentChunker, extractMetadata, generateChunkId, computeContentHash } from './DocumentProcessing';
import { OpenAiCompatibleEmbeddingClient } from './ApiClients';
import { JsonIndexManifestStore, JsonMetadataStore, JsonVectorStore } from './Storage';

const INDEX_VERSION = '0.2.0';
const SPLITTER_VERSION = 'heading-paragraph-length-v2';

export class IndexBuilder {
  private scanner: ObsidianVaultScanner;
  private embeddingClient: OpenAiCompatibleEmbeddingClient;
  private metadataStore: JsonMetadataStore;
  private vectorStore: JsonVectorStore;
  private manifestStore: JsonIndexManifestStore;
  private settings: PluginSettings;

  constructor(
    scanner: ObsidianVaultScanner,
    embeddingClient: OpenAiCompatibleEmbeddingClient,
    metadataStore: JsonMetadataStore,
    vectorStore: JsonVectorStore,
    manifestStore: JsonIndexManifestStore,
    settings: PluginSettings
  ) {
    this.scanner = scanner;
    this.embeddingClient = embeddingClient;
    this.metadataStore = metadataStore;
    this.vectorStore = vectorStore;
    this.manifestStore = manifestStore;
    this.settings = settings;
  }

  async buildFullIndex(progressCallback?: (progress: BuildProgress) => void): Promise<BuildResult> {
    const files = (await this.scanner.scanMarkdownFiles())
      .filter(file => !this.isIgnoredPath(file.path));
    const allChunks: Chunk[] = [];
    const allEmbeddings: StoredEmbedding[] = [];
    const fileMetadata: IndexedFileMetadata[] = [];
    const embeddedChunkIds = new Set<string>();

    const chunker = new DocumentChunker({
      chunkSize: this.settings.chunkSize,
      overlap: this.settings.overlap
    });

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      progressCallback?.({
        current: i + 1,
        total: files.length,
        currentFile: file.path,
        phase: '扫描和分块'
      });

      const content = await this.scanner.readFile(file);

      if (this.settings.maxFileChars && content.length > this.settings.maxFileChars) {
        console.debug(`[IndexBuilder] Skip oversized file: ${file.path} (${content.length} chars)`);
        fileMetadata.push({
          path: file.path,
          mtime: file.stat.mtime,
          chunkIds: []
        });
        continue;
      }

      const metadata = extractMetadata(content, file.name);
      const rawChunks = chunker.chunk(content, metadata);

      const chunks: Chunk[] = rawChunks
        .map(raw => ({
          id: generateChunkId(file.path, raw.startLine, raw.content),
          path: file.path,
          title: metadata.title,
          heading: raw.heading,
          sectionPath: raw.sectionPath,
          content: raw.content,
          contentHash: computeContentHash(raw.content),
          tags: metadata.tags,
          links: metadata.links,
          mtime: file.stat.mtime,
          startLine: raw.startLine + 1,
          endLine: raw.endLine + 1
        }))
        .filter(chunk => this.isChunkEmbeddable(chunk.content));

      if (rawChunks.length !== chunks.length) {
        console.debug(`[IndexBuilder] Skipped ${rawChunks.length - chunks.length} empty/invalid chunks in ${file.path}`);
      }

      allChunks.push(...chunks);
      fileMetadata.push({
        path: file.path,
        mtime: file.stat.mtime,
        chunkIds: chunks.map(c => c.id)
      });
    }

    progressCallback?.({
      current: files.length,
      total: files.length,
      currentFile: '',
      phase: '生成向量'
    });

    const batchSize = 10;
    for (let i = 0; i < allChunks.length; i += batchSize) {
      const batch = allChunks.slice(i, i + batchSize);
      const embeddedBatch = await this.embedChunks(batch);

      for (const item of embeddedBatch) {
        allEmbeddings.push({
          chunk: { id: item.chunk.id },
          embedding: item.embedding
        });
        embeddedChunkIds.add(item.chunk.id);
      }

      const current = Math.min(i + batch.length, allChunks.length);
      progressCallback?.({
        current,
        total: allChunks.length,
        currentFile: '',
        phase: `生成向量 (${current}/${allChunks.length})`
      });
    }

    if (allChunks.length > 0 && allEmbeddings.length === 0) {
      throw new Error('No valid embeddings were generated. Please check embedding API/model settings.');
    }

    const indexedChunks = allChunks.filter(chunk => embeddedChunkIds.has(chunk.id));
    const normalizedFileMetadata = fileMetadata.map(file => ({
      ...file,
      chunkIds: file.chunkIds.filter(id => embeddedChunkIds.has(id))
    }));

    progressCallback?.({
      current: indexedChunks.length,
      total: Math.max(1, indexedChunks.length),
      currentFile: '',
      phase: '保存索引'
    });

    await this.metadataStore.saveChunks(indexedChunks);
    await this.metadataStore.saveFiles(normalizedFileMetadata);
    await this.vectorStore.saveEmbeddings(allEmbeddings);

    const manifest: IndexManifest = {
      indexVersion: INDEX_VERSION,
      embeddingModel: this.settings.embeddingModel,
      embeddingDimensions: allEmbeddings[0]?.embedding.length || 1024,
      chunkSize: this.settings.chunkSize,
      overlap: this.settings.overlap,
      splitterVersion: SPLITTER_VERSION,
      lastBuildTime: Date.now()
    };

    await this.manifestStore.save(manifest);

    return {
      filesIndexed: files.length,
      chunksIndexed: indexedChunks.length
    };
  }

  async requiresFullRebuild(): Promise<boolean> {
    const manifest = await this.manifestStore.load();

    if (!manifest) {
      return true;
    }

    if (
      manifest.embeddingModel !== this.settings.embeddingModel ||
      manifest.chunkSize !== this.settings.chunkSize ||
      manifest.overlap !== this.settings.overlap
    ) {
      return true;
    }

    return false;
  }

  async updateFile(file: TFile): Promise<void> {
    try {
      if (this.isIgnoredPath(file.path)) {
        await this.deleteFile(file.path);
        return;
      }

      console.debug(`IndexBuilder: Updating file ${file.path}`);

      const content = await this.scanner.readFile(file);

      if (this.settings.maxFileChars && content.length > this.settings.maxFileChars) {
        console.debug(`[IndexBuilder] Skip oversized file: ${file.path} (${content.length} chars)`);
        await this.deleteFile(file.path);
        return;
      }

      const metadata = extractMetadata(content, file.name);
      const chunker = new DocumentChunker({
        chunkSize: this.settings.chunkSize,
        overlap: this.settings.overlap
      });

      const rawChunks = chunker.chunk(content, metadata);
      const newChunks: Chunk[] = rawChunks
        .map(raw => ({
          id: generateChunkId(file.path, raw.startLine, raw.content),
          path: file.path,
          title: metadata.title,
          heading: raw.heading,
          sectionPath: raw.sectionPath,
          content: raw.content,
          contentHash: computeContentHash(raw.content),
          tags: metadata.tags,
          links: metadata.links,
          mtime: file.stat.mtime,
          startLine: raw.startLine + 1,
          endLine: raw.endLine + 1
        }))
        .filter(chunk => this.isChunkEmbeddable(chunk.content));

      await this.deleteFile(file.path);

      const embeddedChunks = await this.embedChunks(newChunks);
      const successfulChunks = embeddedChunks.map(item => item.chunk);
      const newEmbeddings = embeddedChunks.map(item => ({
        chunk: { id: item.chunk.id },
        embedding: item.embedding
      }));

      const allChunks = await this.metadataStore.loadChunks();
      const allEmbeddings = await this.vectorStore.loadEmbeddings();
      const allFiles = await this.metadataStore.loadFiles();

      allChunks.push(...successfulChunks);
      allEmbeddings.push(...newEmbeddings);

      const fileIndex = allFiles.findIndex(f => f.path === file.path);
      const nextFileMetadata = {
        path: file.path,
        mtime: file.stat.mtime,
        chunkIds: successfulChunks.map(c => c.id)
      };

      if (fileIndex >= 0) {
        allFiles[fileIndex] = nextFileMetadata;
      } else {
        allFiles.push(nextFileMetadata);
      }

      await this.metadataStore.saveChunks(allChunks);
      await this.vectorStore.saveEmbeddings(allEmbeddings);
      await this.metadataStore.saveFiles(allFiles);

      console.debug(`IndexBuilder: Updated ${file.path} with ${successfulChunks.length} chunks`);
    } catch (error) {
      console.error(`IndexBuilder: Failed to update ${file.path}:`, error);
      throw error;
    }
  }

  async deleteFile(path: string): Promise<void> {
    try {
      console.debug(`IndexBuilder: Deleting file ${path}`);

      const allChunks = await this.metadataStore.loadChunks();
      const allEmbeddings = await this.vectorStore.loadEmbeddings();
      const allFiles = await this.metadataStore.loadFiles();

      const chunkIdsToDelete = new Set(
        allChunks.filter(c => c.path === path).map(c => c.id)
      );

      const remainingChunks = allChunks.filter(c => c.path !== path);
      const remainingEmbeddings = allEmbeddings.filter(
        e => !chunkIdsToDelete.has(e.chunk.id)
      );
      const remainingFiles = allFiles.filter(f => f.path !== path);

      await this.metadataStore.saveChunks(remainingChunks);
      await this.vectorStore.saveEmbeddings(remainingEmbeddings);
      await this.metadataStore.saveFiles(remainingFiles);

      console.debug(`IndexBuilder: Deleted ${path} (${chunkIdsToDelete.size} chunks)`);
    } catch (error) {
      console.error(`IndexBuilder: Failed to delete ${path}:`, error);
      throw error;
    }
  }

  private isChunkEmbeddable(content: string): boolean {
    const normalized = (content ?? '')
      .replace(/\r\n?/g, '\n')
      .split('')
      .map(char => this.isInvalidControlChar(char) ? ' ' : char)
      .join('')
      .trim();

    return normalized.length > 0;
  }

  private isInvalidControlChar(char: string): boolean {
    const code = char.charCodeAt(0);
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
  }

  private isIgnoredPath(path: string): boolean {
    const wikiPath = (this.settings.wikiPath || '_wiki').replace(/^\/+|\/+$/g, '') || '_wiki';
    return Boolean(this.settings.enableWiki && (path === wikiPath || path.startsWith(`${wikiPath}/`)));
  }

  private async embedChunks(batch: Chunk[]): Promise<Array<{ chunk: Chunk; embedding: number[] }>> {
    if (batch.length === 0) {
      return [];
    }

    try {
      const embeddings = await this.embeddingClient.embedBatch(batch.map(c => c.content));
      if (embeddings.length !== batch.length) {
        throw new Error(`Embedding count mismatch: expected ${batch.length}, got ${embeddings.length}`);
      }

      return batch.map((chunk, index) => ({
        chunk,
        embedding: embeddings[index]
      }));
    } catch (error) {
      console.warn(`[IndexBuilder] Batch embedding failed for ${batch.length} chunks, fallback to per-item mode.`, error);

      const results: Array<{ chunk: Chunk; embedding: number[] }> = [];
      for (const chunk of batch) {
        try {
          const embedding = await this.embeddingClient.embed(chunk.content);
          results.push({ chunk, embedding });
        } catch (itemError) {
          const reason = itemError instanceof Error ? itemError.message : String(itemError);
          console.warn(`[IndexBuilder] Skip chunk ${chunk.path}:${chunk.startLine}-${chunk.endLine}. Reason: ${reason}`);
        }
      }

      return results;
    }
  }
}
