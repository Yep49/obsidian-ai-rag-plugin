import { requestUrl } from 'obsidian';

interface ApiErrorResponse {
  error?: { message?: string };
  message?: string;
}

interface EmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

interface ChatResponse {
  choices: Array<{ message: { content: string } }>;
}

type ApiRequestBody = Record<string, unknown>;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class OpenAiCompatibleHttpClient {
  private baseUrl: string;
  private apiKey: string;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 1000;
  private readonly TIMEOUT = 30000;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  async post<TResponse>(endpoint: string, body: ApiRequestBody, retryCount = 0): Promise<TResponse> {
    const url = `${this.baseUrl}${endpoint}`;
    let timeoutId: number | undefined;

    try {
      console.debug(`[API] Request: ${url}`);
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error(`API request timed out after ${this.TIMEOUT / 1000}s.`));
        }, this.TIMEOUT);
      });

      const response = await Promise.race([
        requestUrl({
          url,
          method: 'POST',
          contentType: 'application/json',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          },
          body: JSON.stringify(body),
          throw: false
        }),
        timeout
      ]);

      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }

      if (response.status >= 400) {
        const errorJson = response.json as unknown as ApiErrorResponse;
        const errorText = response.text;
        const errorDetail = errorJson?.error?.message || errorJson?.message || errorText || 'Unknown API error';

        console.error(`[API] Error ${response.status}: ${errorDetail}`);

        if (response.status === 429 && retryCount < this.MAX_RETRIES) {
          await this.sleep(this.RETRY_DELAY * (retryCount + 1));
          return this.post<TResponse>(endpoint, body, retryCount + 1);
        }

        if (response.status >= 500 && retryCount < this.MAX_RETRIES) {
          await this.sleep(this.RETRY_DELAY);
          return this.post<TResponse>(endpoint, body, retryCount + 1);
        }

        if (response.status === 401) {
          throw new Error(`API authentication failed: ${errorDetail}`);
        }

        if (response.status === 403) {
          throw new Error(`API permission denied: ${errorDetail}`);
        }

        if (response.status === 404) {
          throw new Error(`API endpoint not found (${this.baseUrl}): ${errorDetail}`);
        }

        throw new Error(`API request failed (${response.status}): ${errorDetail}`);
      }

      return response.json as unknown as TResponse;
    } catch (error) {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }

      const message = getErrorMessage(error);
      if (message.includes('timed out')) {
        if (retryCount < this.MAX_RETRIES) {
          await this.sleep(this.RETRY_DELAY);
          return this.post<TResponse>(endpoint, body, retryCount + 1);
        }
      }

      if (message.includes('requestUrl') || message.includes('Network') || message.includes('Failed')) {
        if (retryCount < this.MAX_RETRIES) {
          await this.sleep(this.RETRY_DELAY);
          return this.post<TResponse>(endpoint, body, retryCount + 1);
        }
        throw new Error(`Network error while connecting to ${this.baseUrl}.`);
      }

      throw error;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Embedding client
export class OpenAiCompatibleEmbeddingClient {
  private httpClient: OpenAiCompatibleHttpClient;
  private model: string;
  private readonly MAX_TOKENS = 512;
  private readonly CHARS_PER_TOKEN = 2;

  constructor(httpClient: OpenAiCompatibleHttpClient, model: string) {
    this.httpClient = httpClient;
    this.model = model;
  }

  private normalizeText(text: string): string {
    return (text ?? '')
      .replace(/\r\n?/g, '\n')
      .split('')
      .map(char => this.isInvalidControlChar(char) ? ' ' : char)
      .join('')
      .trim();
  }

  private isInvalidControlChar(char: string): boolean {
    const code = char.charCodeAt(0);
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
  }

  private truncateText(text: string): string {
    const normalized = this.normalizeText(text);
    const maxChars = this.MAX_TOKENS * this.CHARS_PER_TOKEN;

    if (normalized.length <= maxChars) {
      return normalized;
    }

    console.warn(`[Embedding] Text too long (${normalized.length}), truncated to ${maxChars}.`);
    return normalized.substring(0, maxChars);
  }

  async embed(text: string): Promise<number[]> {
    const preparedText = this.truncateText(text);
    if (!preparedText) {
      throw new Error('Embedding input is empty after normalization.');
    }

    const response = await this.httpClient.post<EmbeddingResponse>('/embeddings', {
      model: this.model,
      input: preparedText
    });

    if (!Array.isArray(response?.data) || !response.data[0]?.embedding) {
      throw new Error('Embedding API returned unexpected response format.');
    }

    return response.data[0].embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const preparedTexts = texts.map(t => this.truncateText(t));

    if (preparedTexts.length === 0) {
      return [];
    }

    if (preparedTexts.some(t => !t)) {
      throw new Error('Batch embedding contains empty input after normalization.');
    }

    try {
      const response = await this.httpClient.post<EmbeddingResponse>('/embeddings', {
        model: this.model,
        input: preparedTexts
      });

      if (!Array.isArray(response?.data) || response.data.length !== preparedTexts.length) {
        throw new Error(
          `Embedding API returned ${response?.data?.length ?? 0} vectors for ${preparedTexts.length} inputs.`
        );
      }

      return response.data.map(item => item.embedding);
    } catch (error) {
      console.warn('[Embedding] Batch request failed, fallback to per-item mode.', error);

      const results: number[][] = [];
      for (let i = 0; i < preparedTexts.length; i++) {
        try {
          const response = await this.httpClient.post<EmbeddingResponse>('/embeddings', {
            model: this.model,
            input: preparedTexts[i]
          });

          if (!Array.isArray(response?.data) || !response.data[0]?.embedding) {
            throw new Error('Invalid response format.');
          }

          results.push(response.data[0].embedding);
        } catch (itemError) {
          throw new Error(`Embedding fallback failed at item ${i + 1}/${preparedTexts.length}: ${getErrorMessage(itemError)}`);
        }
      }

      return results;
    }
  }
}

// LLM client
export class OpenAiCompatibleLlmClient {
  private httpClient: OpenAiCompatibleHttpClient;
  private model: string;

  constructor(httpClient: OpenAiCompatibleHttpClient, model: string) {
    this.httpClient = httpClient;
    this.model = model;
  }

  async chat(messages: Array<{ role: string; content: string }>, temperature = 0.7): Promise<string> {
    const response = await this.httpClient.post<ChatResponse>('/chat/completions', {
      model: this.model,
      messages,
      temperature
    });

    return response.choices[0].message.content;
  }

  async chatStream(
    messages: Array<{ role: string; content: string }>,
    onChunk: (chunk: string) => void,
    temperature = 0.7
  ): Promise<void> {
    const fullResponse = await this.chat(messages, temperature);
    onChunk(fullResponse);
  }
}
