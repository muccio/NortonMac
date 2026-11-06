import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { FileEntry, TransferProgress } from '../../types';

interface DuplicateModalProps {
  currentDir: string;
  items: FileEntry[];
  existingEntries: FileEntry[];
  onConfirm: (newName?: string) => Promise<void>;
  onClose: () => void;
}

function splitNameAndExt(originalName: string, isDir: boolean): { stem: string; ext: string } {
  if (isDir) {
    return { stem: originalName, ext: '' };
  }
  const lower = originalName.toLowerCase();
  const compoundExts = ['.tar.gz', '.tar.bz2', '.tar.xz'];
  for (const ce of compoundExts) {
    if (lower.endsWith(ce) && originalName.length > ce.length) {
      const pos = originalName.length - ce.length;
      return { stem: originalName.slice(0, pos), ext: originalName.slice(pos) };
    }
  }
  const dot = originalName.lastIndexOf('.');
  if (dot > 0) {
    return { stem: originalName.slice(0, dot), ext: originalName.slice(dot) };
  }
  return { stem: originalName, ext: '' };
}

export function suggestDuplicateName(
  originalName: string,
  isDir: boolean,
  existingLower: Set<string>
): string {
  const { stem: rawStem, ext } = splitNameAndExt(originalName, isDir);

  let baseStem = rawStem;
  if (rawStem.endsWith(' copia')) {
    baseStem = rawStem.slice(0, -' copia'.length);
  } else {
    const match = rawStem.match(/^(.*) copia (\d+)$/);
    if (match) {
      baseStem = match[1];
    }
  }

  const first = `${baseStem} copia${ext}`;
  if (!existingLower.has(first.toLowerCase())) {
    return first;
  }

  for (let n = 2; n < 10000; n++) {
    const cand = `${baseStem} copia ${n}${ext}`;
    if (!existingLower.has(cand.toLowerCase())) {
      return cand;
    }
  }
  return `${baseStem}_dup${ext}`;
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

export const DuplicateModal: React.FC<DuplicateModalProps> = ({
  currentDir,
  items,
  existingEntries,
  onConfirm,
  onClose,
}) => {
  const isSingle = items.length === 1;
  const isRemote =
    currentDir.startsWith('ftp://') ||
    currentDir.startsWith('ftps://') ||
    currentDir.startsWith('sftp://');

  const previewPairs = useMemo(() => {
    const existingSet = new Set(existingEntries.map((e) => e.name.toLowerCase()));
    return items.map((item) => {
      const target = suggestDuplicateName(item.name, item.is_dir, existingSet);
      existingSet.add(target.toLowerCase());
      return { item, suggested: target };
    });
  }, [items, existingEntries]);

  const [newName, setNewName] = useState<string>(() =>
    previewPairs.length === 1 ? previewPairs[0].suggested : ''
  );
  const [inProgress, setInProgress] = useState(false);
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Select stem before extension on mount for quick custom renaming
  useEffect(() => {
    if (isSingle && inputRef.current) {
      const el = inputRef.current;
      el.focus();
      const { stem } = splitNameAndExt(newName, items[0].is_dir);
      el.setSelectionRange(0, stem.length);
    }
  }, []);

  // Subscribe to backend transfer-progress events
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;

    listen<TransferProgress>('transfer-progress', (event) => {
      if (event.payload.operation === 'duplicate') {
        setProgress(event.payload);
      }
    })
      .then((unlisten) => {
        unlistenFn = unlisten;
      })
      .catch((err) => {
        console.warn('Duplicate progress listener error:', err);
      });

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  const runDuplicate = useCallback(async () => {
    if (inProgress) return;
    if (isSingle && !newName.trim()) return;

    const startedAt = Date.now();
    setInProgress(true);
    setErrorMsg('');
    setProgress({
      operation: 'duplicate',
      current_file: isSingle ? newName.trim() : items[0]?.name || '',
      files_done: 0,
      total_files: Math.max(1, items.length),
      bytes_done: 0,
      total_bytes: 0,
      percent: 0,
    });

    try {
      await onConfirm(isSingle ? newName.trim() : undefined);
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
      const elapsed = Date.now() - startedAt;
      if (elapsed < 180) {
        await new Promise((res) => setTimeout(res, 150));
      }
      onClose();
    } catch (err: any) {
      setErrorMsg(String(err));
      setInProgress(false);
    }
  }, [inProgress, isSingle, newName, items, onConfirm, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await runDuplicate();
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) ||
        (e.shiftKey && e.key === 'F5') ||
        (!isSingle && e.key === 'Enter')
      ) {
        e.preventDefault();
        e.stopPropagation();
        runDuplicate();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isSingle, runDuplicate]);

  const pct = progress ? Math.min(100, Math.max(0, progress.percent)) : 0;
  const pctLabel = `${pct >= 99.95 ? '100' : pct.toFixed(pct < 10 && pct > 0 ? 1 : 0)}%`;

  return (
    <div className="fixed inset-0 bg-nc-black/80 flex items-center justify-center p-4 z-50 font-mono select-none">
      <div className="bg-nc-blue border-4 border-nc-cyan text-nc-white max-w-lg w-full shadow-2xl p-4">
        {/* Title */}
        <div className="bg-nc-cyan text-nc-black text-center font-bold py-1 text-sm mb-3 uppercase">
          {isRemote ? 'DUPLICATE REMOTE ITEM (FTP / SFTP)' : 'DUPLICATE FILE / FOLDER'}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <div className="text-nc-gray truncate">
            Directory: <span className="text-nc-brightcyan font-bold">{currentDir}</span>
          </div>

          {isSingle ? (
            <>
              <div>
                <span className="text-nc-gray">Original {items[0].is_dir ? 'folder' : 'file'}:</span>
                <div className="text-nc-yellow font-bold truncate mt-1 p-1.5 bg-nc-darkblue border border-nc-cyan/40">
                  {items[0].is_dir ? `📁 [${items[0].name}]` : `📄 ${items[0].name}`}
                </div>
              </div>

              <div>
                <label className="block text-nc-brightcyan font-bold mb-1">
                  Duplicate name:
                </label>
                <input
                  ref={inputRef}
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full bg-nc-darkblue text-nc-white border border-nc-cyan p-1.5 outline-none font-bold disabled:opacity-70"
                  disabled={inProgress}
                />
              </div>
            </>
          ) : (
            <div>
              <span className="text-nc-gray">
                Duplicating {items.length} selected items in place:
              </span>
              <div className="mt-1 p-2 bg-nc-darkblue border border-nc-cyan/40 max-h-32 overflow-y-auto space-y-1">
                {previewPairs.map(({ item, suggested }) => (
                  <div key={item.path} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-nc-white truncate">
                      {item.is_dir ? `📁 ${item.name}` : item.name}
                    </span>
                    <span className="text-nc-yellow font-bold truncate">
                      → {suggested}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live Transfer Percentage & Byte Progress Box */}
          {inProgress && progress && (
            <div className="p-2.5 bg-nc-darkblue border-2 border-nc-brightcyan space-y-2 shadow-inner">
              <div className="flex items-center justify-between text-[11px] gap-2">
                <div className="truncate text-nc-white">
                  <span className="text-nc-brightcyan font-bold mr-1">Duplicating:</span>
                  <span className="text-nc-yellow font-bold">
                    {progress.current_file || '...'}
                  </span>
                </div>
                <span className="text-nc-yellow font-black flex-shrink-0 text-xs">
                  {pctLabel}
                </span>
              </div>

              <div className="w-full h-5 bg-nc-black border border-nc-cyan relative overflow-hidden">
                <div
                  className="h-full bg-nc-yellow transition-[width] duration-75 ease-linear"
                  style={{ width: `${pct}%` }}
                />
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

              <div className="flex items-center justify-between text-[10px] text-nc-brightcyan font-bold">
                <span>
                  {progress.total_bytes > 0
                    ? `${formatBytesHuman(progress.bytes_done)} / ${formatBytesHuman(progress.total_bytes)}`
                    : progress.bytes_done > 0
                    ? `${formatBytesHuman(progress.bytes_done)} transferred`
                    : 'Working...'}
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
              className="bg-nc-cyan text-nc-black hover:bg-nc-yellow disabled:opacity-60 font-bold px-5 py-1.5 text-xs border border-nc-white"
            >
              {inProgress ? `DUPLICATING... (${pctLabel})` : '[ DUPLICATE (ENTER / Cmd+D) ]'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={inProgress}
              className="bg-nc-darkblue text-nc-white hover:bg-nc-red disabled:opacity-50 font-bold px-5 py-1.5 text-xs border border-nc-cyan"
            >
              [ CANCEL (ESC) ]
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
