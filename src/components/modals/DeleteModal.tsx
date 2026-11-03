import React, { useState } from 'react';

interface DeleteModalProps {
  names: string[];
  onConfirm: (permanent: boolean) => Promise<void>;
  onClose: () => void;
}

export const DeleteModal: React.FC<DeleteModalProps> = ({
  names,
  onConfirm,
  onClose,
}) => {
  const [permanent, setPermanent] = useState(false);
  const [inProgress, setInProgress] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleDelete = async () => {
    setInProgress(true);
    setErrorMsg('');
    try {
      await onConfirm(permanent);
      onClose();
    } catch (err: any) {
      setErrorMsg(String(err));
    } finally {
      setInProgress(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-nc-black/80 flex items-center justify-center p-4 z-50 font-mono select-none">
      <div className="bg-nc-blue border-4 border-nc-brightred text-nc-white max-w-md w-full shadow-2xl p-4">
        <div className="bg-nc-red text-nc-white text-center font-bold py-1 text-sm mb-3">
          DELETE CONFIRMATION
        </div>

        <div className="space-y-3 text-xs">
          <p className="text-nc-white">
            Do you want to delete <span className="text-nc-yellow font-bold">{names.length}</span> item(s)?
          </p>

          <div className="text-nc-yellow font-bold truncate max-h-20 overflow-y-auto p-1 bg-nc-darkblue border border-nc-cyan/40">
            {names.join(', ')}
          </div>

          <div className="space-y-2 pt-1 border-t border-nc-cyan/40">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="radio"
                name="deleteMode"
                checked={!permanent}
                onChange={() => setPermanent(false)}
                className="cursor-pointer"
              />
              <span className="text-nc-brightgreen font-bold">
                Move to macOS Trash (Safest, recoverable)
              </span>
            </label>

            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="radio"
                name="deleteMode"
                checked={permanent}
                onChange={() => setPermanent(true)}
                className="cursor-pointer"
              />
              <span className="text-nc-brightred font-bold">
                Delete Permanently (Cannot be undone)
              </span>
            </label>
          </div>

          {errorMsg && (
            <div className="p-1.5 bg-nc-red text-nc-white font-bold text-center">
              {errorMsg}
            </div>
          )}

          <div className="flex justify-center space-x-4 pt-3">
            <button
              onClick={handleDelete}
              disabled={inProgress}
              className="bg-nc-red text-nc-white hover:bg-nc-brightred font-bold px-6 py-1.5 text-xs border border-nc-white"
            >
              {inProgress ? 'DELETING...' : '[ DELETE (F8) ]'}
            </button>
            <button
              onClick={onClose}
              disabled={inProgress}
              className="bg-nc-darkblue text-nc-white hover:bg-nc-yellow hover:text-nc-black font-bold px-6 py-1.5 text-xs border border-nc-cyan"
            >
              [ CANCEL (ESC) ]
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
