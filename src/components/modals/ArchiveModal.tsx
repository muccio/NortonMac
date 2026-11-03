import React, { useState } from 'react';

interface ArchiveModalProps {
  sourceNames: string[];
  currentDir: string;
  onConfirm: (archivePath: string, archiveType: string) => Promise<void>;
  onClose: () => void;
}

export const ArchiveModal: React.FC<ArchiveModalProps> = ({
  sourceNames,
  currentDir,
  onConfirm,
  onClose,
}) => {
  const [archiveName, setArchiveName] = useState('archive.zip');
  const [archiveType, setArchiveType] = useState<'zip' | 'targz'>('zip');
  const [inProgress, setInProgress] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleTypeChange = (type: 'zip' | 'targz') => {
    setArchiveType(type);
    const base = archiveName.replace(/\.(zip|tar\.gz|tgz)$/, '');
    setArchiveName(type === 'zip' ? `${base}.zip` : `${base}.tar.gz`);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!archiveName.trim()) return;

    setInProgress(true);
    setErrorMsg('');
    try {
      const fullPath = `${currentDir.replace(/\/$/, '')}/${archiveName.trim()}`;
      await onConfirm(fullPath, archiveType);
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
          PACK / COMPRESS ARCHIVE
        </div>

        <form onSubmit={handleCreate} className="space-y-3 text-xs">
          <div>
            <span className="text-nc-gray">Packing {sourceNames.length} item(s):</span>
            <div className="text-nc-yellow font-bold truncate max-h-16 overflow-y-auto mt-1 p-1 bg-nc-darkblue border border-nc-cyan/40">
              {sourceNames.join(', ')}
            </div>
          </div>

          <div>
            <label className="block text-nc-brightcyan font-bold mb-1">Archive Format:</label>
            <div className="flex space-x-4">
              <label className="flex items-center space-x-1 cursor-pointer">
                <input
                  type="radio"
                  name="archiveType"
                  checked={archiveType === 'zip'}
                  onChange={() => handleTypeChange('zip')}
                />
                <span>.ZIP (Deflate)</span>
              </label>
              <label className="flex items-center space-x-1 cursor-pointer">
                <input
                  type="radio"
                  name="archiveType"
                  checked={archiveType === 'targz'}
                  onChange={() => handleTypeChange('targz')}
                />
                <span>.TAR.GZ (Gzip)</span>
              </label>
            </div>
          </div>

          <div>
            <label className="block text-nc-brightcyan font-bold mb-1">Archive file name:</label>
            <input
              type="text"
              value={archiveName}
              onChange={(e) => setArchiveName(e.target.value)}
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
              {inProgress ? 'COMPRESSING...' : '[ PACK ARCHIVE ]'}
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
