import { invoke } from '@tauri-apps/api/core';
import { DirectoryListing, FilePreview, ShellOutput, SiteConfig, VolumeInfo } from './types';

export const api = {
  getHomeDirectory: async (): Promise<string> => {
    return await invoke('get_home_directory');
  },

  getVolumes: async (): Promise<VolumeInfo[]> => {
    return await invoke('get_volumes');
  },

  listDirectory: async (path: string, showHidden: boolean): Promise<DirectoryListing> => {
    return await invoke('list_directory', { path, showHidden });
  },

  readFilePreview: async (path: string, hexMode: boolean): Promise<FilePreview> => {
    return await invoke('read_file_preview', { path, hexMode });
  },

  saveFileContent: async (path: string, content: string): Promise<void> => {
    return await invoke('save_file_content', { path, content });
  },

  openFileNative: async (path: string): Promise<void> => {
    return await invoke('open_file_native', { path });
  },

  createDirectory: async (parentPath: string, name: string): Promise<void> => {
    return await invoke('create_directory', { parentPath, name });
  },

  deleteItems: async (paths: string[], permanent: boolean): Promise<void> => {
    return await invoke('delete_items', { paths, permanent });
  },

  copyItems: async (sources: string[], destDir: string, overwrite: boolean): Promise<void> => {
    return await invoke('copy_items', { sources, destDir, overwrite });
  },

  moveItems: async (sources: string[], destDir: string, overwrite: boolean): Promise<void> => {
    return await invoke('move_items', { sources, destDir, overwrite });
  },

  duplicateItems: async (sources: string[], newName?: string): Promise<string[]> => {
    return await invoke('duplicate_items', { sources, newName: newName ?? null });
  },

  createArchive: async (sources: string[], archivePath: string, archiveType: string): Promise<void> => {
    return await invoke('create_archive', { sources, archivePath, archiveType });
  },

  executeShellCommand: async (workingDir: string, command: string): Promise<ShellOutput> => {
    return await invoke('execute_shell_command', { workingDir, command });
  },

  getSavedSites: async (): Promise<SiteConfig[]> => {
    return await invoke('get_saved_sites');
  },

  saveSiteConfig: async (site: SiteConfig): Promise<void> => {
    return await invoke('save_site_config', { site });
  },

  deleteSiteConfig: async (id: string): Promise<void> => {
    return await invoke('delete_site_config', { id });
  },

  connectSite: async (siteId: string): Promise<string> => {
    return await invoke('connect_site', { siteId });
  },

  detectExternalSites: async (): Promise<import('./types').DiscoveredSite[]> => {
    return await invoke('detect_external_sites');
  },

  parseImportedSites: async (content: string): Promise<SiteConfig[]> => {
    return await invoke('parse_imported_sites', { content });
  },

  importSitesBatch: async (sites: SiteConfig[], overwrite: boolean): Promise<number> => {
    return await invoke('import_sites_batch', { sites, overwrite });
  },

  exportSitesToJson: async (): Promise<string> => {
    return await invoke('export_sites_to_json');
  },

  calculateItemSize: async (path: string): Promise<number> => {
    return await invoke('calculate_item_size', { path });
  },
};
