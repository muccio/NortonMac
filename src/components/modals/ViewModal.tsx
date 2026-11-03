import React, { useState } from 'react';
import { FilePreview } from '../../types';

interface ViewModalProps {
  preview: FilePreview | null;
  loading: boolean;
  onClose: () => void;
}

export const ViewModal: React.FC<ViewModalProps> = ({ preview, loading, onClose }) => {
  const [hexMode, setHexMode] = useState<boolean>(preview?.is_binary || false);

  return (
    <div className="fixed inset-0 bg-nc-black/85 flex items-center justify-center p-3 z-50 font-mono select-none">
      <div className="bg-nc-blue border-4 border-nc-cyan text-nc-white w-full max-w-5xl h-[85vh] flex flex-col shadow-2xl">
        {/* Title Bar */}
        <div className="bg-nc-cyan text-nc-black px-3 py-1 font-bold flex justify-between items-center text-xs">
          <div className="flex items-center space-x-2 truncate">
            <span>VIEW:</span>
            <span className="text-nc-darkblue bg-nc-white px-1 font-mono">
              {preview?.filename || 'Loading...'}
            </span>
            <span className="text-nc-black">
              ({preview?.size?.toLocaleString() || 0} bytes)
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setHexMode(!hexMode)}
              className="bg-nc-darkblue text-nc-yellow hover:bg-nc-black px-2 py-0.5 text-xs font-bold border border-nc-black"
            >
              [ {hexMode ? 'TEXT MODE' : 'HEX MODE'} ]
            </button>
            <button
              onClick={onClose}
              className="bg-nc-red text-nc-white hover:bg-nc-brightred px-2 py-0.5 text-xs font-bold"
            >
              ✕ ESC
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 bg-nc-darkblue p-3 overflow-auto text-xs font-mono">
          {loading ? (
            <div className="flex items-center justify-center h-full text-nc-yellow text-sm font-bold animate-pulse">
              READING FILE CONTENT...
            </div>
          ) : !preview ? (
            <div className="text-nc-brightred text-center mt-10">
              Failed to load preview for this file.
            </div>
          ) : hexMode || preview.is_binary ? (
            /* Hex Viewer */
            <div className="space-y-0.5">
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
            /* Text Viewer */
            <pre className="text-nc-white whitespace-pre-wrap font-mono leading-relaxed select-text">
              {preview.text_content || 'Empty file.'}
            </pre>
          )}
        </div>

        {/* Bottom Status */}
        <div className="bg-nc-cyan text-nc-black px-3 py-1 text-[11px] font-bold flex justify-between items-center border-t border-nc-brightcyan">
          <span>Encoding: {preview?.encoding || 'Auto'}</span>
          <span>Press ESC or click Quit to return</span>
          <button
            onClick={onClose}
            className="bg-nc-darkblue text-nc-white hover:bg-nc-yellow hover:text-nc-black px-3 py-0.5"
          >
            Done (ESC)
          </button>
        </div>
      </div>
    </div>
  );
};
