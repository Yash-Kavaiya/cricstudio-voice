// Design themes: every background id also carries a full look — palette, typography, card
// shape and title treatment — applied to the shared drawing tokens before each frame.
import type { BackgroundId } from '@cricstudio/shared';
import { COL, FONT, THEME, type TitleStyle } from './draw';

type Palette = Partial<typeof COL>;
interface ThemeStyle {
  light?: boolean;
  col?: Palette;
  font?: { sans?: string; cond?: string };
  card?: Partial<Omit<typeof THEME, 'title' | 'light' | 'accent'>>;
  title?: TitleStyle;
}

const BASE_COL = { ...COL };
const BASE_FONT = { ...FONT };
const BASE_THEME = { ...THEME, shadow: THEME.shadow ? { ...THEME.shadow } : null };

const f = (...names: string[]) => [...names.map((n) => `"${n}"`), 'Roboto', 'Arial', 'sans-serif'].join(', ');
const BARLOW = { sans: f('Barlow'), cond: f('Barlow Condensed') };
const POPPINS = { sans: f('Poppins'), cond: f('Barlow Condensed') };
const SERIF_HEAD = { sans: f('Barlow'), cond: f('Source Serif 4') };

/** a dark glass card over photos, readable on any picture */
const PHOTO: ThemeStyle = {
  col: { card: 'rgba(6,10,22,0.58)', cardSolid: '#0d1426', cardHi: 'rgba(255,255,255,0.10)', sub: '#c9d2e6' },
  font: BARLOW,
  card: { stroke: 'rgba(255,255,255,0.14)', radius: 1.1, shadow: { color: 'rgba(0,0,0,0.5)', blur: 40, y: 14 } },
};

const STYLES: Partial<Record<BackgroundId, ThemeStyle>> = {
  /* brand-inspired */
  assemblyai: {
    light: true,
    col: { text: '#1d1b16', ink: '#1d1b16', sub: '#4a4945', dim: '#777673', card: '#ffffff', cardSolid: '#ffffff', cardHi: '#f5f3eb', line: 'rgba(29,27,22,0.10)' },
    font: { sans: f('Inter', 'Figtree'), cond: f('Inter', 'Figtree') },
    card: { radius: 1.0, stroke: 'rgba(29,27,22,0.10)', strokeW: 1, shadow: { color: 'rgba(57,35,199,0.10)', blur: 28, y: 8 } },
    title: 'bar',
  },
  microsoftFluent: {
    col: { card: 'rgba(44,46,58,0.62)', cardSolid: '#202028', cardHi: 'rgba(255,255,255,0.08)', sub: '#c8c8d0', dim: '#8a8a94', line: 'rgba(255,255,255,0.08)' },
    font: { sans: f('Segoe UI Variable Display', 'Segoe UI', 'Noto Sans'), cond: f('Segoe UI Variable Display', 'Segoe UI', 'Noto Sans') },
    card: { radius: 0.4, stroke: 'rgba(255,255,255,0.10)', strokeW: 1, shadow: { color: 'rgba(0,0,0,0.45)', blur: 32, y: 8 } },
    title: 'bar',
  },
  claudePaper: {
    light: true,
    col: { text: '#141413', ink: '#141413', sub: '#5e5d59', dim: '#8f8d86', card: '#faf9f5', cardSolid: '#faf9f5', cardHi: '#e8e4d8', line: 'rgba(20,20,19,0.12)' },
    font: { sans: f('Inter'), cond: f('Source Serif 4') },
    card: { radius: 0.65, stroke: 'rgba(20,20,19,0.10)', strokeW: 1, shadow: { color: 'rgba(20,20,19,0.08)', blur: 16, y: 4 } },
    title: 'rule',
  },
  xMono: {
    col: { text: '#e7e9ea', ink: '#e7e9ea', sub: '#71767b', dim: '#536471', card: 'rgba(22,24,28,0.92)', cardSolid: '#16181c', cardHi: '#202327', line: '#2f3336' },
    font: { sans: f('Chirp', 'Inter'), cond: f('Chirp', 'Inter') },
    card: { radius: 0.65, stroke: '#2f3336', strokeW: 1.5, shadow: null },
    title: 'plain',
  },

  /* cricket themes */
  worldCup23: {
    col: { card: 'rgba(255,255,255,0.08)', cardSolid: '#241266', sub: '#cbbcff', dim: '#8d7ccc', line: 'rgba(255,255,255,0.12)' },
    font: POPPINS,
    card: { radius: 1.3, stroke: 'rgba(255,255,255,0.10)' },
    title: 'pill',
  },
  lordsScoreboard: {
    col: { text: '#f2ebd3', ink: '#f2ebd3', sub: '#cdc6a6', dim: '#928c70', card: 'rgba(8,24,14,0.74)', cardSolid: '#0f2a1a', cardHi: 'rgba(242,235,211,0.08)', line: 'rgba(242,235,211,0.18)' },
    font: { sans: f('Oswald'), cond: f('Big Shoulders Display') },
    card: { radius: 0.15, stroke: 'rgba(242,235,211,0.35)', strokeW: 2, inset: 'rgba(242,235,211,0.14)', shadow: { color: 'rgba(0,0,0,0.5)', blur: 12, y: 6 } },
    title: 'rule',
  },
  iplNight: {
    col: { card: 'rgba(255,255,255,0.07)', cardSolid: '#1b1460', sub: '#c9cbf6' },
    font: { sans: f('Poppins'), cond: f('Oswald') },
    card: { radius: 0.9, stroke: 'rgba(255,179,0,0.35)' },
    title: 'bar',
  },
  bblNeon: {
    col: { card: 'rgba(0,0,0,0.6)', cardSolid: '#0d0d14', sub: '#c7c7d6', line: 'rgba(255,255,255,0.12)' },
    font: { sans: f('Barlow'), cond: f('Oswald') },
    card: { radius: 0.35, stroke: 'accent', strokeW: 2, glow: true },
    title: 'pill',
  },
  wtcFinal: {
    col: { card: 'rgba(6,20,46,0.62)', cardSolid: '#0b2350', sub: '#c8d1e2' },
    font: SERIF_HEAD,
    card: { radius: 0.5, stroke: 'rgba(212,175,55,0.45)' },
    title: 'rule',
  },
  womensWc: {
    col: { card: 'rgba(255,255,255,0.08)', cardSolid: '#3b1158', sub: '#e6cbf3', dim: '#a98bbd' },
    font: POPPINS,
    card: { radius: 1.4, stroke: null },
    title: 'pill',
  },
  ausGoldGreen: {
    col: { card: 'rgba(0,30,15,0.55)', cardSolid: '#003d1f', sub: '#d8e8ca' },
    font: BARLOW,
    card: { radius: 0.7, stroke: 'rgba(255,205,0,0.35)' },
  },
  ashes: {
    col: { card: 'rgba(10,10,15,0.58)', cardSolid: '#14141c', sub: '#dad2c6' },
    font: { sans: f('Barlow'), cond: f('Oswald') },
    card: { radius: 0.4, stroke: 'rgba(255,240,220,0.18)' },
    title: 'rule',
  },
  royalIvory: {
    col: { text: '#fbf3dc', ink: '#fbf3dc', sub: '#dccca2', dim: '#9f8f68', card: 'rgba(40,30,15,0.62)', cardSolid: '#2e2313', line: 'rgba(212,175,55,0.22)' },
    font: SERIF_HEAD,
    card: { radius: 0.3, stroke: 'rgba(212,175,55,0.5)', inset: 'rgba(212,175,55,0.18)' },
    title: 'rule',
  },
  electricBlue: {
    col: { card: 'rgba(0,30,80,0.4)', cardSolid: '#04154a', sub: '#a3ccff', line: 'rgba(0,180,255,0.2)' },
    font: { sans: f('Barlow'), cond: f('Saira Condensed') },
    card: { radius: 0.25, stroke: 'accent', strokeW: 1.5, glow: true },
    title: 'bar',
  },
  platinumPavilion: {
    col: { card: 'rgba(255,255,255,0.05)', cardSolid: '#25292f', sub: '#bcc3cf' },
    font: { sans: f('Inter'), cond: f('Barlow Condensed') },
    card: { radius: 0.6, stroke: 'rgba(220,225,235,0.24)', strokeW: 1, shadow: { color: 'rgba(0,0,0,0.5)', blur: 24, y: 8 } },
    title: 'rule',
  },
  usaStars: {
    col: { card: 'rgba(7,23,51,0.62)', cardSolid: '#0a1f44', sub: '#ccd5e8' },
    font: { sans: f('Barlow'), cond: f('Oswald') },
    card: { radius: 0.5, stroke: 'rgba(255,255,255,0.16)' },
  },
  proteasGreenGold: {
    col: { card: 'rgba(0,40,25,0.55)', cardSolid: '#004d2e', sub: '#d8eacf' },
    font: BARLOW,
    card: { radius: 0.8, stroke: 'rgba(255,182,18,0.35)' },
  },

  /* photos */
  photoFloodlit: PHOTO,
  photoSunsetOval: { ...PHOTO, font: POPPINS, title: 'pill' },
  photoRedSky: { ...PHOTO, font: { sans: f('Barlow'), cond: f('Oswald') } },
  photoMountain: { ...PHOTO, title: 'rule' },
  photoRedBall: { ...PHOTO, font: SERIF_HEAD, title: 'rule' },
  photoRainCovers: PHOTO,
  photoBigHit: { ...PHOTO, font: { sans: f('Barlow'), cond: f('Oswald') } },
  photoGrandstand: { ...PHOTO, title: 'rule' },
};

/** Fonts used by each theme, warmed up so the canvas never paints with a fallback for long. */
const loaded = new Set<string>();
function warmFonts(font: ThemeStyle['font']) {
  if (typeof document === 'undefined' || !document.fonts || !font) return;
  for (const fam of [font.sans, font.cond]) {
    const first = fam?.match(/"([^"]+)"/)?.[1];
    if (!first || loaded.has(first)) continue;
    loaded.add(first);
    for (const w of [400, 700, 800]) void document.fonts.load(`${w} 40px "${first}"`).catch(() => {});
  }
}

let current: string | null = null;
let currentAccent = '';

/** Point the drawing tokens at the theme for this background (cheap when nothing changed). */
export function applyTheme(id: BackgroundId | undefined, accent: string) {
  if (id === current && accent === currentAccent) return;
  current = id ?? null;
  currentAccent = accent;
  const st = (id && STYLES[id]) || {};
  Object.assign(COL, BASE_COL, st.col);
  Object.assign(FONT, BASE_FONT, st.font);
  Object.assign(THEME, BASE_THEME, { shadow: BASE_THEME.shadow ? { ...BASE_THEME.shadow } : null }, st.card, {
    light: !!st.light,
    title: st.title ?? 'bar',
    accent,
  });
  warmFonts(st.font);
}

/**
 * On-picture chrome (scorebug, ticker, lower thirds, captions, bubbles) sits on its own dark
 * plates, so light themes draw it with the dark palette while keeping their typography.
 */
export function withChrome(fn: () => void) {
  if (!THEME.light) return fn();
  const col = { ...COL };
  const light = THEME.light;
  Object.assign(COL, BASE_COL);
  THEME.light = false;
  try {
    fn();
  } finally {
    Object.assign(COL, col);
    THEME.light = light;
  }
}
