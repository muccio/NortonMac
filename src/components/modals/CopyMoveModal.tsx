import React, { useState, useEffect, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { TransferProgress } from '../../types';

interface CopyMoveModalProps {
  mode: 'copy' | 'move';
  sourceNames: string[];
  defaultDest: string;
  onConfirm: (destDir: string, overwrite: boolean) => Promise<void>;
  onClose: () => void;
}

function formatBytesHuman(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes.toLocaleString()} B`;
}

export const CopyMoveModal: React.FC<CopyMoveModalProps> = ({
  mode,
  sourceNames,
  defaultDest,
  onConfirm,
  onClose,
}) => {
  const [dest, setDest] = useState(defaultDest);
  const [overwrite, setOverwrite] = useState(false);
  const [inProgress, setInProgress] = useState(false);
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const isCopy = mode === 'copy';
  const title = isCopy ? 'COPY' : 'RENAME / MOVE';

  // Subscribe to backend real-time transfer progress events
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;

    listen<TransferProgress>('transfer-progress', (event) => {
      setProgress(event.payload);
    })
      .then((unlisten) => {
        unlistenFn = unlisten;
      })
      .catch((err) => {
        console.warn('Transfer progress listener error:', err);
      });

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  const runAction = useCallback(async () => {
    if (inProgress || !dest.trim()) return;
    const startedAt = Date.now();
    setInProgress(true);
    setErrorMsg('');
    setProgress({
      operation: mode,
      current_file: sourceNames[0] || '',
      files_done: 0,
      total_files: Math.max(1, sourceNames.length),
      bytes_done: 0,
      total_bytes: 0,
      percent: 0,
    });

    try {
      await onConfirm(dest.trim(), overwrite);
      setProgress((prev) =>
        prev
          ? {
              ...prev,
              files_done: prev.total_files,
              bytes_done: prev.total_bytes > 0 ? prev.total_bytes : prev.bytes_done,
              percent: 100,
            }
          : null
      );
      // Ensure 100% completion is briefly visible on instant operations
      const elapsed = Date.now() - startedAt;
      if (elapsed < 180) {
        await new Promise((res) => setTimeout(res, 160));
      }
      onClose();
    } catch (err: any) {
      setErrorMsg(String(err));
      setInProgress(false);
    }
  }, [inProgress, dest, mode, sourceNames, onConfirm, overwrite, onClose]);

  const handleAction = async (e: React.FormEvent) => {
    e.preventDefault();
    await runAction();
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((isCopy && e.key === 'F5') || (!isCopy && e.key === 'F6')) {
        e.preventDefault();
        e.stopPropagation();
        runAction();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isCopy, runAction]);

  const pct = progress ? Math.min(100, Math.max(0, progress.percent)) : 0;
  const pctLabel = `${pct >= 99.95 ? '100' : pct.toFixed(pct < 10 && pct > 0 ? 1 : 0)}%`;

  return (
    <div className="fixed inset-0 bg-nc-black/80 flex items-center justify-center p-4 z-50 font-mono select-none">
      <div className="bg-nc-blue border-4 border-nc-cyan text-nc-white max-w-lg w-full shadow-2xl p-4">
        {/* Title */}
        <div className="bg-nc-cyan text-nc-black text-center font-bold py-1 text-sm mb-3 uppercase">
          {title}
        </div>

        <form onSubmit={handleAction} className="space-y-3 text-xs">
          <div>
            <span className="text-nc-gray">
              {isCopy ? 'Copy' : 'Move'} {sourceNames.length} item(s):
            </span>
            <div className="text-nc-yellow font-bold truncate max-h-16 overflow-y-auto mt-1 p-1 bg-nc-darkblue border border-nc-cyan/40">
              {sourceNames.join(', ')}
            </div>
          </div>

          <div>
            <label className="block text-nc-brightcyan font-bold mb-1">
              to destination directory:
            </label>
            <input
              type="text"
              value={dest}
              onChange={(e) => setDest(e.target.value)}
              className="w-full bg-nc-darkblue text-nc-white border border-nc-cyan p-1.5 outline-none font-bold disabled:opacity-70"
              autoFocus
              disabled={inProgress}
            />
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="overwriteCheck"
              checked={overwrite}
              disabled={inProgress}
              onChange={(e) => setOverwrite(e.target.checked)}
              className="cursor-pointer"
            />
            <label htmlFor="overwriteCheck" className="cursor-pointer text-nc-white">
              Overwrite existing files
            </label>
          </div>

          {/* Live Transfer Percentage & Byte Progress Box */}
          {inProgress && progress && (
            <div className="p-2.5 bg-nc-darkblue border-2 border-nc-brightcyan space-y-2 shadow-inner">
              <div className="flex items-center justify-between text-[11px] gap-2">
                <div className="truncate text-nc-white">
                  <span className="text-nc-brightcyan font-bold mr-1">
                    {isCopy ? 'Copying:' : 'Moving:'}
                  </span>
                  <span className="text-nc-yellow font-bold">
                    {progress.current_file || '...'}
                  </span>
                </div>
                <span className="text-nc-yellow font-black flex-shrink-0 text-xs">
                  {pctLabel}
                </span>
              </div>

              {/* Norton Commander Progress Bar */}
              <div className="w-full h-5 bg-nc-black border border-nc-cyan relative overflow-hidden">
                <div
                  className="h-full bg-nc-yellow transition-[width] duration-75 ease-linear"
                  style={{ width: `${pct}%` }}
                />
                {/* Subtle retro block stripes */}
                <div
                  className="absolute inset-0 pointer-events-none opacity-20"
                  style={{
                    backgroundImage:
                      'repeating-linear-gradient(90deg, transparent, transparent 10px, rgba(0,0,0,0.65) 10px, rgba(0,0,0,0.65) 12px)',
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="px-1.5 py-0 bg-nc-darkblue/90 text-nc-white border border-nc-cyan/60 text-[10px] font-black tracking-wider">
                    {pct.toFixed(1)}%
                  </span>
                </div>
              </div>

              {/* Bytes & File Counter */}
              <div className="flex items-center justify-between text-[10px] text-nc-brightcyan font-bold">
                <span>
                  {progress.total_bytes > 0
                    ? `${formatBytesHuman(progress.bytes_done)} / ${formatBytesHuman(progress.total_bytes)}`
                    : progress.bytes_done > 0
                    ? `${formatBytesHuman(progress.bytes_done)} transferred`
                    : 'Preparing transfer...'}
                </span>
                <span className="text-nc-white">
                  Files: {progress.files_done} / {progress.total_files}
                </span>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="p-2 bg-nc-red text-nc-white font-bold text-center break-words">
              {errorMsg}
            </div>
          )}

          <div className="flex justify-center space-x-4 pt-2">
            <button
              type="submit"
              disabled={inProgress}
              className="bg-nc-cyan text-nc-black hover:bg-nc-yellow disabled:opacity-60 font-bold px-6 py-1.5 text-xs border border-nc-white"
            >
              {inProgress
                ? `WORKING... (${pctLabel})`
                : `[ ${isCopy ? 'COPY (F5)' : 'MOVE (F6)'} ]`}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={inProgress}
              className="bg-nc-darkblue text-nc-white hover:bg-nc-red disabled:opacity-50 font-bold px-6 py-1.5 text-xs border border-nc-cyan"
            >
              [ CANCEL (ESC) ]
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
