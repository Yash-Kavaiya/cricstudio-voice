import { useState } from 'react';
import { AAI } from '../../theme';
import { Alert, Box, ButtonBase, Chip, FormControlLabel, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import { STT_LANGUAGES, type SttProvider } from '@cricstudio/shared';
import { speechSupported } from '../../captions/speech';
import type { CloudSttProvider } from '../../lib/api';
import { ApiKeyField } from './ApiKeyField';
import type { StudioClient } from '../../lib/studioClient';
import { Icon } from '../Icon';

const ENGINES: { id: SttProvider; name: string; desc: string; icon: string }[] = [
  {
    id: 'assemblyai',
    name: 'AssemblyAI Universal-Streaming',
    desc: 'Realtime word-by-word captions over WebSocket (~300 ms), formatted turns, player names boosted as key terms. Also powers hands-free voice commands.',
    icon: 'graphic_eq',
  },
  { id: 'browser', name: 'Browser speech', desc: 'Free · Chrome/Edge built-in recognition. Always used as the fallback.', icon: 'language' },
];

/** Live-caption engine picker: browser (free) or a cloud STT with a write-only API key. */
export function CaptionsSettings({ client, hostToken }: { client: StudioClient; hostToken: string }) {
  const st = client.state!;
  const stt = st.stt;
  const status = client.captionStatus;
  const [err, setErr] = useState<string | null>(null);

  const save = async (body: Parameters<StudioClient['saveStt']>[0]) => {
    setErr(null);
    try {
      await client.saveStt(body);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const engineLabel = ENGINES.find((e) => e.id === status.engine)?.name ?? 'Off';
  const canCaption = speechSupported() || Object.values(stt.configured).some(Boolean);

  return (
    <Stack spacing={1.5}>
      <FormControlLabel
        control={<Switch checked={st.brand.captions} disabled={!canCaption} onChange={(e) => void client.patch({ brand: { ...st.brand, captions: e.target.checked } })} />}
        label="Live captions (speech-to-text, burned into the stream)"
      />
      {st.brand.captions && (
        <Alert
          severity={status.fallback ? 'warning' : status.error && status.engine === 'browser' ? 'info' : 'success'}
          icon={<Icon name={status.fallback ? 'sync_problem' : 'closed_caption'} />}
          sx={{ py: 0.25 }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {status.fallback ? `Cloud engine failing — using browser speech for a minute` : `Captions by ${engineLabel}`}
          </Typography>
          {status.error && <Typography variant="caption" component="div">{status.error}</Typography>}
          {status.lastText && !status.fallback && (
            <Typography variant="caption" color="text.secondary" component="div" noWrap>
              “{status.lastText}”
            </Typography>
          )}
        </Alert>
      )}

      <TextField select label="Spoken language" value={stt.language} onChange={(e) => void save({ language: e.target.value })}>
        {STT_LANGUAGES.map((l) => (
          <MenuItem key={l.code} value={l.code}>
            {l.label} · {l.code}
          </MenuItem>
        ))}
      </TextField>
      {stt.provider === 'assemblyai' && !stt.language.startsWith('en') && (
        <Alert severity="info">Non-English speech uses AssemblyAI's multilingual streaming model.</Alert>
      )}

      <Typography variant="subtitle2">Speech-to-text engine</Typography>
      {ENGINES.map((e) => {
        const on = stt.provider === e.id;
        const cloud = e.id !== 'browser' ? (e.id as CloudSttProvider) : null;
        const configured = cloud ? stt.configured[cloud] : true;
        return (
          <Box key={e.id} sx={{ border: 2, borderColor: on ? 'primary.main' : 'divider', borderRadius: 1.5, overflow: 'hidden' }}>
            <ButtonBase
              onClick={() => void save({ provider: e.id })}
              sx={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left', gap: 1.25, p: 1.25, bgcolor: on ? 'action.selected' : 'transparent' }}
            >
              <Icon name={e.icon} color={on ? AAI.cobalt : undefined} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {e.name}
                  </Typography>
                  {cloud && configured && <Chip size="small" color="success" label="Ready" sx={{ height: 20 }} />}
                  {cloud && !configured && <Chip size="small" label="Needs key" sx={{ height: 20 }} />}
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {e.desc}
                </Typography>
              </Box>
              {on && <Icon name="radio_button_checked" color="#3923c7" fill />}
            </ButtonBase>
            {cloud && on && (
              <Stack spacing={1} sx={{ p: 1.25, pt: 0.5 }}>
                <ApiKeyField client={client} hostToken={hostToken} provider={cloud} />
              </Stack>
            )}
          </Box>
        );
      })}
      {err && <Alert severity="error">{err}</Alert>}
      <Typography variant="caption" color="text.secondary">
        One AssemblyAI key powers captions, the AI commentator and the voice agent. It stays on the server — browsers only get short-lived streaming tokens. If streaming fails, CricStudio falls back to free browser speech — captions never stop.
      </Typography>
    </Stack>
  );
}
