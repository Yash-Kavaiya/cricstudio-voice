import { useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { AAI_VOICES, DEFAULT_LLM_MODEL, EDGE_LANG_VOICES, LLM_MODELS, STT_LANGUAGES, VOICES, type AutopilotSettings } from '@cricstudio/shared';
import type { StudioClient } from '../../lib/studioClient';
import { AAI } from '../../theme';
import { Icon } from '../Icon';
import { ApiKeyField } from './ApiKeyField';

/** Where the AI commentator gets its words (templates / AssemblyAI LLM Gateway) and its voice (AssemblyAI TTS / Edge fallback). */
export function AiCommentarySettings({ client, hostToken }: { client: StudioClient; hostToken: string }) {
  const st = client.state!;
  const ap = st.autopilot;
  const writer = ap.writer ?? 'templates';
  const engine = ap.voiceEngine ?? 'edge';
  const lang = ap.commentaryLanguage ?? 'en-IN';
  const status = st.aiStatus;
  const [testing, setTesting] = useState(false);
  const [recapping, setRecapping] = useState(false);
  const [recap, setRecap] = useState<string | null>(null);
  const [test, setTest] = useState<Awaited<ReturnType<StudioClient['testCommentary']>> | null>(null);
  const patch = (p: Partial<AutopilotSettings>) => void client.patch({ autopilot: { ...ap, ...p } });

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    const r = await client.testCommentary();
    setTest(r);
    setTesting(false);
    if (r.audio) {
      const url = URL.createObjectURL(new Blob([r.audio], { type: 'audio/wav' }));
      const a = new Audio(url);
      a.onended = () => URL.revokeObjectURL(url);
      void a.play().catch(() => undefined);
    }
  };

  const runRecap = async () => {
    setRecapping(true);
    const r = await client.recap().catch((e: Error) => ({ ok: false, error: e.message, text: undefined }));
    setRecap(r.ok ? r.text ?? '' : `Recap failed: ${r.error}`);
    setRecapping(false);
  };

  const fellBack = status && (status.writer === 'fallback' || status.voice === 'fallback');

  return (
    <Box sx={{ mt: 1.5, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 2 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Icon name="graphic_eq" color={AAI.cobalt} />
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            AI commentary · AssemblyAI
          </Typography>
          <Chip size="small" variant="outlined" label={st.stt.configured.assemblyai ? 'Key ready' : 'No key'} color={st.stt.configured.assemblyai ? 'success' : 'default'} sx={{ height: 20 }} />
        </Stack>

        {fellBack && (
          <Alert severity="warning" sx={{ py: 0 }}>
            Using the free fallback ({status!.writer === 'fallback' ? 'templates' : 'LLM Gateway'} · {status!.voice === 'fallback' ? 'Edge voice' : 'AssemblyAI voice'}).
            {status!.error && (
              <Typography variant="caption" component="div">
                {status!.error}
              </Typography>
            )}
          </Alert>
        )}

        <TextField select label="Commentary language" value={lang} onChange={(e) => patch({ commentaryLanguage: e.target.value })}>
          {STT_LANGUAGES.map((l) => (
            <MenuItem key={l.code} value={l.code}>
              {l.label}
            </MenuItem>
          ))}
        </TextField>
        {!lang.startsWith('en') && (
          <Typography variant="caption" color="text.secondary">
            LLM Gateway writes (or translates) the lines in this language. AssemblyAI voices speak English, so {EDGE_LANG_VOICES[lang] ? 'a native Edge voice' : 'a Hindi Edge voice'} reads non-English lines.
          </Typography>
        )}

        <Box>
          <Typography variant="caption" color="text.secondary">
            Who writes the lines
          </Typography>
          <ToggleButtonGroup exclusive fullWidth size="small" value={writer} onChange={(_, v) => v && patch({ writer: v })}>
            <ToggleButton value="assemblyai">LLM Gateway</ToggleButton>
            <ToggleButton value="templates">Templates · offline</ToggleButton>
          </ToggleButtonGroup>
        </Box>
        {writer === 'assemblyai' && (
          <Stack spacing={1}>
            <Typography variant="caption" color="text.secondary">
              AssemblyAI LLM Gateway reads the live scorecard and writes a fresh line for every boundary, wicket, milestone and quiet spell — grounded in the facts, never inventing numbers.
            </Typography>
            <TextField select label="LLM Gateway model" value={ap.llmModel ?? st.stt.llmModel ?? DEFAULT_LLM_MODEL} onChange={(e) => patch({ llmModel: e.target.value })} helperText="Falls back to qwen3.5-4b-32k-fast if your plan lacks the model">
              {LLM_MODELS.map((m) => (
                <MenuItem key={m} value={m}>
                  {m}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        )}

        <Box>
          <Typography variant="caption" color="text.secondary">
            Who speaks them
          </Typography>
          <ToggleButtonGroup exclusive fullWidth size="small" value={engine} onChange={(_, v) => v && patch({ voiceEngine: v })}>
            <ToggleButton value="assemblyai">AssemblyAI voice</ToggleButton>
            <ToggleButton value="edge">Edge · offline fallback</ToggleButton>
          </ToggleButtonGroup>
        </Box>
        {engine === 'assemblyai' && (
          <TextField select label="AssemblyAI voice" value={ap.aaiVoice ?? 'charles'} onChange={(e) => patch({ aaiVoice: e.target.value })}>
            {AAI_VOICES.map((v) => (
              <MenuItem key={v.id} value={v.id}>
                {v.label}
              </MenuItem>
            ))}
          </TextField>
        )}
        <TextField select label={engine === 'assemblyai' ? 'Fallback voice (Edge)' : 'Edge voice (English)'} value={ap.voice} onChange={(e) => patch({ voice: e.target.value })}>
          {VOICES.map((v) => (
            <MenuItem key={v.id} value={v.id}>
              {v.label}
            </MenuItem>
          ))}
        </TextField>

        <ApiKeyField client={client} hostToken={hostToken} provider="assemblyai" />

        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button variant="outlined" startIcon={testing ? <CircularProgress size={16} /> : <Icon name="play_circle" />} disabled={testing} onClick={() => void runTest()}>
            Test commentary
          </Button>
          <Button variant="outlined" startIcon={recapping ? <CircularProgress size={16} /> : <Icon name="summarize" />} disabled={recapping} onClick={() => void runRecap()}>
            Studio recap (on air)
          </Button>
        </Stack>
        {test && (
          <Alert severity={test.writerError || test.voiceError || test.error ? 'warning' : 'success'}>
            <Typography variant="body2">“{test.text}”</Typography>
            <Typography variant="caption" component="div">
              {test.error
                ? test.error
                : [
                    writer === 'assemblyai' ? (test.ai ? 'Written by LLM Gateway ✓' : `LLM Gateway failed: ${test.writerError}`) : 'Template line',
                    engine === 'assemblyai' ? (test.voiceOk ? 'AssemblyAI voice ✓' : `AssemblyAI voice failed: ${test.voiceError}`) : 'Edge voice on air',
                  ].join(' · ')}
            </Typography>
          </Alert>
        )}
        {recap && <Alert severity={recap.startsWith('Recap failed') ? 'error' : 'info'}>{recap}</Alert>}
        <Typography variant="caption" color="text.secondary">
          If AssemblyAI is unreachable the commentator instantly falls back to templates and an offline voice — it never goes silent.
        </Typography>
      </Stack>
    </Box>
  );
}
