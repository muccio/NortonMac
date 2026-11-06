import React, { useEffect, useRef } from 'react';
import { DirectoryListing, FileEntry, SortConfig, SortField } from '../types';

interface FilePanelProps {
  panelId: 'left' | 'right';
  isActive: boolean;
  listing: DirectoryListing | null;
  selectedIndex: number;
  selectedPaths: Set<string>;
  calculatedSizes: Record<string, number>;
  calculatingPaths: Set<string>;
  sortConfig: SortConfig;
  quickSearch?: { query: string; matched: boolean } | null;
  onSortChange: (field: SortField) => void;
  onSelectIndex: (idx: number) => void;
  onToggleMark: (entry: FileEntry, advanceCursor?: boolean) => void;
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
  calculatedSizes,
  calculatingPaths,
  sortConfig,
  quickSearch,
  onSortChange,
  onSelectIndex,
  onToggleMark,
  onEnter,
  onActivate,
}) => {
  const tableRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Keep active/focused row visible on keyboard navigation and parent directory return
  useEffect(() => {
    const el = rowRefs.current[selectedIndex];
    if (el) {
      el.scrollIntoView({
        block: 'nearest',
        behavior: 'auto',
      });
    }
  }, [selectedIndex, isActive, listing]);

  const formatBytesCompact = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + 'G';
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'M';
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + 'k';
    return bytes.toLocaleString() + ' B';
  };

  const formatSize = (entry: FileEntry) => {
    if (entry.name === '..') return '<UP-DIR>';
    if (calculatingPaths.has(entry.path)) return '⏳ CALC...';
    if (entry.is_dir) {
      if (calculatedSizes[entry.path] !== undefined) {
        return formatBytesCompact(calculatedSizes[entry.path]);
      }
      return '<DIR>';
    }
    return formatBytesCompact(entry.size);
  };

  const formatDiskSpace = (bytes: number) => {
    if (bytes === 0) return '0 B';
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }
    if (bytes >= 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${bytes.toLocaleString()} B`;
  };

  const entries = listing?.entries || [];
  const markedEntries = entries.filter((e) => selectedPaths.has(e.path) && e.name !== '..');
  const selectedCount = markedEntries.length;
  const selectedBytes = markedEntries.reduce((acc, curr) => {
    const sz =
      curr.is_dir && calculatedSizes[curr.path] !== undefined
        ? calculatedSizes[curr.path]
        : curr.size;
    return acc + sz;
  }, 0);
  const anyCalculating = markedEntries.some((e) => calculatingPaths.has(e.path));

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
          <span className={isActive ? 'text-nc-yellow bg-nc-darkblue/80 px-1 rounded-sm' : 'text-nc-yellow'}>
            {listing?.display_path || 'Loading...'}
          </span>
        </div>
        <div className="ml-2 text-[10px] uppercase px-1 bg-nc-darkblue text-nc-white rounded">
          {listing?.volume_name || 'DISK'}
        </div>
      </div>

      {/* Column Headers (Clickable for Sorting) */}
      <div className="bg-nc-darkblue text-nc-brightcyan font-bold grid grid-cols-12 px-2 py-0.5 border-b border-nc-cyan text-[11px]">
        <div className="col-span-5 border-r border-nc-cyan/40 pr-1 flex items-center justify-between gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onActivate();
              onSortChange('name');
            }}
            className={`flex items-center gap-1 hover:text-nc-yellow transition-colors truncate ${
              sortConfig.field === 'name' ? 'text-nc-yellow underline decoration-nc-cyan/70' : ''
            }`}
            title="Ordina per nome (A-Z / Z-A)"
          >
            <span>Name</span>
            {sortConfig.field === 'name' && (
              <span className="text-[10px]">{sortConfig.direction === 'asc' ? '▲' : '▼'}</span>
            )}
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onActivate();
              onSortChange('ext');
            }}
            className={`px-1 rounded text-[10px] hover:text-nc-yellow transition-colors flex-shrink-0 ${
              sortConfig.field === 'ext'
                ? 'bg-nc-cyan/20 text-nc-yellow border border-nc-yellow/60'
                : 'text-nc-cyan/90 hover:bg-nc-cyan/10'
            }`}
            title="Ordina per estensione (.ext)"
          >
            Ext{sortConfig.field === 'ext' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : ''}
          </button>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onActivate();
            onSortChange('size');
          }}
          className={`col-span-2 text-right border-r border-nc-cyan/40 px-1 flex items-center justify-end gap-1 hover:text-nc-yellow transition-colors ${
            sortConfig.field === 'size' ? 'text-nc-yellow underline decoration-nc-cyan/70' : ''
          }`}
          title="Ordina per dimensione"
        >
          <span>Size</span>
          {sortConfig.field === 'size' && (
            <span className="text-[10px]">{sortConfig.direction === 'asc' ? '▲' : '▼'}</span>
          )}
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onActivate();
            onSortChange('modified');
          }}
          className={`col-span-3 text-center border-r border-nc-cyan/40 px-1 flex items-center justify-center gap-1 hover:text-nc-yellow transition-colors ${
            sortConfig.field === 'modified' ? 'text-nc-yellow underline decoration-nc-cyan/70' : ''
          }`}
          title="Ordina per data e ora di modifica"
        >
          <span>Date Time</span>
          {sortConfig.field === 'modified' && (
            <span className="text-[10px]">{sortConfig.direction === 'asc' ? '▲' : '▼'}</span>
          )}
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onActivate();
            onSortChange('permissions');
          }}
          className={`col-span-2 text-center pl-1 flex items-center justify-center gap-1 hover:text-nc-yellow transition-colors ${
            sortConfig.field === 'permissions' ? 'text-nc-yellow underline decoration-nc-cyan/70' : ''
          }`}
          title="Ordina per permessi"
        >
          <span>Perms</span>
          {sortConfig.field === 'permissions' && (
            <span className="text-[10px]">{sortConfig.direction === 'asc' ? '▲' : '▼'}</span>
          )}
        </button>
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
            let itemTextClass = entry.name === '..'
              ? 'text-nc-updir font-bold'
              : entry.is_dir
              ? 'text-nc-dir font-bold'
              : entry.is_archive
              ? 'text-nc-archive font-bold'
              : 'text-nc-file';

            if (isMarked) {
              itemTextClass = 'text-nc-marked font-bold';
            }

            if (isCursor) {
              rowClass = isMarked
                ? 'bg-nc-cursormarkedbg text-nc-cursormarkedtext font-bold'
                : 'bg-nc-cursorbg text-nc-cursortext font-bold';
              itemTextClass = isMarked
                ? 'text-nc-cursormarkedtext font-bold'
                : 'text-nc-cursortext font-bold';
            } else if (!isActive && index === selectedIndex) {
              rowClass = 'border border-dashed border-nc-cyan bg-nc-darkblue/80';
            }

            return (
              <div
                key={entry.path || `${entry.name}-${index}`}
                ref={(el) => {
                  rowRefs.current[index] = el;
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onActivate();
                  onSelectIndex(index);
                  if (e.shiftKey && entry.name !== '..') {
                    onToggleMark(entry, false);
                  }
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onActivate();
                  onEnter(entry);
                }}
                className={`grid grid-cols-12 px-2 py-[2px] items-center text-[11px] leading-tight ${rowClass} ${itemTextClass}`}
              >
                {/* Name */}
                <div className="col-span-5 flex items-center space-x-1 truncate pr-1">
                  {isMarked && (
                    <span className={isCursor ? 'font-black' : 'text-nc-marked font-black'}>
                      ★
                    </span>
                  )}
                  {entry.name === '..' ? (
                    <span className="truncate">▲ [ .. ]</span>
                  ) : entry.is_dir ? (
                    <span className="truncate">📁 [{entry.name}]</span>
                  ) : entry.is_archive ? (
                    <span className="truncate">📦 {entry.name}</span>
                  ) : (
                    <span className="truncate">{entry.name}</span>
                  )}
                </div>

                {/* Size */}
                <div
                  className={`col-span-2 text-right font-mono px-1 ${
                    entry.is_dir && calculatedSizes[entry.path] !== undefined && !isCursor && !isMarked
                      ? 'text-nc-yellow font-bold'
                      : ''
                  }`}
                >
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

      {/* Type-Ahead Quick Jump Indicator */}
      {isActive && quickSearch && quickSearch.query && (
        <div
          className={`absolute bottom-7 left-2 z-20 px-2.5 py-0.5 border-2 shadow-lg font-mono text-xs font-bold flex items-center space-x-1.5 ${
            quickSearch.matched
              ? 'bg-nc-darkblue border-nc-yellow text-nc-yellow'
              : 'bg-nc-red border-nc-white text-nc-white'
          }`}
        >
          <span className={quickSearch.matched ? 'text-nc-brightcyan' : 'text-nc-yellow'}>
            JUMP:
          </span>
          <span>{quickSearch.query}</span>
          <span className="animate-pulse">█</span>
        </div>
      )}

      {/* Bottom Panel Status Bar */}
      <div className="bg-nc-darkblue text-nc-brightcyan px-2 py-0.5 border-t border-nc-cyan flex items-center justify-between text-[11px] font-bold">
        <div className="truncate">
          {selectedCount > 0 ? (
            <span className="text-nc-marked">
              {selectedCount} sel — {formatDiskSpace(selectedBytes)} ({selectedBytes.toLocaleString()} B)
              {anyCalculating ? ' ⏳' : ''}
            </span>
          ) : (
            <span>
              {entries.filter((e) => e.name !== '..').length} items
            </span>
          )}
        </div>
        <div className="text-[10px] text-nc-white flex-shrink-0 ml-2">
          Free: {formatDiskSpace(listing?.free_space || 0)}
        </div>
      </div>
    </div>
  );
};
