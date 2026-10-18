import { useState } from 'react';
import { Alert, Button, Chip, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import type { CloudSttProvider } from '../../lib/api';
import type { StudioClient } from '../../lib/studioClient';

export const KEY_INFO: Record<CloudSttProvider, { label: string; help: string; url: string }> = {
  assemblyai: { label: 'AssemblyAI API key', help: 'Optional — the server key is used when none is saved · dashboard → API keys', url: 'https://www.assemblyai.com/dashboard/api-keys' },
};

/**
 * Write-only API key input. One AssemblyAI key per studio powers captions (Universal-Streaming),
 * the AI commentator (LLM Gateway + TTS) and the voice agent. The key is verified, then stored encrypted on the server.
 */
export function ApiKeyField({ client, hostToken, provider }: { client: StudioClient; hostToken: string; provider: CloudSttProvider }) {
  const st = client.state!;
  const info = KEY_INFO[provider];
  const configured = st.stt.configured[provider];
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setBusy('save');
    setMsg(null);
    const r = await client.testStt(provider, key).catch((e: Error) => ({ ok: false, error: e.message, ms: 0 }));
    if (r.ok) {
      try {
        await client.saveStt({ keys: { [provider]: key } });
        setKey('');
        setMsg({ ok: true, text: `Key works (${r.ms} ms) — saved encrypted on the server.` });
      } catch (e) {
        setMsg({ ok: false, text: (e as Error).message });
      }
    } else setMsg({ ok: false, text: `Key check failed: ${r.error}` });
    setBusy(null);
  };

  const test = async () => {
    setBusy('test');
    const r = await client.testStt(provider).catch((e: Error) => ({ ok: false, error: e.message, ms: 0 }));
    setMsg({ ok: r.ok, text: r.ok ? `Connected · ${r.ms} ms round trip` : `Failed: ${r.error}` });
    setBusy(null);
  };

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1}>
        <TextField
          fullWidth
          type="password"
          autoComplete="off"
          label={configured ? `${info.label} (saved — paste to replace)` : info.label}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <Button variant="contained" disabled={!key.trim() || !!busy} onClick={() => void save()} sx={{ flexShrink: 0 }}>
          {busy === 'save' ? <CircularProgress size={18} color="inherit" /> : 'Save'}
        </Button>
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center">
        {configured ? <Chip size="small" color="success" label="Key saved" sx={{ height: 20 }} /> : <Chip size="small" label="No key yet" sx={{ height: 20 }} />}
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }} noWrap>
          {info.help} ·{' '}
          <a href={info.url} target="_blank" rel="noreferrer">
            open
          </a>
        </Typography>
        {configured && (
          <>
            <Button size="small" disabled={!!busy} onClick={() => void test()}>
              {busy === 'test' ? <CircularProgress size={16} /> : 'Test'}
            </Button>
            <Button size="small" color="error" disabled={!!busy} onClick={() => void client.saveStt({ keys: { [provider]: null } })}>
              Remove
            </Button>
          </>
        )}
      </Stack>
      {msg && <Alert severity={msg.ok ? 'success' : 'error'}>{msg.text}</Alert>}
    </Stack>
  );
}
