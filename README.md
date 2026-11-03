# Norton Commander for macOS (NortonMac)

Un'applicazione desktop nativa per macOS che riproduce fedelmente l'esperienza, l'efficienza e l'estetica a doppio pannello del leggendario **Norton Commander**, compilata come **Universal Binary** per architetture **Apple Silicon** (M1/M2/M3/M4, `aarch64-apple-darwin`) e **Intel Mac** (`x86_64-apple-darwin`).

---

## Caratteristiche Principali

- **Design Retro DOS VGA**: Sfondo blu profondo (`#0000AA`), cornici nitide in stile ASCII/box-drawing, testo bianco/ciano e selezione file in giallo DOS.
- **Dual Pane Split View**: Due pannelli indipendenti con navigazione parallela, visualizzazione volumi montati, spazio libero su disco e dettagli POSIX.
- **Supporto macOS Nativo & Universal Binary**:
  - Binario fat Mach-O unico compilato per `aarch64` (Apple Silicon) e `x86_64` (Intel).
  - Pieno supporto a Full Disk Access e permessi di sistema in `Info.plist` (Desktop, Documenti, Download, Volumi esterni e di rete).
- **Virtual File System (VFS) per Archivi**:
  - Entra in file `.zip`, `.tar`, `.tar.gz`, `.tgz`, `.tar.bz2` come se fossero cartelle virtuali trasparenti, senza decomprimere l'intero archivio su disco.
  - Visualizzazione (F3) ed estrazione selettiva (F5) immediata di singoli file.
  - Creazione di archivi compressi `.zip` e `.tar.gz`.
- **Client SFTP / FTP Integrato**:
  - Montaggio di sessioni remote sul pannello desiderato (`sftp://` e `ftp://`).
  - Site Manager (F9) con salvataggio sicuro di server, credenziali, porte e chiavi private SSH (`id_ed25519` / `id_rsa`).
  - Copia bidirezionale trasparente (F5: Upload / Download) ed editing remoto (F4) con risincronizzazione al salvataggio.
- **Operazioni File Locali & macOS Trash**:
  - F5 Copia e F6 Spostamento/Rinomina asincroni e non bloccanti.
  - F7 Creazione cartella.
  - F8 Eliminazione con supporto al Cestino nativo di macOS (`trash`) o cancellazione definitiva.
  - F3 Visualizzatore rapido con toggle Testo / Hex Viewer (offset, byte esadecimali e decodifica ASCII).
  - F4 Editor testuale minimale con salvataggio rapido (`Cmd+S`).
- **Prompt / Shell Integrata**:
  - Terminale integrato nel percorso della cartella attiva per eseguire comandi shell unix (`ls`, `git`, ecc.).
- **Gestione File Nascosti**:
  - Scorciatoia nativa macOS `Cmd + .` (oppure `Ctrl + H`) per mostrare o nascondere all'istante i file e dotfiles Unix.

---

## Mappatura Tasti & Scorciatoie da Tastiera

| Tasto | Azione Norton Commander |
|---|---|
| **Tab** | Passaggio immediato del focus tra pannello sinistro e destro |
| **↑ / ↓** | Scorrimento riga per riga nel pannello attivo |
| **Enter** | Ingresso nella cartella/archivio o apertura file |
| **Backspace** / **..** | Risalita alla directory genitore |
| **Spazio** / **Insert** | Selezione multipla (evidenziazione in giallo) |
| **Cmd + .** / **Ctrl + H** | Mostra/Nascondi file nascosti e dotfiles |
| **F1** | Help e manuale comandi |
| **F2** | Menu principale e selezione Dischi/Volumi |
| **F3** | Visualizzatore rapido (Testo / Hex Viewer con Tab) |
| **F4** | Editor testuale (con Cmd+S per salvare) |
| **F5** | Copia file/cartelle (tra pannelli, da archivi o SFTP/FTP) |
| **F6** | Rinomina / Sposta elementi |
| **F7** | Crea nuova directory |
| **F8** | Elimina (Cestino macOS o definitivo) |
| **F9** | Site Manager SFTP / FTP |
| **F10** | Esci dall'applicazione |

> **Nota per tastiere Mac**: I tasti funzione funzionano sia con pressione diretta `F1..F10` (se configurati come tasti standard nelle impostazioni macOS) sia con la combinazione `Fn + F1..F10`. Tutti i tasti sono inoltre cliccabili direttamente con il mouse sulla barra inferiore.

---

## Avvio Rapido in Sviluppo (Dev Mode)

Assicurati di avere installato Node.js (v18+) e Rust (`cargo`, `rustc`).

```bash
# 1. Installazione dipendenze frontend
npm install

# 2. Avvio in modalità sviluppo con hot-reloading attivo
npm run tauri dev
```

---

## Compilazione macOS Universal Binary

Per generare l'applicazione `.app` compatibile con tutti i Mac (Apple Silicon M1-M4 e Intel):

```bash
# Esegui lo script automatizzato:
./build_universal.sh
```

Lo script effettuerà:
1. Verifica e installazione automatica dei target Rust `aarch64-apple-darwin` e `x86_64-apple-darwin`.
2. Compilazione del frontend React/TypeScript e dei binari Rust in modalità release per entrambe le architetture.
3. Fusione dei binari tramite `lipo` in un eseguibile Mach-O Fat Universal.
4. Generazione del bundle macOS `dist-macos/NortonMac.app` completo di `Info.plist` e icone `.icns`.
5. Verifica finale con `lipo -info` e firma ad-hoc.
