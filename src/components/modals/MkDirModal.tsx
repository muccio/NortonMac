import React, { useState } from 'react';

interface MkDirModalProps {
  currentDir: string;
  onCreate: (dirName: string) => Promise<void>;
  onClose: () => void;
}

export const MkDirModal: React.FC<MkDirModalProps> = ({
  currentDir,
  onCreate,
  onClose,
}) => {
  const [name, setName] = useState('');
  const [inProgress, setInProgress] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setInProgress(true);
    setErrorMsg('');
    try {
      await onCreate(name.trim());
      onClose();
    } catch (err: any) {
      setErrorMsg(String(err));
    } finally {
      setInProgress(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-nc-black/80 flex items-center justify-center p-4 z-50 font-mono select-none">
      <div className="bg-nc-blue border-4 border-nc-cyan text-nc-white max-w-md w-full shadow-2xl p-4">
        <div className="bg-nc-cyan text-nc-black text-center font-bold py-1 text-sm mb-3">
          MAKE DIRECTORY
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 text-xs">
          <div>
            <div className="text-nc-gray truncate mb-1">
              In: <span className="text-nc-yellow">{currentDir}</span>
            </div>
            <label className="block text-nc-brightcyan font-bold mb-1">
              New directory name:
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. New_Folder"
              className="w-full bg-nc-darkblue text-nc-white border border-nc-cyan p-1.5 outline-none font-bold"
              autoFocus
              disabled={inProgress}
            />
          </div>

          {errorMsg && (
            <div className="p-1.5 bg-nc-red text-nc-white font-bold text-center">
              {errorMsg}
            </div>
          )}

          <div className="flex justify-center space-x-4 pt-2">
            <button
              type="submit"
              disabled={inProgress}
              className="bg-nc-cyan text-nc-black hover:bg-nc-yellow font-bold px-6 py-1.5 text-xs border border-nc-white"
            >
              {inProgress ? 'CREATING...' : '[ CREATE (F7) ]'}
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
