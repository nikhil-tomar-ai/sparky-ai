import React, { useState, useEffect, useRef } from 'react';
import { Sidebar, ViewTab } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { DashboardOverview } from './components/dashboard/DashboardOverview';
import { MetricsBar } from './components/MetricsBar';
import { UploadSection } from './components/UploadSection';
import { ConfigPanel } from './components/ConfigPanel';
import { DataTableView } from './components/DataTableView';
import { ProcessProgressModal } from './components/ProcessProgressModal';
import { DiffReviewModal } from './components/DiffReviewModal';
import { SplitComparisonView } from './components/results/SplitComparisonView';
import { AuditLogView } from './components/AuditLogView';
import { SettingsView } from './components/settings/SettingsView';
import { SchemaValidationModal } from './components/SchemaValidationModal';
import { DocumentHumanizer } from './components/DocumentHumanizer';
import { useToast } from './components/ui/Toast';
import { DatasetSummary } from './services/api';
import { Table, BarChart2, ArrowRight, UploadCloud, FileSpreadsheet, Download, RefreshCw } from 'lucide-react';

import {
  BlogRow,
  HumanizerConfig,
  BatchProcessingStats,
  AuditLogEntry
} from './types';
import {
  calculateFleschScore,
  calculateFluffPercentage,
  exportRowsToCSV,
  validateExportedCSV,
  ValidationReport,
  triggerFileDownload,
  parseCSVString,
  autoDetectColumns
} from './utils/csvUtils';
import { SAMPLE_DATASETS } from './data/sampleBlogs';

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { addToast } = useToast();

  // Active View Tab (dashboard | datasets | workspace | diff | audit | settings)
  const [activeTab, setActiveTab] = useState<ViewTab>('dashboard');

  // Core App State
  const [activeFileName, setActiveFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<BlogRow[]>([]);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());

  // AI Provider Status
  const [aiProviderStatus, setAiProviderStatus] = useState<{
    provider: string;
    model: string;
    status: 'connected' | 'connecting' | 'error';
  }>({
    provider: 'Gemini Flash & Ollama',
    model: 'gemini-3.8-flash / llama3',
    status: 'connected'
  });

  // Humanizer Config
  const [config, setConfig] = useState<HumanizerConfig>({
    contentColumn: 'content',
    titleColumn: 'title',
    authorColumn: 'author',
    targetColumns: ['*'],
    tone: 'conversational',
    customPrompt: '',
    temperature: 0.7,
    enableCritic: true,
    preserveKeywords: [],
    addContractions: true,
    removeAiFluff: true,
    batchConcurrency: 2,
    batchDelayMs: 250
  });

  // Batch Processing State
  const [batchStats, setBatchStats] = useState<BatchProcessingStats>({
    totalRows: 0,
    completedRows: 0,
    successfulRows: 0,
    failedRows: 0,
    startTime: null,
    endTime: null,
    isProcessing: false,
    isPaused: false,
    currentProcessingId: null
  });

  const [currentProcessingTitle, setCurrentProcessingTitle] = useState<string>('');
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const processingRef = useRef<boolean>(false);
  const pausedRef = useRef<boolean>(false);

  // Modals State
  const [reviewRow, setReviewRow] = useState<BlogRow | null>(null);
  const [validationReport, setValidationReport] = useState<ValidationReport | null>(null);
  const [isSchemaModalOpen, setIsSchemaModalOpen] = useState<boolean>(false);

  // Persistent Audit Logs State
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(() => {
    try {
      const saved = localStorage.getItem('humanizer_audit_checkpoint_logs');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('humanizer_audit_checkpoint_logs', JSON.stringify(auditLogs));
    } catch (e) {
      console.warn('Could not save audit logs to localStorage:', e);
    }
  }, [auditLogs]);

  // Load dataset list & AI status on startup
  const refreshAiStatus = async () => {
    try {
      const res = await fetch('/api/health/llm');
      const data = await res.json();
      setAiProviderStatus({
        provider: data.providerName || data.provider,
        model: data.activeModel,
        status: data.connected ? 'connected' : 'error'
      });
    } catch {
      setAiProviderStatus({
        provider: 'SparkyAI Offline Engine',
        model: 'sparky-rules-v1',
        status: 'connected'
      });
    }
  };

  useEffect(() => {
    refreshAiStatus();
  }, []);

  const handleLoadRows = (
    records: Record<string, string>[],
    filename: string,
    contentCol: string,
    titleCol: string,
    authorCol: string,
    targetCols?: string[]
  ) => {
    const formattedRows: BlogRow[] = records.map((rec, idx) => {
      const rawContent = rec[contentCol] || rec['content'] || '';
      const title = titleCol ? rec[titleCol] || `Record #${idx + 1}` : `Record #${idx + 1}`;
      const author = authorCol ? rec[authorCol] || 'Author' : '';

      return {
        id: `row-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 5)}`,
        originalIndex: idx,
        rawRecord: rec,
        title,
        author,
        originalContent: rawContent,
        humanizedContent: '',
        humanizedColumns: {},
        status: 'pending',
        wordCountOriginal: rawContent.split(/\s+/).filter(Boolean).length,
        wordCountHumanized: 0,
        fleschScoreOriginal: calculateFleschScore(rawContent),
        fleschScoreHumanized: 0,
        aiFluffReduction: calculateFluffPercentage(rawContent)
      };
    });

    setRows(formattedRows);
    setActiveFileName(filename);
    setSelectedRowIds(new Set());
    setConfig((prev) => ({
      ...prev,
      contentColumn: contentCol,
      titleColumn: titleCol,
      authorColumn: authorCol,
      targetColumns: targetCols && targetCols.length > 0 ? targetCols : ['*']
    }));
    setActiveTab('workspace');
  };

  const handleToggleSelectRow = (id: string) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    if (selectedRowIds.size === rows.length) {
      setSelectedRowIds(new Set());
    } else {
      setSelectedRowIds(new Set(rows.map((r) => r.id)));
    }
  };

  const executeHumanizeRowCall = async (
    row: BlogRow,
    overrideConfig?: Partial<HumanizerConfig>
  ): Promise<{ humanizedText: string; humanizedColumns?: Record<string, string>; criticResult?: any }> => {
    const activeCfg = { ...config, ...overrideConfig };
    let columnsToRewrite: Record<string, string> | undefined = undefined;

    if (activeCfg.targetColumns && activeCfg.targetColumns.length > 0) {
      columnsToRewrite = {};
      if (activeCfg.targetColumns.includes('*')) {
        Object.entries(row.rawRecord || {}).forEach(([k, v]) => {
          if (v && v.trim().length > 0) {
            columnsToRewrite![k] = v;
          }
        });
      } else {
        activeCfg.targetColumns.forEach((col) => {
          if (row.rawRecord && row.rawRecord[col] !== undefined) {
            columnsToRewrite![col] = row.rawRecord[col];
          }
        });
      }
    }

    const payload = JSON.stringify({
      content: row.originalContent,
      columnsToRewrite: columnsToRewrite && Object.keys(columnsToRewrite).length > 0 ? columnsToRewrite : undefined,
      title: row.title,
      author: row.author,
      tone: activeCfg.tone,
      customPrompt: activeCfg.customPrompt,
      temperature: activeCfg.temperature,
      enableCritic: activeCfg.enableCritic,
      preserveKeywords: activeCfg.preserveKeywords,
      addContractions: activeCfg.addContractions,
      removeAiFluff: activeCfg.removeAiFluff
    });

    let response: Response;
    try {
      response = await fetch('/api/humanize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      });
    } catch {
      // 1 client retry after 1.5s delay
      await new Promise((r) => setTimeout(r, 1500));
      response = await fetch('/api/humanize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      });
    }

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error || 'Server error during AI humanization');
    }

    const data = await response.json();
    return {
      humanizedText: data.humanized || row.originalContent,
      humanizedColumns: data.humanizedColumns || {},
      criticResult: data.criticResult
    };
  };

  const handleSingleRowRewrite = async (row: BlogRow, customPromptOverride?: string) => {
    const startTime = Date.now();
    try {
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, status: 'processing' } : r))
      );

      const res = await executeHumanizeRowCall(row, {
        customPrompt: customPromptOverride || config.customPrompt
      });

      const wordCountBefore = row.wordCountOriginal;
      const wordCountAfter = res.humanizedText.split(/\s+/).filter(Boolean).length;
      const fleschAfter = calculateFleschScore(res.humanizedText);

      const updatedRow: BlogRow = {
        ...row,
        humanizedContent: res.humanizedText,
        humanizedColumns: res.humanizedColumns || {},
        status: 'humanized',
        criticResult: res.criticResult,
        wordCountHumanized: wordCountAfter,
        fleschScoreHumanized: fleschAfter,
        processedAt: new Date().toISOString(),
        timeTakenMs: Date.now() - startTime
      };

      setRows((prev) => prev.map((r) => (r.id === row.id ? updatedRow : r)));
      setReviewRow((curr) => (curr && curr.id === row.id ? updatedRow : curr));

      const auditEntry: AuditLogEntry = {
        id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        filename: activeFileName || 'dataset.csv',
        rowIndex: row.originalIndex,
        title: row.title,
        originalContent: row.originalContent,
        humanizedContent: res.humanizedText,
        wordCountOriginal: wordCountBefore,
        wordCountHumanized: wordCountAfter,
        tone: config.tone,
        criticScore: res.criticResult?.score || 85,
        timestamp: new Date().toISOString(),
        tokensUsed: Math.round((wordCountBefore + wordCountAfter) * 1.3)
      };

      setAuditLogs((prev) => [auditEntry, ...prev]);
      addToast('success', `Humanized: ${row.title}`);
    } catch (err: any) {
      console.error(`Error rewriting row ${row.id}:`, err);
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? { ...r, status: 'failed', errorMessage: err.message || 'Failed to rewrite' }
            : r
        )
      );
      setReviewRow((curr) =>
        curr && curr.id === row.id ? { ...curr, status: 'failed', errorMessage: err.message } : curr
      );
      addToast('error', `Failed to rewrite ${row.title}: ${err.message}`);
    }
  };

  const handleStartBatch = async (selectedOnly = false) => {
    const targetRows = selectedOnly
      ? rows.filter((r) => selectedRowIds.has(r.id))
      : rows;

    if (targetRows.length === 0) return;

    processingRef.current = true;
    pausedRef.current = false;

    setBatchStats({
      totalRows: targetRows.length,
      completedRows: 0,
      successfulRows: 0,
      failedRows: 0,
      startTime: Date.now(),
      endTime: null,
      isProcessing: true,
      isPaused: false,
      currentProcessingId: null
    });

    setTerminalLogs([
      `[${new Date().toLocaleTimeString()}] Batch job started: ${targetRows.length} rows queued.`,
      `[${new Date().toLocaleTimeString()}] Concurrency: ${config.batchConcurrency} parallel workers · Tone: ${config.tone}`
    ]);

    const concurrency = Math.max(1, Math.min(5, config.batchConcurrency || 2));
    let currentIndex = 0;

    const executeWaitCountdown = async (durationMs: number, reason: string) => {
      if (durationMs <= 0 || !processingRef.current) return;
      const totalSeconds = Math.ceil(durationMs / 1000);
      for (let s = totalSeconds; s > 0; s--) {
        if (!processingRef.current) break;
        while (pausedRef.current && processingRef.current) {
          await new Promise((r) => setTimeout(r, 400));
        }
        setBatchStats((prev) => ({
          ...prev,
          waitingCountdownSeconds: s,
          waitingReason: reason
        }));
        await new Promise((r) => setTimeout(r, 1000));
      }
      setBatchStats((prev) => ({
        ...prev,
        waitingCountdownSeconds: null,
        waitingReason: null
      }));
    };

    const worker = async (workerId: number) => {
      while (currentIndex < targetRows.length && processingRef.current) {
        while (pausedRef.current && processingRef.current) {
          await new Promise((r) => setTimeout(r, 400));
        }

        if (!processingRef.current) break;

        const row = targetRows[currentIndex];
        currentIndex++;

        if (!row) continue;

        setCurrentProcessingTitle(row.title);
        setBatchStats((prev) => ({ ...prev, currentProcessingId: row.id }));
        setTerminalLogs((prev) => [
          ...prev.slice(-30),
          `[W${workerId}] Processing #${row.originalIndex + 1}: "${row.title.slice(0, 30)}..."`
        ]);

        try {
          const res = await executeHumanizeRowCall(row);
          const wordCountAfter = res.humanizedText.split(/\s+/).filter(Boolean).length;
          const fleschAfter = calculateFleschScore(res.humanizedText);

          const updatedRow: BlogRow = {
            ...row,
            humanizedContent: res.humanizedText,
            humanizedColumns: res.humanizedColumns || {},
            status: 'humanized',
            criticResult: res.criticResult,
            wordCountHumanized: wordCountAfter,
            fleschScoreHumanized: fleschAfter,
            processedAt: new Date().toISOString()
          };

          setRows((prev) => prev.map((r) => (r.id === row.id ? updatedRow : r)));

          const auditEntry: AuditLogEntry = {
            id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            filename: activeFileName || 'dataset.csv',
            rowIndex: row.originalIndex,
            title: row.title,
            originalContent: row.originalContent,
            humanizedContent: res.humanizedText,
            tone: config.tone,
            criticScore: res.criticResult?.score || 85,
            timestamp: new Date().toISOString(),
            tokensUsed: Math.round((row.wordCountOriginal + wordCountAfter) * 1.3)
          };
          setAuditLogs((prev) => [auditEntry, ...prev]);

          setBatchStats((prev) => ({
            ...prev,
            completedRows: prev.completedRows + 1,
            successfulRows: prev.successfulRows + 1
          }));
        } catch (err: any) {
          const isQuota =
            err?.message?.includes('429') ||
            err?.message?.includes('RESOURCE_EXHAUSTED') ||
            err?.message?.includes('quota') ||
            err?.message?.includes('overloaded');

          if (isQuota && processingRef.current) {
            const retryMatch =
              err.message.match(/retry in ([\d\.]+)s/i) ||
              err.message.match(/retryDelay[:\s]+"(\d+)s"/i);
            const cooldownSec = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) + 2 : 16;

            setTerminalLogs((prev) => [
              ...prev.slice(-30),
              `[Quota Guard] 429 RPM limit reached. Executing ${cooldownSec}s cooldown wait function before retry...`
            ]);

            await executeWaitCountdown(
              cooldownSec * 1000,
              `API Quota Cooldown: Pausing ${cooldownSec}s to reset RPM window`
            );

            // Re-attempt this row after cooldown
            try {
              const res = await executeHumanizeRowCall(row);
              const wordCountAfter = res.humanizedText.split(/\s+/).filter(Boolean).length;
              const fleschAfter = calculateFleschScore(res.humanizedText);

              const updatedRow: BlogRow = {
                ...row,
                humanizedContent: res.humanizedText,
                humanizedColumns: res.humanizedColumns || {},
                status: 'humanized',
                criticResult: res.criticResult,
                wordCountHumanized: wordCountAfter,
                fleschScoreHumanized: fleschAfter,
                processedAt: new Date().toISOString()
              };

              setRows((prev) => prev.map((r) => (r.id === row.id ? updatedRow : r)));

              setBatchStats((prev) => ({
                ...prev,
                completedRows: prev.completedRows + 1,
                successfulRows: prev.successfulRows + 1
              }));
              continue;
            } catch (retryErr: any) {
              setRows((prev) =>
                prev.map((r) =>
                  r.id === row.id ? { ...r, status: 'failed', errorMessage: retryErr.message } : r
                )
              );
              setBatchStats((prev) => ({
                ...prev,
                completedRows: prev.completedRows + 1,
                failedRows: prev.failedRows + 1
              }));
            }
          } else {
            setRows((prev) =>
              prev.map((r) =>
                r.id === row.id ? { ...r, status: 'failed', errorMessage: err.message } : r
              )
            );
            setBatchStats((prev) => ({
              ...prev,
              completedRows: prev.completedRows + 1,
              failedRows: prev.failedRows + 1
            }));
          }
        }

        // Proactive RPM Pacing Wait Function
        if (config.batchDelayMs && config.batchDelayMs > 0 && processingRef.current) {
          const waitSec = Math.round(config.batchDelayMs / 1000);
          const rpmLabel = waitSec > 0 ? `~${Math.round(60 / waitSec)} RPM` : 'pacing';
          setTerminalLogs((prev) => [
            ...prev.slice(-30),
            `[RPM Pacing] Waiting ${waitSec}s before next request to maintain ${rpmLabel} limit...`
          ]);
          await executeWaitCountdown(
            config.batchDelayMs,
            `Pacing wait (${waitSec}s) to maintain ${rpmLabel} limit`
          );
        }
      }
    };

    const workers = Array.from({ length: concurrency }, (_, i) => worker(i + 1));
    await Promise.all(workers);

    processingRef.current = false;
    setBatchStats((prev) => ({
      ...prev,
      isProcessing: false,
      endTime: Date.now(),
      currentProcessingId: null
    }));

    addToast('success', 'Batch execution finished');
  };

  const handleRetryFailedRows = async () => {
    const failedRows = rows.filter((r) => r.status === 'failed');
    if (failedRows.length === 0) {
      addToast('info', 'No failed records to retry');
      return;
    }
    const failedIds = new Set(failedRows.map((r) => r.id));
    setSelectedRowIds(failedIds);
    addToast('info', `Retrying ${failedRows.length} failed record(s)...`);
    await handleStartBatch(true);
  };

  const handlePauseToggle = () => {
    pausedRef.current = !pausedRef.current;
    setBatchStats((prev) => ({ ...prev, isPaused: pausedRef.current }));
  };

  const handleCancelBatch = () => {
    processingRef.current = false;
    setBatchStats((prev) => ({ ...prev, isProcessing: false, currentProcessingId: null }));
    addToast('info', 'Batch processing cancelled');
  };

  const handleSaveHumanizedContent = (
    rowId: string,
    updatedContent: string,
    updatedColumns?: Record<string, string>
  ) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id === rowId) {
          const words = updatedContent.split(/\s+/).filter(Boolean).length;
          return {
            ...r,
            humanizedContent: updatedContent,
            humanizedColumns: updatedColumns || r.humanizedColumns,
            status: 'edited',
            wordCountHumanized: words,
            fleschScoreHumanized: calculateFleschScore(updatedContent)
          };
        }
        return r;
      })
    );
    addToast('success', 'Revision saved');
  };

  const handleInspectSchema = () => {
    if (rows.length === 0) return;
    const csvContent = exportRowsToCSV(rows, true);
    const report = validateExportedCSV(rows, csvContent);
    setValidationReport(report);
    setIsSchemaModalOpen(true);
  };

  const handleExportCSV = () => {
    if (rows.length === 0) {
      addToast('info', 'No dataset loaded in workspace to export');
      return;
    }
    const csvContent = exportRowsToCSV(rows, true);
    const report = validateExportedCSV(rows, csvContent);
    if (!report.isValid) {
      setValidationReport(report);
      setIsSchemaModalOpen(true);
      return;
    }
    const filename = activeFileName
      ? `humanized_${activeFileName}`
      : `humanized_dataset_${Date.now()}.csv`;
    triggerFileDownload(csvContent, filename);
    addToast('success', `Exported: ${filename}`);
  };

  const handleTestAiConnection = async () => {
    try {
      const res = await fetch('/api/health/llm');
      const data = await res.json();
      await refreshAiStatus();
      return !!data.connected;
    } catch {
      return false;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-neutral-50 dark:bg-[#0d0f12] text-neutral-900 dark:text-neutral-100">
      {/* Collapsible Application Sidebar */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        aiProviderStatus={aiProviderStatus}
        datasetsCount={0}
        loadedRowsCount={rows.length}
        processedRowsCount={
          rows.filter((r) => r.status === 'humanized' || r.status === 'edited').length
        }
        auditCount={auditLogs.length}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Contextual Header */}
        <Header
          activeTab={activeTab}
          datasetName={activeFileName}
          datasetList={[]}
          selectedDatasetId={null}
          onSelectDataset={() => {}}
          onExportCSV={handleExportCSV}
          onUploadClick={() => fileInputRef.current?.click()}
        />

        {/* Scrollable View Container */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {/* 1. DASHBOARD OVERVIEW */}
          {activeTab === 'dashboard' && (
            <DashboardOverview
              datasets={[]}
              loadedRowsCount={rows.length}
              processedRowsCount={
                rows.filter((r) => r.status === 'humanized' || r.status === 'edited').length
              }
              failedRowsCount={rows.filter((r) => r.status === 'failed').length}
              onNavigate={(tab) => setActiveTab(tab as ViewTab)}
              onNavigateTab={(tab) => setActiveTab(tab as ViewTab)}
              onUploadClick={() => {
                setActiveTab('datasets');
              }}
              onLoadSample={(sampleId) => {
                const sample = SAMPLE_DATASETS.find((s) => s.id === sampleId);
                if (sample) {
                  handleLoadRows(
                    sample.data,
                    sample.filename,
                    sample.contentColumn,
                    sample.titleColumn,
                    sample.authorColumn,
                    sample.targetColumns || ['*']
                  );
                }
              }}
            />
          )}

          {/* 1.5. FULL DOCUMENT HUMANIZER TAB */}
          {activeTab === 'document' && (
            <div className="max-w-7xl mx-auto h-full">
              <DocumentHumanizer
                aiProviderStatus={aiProviderStatus}
                onOpenSettings={() => setActiveTab('settings')}
              />
            </div>
          )}

          {/* 2. DATASETS & INGESTION TAB */}
          {activeTab === 'datasets' && (
            <div className="max-w-3xl mx-auto py-6">
              <div className="text-center mb-6">
                <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
                  Load CSV Dataset
                </h2>
                <p className="text-xs text-neutral-500 max-w-md mx-auto mt-1">
                  Files are parsed in your browser and never stored on the server.
                </p>
              </div>
              <UploadSection onLoadRows={handleLoadRows} fileInputRef={fileInputRef} />
            </div>
          )}

          {/* 3. AI WORKSPACE */}
          {activeTab === 'workspace' && (
            <div className="max-w-6xl mx-auto space-y-4">
              {rows.length === 0 ? (
                <div className="max-w-3xl mx-auto py-6">
                  <div className="text-center mb-6">
                    <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
                      Load Dataset into Workspace
                    </h2>
                    <p className="text-xs text-neutral-500 max-w-md mx-auto mt-1">
                      Upload your blog CSV file or load a pre-configured sample dataset to start bulk humanization.
                    </p>
                  </div>
                  <UploadSection
                    onLoadRows={handleLoadRows}
                    fileInputRef={fileInputRef}
                  />
                </div>
              ) : (
                <div>
                  {/* Top File Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-white dark:bg-[#15181e] border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-xs mb-4">
                    <div className="flex items-center gap-2 text-xs font-mono">
                      <span className="text-neutral-400">Active File:</span>
                      <span className="font-semibold text-neutral-900 dark:text-neutral-100 bg-neutral-100 dark:bg-neutral-800 px-2.5 py-0.5 rounded">
                        {activeFileName}
                      </span>
                      <span className="text-neutral-400">· {(rows?.length || 0).toLocaleString()} rows</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="text-xs font-mono text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        Upload Another CSV
                      </button>
                    </div>
                  </div>

                  {/* Metrics Bar */}
                  <MetricsBar rows={rows} />

                  {/* AI Directives & Batch Configuration */}
                  <ConfigPanel
                    config={config}
                    onChangeConfig={setConfig}
                    onStartBatch={handleStartBatch}
                    selectedCount={selectedRowIds.size}
                    totalCount={rows.length}
                    isProcessing={batchStats.isProcessing}
                    allHeaders={rows.length > 0 && rows[0].rawRecord ? Object.keys(rows[0].rawRecord) : []}
                  />

                  {/* Data Table */}
                  <DataTableView
                    rows={rows}
                    selectedRowIds={selectedRowIds}
                    onToggleSelectRow={handleToggleSelectRow}
                    onToggleSelectAll={handleToggleSelectAll}
                    onOpenDiffModal={(row) => setReviewRow(row)}
                    onSingleRowRewrite={handleSingleRowRewrite}
                    onRetryFailed={handleRetryFailedRows}
                    processingRowId={batchStats.currentProcessingId}
                    onInspectSchema={handleInspectSchema}
                  />
                </div>
              )}
            </div>
          )}

          {/* 4. SPLIT COMPARISON & DIFF */}
          {activeTab === 'diff' && (
            <SplitComparisonView
              rows={rows}
              onSaveRow={handleSaveHumanizedContent}
              onSingleRowRewrite={handleSingleRowRewrite}
              onNavigateToWorkspace={() => setActiveTab('workspace')}
            />
          )}

          {/* 5. AUDIT CHECKPOINTS TRAIL */}
          {activeTab === 'audit' && (
            <div className="max-w-6xl mx-auto">
              <AuditLogView
                logs={auditLogs}
                onClearLogs={() => {
                  setAuditLogs([]);
                  addToast('info', 'Audit logs cleared');
                }}
              />
            </div>
          )}

          {/* 6. SETTINGS VIEW */}
          {activeTab === 'settings' && (
            <SettingsView
              config={config}
              onChangeConfig={setConfig}
              aiProviderStatus={aiProviderStatus}
              onTestAiConnection={handleTestAiConnection}
              onRefreshAiStatus={refreshAiStatus}
              onClearStorage={() => {
                localStorage.clear();
                addToast('success', 'Local storage cache cleared');
              }}
            />
          )}
        </main>
      </div>

      {/* Progress Batch Execution Modal */}
      <ProcessProgressModal
        stats={batchStats}
        currentTitle={currentProcessingTitle}
        logs={terminalLogs}
        onPauseToggle={handlePauseToggle}
        onCancel={handleCancelBatch}
        onRetryFailed={handleRetryFailedRows}
        onClose={() => setBatchStats((prev) => ({ ...prev, completedRows: 0 }))}
      />

      {/* Human-in-the-Loop Review Modal */}
      <DiffReviewModal
        row={reviewRow}
        onClose={() => setReviewRow(null)}
        onSaveHumanizedContent={handleSaveHumanizedContent}
        onSingleRowRewrite={handleSingleRowRewrite}
      />

      {/* Programmatic Schema & Integrity Validation Modal */}
      <SchemaValidationModal
        isOpen={isSchemaModalOpen}
        onClose={() => setIsSchemaModalOpen(false)}
        report={validationReport}
        filename={activeFileName || 'humanized_dataset.csv'}
        onConfirmDownload={() => {
          if (rows.length > 0) {
            const csvContent = exportRowsToCSV(rows, true);
            const filename = activeFileName
              ? `humanized_${activeFileName}`
              : `humanized_dataset_${Date.now()}.csv`;
            triggerFileDownload(csvContent, filename);
            addToast('success', `Exported: ${filename}`);
          }
        }}
      />

      {/* Hidden File Input for CSV ingestion */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (ev) => {
              const text = ev.target?.result as string;
              if (text) {
                const parsed = parseCSVString(text);
                if (parsed.length > 0) {
                  const headers = Object.keys(parsed[0] || {});
                  const detected = autoDetectColumns(headers);
                  handleLoadRows(
                    parsed,
                    file.name,
                    detected.contentColumn,
                    detected.titleColumn,
                    detected.authorColumn
                  );
                }
              }
            };
            reader.readAsText(file);
            e.target.value = '';
          }
        }}
      />
    </div>
  );
}
