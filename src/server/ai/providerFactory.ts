import { LLMProvider } from './base.js';
import { OllamaProvider } from './ollamaProvider.js';
import { OpenAILocalProvider } from './openaiLocalProvider.js';
import { FallbackLocalProvider } from './fallbackProvider.js';
import { GeminiProvider } from './geminiProvider.js';
import { getLocalDb } from '../db/database.js';

export type ProviderType = 'gemini' | 'ollama' | 'ollama_cloud' | 'openai_local' | 'fallback';

export class LLMProviderManager {
  private static instance: LLMProviderManager;
  private currentProvider: LLMProvider;
  private providerType: ProviderType;
  private config: {
    baseUrl: string;
    model: string;
    temperature: number;
    apiKey?: string;
  };

  private constructor() {
    let savedSettings: Record<string, any> = {};
    try {
      const db = getLocalDb();
      savedSettings = db.getSettings() || {};
    } catch {
      // Safe fallback if DB not ready
    }

    const defaultProvider = (savedSettings.provider as ProviderType) ||
      (process.env.LLM_PROVIDER as ProviderType) ||
      (process.env.OLLAMA_API_KEY ? 'ollama_cloud' : process.env.GEMINI_API_KEY ? 'gemini' : 'ollama');

    this.providerType = defaultProvider;

    const apiKey = (savedSettings.apiKey && savedSettings.apiKey.trim().length > 0)
      ? savedSettings.apiKey.trim()
      : (process.env.OLLAMA_API_KEY && process.env.OLLAMA_API_KEY.trim().length > 0)
      ? process.env.OLLAMA_API_KEY.trim()
      : undefined;

    const defaultBaseUrl =
      this.providerType === 'gemini'
        ? 'https://generativelanguage.googleapis.com'
        : this.providerType === 'ollama_cloud'
        ? savedSettings.baseUrl || process.env.OLLAMA_BASE_URL || 'https://ollama.com'
        : savedSettings.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

    let defaultModel =
      this.providerType === 'gemini'
        ? savedSettings.model || 'gemini-3.8-flash'
        : savedSettings.model ||
          process.env.OLLAMA_MODEL ||
          (this.providerType === 'ollama_cloud' ? 'gemma4:31b-cloud' : 'llama3.1:8b');

    // llama3.1:8b is not available on the Ollama Cloud free plan
    if (this.providerType === 'ollama_cloud' && (!defaultModel || defaultModel === 'llama3.1:8b')) {
      defaultModel = 'gemma4:31b-cloud';
    }

    this.config = {
      baseUrl: defaultBaseUrl,
      model: defaultModel,
      temperature: Number(savedSettings.temperature || process.env.DEFAULT_TEMPERATURE) || 0.7,
      apiKey
    };

    this.currentProvider = this.createProvider(
      this.providerType,
      this.config.baseUrl,
      this.config.model,
      this.config.apiKey
    );
  }

  public static getInstance(): LLMProviderManager {
    if (!LLMProviderManager.instance) {
      LLMProviderManager.instance = new LLMProviderManager();
    }
    return LLMProviderManager.instance;
  }

  public createProvider(type: string, baseUrl: string, model: string, apiKey?: string): LLMProvider {
    if (type === 'gemini') {
      return new GeminiProvider(model || 'gemini-3.8-flash');
    }
    if (type === 'ollama_cloud') {
      const cloudUrl = baseUrl || process.env.OLLAMA_BASE_URL || 'https://ollama.com';
      const cloudKey = (apiKey && apiKey.trim().length > 0)
        ? apiKey.trim()
        : (process.env.OLLAMA_API_KEY && process.env.OLLAMA_API_KEY.trim().length > 0)
        ? process.env.OLLAMA_API_KEY.trim()
        : undefined;
      const cloudModel = (model && model !== 'llama3.1:8b') ? model : 'gemma4:31b';
      return new OllamaProvider(cloudUrl, cloudModel, cloudKey, 'Ollama Cloud', 'ollama_cloud');
    }
    if (type === 'openai_local') {
      return new OpenAILocalProvider(baseUrl || 'http://localhost:1234/v1', model || 'local-model');
    }
    if (type === 'fallback') {
      return new FallbackLocalProvider();
    }
    // Default to Ollama Local
    return new OllamaProvider(
      baseUrl || 'http://localhost:11434',
      model || 'llama3.1:8b',
      apiKey,
      'Ollama (Local LLM)',
      'ollama'
    );
  }

  public getProvider(): LLMProvider {
    return this.currentProvider;
  }

  public getConfig() {
    const key = this.config.apiKey || '';
    const hasApiKey = Boolean(key && key.trim().length > 0);
    const maskedApiKey = hasApiKey
      ? key.length > 8
        ? `${key.slice(0, 4)}••••${key.slice(-4)}`
        : '••••••••'
      : '';

    return {
      providerType: this.providerType,
      baseUrl: this.currentProvider.baseUrl,
      model: this.currentProvider.defaultModel,
      temperature: this.config.temperature,
      hasApiKey,
      maskedApiKey
    };
  }

  public getRawApiKey(): string | undefined {
    return this.config.apiKey;
  }

  public updateConfig(newConfig: {
    providerType?: ProviderType;
    baseUrl?: string;
    model?: string;
    temperature?: number;
    apiKey?: string;
  }) {
    if (newConfig.providerType) {
      this.providerType = newConfig.providerType;
    }
    if (newConfig.baseUrl) {
      this.config.baseUrl = newConfig.baseUrl;
    }
    if (newConfig.model) {
      this.config.model = newConfig.model;
    }
    if (newConfig.temperature !== undefined) {
      this.config.temperature = newConfig.temperature;
    }
    if (newConfig.apiKey !== undefined) {
      // If user passed a non-masked new key, update it; if empty string, clear it; if masked, keep existing
      if (!newConfig.apiKey.includes('••••')) {
        this.config.apiKey = newConfig.apiKey.trim() || undefined;
      }
    }

    this.currentProvider = this.createProvider(
      this.providerType,
      this.config.baseUrl,
      this.config.model,
      this.config.apiKey
    );

    try {
      const db = getLocalDb();
      db.updateSettings({
        provider: this.providerType,
        baseUrl: this.config.baseUrl,
        model: this.config.model,
        temperature: this.config.temperature,
        ...(this.config.apiKey !== undefined ? { apiKey: this.config.apiKey } : {})
      });
    } catch {
      // Safe catch
    }
  }

  public async getActiveProviderWithFallback(): Promise<LLMProvider> {
    const isPrimaryAvailable = await this.currentProvider.isAvailable();
    if (isPrimaryAvailable) {
      return this.currentProvider;
    }

    // If primary is unavailable (e.g. Ollama offline), check if Gemini is available
    if (this.providerType !== 'gemini' && process.env.GEMINI_API_KEY) {
      const gemini = new GeminiProvider();
      if (await gemini.isAvailable()) {
        return gemini;
      }
    }

    // Try fallback rule engine if other services are offline
    console.warn(`Primary provider (${this.currentProvider.name}) is offline. Using SparkyAI local rule engine fallback.`);
    return new FallbackLocalProvider();
  }
}

export const getLLMProviderManager = () => LLMProviderManager.getInstance();
