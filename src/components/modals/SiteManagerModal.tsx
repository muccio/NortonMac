import React, { useState, useEffect } from 'react';
import { SiteConfig, DiscoveredSite } from '../../types';
import { api } from '../../api';

interface SiteManagerModalProps {
  onConnect: (mountUrl: string) => void;
  onClose: () => void;
}

type ImportTab = 'autodetect' | 'file' | 'paste';

export const SiteManagerModal: React.FC<SiteManagerModalProps> = ({
  onConnect,
  onClose,
}) => {
  const [sites, setSites] = useState<SiteConfig[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [editingSite, setEditingSite] = useState<SiteConfig | null>(null);
  const [inProgress, setInProgress] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Import Sub-view state
  const [showImport, setShowImport] = useState(false);
  const [importTab, setImportTab] = useState<ImportTab>('autodetect');
  const [discoveredSites, setDiscoveredSites] = useState<DiscoveredSite[]>([]);
  const [selectedDiscoveredIds, setSelectedDiscoveredIds] = useState<Set<string>>(new Set());
  const [isScanning, setIsScanning] = useState(false);
  const [overwriteDuplicates, setOverwriteDuplicates] = useState(true);

  // File import state
  const [parsedFileSites, setParsedFileSites] = useState<SiteConfig[]>([]);
  const [selectedFileSiteIndices, setSelectedFileSiteIndices] = useState<Set<number>>(new Set());
  const [fileNameLoaded, setFileNameLoaded] = useState('');

  // Paste import state
  const [pasteContent, setPasteContent] = useState('');
  const [parsedPasteSites, setParsedPasteSites] = useState<SiteConfig[]>([]);
  const [selectedPasteSiteIndices, setSelectedPasteSiteIndices] = useState<Set<number>>(new Set());

  const loadSites = async () => {
    try {
      const list = await api.getSavedSites();
      setSites(list);
      if (list.length > 0 && !selectedSiteId) {
        setSelectedSiteId(list[0].id);
      }
    } catch (err: any) {
      setErrorMsg(String(err));
    }
  };

  useEffect(() => {
    loadSites();
  }, []);

  const cleanHostString = (raw: string): string => {
    let h = raw.trim();
    for (const prefix of ['sftp://', 'ftps://', 'ftp://', 'ssh://']) {
      if (h.toLowerCase().startsWith(prefix)) {
        h = h.slice(prefix.length);
      }
    }
    const slashIdx = h.indexOf('/');
    if (slashIdx !== -1) {
      h = h.slice(0, slashIdx);
    }
    return h.trim();
  };

  const handleAddNew = () => {
    const newSite: SiteConfig = {
      id: `site-${Date.now()}`,
      name: 'New FTP Server',
      protocol: 'ftp',
      host: 'ftp.example.com',
      port: 21,
      username: 'user',
      password: '',
      private_key_path: '',
      default_path: '/',
    };
    setErrorMsg('');
    setShowImport(false);
    setEditingSite(newSite);
  };

  const handleSaveEdit = async () => {
    if (!editingSite) return;
    const cleanedHost = cleanHostString(editingSite.host);
    if (!cleanedHost) {
      setErrorMsg('Il campo Host / IP non può essere vuoto.');
      return;
    }
    if (cleanedHost.includes('@')) {
      const domainHint = cleanedHost.split('@').pop() || 'esempio.it';
      setErrorMsg(
        `Host non valido ('${cleanedHost}'): contiene '@'. Inserisci solo il dominio nel campo Host/IP (es. 'ftp.${domainHint}') e l'email/utente in Username.`
      );
      return;
    }
    const normalizedSite: SiteConfig = {
      ...editingSite,
      host: cleanedHost,
      port: editingSite.port || (editingSite.protocol === 'sftp' ? 22 : 21),
    };
    try {
      setErrorMsg('');
      await api.saveSiteConfig(normalizedSite);
      await loadSites();
      setSelectedSiteId(normalizedSite.id);
      setEditingSite(null);
      setSuccessMsg('Profile saved successfully.');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err: any) {
      setErrorMsg(String(err));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this site bookmark?')) return;
    try {
      await api.deleteSiteConfig(id);
      await loadSites();
      if (selectedSiteId === id) {
        setSelectedSiteId('');
      }
    } catch (err: any) {
      setErrorMsg(String(err));
    }
  };

  const handleConnect = async (id: string) => {
    setInProgress(true);
    setErrorMsg('');
    try {
      const mountUrl = await api.connectSite(id);
      await loadSites();
      onConnect(mountUrl);
      onClose();
    } catch (err: any) {
      await loadSites();
      setErrorMsg(String(err));
    } finally {
      setInProgress(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Auto-Detect Scanner
  // ---------------------------------------------------------------------------
  const scanExternalApps = async () => {
    setIsScanning(true);
    setErrorMsg('');
    try {
      const found = await api.detectExternalSites();
      setDiscoveredSites(found);
      // Select all by default
      setSelectedDiscoveredIds(new Set(found.map((s) => s.id)));
    } catch (err: any) {
      setErrorMsg(`Auto-detect failed: ${err}`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleOpenImport = () => {
    setShowImport(true);
    setEditingSite(null);
    setImportTab('autodetect');
    scanExternalApps();
  };

  const handleToggleSelectDiscovered = (id: string) => {
    setSelectedDiscoveredIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAllDiscovered = () => {
    if (selectedDiscoveredIds.size === discoveredSites.length) {
      setSelectedDiscoveredIds(new Set());
    } else {
      setSelectedDiscoveredIds(new Set(discoveredSites.map((s) => s.id)));
    }
  };

  const handleImportDiscovered = async () => {
    const toImport = discoveredSites
      .filter((s) => selectedDiscoveredIds.has(s.id))
      .map((s) => s.site);

    if (toImport.length === 0) {
      setErrorMsg('No profiles selected for import.');
      return;
    }

    try {
      const count = await api.importSitesBatch(toImport, overwriteDuplicates);
      await loadSites();
      setShowImport(false);
      setSuccessMsg(`Successfully imported ${count} site(s) from external applications!`);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err: any) {
      setErrorMsg(String(err));
    }
  };

  // ---------------------------------------------------------------------------
  // File Import (.duck, .xml, .json, config)
  // ---------------------------------------------------------------------------
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setErrorMsg('');
    const file = files[0];
    setFileNameLoaded(file.name);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const content = evt.target?.result as string;
      if (!content) return;
      try {
        const parsed = await api.parseImportedSites(content);
        setParsedFileSites(parsed);
        setSelectedFileSiteIndices(new Set(parsed.map((_, idx) => idx)));
        if (parsed.length === 0) {
          setErrorMsg('No compatible FTP/SFTP profiles found in this file.');
        }
      } catch (err: any) {
        setErrorMsg(`Failed to parse file: ${err}`);
      }
    };
    reader.readAsText(file);
  };

  const handleImportFileSites = async () => {
    const toImport = parsedFileSites.filter((_, idx) => selectedFileSiteIndices.has(idx));
    if (toImport.length === 0) {
      setErrorMsg('No profiles selected.');
      return;
    }
    try {
      const count = await api.importSitesBatch(toImport, overwriteDuplicates);
      await loadSites();
      setShowImport(false);
      setSuccessMsg(`Imported ${count} site(s) from ${fileNameLoaded}!`);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err: any) {
      setErrorMsg(String(err));
    }
  };

  // ---------------------------------------------------------------------------
  // Paste / URL Import
  // ---------------------------------------------------------------------------
  const handleParsePaste = async () => {
    if (!pasteContent.trim()) {
      setErrorMsg('Please paste configuration content or a URL first.');
      return;
    }
    setErrorMsg('');
    try {
      const parsed = await api.parseImportedSites(pasteContent);
      setParsedPasteSites(parsed);
      setSelectedPasteSiteIndices(new Set(parsed.map((_, idx) => idx)));
      if (parsed.length === 0) {
        setErrorMsg('Could not detect any valid FTP/SFTP profiles or URLs from pasted text.');
      }
    } catch (err: any) {
      setErrorMsg(`Failed to parse text: ${err}`);
    }
  };

  const handleImportPastedSites = async () => {
    const toImport = parsedPasteSites.filter((_, idx) => selectedPasteSiteIndices.has(idx));
    if (toImport.length === 0) {
      setErrorMsg('No profiles selected.');
      return;
    }
    try {
      const count = await api.importSitesBatch(toImport, overwriteDuplicates);
      await loadSites();
      setShowImport(false);
      setSuccessMsg(`Imported ${count} site(s) from pasted configuration!`);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err: any) {
      setErrorMsg(String(err));
    }
  };

  // ---------------------------------------------------------------------------
  // Export JSON
  // ---------------------------------------------------------------------------
  const handleExportJson = async () => {
    try {
      const json = await api.exportSitesToJson();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `norton-mac-sites-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSuccessMsg('Exported sites configuration JSON.');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err: any) {
      setErrorMsg(`Export failed: ${err}`);
    }
  };

  const selectedSite = sites.find((s) => s.id === selectedSiteId);

  return (
    <div className="fixed inset-0 bg-nc-black/85 flex items-center justify-center p-3 z-50 font-mono select-none">
      <div className="bg-nc-blue border-4 border-nc-cyan text-nc-white w-full max-w-5xl h-[85vh] flex flex-col shadow-2xl">
        {/* Title */}
        <div className="bg-nc-cyan text-nc-black px-3 py-1 font-bold flex justify-between items-center text-xs">
          <div className="flex items-center space-x-2">
            <span className="bg-nc-yellow text-nc-black px-1 font-black">F9</span>
            <span>FTP / SFTP SITE MANAGER</span>
          </div>
          <button onClick={onClose} className="bg-nc-red text-nc-white hover:bg-nc-brightred px-2 py-0.5 font-bold">
            ✕ ESC
          </button>
        </div>

        {/* Action Toolbar */}
        <div className="bg-nc-darkblue border-b border-nc-cyan px-3 py-1.5 flex justify-between items-center text-xs">
          <div className="flex items-center space-x-2">
            <button
              onClick={handleAddNew}
              className="bg-nc-cyan text-nc-black hover:bg-nc-yellow px-2.5 py-1 font-bold text-xs"
            >
              + ADD NEW
            </button>
            <button
              onClick={handleOpenImport}
              className={`px-2.5 py-1 font-bold text-xs border ${
                showImport
                  ? 'bg-nc-yellow text-nc-black border-nc-black'
                  : 'bg-nc-blue text-nc-brightcyan border-nc-cyan hover:bg-nc-cyan hover:text-nc-black'
              }`}
            >
              📥 IMPORT SITES
            </button>
            <button
              onClick={handleExportJson}
              className="bg-nc-blue text-nc-white hover:bg-nc-darkblue px-2.5 py-1 font-bold text-xs border border-nc-cyan"
              title="Export all profiles to JSON"
            >
              📤 EXPORT JSON
            </button>
          </div>

          <div className="text-[11px] text-nc-brightcyan">
            Profiles: <span className="text-nc-yellow font-bold">{sites.length}</span>
          </div>
        </div>

        {/* Main Body */}
        <div className="flex-1 overflow-hidden p-3">
          {showImport ? (
            /* ===============================================================
               IMPORT SUB-VIEW (Cyberduck, FileZilla, SSH Config, Transmit, etc.)
               =============================================================== */
            <div className="h-full flex flex-col bg-nc-darkblue border border-nc-cyan p-3 overflow-hidden">
              {/* Import Sub-Tabs */}
              <div className="flex justify-between items-center border-b border-nc-cyan pb-2 mb-3">
                <div className="flex space-x-2">
                  <button
                    onClick={() => {
                      setImportTab('autodetect');
                      if (discoveredSites.length === 0) scanExternalApps();
                    }}
                    className={`px-3 py-1 text-xs font-bold border ${
                      importTab === 'autodetect'
                        ? 'bg-nc-yellow text-nc-black border-nc-black'
                        : 'bg-nc-blue text-nc-white border-nc-cyan hover:bg-nc-cyan hover:text-nc-black'
                    }`}
                  >
                    🔍 AUTO-DETECT INSTALLED
                  </button>
                  <button
                    onClick={() => setImportTab('file')}
                    className={`px-3 py-1 text-xs font-bold border ${
                      importTab === 'file'
                        ? 'bg-nc-yellow text-nc-black border-nc-black'
                        : 'bg-nc-blue text-nc-white border-nc-cyan hover:bg-nc-cyan hover:text-nc-black'
                    }`}
                  >
                    📁 FILE UPLOAD (.duck, .xml, .json)
                  </button>
                  <button
                    onClick={() => setImportTab('paste')}
                    className={`px-3 py-1 text-xs font-bold border ${
                      importTab === 'paste'
                        ? 'bg-nc-yellow text-nc-black border-nc-black'
                        : 'bg-nc-blue text-nc-white border-nc-cyan hover:bg-nc-cyan hover:text-nc-black'
                    }`}
                  >
                    📝 PASTE TEXT / URL
                  </button>
                </div>

                <button
                  onClick={() => setShowImport(false)}
                  className="bg-nc-red text-nc-white hover:bg-nc-brightred text-xs px-2.5 py-0.5 font-bold"
                >
                  ✕ Close Import
                </button>
              </div>

              {/* Tab 1: Auto-Detect */}
              {importTab === 'autodetect' && (
                <div className="flex-1 flex flex-col overflow-hidden space-y-3">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-nc-brightcyan font-bold">
                      Scan local macOS apps: Cyberduck, FileZilla, OpenSSH (~/.ssh/config), Transmit
                    </span>
                    <button
                      onClick={scanExternalApps}
                      disabled={isScanning}
                      className="bg-nc-cyan text-nc-black hover:bg-nc-yellow px-2.5 py-0.5 font-bold text-xs"
                    >
                      {isScanning ? 'SCANNING...' : '↻ RESCAN MAC'}
                    </button>
                  </div>

                  {/* Discovered Items Table */}
                  <div className="flex-1 border border-nc-cyan/60 bg-nc-black/40 overflow-y-auto">
                    {isScanning ? (
                      <div className="flex items-center justify-center h-full text-nc-yellow font-bold animate-pulse text-xs">
                        SCANNING MACBOOK FOR CYBERDUCK, FILEZILLA & SSH BOOKMARKS...
                      </div>
                    ) : discoveredSites.length === 0 ? (
                      <div className="p-4 text-center text-xs space-y-2 text-nc-gray">
                        <p className="text-nc-yellow font-bold">
                          No external bookmarks found in default macOS application directories.
                        </p>
                        <p>
                          You can still import your configurations using the{' '}
                          <span
                            onClick={() => setImportTab('file')}
                            className="text-nc-brightcyan underline cursor-pointer"
                          >
                            [FILE UPLOAD]
                          </span>{' '}
                          or{' '}
                          <span
                            onClick={() => setImportTab('paste')}
                            className="text-nc-brightcyan underline cursor-pointer"
                          >
                            [PASTE TEXT]
                          </span>{' '}
                          tabs.
                        </p>
                      </div>
                    ) : (
                      <div className="divide-y divide-nc-cyan/20 text-xs">
                        <div className="bg-nc-blue p-2 grid grid-cols-12 font-bold text-nc-brightcyan sticky top-0 border-b border-nc-cyan text-[11px]">
                          <div className="col-span-1 text-center">
                            <input
                              type="checkbox"
                              checked={
                                selectedDiscoveredIds.size === discoveredSites.length &&
                                discoveredSites.length > 0
                              }
                              onChange={handleSelectAllDiscovered}
                              className="cursor-pointer"
                            />
                          </div>
                          <div className="col-span-2">SOURCE</div>
                          <div className="col-span-3">NAME</div>
                          <div className="col-span-4">HOST / PORT / USER</div>
                          <div className="col-span-2">PROTOCOL</div>
                        </div>

                        {discoveredSites.map((ds) => {
                          const isSelected = selectedDiscoveredIds.has(ds.id);
                          const sourceBadgeColor =
                            ds.source_app === 'Cyberduck'
                              ? 'bg-yellow-400 text-black'
                              : ds.source_app === 'FileZilla'
                              ? 'bg-red-500 text-white'
                              : ds.source_app === 'SSH Config'
                              ? 'bg-cyan-500 text-black'
                              : 'bg-green-500 text-black';

                          return (
                            <div
                              key={ds.id}
                              onClick={() => handleToggleSelectDiscovered(ds.id)}
                              className={`p-2 grid grid-cols-12 items-center cursor-pointer hover:bg-nc-blue ${
                                isSelected ? 'bg-nc-blue/60 text-white' : 'text-nc-gray'
                              }`}
                            >
                              <div className="col-span-1 text-center" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => handleToggleSelectDiscovered(ds.id)}
                                  className="cursor-pointer"
                                />
                              </div>
                              <div className="col-span-2">
                                <span className={`px-1.5 py-0.5 text-[10px] font-black uppercase rounded ${sourceBadgeColor}`}>
                                  {ds.source_app}
                                </span>
                              </div>
                              <div className="col-span-3 font-bold truncate text-nc-yellow">
                                {ds.site.name}
                              </div>
                              <div className="col-span-4 truncate font-mono text-[11px]">
                                {ds.site.username}@{ds.site.host}:{ds.site.port}
                              </div>
                              <div className="col-span-2 uppercase font-black text-[11px] text-nc-brightcyan">
                                {ds.site.protocol}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  {discoveredSites.length > 0 && (
                    <div className="flex justify-between items-center pt-2 border-t border-nc-cyan/40 text-xs">
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={overwriteDuplicates}
                          onChange={(e) => setOverwriteDuplicates(e.target.checked)}
                          className="cursor-pointer"
                        />
                        <span className="text-nc-brightcyan">Overwrite existing duplicate profiles</span>
                      </label>

                      <div className="flex space-x-2">
                        <button
                          onClick={handleSelectAllDiscovered}
                          className="bg-nc-blue text-nc-white hover:bg-nc-black px-3 py-1 font-bold border border-nc-cyan"
                        >
                          {selectedDiscoveredIds.size === discoveredSites.length ? 'Deselect All' : 'Select All'}
                        </button>
                        <button
                          onClick={handleImportDiscovered}
                          disabled={selectedDiscoveredIds.size === 0}
                          className="bg-nc-cyan text-nc-black hover:bg-nc-yellow px-4 py-1 font-black border border-nc-white disabled:opacity-50"
                        >
                          📥 IMPORT ({selectedDiscoveredIds.size}) SELECTED
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Tab 2: File Upload */}
              {importTab === 'file' && (
                <div className="flex-1 flex flex-col overflow-hidden space-y-3">
                  <div className="text-xs text-nc-brightcyan font-bold">
                    Select a Cyberduck bookmark file (.duck), FileZilla XML export (sitemanager.xml), or SSH config file:
                  </div>

                  <div className="border-2 border-dashed border-nc-cyan bg-nc-black/50 p-4 text-center flex flex-col items-center justify-center space-y-2">
                    <p className="text-nc-yellow text-xs font-bold">
                      CLICK TO SELECT OR DRAG AND DROP CONFIG FILE
                    </p>
                    <p className="text-[11px] text-nc-gray">
                      Compatible formats: .duck (Cyberduck), .xml (FileZilla), .json (NortonMac / Transmit), config (OpenSSH)
                    </p>
                    <input
                      type="file"
                      onChange={handleFileUpload}
                      className="text-xs text-nc-white file:mr-4 file:py-1 file:px-3 file:border file:border-nc-white file:text-xs file:font-bold file:bg-nc-cyan file:text-nc-black hover:file:bg-nc-yellow cursor-pointer"
                    />
                  </div>

                  {parsedFileSites.length > 0 && (
                    <div className="flex-1 flex flex-col overflow-hidden space-y-2">
                      <div className="text-xs font-bold text-nc-brightcyan">
                        Detected in {fileNameLoaded}: ({parsedFileSites.length} profile(s))
                      </div>
                      <div className="flex-1 border border-nc-cyan bg-nc-black/40 overflow-y-auto divide-y divide-nc-cyan/20 text-xs">
                        {parsedFileSites.map((site, idx) => {
                          const isSelected = selectedFileSiteIndices.has(idx);
                          return (
                            <div
                              key={idx}
                              onClick={() => {
                                setSelectedFileSiteIndices((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(idx)) next.delete(idx);
                                  else next.add(idx);
                                  return next;
                                });
                              }}
                              className={`p-2 flex justify-between items-center cursor-pointer hover:bg-nc-blue ${
                                isSelected ? 'bg-nc-blue/60 text-white' : 'text-nc-gray'
                              }`}
                            >
                              <div className="flex items-center space-x-2">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => {}}
                                  className="cursor-pointer"
                                />
                                <span className="font-bold text-nc-yellow">{site.name}</span>
                                <span className="font-mono text-[11px]">
                                  ({site.username}@{site.host}:{site.port})
                                </span>
                              </div>
                              <span className="uppercase text-[10px] font-black bg-nc-cyan text-nc-black px-1.5 py-0.5">
                                {site.protocol}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      <div className="flex justify-between items-center pt-2 border-t border-nc-cyan/40 text-xs">
                        <label className="flex items-center space-x-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={overwriteDuplicates}
                            onChange={(e) => setOverwriteDuplicates(e.target.checked)}
                            className="cursor-pointer"
                          />
                          <span className="text-nc-brightcyan">Overwrite duplicates</span>
                        </label>
                        <button
                          onClick={handleImportFileSites}
                          disabled={selectedFileSiteIndices.size === 0}
                          className="bg-nc-cyan text-nc-black hover:bg-nc-yellow px-4 py-1 font-black border border-nc-white disabled:opacity-50"
                        >
                          📥 IMPORT ({selectedFileSiteIndices.size}) PROFILES
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Tab 3: Paste Text or URL */}
              {importTab === 'paste' && (
                <div className="flex-1 flex flex-col overflow-hidden space-y-3">
                  <div className="text-xs text-nc-brightcyan font-bold flex justify-between">
                    <span>Paste raw config (XML, OpenSSH block, JSON, or sftp:// / ftp:// URL):</span>
                    <button
                      onClick={handleParsePaste}
                      className="bg-nc-cyan text-nc-black hover:bg-nc-yellow px-3 py-0.5 font-bold"
                    >
                      ⚡ PARSE & PREVIEW
                    </button>
                  </div>

                  <textarea
                    value={pasteContent}
                    onChange={(e) => setPasteContent(e.target.value)}
                    placeholder={`Examples:\n1) sftp://root:password@192.168.1.50:22/var/www\n2) Host myserver\n     HostName myserver.org\n     User admin\n     IdentityFile ~/.ssh/id_rsa\n3) Cyberduck .duck XML / FileZilla XML`}
                    className="w-full h-32 bg-nc-black/70 text-nc-white border border-nc-cyan p-2 font-mono text-xs outline-none"
                  />

                  {parsedPasteSites.length > 0 && (
                    <div className="flex-1 flex flex-col overflow-hidden space-y-2">
                      <div className="text-xs font-bold text-nc-yellow">
                        Parsed Profiles Ready to Import ({parsedPasteSites.length}):
                      </div>
                      <div className="flex-1 border border-nc-cyan bg-nc-black/40 overflow-y-auto divide-y divide-nc-cyan/20 text-xs">
                        {parsedPasteSites.map((site, idx) => {
                          const isSelected = selectedPasteSiteIndices.has(idx);
                          return (
                            <div
                              key={idx}
                              onClick={() => {
                                setSelectedPasteSiteIndices((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(idx)) next.delete(idx);
                                  else next.add(idx);
                                  return next;
                                });
                              }}
                              className={`p-2 flex justify-between items-center cursor-pointer hover:bg-nc-blue ${
                                isSelected ? 'bg-nc-blue/60 text-white' : 'text-nc-gray'
                              }`}
                            >
                              <div className="flex items-center space-x-2">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => {}}
                                  className="cursor-pointer"
                                />
                                <span className="font-bold text-nc-yellow">{site.name}</span>
                                <span className="font-mono text-[11px]">
                                  ({site.username}@{site.host}:{site.port})
                                </span>
                              </div>
                              <span className="uppercase text-[10px] font-black bg-nc-cyan text-nc-black px-1.5 py-0.5">
                                {site.protocol}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      <div className="flex justify-between items-center pt-2 border-t border-nc-cyan/40 text-xs">
                        <label className="flex items-center space-x-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={overwriteDuplicates}
                            onChange={(e) => setOverwriteDuplicates(e.target.checked)}
                            className="cursor-pointer"
                          />
                          <span className="text-nc-brightcyan">Overwrite duplicates</span>
                        </label>
                        <button
                          onClick={handleImportPastedSites}
                          disabled={selectedPasteSiteIndices.size === 0}
                          className="bg-nc-cyan text-nc-black hover:bg-nc-yellow px-4 py-1 font-black border border-nc-white disabled:opacity-50"
                        >
                          📥 IMPORT ({selectedPasteSiteIndices.size}) SITES
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* ===============================================================
               STANDARD SITES LIST & DETAIL VIEW
               =============================================================== */
            <div className="h-full grid grid-cols-12 overflow-hidden gap-3">
              {/* Left: Sites List */}
              <div className="col-span-5 flex flex-col border border-nc-cyan bg-nc-darkblue p-2 overflow-hidden">
                <div className="text-nc-brightcyan font-bold text-xs border-b border-nc-cyan/40 pb-1 mb-2 flex justify-between items-center">
                  <span>BOOKMARKED SITES</span>
                  <span className="text-nc-yellow text-[11px] font-mono">[{sites.length}]</span>
                </div>

                <div className="flex-1 overflow-y-auto space-y-1">
                  {sites.length === 0 ? (
                    <div className="text-center p-4 text-nc-gray text-xs">
                      No saved sites. Click <span className="text-nc-yellow font-bold">+ ADD NEW</span> or{' '}
                      <span className="text-nc-brightcyan font-bold">📥 IMPORT</span>.
                    </div>
                  ) : (
                    sites.map((site) => (
                      <div
                        key={site.id}
                        onClick={() => {
                          setSelectedSiteId(site.id);
                          setEditingSite(null);
                        }}
                        className={`p-2 cursor-pointer text-xs font-mono border transition-colors ${
                          selectedSiteId === site.id
                            ? 'bg-nc-cyan text-nc-black font-bold border-nc-white'
                            : 'hover:bg-nc-blue text-nc-white border-transparent'
                        }`}
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-bold truncate pr-1">{site.name}</span>
                          <span
                            className={`uppercase text-[10px] px-1 font-bold ${
                              selectedSiteId === site.id
                                ? 'bg-nc-black text-nc-yellow'
                                : 'bg-nc-darkblue text-nc-yellow'
                            }`}
                          >
                            {site.protocol}
                          </span>
                        </div>
                        <div className="text-[10px] truncate opacity-80 pt-0.5">
                          {site.username}@{site.host}:{site.port}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Right: Site Details / Edit Form */}
              <div className="col-span-7 flex flex-col border border-nc-cyan bg-nc-darkblue p-3 overflow-y-auto text-xs">
                {editingSite ? (
                  /* Edit Mode */
                  <div className="space-y-2">
                    <div className="text-nc-yellow font-bold border-b border-nc-cyan pb-1 mb-2">
                      EDIT SITE CONFIGURATION
                    </div>

                    <div>
                      <label className="text-nc-brightcyan font-bold block mb-0.5">Profile Name:</label>
                      <input
                        type="text"
                        value={editingSite.name}
                        onChange={(e) => setEditingSite({ ...editingSite, name: e.target.value })}
                        className="w-full bg-nc-blue text-nc-white border border-nc-cyan p-1 outline-none"
                      />
                    </div>

                    <div>
                      <label className="text-nc-brightcyan font-bold block mb-1">Protocol:</label>
                      <div className="grid grid-cols-3 gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setEditingSite({
                              ...editingSite,
                              protocol: 'ftp',
                              port: editingSite.port === 22 || editingSite.port === 990 ? 21 : editingSite.port || 21,
                            })
                          }
                          className={`py-1.5 px-2 font-black border text-xs ${
                            editingSite.protocol === 'ftp'
                              ? 'bg-nc-yellow text-nc-black border-nc-white'
                              : 'bg-nc-blue text-nc-white border-nc-cyan hover:bg-nc-cyan hover:text-nc-black'
                          }`}
                        >
                          [ FTP (21) ]
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setEditingSite({
                              ...editingSite,
                              protocol: 'ftps',
                              port: editingSite.port === 22 ? 21 : editingSite.port || 21,
                            })
                          }
                          className={`py-1.5 px-2 font-black border text-xs ${
                            editingSite.protocol === 'ftps'
                              ? 'bg-nc-yellow text-nc-black border-nc-white'
                              : 'bg-nc-blue text-nc-white border-nc-cyan hover:bg-nc-cyan hover:text-nc-black'
                          }`}
                        >
                          [ FTPS / TLS (21) ]
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setEditingSite({
                              ...editingSite,
                              protocol: 'sftp',
                              port: editingSite.port === 21 || editingSite.port === 990 ? 22 : editingSite.port || 22,
                            })
                          }
                          className={`py-1.5 px-2 font-black border text-xs ${
                            editingSite.protocol === 'sftp'
                              ? 'bg-nc-yellow text-nc-black border-nc-white'
                              : 'bg-nc-blue text-nc-white border-nc-cyan hover:bg-nc-cyan hover:text-nc-black'
                          }`}
                        >
                          [ SFTP / SSH (22) ]
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2">
                      <div className="col-span-3">
                        <label className="text-nc-brightcyan font-bold block mb-0.5">Host / IP:</label>
                        <input
                          type="text"
                          value={editingSite.host}
                          onChange={(e) => {
                            const val = e.target.value;
                            let nextProto = editingSite.protocol;
                            let nextPort = editingSite.port;
                            const lower = val.trim().toLowerCase();
                            if (lower.startsWith('ftps://')) {
                              nextProto = 'ftps';
                              if (nextPort === 22) nextPort = 21;
                            } else if (lower.startsWith('ftp://') || (lower.startsWith('ftp.') && nextPort === 22 && nextProto === 'sftp')) {
                              nextProto = 'ftp';
                              nextPort = 21;
                            } else if (lower.startsWith('sftp://')) {
                              nextProto = 'sftp';
                              if (nextPort === 21) nextPort = 22;
                            }
                            setEditingSite({
                              ...editingSite,
                              host: val,
                              protocol: nextProto,
                              port: nextPort,
                            });
                          }}
                          onBlur={() => {
                            const cleaned = cleanHostString(editingSite.host);
                            if (cleaned && cleaned !== editingSite.host) {
                              setEditingSite({ ...editingSite, host: cleaned });
                            }
                          }}
                          placeholder="ftp.example.com"
                          className={`w-full bg-nc-blue text-nc-white border p-1 outline-none ${
                            editingSite.host.includes('@') ? 'border-nc-brightred' : 'border-nc-cyan'
                          }`}
                        />
                      </div>

                      <div className="col-span-1">
                        <label className="text-nc-brightcyan font-bold block mb-0.5">Port:</label>
                        <input
                          type="number"
                          value={editingSite.port || ''}
                          onChange={(e) => {
                            const newPort = parseInt(e.target.value, 10) || 0;
                            let nextProto = editingSite.protocol;
                            if (newPort === 21 && editingSite.protocol === 'sftp') {
                              nextProto = 'ftp';
                            } else if (newPort === 990) {
                              nextProto = 'ftps';
                            } else if (newPort === 22) {
                              nextProto = 'sftp';
                            }
                            setEditingSite({ ...editingSite, port: newPort, protocol: nextProto });
                          }}
                          onBlur={() => {
                            if (!editingSite.port) {
                              setEditingSite({
                                ...editingSite,
                                port: editingSite.protocol === 'sftp' ? 22 : 21,
                              });
                            }
                          }}
                          className="w-full bg-nc-blue text-nc-white border border-nc-cyan p-1 outline-none"
                        />
                      </div>
                    </div>

                    {editingSite.host.includes('@') && (
                      <div className="bg-nc-brightred/90 text-nc-white p-1.5 border border-nc-yellow text-[11px] font-bold">
                        ⚠️ Host contiene &apos;@&apos;: inserisci qui solo il dominio del server (es.{' '}
                        <span className="text-nc-yellow">
                          ftp.{editingSite.host.split('@').pop()}
                        </span>
                        ) e metti il nome utente completo nel campo Username!
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-nc-brightcyan font-bold block mb-0.5">Username:</label>
                        <input
                          type="text"
                          value={editingSite.username}
                          onChange={(e) => setEditingSite({ ...editingSite, username: e.target.value })}
                          className="w-full bg-nc-blue text-nc-white border border-nc-cyan p-1 outline-none"
                        />
                      </div>

                      <div>
                        <label className="text-nc-brightcyan font-bold block mb-0.5">Password:</label>
                        <input
                          type="password"
                          value={editingSite.password || ''}
                          onChange={(e) => setEditingSite({ ...editingSite, password: e.target.value })}
                          placeholder="Optional or for key"
                          className="w-full bg-nc-blue text-nc-white border border-nc-cyan p-1 outline-none"
                        />
                      </div>
                    </div>

                    {editingSite.protocol === 'sftp' && (
                      <div>
                        <label className="text-nc-brightcyan font-bold block mb-0.5">
                          Private Key Path (e.g. ~/.ssh/id_ed25519):
                        </label>
                        <input
                          type="text"
                          value={editingSite.private_key_path || ''}
                          onChange={(e) =>
                            setEditingSite({ ...editingSite, private_key_path: e.target.value })
                          }
                          placeholder="/Users/username/.ssh/id_rsa"
                          className="w-full bg-nc-blue text-nc-white border border-nc-cyan p-1 outline-none"
                        />
                      </div>
                    )}

                    <div>
                      <label className="text-nc-brightcyan font-bold block mb-0.5">
                        Default Remote Path:
                      </label>
                      <input
                        type="text"
                        value={editingSite.default_path || '/'}
                        onChange={(e) =>
                          setEditingSite({ ...editingSite, default_path: e.target.value })
                        }
                        className="w-full bg-nc-blue text-nc-white border border-nc-cyan p-1 outline-none"
                      />
                    </div>

                    <div className="flex space-x-2 pt-2">
                      <button
                        onClick={handleSaveEdit}
                        className="bg-nc-cyan text-nc-black hover:bg-nc-yellow font-bold px-4 py-1"
                      >
                        Save Changes
                      </button>
                      <button
                        onClick={() => setEditingSite(null)}
                        className="bg-nc-blue text-nc-white hover:bg-nc-red font-bold px-4 py-1 border border-nc-cyan"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : selectedSite ? (
                  /* View / Connect Mode */
                  <div className="space-y-4">
                    <div className="text-nc-yellow font-bold border-b border-nc-cyan pb-1 text-sm">
                      {selectedSite.name}
                    </div>

                    <div className="space-y-1.5 text-xs">
                      <div>
                        <span className="text-nc-gray">Protocol:</span>{' '}
                        <span className="text-nc-brightcyan font-bold uppercase">
                          {selectedSite.protocol}
                        </span>
                      </div>
                      <div>
                        <span className="text-nc-gray">Server:</span>{' '}
                        <span className="text-nc-white font-bold">
                          {selectedSite.host}:{selectedSite.port}
                        </span>
                      </div>
                      <div>
                        <span className="text-nc-gray">User:</span>{' '}
                        <span className="text-nc-white font-bold">{selectedSite.username}</span>
                      </div>
                      <div>
                        <span className="text-nc-gray">Remote Path:</span>{' '}
                        <span className="text-nc-white font-bold">
                          {selectedSite.default_path || '/'}
                        </span>
                      </div>
                      {selectedSite.private_key_path && (
                        <div>
                          <span className="text-nc-gray">Auth:</span>{' '}
                          <span className="text-nc-yellow">
                            Key ({selectedSite.private_key_path})
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex space-x-3 pt-4 border-t border-nc-cyan/40">
                      <button
                        onClick={() => handleConnect(selectedSite.id)}
                        disabled={inProgress}
                        className="bg-nc-cyan text-nc-black hover:bg-nc-yellow font-bold px-6 py-2 text-sm border border-nc-white"
                      >
                        {inProgress ? 'CONNECTING...' : '⚡ CONNECT NOW'}
                      </button>
                      <button
                        onClick={() => setEditingSite(selectedSite)}
                        className="bg-nc-blue text-nc-white hover:bg-nc-yellow hover:text-nc-black font-bold px-4 py-2 border border-nc-cyan"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(selectedSite.id)}
                        className="bg-nc-red text-nc-white hover:bg-nc-brightred font-bold px-4 py-2"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-nc-gray text-center my-auto">
                    Select a site or click <span className="text-nc-cyan font-bold">+ ADD NEW</span> /{' '}
                    <span className="text-nc-yellow font-bold">📥 IMPORT SITES</span>.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Status / Notifications */}
        {inProgress && (
          <div className="bg-nc-yellow text-nc-black px-3 py-1.5 font-bold text-center text-xs animate-pulse border-y-2 border-nc-cyan">
            ⏳ CONNECTING TO HOST... (RESOLVING, TCP HANDSHAKE & AUTHENTICATION)
          </div>
        )}
        {errorMsg && (
          <div className="bg-nc-brightred text-nc-white px-3 py-2 font-bold text-xs border-y-2 border-nc-yellow flex items-center justify-between shadow-lg">
            <div className="flex items-center space-x-2 overflow-hidden text-left">
              <span className="text-base flex-shrink-0">⚠️</span>
              <span className="truncate">{errorMsg}</span>
            </div>
            <button
              onClick={() => setErrorMsg('')}
              className="ml-3 bg-nc-black text-nc-yellow px-2 py-0.5 text-[11px] font-bold border border-nc-yellow hover:bg-nc-yellow hover:text-nc-black flex-shrink-0"
            >
              ✕ Dismiss
            </button>
          </div>
        )}
        {successMsg && (
          <div className="bg-green-700 text-white px-3 py-1 font-bold text-center text-xs">
            {successMsg}
          </div>
        )}

        {/* Footer */}
        <div className="bg-nc-cyan text-nc-black px-3 py-1 text-xs font-bold flex justify-between items-center border-t border-nc-brightcyan">
          <span>Supported Imports: Cyberduck (.duck), FileZilla XML, OpenSSH config, Transmit, URLs</span>
          <button
            onClick={onClose}
            className="bg-nc-darkblue text-nc-white hover:bg-nc-black px-4 py-0.5"
          >
            Close (ESC)
          </button>
        </div>
      </div>
    </div>
  );
};
