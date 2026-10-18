import { Stack, Typography } from '@mui/material';
import { AAI } from '../theme';

/** CricStudio Voice mark: a cricket ball whose seam is a voice waveform. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1.2}>
      <svg width="32" height="32" viewBox="0 0 64 64" aria-hidden>
        <rect width="64" height="64" rx="16" fill={AAI.ink} />
        <circle cx="32" cy="32" r="19" fill={AAI.cobalt} />
        {[-12, -6, 0, 6, 12].map((x, i) => {
          const h = [8, 16, 24, 14, 8][i];
          return <rect key={x} x={32 + x - 2} y={32 - h / 2} width="4" height={h} rx="2" fill={AAI.paper} />;
        })}
      </svg>
      {!compact && (
        <Typography variant="h6" sx={{ fontWeight: 600, letterSpacing: '-0.02em' }}>
          CricStudio{' '}
          <Typography component="span" sx={{ fontFamily: AAI.mono, fontSize: 13, fontWeight: 500, color: 'primary.main', letterSpacing: '0.04em', verticalAlign: 'middle' }}>
            VOICE
          </Typography>
        </Typography>
      )}
    </Stack>
  );
}
