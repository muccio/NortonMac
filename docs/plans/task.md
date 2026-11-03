# NortonMac - Task Tracking

| Task ID | Description | Status | Verification |
|---|---|---|---|
| TASK-1 | Setup Tauri v2 + React/TypeScript/Tailwind project scaffolding | COMPLETED | Verified package.json, Cargo.toml, tauri.conf.json, icons |
| TASK-2 | Implement Rust backend (VFS, Local FS, Archives, SFTP/FTP, Shell, Trash) | COMPLETED | Verified cargo check on both aarch64 & x86_64 targets |
| TASK-3 | Implement Norton Commander Retro DOS UI & Split Pane Architecture | COMPLETED | Dual-panel layout, DOS color palette, ASCII box drawing |
| TASK-4 | Implement File Operations (F1-F10: Help, Menu, View/Hex, Edit, Copy, Move, MkDir, Delete/Trash, Connect, Quit) | COMPLETED | Full keyboard/click support, modals, Trash & FS ops |
| TASK-5 | Implement Virtual Archive Browsing & Selective Extraction | COMPLETED | Virtual VFS archive:// navigation, view and extract |
| TASK-6 | Implement SFTP / FTP Client & Site Manager (F9) | COMPLETED | Site config persistence, key/pass auth, remote ops |
| TASK-7 | Implement Shell Prompt & macOS Shortcut handling (Tab, Space, Cmd+., Fn keys) | COMPLETED | Interactive command drawer, Cmd+. dotfile toggle |
| TASK-8 | Create Universal Binary build script `build_universal.sh` and test build | COMPLETED | lipo -info confirms Mach-O universal binary (x86_64 & arm64) |
