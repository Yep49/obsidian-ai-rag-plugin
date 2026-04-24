// 核心数据类型定义

export interface PluginSettings {
  apiBaseUrl: string;
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
  rerankModel?: string;
  provider: string;
  chunkSize: number;
  overlap: number;
  topK: number;
  enableHybridSearch: boolean;
  autoIndexOnFileChange: boolean;
  maxContextChars: number;
  language: 'zh-CN' | 'en';
  commandLanguage?: 'zh-CN' | 'en';
  embeddingApiBaseUrl?: string;
  embeddingApiKey?: string;
  maxFileChars?: number;
  // Wiki 相关设置
  enableWiki: boolean;
  wikiPath: string;
  wikiAutoIngest: boolean;
  wikiPriority: number; // Wiki 页面在检索中的权重提升倍数
  faqStrongMatchThreshold: number;
  wikiContextRatio: number;
  vectorContextRatio: number;
  answerTemplate: 'structured' | 'concise';
}

export interface Chunk {
  id: string;
  path: string;
  title: string;
  heading?: string;
  sectionPath: string;
  content: string;
  contentHash: string;
  tags: string[];
  links: string[];
  noteType?: string;
  noteSummary?: string;
  mtime: number;
  startLine: number;
  endLine: number;
}

export interface SearchResult {
  chunk: Chunk;
  score: number;
  snippet?: string;
}

export interface Citation {
  path: string;
  title: string;
  heading?: string;
  sectionPath: string;
  startLine?: number;
  endLine?: number;
  snippet: string;
  sourceLayer?: 'faq' | 'wiki' | 'vector' | 'meta';
}

export interface IndexManifest {
  indexVersion: string;
  embeddingModel: string;
  embeddingDimensions: number;
  chunkSize: number;
  overlap: number;
  splitterVersion: string;
  lastBuildTime: number;
}

export interface BuildProgress {
  current: number;
  total: number;
  currentFile: string;
  phase: string;
}

export interface BuildResult {
  filesIndexed: number;
  chunksIndexed: number;
}

// 新增：反馈学习相关类型
export interface FeedbackEntry {
  id: string;
  question: string;
  wrongAnswer: string;
  correction: string;
  linkedNotes: string[];
  timestamp: number;
  content: string;
}

export interface FeedbackEvent {
  id: string;
  question: string;
  answer: string;
  sourceLayer: 'faq' | 'hybrid' | 'vector';
  faqMatchCount: number;
  wikiPageCount: number;
  vectorSourceCount: number;
  timings?: {
    faq: number;
    wiki: number;
    vector: number;
    llm: number;
    total: number;
  };
  feedbackValue: 1 | -1;
  corrected: boolean;
  createdAt: number;
}

export interface FeedbackEmbedding {
  id: string;
  embedding: number[];
}

export interface FAQEntry {
  id: string;
  question: string;
  normalizedQuestion: string;
  wrongAnswer: string;
  correction: string;
  linkedNotes: string[];
  wikiPath: string;
  status: 'confirmed' | 'draft' | 'private';
  created: string;
  updated: string;
  content: string;
}

export interface FAQEmbedding {
  id: string;
  embedding: number[];
}

// 新增：元数据向量库相关类型
export interface MetaNote {
  path: string;
  summary: string;
  userRelation: string;
  autoTags: string[];
  noteCategory: string;
  suggestedRelatedNotes: string[];
  suggestedRelatedWikiPages: string[];
  sourceWikiPath?: string | null;
  isPrivate?: boolean;
  mtime: number;
}

export interface MetaEmbedding {
  path: string;
  embedding: number[];
}

// 新增：用户模式学习相关类型
export interface UserPattern {
  frequentTerms: Record<string, number>;
  questionTemplates: string[];
  preferredAnswerStyle: string;
  triggerWords: string[];
  contextMemory: Record<string, string[]>;
  lastUpdated: number;
}

// Wiki 相关类型定义
export type WikiPageType = 'source' | 'entity' | 'concept' | 'summary' | 'synthesis' | 'faq' | 'meta' | 'relation';

export interface WikiPageFrontmatter {
  type: WikiPageType;
  category: string;
  created: string;
  updated: string;
  sources: number;
  question?: string; // 仅用于 synthesis 类型
}

export interface WikiPage {
  path: string;
  type: WikiPageType;
  title: string;
  frontmatter: WikiPageFrontmatter;
  content: string;
  links: string[]; // 内部链接
  backlinks: string[]; // 反向链接
}

export interface WikiIndexEntry {
  title: string;
  path: string;
  description: string;
  type: WikiPageType;
  category: string;
  updated: string;
}

export interface WikiLogEntry {
  timestamp: number;
  date: string;
  action: 'ingest' | 'query' | 'audit' | 'update' | 'summary' | 'faq' | 'meta' | 'relation' | 'private';
  title: string;
  details: string;
}

export interface WikiIngestResult {
  sourcesCreated: string[];
  sourcesUpdated: string[];
  entitiesCreated: string[];
  entitiesUpdated: string[];
  conceptsCreated: string[];
  conceptsUpdated: string[];
  summariesCreated: string[];
  summariesUpdated: string[];
  createdPages: Array<{type: WikiPageType; title: string; path: string}>;
  updatedPages: Array<{type: WikiPageType; title: string; path: string}>;
  skippedFiles: string[];
  sourcePagePath?: string;
  conflicts: Array<{page: string; issue: string}>;
}

export interface WikiAuditReport {
  contradictions: Array<{page1: string; page2: string; issue: string}>;
  orphanPages: string[];
  missingLinks: Array<{page: string; missingConcept: string}>;
  outdatedInfo: Array<{page: string; reason: string}>;
  dataGaps: string[];
}

export interface LayeredAskResult {
  answer: string;
  citations: Citation[];
  sourceLayer: 'faq' | 'hybrid' | 'vector';
  faqMatches?: Array<{ entry: FAQEntry; score: number; exact: boolean }>;
  wikiPages?: WikiPage[];
  suggestedLinkedNotes?: string[];
  timings?: {
    faq: number;
    wiki: number;
    vector: number;
    llm: number;
    total: number;
  };
  wikiSources?: string[];
  vectorSources?: string[];
}

export interface WikiIngestStateEntry {
  path: string;
  lastIngestedMtime: number;
  sourceWikiPath?: string;
  status: 'ingested' | 'private' | 'skipped';
  updatedAt: number;
}

export interface CorrectionContext {
  question: string;
  answer: string;
  sourceLayer?: 'faq' | 'hybrid' | 'vector';
  faqMatchCount?: number;
  wikiPageCount?: number;
  vectorSourceCount?: number;
  citations: Citation[];
  wikiPages?: WikiPage[];
  suggestedLinkedNotes?: string[];
  timings?: {
    faq: number;
    wiki: number;
    vector: number;
    llm: number;
    total: number;
  };
}

export interface TuningProposal {
  id: string;
  createdAt: number;
  summary: string;
  reasons: string[];
  suggestedSettings: Partial<Pick<
    PluginSettings,
    'topK' | 'maxContextChars' | 'wikiPriority' | 'faqStrongMatchThreshold' | 'wikiContextRatio' | 'vectorContextRatio' | 'answerTemplate'
  >>;
  metrics: {
    totalFeedback: number;
    negativeFeedback: number;
    negativeRate: number;
    avgTotalMs: number;
  };
  status: 'pending' | 'applied' | 'dismissed';
  reportPath?: string;
}

export interface TuningDecision {
  proposalId: string;
  decidedAt: number;
  status: 'applied' | 'dismissed';
  beforeSettings: Partial<Pick<
    PluginSettings,
    'topK' | 'maxContextChars' | 'wikiPriority' | 'faqStrongMatchThreshold' | 'wikiContextRatio' | 'vectorContextRatio' | 'answerTemplate'
  >>;
  afterSettings: Partial<Pick<
    PluginSettings,
    'topK' | 'maxContextChars' | 'wikiPriority' | 'faqStrongMatchThreshold' | 'wikiContextRatio' | 'vectorContextRatio' | 'answerTemplate'
  >>;
}

export interface LinkSuggestion {
  sourcePath: string;
  targetPath: string;
  reason: string;
  score: number;
  from: 'meta' | 'filename' | 'wiki' | 'citation';
}

export interface LinkApplyRequest {
  sourcePath: string;
  targetPaths: string[];
}
