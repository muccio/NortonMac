import React from 'react';

interface HelpModalProps {
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 bg-nc-black/80 flex items-center justify-center p-4 z-50 font-mono select-none">
      <div className="bg-nc-blue border-4 border-nc-cyan text-nc-white max-w-2xl w-full shadow-2xl p-4">
        {/* Title */}
        <div className="bg-nc-cyan text-nc-black text-center font-bold py-1 text-sm mb-3">
          NORTON COMMANDER 5.5 FOR macOS - HELP &amp; SHORTCUTS
        </div>

        <div className="space-y-3 text-xs max-h-[70vh] overflow-y-auto pr-2">
          <div>
            <h3 className="text-nc-yellow font-bold border-b border-nc-cyan/50 pb-0.5">
              1. PANE NAVIGATION &amp; SELECTION
            </h3>
            <ul className="mt-1 space-y-1 text-nc-white">
              <li><span className="text-nc-brightcyan font-bold">Tab</span> : Switch focus between Left and Right panel</li>
              <li><span className="text-nc-brightcyan font-bold">↑ / ↓</span> : Navigate file list up and down</li>
              <li><span className="text-nc-brightcyan font-bold">Enter</span> : Open directory, enter Virtual Archive (.zip/.tar.gz), or execute</li>
              <li><span className="text-nc-brightcyan font-bold">Backspace / ..</span> : Move up to parent directory (positions cursor on the exited folder)</li>
              <li><span className="text-nc-brightcyan font-bold">Space / Insert</span> : Mark / unmark item &amp; calculate directory recursive size</li>
              <li><span className="text-nc-brightcyan font-bold">Cmd + .</span> : Toggle macOS Unix dotfiles and hidden files</li>
              <li><span className="text-nc-brightcyan font-bold">Cmd + ,</span> : Open GUI, Cursor &amp; Selection Color Editor</li>
            </ul>
          </div>

          <div>
            <h3 className="text-nc-yellow font-bold border-b border-nc-cyan/50 pb-0.5">
              2. FUNCTION KEYS (F1 - F10 / Fn + F1 - F10)
            </h3>
            <div className="grid grid-cols-2 gap-1 mt-1 text-nc-white">
              <div><span className="text-nc-brightcyan font-bold">F1 Help</span> : Show this manual</div>
              <div><span className="text-nc-brightcyan font-bold">F2 Menu</span> : Menu &amp; Drive Selector</div>
              <div><span className="text-nc-brightcyan font-bold">F3 View</span> : Fast File &amp; Hex Viewer</div>
              <div><span className="text-nc-brightcyan font-bold">F4 Edit</span> : Integrated Text Editor</div>
              <div><span className="text-nc-brightcyan font-bold">F5 Copy</span> : Copy to opposite panel</div>
              <div><span className="text-nc-brightcyan font-bold">F6 Ren/Move</span> : Move or Rename</div>
              <div><span className="text-nc-brightcyan font-bold">F7 MkDir</span> : Create New Directory</div>
              <div><span className="text-nc-brightcyan font-bold">F8 Delete</span> : Trash or Permanent Delete</div>
              <div><span className="text-nc-brightcyan font-bold">F9 Connect</span> : SFTP &amp; FTP Site Manager</div>
              <div><span className="text-nc-brightcyan font-bold">F10 Quit</span> : Exit Norton Commander</div>
            </div>
          </div>

          <div>
            <h3 className="text-nc-yellow font-bold border-b border-nc-cyan/50 pb-0.5">
              3. VIRTUAL FILESYSTEM (VFS) &amp; ARCHIVES
            </h3>
            <p className="mt-1 text-nc-gray">
              Press <span className="text-nc-white">Enter</span> on any <span className="text-nc-yellow">.zip, .tar, .tar.gz, .tgz, .tar.bz2</span> file. Norton Commander opens it as a virtual folder without decompressing to disk. You can view (F3) files directly and copy (F5) selected files out of the archive!
            </p>
          </div>

          <div>
            <h3 className="text-nc-yellow font-bold border-b border-nc-cyan/50 pb-0.5">
              4. REMOTE SFTP / FTP CLIENT
            </h3>
            <p className="mt-1 text-nc-gray">
              Press <span className="text-nc-white">F9</span> to open the Site Manager. Connect to any server; the remote filesystem mounts seamlessly into the active panel. Copy (F5) uploads or downloads files between Mac and remote hosts.
            </p>
          </div>
        </div>

        {/* Close Button */}
        <div className="mt-4 text-center">
          <button
            onClick={onClose}
            className="bg-nc-cyan text-nc-black hover:bg-nc-yellow font-bold px-6 py-1 text-xs border border-nc-white"
          >
            [ OK / CLOSE (ESC) ]
          </button>
        </div>
      </div>
    </div>
  );
};
