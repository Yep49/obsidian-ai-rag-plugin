// HTTP client for OpenAI-compatible APIs

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

  async post(endpoint: string, body: any, retryCount = 0): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT);

      console.log(`[API] Request: ${url}`);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorDetail = response.statusText;
        let errorText = '';

        try {
          errorText = await response.text();
          const errorJson = JSON.parse(errorText);
          errorDetail = errorJson?.error?.message || errorJson?.message || errorText || response.statusText;
        } catch {
          if (errorText) {
            errorDetail = errorText;
          }
        }

        console.error(`[API] Error ${response.status}: ${errorDetail}`);

        if (response.status === 429 && retryCount < this.MAX_RETRIES) {
          await this.sleep(this.RETRY_DELAY * (retryCount + 1));
          return this.post(endpoint, body, retryCount + 1);
        }

        if (response.status >= 500 && retryCount < this.MAX_RETRIES) {
          await this.sleep(this.RETRY_DELAY);
          return this.post(endpoint, body, retryCount + 1);
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

      return await response.json();
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        if (retryCount < this.MAX_RETRIES) {
          await this.sleep(this.RETRY_DELAY);
          return this.post(endpoint, body, retryCount + 1);
        }
        throw new Error(`API request timed out after ${this.TIMEOUT / 1000}s.`);
      }

      const message = String(error?.message || error);
      if (message.includes('fetch') || message.includes('Failed to fetch')) {
        if (retryCount < this.MAX_RETRIES) {
          await this.sleep(this.RETRY_DELAY);
          return this.post(endpoint, body, retryCount + 1);
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
  private static readonly INVALID_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

  constructor(httpClient: OpenAiCompatibleHttpClient, model: string) {
    this.httpClient = httpClient;
    this.model = model;
  }

  private normalizeText(text: string): string {
    return (text ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(OpenAiCompatibleEmbeddingClient.INVALID_CONTROL_CHARS, ' ')
      .trim();
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

    const response = await this.httpClient.post('/embeddings', {
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
      const response = await this.httpClient.post('/embeddings', {
        model: this.model,
        input: preparedTexts
      });

      if (!Array.isArray(response?.data) || response.data.length !== preparedTexts.length) {
        throw new Error(
          `Embedding API returned ${response?.data?.length ?? 0} vectors for ${preparedTexts.length} inputs.`
        );
      }

      return response.data.map((item: any) => item.embedding);
    } catch (error) {
      console.warn('[Embedding] Batch request failed, fallback to per-item mode.', error);

      const results: number[][] = [];
      for (let i = 0; i < preparedTexts.length; i++) {
        try {
          const response = await this.httpClient.post('/embeddings', {
            model: this.model,
            input: preparedTexts[i]
          });

          if (!Array.isArray(response?.data) || !response.data[0]?.embedding) {
            throw new Error('Invalid response format.');
          }

          results.push(response.data[0].embedding);
        } catch (itemError: any) {
          const msg = itemError?.message || String(itemError);
          throw new Error(`Embedding fallback failed at item ${i + 1}/${preparedTexts.length}: ${msg}`);
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
    const response = await this.httpClient.post('/chat/completions', {
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
