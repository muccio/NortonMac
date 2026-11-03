import React, { useState } from 'react';

interface CopyMoveModalProps {
  mode: 'copy' | 'move';
  sourceNames: string[];
  defaultDest: string;
  onConfirm: (destDir: string, overwrite: boolean) => Promise<void>;
  onClose: () => void;
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
  const [errorMsg, setErrorMsg] = useState('');

  const isCopy = mode === 'copy';
  const title = isCopy ? 'COPY' : 'RENAME / MOVE';

  const handleAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dest.trim()) return;

    setInProgress(true);
    setErrorMsg('');
    try {
      await onConfirm(dest.trim(), overwrite);
      onClose();
    } catch (err: any) {
      setErrorMsg(String(err));
    } finally {
      setInProgress(false);
    }
  };

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
              className="w-full bg-nc-darkblue text-nc-white border border-nc-cyan p-1.5 outline-none font-bold"
              autoFocus
              disabled={inProgress}
            />
          </div>

          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="overwriteCheck"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
              className="cursor-pointer"
            />
            <label htmlFor="overwriteCheck" className="cursor-pointer text-nc-white">
              Overwrite existing files
            </label>
          </div>

          {errorMsg && (
            <div className="p-2 bg-nc-red text-nc-white font-bold text-center">
              {errorMsg}
            </div>
          )}

          <div className="flex justify-center space-x-4 pt-2">
            <button
              type="submit"
              disabled={inProgress}
              className="bg-nc-cyan text-nc-black hover:bg-nc-yellow font-bold px-6 py-1.5 text-xs border border-nc-white"
            >
              {inProgress ? 'PROCESSING...' : `[ ${isCopy ? 'COPY (F5)' : 'MOVE (F6)'} ]`}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={inProgress}
              className="bg-nc-darkblue text-nc-white hover:bg-nc-red font-bold px-6 py-1.5 text-xs border border-nc-cyan"
            >
              [ CANCEL (ESC) ]
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
