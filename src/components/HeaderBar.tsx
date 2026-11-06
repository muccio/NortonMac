import React from 'react';
import { VolumeInfo } from '../types';

interface HeaderBarProps {
  volumes: VolumeInfo[];
  currentVolume: string;
  showHidden: boolean;
  onToggleHidden: () => void;
  onOpenMenu: () => void;
  onOpenTheme: () => void;
  onDuplicate?: () => void;
  onSelectVolume: (mountPoint: string) => void;
  onRefreshVolumes?: () => void;
}

function formatVolFree(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return ` — ${gb.toFixed(1)}G free`;
  const mb = bytes / (1024 * 1024);
  return ` — ${mb.toFixed(0)}M free`;
}

function resolveCurrentMountPoint(currentPath: string, volumes: VolumeInfo[]): string {
  if (
    !currentPath ||
    currentPath.startsWith('ftp://') ||
    currentPath.startsWith('ftps://') ||
    currentPath.startsWith('sftp://') ||
    currentPath.startsWith('archive://')
  ) {
    return '__virtual__';
  }

  let bestMount = '/';
  let bestLen = 0;

  for (const v of volumes) {
    const mp = v.mount_point;
    if (mp === '/') {
      if (bestLen === 0) {
        bestMount = '/';
        bestLen = 1;
      }
      continue;
    }
    if (currentPath === mp || currentPath.startsWith(`${mp}/`)) {
      if (mp.length > bestLen) {
        bestMount = mp;
        bestLen = mp.length;
      }
    }
  }

  return bestMount;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  volumes,
  currentVolume,
  showHidden,
  onToggleHidden,
  onOpenMenu,
  onOpenTheme,
  onDuplicate,
  onSelectVolume,
  onRefreshVolumes,
}) => {
  const selectedMount = resolveCurrentMountPoint(currentVolume, volumes);

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
          onClick={onOpenTheme}
          className="hover:bg-nc-darkblue hover:text-nc-brightcyan px-2 py-0.5 rounded uppercase"
          title="Color & Theme Editor (Cmd+,)"
        >
          <span className="text-nc-red">C</span>olors
        </button>
        <button
          onClick={onOpenMenu}
          className="hover:bg-nc-darkblue hover:text-nc-brightcyan px-2 py-0.5 rounded uppercase"
          title="F2 Menu"
        >
          <span className="text-nc-red">D</span>rives
        </button>
      </div>

      <div className="flex items-center space-x-2">
        {/* Drive selector dropdown */}
        <div className="flex items-center space-x-1">
          <span className="text-nc-blue font-black">DISK:</span>
          <select
            value={selectedMount}
            onMouseDown={() => onRefreshVolumes?.()}
            onFocus={() => onRefreshVolumes?.()}
            onChange={(e) => {
              const val = e.target.value;
              if (val && val !== '__virtual__') {
                onSelectVolume(val);
              }
            }}
            className="bg-nc-darkblue text-nc-brightcyan text-xs px-1.5 py-0.5 border border-nc-cyan outline-none cursor-pointer max-w-[260px] truncate"
          >
            {selectedMount === '__virtual__' && (
              <option value="__virtual__" disabled>
                🌐 Remote / Archive
              </option>
            )}
            {volumes.map((v) => (
              <option key={v.mount_point} value={v.mount_point}>
                {v.is_removable ? '⏏ ' : '💾 '}
                {v.name} ({v.mount_point}){formatVolFree(v.available_space)}
              </option>
            ))}
          </select>
        </div>

        {/* Duplicate item shortcut */}
        {onDuplicate && (
          <button
            onClick={onDuplicate}
            className="px-2 py-0.5 font-bold border bg-nc-darkblue text-nc-brightcyan border-nc-cyan hover:bg-nc-yellow hover:text-nc-black transition-colors"
            title="Duplica file o cartella in locale o su FTP/SFTP (Cmd + D / Shift + F5)"
          >
            📋 DUP (Cmd+D)
          </button>
        )}

        {/* Color / Theme Editor shortcut */}
        <button
          onClick={onOpenTheme}
          className="px-2 py-0.5 font-bold border bg-nc-darkblue text-nc-yellow border-nc-cyan hover:bg-nc-yellow hover:text-nc-black transition-colors"
          title="Personalizza Colori GUI & Selezione (Cmd + ,)"
        >
          🎨 COLORS
        </button>

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
