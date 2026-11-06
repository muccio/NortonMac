import React from 'react';
import { VolumeInfo } from '../../types';

interface MenuModalProps {
  volumes: VolumeInfo[];
  homeDir: string;
  onNavigate: (path: string) => void;
  onDuplicate: () => void;
  onPackArchive: () => void;
  onSelectAll: () => void;
  onInvertSelect: () => void;
  onClearSelect: () => void;
  onOpenSiteManager: () => void;
  onOpenTheme: () => void;
  onClose: () => void;
}

export const MenuModal: React.FC<MenuModalProps> = ({
  volumes,
  homeDir,
  onNavigate,
  onDuplicate,
  onPackArchive,
  onSelectAll,
  onInvertSelect,
  onClearSelect,
  onOpenSiteManager,
  onOpenTheme,
  onClose,
}) => {
  const commonFolders = [
    { label: 'Home (~)', path: homeDir },
    { label: 'Desktop', path: `${homeDir}/Desktop` },
    { label: 'Documents', path: `${homeDir}/Documents` },
    { label: 'Downloads', path: `${homeDir}/Downloads` },
    { label: 'File System Root (/)', path: '/' },
  ];

  return (
    <div className="fixed inset-0 bg-nc-black/80 flex items-center justify-center p-4 z-50 font-mono select-none">
      <div className="bg-nc-blue border-4 border-nc-cyan text-nc-white max-w-lg w-full shadow-2xl p-4">
        <div className="bg-nc-cyan text-nc-black text-center font-bold py-1 text-sm mb-3">
          NORTON COMMANDER MAIN MENU (F2)
        </div>

        <div className="grid grid-cols-2 gap-4 text-xs">
          {/* Quick Locations / Drives */}
          <div className="border border-nc-cyan/50 p-2 bg-nc-darkblue">
            <div className="text-nc-yellow font-bold border-b border-nc-cyan/30 pb-1 mb-2">
              DISKS &amp; VOLUMES
            </div>
            <div className="space-y-1">
              {commonFolders.map((f) => (
                <button
                  key={f.path}
                  onClick={() => {
                    onNavigate(f.path);
                    onClose();
                  }}
                  className="w-full text-left hover:bg-nc-cyan hover:text-nc-black px-1.5 py-0.5 text-nc-white block truncate"
                >
                  📁 {f.label}
                </button>
              ))}

              <div className="border-t border-nc-cyan/30 my-1 pt-1 text-nc-brightcyan font-bold">
                Mounted Drives:
              </div>
              {volumes.map((v) => (
                <button
                  key={v.mount_point}
                  onClick={() => {
                    onNavigate(v.mount_point);
                    onClose();
                  }}
                  className="w-full text-left hover:bg-nc-cyan hover:text-nc-black px-1.5 py-0.5 text-nc-white block truncate"
                >
                  {v.is_removable ? '⏏' : '💾'} {v.name}
                </button>
              ))}
            </div>
          </div>

          {/* Commands & Operations */}
          <div className="border border-nc-cyan/50 p-2 bg-nc-darkblue">
            <div className="text-nc-yellow font-bold border-b border-nc-cyan/30 pb-1 mb-2">
              OPERATIONS
            </div>
            <div className="space-y-1">
              <button
                onClick={() => {
                  onClose();
                  onDuplicate();
                }}
                className="w-full text-left hover:bg-nc-cyan hover:text-nc-black px-1.5 py-1 text-nc-yellow block font-bold"
              >
                📋 Duplicate File / Folder (Cmd+D)
              </button>

              <button
                onClick={() => {
                  onPackArchive();
                  onClose();
                }}
                className="w-full text-left hover:bg-nc-cyan hover:text-nc-black px-1.5 py-1 text-nc-brightcyan block font-bold"
              >
                📦 Pack to Archive (.zip / .tar.gz)
              </button>

              <button
                onClick={() => {
                  onOpenSiteManager();
                  onClose();
                }}
                className="w-full text-left hover:bg-nc-cyan hover:text-nc-black px-1.5 py-1 text-nc-white block font-bold"
              >
                🌐 SFTP / FTP Connect (F9)
              </button>

              <button
                onClick={() => {
                  onOpenTheme();
                  onClose();
                }}
                className="w-full text-left hover:bg-nc-cyan hover:text-nc-black px-1.5 py-1 text-nc-yellow block font-bold"
              >
                🎨 Color &amp; Theme Editor (Cmd+,)
              </button>

              <div className="border-t border-nc-cyan/30 my-2"></div>

              <button
                onClick={() => {
                  onSelectAll();
                  onClose();
                }}
                className="w-full text-left hover:bg-nc-cyan hover:text-nc-black px-1.5 py-0.5 text-nc-white block"
              >
                Select All Files (Numpad *)
              </button>
              <button
                onClick={() => {
                  onInvertSelect();
                  onClose();
                }}
                className="w-full text-left hover:bg-nc-cyan hover:text-nc-black px-1.5 py-0.5 text-nc-white block"
              >
                Invert Selection
              </button>
              <button
                onClick={() => {
                  onClearSelect();
                  onClose();
                }}
                className="w-full text-left hover:bg-nc-cyan hover:text-nc-black px-1.5 py-0.5 text-nc-white block"
              >
                Clear Selection
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 text-center">
          <button
            onClick={onClose}
            className="bg-nc-darkblue text-nc-white hover:bg-nc-red font-bold px-6 py-1 text-xs border border-nc-cyan"
          >
            [ CLOSE MENU (ESC) ]
          </button>
        </div>
      </div>
    </div>
  );
};
