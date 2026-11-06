export interface FileEntry {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
  is_symlink: boolean;
  is_archive: boolean;
  modified: string;
  permissions: string;
  extension: string;
}

export interface DirectoryListing {
  path: string;
  display_path: string;
  is_virtual: boolean;
  archive_parent?: string;
  volume_name: string;
  total_space: number;
  free_space: number;
  entries: FileEntry[];
  show_hidden: boolean;
}

export interface VolumeInfo {
  name: string;
  mount_point: string;
  total_space: number;
  available_space: number;
  is_removable: boolean;
}

export interface HexLine {
  offset: string;
  hex_bytes: string;
  ascii: string;
}

export interface FilePreview {
  path: string;
  filename: string;
  size: number;
  is_binary: boolean;
  is_pdf?: boolean;
  media_type?: 'image' | 'audio' | 'video' | 'pdf';
  mime_type?: string;
  media_data_base64?: string;
  pdf_data_base64?: string;
  text_content?: string;
  hex_lines: HexLine[];
  encoding: string;
}

export interface ShellOutput {
  stdout: string;
  stderr: string;
  exit_code: number;
  current_dir: string;
}

export interface SiteConfig {
  id: string;
  name: string;
  protocol: 'sftp' | 'ftp' | 'ftps';
  host: string;
  port: number;
  username: string;
  password?: string;
  private_key_path?: string;
  default_path?: string;
}

export interface DiscoveredSite {
  id: string;
  source_app: string;
  file_path: string;
  site: SiteConfig;
}

export interface TransferProgress {
  operation: 'copy' | 'move' | 'duplicate' | string;
  current_file: string;
  files_done: number;
  total_files: number;
  bytes_done: number;
  total_bytes: number;
  percent: number;
}

export type SortField = 'name' | 'ext' | 'size' | 'modified' | 'permissions';
export type SortDirection = 'asc' | 'desc';

export interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

export type ActivePane = 'left' | 'right';
