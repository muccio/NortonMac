import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { listen } from '@tauri-apps/api/event';
import { api } from './api';
import { DirectoryListing, FileEntry, SortConfig, SortField, VolumeInfo } from './types';
import {
  ThemeColors,
  applyThemeToDocument,
  loadSavedTheme,
  saveThemeToStorage,
} from './theme';
import { HeaderBar } from './components/HeaderBar';
import { FilePanel } from './components/FilePanel';
import { FunctionBar } from './components/FunctionBar';
import { ShellPrompt } from './components/ShellPrompt';
import { HelpModal } from './components/modals/HelpModal';
import { MenuModal } from './components/modals/MenuModal';
import { ViewModal } from './components/modals/ViewModal';
import { EditModal } from './components/modals/EditModal';
import { CopyMoveModal } from './components/modals/CopyMoveModal';
import { MkDirModal } from './components/modals/MkDirModal';
import { DeleteModal } from './components/modals/DeleteModal';
import { SiteManagerModal } from './components/modals/SiteManagerModal';
import { ArchiveModal } from './components/modals/ArchiveModal';
import { ThemeModal } from './components/modals/ThemeModal';
import { DuplicateModal } from './components/modals/DuplicateModal';

interface PendingFocus {
  targetPath?: string;
  targetName?: string;
  resetToTop?: boolean;
}

function getExitedChildInfo(fromPath: string): { targetPath: string; targetName: string } {
  if (fromPath.startsWith('archive://')) {
    const withoutScheme = fromPath.slice('archive://'.length);
    const [archFile, sub = ''] = withoutScheme.split('#');
    const cleanSub = sub.replace(/^\/+|\/+$/g, '');
    if (!cleanSub) {
      // Exiting root of archive back to parent folder on disk -> focus the archive file!
      const cleanArch = archFile.replace(/\/+$/, '');
      return {
        targetPath: cleanArch,
        targetName: cleanArch.split('/').pop() || '',
      };
    }
    // Moving up one folder inside virtual archive
    const subParts = cleanSub.split('/');
    return {
      targetPath: `archive://${archFile}#${cleanSub}`,
      targetName: subParts[subParts.length - 1] || '',
    };
  }

  const trimmed = fromPath.replace(/\/+$/, '');
  const name = trimmed.split('/').pop() || '';
  return {
    targetPath: trimmed,
    targetName: name,
  };
}

function resolveQuickJump(
  entries: FileEntry[],
  rawQuery: string,
  currentIndex: number
): { matchIndex: number; effectiveQuery: string } {
  const q = rawQuery.toLowerCase();
  if (!q || entries.length === 0) {
    return { matchIndex: -1, effectiveQuery: rawQuery };
  }

  // 1. Direct case-insensitive prefix match (skipping '..')
  const exactIdx = entries.findIndex(
    (en) => en.name !== '..' && en.name.toLowerCase().startsWith(q)
  );
  if (exactIdx >= 0) {
    return { matchIndex: exactIdx, effectiveQuery: rawQuery };
  }

  // 2. Repeated single letter (e.g. pressing 'd', 'd', 'd') cycles through items starting with 'd'
  if (q.length >= 2 && q.split('').every((ch) => ch === q[0])) {
    const firstChar = q[0];
    const candidates: number[] = [];
    entries.forEach((en, idx) => {
      if (en.name !== '..' && en.name.toLowerCase().startsWith(firstChar)) {
        candidates.push(idx);
      }
    });
    if (candidates.length > 0) {
      const nextAfterCurrent = candidates.find((idx) => idx > currentIndex);
      const chosen = nextAfterCurrent !== undefined ? nextAfterCurrent : candidates[0];
      return { matchIndex: chosen, effectiveQuery: rawQuery[0] };
    }
  }

  // 3. Fallback for visible dotfiles (e.g. typing 'git' matches '.gitignore')
  const dotIdx = entries.findIndex(
    (en) =>
      en.name !== '..' &&
      en.name.startsWith('.') &&
      en.name.slice(1).toLowerCase().startsWith(q)
  );
  if (dotIdx >= 0) {
    return { matchIndex: dotIdx, effectiveQuery: rawQuery };
  }

  return { matchIndex: -1, effectiveQuery: rawQuery };
}

function sortDirectoryEntries(
  entries: FileEntry[],
  sort: SortConfig,
  calculatedSizes: Record<string, number>
): FileEntry[] {
  if (entries.length <= 1) return entries;
  const dirMul = sort.direction === 'asc' ? 1 : -1;

  return [...entries].sort((a, b) => {
    // 1. Always keep '..' pinned at the top
    if (a.name === '..') return -1;
    if (b.name === '..') return 1;

    // 2. Keep directories grouped above files (classic Norton Commander layout)
    if (a.is_dir !== b.is_dir) {
      return a.is_dir ? -1 : 1;
    }

    let cmp = 0;
    switch (sort.field) {
      case 'size': {
        const sizeA = a.is_dir
          ? calculatedSizes[a.path] !== undefined
            ? calculatedSizes[a.path]
            : -1
          : a.size;
        const sizeB = b.is_dir
          ? calculatedSizes[b.path] !== undefined
            ? calculatedSizes[b.path]
            : -1
          : b.size;
        if (sizeA !== sizeB) {
          cmp = sizeA < sizeB ? -1 : 1;
        }
        break;
      }
      case 'modified': {
        const modA = a.modified && a.modified !== '-' ? a.modified : '';
        const modB = b.modified && b.modified !== '-' ? b.modified : '';
        if (modA !== modB) {
          cmp = modA < modB ? -1 : 1;
        }
        break;
      }
      case 'ext': {
        const extA = (a.extension || '').toLowerCase();
        const extB = (b.extension || '').toLowerCase();
        cmp = extA.localeCompare(extB, undefined, { numeric: true, sensitivity: 'base' });
        break;
      }
      case 'permissions': {
        const permA = a.permissions || '';
        const permB = b.permissions || '';
        cmp = permA.localeCompare(permB);
        break;
      }
      case 'name':
      default: {
        cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        break;
      }
    }

    if (cmp !== 0) {
      return cmp * dirMul;
    }

    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}

export const App: React.FC = () => {
  const [activePane, setActivePane] = useState<'left' | 'right'>('left');
  const [volumes, setVolumes] = useState<VolumeInfo[]>([]);
  const [homeDir, setHomeDir] = useState<string>('');

  // Theme State
  const [themeColors, setThemeColors] = useState<ThemeColors>(() => loadSavedTheme());
  const [themeOpen, setThemeOpen] = useState(false);

  // Left Panel State
  const [leftPath, setLeftPath] = useState<string>('');
  const [leftListing, setLeftListing] = useState<DirectoryListing | null>(null);
  const [leftIndex, setLeftIndex] = useState<number>(0);
  const [leftSelected, setLeftSelected] = useState<Set<string>>(new Set());
  const [leftShowHidden, setLeftShowHidden] = useState<boolean>(false);
  const [leftSort, setLeftSort] = useState<SortConfig>({ field: 'name', direction: 'asc' });

  // Right Panel State
  const [rightPath, setRightPath] = useState<string>('');
  const [rightListing, setRightListing] = useState<DirectoryListing | null>(null);
  const [rightIndex, setRightIndex] = useState<number>(0);
  const [rightSelected, setRightSelected] = useState<Set<string>>(new Set());
  const [rightShowHidden, setRightShowHidden] = useState<boolean>(false);
  const [rightSort, setRightSort] = useState<SortConfig>({ field: 'name', direction: 'asc' });

  // Calculated directory/item sizes (triggered by Spacebar / Selection)
  const [calculatedSizes, setCalculatedSizes] = useState<Record<string, number>>({});
  const [calculatingPaths, setCalculatingPaths] = useState<Set<string>>(new Set());

  // Refs for keeping focus index aligned with active sort during async refreshes
  const leftSortRef = useRef<SortConfig>(leftSort);
  leftSortRef.current = leftSort;
  const rightSortRef = useRef<SortConfig>(rightSort);
  rightSortRef.current = rightSort;
  const calculatedSizesRef = useRef<Record<string, number>>(calculatedSizes);
  calculatedSizesRef.current = calculatedSizes;

  // Type-ahead Quick Jump state
  const [quickSearch, setQuickSearch] = useState<{ query: string; matched: boolean }>({
    query: '',
    matched: true,
  });
  const quickSearchTimerRef = useRef<number | null>(null);

  const clearQuickSearch = useCallback(() => {
    if (quickSearchTimerRef.current !== null) {
      window.clearTimeout(quickSearchTimerRef.current);
      quickSearchTimerRef.current = null;
    }
    setQuickSearch((prev) => (prev.query ? { query: '', matched: true } : prev));
  }, []);

  const scheduleQuickSearchReset = useCallback(() => {
    if (quickSearchTimerRef.current !== null) {
      window.clearTimeout(quickSearchTimerRef.current);
    }
    quickSearchTimerRef.current = window.setTimeout(() => {
      quickSearchTimerRef.current = null;
      setQuickSearch({ query: '', matched: true });
    }, 1500);
  }, []);

  // Pending cursor target when navigating up/down directories
  const pendingFocusRef = useRef<{ left: PendingFocus | null; right: PendingFocus | null }>({
    left: null,
    right: null,
  });

  // Modals
  const [helpOpen, setHelpOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [siteManagerOpen, setSiteManagerOpen] = useState(false);
  const [viewState, setViewState] = useState<{ open: boolean; preview: any; loading: boolean }>({
    open: false,
    preview: null,
    loading: false,
  });
  const [editState, setEditState] = useState<{ open: boolean; filename: string; path: string; content: string }>({
    open: false,
    filename: '',
    path: '',
    content: '',
  });
  const [copyMoveState, setCopyMoveState] = useState<{
    open: boolean;
    mode: 'copy' | 'move';
    sources: string[];
    sourceNames: string[];
    defaultDest: string;
  }>({
    open: false,
    mode: 'copy',
    sources: [],
    sourceNames: [],
    defaultDest: '',
  });
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [deleteState, setDeleteState] = useState<{ open: boolean; paths: string[]; names: string[] }>({
    open: false,
    paths: [],
    names: [],
  });
  const [archiveState, setArchiveState] = useState<{
    open: boolean;
    sources: string[];
    sourceNames: string[];
    currentDir: string;
  }>({
    open: false,
    sources: [],
    sourceNames: [],
    currentDir: '',
  });
  const [duplicateState, setDuplicateState] = useState<{
    open: boolean;
    items: FileEntry[];
    currentDir: string;
  }>({
    open: false,
    items: [],
    currentDir: '',
  });

  const [errorAlert, setErrorAlert] = useState<{ open: boolean; title: string; message: string }>({
    open: false,
    title: '',
    message: '',
  });

  // Apply persisted theme CSS variables immediately
  useEffect(() => {
    applyThemeToDocument(themeColors);
  }, [themeColors]);

  const refreshVolumes = useCallback(async () => {
    try {
      const vols = await api.getVolumes();
      setVolumes(vols);
    } catch (e) {
      console.warn('Failed to refresh volumes:', e);
    }
  }, []);

  // Initial load
  useEffect(() => {
    const init = async () => {
      try {
        const home = await api.getHomeDirectory();
        setHomeDir(home);
        setLeftPath(home);
        setRightPath(`${home}/Downloads`);

        const vols = await api.getVolumes();
        setVolumes(vols);
      } catch (e) {
        console.error('Initialization error:', e);
      }
    };
    init();
  }, []);

  // Real-time external disk mount/unmount subscription + window focus sync
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;

    listen<VolumeInfo[]>('volumes-changed', (event) => {
      setVolumes(event.payload);
    })
      .then((unlisten) => {
        unlistenFn = unlisten;
      })
      .catch((err) => {
        console.warn('Volume event listener fallback:', err);
      });

    const onFocus = () => {
      refreshVolumes();
    };
    window.addEventListener('focus', onFocus);

    return () => {
      if (unlistenFn) unlistenFn();
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshVolumes]);

  // Handle unplugged external drives gracefully if a panel was inside /Volumes/<Drive>
  useEffect(() => {
    if (!homeDir || volumes.length === 0) return;

    const isStillMounted = (p: string) => {
      if (!p.startsWith('/Volumes/') || p === '/Volumes') return true;
      return volumes.some(
        (v) => v.mount_point !== '/' && (p === v.mount_point || p.startsWith(`${v.mount_point}/`))
      );
    };

    if (leftPath && !isStillMounted(leftPath)) {
      pendingFocusRef.current.left = { resetToTop: true };
      setLeftSelected(new Set());
      setLeftPath(homeDir);
    }
    if (rightPath && !isStillMounted(rightPath)) {
      pendingFocusRef.current.right = { resetToTop: true };
      setRightSelected(new Set());
      setRightPath(homeDir);
    }
  }, [volumes, leftPath, rightPath, homeDir]);

  // Trigger async recursive size calculation on item/directory
  const triggerSizeCalculation = useCallback((entry: FileEntry) => {
    if (entry.name === '..') return;
    if (!entry.is_dir) {
      setCalculatedSizes((prev) => ({ ...prev, [entry.path]: entry.size }));
      return;
    }

    setCalculatingPaths((prev) => {
      const next = new Set(prev);
      next.add(entry.path);
      return next;
    });

    api
      .calculateItemSize(entry.path)
      .then((bytes) => {
        setCalculatedSizes((prev) => ({ ...prev, [entry.path]: bytes }));
      })
      .catch((err) => {
        console.warn('Size calculation error:', err);
      })
      .finally(() => {
        setCalculatingPaths((prev) => {
          const next = new Set(prev);
          next.delete(entry.path);
          return next;
        });
      });
  }, []);

  // Refresh left panel
  const refreshLeft = useCallback(async (path?: string) => {
    const targetPath = path || leftPath;
    if (!targetPath) return;
    try {
      const listing = await api.listDirectory(targetPath, leftShowHidden);
      const pending = pendingFocusRef.current.left;
      pendingFocusRef.current.left = null;

      setLeftListing(listing);

      const sortedEntries = sortDirectoryEntries(
        listing.entries,
        leftSortRef.current,
        calculatedSizesRef.current
      );

      if (pending?.targetPath || pending?.targetName) {
        const matchIdx = sortedEntries.findIndex(
          (e) =>
            (pending.targetPath && e.path === pending.targetPath) ||
            (pending.targetName && e.name === pending.targetName)
        );
        setLeftIndex(matchIdx >= 0 ? matchIdx : 0);
      } else if (pending?.resetToTop) {
        setLeftIndex(0);
      } else {
        setLeftIndex((prev) => Math.min(prev, Math.max(0, sortedEntries.length - 1)));
      }
    } catch (err: any) {
      pendingFocusRef.current.left = null;
      console.error('Failed to list left directory:', err);
      const msg = typeof err === 'string' ? err : err?.message || JSON.stringify(err);
      setErrorAlert({
        open: true,
        title: 'DIRECTORY READ ERROR',
        message: `Failed to open directory:\n${targetPath}\n\n${msg}`,
      });
      if (
        targetPath.startsWith('ftp://') ||
        targetPath.startsWith('ftps://') ||
        targetPath.startsWith('sftp://') ||
        targetPath.startsWith('/Volumes/')
      ) {
        setLeftPath(homeDir);
      }
    }
  }, [leftPath, leftShowHidden, homeDir]);

  // Refresh right panel
  const refreshRight = useCallback(async (path?: string) => {
    const targetPath = path || rightPath;
    if (!targetPath) return;
    try {
      const listing = await api.listDirectory(targetPath, rightShowHidden);
      const pending = pendingFocusRef.current.right;
      pendingFocusRef.current.right = null;

      setRightListing(listing);

      const sortedEntries = sortDirectoryEntries(
        listing.entries,
        rightSortRef.current,
        calculatedSizesRef.current
      );

      if (pending?.targetPath || pending?.targetName) {
        const matchIdx = sortedEntries.findIndex(
          (e) =>
            (pending.targetPath && e.path === pending.targetPath) ||
            (pending.targetName && e.name === pending.targetName)
        );
        setRightIndex(matchIdx >= 0 ? matchIdx : 0);
      } else if (pending?.resetToTop) {
        setRightIndex(0);
      } else {
        setRightIndex((prev) => Math.min(prev, Math.max(0, sortedEntries.length - 1)));
      }
    } catch (err: any) {
      pendingFocusRef.current.right = null;
      console.error('Failed to list right directory:', err);
      const msg = typeof err === 'string' ? err : err?.message || JSON.stringify(err);
      setErrorAlert({
        open: true,
        title: 'DIRECTORY READ ERROR',
        message: `Failed to open directory:\n${targetPath}\n\n${msg}`,
      });
      if (
        targetPath.startsWith('ftp://') ||
        targetPath.startsWith('ftps://') ||
        targetPath.startsWith('sftp://') ||
        targetPath.startsWith('/Volumes/')
      ) {
        setRightPath(homeDir);
      }
    }
  }, [rightPath, rightShowHidden, homeDir]);

  // If a panel is currently viewing /Volumes directly, refresh it when disks change
  useEffect(() => {
    if (leftPath === '/Volumes') refreshLeft('/Volumes');
    if (rightPath === '/Volumes') refreshRight('/Volumes');
  }, [volumes]);

  useEffect(() => {
    if (leftPath) refreshLeft(leftPath);
  }, [leftPath, leftShowHidden, refreshLeft]);

  useEffect(() => {
    if (rightPath) refreshRight(rightPath);
  }, [rightPath, rightShowHidden, refreshRight]);

  // Reset quick-jump buffer when changing panel or directory, and cleanup timer on unmount
  useEffect(() => {
    clearQuickSearch();
  }, [activePane, leftPath, rightPath, clearQuickSearch]);

  useEffect(() => {
    return () => {
      if (quickSearchTimerRef.current !== null) {
        window.clearTimeout(quickSearchTimerRef.current);
      }
    };
  }, []);

  const leftViewListing = useMemo<DirectoryListing | null>(() => {
    if (!leftListing) return null;
    return {
      ...leftListing,
      entries: sortDirectoryEntries(leftListing.entries, leftSort, calculatedSizes),
    };
  }, [leftListing, leftSort, calculatedSizes]);

  const rightViewListing = useMemo<DirectoryListing | null>(() => {
    if (!rightListing) return null;
    return {
      ...rightListing,
      entries: sortDirectoryEntries(rightListing.entries, rightSort, calculatedSizes),
    };
  }, [rightListing, rightSort, calculatedSizes]);

  const handleSortChange = useCallback(
    (pane: 'left' | 'right', field: SortField) => {
      clearQuickSearch();
      const isLeft = pane === 'left';
      const prevSort = isLeft ? leftSort : rightSort;
      const viewListing = isLeft ? leftViewListing : rightViewListing;
      const rawListing = isLeft ? leftListing : rightListing;
      const curIdx = isLeft ? leftIndex : rightIndex;
      const focusedEntry = viewListing?.entries[curIdx];

      const nextDirection =
        prevSort.field === field
          ? prevSort.direction === 'asc'
            ? 'desc'
            : 'asc'
          : field === 'size' || field === 'modified'
          ? 'desc'
          : 'asc';

      const nextSort: SortConfig = { field, direction: nextDirection };

      if (isLeft) {
        setLeftSort(nextSort);
        if (rawListing && focusedEntry) {
          if (focusedEntry.name === '..') {
            setLeftIndex(0);
          } else {
            const reordered = sortDirectoryEntries(rawListing.entries, nextSort, calculatedSizes);
            const newIdx = reordered.findIndex((e) => e.path === focusedEntry.path);
            if (newIdx >= 0) setLeftIndex(newIdx);
          }
        }
      } else {
        setRightSort(nextSort);
        if (rawListing && focusedEntry) {
          if (focusedEntry.name === '..') {
            setRightIndex(0);
          } else {
            const reordered = sortDirectoryEntries(rawListing.entries, nextSort, calculatedSizes);
            const newIdx = reordered.findIndex((e) => e.path === focusedEntry.path);
            if (newIdx >= 0) setRightIndex(newIdx);
          }
        }
      }
    },
    [
      clearQuickSearch,
      leftSort,
      rightSort,
      leftViewListing,
      rightViewListing,
      leftListing,
      rightListing,
      leftIndex,
      rightIndex,
      calculatedSizes,
    ]
  );

  const activeListing = activePane === 'left' ? leftViewListing : rightViewListing;
  const activeIndex = activePane === 'left' ? leftIndex : rightIndex;
  const activeSelected = activePane === 'left' ? leftSelected : rightSelected;
  const currentItem = activeListing?.entries[activeIndex];
  const oppositePath = activePane === 'left' ? rightPath : leftPath;

  // Toggle mark on item + calculate item/directory size when selected
  const handleToggleMark = (entry: FileEntry, advanceCursor = true) => {
    if (entry.name === '..') return;
    const isLeft = activePane === 'left';
    const currentSet = isLeft ? new Set(leftSelected) : new Set(rightSelected);

    const isAdding = !currentSet.has(entry.path);
    if (isAdding) {
      currentSet.add(entry.path);
      triggerSizeCalculation(entry);
    } else {
      currentSet.delete(entry.path);
    }

    if (isLeft) {
      setLeftSelected(currentSet);
      if (advanceCursor && leftViewListing && leftIndex < leftViewListing.entries.length - 1) {
        setLeftIndex(leftIndex + 1);
      }
    } else {
      setRightSelected(currentSet);
      if (advanceCursor && rightViewListing && rightIndex < rightViewListing.entries.length - 1) {
        setRightIndex(rightIndex + 1);
      }
    }
  };

  // Navigate to an arbitrary path on a pane (e.g. from Menu, Volume selector, SiteManager)
  const navigatePaneTo = (pane: 'left' | 'right', destinationPath: string, focus?: PendingFocus) => {
    pendingFocusRef.current[pane] = focus || { resetToTop: true };
    if (pane === 'left') {
      setLeftSelected(new Set());
      if (leftPath === destinationPath) {
        refreshLeft(destinationPath);
      } else {
        setLeftPath(destinationPath);
      }
    } else {
      setRightSelected(new Set());
      if (rightPath === destinationPath) {
        refreshRight(destinationPath);
      } else {
        setRightPath(destinationPath);
      }
    }
  };

  // Navigate on Enter / Double-Click / Backspace
  const handleEnter = async (entry: FileEntry) => {
    if (entry.name === '..') {
      // Going UP one directory level -> focus the directory (or archive) we just exited!
      const effectiveCurrent =
        (activePane === 'left' ? leftListing?.path || leftPath : rightListing?.path || rightPath) || '';
      const exited = getExitedChildInfo(effectiveCurrent);
      navigatePaneTo(activePane, entry.path, {
        targetPath: exited.targetPath,
        targetName: exited.targetName,
      });
      return;
    }

    if (entry.is_dir) {
      navigatePaneTo(activePane, entry.path, { resetToTop: true });
      return;
    }

    if (entry.is_archive) {
      const archiveUrl = `archive://${entry.path}#`;
      navigatePaneTo(activePane, archiveUrl, { resetToTop: true });
      return;
    }

    // Regular file: open native or view
    try {
      await api.openFileNative(entry.path);
    } catch {
      handleF3View();
    }
  };

  // F1 Help
  const handleF1Help = () => setHelpOpen(true);

  // F2 Menu
  const handleF2Menu = () => {
    refreshVolumes();
    setMenuOpen(true);
  };

  // F3 View
  const handleF3View = async () => {
    if (!currentItem || currentItem.name === '..' || currentItem.is_dir) return;
    setViewState({ open: true, preview: null, loading: true });
    try {
      const preview = await api.readFilePreview(currentItem.path, false);
      setViewState({ open: true, preview, loading: false });
    } catch (err: any) {
      alert(`Cannot preview file: ${err}`);
      setViewState({ open: false, preview: null, loading: false });
    }
  };

  // F4 Edit
  const handleF4Edit = async () => {
    if (!currentItem || currentItem.name === '..' || currentItem.is_dir) return;
    try {
      const preview = await api.readFilePreview(currentItem.path, false);
      setEditState({
        open: true,
        filename: currentItem.name,
        path: currentItem.path,
        content: preview.text_content || '',
      });
    } catch (err: any) {
      alert(`Cannot open editor: ${err}`);
    }
  };

  // Collect items for Copy/Move/Delete/Archive
  const getSelectedOrCurrentItems = () => {
    if (!activeListing) return { paths: [], names: [] };
    const marked = activeListing.entries.filter((e) => activeSelected.has(e.path) && e.name !== '..');
    if (marked.length > 0) {
      return {
        paths: marked.map((e) => e.path),
        names: marked.map((e) => e.name),
      };
    }
    if (currentItem && currentItem.name !== '..') {
      return {
        paths: [currentItem.path],
        names: [currentItem.name],
      };
    }
    return { paths: [], names: [] };
  };

  // F5 Copy
  const handleF5Copy = () => {
    const { paths, names } = getSelectedOrCurrentItems();
    if (paths.length === 0) return;
    setCopyMoveState({
      open: true,
      mode: 'copy',
      sources: paths,
      sourceNames: names,
      defaultDest: oppositePath,
    });
  };

  // F6 Move / Rename
  const handleF6Move = () => {
    const { paths, names } = getSelectedOrCurrentItems();
    if (paths.length === 0) return;
    setCopyMoveState({
      open: true,
      mode: 'move',
      sources: paths,
      sourceNames: names,
      defaultDest: oppositePath,
    });
  };

  // F7 MkDir
  const handleF7MkDir = () => {
    setMkdirOpen(true);
  };

  // F8 Delete
  const handleF8Delete = () => {
    const { paths, names } = getSelectedOrCurrentItems();
    if (paths.length === 0) return;
    setDeleteState({
      open: true,
      paths,
      names,
    });
  };

  // F9 Connect
  const handleF9Connect = () => {
    setSiteManagerOpen(true);
  };

  // F10 Quit
  const handleF10Quit = () => {
    if (confirm('Quit Norton Commander?')) {
      window.close();
    }
  };

  // Pack Archive Modal
  const handleOpenPackArchive = () => {
    const { paths, names } = getSelectedOrCurrentItems();
    if (paths.length === 0) {
      alert('Select at least one file or folder to pack into an archive.');
      return;
    }
    const curPath = activePane === 'left' ? leftPath : rightPath;
    setArchiveState({
      open: true,
      sources: paths,
      sourceNames: names,
      currentDir: curPath,
    });
  };

  // Duplicate File / Folder Modal (Local or FTP/FTPS/SFTP)
  const handleOpenDuplicate = () => {
    if (!activeListing) return;
    const curPath = activeListing.display_path || (activePane === 'left' ? leftPath : rightPath);
    if ((activePane === 'left' ? leftPath : rightPath).startsWith('archive://')) {
      setErrorAlert({
        open: true,
        title: 'ARCHIVE READ-ONLY',
        message: 'Gli archivi virtuali sono in sola lettura.\nEstrai prima i file con F5 per poterli duplicare.',
      });
      return;
    }

    const markedEntries = activeListing.entries.filter(
      (e) => activeSelected.has(e.path) && e.name !== '..'
    );
    const itemsToDup =
      markedEntries.length > 0
        ? markedEntries
        : currentItem && currentItem.name !== '..'
        ? [currentItem]
        : [];

    if (itemsToDup.length === 0) return;

    setDuplicateState({
      open: true,
      items: itemsToDup,
      currentDir: curPath,
    });
  };

  // Selection actions
  const handleSelectAll = () => {
    if (!activeListing) return;
    const validEntries = activeListing.entries.filter((e) => e.name !== '..');
    const all = new Set(validEntries.map((e) => e.path));
    validEntries.forEach((e) => triggerSizeCalculation(e));
    if (activePane === 'left') setLeftSelected(all);
    else setRightSelected(all);
  };

  const handleInvertSelect = () => {
    if (!activeListing) return;
    const current = activePane === 'left' ? leftSelected : rightSelected;
    const inverted = new Set<string>();
    for (const e of activeListing.entries) {
      if (e.name !== '..' && !current.has(e.path)) {
        inverted.add(e.path);
        triggerSizeCalculation(e);
      }
    }
    if (activePane === 'left') setLeftSelected(inverted);
    else setRightSelected(inverted);
  };

  const handleClearSelect = () => {
    if (activePane === 'left') setLeftSelected(new Set());
    else setRightSelected(new Set());
  };

  // Numpad '*' selects all items in the active panel (or clears if all are already selected)
  const handleNumpadSelectAll = () => {
    if (!activeListing) return;
    const validEntries = activeListing.entries.filter((e) => e.name !== '..');
    if (validEntries.length === 0) return;
    const currentSet = activePane === 'left' ? leftSelected : rightSelected;
    const allAlreadySelected = validEntries.every((e) => currentSet.has(e.path));
    if (allAlreadySelected) {
      handleClearSelect();
    } else {
      handleSelectAll();
    }
  };

  // Toggle Hidden
  const handleToggleHidden = () => {
    if (activePane === 'left') setLeftShowHidden(!leftShowHidden);
    else setRightShowHidden(!rightShowHidden);
  };

  // Master Global Keyboard Listener
  useEffect(() => {
    const anyModalOpen =
      helpOpen ||
      menuOpen ||
      siteManagerOpen ||
      themeOpen ||
      viewState.open ||
      editState.open ||
      mkdirOpen ||
      deleteState.open ||
      copyMoveState.open ||
      duplicateState.open ||
      archiveState.open ||
      errorAlert.open;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';

      // Allow ESC or Enter to close error dialog
      if (errorAlert.open && (e.key === 'Escape' || e.key === 'Enter')) {
        e.preventDefault();
        setErrorAlert({ open: false, title: '', message: '' });
        return;
      }

      // Cmd + , to open Theme / Color Editor
      if (e.metaKey && e.key === ',') {
        e.preventDefault();
        setThemeOpen(true);
        return;
      }

      // Allow ESC to close modals even in inputs, or clear quick-jump buffer
      if (e.key === 'Escape') {
        if (!anyModalOpen && quickSearch.query) {
          e.preventDefault();
          clearQuickSearch();
          return;
        }
        if (themeOpen) {
          applyThemeToDocument(themeColors);
          setThemeOpen(false);
          return;
        }
        if (helpOpen) setHelpOpen(false);
        if (menuOpen) setMenuOpen(false);
        if (siteManagerOpen) setSiteManagerOpen(false);
        if (viewState.open) setViewState({ open: false, preview: null, loading: false });
        if (mkdirOpen) setMkdirOpen(false);
        if (deleteState.open) setDeleteState({ open: false, paths: [], names: [] });
        if (copyMoveState.open) setCopyMoveState((prev) => ({ ...prev, open: false }));
        if (duplicateState.open) setDuplicateState((prev) => ({ ...prev, open: false }));
        if (archiveState.open) setArchiveState((prev) => ({ ...prev, open: false }));
        return;
      }

      // Cmd + . (or Ctrl + H) to toggle hidden files
      if ((e.metaKey && e.key === '.') || (e.ctrlKey && (e.key === 'h' || e.key === 'H'))) {
        e.preventDefault();
        handleToggleHidden();
        return;
      }

      // Don't hijack panel navigation keys when a modal is open or an input is focused
      if (isInput || anyModalOpen) return;

      // Cmd + D (or Ctrl + D or Shift + F5) -> Duplicate selected file/folder (Local or FTP/SFTP)
      if (
        ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) ||
        (e.shiftKey && e.key === 'F5')
      ) {
        e.preventDefault();
        clearQuickSearch();
        handleOpenDuplicate();
        return;
      }

      // Numpad '*' (or '*') -> Select all files/items in active panel
      if (
        e.code === 'NumpadMultiply' ||
        (e.key === '*' && !e.metaKey && !e.ctrlKey && !e.altKey)
      ) {
        e.preventDefault();
        clearQuickSearch();
        handleNumpadSelectAll();
        return;
      }

      // Cmd + A -> Select all files/items in active panel
      if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        clearQuickSearch();
        handleSelectAll();
        return;
      }

      // Tab switches active panel
      if (e.key === 'Tab') {
        e.preventDefault();
        clearQuickSearch();
        setActivePane((prev) => (prev === 'left' ? 'right' : 'left'));
        return;
      }

      // Arrow navigation
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        clearQuickSearch();
        if (activePane === 'left') {
          setLeftIndex((prev) => Math.max(0, prev - 1));
        } else {
          setRightIndex((prev) => Math.max(0, prev - 1));
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        clearQuickSearch();
        const maxIdx = (activeListing?.entries.length || 1) - 1;
        if (activePane === 'left') {
          setLeftIndex((prev) => Math.min(maxIdx, prev + 1));
        } else {
          setRightIndex((prev) => Math.min(maxIdx, prev + 1));
        }
        return;
      }

      if (e.key === 'PageUp') {
        e.preventDefault();
        clearQuickSearch();
        if (activePane === 'left') {
          setLeftIndex((prev) => Math.max(0, prev - 10));
        } else {
          setRightIndex((prev) => Math.max(0, prev - 10));
        }
        return;
      }

      if (e.key === 'PageDown') {
        e.preventDefault();
        clearQuickSearch();
        const maxIdx = (activeListing?.entries.length || 1) - 1;
        if (activePane === 'left') {
          setLeftIndex((prev) => Math.min(maxIdx, prev + 10));
        } else {
          setRightIndex((prev) => Math.min(maxIdx, prev + 10));
        }
        return;
      }

      if (e.key === 'Home') {
        e.preventDefault();
        clearQuickSearch();
        if (activePane === 'left') setLeftIndex(0);
        else setRightIndex(0);
        return;
      }

      if (e.key === 'End') {
        e.preventDefault();
        clearQuickSearch();
        const maxIdx = (activeListing?.entries.length || 1) - 1;
        if (activePane === 'left') setLeftIndex(maxIdx);
        else setRightIndex(maxIdx);
        return;
      }

      // Mark file/dir with Space or Insert -> also calculates directory/item size!
      // (If actively typing a quick-jump prefix and an item continues with a space, extend the search instead)
      if (e.key === ' ' || e.key === 'Insert') {
        e.preventDefault();
        if (e.key === ' ' && quickSearch.query.length > 0) {
          const entries = activeListing?.entries || [];
          const candidateWithSpace = quickSearch.query + ' ';
          const { matchIndex } = resolveQuickJump(entries, candidateWithSpace, activeIndex);
          if (matchIndex >= 0) {
            setQuickSearch({ query: candidateWithSpace, matched: true });
            scheduleQuickSearchReset();
            if (activePane === 'left') setLeftIndex(matchIndex);
            else setRightIndex(matchIndex);
            return;
          }
          clearQuickSearch();
        }
        if (currentItem) {
          if (currentItem.name !== '..') {
            handleToggleMark(currentItem, true);
          } else {
            // Even on '..', advance cursor like classic NC
            const maxIdx = (activeListing?.entries.length || 1) - 1;
            if (activePane === 'left') setLeftIndex((prev) => Math.min(maxIdx, prev + 1));
            else setRightIndex((prev) => Math.min(maxIdx, prev + 1));
          }
        }
        return;
      }

      // Enter
      if (e.key === 'Enter') {
        e.preventDefault();
        clearQuickSearch();
        if (currentItem) {
          handleEnter(currentItem);
        }
        return;
      }

      // Backspace: edit quick-jump query if active, otherwise go up to parent ('..')
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (quickSearch.query.length > 0) {
          const shortened = quickSearch.query.slice(0, -1);
          if (!shortened) {
            clearQuickSearch();
          } else {
            const entries = activeListing?.entries || [];
            const { matchIndex, effectiveQuery } = resolveQuickJump(entries, shortened, 0);
            setQuickSearch({ query: effectiveQuery, matched: matchIndex >= 0 });
            scheduleQuickSearchReset();
            if (matchIndex >= 0) {
              if (activePane === 'left') setLeftIndex(matchIndex);
              else setRightIndex(matchIndex);
            }
          }
          return;
        }
        const parentEntry = activeListing?.entries.find((en) => en.name === '..');
        if (parentEntry) {
          handleEnter(parentEntry);
        }
        return;
      }

      // Function keys (standard F1-F12 or macOS Fn+F1-F12)
      if (e.key === 'F1') { e.preventDefault(); clearQuickSearch(); handleF1Help(); return; }
      else if (e.key === 'F2') { e.preventDefault(); clearQuickSearch(); handleF2Menu(); return; }
      else if (e.key === 'F3') { e.preventDefault(); clearQuickSearch(); handleF3View(); return; }
      else if (e.key === 'F4') { e.preventDefault(); clearQuickSearch(); handleF4Edit(); return; }
      else if (e.key === 'F5') { e.preventDefault(); clearQuickSearch(); handleF5Copy(); return; }
      else if (e.key === 'F6') { e.preventDefault(); clearQuickSearch(); handleF6Move(); return; }
      else if (e.key === 'F7') { e.preventDefault(); clearQuickSearch(); handleF7MkDir(); return; }
      else if (e.key === 'F8') { e.preventDefault(); clearQuickSearch(); handleF8Delete(); return; }
      else if (e.key === 'F9') { e.preventDefault(); clearQuickSearch(); handleF9Connect(); return; }
      else if (e.key === 'F10') { e.preventDefault(); clearQuickSearch(); handleF10Quit(); return; }

      // Type-ahead Quick Jump: printable characters jump directly to matching entry prefix
      if (
        e.key.length === 1 &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        e.key !== ' '
      ) {
        e.preventDefault();
        const entries = activeListing?.entries || [];
        const candidate = quickSearch.query + e.key;
        const { matchIndex, effectiveQuery } = resolveQuickJump(entries, candidate, activeIndex);
        setQuickSearch({ query: effectiveQuery, matched: matchIndex >= 0 });
        scheduleQuickSearchReset();
        if (matchIndex >= 0) {
          if (activePane === 'left') setLeftIndex(matchIndex);
          else setRightIndex(matchIndex);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activePane,
    activeListing,
    activeIndex,
    currentItem,
    quickSearch,
    clearQuickSearch,
    scheduleQuickSearchReset,
    helpOpen,
    menuOpen,
    siteManagerOpen,
    themeOpen,
    themeColors,
    viewState.open,
    editState.open,
    mkdirOpen,
    deleteState.open,
    copyMoveState.open,
    duplicateState.open,
    archiveState.open,
    errorAlert.open,
    leftShowHidden,
    rightShowHidden,
    leftSelected,
    rightSelected,
  ]);

  const activePath = activePane === 'left' ? leftPath : rightPath;

  return (
    <div className="w-screen h-screen flex flex-col bg-nc-black text-nc-white font-mono select-none overflow-hidden">
      {/* Top Header Bar */}
      <HeaderBar
        volumes={volumes}
        currentVolume={activeListing?.path || activePath}
        showHidden={activePane === 'left' ? leftShowHidden : rightShowHidden}
        onToggleHidden={handleToggleHidden}
        onOpenMenu={handleF2Menu}
        onOpenTheme={() => setThemeOpen(true)}
        onDuplicate={handleOpenDuplicate}
        onRefreshVolumes={refreshVolumes}
        onSelectVolume={(mount) => {
          navigatePaneTo(activePane, mount, { resetToTop: true });
        }}
      />

      {/* Dual Panel Workspace */}
      <div className="flex-1 flex p-1 space-x-1 overflow-hidden min-h-0">
        <FilePanel
          panelId="left"
          isActive={activePane === 'left'}
          listing={leftViewListing}
          selectedIndex={leftIndex}
          selectedPaths={leftSelected}
          calculatedSizes={calculatedSizes}
          calculatingPaths={calculatingPaths}
          sortConfig={leftSort}
          quickSearch={activePane === 'left' ? quickSearch : null}
          onSortChange={(field) => handleSortChange('left', field)}
          onSelectIndex={(idx) => {
            clearQuickSearch();
            setLeftIndex(idx);
          }}
          onToggleMark={handleToggleMark}
          onEnter={handleEnter}
          onActivate={() => setActivePane('left')}
          onNavigateTo={(p) => navigatePaneTo('left', p, { resetToTop: true })}
        />

        <FilePanel
          panelId="right"
          isActive={activePane === 'right'}
          listing={rightViewListing}
          selectedIndex={rightIndex}
          selectedPaths={rightSelected}
          calculatedSizes={calculatedSizes}
          calculatingPaths={calculatingPaths}
          sortConfig={rightSort}
          quickSearch={activePane === 'right' ? quickSearch : null}
          onSortChange={(field) => handleSortChange('right', field)}
          onSelectIndex={(idx) => {
            clearQuickSearch();
            setRightIndex(idx);
          }}
          onToggleMark={handleToggleMark}
          onEnter={handleEnter}
          onActivate={() => setActivePane('right')}
          onNavigateTo={(p) => navigatePaneTo('right', p, { resetToTop: true })}
        />
      </div>

      {/* Integrated Shell Prompt */}
      <ShellPrompt
        currentPath={activePath}
        onExecute={async (cmd) => {
          const res = await api.executeShellCommand(activePath, cmd);
          refreshLeft();
          refreshRight();
          return res;
        }}
      />

      {/* Permanent F1-F10 Function Keys Bar */}
      <FunctionBar
        onF1={handleF1Help}
        onF2={handleF2Menu}
        onF3={handleF3View}
        onF4={handleF4Edit}
        onF5={handleF5Copy}
        onF6={handleF6Move}
        onF7={handleF7MkDir}
        onF8={handleF8Delete}
        onF9={handleF9Connect}
        onF10={handleF10Quit}
      />

      {/* Modals */}
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}

      {menuOpen && (
        <MenuModal
          volumes={volumes}
          homeDir={homeDir}
          onNavigate={(p) => {
            navigatePaneTo(activePane, p, { resetToTop: true });
          }}
          onDuplicate={handleOpenDuplicate}
          onPackArchive={handleOpenPackArchive}
          onSelectAll={handleSelectAll}
          onInvertSelect={handleInvertSelect}
          onClearSelect={handleClearSelect}
          onOpenSiteManager={handleF9Connect}
          onOpenTheme={() => setThemeOpen(true)}
          onClose={() => setMenuOpen(false)}
        />
      )}

      {themeOpen && (
        <ThemeModal
          initialTheme={themeColors}
          onSave={(newTheme) => {
            setThemeColors(newTheme);
            saveThemeToStorage(newTheme);
          }}
          onClose={() => setThemeOpen(false)}
        />
      )}

      {viewState.open && (
        <ViewModal
          preview={viewState.preview}
          loading={viewState.loading}
          onClose={() => setViewState({ open: false, preview: null, loading: false })}
        />
      )}

      {editState.open && (
        <EditModal
          filename={editState.filename}
          initialContent={editState.content}
          onSave={async (newContent) => {
            await api.saveFileContent(editState.path, newContent);
            refreshLeft();
            refreshRight();
          }}
          onClose={() => setEditState({ open: false, filename: '', path: '', content: '' })}
        />
      )}

      {copyMoveState.open && (
        <CopyMoveModal
          mode={copyMoveState.mode}
          sourceNames={copyMoveState.sourceNames}
          defaultDest={copyMoveState.defaultDest}
          onConfirm={async (destDir, overwrite) => {
            if (copyMoveState.mode === 'copy') {
              await api.copyItems(copyMoveState.sources, destDir, overwrite);
            } else {
              await api.moveItems(copyMoveState.sources, destDir, overwrite);
              handleClearSelect();
            }
            refreshLeft();
            refreshRight();
          }}
          onClose={() => setCopyMoveState((prev) => ({ ...prev, open: false }))}
        />
      )}

      {mkdirOpen && (
        <MkDirModal
          currentDir={activePath}
          onCreate={async (dirName) => {
            await api.createDirectory(activePath, dirName);
            refreshLeft();
            refreshRight();
          }}
          onClose={() => setMkdirOpen(false)}
        />
      )}

      {deleteState.open && (
        <DeleteModal
          names={deleteState.names}
          onConfirm={async (permanent) => {
            await api.deleteItems(deleteState.paths, permanent);
            handleClearSelect();
            refreshLeft();
            refreshRight();
          }}
          onClose={() => setDeleteState({ open: false, paths: [], names: [] })}
        />
      )}

      {siteManagerOpen && (
        <SiteManagerModal
          onConnect={(mountUrl) => {
            navigatePaneTo(activePane, mountUrl, { resetToTop: true });
          }}
          onClose={() => setSiteManagerOpen(false)}
        />
      )}

      {duplicateState.open && (
        <DuplicateModal
          currentDir={duplicateState.currentDir}
          items={duplicateState.items}
          existingEntries={activeListing?.entries || []}
          onConfirm={async (newName) => {
            const createdNames = await api.duplicateItems(
              duplicateState.items.map((i) => i.path),
              newName
            );
            if (createdNames.length > 0) {
              pendingFocusRef.current[activePane] = {
                targetName: createdNames[createdNames.length - 1],
              };
            }
            refreshLeft();
            refreshRight();
          }}
          onClose={() => setDuplicateState((prev) => ({ ...prev, open: false }))}
        />
      )}

      {archiveState.open && (
        <ArchiveModal
          sourceNames={archiveState.sourceNames}
          currentDir={archiveState.currentDir}
          onConfirm={async (archivePath, archiveType) => {
            await api.createArchive(archiveState.sources, archivePath, archiveType);
            refreshLeft();
            refreshRight();
          }}
          onClose={() => setArchiveState((prev) => ({ ...prev, open: false }))}
        />
      )}

      {/* Global Retro DOS Error Dialog */}
      {errorAlert.open && (
        <div className="fixed inset-0 bg-nc-black/85 flex items-center justify-center p-3 z-50 font-mono select-none">
          <div className="bg-nc-blue border-4 border-nc-brightred text-nc-white w-full max-w-lg shadow-2xl flex flex-col">
            <div className="bg-nc-brightred text-nc-white px-3 py-1 font-black text-xs flex justify-between items-center">
              <span>⚠️ {errorAlert.title}</span>
              <button
                onClick={() => setErrorAlert({ open: false, title: '', message: '' })}
                className="bg-nc-black text-nc-white hover:bg-nc-yellow hover:text-nc-black px-1.5 py-0.5 text-xs font-bold"
              >
                ✕ ESC
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="text-xs font-mono whitespace-pre-wrap bg-nc-darkblue p-3 border border-nc-cyan text-nc-yellow leading-relaxed max-h-60 overflow-y-auto">
                {errorAlert.message}
              </div>
              <div className="flex justify-end pt-2">
                <button
                  onClick={() => setErrorAlert({ open: false, title: '', message: '' })}
                  className="bg-nc-yellow text-nc-black hover:bg-nc-white font-black px-5 py-1.5 text-xs border border-nc-black shadow"
                  autoFocus
                >
                  OK (ENTER / ESC)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
