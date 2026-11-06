export interface ThemeColors {
  // GUI & Panels
  blue: string;          // Sfondo Pannello principale
  darkblue: string;      // Sfondo Intestazioni / Colonne / Status Bar
  black: string;         // Sfondo Finestra / Shell / Contrasto scuro
  cyan: string;          // Barra superiore, Tasti Funzione, Bordo inattivo
  brightcyan: string;    // Bordo Pannello attivo & Titoli colonne
  // Cursor & Selection (Space)
  cursorBg: string;         // Sfondo riga cursore attivo
  cursorText: string;       // Testo riga cursore attivo
  markedText: string;       // Colore elementi selezionati (Spazio ★)
  cursorMarkedBg: string;   // Sfondo cursore su elemento selezionato
  cursorMarkedText: string; // Testo cursore su elemento selezionato
  // Items & Accents
  dirText: string;       // Colore cartelle [DIR]
  fileText: string;      // Colore file standard
  archiveText: string;   // Colore archivi compressi (.zip, .tar.gz)
  updirText: string;     // Colore riga superiore [ .. ]
  white: string;         // Testo generale chiaro
  yellow: string;        // Evidenziazione percorsi, totali, badge
  gray: string;          // Testo secondario / info
  darkgray: string;      // Ombre / elementi disabilitati
  red: string;           // Sfondo avvisi / pulsanti pericolo
  brightred: string;     // Bordi errore / stderr
  green: string;         // Conferme / badge positivi
  brightgreen: string;   // Output stdout terminale
}

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  colors: ThemeColors;
}

export const DEFAULT_THEME: ThemeColors = {
  blue: '#0000AA',
  darkblue: '#000080',
  black: '#000000',
  cyan: '#00AAAA',
  brightcyan: '#55FFFF',
  cursorBg: '#00AAAA',
  cursorText: '#000000',
  markedText: '#FFFF55',
  cursorMarkedBg: '#55FFFF',
  cursorMarkedText: '#AA0000',
  dirText: '#FFFFFF',
  fileText: '#FFFFFF',
  archiveText: '#55FFFF',
  updirText: '#55FFFF',
  white: '#FFFFFF',
  yellow: '#FFFF55',
  gray: '#AAAAAA',
  darkgray: '#555555',
  red: '#AA0000',
  brightred: '#FF5555',
  green: '#00AA00',
  brightgreen: '#55FF55',
};

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'norton-classic',
    name: 'Norton Classic (DOS 5.0)',
    description: 'Palette originale blu profondo CGA/VGA con cursore ciano e selezione gialla',
    colors: DEFAULT_THEME,
  },
  {
    id: 'midnight-dark',
    name: 'Midnight Pro Dark',
    description: 'Blu notte ad alto riposo visivo con cursore azzurro elettrico e oro',
    colors: {
      blue: '#0B192C',
      darkblue: '#06101E',
      black: '#02060D',
      cyan: '#1E88E5',
      brightcyan: '#64B5F6',
      cursorBg: '#29B6F6',
      cursorText: '#02060D',
      markedText: '#FFD54F',
      cursorMarkedBg: '#FFD54F',
      cursorMarkedText: '#0B192C',
      dirText: '#E3F2FD',
      fileText: '#B0BEC5',
      archiveText: '#80DEEA',
      updirText: '#64B5F6',
      white: '#ECEFF1',
      yellow: '#FFD54F',
      gray: '#78909C',
      darkgray: '#37474F',
      red: '#C62828',
      brightred: '#FF5252',
      green: '#2E7D32',
      brightgreen: '#69F0AE',
    },
  },
  {
    id: 'amber-crt',
    name: 'Amber Phosphor CRT',
    description: 'Monitor monocromatico ai fosfori ambra anni ’80',
    colors: {
      blue: '#160D00',
      darkblue: '#0D0700',
      black: '#050300',
      cyan: '#CC7A00',
      brightcyan: '#FFB000',
      cursorBg: '#FFB000',
      cursorText: '#120900',
      markedText: '#FFE066',
      cursorMarkedBg: '#FFE066',
      cursorMarkedText: '#4A1500',
      dirText: '#FFCC33',
      fileText: '#E69900',
      archiveText: '#FFD666',
      updirText: '#FFB000',
      white: '#FFCC33',
      yellow: '#FFE580',
      gray: '#996300',
      darkgray: '#4D3200',
      red: '#992600',
      brightred: '#FF5500',
      green: '#806000',
      brightgreen: '#FFD000',
    },
  },
  {
    id: 'ibm-green',
    name: 'IBM 5151 Green Matrix',
    description: 'Terminale classico ai fosfori verdi P39 su sfondo nero',
    colors: {
      blue: '#041406',
      darkblue: '#020B03',
      black: '#000501',
      cyan: '#00AA44',
      brightcyan: '#33FF77',
      cursorBg: '#00DD55',
      cursorText: '#001102',
      markedText: '#CCFF33',
      cursorMarkedBg: '#AAFF44',
      cursorMarkedText: '#002205',
      dirText: '#66FF99',
      fileText: '#22CC55',
      archiveText: '#88FFCC',
      updirText: '#33FF77',
      white: '#55FF88',
      yellow: '#CCFF33',
      gray: '#1A7A3A',
      darkgray: '#0C3D1D',
      red: '#881111',
      brightred: '#FF4444',
      green: '#00AA44',
      brightgreen: '#66FF99',
    },
  },
  {
    id: 'nord-arctic',
    name: 'Nord / Arctic Slate',
    description: 'Palette scandinava moderna e riposante a contrasto bilanciato',
    colors: {
      blue: '#2E3440',
      darkblue: '#242933',
      black: '#1B1F27',
      cyan: '#5E81AC',
      brightcyan: '#88C0D0',
      cursorBg: '#88C0D0',
      cursorText: '#1B1F27',
      markedText: '#EBCB8B',
      cursorMarkedBg: '#EBCB8B',
      cursorMarkedText: '#2E3440',
      dirText: '#ECEFF4',
      fileText: '#D8DEE9',
      archiveText: '#B48EAD',
      updirText: '#81A1C1',
      white: '#ECEFF4',
      yellow: '#EBCB8B',
      gray: '#9099AB',
      darkgray: '#4C566A',
      red: '#BF616A',
      brightred: '#D08770',
      green: '#A3BE8C',
      brightgreen: '#A3BE8C',
    },
  },
  {
    id: 'dracula-cyber',
    name: 'Dracula / Cyberpunk',
    description: 'Tema scuro moderno con accenti viola neon, ciano e rosa',
    colors: {
      blue: '#282A36',
      darkblue: '#1E1F29',
      black: '#14151C',
      cyan: '#6272A4',
      brightcyan: '#8BE9FD',
      cursorBg: '#BD93F9',
      cursorText: '#14151C',
      markedText: '#FF79C6',
      cursorMarkedBg: '#FF79C6',
      cursorMarkedText: '#14151C',
      dirText: '#8BE9FD',
      fileText: '#F8F8F2',
      archiveText: '#FFB86C',
      updirText: '#BD93F9',
      white: '#F8F8F2',
      yellow: '#F1FA8C',
      gray: '#929FCF',
      darkgray: '#44475A',
      red: '#BD2C40',
      brightred: '#FF5555',
      green: '#2EA043',
      brightgreen: '#50FA7B',
    },
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    description: 'Classica palette ingegneristica Ethan Schoonover su petrolio scuro',
    colors: {
      blue: '#002B36',
      darkblue: '#073642',
      black: '#001E26',
      cyan: '#2AA198',
      brightcyan: '#268BD2',
      cursorBg: '#2AA198',
      cursorText: '#002B36',
      markedText: '#B58900',
      cursorMarkedBg: '#CB4B16',
      cursorMarkedText: '#FDF6E3',
      dirText: '#EEE8D5',
      fileText: '#93A1A1',
      archiveText: '#6C71C4',
      updirText: '#268BD2',
      white: '#FDF6E3',
      yellow: '#B58900',
      gray: '#839496',
      darkgray: '#586E75',
      red: '#DC322F',
      brightred: '#CB4B16',
      green: '#859900',
      brightgreen: '#859900',
    },
  },
];

const STORAGE_KEY = 'norton_mac_theme_v1';

export function normalizeHex(hex: string, fallback = '#0000AA'): string {
  const clean = hex.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(clean)) {
    return clean.toUpperCase();
  }
  if (/^#[0-9a-fA-F]{3}$/.test(clean)) {
    const r = clean[1];
    const g = clean[2];
    const b = clean[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return fallback;
}

export function hexToRgbTriplet(hex: string): string {
  const valid = normalizeHex(hex);
  const r = parseInt(valid.slice(1, 3), 16);
  const g = parseInt(valid.slice(3, 5), 16);
  const b = parseInt(valid.slice(5, 7), 16);
  return `${r} ${g} ${b}`;
}

const CSS_VAR_MAP: Record<keyof ThemeColors, string> = {
  blue: '--nc-blue-rgb',
  darkblue: '--nc-darkblue-rgb',
  black: '--nc-black-rgb',
  cyan: '--nc-cyan-rgb',
  brightcyan: '--nc-brightcyan-rgb',
  cursorBg: '--nc-cursor-bg-rgb',
  cursorText: '--nc-cursor-text-rgb',
  markedText: '--nc-marked-text-rgb',
  cursorMarkedBg: '--nc-cursor-marked-bg-rgb',
  cursorMarkedText: '--nc-cursor-marked-text-rgb',
  dirText: '--nc-dir-text-rgb',
  fileText: '--nc-file-text-rgb',
  archiveText: '--nc-archive-text-rgb',
  updirText: '--nc-updir-text-rgb',
  white: '--nc-white-rgb',
  yellow: '--nc-yellow-rgb',
  gray: '--nc-gray-rgb',
  darkgray: '--nc-darkgray-rgb',
  red: '--nc-red-rgb',
  brightred: '--nc-brightred-rgb',
  green: '--nc-green-rgb',
  brightgreen: '--nc-brightgreen-rgb',
};

export function applyThemeToDocument(theme: ThemeColors): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  (Object.keys(CSS_VAR_MAP) as Array<keyof ThemeColors>).forEach((key) => {
    const cssVar = CSS_VAR_MAP[key];
    const hex = theme[key] || DEFAULT_THEME[key];
    root.style.setProperty(cssVar, hexToRgbTriplet(hex));
  });
}

export function loadSavedTheme(): ThemeColors {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_THEME };
    const parsed = JSON.parse(raw);
    const merged: ThemeColors = { ...DEFAULT_THEME };
    (Object.keys(DEFAULT_THEME) as Array<keyof ThemeColors>).forEach((k) => {
      if (typeof parsed[k] === 'string') {
        merged[k] = normalizeHex(parsed[k], DEFAULT_THEME[k]);
      }
    });
    return merged;
  } catch {
    return { ...DEFAULT_THEME };
  }
}

export function saveThemeToStorage(theme: ThemeColors): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  } catch (e) {
    console.error('Failed to persist theme:', e);
  }
}
