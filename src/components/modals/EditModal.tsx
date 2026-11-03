import React, { useState } from 'react';

interface EditModalProps {
  filename: string;
  initialContent: string;
  onSave: (content: string) => Promise<void>;
  onClose: () => void;
}

export const EditModal: React.FC<EditModalProps> = ({
  filename,
  initialContent,
  onSave,
  onClose,
}) => {
  const [content, setContent] = useState(initialContent);
  const [isModified, setIsModified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string>('');

  const lines = content.split('\n');
  const lineCount = lines.length;

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus('Saving...');
    try {
      await onSave(content);
      setIsModified(false);
      setSaveStatus('Saved!');
      setTimeout(() => setSaveStatus(''), 2000);
    } catch (err: any) {
      setSaveStatus(`Error: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      if (isModified) {
        if (confirm('Discard unsaved changes?')) {
          onClose();
        }
      } else {
        onClose();
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-nc-black/85 flex items-center justify-center p-3 z-50 font-mono select-none">
      <div className="bg-nc-blue border-4 border-nc-cyan text-nc-white w-full max-w-5xl h-[85vh] flex flex-col shadow-2xl">
        {/* Title Bar */}
        <div className="bg-nc-cyan text-nc-black px-3 py-1 font-bold flex justify-between items-center text-xs">
          <div className="flex items-center space-x-2 truncate">
            <span>EDIT:</span>
            <span className="text-nc-darkblue bg-nc-white px-1 font-mono">
              {filename}
            </span>
            {isModified && <span className="text-nc-brightred font-black">[MODIFIED]</span>}
          </div>

          <div className="flex items-center space-x-3">
            {saveStatus && <span className="text-nc-black font-bold">{saveStatus}</span>}
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-nc-darkblue text-nc-yellow hover:bg-nc-black px-2 py-0.5 text-xs font-bold border border-nc-black"
            >
              [ Cmd+S SAVE ]
            </button>
            <button
              onClick={() => {
                if (isModified && !confirm('Discard unsaved changes?')) return;
                onClose();
              }}
              className="bg-nc-red text-nc-white hover:bg-nc-brightred px-2 py-0.5 text-xs font-bold"
            >
              ✕ ESC
            </button>
          </div>
        </div>

        {/* Text Area */}
        <div className="flex-1 bg-nc-darkblue p-2 flex overflow-hidden">
          <textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setIsModified(true);
            }}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-nc-blue text-nc-white font-mono text-xs p-3 outline-none resize-none border border-nc-cyan leading-relaxed select-text"
            spellCheck={false}
            autoFocus
          />
        </div>

        {/* Bottom Bar */}
        <div className="bg-nc-cyan text-nc-black px-3 py-1 text-[11px] font-bold flex justify-between items-center border-t border-nc-brightcyan">
          <span>Lines: {lineCount} | Chars: {content.length}</span>
          <span>Shortcut: Cmd+S to Save, ESC to Close</span>
          <div className="flex space-x-2">
            <button
              onClick={handleSave}
              className="bg-nc-darkblue text-nc-yellow px-3 py-0.5 hover:bg-nc-black"
            >
              Save (F2 / Cmd+S)
            </button>
            <button
              onClick={() => {
                if (isModified && !confirm('Discard unsaved changes?')) return;
                onClose();
              }}
              className="bg-nc-darkblue text-nc-white px-3 py-0.5 hover:bg-nc-red"
            >
              Close (ESC)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
