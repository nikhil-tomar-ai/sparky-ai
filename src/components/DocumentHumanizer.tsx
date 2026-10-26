import React, { useState, useRef, useEffect } from 'react';
import {
  FileText,
  UploadCloud,
  Wand2,
  Download,
  Copy,
  Printer,
  Check,
  RefreshCw,
  Sparkles,
  ArrowRight,
  Split,
  Eye,
  Code,
  ListTree,
  AlertCircle,
  FileCheck,
  Zap,
  Sliders,
  ChevronDown,
  Layers,
  BookOpen,
  FileSpreadsheet
} from 'lucide-react';
import {
  ParsedDocument,
  DocumentSection,
  parseDocumentFile,
  parseSectionsFromMarkdown,
  calculateDocumentFleschScore,
  calculateDocumentFluffPercentage
} from '../utils/documentParser';
import { exportToDocx, exportToMarkdown, exportToPlainText, exportToHtml, printFormattedDocument, triggerBlobDownload } from '../utils/documentExport';
import { api } from '../services/api';
import { TonePreset } from '../types';
import { SAMPLE_DOCUMENTS, SampleDocument } from '../data/sampleDocuments';
import { useToast } from './ui/Toast';
import { DocumentComparisonModal } from './document/DocumentComparisonModal';

interface DocumentHumanizerProps {
  aiProviderStatus: {
    provider: string;
    model: string;
    status: 'connected' | 'connecting' | 'error';
  };
  onOpenSettings?: () => void;
}

export const DocumentHumanizer: React.FC<DocumentHumanizerProps> = ({
  aiProviderStatus,
  onOpenSettings
}) => {
  const { addToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Document state
  const [parsedDoc, setParsedDoc] = useState<ParsedDocument | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [pastedText, setPastedText] = useState('');
  const [showPasteArea, setShowPasteArea] = useState(false);

  // Comparison Pop-up Modal State
  const [isComparisonModalOpen, setIsComparisonModalOpen] = useState(false);
  const [isTestingOllama, setIsTestingOllama] = useState(false);
  const [ollamaTestMessage, setOllamaTestMessage] = useState<string | null>(null);

  // Humanizer config
  const [selectedTone, setSelectedTone] = useState<TonePreset>('conversational');
  const [customPrompt, setCustomPrompt] = useState('');
  const [intensity, setIntensity] = useState<'light' | 'balanced' | 'deep'>('balanced');
  const [temperature, setTemperature] = useState(0.7);
  const [preserveHeadings, setPreserveHeadings] = useState(true);
  const [preserveKeywordsInput, setPreserveKeywordsInput] = useState('');
  const [processingMode, setProcessingMode] = useState<'full' | 'sectionBySection'>('sectionBySection');

  // Humanization output state
  const [humanizedMarkdown, setHumanizedMarkdown] = useState<string>('');
  const [isHumanizing, setIsHumanizing] = useState(false);
  const [humanizeProgress, setHumanizeProgress] = useState<{
    percent: number;
    currentSection: string;
    completedSections: number;
    totalSections: number;
  }>({
    percent: 0,
    currentSection: '',
    completedSections: 0,
    totalSections: 0
  });

  // Section-by-section map (sectionId -> rewritten markdown)
  const [sectionRewrites, setSectionRewrites] = useState<Record<string, string>>({});

  // Active view tab: 'formatted' | 'diff' | 'editor' | 'sections'
  const [activeViewTab, setActiveViewTab] = useState<'formatted' | 'diff' | 'editor' | 'sections'>('formatted');

  // Download drop-down open state
  const [isDownloadMenuOpen, setIsDownloadMenuOpen] = useState(false);
  const [isExportingDocx, setIsExportingDocx] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  // Auto-scroll cancel ref
  const abortControllerRef = useRef<boolean>(false);

  // Load a sample document on click
  const handleLoadSample = (sample: SampleDocument) => {
    const { title, sections } = parseSectionsFromMarkdown(sample.markdownContent, sample.title);
    const words = sample.markdownContent.split(/\s+/).filter(Boolean);
    const paragraphs = sample.markdownContent.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

    const doc: ParsedDocument = {
      filename: sample.filename,
      fileSize: sample.markdownContent.length,
      format: sample.filename.endsWith('.docx') ? 'docx' : 'markdown',
      title: sample.title,
      rawText: sample.markdownContent,
      markdownContent: sample.markdownContent,
      sections,
      totalWords: words.length,
      totalParagraphs: Math.max(1, paragraphs.length),
      estimatedReadingTimeMinutes: Math.max(1, Math.round(words.length / 200)),
      fleschScore: calculateDocumentFleschScore(sample.markdownContent),
      aiFluffPercentage: calculateDocumentFluffPercentage(sample.markdownContent),
      detectedHeadingsCount: sections.filter((s) => s.level > 0).length
    };

    setParsedDoc(doc);
    setHumanizedMarkdown('');
    setSectionRewrites({});
    addToast({
      title: 'Sample Document Loaded',
      message: `"${sample.title}" ready for humanizing.`,
      type: 'info'
    });
  };

  // Test Ollama Cloud Connection with Key
  const handleTestOllamaConnection = async () => {
    setIsTestingOllama(true);
    setOllamaTestMessage(null);
    try {
      const res = await fetch('/api/health/test-ollama', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setOllamaTestMessage(data.message);
        addToast({
          title: 'Ollama Connection Verified',
          message: data.message,
          type: 'success'
        });
      } else {
        setOllamaTestMessage(data.message || 'Connection failed');
        addToast({
          title: 'Ollama Connection Failed',
          message: data.message || 'Check your API Key in Settings',
          type: 'error'
        });
      }
    } catch (e: any) {
      setOllamaTestMessage(`Network error: ${e.message}`);
    } finally {
      setIsTestingOllama(false);
    }
  };

  // Handle file drop / select
  const handleFile = async (file: File) => {
    try {
      setIsParsing(true);
      const parsed = await parseDocumentFile(file);
      setParsedDoc(parsed);
      setHumanizedMarkdown('');
      setSectionRewrites({});
      addToast({
        title: 'Document Parsed',
        message: `Extracted ${parsed.totalWords} words across ${parsed.sections.length} sections from "${file.name}".`,
        type: 'success'
      });
    } catch (err: any) {
      console.error('Document parse error:', err);
      addToast({
        title: 'Document Parsing Failed',
        message: err.message || 'Could not parse document file.',
        type: 'error'
      });
    } finally {
      setIsParsing(false);
    }
  };

  // Handle pasted text submit
  const handleApplyPastedText = () => {
    if (!pastedText.trim()) return;
    const { title, sections } = parseSectionsFromMarkdown(pastedText, 'Pasted Document');
    const words = pastedText.split(/\s+/).filter(Boolean);
    const paragraphs = pastedText.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

    const doc: ParsedDocument = {
      filename: 'pasted_document.md',
      fileSize: pastedText.length,
      format: 'markdown',
      title: title || 'Pasted Document',
      rawText: pastedText,
      markdownContent: pastedText,
      sections,
      totalWords: words.length,
      totalParagraphs: Math.max(1, paragraphs.length),
      estimatedReadingTimeMinutes: Math.max(1, Math.round(words.length / 200)),
      fleschScore: calculateDocumentFleschScore(pastedText),
      aiFluffPercentage: calculateDocumentFluffPercentage(pastedText),
      detectedHeadingsCount: sections.filter((s) => s.level > 0).length
    };

    setParsedDoc(doc);
    setHumanizedMarkdown('');
    setSectionRewrites({});
    setShowPasteArea(false);
    addToast({
      title: 'Document Created',
      message: `Loaded ${doc.totalWords} words ready to humanize.`,
      type: 'success'
    });
  };

  // Humanize entire document
  const handleHumanizeDocument = async () => {
    if (!parsedDoc) return;

    setIsHumanizing(true);
    abortControllerRef.current = false;

    const keywords = preserveKeywordsInput
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);

    try {
      if (processingMode === 'sectionBySection' && parsedDoc.sections.length > 1) {
        // Section by section progressive humanization
        const total = parsedDoc.sections.length;
        const newRewrites: Record<string, string> = {};
        const assembledParts: string[] = [];

        for (let i = 0; i < total; i++) {
          if (abortControllerRef.current) {
            addToast({
              title: 'Humanization Paused',
              message: `Completed ${i} of ${total} sections.`,
              type: 'info'
            });
            break;
          }

          const sec = parsedDoc.sections[i];
          setHumanizeProgress({
            percent: Math.round(((i + 0.1) / total) * 100),
            currentSection: sec.heading || `Section ${i + 1}`,
            completedSections: i,
            totalSections: total
          });

          const result = await api.humanizeDocumentSection({
            sectionHeading: sec.heading,
            sectionLevel: sec.level,
            content: sec.content,
            documentTitle: parsedDoc.title,
            tone: selectedTone,
            customPrompt,
            intensity,
            temperature,
            preserveKeywords: keywords
          });

          newRewrites[sec.id] = result.humanizedContent;
          setSectionRewrites({ ...newRewrites });
          assembledParts.push(result.humanizedContent);

          setHumanizeProgress({
            percent: Math.round(((i + 1) / total) * 100),
            currentSection: sec.heading,
            completedSections: i + 1,
            totalSections: total
          });
        }

        const fullAssembled = assembledParts.join('\n\n');
        setHumanizedMarkdown(fullAssembled);
        addToast({
          title: 'Document Humanized!',
          message: `All ${total} sections successfully rewritten in ${selectedTone} tone.`,
          type: 'success'
        });
      } else {
        // Whole document single-pass humanization
        setHumanizeProgress({
          percent: 30,
          currentSection: 'Rewriting whole document with local LLM...',
          completedSections: 0,
          totalSections: 1
        });

        const result = await api.humanizeDocument({
          title: parsedDoc.title,
          content: parsedDoc.markdownContent,
          tone: selectedTone,
          customPrompt,
          intensity,
          temperature,
          preserveKeywords: keywords
        });

        setHumanizedMarkdown(result.humanizedMarkdown);
        setHumanizeProgress({
          percent: 100,
          currentSection: 'Complete',
          completedSections: 1,
          totalSections: 1
        });

        addToast({
          title: 'Document Humanized!',
          message: `Rewritten completely in ${selectedTone} tone with matching formatting.`,
          type: 'success'
        });
      }
    } catch (err: any) {
      console.error('Humanize document error:', err);
      addToast({
        title: 'Humanization Failed',
        message: err.message || 'Error occurred while contacting LLM.',
        type: 'error'
      });
    } finally {
      setIsHumanizing(false);
    }
  };

  // Download Handlers
  const handleDownloadDocx = async () => {
    if (!humanizedMarkdown) return;
    try {
      setIsExportingDocx(true);
      const title = parsedDoc?.title || 'Humanized Document';
      const docxBlob = await exportToDocx(title, humanizedMarkdown);
      const cleanFilename = `${(parsedDoc?.filename || 'document').replace(/\.[^/.]+$/, '')}_humanized.docx`;
      triggerBlobDownload(docxBlob, cleanFilename);
      addToast({
        title: 'Downloaded Word Document',
        message: `Saved as "${cleanFilename}" with preserved formatting.`,
        type: 'success'
      });
      setIsDownloadMenuOpen(false);
    } catch (err: any) {
      console.error('Docx export error:', err);
      addToast({
        title: 'Export Failed',
        message: err.message || 'Failed to generate Word document.',
        type: 'error'
      });
    } finally {
      setIsExportingDocx(false);
    }
  };

  const handleDownloadMarkdown = () => {
    if (!humanizedMarkdown) return;
    const title = parsedDoc?.title || 'Humanized Document';
    const blob = exportToMarkdown(title, humanizedMarkdown);
    const cleanFilename = `${(parsedDoc?.filename || 'document').replace(/\.[^/.]+$/, '')}_humanized.md`;
    triggerBlobDownload(blob, cleanFilename);
    addToast({
      title: 'Downloaded Markdown',
      message: `Saved as "${cleanFilename}".`,
      type: 'success'
    });
    setIsDownloadMenuOpen(false);
  };

  const handleDownloadPlainText = () => {
    if (!humanizedMarkdown) return;
    const title = parsedDoc?.title || 'Humanized Document';
    const blob = exportToPlainText(title, humanizedMarkdown);
    const cleanFilename = `${(parsedDoc?.filename || 'document').replace(/\.[^/.]+$/, '')}_humanized.txt`;
    triggerBlobDownload(blob, cleanFilename);
    addToast({
      title: 'Downloaded Text Document',
      message: `Saved as "${cleanFilename}".`,
      type: 'success'
    });
    setIsDownloadMenuOpen(false);
  };

  const handleDownloadHtml = () => {
    if (!humanizedMarkdown) return;
    const title = parsedDoc?.title || 'Humanized Document';
    const blob = exportToHtml(title, humanizedMarkdown);
    const cleanFilename = `${(parsedDoc?.filename || 'document').replace(/\.[^/.]+$/, '')}_humanized.html`;
    triggerBlobDownload(blob, cleanFilename);
    addToast({
      title: 'Downloaded HTML Document',
      message: `Saved standalone styled document as "${cleanFilename}".`,
      type: 'success'
    });
    setIsDownloadMenuOpen(false);
  };

  const handlePrint = () => {
    if (!humanizedMarkdown) return;
    const title = parsedDoc?.title || 'Humanized Document';
    printFormattedDocument(title, humanizedMarkdown);
    setIsDownloadMenuOpen(false);
  };

  const handleCopyClipboard = async () => {
    if (!humanizedMarkdown) return;
    try {
      await navigator.clipboard.writeText(humanizedMarkdown);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
      addToast({
        title: 'Copied to Clipboard',
        message: 'Markdown document copied to your clipboard.',
        type: 'info'
      });
    } catch {
      // Fallback
    }
  };

  // Metrics comparison calculation
  const originalWords = parsedDoc?.totalWords || 0;
  const humanizedWords = humanizedMarkdown ? humanizedMarkdown.split(/\s+/).filter(Boolean).length : 0;
  const originalFlesch = parsedDoc?.fleschScore || 50;
  const humanizedFlesch = humanizedMarkdown ? calculateDocumentFleschScore(humanizedMarkdown) : 0;
  const originalFluff = parsedDoc?.aiFluffPercentage || 0;
  const humanizedFluff = humanizedMarkdown ? calculateDocumentFluffPercentage(humanizedMarkdown) : 0;
  const fluffPurgedPercent = originalFluff > 0 ? Math.max(0, Math.round(((originalFluff - humanizedFluff) / originalFluff) * 100)) : 100;

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-neutral-50 dark:bg-[#0c0e12] p-4 lg:p-6 space-y-6">
      {/* Top Banner / Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-[#12151b] p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-blue-600/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 flex items-center justify-center font-bold">
            <FileText className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">
                Document Humanizer
              </h1>
              <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                Word & Markdown Formatter
              </span>
            </div>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">
              Upload any document (.docx, .md, .txt), rewrite with local LLM, preserve exact document layout, and download as clean Word or Markdown.
            </p>
          </div>
        </div>

        {/* Local / Cloud LLM Active Engine Indicator & Comparison Trigger */}
        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto text-xs">
          {parsedDoc && (
            <button
              onClick={() => setIsComparisonModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-xs transition cursor-pointer"
            >
              <Split className="w-3.5 h-3.5" />
              <span>Comparison Pop-up</span>
              {humanizedMarkdown && (
                <span className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse" />
              )}
            </button>
          )}

          <div className="flex items-center gap-2 bg-neutral-100 dark:bg-[#181c24] px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800">
            <div className={`w-2 h-2 rounded-full ${aiProviderStatus.status === 'error' ? 'bg-amber-500' : 'bg-emerald-500 animate-pulse'}`} />
            <span className="text-neutral-500 dark:text-neutral-400">AI Engine:</span>
            <span className="font-semibold text-neutral-800 dark:text-neutral-200">
              {aiProviderStatus.model || 'Ollama Cloud (gemma4:31b)'}
            </span>

            <button
              onClick={handleTestOllamaConnection}
              disabled={isTestingOllama}
              title="Test Ollama Cloud connection with your API key"
              className="text-xs text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 font-semibold flex items-center gap-1 ml-1 cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 ${isTestingOllama ? 'animate-spin' : ''}`} />
              <span>{isTestingOllama ? 'Testing...' : 'Check Key'}</span>
            </button>

            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                className="text-blue-600 hover:text-blue-700 dark:text-blue-400 underline ml-0.5 cursor-pointer font-medium"
              >
                Config
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Grid: Upload & Settings Left, Live Document View Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Document Upload & LLM Directives (lg:col-span-5) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Document Upload Card */}
          <div className="bg-white dark:bg-[#12151b] rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5">
                <UploadCloud className="w-4 h-4 text-blue-500" />
                1. Upload Document
              </h2>
              {parsedDoc && (
                <button
                  onClick={() => {
                    setParsedDoc(null);
                    setHumanizedMarkdown('');
                    setSectionRewrites({});
                  }}
                  className="text-xs text-red-500 hover:text-red-600 hover:underline cursor-pointer"
                >
                  Clear document
                </button>
              )}
            </div>

            {/* Dropzone */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = '';
              }}
              accept=".docx,.md,.markdown,.txt,.html,.htm"
              className="hidden"
            />

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleFile(file);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                isDragOver
                  ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20'
                  : 'border-neutral-300 dark:border-neutral-700 hover:border-blue-400 dark:hover:border-blue-500 bg-neutral-50/50 dark:bg-neutral-900/40'
              }`}
            >
              {isParsing ? (
                <div className="flex flex-col items-center py-3">
                  <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mb-2" />
                  <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                    Extracting document structures & headings...
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center py-2 space-y-2">
                  <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                    <UploadCloud className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                      Drop .docx, .md, or .txt file here
                    </p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                      or click to browse your files
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 pt-1">
                    <span className="px-1.5 py-0.5 text-[10px] font-medium bg-neutral-200 dark:bg-neutral-800 rounded text-neutral-600 dark:text-neutral-400">
                      DOCX
                    </span>
                    <span className="px-1.5 py-0.5 text-[10px] font-medium bg-neutral-200 dark:bg-neutral-800 rounded text-neutral-600 dark:text-neutral-400">
                      MARKDOWN
                    </span>
                    <span className="px-1.5 py-0.5 text-[10px] font-medium bg-neutral-200 dark:bg-neutral-800 rounded text-neutral-600 dark:text-neutral-400">
                      TXT / HTML
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Instant Sample Loader or Manual Paste */}
            <div className="flex items-center justify-between pt-1 text-xs">
              <span className="text-neutral-500 dark:text-neutral-400">Or try sample document:</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleLoadSample(SAMPLE_DOCUMENTS[0])}
                  className="px-2.5 py-1 bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 rounded-lg font-medium transition cursor-pointer"
                >
                  Cloud Whitepaper
                </button>
                <button
                  type="button"
                  onClick={() => handleLoadSample(SAMPLE_DOCUMENTS[1])}
                  className="px-2.5 py-1 bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 rounded-lg font-medium transition cursor-pointer"
                >
                  Remote Work Guide
                </button>
                <button
                  type="button"
                  onClick={() => setShowPasteArea(!showPasteArea)}
                  className="text-blue-600 hover:text-blue-700 dark:text-blue-400 font-medium underline cursor-pointer"
                >
                  {showPasteArea ? 'Hide Paste' : 'Paste Text'}
                </button>
              </div>
            </div>

            {/* Paste Drawer */}
            {showPasteArea && (
              <div className="space-y-2 p-3 bg-neutral-100 dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800">
                <textarea
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  placeholder="Paste Markdown or raw document text here..."
                  rows={4}
                  className="w-full text-xs font-mono bg-white dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-700 rounded-lg p-2.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <div className="flex justify-end">
                  <button
                    onClick={handleApplyPastedText}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium cursor-pointer"
                  >
                    Load Pasted Document
                  </button>
                </div>
              </div>
            )}

            {/* Loaded Document Info Card */}
            {parsedDoc && (
              <div className="p-3.5 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200/60 dark:border-blue-900/50 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileCheck className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                    <span className="font-semibold text-xs text-neutral-900 dark:text-neutral-100 truncate">
                      {parsedDoc.filename}
                    </span>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300">
                    {parsedDoc.format}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-2 pt-1 border-t border-blue-100 dark:border-blue-900/40 text-center">
                  <div>
                    <p className="text-[10px] text-neutral-500 dark:text-neutral-400">Words</p>
                    <p className="font-bold text-xs text-neutral-800 dark:text-neutral-200">
                      {parsedDoc.totalWords}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-neutral-500 dark:text-neutral-400">Sections</p>
                    <p className="font-bold text-xs text-neutral-800 dark:text-neutral-200">
                      {parsedDoc.sections.length}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-neutral-500 dark:text-neutral-400">Readability</p>
                    <p className="font-bold text-xs text-neutral-800 dark:text-neutral-200">
                      {parsedDoc.fleschScore}/100
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-neutral-500 dark:text-neutral-400">AI Fluff</p>
                    <p className="font-bold text-xs text-amber-600 dark:text-amber-400">
                      {parsedDoc.aiFluffPercentage}%
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Local LLM Rewriting Directive Panel */}
          <div className="bg-white dark:bg-[#12151b] rounded-2xl border border-neutral-200 dark:border-neutral-800 p-5 shadow-xs space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5">
              <Sliders className="w-4 h-4 text-purple-500" />
              2. Humanization Persona & Controls
            </h2>

            {/* Tone Presets */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                Persona / Writing Tone
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'conversational', label: 'Conversational', desc: 'Friendly, tech-savvy & clear' },
                  { id: 'thought_leader', label: 'Thought Leader', desc: 'Authoritative & strategic' },
                  { id: 'punchy', label: 'Punchy & Crisp', desc: 'Short lines, zero fluff' },
                  { id: 'casual', label: 'Casual & Warm', desc: 'Natural contractions & flow' },
                  { id: 'storyteller', label: 'Storyteller', desc: 'Engaging narrative hooks' },
                  { id: 'academic', label: 'Educational', desc: 'Intellectual & well-argued' }
                ].map((tone) => (
                  <button
                    key={tone.id}
                    type="button"
                    onClick={() => setSelectedTone(tone.id as TonePreset)}
                    className={`p-2.5 rounded-xl text-left border transition cursor-pointer ${
                      selectedTone === tone.id
                        ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 shadow-xs ring-1 ring-blue-500'
                        : 'border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-900/40'
                    }`}
                  >
                    <p className="text-xs font-bold leading-none">{tone.label}</p>
                    <p className="text-[10px] text-neutral-500 dark:text-neutral-400 mt-1 truncate">
                      {tone.desc}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Intensity Slider */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-neutral-700 dark:text-neutral-300">
                  Humanization Intensity
                </span>
                <span className="font-semibold capitalize text-blue-600 dark:text-blue-400">
                  {intensity}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'light', label: 'Light Polish', hint: 'Polishes phrasing' },
                  { id: 'balanced', label: 'Balanced', hint: 'Rewrites cadences' },
                  { id: 'deep', label: 'Deep Overhaul', hint: 'Max sentence variety' }
                ].map((lvl) => (
                  <button
                    key={lvl.id}
                    type="button"
                    onClick={() => setIntensity(lvl.id as any)}
                    className={`p-2 rounded-lg text-center border text-xs cursor-pointer ${
                      intensity === lvl.id
                        ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 font-bold text-blue-700 dark:text-blue-300'
                        : 'border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-400'
                    }`}
                  >
                    {lvl.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Directive (Optional) */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                Custom Persona Instructions (Optional)
              </label>
              <input
                type="text"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="e.g. Write like an experienced VP of Engineering speaking to peers..."
                className="w-full text-xs bg-neutral-50 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Preserved Keywords */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                Preserve Technical Terms (Comma Separated)
              </label>
              <input
                type="text"
                value={preserveKeywordsInput}
                onChange={(e) => setPreserveKeywordsInput(e.target.value)}
                placeholder="Kubernetes, Zero-Trust, SOC-2, AWS Lambda"
                className="w-full text-xs bg-neutral-50 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Processing Mode */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                Processing Strategy
              </label>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setProcessingMode('sectionBySection')}
                  className={`p-2 rounded-lg border text-left cursor-pointer ${
                    processingMode === 'sectionBySection'
                      ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 font-semibold'
                      : 'border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-400'
                  }`}
                >
                  <p>Section-by-Section</p>
                  <p className="text-[10px] text-neutral-400 font-normal">Live progressive rewrite</p>
                </button>
                <button
                  type="button"
                  onClick={() => setProcessingMode('full')}
                  className={`p-2 rounded-lg border text-left cursor-pointer ${
                    processingMode === 'full'
                      ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 font-semibold'
                      : 'border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-400'
                  }`}
                >
                  <p>Single-Pass</p>
                  <p className="text-[10px] text-neutral-400 font-normal">Whole document in 1 call</p>
                </button>
              </div>
            </div>

            {/* Primary Action Button */}
            <button
              type="button"
              disabled={!parsedDoc || isHumanizing}
              onClick={handleHumanizeDocument}
              className={`w-full py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-md transition cursor-pointer ${
                !parsedDoc || isHumanizing
                  ? 'bg-neutral-300 dark:bg-neutral-800 text-neutral-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-blue-500/20 active:scale-[0.99]'
              }`}
            >
              {isHumanizing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Humanizing Document ({humanizeProgress.percent}%)...
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4" />
                  Rewrite & Humanize Document
                </>
              )}
            </button>

            {/* Live Progress Bar when Processing */}
            {isHumanizing && (
              <div className="space-y-2 p-3 bg-blue-50/70 dark:bg-blue-950/30 rounded-xl border border-blue-200 dark:border-blue-900">
                <div className="flex justify-between text-xs text-blue-800 dark:text-blue-300 font-medium">
                  <span className="truncate pr-2">Processing: {humanizeProgress.currentSection}</span>
                  <span className="shrink-0">{humanizeProgress.percent}%</span>
                </div>
                <div className="w-full bg-blue-200 dark:bg-blue-900 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${humanizeProgress.percent}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-400">
                  <span>
                    Section {humanizeProgress.completedSections} of {humanizeProgress.totalSections}
                  </span>
                  <button
                    onClick={() => {
                      abortControllerRef.current = true;
                    }}
                    className="text-red-500 hover:underline cursor-pointer"
                  >
                    Pause
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Document Workspace & Live Output (lg:col-span-7) */}
        <div className="lg:col-span-7 flex flex-col space-y-4">
          {/* Top Bar with Navigation Tabs & Download Actions */}
          <div className="bg-white dark:bg-[#12151b] rounded-2xl border border-neutral-200 dark:border-neutral-800 p-3 shadow-xs flex flex-wrap items-center justify-between gap-3">
            {/* View Tabs */}
            <div className="flex items-center gap-1 bg-neutral-100 dark:bg-neutral-900 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setActiveViewTab('formatted')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
                  activeViewTab === 'formatted'
                    ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xs font-semibold'
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                Formatted Document
              </button>
              <button
                type="button"
                onClick={() => setActiveViewTab('diff')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
                  activeViewTab === 'diff'
                    ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xs font-semibold'
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
                }`}
              >
                <Split className="w-3.5 h-3.5" />
                Side-by-Side Diff
              </button>
              <button
                type="button"
                onClick={() => setActiveViewTab('editor')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
                  activeViewTab === 'editor'
                    ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xs font-semibold'
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
                }`}
              >
                <Code className="w-3.5 h-3.5" />
                Markdown Source
              </button>
              <button
                type="button"
                onClick={() => setActiveViewTab('sections')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
                  activeViewTab === 'sections'
                    ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xs font-semibold'
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
                }`}
              >
                <ListTree className="w-3.5 h-3.5" />
                Sections ({parsedDoc?.sections.length || 0})
              </button>
            </div>

            {/* Download & Copy Menu */}
            <div className="flex items-center gap-2 relative">
              {/* Dedicated Comparison Pop-up Window Trigger */}
              <button
                type="button"
                disabled={!parsedDoc}
                onClick={() => setIsComparisonModalOpen(true)}
                title="Open interactive side-by-side comparison in dedicated pop-up modal"
                className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition cursor-pointer ${
                  !parsedDoc
                    ? 'opacity-40 cursor-not-allowed border-neutral-200 dark:border-neutral-800 text-neutral-400'
                    : 'border-blue-600/40 bg-blue-50/80 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-300 shadow-2xs'
                }`}
              >
                <Split className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>Compare Pop-up</span>
                {humanizedMarkdown && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                )}
              </button>

              <button
                type="button"
                disabled={!humanizedMarkdown}
                onClick={handleCopyClipboard}
                title="Copy markdown to clipboard"
                className={`p-2 rounded-xl border text-xs flex items-center gap-1 transition cursor-pointer ${
                  !humanizedMarkdown
                    ? 'opacity-40 cursor-not-allowed border-neutral-200 dark:border-neutral-800 text-neutral-400'
                    : 'border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300'
                }`}
              >
                {isCopied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              </button>

              <button
                type="button"
                disabled={!humanizedMarkdown}
                onClick={handlePrint}
                title="Print or Save as PDF"
                className={`p-2 rounded-xl border text-xs flex items-center gap-1 transition cursor-pointer ${
                  !humanizedMarkdown
                    ? 'opacity-40 cursor-not-allowed border-neutral-200 dark:border-neutral-800 text-neutral-400'
                    : 'border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300'
                }`}
              >
                <Printer className="w-4 h-4" />
              </button>

              {/* Download Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  disabled={!humanizedMarkdown}
                  onClick={() => setIsDownloadMenuOpen(!isDownloadMenuOpen)}
                  className={`px-3.5 py-2 rounded-xl font-semibold text-xs flex items-center gap-2 shadow-xs transition cursor-pointer ${
                    !humanizedMarkdown
                      ? 'bg-neutral-200 dark:bg-neutral-800 text-neutral-400 cursor-not-allowed'
                      : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20'
                  }`}
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Document
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>

                {isDownloadMenuOpen && humanizedMarkdown && (
                  <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-[#1a1e27] border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-xl z-30 p-1.5 space-y-1 animate-in fade-in zoom-in-95">
                    <button
                      onClick={handleDownloadDocx}
                      disabled={isExportingDocx}
                      className="w-full px-3 py-2 text-left text-xs rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center justify-between text-neutral-800 dark:text-neutral-200 font-medium cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-blue-500" />
                        <div>
                          <p className="font-semibold">Microsoft Word (.docx)</p>
                          <p className="text-[10px] text-neutral-400">Preserves headings & styles</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold uppercase text-blue-600 bg-blue-50 dark:bg-blue-900/40 px-1.5 py-0.5 rounded">
                        Word
                      </span>
                    </button>

                    <button
                      onClick={handleDownloadMarkdown}
                      className="w-full px-3 py-2 text-left text-xs rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center justify-between text-neutral-800 dark:text-neutral-200 font-medium cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <Code className="w-4 h-4 text-purple-500" />
                        <div>
                          <p className="font-semibold">Markdown (.md)</p>
                          <p className="text-[10px] text-neutral-400">Clean GitHub / web format</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold uppercase text-purple-600 bg-purple-50 dark:bg-purple-900/40 px-1.5 py-0.5 rounded">
                        MD
                      </span>
                    </button>

                    <button
                      onClick={handleDownloadPlainText}
                      className="w-full px-3 py-2 text-left text-xs rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center justify-between text-neutral-800 dark:text-neutral-200 font-medium cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-neutral-500" />
                        <div>
                          <p className="font-semibold">Plain Text (.txt)</p>
                          <p className="text-[10px] text-neutral-400">Universal formatting</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold uppercase text-neutral-600 bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded">
                        TXT
                      </span>
                    </button>

                    <button
                      onClick={handleDownloadHtml}
                      className="w-full px-3 py-2 text-left text-xs rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center justify-between text-neutral-800 dark:text-neutral-200 font-medium cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <Eye className="w-4 h-4 text-amber-500" />
                        <div>
                          <p className="font-semibold">HTML Document (.html)</p>
                          <p className="text-[10px] text-neutral-400">Standalone styled page</p>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold uppercase text-amber-600 bg-amber-50 dark:bg-amber-900/40 px-1.5 py-0.5 rounded">
                        HTML
                      </span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Metrics Delta Bar (if humanized) */}
          {humanizedMarkdown && (
            <div className="bg-white dark:bg-[#12151b] rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4 shadow-xs grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400">AI Fluff Purged</p>
                  <p className="text-base font-bold text-emerald-600 dark:text-emerald-400">
                    {fluffPurgedPercent}% reduced
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
                  <BookOpen className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400">Readability Score</p>
                  <p className="text-base font-bold text-neutral-900 dark:text-neutral-100">
                    {humanizedFlesch}/100{' '}
                    <span className="text-xs font-normal text-emerald-500">
                      ({humanizedFlesch >= originalFlesch ? `+${humanizedFlesch - originalFlesch}` : `${humanizedFlesch - originalFlesch}`})
                    </span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400">Word Count</p>
                  <p className="text-base font-bold text-neutral-900 dark:text-neutral-100">
                    {humanizedWords}{' '}
                    <span className="text-xs font-normal text-neutral-400">
                      (from {originalWords})
                    </span>
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400">Tone Applied</p>
                  <p className="text-base font-bold capitalize text-neutral-900 dark:text-neutral-100">
                    {selectedTone}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Main Document Display Area */}
          <div className="bg-white dark:bg-[#12151b] rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-xs flex-1 min-h-[500px] flex flex-col overflow-hidden">
            {!parsedDoc ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-neutral-400">
                <div className="w-16 h-16 rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mb-4">
                  <FileText className="w-8 h-8 text-neutral-400" />
                </div>
                <h3 className="text-base font-semibold text-neutral-700 dark:text-neutral-300">
                  No Document Loaded
                </h3>
                <p className="text-xs text-neutral-500 max-w-sm mt-1">
                  Upload a Word (.docx), Markdown (.md), or text file on the left, or click a sample to see the document humanizer in action.
                </p>
              </div>
            ) : (
              <>
                {/* 1. Formatted View (Paper Aesthetic) */}
                {activeViewTab === 'formatted' && (
                  <div className="flex-1 p-6 md:p-8 overflow-y-auto bg-neutral-100/50 dark:bg-[#0c0e12]">
                    <div className="max-w-3xl mx-auto bg-white dark:bg-[#161a22] p-8 md:p-12 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-800">
                      <div className="border-b border-neutral-200 dark:border-neutral-800 pb-4 mb-6 flex items-center justify-between">
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                            {humanizedMarkdown ? 'Humanized Document Output' : 'Original Document Preview'}
                          </span>
                          <h1 className="text-2xl font-extrabold text-neutral-900 dark:text-neutral-100 mt-1">
                            {parsedDoc.title}
                          </h1>
                        </div>
                        {humanizedMarkdown && (
                          <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                            Ready to Download
                          </span>
                        )}
                      </div>

                      {/* Render formatted markdown document */}
                      <FormattedMarkdownRenderer
                        content={humanizedMarkdown || parsedDoc.markdownContent}
                      />
                    </div>
                  </div>
                )}

                {/* 2. Side-by-Side Diff View */}
                {activeViewTab === 'diff' && (
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-neutral-200 dark:divide-neutral-800 overflow-hidden">
                    {/* Left: Original */}
                    <div className="flex flex-col h-full overflow-hidden">
                      <div className="p-3 bg-red-50/50 dark:bg-red-950/20 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
                        <span className="text-xs font-bold text-red-700 dark:text-red-400 uppercase tracking-wider flex items-center gap-1.5">
                          Original Document (AI Generated)
                        </span>
                        <span className="text-xs text-neutral-500">
                          {parsedDoc.totalWords} words
                        </span>
                      </div>
                      <div className="flex-1 p-5 overflow-y-auto text-xs font-mono leading-relaxed text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap">
                        {parsedDoc.markdownContent}
                      </div>
                    </div>

                    {/* Right: Humanized */}
                    <div className="flex flex-col h-full overflow-hidden">
                      <div className="p-3 bg-emerald-50/50 dark:bg-emerald-950/20 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
                        <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                          Rewritten Document (Authentic Human Tone)
                        </span>
                        <span className="text-xs text-neutral-500">
                          {humanizedWords} words
                        </span>
                      </div>
                      <div className="flex-1 p-5 overflow-y-auto text-xs font-mono leading-relaxed text-neutral-800 dark:text-neutral-200 whitespace-pre-wrap bg-emerald-50/10 dark:bg-emerald-950/10">
                        {humanizedMarkdown || (
                          <div className="h-full flex items-center justify-center text-center text-neutral-400">
                            Click "Rewrite & Humanize Document" to generate the humanized version.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* 3. Markdown Source Editor View */}
                {activeViewTab === 'editor' && (
                  <div className="flex-1 flex flex-col p-4 space-y-2">
                    <div className="flex items-center justify-between text-xs text-neutral-500">
                      <span>Live Markdown Document Editor</span>
                      <span>{humanizedMarkdown ? humanizedMarkdown.length : parsedDoc.markdownContent.length} characters</span>
                    </div>
                    <textarea
                      value={humanizedMarkdown || parsedDoc.markdownContent}
                      onChange={(e) => setHumanizedMarkdown(e.target.value)}
                      placeholder="Markdown content..."
                      className="flex-1 w-full p-4 font-mono text-xs bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl focus:outline-none focus:ring-1 focus:ring-blue-500 leading-relaxed resize-none"
                    />
                  </div>
                )}

                {/* 4. Section Inspector View */}
                {activeViewTab === 'sections' && (
                  <div className="flex-1 p-5 overflow-y-auto space-y-3">
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      Detected {parsedDoc.sections.length} structural sections in document. You can inspect or rewrite individual sections below.
                    </p>
                    {parsedDoc.sections.map((section, idx) => (
                      <div
                        key={section.id}
                        className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/40 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 text-[10px] font-bold flex items-center justify-center">
                              {idx + 1}
                            </span>
                            <h4 className="font-bold text-xs text-neutral-900 dark:text-neutral-100">
                              {section.heading || 'Introductory Section'}
                            </h4>
                          </div>
                          <span className="text-[10px] font-medium text-neutral-500">
                            {section.wordCount} words
                          </span>
                        </div>
                        <p className="text-xs text-neutral-600 dark:text-neutral-300 line-clamp-3 font-sans">
                          {sectionRewrites[section.id] || section.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Interactive Comparison Pop-up Modal */}
      <DocumentComparisonModal
        isOpen={isComparisonModalOpen}
        onClose={() => setIsComparisonModalOpen(false)}
        document={parsedDoc}
        humanizedMarkdown={humanizedMarkdown}
        selectedTone={selectedTone}
        sectionRewrites={sectionRewrites}
      />
    </div>
  );
};

/**
 * Formatted Markdown Renderer Component
 * Renders structured markdown headings, lists, quotes, and paragraphs cleanly with paper typography
 */
function FormattedMarkdownRenderer({ content }: { content: string }) {
  if (!content) return null;

  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let currentParagraphLines: string[] = [];
  let keyIndex = 0;

  const flushParagraph = () => {
    if (currentParagraphLines.length > 0) {
      const text = currentParagraphLines.join(' ').trim();
      if (text) {
        elements.push(
          <p
            key={`p_${keyIndex++}`}
            className="text-sm md:text-base leading-relaxed text-neutral-700 dark:text-neutral-300 mb-4"
          >
            {renderInlineMarkdown(text)}
          </p>
        );
      }
      currentParagraphLines = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      continue;
    }

    // Heading 1
    if (line.startsWith('# ')) {
      flushParagraph();
      elements.push(
        <h1
          key={`h1_${keyIndex++}`}
          className="text-2xl md:text-3xl font-extrabold text-neutral-900 dark:text-neutral-100 mt-6 mb-3 tracking-tight"
        >
          {line.substring(2)}
        </h1>
      );
      continue;
    }

    // Heading 2
    if (line.startsWith('## ')) {
      flushParagraph();
      elements.push(
        <h2
          key={`h2_${keyIndex++}`}
          className="text-xl md:text-2xl font-bold text-neutral-900 dark:text-neutral-100 mt-5 mb-2.5 tracking-tight border-b border-neutral-100 dark:border-neutral-800 pb-1"
        >
          {line.substring(3)}
        </h2>
      );
      continue;
    }

    // Heading 3
    if (line.startsWith('### ')) {
      flushParagraph();
      elements.push(
        <h3
          key={`h3_${keyIndex++}`}
          className="text-lg font-semibold text-neutral-800 dark:text-neutral-200 mt-4 mb-2"
        >
          {line.substring(4)}
        </h3>
      );
      continue;
    }

    // Bulleted list item
    if (line.startsWith('- ') || line.startsWith('* ')) {
      flushParagraph();
      elements.push(
        <li
          key={`li_${keyIndex++}`}
          className="ml-5 list-disc text-sm md:text-base text-neutral-700 dark:text-neutral-300 mb-1.5"
        >
          {renderInlineMarkdown(line.substring(2))}
        </li>
      );
      continue;
    }

    // Numbered list item
    const numMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (numMatch) {
      flushParagraph();
      elements.push(
        <li
          key={`nli_${keyIndex++}`}
          className="ml-5 list-decimal text-sm md:text-base text-neutral-700 dark:text-neutral-300 mb-1.5"
        >
          {renderInlineMarkdown(numMatch[2])}
        </li>
      );
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      flushParagraph();
      elements.push(
        <blockquote
          key={`bq_${keyIndex++}`}
          className="border-l-4 border-blue-500 pl-4 py-1.5 my-4 italic text-neutral-600 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-900/40 rounded-r-lg text-sm md:text-base"
        >
          {renderInlineMarkdown(line.substring(2))}
        </blockquote>
      );
      continue;
    }

    // Plain text line accumulating into paragraph
    currentParagraphLines.push(line);
  }

  flushParagraph();

  return <div className="space-y-1">{elements}</div>;
}

/**
 * Parses bold (**text**) and italic (*text*) inside line text
 */
function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|[^*]+)/g;
  let match;
  let idx = 0;

  while ((match = regex.exec(text)) !== null) {
    const segment = match[0];
    if (segment.startsWith('**') && segment.endsWith('**') && segment.length >= 4) {
      parts.push(
        <strong key={`b_${idx++}`} className="font-bold text-neutral-900 dark:text-neutral-100">
          {segment.slice(2, -2)}
        </strong>
      );
    } else if (segment.startsWith('*') && segment.endsWith('*') && segment.length >= 2) {
      parts.push(
        <em key={`i_${idx++}`} className="italic">
          {segment.slice(1, -1)}
        </em>
      );
    } else {
      parts.push(segment);
    }
  }

  return parts;
}
