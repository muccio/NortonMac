import React, { useState } from 'react';
import {
  ThemeColors,
  DEFAULT_THEME,
  THEME_PRESETS,
  applyThemeToDocument,
  normalizeHex,
} from '../../theme';

interface ThemeModalProps {
  initialTheme: ThemeColors;
  onSave: (theme: ThemeColors) => void;
  onClose: () => void;
}

type CategoryId = 'selection' | 'gui' | 'elements';

interface ColorFieldSpec {
  key: keyof ThemeColors;
  label: string;
  hint: string;
}

const SELECTION_FIELDS: ColorFieldSpec[] = [
  {
    key: 'cursorBg',
    label: 'Sfondo Barra Cursore',
    hint: 'Riga attualmente evidenziata dal cursore nel pannello attivo',
  },
  {
    key: 'cursorText',
    label: 'Testo Barra Cursore',
    hint: 'Colore del testo sulla riga del cursore attivo',
  },
  {
    key: 'markedText',
    label: 'Elemento Selezionato (Spazio ★)',
    hint: 'Colore di file e cartelle marcati con la barra spaziatrice',
  },
  {
    key: 'cursorMarkedBg',
    label: 'Sfondo Cursore + Selezionato',
    hint: 'Sfondo quando il cursore si trova sopra un elemento già selezionato',
  },
  {
    key: 'cursorMarkedText',
    label: 'Testo Cursore + Selezionato',
    hint: 'Testo quando il cursore si trova sopra un elemento selezionato',
  },
];

const GUI_FIELDS: ColorFieldSpec[] = [
  {
    key: 'blue',
    label: 'Sfondo Pannelli File',
    hint: 'Colore di fondo principale dei due pannelli e delle finestre',
  },
  {
    key: 'darkblue',
    label: 'Sfondo Intestazioni & Barre Stato',
    hint: 'Testata colonne, barra inferiore del pannello e riquadri interni',
  },
  {
    key: 'black',
    label: 'Sfondo Finestra & Terminale',
    hint: 'Cornice esterna, prompt shell e testo scuro ad alto contrasto',
  },
  {
    key: 'cyan',
    label: 'Barra Superiore & Bordi Standard',
    hint: 'Menu in alto, tasti funzione F1-F10 e bordo pannello inattivo',
  },
  {
    key: 'brightcyan',
    label: 'Bordo Pannello Attivo & Colonne',
    hint: 'Cornice del pannello con focus e titoli colonne (Name, Size...)',
  },
];

const ELEMENT_FIELDS: ColorFieldSpec[] = [
  {
    key: 'dirText',
    label: 'Cartelle [DIR]',
    hint: 'Colore del nome delle directory nella lista file',
  },
  {
    key: 'fileText',
    label: 'File Standard',
    hint: 'Colore dei file normali non selezionati',
  },
  {
    key: 'archiveText',
    label: 'Archivi Compressi (.zip/.tar)',
    hint: 'Colore dei pacchetti archivio navigabili',
  },
  {
    key: 'updirText',
    label: 'Riga Risalita [ .. ]',
    hint: 'Colore della voce [ .. ] per salire alla cartella superiore',
  },
  {
    key: 'yellow',
    label: 'Accenti, Percorsi & Totali',
    hint: 'Percorso attivo, conteggio byte selezionati e badge evidenziati',
  },
  {
    key: 'white',
    label: 'Testo Chiaro Generale',
    hint: 'Testi primari delle finestre di dialogo e pulsanti',
  },
  {
    key: 'gray',
    label: 'Testo Secondario / Info',
    hint: 'Metadati secondari, date, permessi e suggerimenti',
  },
  {
    key: 'red',
    label: 'Rosso Avvisi / Eliminazione',
    hint: 'Pulsanti critici (Delete / Esc) e notifiche errore',
  },
  {
    key: 'brightred',
    label: 'Rosso Brillante / Errori',
    hint: 'Bordi finestre di errore e output stderr shell',
  },
  {
    key: 'brightgreen',
    label: 'Verde Output Terminale',
    hint: 'Output stdout della shell integrata e conferme',
  },
];

export const ThemeModal: React.FC<ThemeModalProps> = ({
  initialTheme,
  onSave,
  onClose,
}) => {
  const [draft, setDraft] = useState<ThemeColors>({ ...initialTheme });
  const [activeTab, setActiveTab] = useState<CategoryId>('selection');
  const [statusMsg, setStatusMsg] = useState<string>('');

  const updateColor = (key: keyof ThemeColors, value: string) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    if (/^#[0-9a-fA-F]{6}$/.test(value.trim())) {
      applyThemeToDocument(next);
    }
  };

  const applyPreset = (colors: ThemeColors, presetName: string) => {
    const next = { ...colors };
    setDraft(next);
    applyThemeToDocument(next);
    setStatusMsg(`Preset "${presetName}" applicato in anteprima.`);
    setTimeout(() => setStatusMsg(''), 2500);
  };

  const handleCancel = () => {
    // Revert live preview back to initial saved theme
    applyThemeToDocument(initialTheme);
    onClose();
  };

  const handleConfirmSave = () => {
    const sanitized: ThemeColors = { ...DEFAULT_THEME };
    (Object.keys(DEFAULT_THEME) as Array<keyof ThemeColors>).forEach((k) => {
      sanitized[k] = normalizeHex(draft[k], DEFAULT_THEME[k]);
    });
    applyThemeToDocument(sanitized);
    onSave(sanitized);
    onClose();
  };

  const handleExportTheme = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'norton-mac-theme.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportTheme = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(String(evt.target?.result || '{}'));
        const next: ThemeColors = { ...draft };
        (Object.keys(DEFAULT_THEME) as Array<keyof ThemeColors>).forEach((k) => {
          if (typeof parsed[k] === 'string') {
            next[k] = normalizeHex(parsed[k], draft[k]);
          }
        });
        setDraft(next);
        applyThemeToDocument(next);
        setStatusMsg(`Tema importato da ${file.name}`);
        setTimeout(() => setStatusMsg(''), 3000);
      } catch {
        setStatusMsg('File JSON tema non valido.');
      }
    };
    reader.readAsText(file);
  };

  const activeFields =
    activeTab === 'selection'
      ? SELECTION_FIELDS
      : activeTab === 'gui'
      ? GUI_FIELDS
      : ELEMENT_FIELDS;

  return (
    <div className="fixed inset-0 bg-nc-black/85 flex items-center justify-center p-3 z-50 font-mono select-none">
      <div className="bg-nc-blue border-4 border-nc-brightcyan text-nc-white w-full max-w-5xl h-[86vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="bg-nc-cyan text-nc-black px-3 py-1.5 font-bold flex justify-between items-center text-xs">
          <div className="flex items-center space-x-2">
            <span className="bg-nc-yellow text-nc-black px-1.5 py-0.5 font-black">
              🎨 THEME
            </span>
            <span>EDITOR COLORI GUI, CURSORE &amp; SELEZIONE</span>
          </div>
          <button
            onClick={handleCancel}
            className="bg-nc-red text-nc-white hover:bg-nc-brightred px-2.5 py-0.5 font-bold"
          >
            ✕ ESC
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 grid grid-cols-12 gap-3 p-3 overflow-hidden">
          {/* Left Column: Presets + Live Mini Preview */}
          <div className="col-span-5 flex flex-col space-y-3 overflow-hidden">
            {/* Presets */}
            <div className="bg-nc-darkblue border border-nc-cyan p-2.5 flex-1 flex flex-col overflow-hidden">
              <div className="text-nc-yellow font-bold text-xs border-b border-nc-cyan/40 pb-1 mb-2">
                PALETTE PREDEFINITE (1-CLICK)
              </div>
              <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                {THEME_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => applyPreset(preset.colors, preset.name)}
                    className="w-full text-left p-2 border border-nc-cyan/40 hover:border-nc-brightcyan bg-nc-blue/60 hover:bg-nc-blue transition-colors flex items-center justify-between group"
                  >
                    <div className="pr-2 overflow-hidden">
                      <div className="text-xs font-bold text-nc-white group-hover:text-nc-yellow truncate">
                        {preset.name}
                      </div>
                      <div className="text-[10px] text-nc-gray truncate">
                        {preset.description}
                      </div>
                    </div>
                    {/* Mini Swatch Strip */}
                    <div className="flex space-x-0.5 flex-shrink-0 border border-white/30 p-0.5 bg-black">
                      <span
                        className="w-3 h-4 block"
                        style={{ backgroundColor: preset.colors.blue }}
                        title="Sfondo"
                      />
                      <span
                        className="w-3 h-4 block"
                        style={{ backgroundColor: preset.colors.cursorBg }}
                        title="Cursore"
                      />
                      <span
                        className="w-3 h-4 block"
                        style={{ backgroundColor: preset.colors.markedText }}
                        title="Selezione"
                      />
                      <span
                        className="w-3 h-4 block"
                        style={{ backgroundColor: preset.colors.dirText }}
                        title="Cartelle"
                      />
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Live Interactive Preview Box */}
            <div className="border-2 border-nc-brightcyan bg-nc-blue text-[11px] shadow-inner">
              <div className="bg-nc-cyan text-nc-black px-2 py-0.5 font-bold flex justify-between border-b border-nc-cyan">
                <span>
                  ANTEPRIMA LIVE: <span className="text-nc-yellow">~/Progetti</span>
                </span>
                <span className="bg-nc-darkblue text-nc-white px-1 text-[10px]">
                  MAC HD
                </span>
              </div>
              <div className="bg-nc-darkblue text-nc-brightcyan font-bold grid grid-cols-12 px-2 py-0.5 border-b border-nc-cyan text-[10px]">
                <div className="col-span-7">Name</div>
                <div className="col-span-5 text-right">Size</div>
              </div>
              <div className="divide-y divide-transparent">
                <div className="grid grid-cols-12 px-2 py-0.5 text-nc-updir font-bold">
                  <div className="col-span-8">▲ [ .. ]</div>
                  <div className="col-span-4 text-right">&lt;UP-DIR&gt;</div>
                </div>
                <div className="grid grid-cols-12 px-2 py-0.5 text-nc-dir font-bold">
                  <div className="col-span-8">📁 [Documenti]</div>
                  <div className="col-span-4 text-right">&lt;DIR&gt;</div>
                </div>
                <div className="grid grid-cols-12 px-2 py-0.5 text-nc-marked font-bold">
                  <div className="col-span-8">★ 📁 [ Sorgenti ]</div>
                  <div className="col-span-4 text-right">142.8M</div>
                </div>
                <div className="grid grid-cols-12 px-2 py-0.5 bg-nc-cursorbg text-nc-cursortext font-bold">
                  <div className="col-span-8">▶ app_config.toml</div>
                  <div className="col-span-4 text-right">12k</div>
                </div>
                <div className="grid grid-cols-12 px-2 py-0.5 bg-nc-cursormarkedbg text-nc-cursormarkedtext font-bold">
                  <div className="col-span-8">★ release_universal.zip</div>
                  <div className="col-span-4 text-right">20.7M</div>
                </div>
                <div className="grid grid-cols-12 px-2 py-0.5 text-nc-archive font-bold">
                  <div className="col-span-8">📦 backup_2026.tar.gz</div>
                  <div className="col-span-4 text-right">8.4M</div>
                </div>
                <div className="grid grid-cols-12 px-2 py-0.5 text-nc-file">
                  <div className="col-span-8">README.md</div>
                  <div className="col-span-4 text-right">4,120</div>
                </div>
              </div>
              <div className="bg-nc-darkblue text-nc-yellow px-2 py-0.5 border-t border-nc-cyan flex justify-between text-[10px] font-bold">
                <span>2 selected (163.5 MB)</span>
                <span className="text-nc-white">Free: 248.1 GB</span>
              </div>
            </div>
          </div>

          {/* Right Column: Granular Color Pickers */}
          <div className="col-span-7 bg-nc-darkblue border border-nc-cyan p-3 flex flex-col overflow-hidden">
            {/* Category Tabs */}
            <div className="grid grid-cols-3 gap-1.5 border-b border-nc-cyan pb-2.5 mb-3 text-xs">
              <button
                onClick={() => setActiveTab('selection')}
                className={`py-1.5 px-2 font-black border transition-colors ${
                  activeTab === 'selection'
                    ? 'bg-nc-yellow text-nc-black border-nc-white'
                    : 'bg-nc-blue text-nc-white border-nc-cyan hover:bg-nc-cyan hover:text-nc-black'
                }`}
              >
                🎯 CURSORE &amp; SELEZIONE
              </button>
              <button
                onClick={() => setActiveTab('gui')}
                className={`py-1.5 px-2 font-black border transition-colors ${
                  activeTab === 'gui'
                    ? 'bg-nc-yellow text-nc-black border-nc-white'
                    : 'bg-nc-blue text-nc-white border-nc-cyan hover:bg-nc-cyan hover:text-nc-black'
                }`}
              >
                🖥️ PANNELLI &amp; GUI
              </button>
              <button
                onClick={() => setActiveTab('elements')}
                className={`py-1.5 px-2 font-black border transition-colors ${
                  activeTab === 'elements'
                    ? 'bg-nc-yellow text-nc-black border-nc-white'
                    : 'bg-nc-blue text-nc-white border-nc-cyan hover:bg-nc-cyan hover:text-nc-black'
                }`}
              >
                📁 FILE, CARTELLE &amp; TESTI
              </button>
            </div>

            {/* Color Rows */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {activeFields.map((field) => {
                const currentVal = draft[field.key];
                const pickerVal = /^#[0-9a-fA-F]{6}$/.test(currentVal)
                  ? currentVal
                  : normalizeHex(currentVal, DEFAULT_THEME[field.key]);
                const isModified =
                  pickerVal.toUpperCase() !== DEFAULT_THEME[field.key].toUpperCase();

                return (
                  <div
                    key={field.key}
                    className="bg-nc-blue/80 border border-nc-cyan/40 p-2 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-nc-white flex items-center space-x-2">
                        <span>{field.label}</span>
                        {isModified && (
                          <span className="text-[9px] bg-nc-yellow text-nc-black px-1 font-black">
                            CUSTOM
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-nc-gray truncate">
                        {field.hint}
                      </div>
                    </div>

                    <div className="flex items-center space-x-2 flex-shrink-0">
                      <input
                        type="color"
                        value={pickerVal}
                        onChange={(e) => updateColor(field.key, e.target.value.toUpperCase())}
                        className="w-9 h-7 p-0 border-2 border-nc-white bg-transparent cursor-pointer"
                        title={`Scegli colore per ${field.label}`}
                      />
                      <input
                        type="text"
                        value={currentVal}
                        maxLength={7}
                        onChange={(e) => updateColor(field.key, e.target.value)}
                        onBlur={() =>
                          updateColor(
                            field.key,
                            normalizeHex(currentVal, DEFAULT_THEME[field.key])
                          )
                        }
                        className="w-20 bg-nc-black text-nc-yellow border border-nc-cyan px-1.5 py-1 text-xs font-mono uppercase outline-none text-center"
                      />
                      <button
                        type="button"
                        onClick={() => updateColor(field.key, DEFAULT_THEME[field.key])}
                        disabled={!isModified}
                        title="Ripristina valore originale DOS"
                        className="px-1.5 py-1 text-xs border border-nc-cyan/50 bg-nc-darkblue text-nc-brightcyan hover:bg-nc-cyan hover:text-nc-black disabled:opacity-30 font-bold"
                      >
                        ↺
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Status Message */}
        {statusMsg && (
          <div className="bg-nc-yellow text-nc-black px-3 py-1 text-center text-xs font-bold">
            {statusMsg}
          </div>
        )}

        {/* Footer Actions */}
        <div className="bg-nc-cyan text-nc-black px-3 py-1.5 text-xs font-bold flex justify-between items-center border-t border-nc-brightcyan">
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => applyPreset(DEFAULT_THEME, 'Norton Classic (DOS 5.0)')}
              className="bg-nc-darkblue text-nc-white hover:bg-nc-black px-3 py-1 border border-nc-white"
            >
              ↺ Reset Default DOS
            </button>
            <button
              type="button"
              onClick={handleExportTheme}
              className="bg-nc-blue text-nc-white hover:bg-nc-darkblue px-2.5 py-1 border border-nc-black"
            >
              📤 Esporta Tema
            </button>
            <label className="bg-nc-blue text-nc-white hover:bg-nc-darkblue px-2.5 py-1 border border-nc-black cursor-pointer">
              📥 Importa Tema
              <input
                type="file"
                accept=".json"
                onChange={handleImportTheme}
                className="hidden"
              />
            </label>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={handleCancel}
              className="bg-nc-red text-nc-white hover:bg-nc-brightred px-4 py-1 font-bold"
            >
              Annulla (ESC)
            </button>
            <button
              type="button"
              onClick={handleConfirmSave}
              className="bg-nc-yellow text-nc-black hover:bg-nc-white px-5 py-1 font-black border-2 border-nc-black shadow"
            >
              ✓ SALVA COLORI
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
