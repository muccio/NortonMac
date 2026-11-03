import React, { useEffect, useRef } from 'react';
import { DirectoryListing, FileEntry } from '../types';

interface FilePanelProps {
  panelId: 'left' | 'right';
  isActive: boolean;
  listing: DirectoryListing | null;
  selectedIndex: number;
  selectedPaths: Set<string>;
  onSelectIndex: (idx: number) => void;
  onToggleMark: (path: string) => void;
  onEnter: (entry: FileEntry) => void;
  onActivate: () => void;
  onNavigateTo?: (path: string) => void;
}

export const FilePanel: React.FC<FilePanelProps> = ({
  panelId,
  isActive,
  listing,
  selectedIndex,
  selectedPaths,
  onSelectIndex,
  onToggleMark,
  onEnter,
  onActivate,
}) => {
  const tableRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  // Keep active row visible on keyboard navigation
  useEffect(() => {
    if (isActive && rowRefs.current[selectedIndex]) {
      rowRefs.current[selectedIndex]?.scrollIntoView({
        block: 'nearest',
        behavior: 'auto',
      });
    }
  }, [selectedIndex, isActive]);

  const formatSize = (entry: FileEntry) => {
    if (entry.is_dir) return '<UP-DIR>';
    if (entry.name === '..') return '<UP-DIR>';
    const bytes = entry.size;
    if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'G';
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'M';
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + 'k';
    return bytes.toLocaleString();
  };

  const formatDiskSpace = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(0)} MB`;
  };

  const entries = listing?.entries || [];
  const selectedCount = selectedPaths.size;
  const selectedBytes = entries
    .filter((e) => selectedPaths.has(e.path))
    .reduce((acc, curr) => acc + curr.size, 0);

  const borderColor = isActive ? 'border-nc-brightcyan' : 'border-nc-cyan';
  const headerBg = isActive ? 'bg-nc-cyan text-nc-black' : 'bg-nc-darkblue text-nc-cyan';

  return (
    <div
      onClick={onActivate}
      className={`flex-1 flex flex-col h-full bg-nc-blue border-2 ${borderColor} font-mono text-xs select-none overflow-hidden relative shadow-inner`}
    >
      {/* Top Header Bar */}
      <div className={`${headerBg} px-2 py-0.5 font-bold flex items-center justify-between border-b border-nc-cyan`}>
        <div className="truncate flex-1 font-bold" title={listing?.display_path || ''}>
          {panelId === 'left' ? 'LEFT: ' : 'RIGHT: '}
          <span className="text-nc-yellow">{listing?.display_path || 'Loading...'}</span>
        </div>
        <div className="ml-2 text-[10px] uppercase px-1 bg-nc-darkblue text-nc-white rounded">
          {listing?.volume_name || 'DISK'}
        </div>
      </div>

      {/* Column Headers */}
      <div className="bg-nc-darkblue text-nc-brightcyan font-bold grid grid-cols-12 px-2 py-0.5 border-b border-nc-cyan text-[11px]">
        <div className="col-span-5 border-r border-nc-cyan/40 pr-1">Name</div>
        <div className="col-span-2 text-right border-r border-nc-cyan/40 px-1">Size</div>
        <div className="col-span-3 text-center border-r border-nc-cyan/40 px-1">Date Time</div>
        <div className="col-span-2 text-center pl-1">Perms</div>
      </div>

      {/* File List Body */}
      <div
        ref={tableRef}
        className="flex-1 overflow-y-auto overflow-x-hidden focus:outline-none divide-y divide-transparent"
        tabIndex={-1}
      >
        {entries.length === 0 ? (
          <div className="p-4 text-center text-nc-gray italic">
            Directory is empty
          </div>
        ) : (
          entries.map((entry, index) => {
            const isCursor = index === selectedIndex && isActive;
            const isMarked = selectedPaths.has(entry.path);

            let rowClass = 'hover:bg-nc-darkblue/70 cursor-pointer ';
            let textClass = 'text-nc-white';

            if (isMarked) {
              textClass = 'text-nc-yellow font-bold';
            }

            if (isCursor) {
              rowClass = isMarked
                ? 'bg-nc-brightcyan text-nc-red font-bold'
                : 'bg-nc-cyan text-nc-black font-bold';
              textClass = isMarked ? 'text-nc-red' : 'text-nc-black';
            } else if (!isActive && index === selectedIndex) {
              rowClass = 'border border-dashed border-nc-cyan bg-nc-darkblue';
            }

            return (
              <div
                key={entry.path || `${entry.name}-${index}`}
                ref={(el) => (rowRefs.current[index] = el as any)}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectIndex(index);
                  if (e.shiftKey) {
                    onToggleMark(entry.path);
                  }
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onEnter(entry);
                }}
                className={`grid grid-cols-12 px-2 py-[2px] items-center text-[11px] leading-tight ${rowClass} ${textClass}`}
              >
                {/* Name */}
                <div className="col-span-5 flex items-center space-x-1 truncate pr-1">
                  {isMarked && <span className="text-nc-yellow font-black">★</span>}
                  {entry.name === '..' ? (
                    <span className="font-bold text-nc-brightcyan">▲ [ .. ]</span>
                  ) : entry.is_dir ? (
                    <span className="font-bold text-nc-white">
                      📁 [{entry.name}]
                    </span>
                  ) : entry.is_archive ? (
                    <span className="font-bold text-nc-brightcyan">
                      📦 {entry.name}
                    </span>
                  ) : (
                    <span className="truncate">{entry.name}</span>
                  )}
                </div>

                {/* Size */}
                <div className="col-span-2 text-right font-mono px-1">
                  {formatSize(entry)}
                </div>

                {/* Date & Time */}
                <div className="col-span-3 text-center font-mono text-[10px] px-1 opacity-90">
                  {entry.modified || '-'}
                </div>

                {/* Permissions */}
                <div className="col-span-2 text-center font-mono text-[10px] pl-1 opacity-80">
                  {entry.permissions || '-'}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Bottom Panel Status Bar */}
      <div className="bg-nc-darkblue text-nc-brightcyan px-2 py-0.5 border-t border-nc-cyan flex items-center justify-between text-[11px] font-bold">
        <div className="truncate">
          {selectedCount > 0 ? (
            <span className="text-nc-yellow">
              {selectedCount} selected ({formatDiskSpace(selectedBytes)})
            </span>
          ) : (
            <span>
              {entries.filter((e) => e.name !== '..').length} items
            </span>
          )}
        </div>
        <div className="text-[10px] text-nc-white">
          Free: {formatDiskSpace(listing?.free_space || 0)}
        </div>
      </div>
    </div>
  );
};
