import React, { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import { DirectoryListing, FileEntry, VolumeInfo } from './types';
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

export const App: React.FC = () => {
  const [activePane, setActivePane] = useState<'left' | 'right'>('left');
  const [volumes, setVolumes] = useState<VolumeInfo[]>([]);
  const [homeDir, setHomeDir] = useState<string>('');

  // Left Panel State
  const [leftPath, setLeftPath] = useState<string>('');
  const [leftListing, setLeftListing] = useState<DirectoryListing | null>(null);
  const [leftIndex, setLeftIndex] = useState<number>(0);
  const [leftSelected, setLeftSelected] = useState<Set<string>>(new Set());
  const [leftShowHidden, setLeftShowHidden] = useState<boolean>(false);

  // Right Panel State
  const [rightPath, setRightPath] = useState<string>('');
  const [rightListing, setRightListing] = useState<DirectoryListing | null>(null);
  const [rightIndex, setRightIndex] = useState<number>(0);
  const [rightSelected, setRightSelected] = useState<Set<string>>(new Set());
  const [rightShowHidden, setRightShowHidden] = useState<boolean>(false);

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

  const [errorAlert, setErrorAlert] = useState<{ open: boolean; title: string; message: string }>({
    open: false,
    title: '',
    message: '',
  });

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

  // Refresh left panel
  const refreshLeft = useCallback(async (path?: string) => {
    const targetPath = path || leftPath;
    if (!targetPath) return;
    try {
      const listing = await api.listDirectory(targetPath, leftShowHidden);
      setLeftListing(listing);
      setLeftIndex((prev) => Math.min(prev, Math.max(0, listing.entries.length - 1)));
    } catch (err: any) {
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
        targetPath.startsWith('sftp://')
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
      setRightListing(listing);
      setRightIndex((prev) => Math.min(prev, Math.max(0, listing.entries.length - 1)));
    } catch (err: any) {
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
        targetPath.startsWith('sftp://')
      ) {
        setRightPath(homeDir);
      }
    }
  }, [rightPath, rightShowHidden, homeDir]);

  useEffect(() => {
    if (leftPath) refreshLeft(leftPath);
  }, [leftPath, leftShowHidden, refreshLeft]);

  useEffect(() => {
    if (rightPath) refreshRight(rightPath);
  }, [rightPath, rightShowHidden, refreshRight]);

  const activeListing = activePane === 'left' ? leftListing : rightListing;
  const activeIndex = activePane === 'left' ? leftIndex : rightIndex;
  const activeSelected = activePane === 'left' ? leftSelected : rightSelected;
  const currentItem = activeListing?.entries[activeIndex];
  const oppositePath = activePane === 'left' ? rightPath : leftPath;

  // Toggle mark on item
  const handleToggleMark = (path: string) => {
    const isLeft = activePane === 'left';
    const currentSet = isLeft ? new Set(leftSelected) : new Set(rightSelected);

    if (currentSet.has(path)) {
      currentSet.delete(path);
    } else {
      currentSet.add(path);
    }

    if (isLeft) {
      setLeftSelected(currentSet);
      if (leftListing && leftIndex < leftListing.entries.length - 1) {
        setLeftIndex(leftIndex + 1);
      }
    } else {
      setRightSelected(currentSet);
      if (rightListing && rightIndex < rightListing.entries.length - 1) {
        setRightIndex(rightIndex + 1);
      }
    }
  };

  // Navigate on Enter
  const handleEnter = async (entry: FileEntry) => {
    if (entry.name === '..') {
      // Go up
      const current = activePane === 'left' ? leftPath : rightPath;
      if (current.startsWith('archive://')) {
        // Handled inside entry.path
        if (activePane === 'left') setLeftPath(entry.path);
        else setRightPath(entry.path);
      } else {
        const parent = entry.path;
        if (activePane === 'left') setLeftPath(parent);
        else setRightPath(parent);
      }
      return;
    }

    if (entry.is_dir) {
      if (activePane === 'left') {
        setLeftPath(entry.path);
        setLeftIndex(0);
      } else {
        setRightPath(entry.path);
        setRightIndex(0);
      }
      return;
    }

    if (entry.is_archive) {
      // Enter archive as virtual directory
      const archiveUrl = `archive://${entry.path}#`;
      if (activePane === 'left') {
        setLeftPath(archiveUrl);
        setLeftIndex(0);
      } else {
        setRightPath(archiveUrl);
        setRightIndex(0);
      }
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
  const handleF2Menu = () => setMenuOpen(true);

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

  // Selection actions
  const handleSelectAll = () => {
    if (!activeListing) return;
    const all = new Set(
      activeListing.entries.filter((e) => e.name !== '..').map((e) => e.path)
    );
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
      }
    }
    if (activePane === 'left') setLeftSelected(inverted);
    else setRightSelected(inverted);
  };

  const handleClearSelect = () => {
    if (activePane === 'left') setLeftSelected(new Set());
    else setRightSelected(new Set());
  };

  // Toggle Hidden
  const handleToggleHidden = () => {
    if (activePane === 'left') setLeftShowHidden(!leftShowHidden);
    else setRightShowHidden(!rightShowHidden);
  };

  // Master Global Keyboard Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture shortcuts when typing in an input/textarea inside a modal or shell
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

      // Allow ESC or Enter to close error dialog
      if (errorAlert.open && (e.key === 'Escape' || e.key === 'Enter')) {
        e.preventDefault();
        setErrorAlert({ open: false, title: '', message: '' });
        return;
      }

      // Allow ESC to close modals even in inputs
      if (e.key === 'Escape') {
        if (helpOpen) setHelpOpen(false);
        if (menuOpen) setMenuOpen(false);
        if (siteManagerOpen) setSiteManagerOpen(false);
        if (viewState.open) setViewState({ open: false, preview: null, loading: false });
        if (mkdirOpen) setMkdirOpen(false);
        if (deleteState.open) setDeleteState({ open: false, paths: [], names: [] });
        if (copyMoveState.open) setCopyMoveState((prev) => ({ ...prev, open: false }));
        if (archiveState.open) setArchiveState((prev) => ({ ...prev, open: false }));
        return;
      }

      // Cmd + . (or Cmd + Shift + . or Ctrl + H) to toggle hidden files
      if ((e.metaKey && e.key === '.') || (e.ctrlKey && (e.key === 'h' || e.key === 'H'))) {
        e.preventDefault();
        handleToggleHidden();
        return;
      }

      // If user is focused on an input/textarea (like ShellPrompt or EditModal), don't hijack keys
      if (isInput) return;

      // Tab switches active panel
      if (e.key === 'Tab') {
        e.preventDefault();
        setActivePane((prev) => (prev === 'left' ? 'right' : 'left'));
        return;
      }

      // Arrow navigation
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (activePane === 'left') {
          setLeftIndex((prev) => Math.max(0, prev - 1));
        } else {
          setRightIndex((prev) => Math.max(0, prev - 1));
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
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
        if (activePane === 'left') {
          setLeftIndex((prev) => Math.max(0, prev - 10));
        } else {
          setRightIndex((prev) => Math.max(0, prev - 10));
        }
        return;
      }

      if (e.key === 'PageDown') {
        e.preventDefault();
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
        if (activePane === 'left') setLeftIndex(0);
        else setRightIndex(0);
        return;
      }

      if (e.key === 'End') {
        e.preventDefault();
        const maxIdx = (activeListing?.entries.length || 1) - 1;
        if (activePane === 'left') setLeftIndex(maxIdx);
        else setRightIndex(maxIdx);
        return;
      }

      // Mark file with Space or Insert
      if (e.key === ' ' || e.key === 'Insert') {
        e.preventDefault();
        if (currentItem && currentItem.name !== '..') {
          handleToggleMark(currentItem.path);
        }
        return;
      }

      // Enter
      if (e.key === 'Enter') {
        e.preventDefault();
        if (currentItem) {
          handleEnter(currentItem);
        }
        return;
      }

      // Backspace: go up to parent
      if (e.key === 'Backspace') {
        e.preventDefault();
        const parentEntry = activeListing?.entries.find((e) => e.name === '..');
        if (parentEntry) {
          handleEnter(parentEntry);
        }
        return;
      }

      // Function keys (standard F1-F12 or macOS Fn+F1-F12)
      if (e.key === 'F1') { e.preventDefault(); handleF1Help(); }
      else if (e.key === 'F2') { e.preventDefault(); handleF2Menu(); }
      else if (e.key === 'F3') { e.preventDefault(); handleF3View(); }
      else if (e.key === 'F4') { e.preventDefault(); handleF4Edit(); }
      else if (e.key === 'F5') { e.preventDefault(); handleF5Copy(); }
      else if (e.key === 'F6') { e.preventDefault(); handleF6Move(); }
      else if (e.key === 'F7') { e.preventDefault(); handleF7MkDir(); }
      else if (e.key === 'F8') { e.preventDefault(); handleF8Delete(); }
      else if (e.key === 'F9') { e.preventDefault(); handleF9Connect(); }
      else if (e.key === 'F10') { e.preventDefault(); handleF10Quit(); }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activePane,
    activeListing,
    activeIndex,
    currentItem,
    helpOpen,
    menuOpen,
    siteManagerOpen,
    viewState.open,
    mkdirOpen,
    deleteState.open,
    copyMoveState.open,
    archiveState.open,
    errorAlert.open,
    leftShowHidden,
    rightShowHidden,
  ]);

  const activePath = activePane === 'left' ? leftPath : rightPath;

  return (
    <div className="w-screen h-screen flex flex-col bg-nc-black text-nc-white font-mono select-none overflow-hidden">
      {/* Top Header Bar */}
      <HeaderBar
        volumes={volumes}
        currentVolume={activeListing?.path || ''}
        showHidden={activePane === 'left' ? leftShowHidden : rightShowHidden}
        onToggleHidden={handleToggleHidden}
        onOpenMenu={handleF2Menu}
        onSelectVolume={(mount) => {
          if (activePane === 'left') setLeftPath(mount);
          else setRightPath(mount);
        }}
      />

      {/* Dual Panel Workspace */}
      <div className="flex-1 flex p-1 space-x-1 overflow-hidden min-h-0">
        <FilePanel
          panelId="left"
          isActive={activePane === 'left'}
          listing={leftListing}
          selectedIndex={leftIndex}
          selectedPaths={leftSelected}
          onSelectIndex={setLeftIndex}
          onToggleMark={handleToggleMark}
          onEnter={handleEnter}
          onActivate={() => setActivePane('left')}
          onNavigateTo={setLeftPath}
        />

        <FilePanel
          panelId="right"
          isActive={activePane === 'right'}
          listing={rightListing}
          selectedIndex={rightIndex}
          selectedPaths={rightSelected}
          onSelectIndex={setRightIndex}
          onToggleMark={handleToggleMark}
          onEnter={handleEnter}
          onActivate={() => setActivePane('right')}
          onNavigateTo={setRightPath}
        />
      </div>

      {/* Integrated Shell Prompt */}
      <ShellPrompt
        currentPath={activePath}
        onExecute={async (cmd) => {
          const res = await api.executeShellCommand(activePath, cmd);
          // Refresh both panels after shell command
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
            if (activePane === 'left') setLeftPath(p);
            else setRightPath(p);
          }}
          onPackArchive={handleOpenPackArchive}
          onSelectAll={handleSelectAll}
          onInvertSelect={handleInvertSelect}
          onClearSelect={handleClearSelect}
          onOpenSiteManager={handleF9Connect}
          onClose={() => setMenuOpen(false)}
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
            if (activePane === 'left') setLeftPath(mountUrl);
            else setRightPath(mountUrl);
          }}
          onClose={() => setSiteManagerOpen(false)}
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
