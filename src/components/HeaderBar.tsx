import React from 'react';
import { VolumeInfo } from '../types';

interface HeaderBarProps {
  volumes: VolumeInfo[];
  currentVolume: string;
  showHidden: boolean;
  onToggleHidden: () => void;
  onOpenMenu: () => void;
  onSelectVolume: (mountPoint: string) => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  volumes,
  currentVolume,
  showHidden,
  onToggleHidden,
  onOpenMenu,
  onSelectVolume,
}) => {
  return (
    <div className="bg-nc-cyan text-nc-black px-2 py-0.5 flex items-center justify-between font-mono text-xs font-bold border-b border-nc-brightcyan select-none">
      <div className="flex items-center space-x-4">
        <button
          onClick={onOpenMenu}
          className="hover:bg-nc-darkblue hover:text-nc-brightcyan px-2 py-0.5 rounded uppercase"
          title="F2 Menu"
        >
          <span className="text-nc-red">F</span>iles
        </button>
        <button
          onClick={onOpenMenu}
          className="hover:bg-nc-darkblue hover:text-nc-brightcyan px-2 py-0.5 rounded uppercase"
          title="F2 Menu"
        >
          <span className="text-nc-red">C</span>ommands
        </button>
        <button
          onClick={onOpenMenu}
          className="hover:bg-nc-darkblue hover:text-nc-brightcyan px-2 py-0.5 rounded uppercase"
          title="F2 Menu"
        >
          <span className="text-nc-red">O</span>ptions
        </button>
        <button
          onClick={onOpenMenu}
          className="hover:bg-nc-darkblue hover:text-nc-brightcyan px-2 py-0.5 rounded uppercase"
          title="F2 Menu"
        >
          <span className="text-nc-red">D</span>rives
        </button>
      </div>

      <div className="flex items-center space-x-3">
        {/* Drive selector dropdown */}
        <div className="flex items-center space-x-1">
          <span className="text-nc-blue">DISK:</span>
          <select
            value={currentVolume}
            onChange={(e) => onSelectVolume(e.target.value)}
            className="bg-nc-darkblue text-nc-brightcyan text-xs px-1 border border-nc-cyan outline-none cursor-pointer"
          >
            {volumes.map((v) => (
              <option key={v.mount_point} value={v.mount_point}>
                {v.is_removable ? '⏏ ' : '💾 '} {v.name} ({v.mount_point})
              </option>
            ))}
          </select>
        </div>

        {/* Hidden files badge toggle */}
        <button
          onClick={onToggleHidden}
          className={`px-2 py-0.5 font-bold border transition-colors ${
            showHidden
              ? 'bg-nc-yellow text-nc-black border-nc-black'
              : 'bg-nc-darkblue text-nc-gray border-nc-cyan hover:text-nc-white'
          }`}
          title="Toggle Hidden Files (Cmd + . or Ctrl + H)"
        >
          DOTFILES: {showHidden ? 'SHOW (Cmd+.)' : 'HIDE (Cmd+.)'}
        </button>

        <span className="text-nc-black hidden sm:inline">
          NC 5.5 for macOS
        </span>
      </div>
    </div>
  );
};
