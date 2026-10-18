import { alpha, createTheme, type PaletteMode } from '@mui/material';

// AssemblyAI brand tokens (assemblyai.com): warm paper background, ink text, cobalt accent, mono labels.
export const AAI = {
  cobalt: '#3923c7',
  cobalt400: '#614fd2',
  cobalt300: '#887bdd',
  cobalt100: '#d7d3f4',
  ink: '#1d1b16',
  text: '#4a4945',
  muted: '#777673',
  faint: '#a5a4a2',
  paper: '#fdfcf8',
  cream: '#f5f3eb',
  line: '#ecebe5',
  border: '#c7c3b2',
  green: '#2d915c',
  blush: '#ec9d92',
  error: '#f04438',
  mono: '"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  sans: '"Inter", "Helvetica Neue", Arial, sans-serif',
};
/** @deprecated legacy alias kept for older components */
export const G = { blue: AAI.cobalt, blueDark: AAI.cobalt300, red: AAI.error, yellow: '#e3b341', green: AAI.green, purple: AAI.cobalt400, grey: AAI.muted };

export function makeTheme(mode: PaletteMode) {
  const dark = mode === 'dark';
  return createTheme({
    palette: {
      mode,
      primary: { main: dark ? AAI.cobalt300 : AAI.cobalt, contrastText: dark ? AAI.ink : '#fff' },
      secondary: { main: dark ? '#6dab89' : AAI.green },
      error: { main: AAI.error },
      warning: { main: dark ? '#f2c66d' : '#b7791f' },
      success: { main: dark ? '#6dab89' : AAI.green },
      background: dark ? { default: '#12110e', paper: '#1d1b16' } : { default: AAI.paper, paper: '#ffffff' },
      text: dark ? { primary: '#f5f3eb', secondary: '#a5a4a2' } : { primary: AAI.ink, secondary: AAI.text },
      divider: dark ? 'rgba(245,243,235,0.12)' : AAI.line,
    },
    shape: { borderRadius: 10 },
    typography: {
      fontFamily: AAI.sans,
      h3: { fontWeight: 500, letterSpacing: '-0.03em' },
      h4: { fontWeight: 500, letterSpacing: '-0.02em' },
      h5: { fontWeight: 500, letterSpacing: '-0.01em' },
      h6: { fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 600, letterSpacing: 0 },
      subtitle2: { fontWeight: 600 },
      overline: { fontFamily: AAI.mono, letterSpacing: '0.08em', fontWeight: 500 },
      caption: { letterSpacing: 0 },
    },
    components: {
      MuiCssBaseline: { styleOverrides: { body: { fontFeatureSettings: '"ss01", "cv11"' } } },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: 999, paddingInline: 18 },
          containedPrimary: dark ? {} : { backgroundColor: AAI.ink, '&:hover': { backgroundColor: AAI.cobalt } },
          outlined: ({ theme }) => ({ borderColor: theme.palette.divider, color: theme.palette.text.primary, '&:hover': { borderColor: theme.palette.primary.main } }),
        },
      },
      MuiChip: { styleOverrides: { root: { borderRadius: 6, fontWeight: 500, fontFamily: AAI.mono, fontSize: 11, letterSpacing: '0.02em' } } },
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: ({ theme }) => ({ border: `1px solid ${theme.palette.divider}`, borderRadius: 14 }) },
      },
      MuiPaper: { styleOverrides: { rounded: { borderRadius: 14 }, outlined: ({ theme }) => ({ borderColor: theme.palette.divider }) } },
      MuiDialog: { styleOverrides: { paper: { borderRadius: 18 } } },
      MuiTab: { styleOverrides: { root: { textTransform: 'none', minHeight: 48, fontWeight: 600 } } },
      MuiTabs: { styleOverrides: { indicator: ({ theme }) => ({ height: 2, backgroundColor: theme.palette.primary.main }) } },
      MuiToggleButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            textTransform: 'none',
            fontWeight: 600,
            '&.Mui-selected': { backgroundColor: alpha(theme.palette.primary.main, 0.1), color: theme.palette.primary.main },
          }),
        },
      },
      MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 10 } } },
      MuiTooltip: { defaultProps: { arrow: true } },
      MuiAppBar: { defaultProps: { elevation: 0, color: 'inherit' } },
      MuiTextField: { defaultProps: { size: 'small' } },
      MuiAlert: { styleOverrides: { root: { borderRadius: 10 } } },
    },
  });
}
