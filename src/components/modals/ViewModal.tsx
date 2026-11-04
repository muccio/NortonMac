import React, { useState, useEffect, useMemo } from 'react';
import { FilePreview } from '../../types';
import { api } from '../../api';

import Prism from 'prismjs';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-css';

interface ViewModalProps {
  preview: FilePreview | null;
  loading: boolean;
  onClose: () => void;
}

type ViewMode = 'pdf' | 'syntax' | 'text' | 'hex';

const EXTENSION_LANG_MAP: Record<string, string> = {
  rs: 'rust',
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  sh: 'bash',
  zsh: 'bash',
  bash: 'bash',
  json: 'json',
  toml: 'toml',
  yaml: 'yaml',
  yml: 'yaml',
  sql: 'sql',
  md: 'markdown',
  markdown: 'markdown',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cc: 'cpp',
  html: 'markup',
  htm: 'markup',
  xml: 'markup',
  svg: 'markup',
  css: 'css',
};

export const ViewModal: React.FC<ViewModalProps> = ({ preview, loading, onClose }) => {
  const extension = useMemo(() => {
    if (!preview?.filename) return '';
    return preview.filename.split('.').pop()?.toLowerCase() || '';
  }, [preview?.filename]);

  const detectedLanguage = useMemo(() => {
    return EXTENSION_LANG_MAP[extension] || '';
  }, [extension]);

  // Determine initial view mode
  const initialMode = useMemo<ViewMode>(() => {
    if (preview?.is_pdf) return 'pdf';
    if (preview?.is_binary) return 'hex';
    if (detectedLanguage) return 'syntax';
    return 'text';
  }, [preview, detectedLanguage]);

  const [mode, setMode] = useState<ViewMode>(initialMode);
  const [selectedLanguage, setSelectedLanguage] = useState<string>(detectedLanguage || 'javascript');
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);

  // Sync mode when preview changes
  useEffect(() => {
    setMode(initialMode);
    if (detectedLanguage) {
      setSelectedLanguage(detectedLanguage);
    }
  }, [initialMode, detectedLanguage]);

  // Prepare PDF object URL if in PDF mode
  useEffect(() => {
    if (preview?.is_pdf && preview.pdf_data_base64) {
      try {
        const byteCharacters = atob(preview.pdf_data_base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        setPdfBlobUrl(url);

        return () => {
          URL.revokeObjectURL(url);
          setPdfBlobUrl(null);
        };
      } catch (err) {
        console.error('Failed to parse PDF data:', err);
      }
    }
  }, [preview]);

  // Handle Tab key to cycle through modes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        setMode((prev) => {
          if (preview?.is_pdf) {
            if (prev === 'pdf') return 'text';
            if (prev === 'text') return 'hex';
            return 'pdf';
          }
          if (prev === 'syntax') return 'text';
          if (prev === 'text') return 'hex';
          return detectedLanguage ? 'syntax' : 'text';
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [preview, detectedLanguage]);

  // Syntax highlighted HTML
  const highlightedCodeHtml = useMemo(() => {
    if (!preview?.text_content) return '';
    const lang = selectedLanguage || 'clike';
    const grammar = Prism.languages[lang] || Prism.languages.clike;
    try {
      return Prism.highlight(preview.text_content, grammar, lang);
    } catch {
      return preview.text_content;
    }
  }, [preview?.text_content, selectedLanguage]);

  // Lines for line numbering
  const lines = useMemo(() => {
    return (preview?.text_content || '').split('\n');
  }, [preview?.text_content]);

  const handleOpenNative = async () => {
    if (!preview?.path) return;
    try {
      await api.openFileNative(preview.path);
    } catch (err) {
      alert(`Could not open file in external application: ${err}`);
    }
  };

  return (
    <div className="fixed inset-0 bg-nc-black/85 flex items-center justify-center p-3 z-50 font-mono select-none">
      <div className="bg-nc-blue border-4 border-nc-cyan text-nc-white w-full max-w-6xl h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Title Bar */}
        <div className="bg-nc-cyan text-nc-black px-3 py-1 font-bold flex justify-between items-center text-xs border-b border-nc-brightcyan">
          <div className="flex items-center space-x-2 truncate">
            <span className="text-nc-darkblue bg-nc-yellow px-1 font-black">
              F3 VIEW
            </span>
            <span className="text-nc-darkblue bg-nc-white px-1.5 py-0.5 font-bold font-mono">
              {preview?.filename || 'Loading...'}
            </span>
            <span className="text-nc-black text-[11px]">
              ({preview?.size?.toLocaleString() || 0} bytes)
            </span>
            {preview?.is_pdf && (
              <span className="bg-nc-red text-nc-white px-1 text-[10px] font-black uppercase">
                PDF
              </span>
            )}
          </div>

          {/* Mode Switchers */}
          <div className="flex items-center space-x-1.5">
            {preview?.is_pdf && (
              <button
                onClick={() => setMode('pdf')}
                className={`px-2 py-0.5 text-xs font-bold border transition-colors ${
                  mode === 'pdf'
                    ? 'bg-nc-yellow text-nc-black border-nc-black'
                    : 'bg-nc-darkblue text-nc-white border-nc-cyan hover:bg-nc-black'
                }`}
              >
                📄 PDF VIEW
              </button>
            )}

            {!preview?.is_binary && (
              <button
                onClick={() => setMode('syntax')}
                className={`px-2 py-0.5 text-xs font-bold border transition-colors ${
                  mode === 'syntax'
                    ? 'bg-nc-yellow text-nc-black border-nc-black'
                    : 'bg-nc-darkblue text-nc-brightcyan border-nc-cyan hover:bg-nc-black'
                }`}
                title="Syntax Highlighting (Tab)"
              >
                ⚡ SYNTAX
              </button>
            )}

            <button
              onClick={() => setMode('text')}
              className={`px-2 py-0.5 text-xs font-bold border transition-colors ${
                mode === 'text'
                  ? 'bg-nc-yellow text-nc-black border-nc-black'
                  : 'bg-nc-darkblue text-nc-white border-nc-cyan hover:bg-nc-black'
              }`}
              title="Plain Text Mode (Tab)"
            >
              🔡 TEXT
            </button>

            <button
              onClick={() => setMode('hex')}
              className={`px-2 py-0.5 text-xs font-bold border transition-colors ${
                mode === 'hex'
                  ? 'bg-nc-yellow text-nc-black border-nc-black'
                  : 'bg-nc-darkblue text-nc-white border-nc-cyan hover:bg-nc-black'
              }`}
              title="Hex Viewer Mode (Tab)"
            >
              010 HEX
            </button>

            {preview?.is_pdf && (
              <button
                onClick={handleOpenNative}
                className="bg-nc-darkblue text-nc-yellow hover:bg-nc-black px-2 py-0.5 text-xs font-bold border border-nc-yellow"
                title="Open in macOS Preview application"
              >
                ↗ PREVIEW.APP
              </button>
            )}

            <button
              onClick={onClose}
              className="bg-nc-red text-nc-white hover:bg-nc-brightred px-2 py-0.5 text-xs font-bold"
            >
              ✕ ESC
            </button>
          </div>
        </div>

        {/* Sub-header for Syntax mode (Language Selector) */}
        {mode === 'syntax' && (
          <div className="bg-nc-darkblue text-nc-brightcyan px-3 py-1 text-xs border-b border-nc-cyan flex items-center justify-between font-bold">
            <div className="flex items-center space-x-2">
              <span>SYNTAX HIGHLIGHT:</span>
              <span className="text-nc-yellow uppercase">
                [{selectedLanguage || 'PLAIN TEXT'}]
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-[11px] text-nc-white">Override Language:</span>
              <select
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
                className="bg-nc-blue text-nc-yellow text-xs border border-nc-cyan px-1.5 py-0.5 outline-none cursor-pointer"
              >
                <option value="rust">Rust</option>
                <option value="typescript">TypeScript</option>
                <option value="javascript">JavaScript</option>
                <option value="tsx">TSX / React</option>
                <option value="jsx">JSX / React</option>
                <option value="python">Python</option>
                <option value="bash">Shell / Bash</option>
                <option value="json">JSON</option>
                <option value="toml">TOML</option>
                <option value="yaml">YAML</option>
                <option value="markdown">Markdown</option>
                <option value="sql">SQL</option>
                <option value="c">C</option>
                <option value="cpp">C++</option>
                <option value="css">CSS</option>
                <option value="markup">HTML / XML / SVG</option>
              </select>
            </div>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 bg-nc-darkblue overflow-hidden relative">
          {loading ? (
            <div className="flex items-center justify-center h-full text-nc-yellow text-sm font-bold animate-pulse">
              READING FILE CONTENT...
            </div>
          ) : !preview ? (
            <div className="text-nc-brightred text-center mt-10">
              Failed to load preview for this file.
            </div>
          ) : mode === 'pdf' && preview.is_pdf ? (
            /* PDF Native Viewer via WKWebView */
            <div className="w-full h-full flex flex-col bg-neutral-900">
              {pdfBlobUrl ? (
                <iframe
                  src={pdfBlobUrl}
                  className="w-full h-full border-0 bg-white"
                  title={preview.filename}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-nc-yellow space-y-3">
                  <div className="text-sm font-bold">Rendering PDF preview...</div>
                  <button
                    onClick={handleOpenNative}
                    className="bg-nc-cyan text-nc-black hover:bg-nc-yellow px-4 py-1.5 text-xs font-bold border border-nc-white"
                  >
                    Open in macOS Preview.app
                  </button>
                </div>
              )}
            </div>
          ) : mode === 'syntax' ? (
            /* Syntax Highlighted View with Line Numbers */
            <div className="h-full overflow-auto p-3 text-xs font-mono select-text bg-[#000055]">
              <div className="flex font-mono leading-relaxed min-w-full">
                {/* Line Numbers Column */}
                <div className="select-none pr-3 text-right text-nc-cyan font-bold border-r border-nc-cyan/40 opacity-70">
                  {lines.map((_, i) => (
                    <div key={i}>{i + 1}</div>
                  ))}
                </div>
                {/* Highlighted Code Column */}
                <pre
                  className="pl-3 overflow-x-visible whitespace-pre font-mono text-nc-white flex-1"
                  dangerouslySetInnerHTML={{ __html: highlightedCodeHtml }}
                />
              </div>
            </div>
          ) : mode === 'hex' || preview.is_binary ? (
            /* Hex Viewer */
            <div className="h-full overflow-auto p-3 text-xs font-mono">
              <div className="text-nc-cyan font-bold border-b border-nc-cyan/40 pb-1 mb-2 grid grid-cols-12 text-[11px]">
                <div className="col-span-2">OFFSET</div>
                <div className="col-span-7">HEX BYTES (00 - 0F)</div>
                <div className="col-span-3">ASCII DUMP</div>
              </div>
              {preview.hex_lines.map((line, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-12 font-mono text-[11px] leading-tight hover:bg-nc-blue"
                >
                  <div className="col-span-2 text-nc-yellow">{line.offset}</div>
                  <div className="col-span-7 text-nc-brightcyan tracking-wider">
                    {line.hex_bytes}
                  </div>
                  <div className="col-span-3 text-nc-white font-mono bg-nc-black/30 px-1 border-l border-nc-cyan/30">
                    {line.ascii}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Plain Text Viewer */
            <div className="h-full overflow-auto p-3 text-xs font-mono select-text bg-nc-darkblue">
              <div className="flex font-mono leading-relaxed min-w-full">
                {/* Line Numbers */}
                <div className="select-none pr-3 text-right text-nc-cyan font-bold border-r border-nc-cyan/40 opacity-60">
                  {lines.map((_, i) => (
                    <div key={i}>{i + 1}</div>
                  ))}
                </div>
                {/* Plain Text */}
                <pre className="pl-3 overflow-x-visible whitespace-pre-wrap font-mono text-nc-white flex-1">
                  {preview.text_content || 'Empty file.'}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Status Bar */}
        <div className="bg-nc-cyan text-nc-black px-3 py-1 text-[11px] font-bold flex justify-between items-center border-t border-nc-brightcyan">
          <div className="flex items-center space-x-3">
            <span>Encoding: {preview?.encoding || 'Auto'}</span>
            {lines.length > 0 && <span>Lines: {lines.length}</span>}
            <span className="text-nc-darkblue hidden sm:inline">
              Mode: <span className="uppercase font-black text-nc-red">[{mode}]</span>
            </span>
          </div>

          <div className="flex items-center space-x-3">
            <span className="hidden md:inline text-[10px]">
              Press <span className="underline">Tab</span> to switch mode | <span className="underline">ESC</span> to exit
            </span>
            <button
              onClick={onClose}
              className="bg-nc-darkblue text-nc-white hover:bg-nc-yellow hover:text-nc-black px-3 py-0.5 border border-nc-black"
            >
              Done (ESC)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
