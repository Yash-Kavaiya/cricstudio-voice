import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Divider, FormControlLabel, Stack, Switch, TextField, Typography } from '@mui/material';
import type { StudioClient } from '../../lib/studioClient';
import { VoiceAgent, type AgentEvent } from '../../lib/voiceAgent';
import { AAI } from '../../theme';
import { Icon } from '../Icon';

const PRODUCTS = [
  { name: 'Voice Agent API', use: 'Commentator voice (TTS) · talk-to-commentator', icon: 'record_voice_over' },
  { name: 'Universal-Streaming', use: 'Realtime captions · voice commands', icon: 'graphic_eq' },
  { name: 'LLM Gateway', use: 'Commentary writer · recaps · command intents · translation', icon: 'neurology' },
  { name: 'Async STT', use: 'Phrase transcription · key checks', icon: 'description' },
];

type Turn = { who: 'you' | 'ravi'; text: string; final: boolean };

/** AssemblyAI control room: talk to the commentator, hands-free producer commands, recaps. */
export function VoiceAiPanel({ client }: { client: StudioClient }) {
  const st = client.state!;
  const ready = st.stt.configured.assemblyai;
  const [status, setStatus] = useState<string>('idle');
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [latency, setLatency] = useState<number | null>(null);
  const [typed, setTyped] = useState('');
  const [cmd, setCmd] = useState('');
  const [cmdBusy, setCmdBusy] = useState(false);
  const [recapBusy, setRecapBusy] = useState(false);
  const agent = useRef<VoiceAgent | null>(null);

  const push = (who: Turn['who'], text: string, final: boolean) =>
    setTurns((t) => {
      const last = t.at(-1);
      if (last && last.who === who && !last.final) return [...t.slice(0, -1), { who, text, final }].slice(-12);
      return [...t, { who, text, final }].slice(-12);
    });

  useEffect(() => () => agent.current?.close(), []);

  const onEvent = (e: AgentEvent) => {
    if (e.kind === 'status') {
      setStatus(e.status);
      if (e.error) setError(e.error);
    } else if (e.kind === 'user') push('you', e.text, e.final);
    else if (e.kind === 'agent') push('ravi', e.text, e.final);
    else if (e.kind === 'latency') setLatency(e.ms);
  };

  const connect = async () => {
    setError(null);
    const s = await client.agentSession();
    if (!s.ok || !s.token) return setError(s.error ?? 'Could not start a Voice Agent session');
    agent.current ??= new VoiceAgent(onEvent, () => client.agentContext());
    try {
      await agent.current.connect({ token: s.token, voice: s.voice ?? 'charles', context: s.context ?? '', keyterms: s.keyterms ?? [] });
    } catch (e) {
      setError((e as Error).message);
      setStatus('idle');
    }
  };
  const live = status !== 'idle' && status !== 'connecting' && status !== 'error';

  const runCmd = async (text: string) => {
    if (!text.trim()) return;
    setCmdBusy(true);
    await client.voiceCommand(text);
    setCmd('');
    setCmdBusy(false);
  };

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="overline" color="text.secondary">
          Powered by AssemblyAI
        </Typography>
        <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
          Voice AI control room
        </Typography>
      </Box>
      {!ready && <Alert severity="warning">No AssemblyAI key on the server. Set ASSEMBLYAI_API_KEY or save one in Auto Live → AI commentary.</Alert>}

      {/* talk to the commentator */}
      <Box sx={{ p: 1.5, borderRadius: 3, border: 1, borderColor: 'divider', bgcolor: live ? 'action.hover' : 'transparent' }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          <Icon name="forum" color={AAI.cobalt} />
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            Talk to the commentator
          </Typography>
          <Chip size="small" label={status} color={status === 'speaking' || status === 'listening' ? 'primary' : 'default'} sx={{ height: 20 }} />
        </Stack>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
          Voice Agent API: streaming STT hears you, the agent checks the live scorecard with a tool call, and answers in the commentator's voice. Interrupt any time.
        </Typography>
        <Box sx={{ maxHeight: 220, overflow: 'auto', mb: 1 }}>
          {turns.map((t, i) => (
            <Box key={i} sx={{ display: 'flex', justifyContent: t.who === 'you' ? 'flex-end' : 'flex-start', mb: 0.75 }}>
              <Box sx={{ px: 1.25, py: 0.75, borderRadius: 2, maxWidth: '88%', bgcolor: t.who === 'you' ? AAI.cobalt : 'background.default', color: t.who === 'you' ? '#fff' : 'text.primary', border: t.who === 'you' ? 0 : 1, borderColor: 'divider', opacity: t.final ? 1 : 0.75 }}>
                <Typography variant="body2">{t.text}</Typography>
              </Box>
            </Box>
          ))}
        </Box>
        {!live ? (
          <Button fullWidth variant="contained" disabled={!ready || status === 'connecting'} startIcon={status === 'connecting' ? <CircularProgress size={16} color="inherit" /> : <Icon name="call" />} onClick={() => void connect()}>
            Open the commentary box
          </Button>
        ) : (
          <Stack spacing={1}>
            <Button
              fullWidth
              variant={status === 'listening' ? 'contained' : 'outlined'}
              startIcon={<Icon name="mic" />}
              onPointerDown={() => void agent.current?.startTalking().catch((e: Error) => setError(e.message))}
              onPointerUp={() => agent.current?.stopTalking()}
              onPointerLeave={() => agent.current?.stopTalking()}
            >
              {status === 'listening' ? 'Listening… release to send' : 'Hold to ask'}
            </Button>
            <Stack direction="row" spacing={1}>
              <TextField fullWidth placeholder="…or type: How many do they need?" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && typed.trim() && (push('you', typed, true), agent.current?.ask(typed), setTyped(''))} />
              <Button color="error" onClick={() => (agent.current?.close(), setStatus('idle'))}>
                End
              </Button>
            </Stack>
          </Stack>
        )}
        {latency != null && (
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: AAI.mono }}>
            question → first audio: {latency} ms
          </Typography>
        )}
        {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
      </Box>

      {/* hands-free producer */}
      <Box sx={{ p: 1.5, borderRadius: 3, border: 1, borderColor: 'divider' }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Icon name="keyboard_voice" color={AAI.cobalt} />
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            Hands-free producer
          </Typography>
        </Stack>
        <FormControlLabel
          control={
            <Switch
              checked={client.voiceCommands}
              onChange={(e) => {
                client.voiceCommands = e.target.checked;
                if (e.target.checked && !st.brand.captions) void client.patch({ brand: { ...st.brand, captions: true } });
                client.notifyAll();
              }}
            />
          }
          label={<Typography variant="body2">Listen for “Studio, …” commands</Typography>}
        />
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
          Your mic streams to Universal-Streaming; any turn starting with “Studio” (e.g. “Studio, show the batting card”, “Studio, give me a recap”) is turned into a studio action by LLM Gateway instead of a caption.
        </Typography>
        <Stack direction="row" spacing={1}>
          <TextField fullWidth placeholder="Try: show the worm chart" value={cmd} onChange={(e) => setCmd(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void runCmd(cmd)} />
          <Button variant="outlined" disabled={cmdBusy || !ready} onClick={() => void runCmd(cmd)}>
            {cmdBusy ? <CircularProgress size={16} /> : 'Run'}
          </Button>
        </Stack>
        {client.lastCommand && (
          <Typography variant="caption" component="div" sx={{ mt: 1, fontFamily: AAI.mono }}>
            “{client.lastCommand.text}” → {client.lastCommand.result}
          </Typography>
        )}
      </Box>

      <Button
        variant="outlined"
        disabled={recapBusy || !ready}
        startIcon={recapBusy ? <CircularProgress size={16} /> : <Icon name="summarize" />}
        onClick={async () => {
          setRecapBusy(true);
          await client.recap().catch(() => undefined);
          setRecapBusy(false);
        }}
      >
        Studio recap on air (LLM Gateway + TTS)
      </Button>

      <Divider />
      <Stack spacing={1}>
        {PRODUCTS.map((p) => (
          <Stack key={p.name} direction="row" spacing={1.25} alignItems="center">
            <Icon name={p.icon} color={AAI.cobalt} size={20} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {p.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {p.use}
              </Typography>
            </Box>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: ready ? AAI.green : 'divider' }} />
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
}
