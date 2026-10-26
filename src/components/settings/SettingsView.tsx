import React, { useState, useEffect } from 'react';
import {
  Server,
  Sliders,
  FileSpreadsheet,
  HardDrive,
  Sun,
  Moon,
  Laptop,
  Check,
  RotateCcw,
  RefreshCw,
  Sparkles,
  Cpu,
  Zap,
  ShieldCheck,
  Cloud,
  Key,
  Eye,
  EyeOff,
  CheckCircle2
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { HumanizerConfig } from '../../types';

interface SettingsViewProps {
  config: HumanizerConfig;
  onChangeConfig: (config: HumanizerConfig) => void;
  aiProviderStatus: {
    provider: string;
    model: string;
    status: 'connected' | 'connecting' | 'error';
  };
  onTestAiConnection: () => Promise<boolean>;
  onClearStorage: () => void;
  onRefreshAiStatus?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  config,
  onChangeConfig,
  aiProviderStatus,
  onTestAiConnection,
  onClearStorage,
  onRefreshAiStatus
}) => {
  const { theme, setTheme } = useTheme();
  const [activeSection, setActiveSection] = useState<'provider' | 'processing' | 'csv' | 'appearance' | 'storage'>('provider');
  const [selectedProvider, setSelectedProvider] = useState<string>('ollama_cloud');
  const [ollamaUrl, setOllamaUrl] = useState('https://ollama.com');
  const [modelInput, setModelInput] = useState('llama3.1:8b');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [hasSavedApiKey, setHasSavedApiKey] = useState(false);
  const [maskedApiKey, setMaskedApiKey] = useState('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Fetch current LLM config & status on mount
  useEffect(() => {
    fetch('/api/settings/llm')
      .then(res => res.json())
      .then(data => {
        if (data.providerType) setSelectedProvider(data.providerType);
        if (data.baseUrl) setOllamaUrl(data.baseUrl);
        if (data.model) setModelInput(data.model);
        if (data.hasApiKey) {
          setHasSavedApiKey(true);
          setMaskedApiKey(data.maskedApiKey || '••••••••');
        }
      })
      .catch(() => {});

    fetch('/api/health/llm')
      .then(res => res.json())
      .then(data => {
        if (data.availableModels && Array.isArray(data.availableModels) && data.availableModels.length > 0) {
          setAvailableModels(data.availableModels);
        }
      })
      .catch(() => {});
  }, []);

  const handleFetchModels = async () => {
    setIsFetchingModels(true);
    try {
      const res = await fetch('/api/health/llm');
      const data = await res.json();
      if (data.availableModels && Array.isArray(data.availableModels) && data.availableModels.length > 0) {
        setAvailableModels(data.availableModels);
        setTestResult(`Found ${data.availableModels.length} models on Ollama host.`);
      } else {
        setTestResult('No custom models found; using default model.');
      }
    } catch (e: any) {
      setTestResult(`Could not fetch models: ${e.message}`);
    } finally {
      setIsFetchingModels(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const ok = await onTestAiConnection();
      if (ok) {
        setTestResult('Connected successfully! Ollama Cloud / model endpoint is active.');
        handleFetchModels();
      } else {
        setTestResult('Connection failed. Verify API Key and Base URL.');
      }
    } catch (e: any) {
      setTestResult(`Error: ${e.message}`);
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveProvider = async () => {
    setIsSaving(true);
    setSaveMessage(null);
    try {
      const payload: Record<string, any> = {
        providerType: selectedProvider,
        baseUrl: ollamaUrl,
        model: modelInput
      };

      if (apiKeyInput.trim()) {
        payload.apiKey = apiKeyInput.trim();
      }

      const res = await fetch('/api/settings/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        setSaveMessage('Provider configuration saved successfully.');
        if (data.updatedConfig) {
          setHasSavedApiKey(Boolean(data.updatedConfig.hasApiKey));
          setMaskedApiKey(data.updatedConfig.maskedApiKey || '');
        }
        setApiKeyInput('');
        if (onRefreshAiStatus) onRefreshAiStatus();
        setTimeout(() => setSaveMessage(null), 3000);
      } else {
        const err = await res.json();
        setSaveMessage(`Failed to save: ${err.error || 'Server error'}`);
      }
    } catch (err: any) {
      setSaveMessage(`Error: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          Platform Settings
        </h1>
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
          Configure AI providers, Ollama Cloud API credentials, batch processing defaults, CSV schemas, and data persistence.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {/* Left Nav Menu */}
        <div className="space-y-1">
          <button
            onClick={() => setActiveSection('provider')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-left transition-colors ${
              activeSection === 'provider'
                ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white font-semibold'
                : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-900'
            }`}
          >
            <Server className="w-4 h-4 text-indigo-500" />
            <span>AI Providers & Models</span>
          </button>

          <button
            onClick={() => setActiveSection('processing')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-left transition-colors ${
              activeSection === 'processing'
                ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white font-semibold'
                : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-900'
            }`}
          >
            <Sliders className="w-4 h-4 text-purple-500" />
            <span>Processing Defaults</span>
          </button>

          <button
            onClick={() => setActiveSection('csv')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-left transition-colors ${
              activeSection === 'csv'
                ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white font-semibold'
                : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-900'
            }`}
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
            <span>CSV Parsing & Schemas</span>
          </button>

          <button
            onClick={() => setActiveSection('appearance')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-left transition-colors ${
              activeSection === 'appearance'
                ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white font-semibold'
                : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-900'
            }`}
          >
            <Sun className="w-4 h-4 text-amber-500" />
            <span>Theme & Appearance</span>
          </button>

          <button
            onClick={() => setActiveSection('storage')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-left transition-colors ${
              activeSection === 'storage'
                ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-white font-semibold'
                : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-900'
            }`}
          >
            <HardDrive className="w-4 h-4 text-rose-500" />
            <span>Storage & Persistence</span>
          </button>
        </div>

        {/* Right Details Panel */}
        <div className="md:col-span-3 bg-white dark:bg-[#15181e] border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 shadow-xs">
          {activeSection === 'provider' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  AI Inference Engines
                </h3>
                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                  Select your primary engine. You can now use your Ollama Cloud API Key or connect to local models. If offline, the platform seamlessly uses the internal rule engine.
                </p>
              </div>

              {/* Status Pill */}
              <div className="p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-[#11141a] flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-neutral-800 dark:text-neutral-200 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-amber-500" />
                    <span>Active Engine: {aiProviderStatus.provider}</span>
                  </p>
                  <p className="text-[11px] font-mono text-neutral-500 mt-0.5">
                    Model: {aiProviderStatus.model}
                    {hasSavedApiKey && ' · Cloud API Key Active'}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-xs font-mono">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      aiProviderStatus.status === 'connected' ? 'bg-emerald-500' : 'bg-amber-500'
                    }`}
                  />
                  <span className="capitalize">{aiProviderStatus.status}</span>
                </div>
              </div>

              {/* Provider Selection Cards */}
              <div className="space-y-2 pt-1">
                <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                  Select Provider:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {/* 1. OLLAMA CLOUD CARD (NEW) */}
                  <div
                    onClick={() => {
                      setSelectedProvider('ollama_cloud');
                      if (ollamaUrl === 'http://localhost:11434') {
                        setOllamaUrl('https://ollama.com');
                      }
                      if (!modelInput || modelInput === 'sparky-rules-v1') {
                        setModelInput('llama3.1:8b');
                      }
                    }}
                    className={`p-3 rounded-lg border cursor-pointer transition-all relative overflow-hidden ${
                      selectedProvider === 'ollama_cloud'
                        ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20 text-neutral-900 dark:text-neutral-100 font-semibold ring-1 ring-indigo-500/30'
                        : 'border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900 text-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold flex items-center gap-1.5">
                        <Cloud className="w-3.5 h-3.5 text-blue-500" />
                        <span>Ollama Cloud</span>
                        <span className="text-[10px] bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-1.5 py-0.2 rounded font-medium">
                          API Key
                        </span>
                      </span>
                      {selectedProvider === 'ollama_cloud' && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                    </div>
                    <p className="text-[11px] text-neutral-500 mt-1 font-normal">
                      Remote Ollama Cloud inference with your API key. No local GPU required.
                    </p>
                  </div>

                  {/* 2. OLLAMA LOCAL CARD */}
                  <div
                    onClick={() => {
                      setSelectedProvider('ollama');
                      setOllamaUrl('http://localhost:11434');
                      setModelInput('llama3.1:8b');
                    }}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                      selectedProvider === 'ollama'
                        ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20 text-neutral-900 dark:text-neutral-100 font-semibold'
                        : 'border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900 text-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold flex items-center gap-1.5">
                        <Server className="w-3.5 h-3.5 text-purple-500" />
                        <span>Ollama Local</span>
                      </span>
                      {selectedProvider === 'ollama' && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                    </div>
                    <p className="text-[11px] text-neutral-500 mt-1 font-normal">
                      100% offline local model running on localhost:11434.
                    </p>
                  </div>

                  {/* 3. GEMINI CARD */}
                  <div
                    onClick={() => {
                      setSelectedProvider('gemini');
                      setModelInput('gemini-3.8-flash');
                    }}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                      selectedProvider === 'gemini'
                        ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20 text-neutral-900 dark:text-neutral-100 font-semibold'
                        : 'border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900 text-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                        <span>Google Gemini</span>
                      </span>
                      {selectedProvider === 'gemini' && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                    </div>
                    <p className="text-[11px] text-neutral-500 mt-1 font-normal">
                      High-capacity neural rewriting via Gemini 3.8 Flash (auto-backoff & rate-limit protection).
                    </p>
                  </div>

                  {/* 4. OPENAI COMPATIBLE CARD */}
                  <div
                    onClick={() => {
                      setSelectedProvider('openai_local');
                      setOllamaUrl('http://localhost:1234/v1');
                      setModelInput('local-model');
                    }}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                      selectedProvider === 'openai_local'
                        ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20 text-neutral-900 dark:text-neutral-100 font-semibold'
                        : 'border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900 text-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold flex items-center gap-1.5">
                        <Cpu className="w-3.5 h-3.5 text-emerald-500" />
                        <span>OpenAI Compatible</span>
                      </span>
                      {selectedProvider === 'openai_local' && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                    </div>
                    <p className="text-[11px] text-neutral-500 mt-1 font-normal">
                      Connect to LM Studio, vLLM, or LocalAI endpoints.
                    </p>
                  </div>

                  {/* 5. SPARKY RULE ENGINE CARD */}
                  <div
                    onClick={() => {
                      setSelectedProvider('fallback');
                      setModelInput('sparky-rules-v1');
                    }}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                      selectedProvider === 'fallback'
                        ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20 text-neutral-900 dark:text-neutral-100 font-semibold'
                        : 'border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900 text-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-blue-500" />
                        <span>SparkyAI Rule Engine</span>
                      </span>
                      {selectedProvider === 'fallback' && <Check className="w-3.5 h-3.5 text-indigo-600" />}
                    </div>
                    <p className="text-[11px] text-neutral-500 mt-1 font-normal">
                      Deterministic offline regex parser and fluff remover (zero setup).
                    </p>
                  </div>
                </div>
              </div>

              {/* OLLAMA CLOUD CONFIGURATION PANEL */}
              {selectedProvider === 'ollama_cloud' && (
                <div className="space-y-3.5 pt-3 border-t border-neutral-100 dark:border-neutral-800">
                  <div className="p-3 bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-900/60 rounded-xl space-y-1">
                    <p className="text-xs font-semibold text-blue-900 dark:text-blue-200 flex items-center gap-1.5">
                      <Key className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span>Ollama Cloud Credentials & Remote Endpoint</span>
                    </p>
                    <p className="text-[11px] text-blue-700 dark:text-blue-300 leading-relaxed">
                      Insert your free Ollama Cloud API Key below. The backend securely injects your Bearer authentication header on every inference request.
                    </p>
                  </div>

                  {/* Cloud Base URL */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                        Ollama Cloud Base URL:
                      </label>
                      <div className="flex items-center gap-1.5 text-[10px]">
                        <button
                          type="button"
                          onClick={() => setOllamaUrl('https://ollama.com')}
                          className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          ollama.com
                        </button>
                        <span className="text-neutral-400">·</span>
                        <button
                          type="button"
                          onClick={() => setOllamaUrl('https://api.ollama.ai')}
                          className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          api.ollama.ai
                        </button>
                      </div>
                    </div>
                    <input
                      type="text"
                      value={ollamaUrl}
                      onChange={(e) => setOllamaUrl(e.target.value)}
                      placeholder="https://ollama.com or https://your-cloud-instance.com"
                      className="w-full bg-neutral-50 dark:bg-[#181c24] border border-neutral-200 dark:border-neutral-800 rounded-lg px-3 py-1.5 text-xs font-mono"
                    />
                  </div>

                  {/* Ollama Cloud API Key Input */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300 flex items-center gap-1.5">
                        <Key className="w-3 h-3 text-neutral-400" />
                        <span>Ollama Cloud API Key:</span>
                      </label>
                      {hasSavedApiKey && (
                        <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Saved ({maskedApiKey})</span>
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        type={showApiKey ? 'text' : 'password'}
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        placeholder={hasSavedApiKey ? `Current: ${maskedApiKey} (Enter new key to change)` : 'Paste your Ollama Cloud API key here...'}
                        className="w-full bg-neutral-50 dark:bg-[#181c24] border border-neutral-200 dark:border-neutral-800 rounded-lg pl-3 pr-10 py-1.5 text-xs font-mono focus:ring-1 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 cursor-pointer"
                      >
                        {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <p className="text-[10px] text-neutral-500 mt-1">
                      Never exposed to the client. Safely stored and used as Bearer token by the local backend proxy.
                    </p>
                  </div>

                  {/* Cloud Model Identifier */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                        Ollama Cloud Model:
                      </label>
                      <button
                        type="button"
                        onClick={handleFetchModels}
                        disabled={isFetchingModels}
                        className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <RefreshCw className={`w-2.5 h-2.5 ${isFetchingModels ? 'animate-spin' : ''}`} />
                        <span>Discover Account Models</span>
                      </button>
                    </div>
                    <input
                      type="text"
                      value={modelInput}
                      onChange={(e) => setModelInput(e.target.value)}
                      placeholder="llama3.1:8b, llama3.3:70b, mistral, etc."
                      className="w-full bg-neutral-50 dark:bg-[#181c24] border border-neutral-200 dark:border-neutral-800 rounded-lg px-3 py-1.5 text-xs font-mono"
                    />

                    {/* Quick Model Tags */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1.5">
                      <span className="text-[10px] text-neutral-400">Popular:</span>
                      {['gemma4:31b-cloud', 'llama3.1:8b', 'llama3.2:3b', 'mistral', 'deepseek-r1:8b', 'qwen2.5:7b'].map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setModelInput(m)}
                          className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                            modelInput === m
                              ? 'bg-blue-600 text-white border-blue-600 font-semibold'
                              : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-200'
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>

                    {/* Detected models dropdown if available */}
                    {availableModels.length > 0 && (
                      <div className="pt-2">
                        <label className="text-[10px] text-neutral-500 block mb-1">
                          Detected on your Ollama account:
                        </label>
                        <select
                          value={modelInput}
                          onChange={(e) => setModelInput(e.target.value)}
                          className="w-full bg-white dark:bg-[#181c24] border border-neutral-200 dark:border-neutral-800 rounded-lg px-2.5 py-1 text-xs font-mono"
                        >
                          <option value={modelInput}>{modelInput} (Current)</option>
                          {availableModels
                            .filter((m) => m !== modelInput)
                            .map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Endpoint & Model Inputs for Ollama Local / OpenAI Compatible */}
              {(selectedProvider === 'ollama' || selectedProvider === 'openai_local') && (
                <div className="space-y-3 pt-2 border-t border-neutral-100 dark:border-neutral-800">
                  <div>
                    <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                      API Base URL:
                    </label>
                    <input
                      type="text"
                      value={ollamaUrl}
                      onChange={(e) => setOllamaUrl(e.target.value)}
                      className="w-full bg-neutral-50 dark:bg-[#181c24] border border-neutral-200 dark:border-neutral-800 rounded-lg px-3 py-1.5 text-xs font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                      Model Identifier:
                    </label>
                    <input
                      type="text"
                      value={modelInput}
                      onChange={(e) => setModelInput(e.target.value)}
                      className="w-full bg-neutral-50 dark:bg-[#181c24] border border-neutral-200 dark:border-neutral-800 rounded-lg px-3 py-1.5 text-xs font-mono"
                    />
                  </div>

                  {selectedProvider === 'ollama' && (
                    <div>
                      <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                        Optional Local Auth Key (leave empty for default local Ollama):
                      </label>
                      <input
                        type="password"
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        placeholder="Optional"
                        className="w-full bg-neutral-50 dark:bg-[#181c24] border border-neutral-200 dark:border-neutral-800 rounded-lg px-3 py-1.5 text-xs font-mono"
                      />
                    </div>
                  )}
                </div>
              )}

              {selectedProvider === 'gemini' && (
                <div className="space-y-3 pt-2 border-t border-neutral-100 dark:border-neutral-800">
                  <div>
                    <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                      Gemini Model Tag:
                    </label>
                    <select
                      value={modelInput}
                      onChange={(e) => setModelInput(e.target.value)}
                      className="w-full bg-neutral-50 dark:bg-[#181c24] border border-neutral-200 dark:border-neutral-800 rounded-lg px-3 py-1.5 text-xs font-mono"
                    >
                      <option value="gemini-3.8-flash">gemini-3.8-flash (Standard - High Authenticity & Quality)</option>
                      <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (High Speed & Highest Rate Limits)</option>
                      <option value="gemini-flash-latest">gemini-flash-latest (Always Latest Gemini Flash)</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-neutral-100 dark:border-neutral-800">
                <button
                  onClick={handleSaveProvider}
                  disabled={isSaving}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors cursor-pointer"
                >
                  {isSaving ? 'Saving...' : 'Save Configuration'}
                </button>

                <button
                  onClick={handleTest}
                  disabled={isTesting}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                  <span>Test Connection</span>
                </button>

                {saveMessage && (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                    {saveMessage}
                  </span>
                )}

                {testResult && !saveMessage && (
                  <span className="text-xs text-neutral-600 dark:text-neutral-400 font-mono">
                    {testResult}
                  </span>
                )}
              </div>
            </div>
          )}

          {activeSection === 'processing' && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                Batch Processing Parameters
              </h3>
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-[#11141a]">
                  <div>
                    <p className="font-semibold text-neutral-800 dark:text-neutral-200">
                      Auto-Critique Verification Loop
                    </p>
                    <p className="text-[11px] text-neutral-500">
                      Runs a second-pass evaluator to detect robotic repetition and hallucinated terms.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={config.enableCritic}
                    onChange={(e) => onChangeConfig({ ...config, enableCritic: e.target.checked })}
                    className="w-4 h-4 accent-indigo-600 rounded"
                  />
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-[#11141a]">
                  <div>
                    <p className="font-semibold text-neutral-800 dark:text-neutral-200">
                      Strip AI Conversational Fluff
                    </p>
                    <p className="text-[11px] text-neutral-500">
                      Removes "Sure, here is your article...", "In conclusion...", and boilerplate greetings.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={config.removeAiFluff}
                    onChange={(e) => onChangeConfig({ ...config, removeAiFluff: e.target.checked })}
                    className="w-4 h-4 accent-indigo-600 rounded"
                  />
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-[#11141a]">
                  <div>
                    <p className="font-semibold text-neutral-800 dark:text-neutral-200">
                      Add Conversational Contractions
                    </p>
                    <p className="text-[11px] text-neutral-500">
                      Automatically converts rigid phrasing into natural contractions (don't, it's, we've).
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={config.addContractions}
                    onChange={(e) => onChangeConfig({ ...config, addContractions: e.target.checked })}
                    className="w-4 h-4 accent-indigo-600 rounded"
                  />
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-[#11141a]">
                  <div>
                    <p className="font-semibold text-neutral-800 dark:text-neutral-200">
                      Worker Concurrency (Parallelism)
                    </p>
                    <p className="text-[11px] text-neutral-500">
                      Number of simultaneous workers processing CSV records. (2 recommended for rate stability).
                    </p>
                  </div>
                  <div className="flex items-center gap-1 font-mono">
                    {[1, 2, 3].map((num) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => onChangeConfig({ ...config, batchConcurrency: num })}
                        className={`w-7 h-7 rounded text-xs font-semibold transition-colors ${
                          (config.batchConcurrency || 2) === num
                            ? 'bg-indigo-600 text-white'
                            : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-300'
                        }`}
                      >
                        {num}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-[#11141a]">
                  <div>
                    <p className="font-semibold text-neutral-800 dark:text-neutral-200">
                      Batch Rate-Limit Pacing Delay
                    </p>
                    <p className="text-[11px] text-neutral-500">
                      Adaptive delay between consecutive requests to avoid 429 quota limits on standard API tiers.
                    </p>
                  </div>
                  <select
                    value={config.batchDelayMs ?? 250}
                    onChange={(e) => onChangeConfig({ ...config, batchDelayMs: Number(e.target.value) })}
                    className="bg-white dark:bg-[#181c24] border border-neutral-200 dark:border-neutral-800 rounded-lg px-2.5 py-1 text-xs font-mono text-neutral-800 dark:text-neutral-200"
                  >
                    <option value={0}>0ms (Instant, maximum speed)</option>
                    <option value={250}>250ms (Recommended)</option>
                    <option value={500}>500ms (Safe rate pacing)</option>
                    <option value={1000}>1000ms (High quota protection)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'csv' && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                CSV Ingestion & Export Standard
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                The platform guarantees 100% schema parity, verbatim header reproduction, and UTF-8 encoding.
              </p>
              <div className="p-3.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-[#11141a] space-y-2 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-neutral-500">Encoding:</span>
                  <span className="font-bold text-neutral-800 dark:text-neutral-200">UTF-8 / UTF-8 with BOM</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Delimiter:</span>
                  <span className="font-bold text-neutral-800 dark:text-neutral-200">Comma (,)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Quote Escape:</span>
                  <span className="font-bold text-neutral-800 dark:text-neutral-200">RFC 4180 ("")</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Max Upload Limit:</span>
                  <span className="font-bold text-neutral-800 dark:text-neutral-200">500 MB</span>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'appearance' && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                Visual Theme
              </h3>
              <div className="grid grid-cols-3 gap-3">
                <button
                  onClick={() => setTheme('light')}
                  className={`p-3 rounded-lg border text-center transition-all ${
                    theme === 'light'
                      ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20 text-neutral-900 dark:text-neutral-100 font-semibold'
                      : 'border-neutral-200 dark:border-neutral-800 text-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-900'
                  }`}
                >
                  <Sun className="w-5 h-5 mx-auto mb-1.5 text-amber-500" />
                  <span className="text-xs">Light</span>
                </button>

                <button
                  onClick={() => setTheme('dark')}
                  className={`p-3 rounded-lg border text-center transition-all ${
                    theme === 'dark'
                      ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20 text-neutral-900 dark:text-neutral-100 font-semibold'
                      : 'border-neutral-200 dark:border-neutral-800 text-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-900'
                  }`}
                >
                  <Moon className="w-5 h-5 mx-auto mb-1.5 text-indigo-400" />
                  <span className="text-xs">Dark</span>
                </button>

                <button
                  onClick={() => setTheme('system')}
                  className={`p-3 rounded-lg border text-center transition-all ${
                    theme === 'system'
                      ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20 text-neutral-900 dark:text-neutral-100 font-semibold'
                      : 'border-neutral-200 dark:border-neutral-800 text-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-900'
                  }`}
                >
                  <Laptop className="w-5 h-5 mx-auto mb-1.5 text-neutral-400" />
                  <span className="text-xs">System</span>
                </button>
              </div>
            </div>
          )}

          {activeSection === 'storage' && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                Storage & Cache Management
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Uploaded CSV datasets are stored locally in the workspace storage directory. Audit logs and preferences are persisted in local browser storage.
              </p>
              <button
                onClick={onClearStorage}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/50 hover:bg-rose-100 transition-colors"
              >
                Clear Local Storage Cache
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
