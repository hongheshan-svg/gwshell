import type { ITheme } from '@xterm/xterm';
import type { ThemeMode } from '../types';

// NOTE: these are plain objects (not annotated `: ITheme`) so excess-property
// checks don't fire on the scrollbar fields; they're returned as ITheme below,
// where assignability (not literal excess checking) applies — matching the
// previous getTerminalThemeColors pattern.

const AUTO_DARK = {
  background: '#0d0e12', foreground: '#e7e9f0', cursor: '#a8a8b3', cursorAccent: '#0d0e12',
  selectionBackground: 'rgba(99, 102, 241, 0.28)',
  black: '#1a1a28', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
  blue: '#5ac8fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#d4d4d8',
  brightBlack: '#555570', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5',
  brightBlue: '#7dd6fc', brightMagenta: '#d8b4fe', brightCyan: '#67e8f9', brightWhite: '#ffffff',
  scrollbarSliderBackground: 'rgba(255, 255, 255, 0.18)',
  scrollbarSliderHoverBackground: 'rgba(255, 255, 255, 0.32)',
  scrollbarSliderActiveBackground: 'rgba(255, 255, 255, 0.46)',
};

const AUTO_LIGHT = {
  background: '#ffffff', foreground: '#1a1c23', cursor: '#6e6e7a', cursorAccent: '#ffffff',
  selectionBackground: 'rgba(79, 70, 229, 0.18)',
  black: '#1a1a2e', red: '#dc2626', green: '#16a34a', yellow: '#ca8a04',
  blue: '#0078d4', magenta: '#9333ea', cyan: '#0891b2', white: '#d4d4d8',
  brightBlack: '#8888a0', brightRed: '#ef4444', brightGreen: '#22c55e', brightYellow: '#eab308',
  brightBlue: '#2a8de6', brightMagenta: '#a855f7', brightCyan: '#06b6d4', brightWhite: '#ffffff',
  scrollbarSliderBackground: 'rgba(0, 0, 0, 0.18)',
  scrollbarSliderHoverBackground: 'rgba(0, 0, 0, 0.30)',
  scrollbarSliderActiveBackground: 'rgba(0, 0, 0, 0.42)',
};

const DARK_SCROLLBAR = {
  scrollbarSliderBackground: 'rgba(255, 255, 255, 0.18)',
  scrollbarSliderHoverBackground: 'rgba(255, 255, 255, 0.32)',
  scrollbarSliderActiveBackground: 'rgba(255, 255, 255, 0.46)',
};
const LIGHT_SCROLLBAR = {
  scrollbarSliderBackground: 'rgba(0, 0, 0, 0.18)',
  scrollbarSliderHoverBackground: 'rgba(0, 0, 0, 0.30)',
  scrollbarSliderActiveBackground: 'rgba(0, 0, 0, 0.42)',
};

const CAMPBELL = {
  background: '#0c0c0c', foreground: '#cccccc', cursor: '#cccccc', cursorAccent: '#0c0c0c',
  selectionBackground: 'rgba(204, 204, 204, 0.3)',
  black: '#0c0c0c', red: '#c50f1f', green: '#13a10e', yellow: '#c19c00',
  blue: '#0037da', magenta: '#881798', cyan: '#3a96dd', white: '#cccccc',
  brightBlack: '#767676', brightRed: '#e74856', brightGreen: '#16c60c', brightYellow: '#f9f1a5',
  brightBlue: '#3b78ff', brightMagenta: '#b4009e', brightCyan: '#61d6d6', brightWhite: '#f2f2f2',
  ...DARK_SCROLLBAR,
};

const ONEDARK = {
  background: '#282c34', foreground: '#abb2bf', cursor: '#528bff', cursorAccent: '#282c34',
  selectionBackground: 'rgba(171, 178, 191, 0.3)',
  black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
  blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
  brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#e5c07b',
  brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#ffffff',
  ...DARK_SCROLLBAR,
};

const DRACULA = {
  background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', cursorAccent: '#282a36',
  selectionBackground: 'rgba(248, 248, 242, 0.25)',
  black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
  blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
  brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5',
  brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff',
  ...DARK_SCROLLBAR,
};

const SOLARIZED_DARK = {
  background: '#002b36', foreground: '#839496', cursor: '#839496', cursorAccent: '#002b36',
  selectionBackground: 'rgba(131, 148, 150, 0.3)',
  black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
  blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
  brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83',
  brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
  ...DARK_SCROLLBAR,
};

const SOLARIZED_LIGHT = {
  background: '#fdf6e3', foreground: '#657b83', cursor: '#657b83', cursorAccent: '#fdf6e3',
  selectionBackground: 'rgba(101, 123, 131, 0.2)',
  black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
  blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
  brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83',
  brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
  ...LIGHT_SCROLLBAR,
};

const NORD = {
  background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9', cursorAccent: '#2e3440',
  selectionBackground: 'rgba(216, 222, 233, 0.25)',
  black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
  blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
  brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b',
  brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#eceff4',
  ...DARK_SCROLLBAR,
};

// Preset registry (excludes 'auto', which follows the app light/dark theme).
export const TERMINAL_THEMES: Record<string, ITheme> = {
  campbell: CAMPBELL,
  onedark: ONEDARK,
  dracula: DRACULA,
  'solarized-dark': SOLARIZED_DARK,
  'solarized-light': SOLARIZED_LIGHT,
  nord: NORD,
};

// Order shown in the settings dropdown.
export const TERMINAL_SCHEME_OPTIONS: string[] = [
  'auto', 'campbell', 'onedark', 'dracula', 'solarized-dark', 'solarized-light', 'nord',
];

// Resolves a scheme name to an xterm ITheme. 'auto' (and unknown values) follow
// the app's light/dark theme.
export function resolveTerminalTheme(scheme: string, appTheme: ThemeMode): ITheme {
  if (scheme && scheme !== 'auto' && TERMINAL_THEMES[scheme]) {
    return TERMINAL_THEMES[scheme];
  }
  return appTheme === 'dark' ? AUTO_DARK : AUTO_LIGHT;
}
