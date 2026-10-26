import { LLMProvider, LLMGenerateOptions, LLMGenerateResult } from './base.js';

export class OllamaProvider implements LLMProvider {
  id: string;
  name: string;
  baseUrl: string;
  defaultModel: string;
  apiKey?: string;

  constructor(
    baseUrl = 'http://localhost:11434',
    defaultModel = 'llama3.1:8b',
    apiKey?: string,
    customName?: string,
    customId?: string
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.defaultModel = defaultModel || 'llama3.1:8b';
    this.apiKey = apiKey && apiKey.trim().length > 0 ? apiKey.trim() : undefined;
    this.id = customId || (this.apiKey || baseUrl.includes('ollama.com') ? 'ollama_cloud' : 'ollama');
    this.name = customName || (this.apiKey || baseUrl.includes('ollama.com') ? 'Ollama Cloud' : 'Ollama (Local LLM)');
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
      headers['x-api-key'] = this.apiKey;
    }

    return headers;
  }

  async isAvailable(): Promise<boolean> {
    const headers = this.getHeaders();

    // 0. Cloud endpoints expose /api/version and /api/tags publicly, so they never reject a bad key.
    // When a key is set, validate it with a minimal authenticated request.
    if (this.apiKey) {
      try {
        const res = await fetch(`${this.baseUrl}/api/chat`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: this.defaultModel,
            messages: [{ role: 'user', content: 'hi' }],
            stream: false,
            options: { num_predict: 1 }
          }),
          signal: AbortSignal.timeout(10000)
        });
        if (res.status === 401 || res.status === 403) {
          console.warn(`[OllamaProvider] API key rejected (HTTP ${res.status}).`);
          return false;
        }
      } catch {
        // Network error: fall through to the reachability probes below
      }
    }

    // 1. Try Ollama native version endpoint
    try {
      const res = await fetch(`${this.baseUrl}/api/version`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(4000)
      });
      if (res.ok) return true;
      if (res.status === 401 || res.status === 403) {
        console.warn(`[OllamaProvider] Authentication failed (HTTP ${res.status}). Check API Key.`);
        return false;
      }
    } catch {
      // Continue to next probe
    }

    // 2. Try Ollama tags endpoint (common on cloud proxies and remote instances)
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(4500)
      });
      if (res.ok) return true;
      if (res.status === 401 || res.status === 403) {
        console.warn(`[OllamaProvider] Authentication failed on /api/tags (HTTP ${res.status}).`);
        return false;
      }
    } catch {
      // Continue to OpenAI compatible check if applicable
    }

    // 3. Fallback probe for OpenAI-compatible endpoints or root health
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(3000)
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    const headers = this.getHeaders();

    // 1. Try standard Ollama /api/tags
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        const data = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
        if (data.models && Array.isArray(data.models) && data.models.length > 0) {
          const models = data.models.map((m) => m.name || m.model || '').filter(Boolean);
          if (models.length > 0) return models;
        }
      }
    } catch {
      // Fallback below
    }

    // 2. Try OpenAI compatible /v1/models if tags wasn't available
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(4000)
      });
      if (res.ok) {
        const data = (await res.json()) as { data?: Array<{ id?: string }> };
        if (data.data && Array.isArray(data.data) && data.data.length > 0) {
          const models = data.data.map((m) => m.id || '').filter(Boolean);
          if (models.length > 0) return models;
        }
      }
    } catch {
      // Return default model
    }

    return [this.defaultModel];
  }

  async generate(options: LLMGenerateOptions): Promise<LLMGenerateResult> {
    const model = options.model || this.defaultModel;
    const headers = this.getHeaders();

    // Payload for native Ollama /api/generate
    const payload: Record<string, any> = {
      model,
      prompt: options.prompt,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.7
      }
    };

    if (options.systemInstruction) {
      payload.system = options.systemInstruction;
    }

    if (options.responseFormat === 'json') {
      payload.format = 'json';
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(90000)
      });

      if (response.ok) {
        const data = (await response.json()) as { response?: string; eval_count?: number };
        return {
          text: data.response || '',
          model,
          provider: this.id,
          tokensUsed: data.eval_count || 0
        };
      }

      // If HTTP 401 or 403, throw clear auth error
      if (response.status === 401 || response.status === 403) {
        const errText = await response.text();
        throw new Error(
          `Ollama Cloud Authentication Failed (${response.status}): Invalid or unauthorized API Key. Please update your API Key in Settings. Details: ${errText}`
        );
      }

      // If /api/generate gave 404, attempt fallback to /api/chat
      if (response.status === 404) {
        return await this.generateViaChat(options, model, headers);
      }

      const errText = await response.text();
      throw new Error(`Ollama Cloud API error (${response.status}): ${errText}`);
    } catch (err: any) {
      if (err.message?.includes('Authentication Failed')) {
        throw err;
      }
      // If error was fetch failure, check if /api/chat or OpenAI compatibility works
      try {
        return await this.generateViaChat(options, model, headers);
      } catch {
        throw new Error(`${this.name} execution failed: ${err.message}`);
      }
    }
  }

  /**
   * Fallback generation via /api/chat or /v1/chat/completions for endpoints that only support chat
   */
  private async generateViaChat(
    options: LLMGenerateOptions,
    model: string,
    headers: Record<string, string>
  ): Promise<LLMGenerateResult> {
    const messages: Array<{ role: string; content: string }> = [];

    if (options.systemInstruction) {
      messages.push({ role: 'system', content: options.systemInstruction });
    }
    messages.push({ role: 'user', content: options.prompt });

    // Try /api/chat first (standard Ollama chat)
    try {
      const chatRes = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          options: {
            temperature: options.temperature ?? 0.7
          }
        }),
        signal: AbortSignal.timeout(90000)
      });

      if (chatRes.ok) {
        const data = (await chatRes.json()) as { message?: { content?: string }; eval_count?: number };
        return {
          text: data.message?.content || '',
          model,
          provider: this.id,
          tokensUsed: data.eval_count || 0
        };
      }
    } catch {
      // Continue to OpenAI style
    }

    // Try /v1/chat/completions (OpenAI compatible proxy format)
    const openAiRes = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.7
      }),
      signal: AbortSignal.timeout(90000)
    });

    if (!openAiRes.ok) {
      const errText = await openAiRes.text();
      throw new Error(`Cloud chat API error (${openAiRes.status}): ${errText}`);
    }

    const data = (await openAiRes.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number };
    };
    return {
      text: data.choices?.[0]?.message?.content || '',
      model,
      provider: this.id,
      tokensUsed: data.usage?.total_tokens || 0
    };
  }
}
