import React, { useState, useEffect } from 'react';
import {
  X,
  Split,
  Eye,
  ListTree,
  Copy,
  Check,
  Download,
  Sparkles,
  BookOpen,
  Layers,
  ArrowRight,
  FileText,
  FileCheck,
  Maximize2,
  Minimize2,
  RotateCcw
} from 'lucide-react';
import { ParsedDocument, calculateDocumentFleschScore, calculateDocumentFluffPercentage } from '../../utils/documentParser';
import { exportToDocx, exportToMarkdown, exportToPlainText, triggerBlobDownload } from '../../utils/documentExport';
import { useToast } from '../ui/Toast';

interface DocumentComparisonModalProps {
  isOpen: boolean;
  onClose: () => void;
  document: ParsedDocument | null;
  humanizedMarkdown: string;
  selectedTone?: string;
  sectionRewrites?: Record<string, string>;
}

export const DocumentComparisonModal: React.FC<DocumentComparisonModalProps> = ({
  isOpen,
  onClose,
  document,
  humanizedMarkdown,
  selectedTone = 'conversational',
  sectionRewrites = {}
}) => {
  const { addToast } = useToast();
  const [activeMode, setActiveMode] = useState<'split' | 'inline' | 'sections'>('split');
  const [selectedSectionIdx, setSelectedSectionIdx] = useState<number>(0);
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isExportingDocx, setIsExportingDocx] = useState<boolean>(false);
  const [isFullScreen, setIsFullScreen] = useState<boolean>(false);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !document) return null;

  const originalText = document.markdownContent || document.rawText || '';
  const transformedText = humanizedMarkdown || originalText;

  // Stats calculation
  const originalWords = document.totalWords || originalText.split(/\s+/).filter(Boolean).length;
  const humanizedWords = transformedText.split(/\s+/).filter(Boolean).length;
  const wordDelta = humanizedWords - originalWords;

  const originalFlesch = document.fleschScore || calculateDocumentFleschScore(originalText);
  const humanizedFlesch = calculateDocumentFleschScore(transformedText);
  const fleschDelta = humanizedFlesch - originalFlesch;

  const originalFluff = document.aiFluffPercentage || calculateDocumentFluffPercentage(originalText);
  const humanizedFluff = calculateDocumentFluffPercentage(transformedText);
  const fluffReduction = originalFluff > 0 ? Math.max(0, Math.round(((originalFluff - humanizedFluff) / originalFluff) * 100)) : 100;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(transformedText);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
      addToast({
        title: 'Copied Humanized Document',
        message: 'Full humanized markdown copied to clipboard.',
        type: 'info'
      });
    } catch {
      // Fallback
    }
  };

  const handleDownloadDocx = async () => {
    try {
      setIsExportingDocx(true);
      const title = document.title || 'Humanized Document';
      const docxBlob = await exportToDocx(title, transformedText);
      const cleanFilename = `${document.filename.replace(/\.[^/.]+$/, '')}_humanized.docx`;
      triggerBlobDownload(docxBlob, cleanFilename);
      addToast({
        title: 'Downloaded Word Document',
        message: `Saved as "${cleanFilename}".`,
        type: 'success'
      });
    } catch (err: any) {
      addToast({
        title: 'Export Failed',
        message: err.message || 'Failed to generate Word file.',
        type: 'error'
      });
    } finally {
      setIsExportingDocx(false);
    }
  };

  const handleDownloadMarkdown = () => {
    const title = document.title || 'Humanized Document';
    const blob = exportToMarkdown(title, transformedText);
    const cleanFilename = `${document.filename.replace(/\.[^/.]+$/, '')}_humanized.md`;
    triggerBlobDownload(blob, cleanFilename);
    addToast({
      title: 'Downloaded Markdown',
      message: `Saved as "${cleanFilename}".`,
      type: 'success'
    });
  };

  // Compute paragraph-level inline diffs
  const originalParas = originalText.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const humanizedParas = transformedText.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const maxParas = Math.max(originalParas.length, humanizedParas.length);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`bg-white dark:bg-[#13161c] border border-neutral-200 dark:border-neutral-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-neutral-900 dark:text-neutral-100 transition-all ${
          isFullScreen ? 'w-full h-full max-w-none rounded-none' : 'max-w-6xl w-full h-[90vh]'
        }`}
      >
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-neutral-200 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-3 bg-neutral-50/50 dark:bg-[#171b23]/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 flex items-center justify-center font-bold">
              <Split className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
                  Document Comparison & Diff Inspector
                </h2>
                <span className="px-2 py-0.5 text-[11px] font-semibold rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                  {selectedTone} tone
                </span>
              </div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                {document.title} · <span className="font-mono">{document.filename}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsFullScreen(!isFullScreen)}
              className="p-2 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-800 transition cursor-pointer"
              title={isFullScreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              onClick={onClose}
              className="p-2 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-800 transition cursor-pointer"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Stats & KPI Delta Ribbon */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 bg-neutral-100/70 dark:bg-[#0f1217] border-b border-neutral-200 dark:border-neutral-800 text-xs">
          <div className="flex items-center gap-2.5 p-2 bg-white dark:bg-[#171b23] rounded-xl border border-neutral-200 dark:border-neutral-800/80">
            <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <Layers className="w-3.5 h-3.5" />
            </div>
            <div>
              <p className="text-[10px] text-neutral-500">Word Count</p>
              <p className="font-bold text-neutral-800 dark:text-neutral-200">
                {humanizedWords}{' '}
                <span className={`text-[11px] font-semibold ${wordDelta >= 0 ? 'text-blue-600' : 'text-neutral-500'}`}>
                  ({wordDelta >= 0 ? `+${wordDelta}` : wordDelta})
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 p-2 bg-white dark:bg-[#171b23] rounded-xl border border-neutral-200 dark:border-neutral-800/80">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <BookOpen className="w-3.5 h-3.5" />
            </div>
            <div>
              <p className="text-[10px] text-neutral-500">Readability Score</p>
              <p className="font-bold text-neutral-800 dark:text-neutral-200">
                {humanizedFlesch}/100{' '}
                <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                  ({fleschDelta >= 0 ? `+${fleschDelta}` : fleschDelta})
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 p-2 bg-white dark:bg-[#171b23] rounded-xl border border-neutral-200 dark:border-neutral-800/80">
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <div>
              <p className="text-[10px] text-neutral-500">AI Fluff Purged</p>
              <p className="font-bold text-amber-600 dark:text-amber-400">
                {fluffReduction}% reduced
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 p-2 bg-white dark:bg-[#171b23] rounded-xl border border-neutral-200 dark:border-neutral-800/80">
            <div className="w-7 h-7 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
              <FileCheck className="w-3.5 h-3.5" />
            </div>
            <div>
              <p className="text-[10px] text-neutral-500">Sections Detected</p>
              <p className="font-bold text-neutral-800 dark:text-neutral-200">
                {document.sections.length} sections
              </p>
            </div>
          </div>
        </div>

        {/* View Mode Switcher Toolbar */}
        <div className="p-3 border-b border-neutral-200 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-[#13161c]">
          <div className="flex items-center gap-1 bg-neutral-100 dark:bg-neutral-900 p-1 rounded-xl">
            <button
              onClick={() => setActiveMode('split')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                activeMode === 'split'
                  ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xs'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
              }`}
            >
              <Split className="w-3.5 h-3.5 text-blue-500" />
              Side-by-Side (Split)
            </button>
            <button
              onClick={() => setActiveMode('inline')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                activeMode === 'inline'
                  ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xs'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
              }`}
            >
              <Eye className="w-3.5 h-3.5 text-emerald-500" />
              Inline Paragraph Diff
            </button>
            <button
              onClick={() => setActiveMode('sections')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                activeMode === 'sections'
                  ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xs'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
              }`}
            >
              <ListTree className="w-3.5 h-3.5 text-purple-500" />
              Section Inspector ({document.sections.length})
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 transition flex items-center gap-1.5 cursor-pointer"
            >
              {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{isCopied ? 'Copied' : 'Copy Humanized'}</span>
            </button>
            <button
              onClick={handleDownloadDocx}
              disabled={isExportingDocx}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white transition flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Download Word (.docx)</span>
            </button>
          </div>
        </div>

        {/* View Mode 1: Side-by-Side (Split) */}
        {activeMode === 'split' && (
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-neutral-200 dark:divide-neutral-800 overflow-hidden">
            {/* Left: Original */}
            <div className="flex flex-col h-full overflow-hidden bg-neutral-50/40 dark:bg-[#101318]/50">
              <div className="p-3 bg-red-50/60 dark:bg-red-950/30 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
                <span className="text-xs font-bold text-red-700 dark:text-red-400 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  Original Document (Before Humanization)
                </span>
                <span className="text-xs font-mono text-neutral-500">{originalWords} words</span>
              </div>
              <div className="flex-1 p-5 overflow-y-auto text-xs font-mono leading-relaxed text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap select-text">
                {originalText}
              </div>
            </div>

            {/* Right: Humanized */}
            <div className="flex flex-col h-full overflow-hidden bg-emerald-50/10 dark:bg-emerald-950/10">
              <div className="p-3 bg-emerald-50/60 dark:bg-emerald-950/30 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  Humanized Document (Ollama AI / Authentic)
                </span>
                <span className="text-xs font-mono text-neutral-500">{humanizedWords} words</span>
              </div>
              <div className="flex-1 p-5 overflow-y-auto text-xs font-mono leading-relaxed text-neutral-800 dark:text-neutral-200 whitespace-pre-wrap select-text">
                {transformedText}
              </div>
            </div>
          </div>
        )}

        {/* View Mode 2: Inline Paragraph Diff */}
        {activeMode === 'inline' && (
          <div className="flex-1 p-5 overflow-y-auto space-y-4 bg-neutral-50/30 dark:bg-[#0f1217]">
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Comparing paragraph-by-paragraph changes. Original robotic or raw passages are shown with red backgrounds; humanized replacements follow with emerald highlights.
            </p>

            {Array.from({ length: maxParas }).map((_, i) => {
              const origP = originalParas[i] || '';
              const humP = humanizedParas[i] || '';
              const isDifferent = origP !== humP;

              return (
                <div
                  key={`diff_para_${i}`}
                  className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#161a22] overflow-hidden shadow-2xs"
                >
                  <div className="px-3.5 py-1.5 bg-neutral-100 dark:bg-[#1a1f29] border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between text-[11px] font-mono text-neutral-500">
                    <span>Paragraph #{i + 1}</span>
                    <span className={isDifferent ? 'text-amber-500 font-bold' : 'text-neutral-400'}>
                      {isDifferent ? 'Modified' : 'Unchanged'}
                    </span>
                  </div>

                  <div className="p-4 space-y-3 text-xs leading-relaxed">
                    {/* Original paragraph */}
                    {origP && (
                      <div className="p-3 rounded-lg bg-red-50/60 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 text-red-900 dark:text-red-200">
                        <span className="text-[10px] font-bold uppercase tracking-wider block text-red-600 dark:text-red-400 mb-1">
                          Original:
                        </span>
                        <p className="whitespace-pre-wrap">{origP}</p>
                      </div>
                    )}

                    {/* Humanized paragraph */}
                    {humP && (
                      <div className="p-3 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 text-emerald-900 dark:text-emerald-200">
                        <span className="text-[10px] font-bold uppercase tracking-wider block text-emerald-600 dark:text-emerald-400 mb-1">
                          Humanized ({selectedTone}):
                        </span>
                        <p className="whitespace-pre-wrap font-sans">{humP}</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* View Mode 3: Section Inspector */}
        {activeMode === 'sections' && (
          <div className="flex-1 grid grid-cols-1 md:grid-cols-12 overflow-hidden divide-y md:divide-y-0 md:divide-x divide-neutral-200 dark:divide-neutral-800">
            {/* Section List (col-span-4) */}
            <div className="md:col-span-4 p-3 overflow-y-auto space-y-1.5 bg-neutral-50/50 dark:bg-[#101318]/50">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-2 px-1">
                Document Sections
              </p>
              {document.sections.map((sec, idx) => (
                <button
                  key={sec.id}
                  onClick={() => setSelectedSectionIdx(idx)}
                  className={`w-full p-2.5 rounded-xl text-left text-xs transition cursor-pointer flex items-center justify-between ${
                    selectedSectionIdx === idx
                      ? 'bg-blue-600 text-white font-bold shadow-xs'
                      : 'hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="text-[10px] opacity-75 font-mono">#{idx + 1}</span>
                    <span className="truncate">{sec.heading || `Section ${idx + 1}`}</span>
                  </div>
                  <span className="text-[10px] opacity-70 shrink-0">{sec.wordCount}w</span>
                </button>
              ))}
            </div>

            {/* Section Comparison Details (col-span-8) */}
            <div className="md:col-span-8 p-5 overflow-y-auto flex flex-col space-y-4">
              {document.sections[selectedSectionIdx] && (
                <>
                  <div className="border-b border-neutral-200 dark:border-neutral-800 pb-2 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-blue-600">
                        Section #{selectedSectionIdx + 1}
                      </span>
                      <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
                        {document.sections[selectedSectionIdx].heading || 'Introductory Section'}
                      </h3>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50/30 dark:bg-red-950/20 space-y-2">
                      <span className="text-[10px] font-bold uppercase text-red-600 dark:text-red-400">
                        Original Section
                      </span>
                      <p className="text-xs whitespace-pre-wrap text-neutral-800 dark:text-neutral-200 font-mono">
                        {document.sections[selectedSectionIdx].content}
                      </p>
                    </div>

                    <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/30 dark:bg-emerald-950/20 space-y-2">
                      <span className="text-[10px] font-bold uppercase text-emerald-600 dark:text-emerald-400">
                        Humanized Section
                      </span>
                      <p className="text-xs whitespace-pre-wrap text-neutral-900 dark:text-neutral-100 font-sans">
                        {sectionRewrites[document.sections[selectedSectionIdx].id] ||
                          document.sections[selectedSectionIdx].content}
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Modal Bottom Actions Footer */}
        <div className="p-3.5 sm:p-4 border-t border-neutral-200 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-3 bg-neutral-50/50 dark:bg-[#171b23]/50">
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadMarkdown}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300 transition cursor-pointer"
            >
              Export .md
            </button>
            <button
              onClick={() => {
                const title = document.title || 'Humanized Document';
                const blob = exportToPlainText(title, transformedText);
                const cleanFilename = `${document.filename.replace(/\.[^/.]+$/, '')}_humanized.txt`;
                triggerBlobDownload(blob, cleanFilename);
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300 transition cursor-pointer"
            >
              Export .txt
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 cursor-pointer"
            >
              Close Comparison
            </button>
            <button
              onClick={handleDownloadDocx}
              disabled={isExportingDocx}
              className="px-4 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition shadow-sm flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Formatted Document</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
