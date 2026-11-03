import React, { useState, useEffect } from 'react';
import { SiteConfig } from '../../types';
import { api } from '../../api';

interface SiteManagerModalProps {
  onConnect: (mountUrl: string) => void;
  onClose: () => void;
}

export const SiteManagerModal: React.FC<SiteManagerModalProps> = ({
  onConnect,
  onClose,
}) => {
  const [sites, setSites] = useState<SiteConfig[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [editingSite, setEditingSite] = useState<SiteConfig | null>(null);
  const [inProgress, setInProgress] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

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

  const handleAddNew = () => {
    const newSite: SiteConfig = {
      id: `site-${Date.now()}`,
      name: 'New SFTP Server',
      protocol: 'sftp',
      host: 'example.com',
      port: 22,
      username: 'root',
      password: '',
      private_key_path: '',
      default_path: '/',
    };
    setEditingSite(newSite);
  };

  const handleSaveEdit = async () => {
    if (!editingSite) return;
    try {
      await api.saveSiteConfig(editingSite);
      await loadSites();
      setSelectedSiteId(editingSite.id);
      setEditingSite(null);
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
      onConnect(mountUrl);
      onClose();
    } catch (err: any) {
      setErrorMsg(String(err));
    } finally {
      setInProgress(false);
    }
  };

  const selectedSite = sites.find((s) => s.id === selectedSiteId);

  return (
    <div className="fixed inset-0 bg-nc-black/85 flex items-center justify-center p-3 z-50 font-mono select-none">
      <div className="bg-nc-blue border-4 border-nc-cyan text-nc-white w-full max-w-4xl h-[80vh] flex flex-col shadow-2xl">
        {/* Title */}
        <div className="bg-nc-cyan text-nc-black px-3 py-1 font-bold flex justify-between items-center text-xs">
          <span>FTP / SFTP SITE MANAGER (F9)</span>
          <button onClick={onClose} className="bg-nc-red text-nc-white px-2 py-0.5 font-bold">
            ✕ ESC
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 grid grid-cols-12 overflow-hidden p-3 gap-3">
          {/* Left: Sites List */}
          <div className="col-span-5 flex flex-col border border-nc-cyan bg-nc-darkblue p-2">
            <div className="text-nc-brightcyan font-bold text-xs border-b border-nc-cyan/40 pb-1 mb-2 flex justify-between items-center">
              <span>SAVED SITES</span>
              <button
                onClick={handleAddNew}
                className="bg-nc-cyan text-nc-black hover:bg-nc-yellow px-2 py-0.5 text-[11px] font-bold"
              >
                + ADD NEW
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1">
              {sites.map((site) => (
                <div
                  key={site.id}
                  onClick={() => {
                    setSelectedSiteId(site.id);
                    setEditingSite(null);
                  }}
                  className={`p-2 cursor-pointer text-xs font-mono border ${
                    selectedSiteId === site.id
                      ? 'bg-nc-cyan text-nc-black font-bold border-nc-white'
                      : 'hover:bg-nc-blue text-nc-white border-transparent'
                  }`}
                >
                  <div className="flex justify-between">
                    <span className="font-bold">{site.name}</span>
                    <span className="uppercase text-[10px] bg-nc-darkblue text-nc-yellow px-1">
                      {site.protocol}
                    </span>
                  </div>
                  <div className="text-[10px] truncate opacity-80">
                    {site.username}@{site.host}:{site.port}
                  </div>
                </div>
              ))}
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

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-nc-brightcyan font-bold block mb-0.5">Protocol:</label>
                    <select
                      value={editingSite.protocol}
                      onChange={(e) =>
                        setEditingSite({
                          ...editingSite,
                          protocol: e.target.value as any,
                          port: e.target.value === 'ftp' ? 21 : 22,
                        })
                      }
                      className="w-full bg-nc-blue text-nc-white border border-nc-cyan p-1 outline-none cursor-pointer"
                    >
                      <option value="sftp">SFTP (SSH v2)</option>
                      <option value="ftp">FTP / FTPS</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-nc-brightcyan font-bold block mb-0.5">Port:</label>
                    <input
                      type="number"
                      value={editingSite.port}
                      onChange={(e) =>
                        setEditingSite({ ...editingSite, port: parseInt(e.target.value) || 22 })
                      }
                      className="w-full bg-nc-blue text-nc-white border border-nc-cyan p-1 outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-nc-brightcyan font-bold block mb-0.5">Host / IP:</label>
                  <input
                    type="text"
                    value={editingSite.host}
                    onChange={(e) => setEditingSite({ ...editingSite, host: e.target.value })}
                    className="w-full bg-nc-blue text-nc-white border border-nc-cyan p-1 outline-none"
                  />
                </div>

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
                Select a site or click Add New to configure a remote server.
              </div>
            )}
          </div>
        </div>

        {errorMsg && (
          <div className="bg-nc-red text-nc-white px-3 py-1 font-bold text-center text-xs">
            {errorMsg}
          </div>
        )}

        {/* Footer */}
        <div className="bg-nc-cyan text-nc-black px-3 py-1 text-xs font-bold flex justify-between items-center border-t border-nc-brightcyan">
          <span>Supported: SFTP (SSH Key / Password) and FTP/FTPS</span>
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
