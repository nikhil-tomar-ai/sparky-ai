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
    // When a key is set, probe the same authenticated endpoints generate() uses. The key is only
    // treated as invalid when every probed endpoint rejects it (401/403).
    if (this.apiKey) {
      const probes: Array<{ path: string; body: Record<string, any> }> = [
        {
          path: '/api/generate',
          body: { model: this.defaultModel, prompt: 'hi', stream: false, options: { num_predict: 1 } }
        },
        {
          path: '/v1/chat/completions',
          body: { model: this.defaultModel, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }
        }
      ];
      let rejected = 0;
      let answered = 0;
      for (const probe of probes) {
        try {
          const res = await fetch(`${this.baseUrl}${probe.path}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(probe.body),
            signal: AbortSignal.timeout(10000)
          });
          answered++;
          if (res.status === 401 || res.status === 403) {
            rejected++;
          } else {
            break;
          }
        } catch {
          // Network error: try next probe
        }
      }
      if (answered > 0 && rejected === answered) {
        console.warn('[OllamaProvider] API key rejected by all authenticated endpoints.');
        return false;
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
    let models: string[] = [];

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
          models = data.models.map((m) => m.name || m.model || '').filter(Boolean);
        }
      }
    } catch {
      // Fallback below
    }

    // 2. Try OpenAI compatible /v1/models if tags wasn't available
    if (models.length === 0) {
      try {
        const res = await fetch(`${this.baseUrl}/v1/models`, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(4000)
        });
        if (res.ok) {
          const data = (await res.json()) as { data?: Array<{ id?: string }> };
          if (data.data && Array.isArray(data.data) && data.data.length > 0) {
            models = data.data.map((m) => m.id || '').filter(Boolean);
          }
        }
      } catch {
        // Return default model
      }
    }

    if (models.length === 0) {
      models = [this.defaultModel];
    }

    // If on Ollama Cloud, prioritize verified Free Plan models first
    if (this.baseUrl.includes('ollama.com')) {
      const freeModels = ['gemma4:31b', 'gemma4:31b-cloud', 'gpt-oss:20b'];
      const reordered = [
        ...freeModels.filter(m => models.includes(m)),
        ...models.filter(m => !freeModels.includes(m))
      ];
      return reordered.length > 0 ? reordered : freeModels;
    }

    return models;
  }

  async generate(options: LLMGenerateOptions): Promise<LLMGenerateResult> {
    let model = options.model || this.defaultModel;

    // If on Ollama Cloud and model is llama3.1:8b (not in free tier), auto-select gemma4:31b
    if (this.baseUrl.includes('ollama.com') && (model === 'llama3.1:8b' || !model)) {
      model = 'gemma4:31b';
    }

    const headers = this.getHeaders();

    // Prefer chat endpoint on Ollama Cloud for best prompt formatting and model support
    if (this.baseUrl.includes('ollama.com')) {
      try {
        return await this.generateViaChat(options, model, headers);
      } catch (chatErr: any) {
        console.warn(`[Ollama Cloud] /api/chat attempted with ${model}: ${chatErr.message}. Falling back to /api/generate...`);
      }
    }

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
        const cleanText = this.sanitizeOutput(data.response || '');
        return {
          text: cleanText,
          model,
          provider: this.id,
          tokensUsed: data.eval_count || 0
        };
      }

      const errText = await response.text();

      // If HTTP 401 or 403, throw clear auth error
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `Ollama Cloud Authentication Failed (${response.status}): Invalid or unauthorized API Key. Please update your API Key in Settings.`
        );
      }

      // If model not in Free plan (HTTP 402 or 404), auto-retry with free cloud model gemma4:31b
      if (
        (response.status === 402 || response.status === 404 || errText.includes('Free plan') || errText.includes('gemma4:31b-cloud')) &&
        model !== 'gemma4:31b'
      ) {
        console.warn(`[Ollama Cloud] Model ${model} not available on Free tier. Auto-switching to gemma4:31b...`);
        return await this.generateViaChat(options, 'gemma4:31b', headers);
      }

      // If /api/generate gave 404, attempt fallback to /api/chat
      if (response.status === 404) {
        return await this.generateViaChat(options, model, headers);
      }

      throw new Error(`Ollama Cloud API error (${response.status}): ${errText}`);
    } catch (err: any) {
      if (err.message?.includes('Authentication Failed')) {
        throw err;
      }
      // Attempt chat fallback
      try {
        return await this.generateViaChat(options, model, headers);
      } catch (fallbackErr: any) {
        throw new Error(`${this.name} execution failed: ${err.message || fallbackErr.message}`);
      }
    }
  }

  /**
   * Strips internal model reasoning (<think>...</think>) and leading markdown fences if present
   */
  private sanitizeOutput(text: string): string {
    let clean = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    return clean;
  }

  /**
   * Generation via /api/chat or /v1/chat/completions
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
        const cleanText = this.sanitizeOutput(data.message?.content || '');
        return {
          text: cleanText,
          model,
          provider: this.id,
          tokensUsed: data.eval_count || 0
        };
      }

      const errText = await chatRes.text();

      // Free plan recovery in chat:
      if (
        (chatRes.status === 402 || chatRes.status === 404 || errText.includes('Free plan') || errText.includes('gemma4:31b-cloud')) &&
        model !== 'gemma4:31b'
      ) {
        console.warn(`[Ollama Cloud Chat] Switching to free plan model gemma4:31b...`);
        return await this.generateViaChat(options, 'gemma4:31b', headers);
      }

      if (chatRes.status === 401 || chatRes.status === 403) {
        throw new Error(`Ollama Cloud Authentication Failed (${chatRes.status}): Invalid API Key.`);
      }

      throw new Error(`Cloud chat API error (${chatRes.status}): ${errText}`);
    } catch (chatError: any) {
      if (chatError.message?.includes('Authentication Failed')) {
        throw chatError;
      }
      // If error was free plan recovery, propagate
      if (chatError.message?.includes('gemma4:31b')) {
        throw chatError;
      }
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
    const cleanText = this.sanitizeOutput(data.choices?.[0]?.message?.content || '');
    return {
      text: cleanText,
      model,
      provider: this.id,
      tokensUsed: data.usage?.total_tokens || 0
    };
  }
}
