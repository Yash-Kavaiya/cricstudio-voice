import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppBar,
  Badge,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';
import { MAX_GUESTS, SCENES } from '@cricstudio/shared';
import { useColorMode } from '../App';
import { ControlBar } from '../components/ControlBar';
import { GreenRoom } from '../components/GreenRoom';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { ProgramCanvas } from '../components/ProgramCanvas';
import { SceneRail } from '../components/SceneRail';
import { VideoTile } from '../components/VideoTile';
import { AudioPanel } from '../components/panels/AudioPanel';
import { AutopilotPanel } from '../components/panels/AutopilotPanel';
import { VoiceAiPanel } from '../components/panels/VoiceAiPanel';
import { AutomationPanel } from '../components/panels/AutomationPanel';
import { BrandPanel } from '../components/panels/BrandPanel';
import { ChatPanel } from '../components/panels/ChatPanel';
import { DestinationsPanel, PlatformAvatar, useDestinations } from '../components/panels/DestinationsPanel';
import { MatchPanel } from '../components/panels/MatchPanel';
import { api } from '../lib/api';
import { prefs, studioStore } from '../lib/storage';
import { StudioClient, type DeviceChoice } from '../lib/studioClient';
import { useClient } from '../lib/useClient';
import type { ProgramRenderer } from '../compositor/renderer';

/** Real compositor fps and draw cost, so a struggling PC is visible before viewers notice. */
function RenderStats({ renderer, encoder, sampleEncoderFps }: { renderer: ProgramRenderer; encoder: 'gpu' | 'mediarecorder' | null; sampleEncoderFps: () => number | null }) {
  const [, tick] = useState(0);
  const [encFps, setEncFps] = useState<number | null>(null);
  useEffect(() => {
    const t = setInterval(() => {
      setEncFps(sampleEncoderFps());
      tick((x) => x + 1);
    }, 2000);
    return () => clearInterval(t);
  }, [sampleEncoderFps]);
  const ms = renderer.frameMs;
  const busy = renderer.fps > 0 && (renderer.fps < 26 || ms > 25);
  return (
    <Typography
      variant="caption"
      color={busy ? 'warning.main' : 'text.secondary'}
      title="Frames drawn per second and average draw time per frame. Over ~25 ms means this PC is too busy — close other apps or tabs."
      sx={{ display: { xs: 'none', sm: 'block' }, fontVariantNumeric: 'tabular-nums' }}
    >
      1920 × 1080 · {renderer.fps || '–'} fps · {ms ? ms.toFixed(1) : '–'} ms/frame{encoder ? (encoder === 'gpu' ? ` · GPU encoder${encFps !== null ? ` ${Math.round(encFps)} fps` : ''}` : ' · MediaRecorder') : ''}
    </Typography>
  );
}

function useLiveTimer(startedAt?: number) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  if (!startedAt) return '';
  const s = Math.floor((Date.now() - startedAt) / 1000);
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

const TABS = [
  { key: 'match', icon: 'sports_cricket', label: 'Match' },
  { key: 'pilot', icon: 'smart_toy', label: 'Auto Live' },
  { key: 'voice', icon: 'graphic_eq', label: 'Voice AI' },
  { key: 'auto', icon: 'auto_awesome', label: 'Director' },
  { key: 'audio', icon: 'music_note', label: 'Audio' },
  { key: 'stream', icon: 'cell_tower', label: 'Stream' },
  { key: 'brand', icon: 'palette', label: 'Brand' },
  { key: 'chat', icon: 'chat', label: 'Chat' },
] as const;

export function Studio() {
  const { id = '' } = useParams();
  const saved = studioStore.get(id);
  const nav = useNavigate();
  const [client, setClient] = useState<StudioClient | null>(null);

  useEffect(() => () => client?.dispose(), [client]);

  if (!saved) {
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ height: '100%', p: 3 }} spacing={2}>
        <Logo />
        <Alert severity="warning" sx={{ maxWidth: 520 }}>
          This browser doesn't hold the host key for studio <b>{id}</b>. Open it from the browser that created it, or create a new studio.
        </Alert>
        <Button variant="contained" onClick={() => nav('/')}>
          Go to dashboard
        </Button>
      </Stack>
    );
  }

  if (!client) {
    return (
      <GreenRoom
        title={saved.name}
        subtitle="You're the host. Check your camera and mic, then enter the studio."
        defaultName={prefs.get('hostName', 'Host')}
        cta="Enter studio"
        onJoin={(name: string, devices: DeviceChoice) => {
          prefs.set('hostName', name);
          const c = new StudioClient({ studioId: id, token: saved.hostToken, role: 'host', name, programToken: saved.programToken });
          void c.audio.resume();
          void c.start(devices);
          setClient(c);
        }}
      />
    );
  }
  return <StudioRoom client={client} hostToken={saved.hostToken} programToken={saved.programToken} onLeave={() => (client.dispose(), nav('/'))} />;
}

function StudioRoom({ client: c, hostToken, programToken, onLeave }: { client: StudioClient; hostToken: string; programToken: string; onLeave: () => void }) {
  const client = useClient(c)!;
  const sampleEncFps = useCallback(() => c.sampleEncoderFps(), [c]);
  const { mode, toggle } = useColorMode();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('match');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const st = client.state;
  const timer = useLiveTimer(st?.live.state === 'live' ? st.live.startedAt : undefined);
  const dests = useDestinations(st?.id ?? '', hostToken);
  const guards = (p: Promise<unknown>) => p.catch((e) => setToast((e as Error).message));

  // keyboard shortcuts: number keys switch scenes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,[contenteditable]')) return;
      const s = SCENES.find((x) => x.hotkey === e.key);
      if (s) void guards(client.setScene(s.id));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [client]);

  if (client.error) {
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ height: '100%' }} spacing={2}>
        <Alert severity="error">{client.error}</Alert>
        <Button onClick={onLeave}>Back to dashboard</Button>
      </Stack>
    );
  }
  if (!st) {
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ height: '100%' }} spacing={2}>
        <CircularProgress />
        <Typography color="text.secondary">Connecting to studio…</Typography>
      </Stack>
    );
  }

  const live = st.live.state === 'live' || st.live.state === 'starting';
  const people = st.participants.filter((p) => p.role !== 'program');
  const guests = people.filter((p) => p.role === 'guest');

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <AppBar position="static" sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar variant="dense" sx={{ gap: 1.5, minHeight: 60 }}>
          <IconButton onClick={onLeave} edge="start">
            <Icon name="arrow_back" />
          </IconButton>
          <Logo compact />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.2 }} noWrap>
              {st.name}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap component="div">
              {client.match ? `${client.match.title} · ${client.match.summary || client.match.statusText}` : 'No match attached'}
            </Typography>
          </Box>
          <Box sx={{ flex: 1 }} />
          {!client.connected && <Chip size="small" color="warning" label="Reconnecting…" />}
          {st.autopilot.enabled && <Chip size="small" color="secondary" icon={<Icon name="smart_toy" size={16} />} label="Auto Live" />}
          {client.commentary && (
            <Tooltip title={client.commentary.text}>
              <Chip size="small" icon={<Icon name="record_voice_over" size={16} />} label="Commentator speaking" />
            </Tooltip>
          )}
          {live && (
            <Chip
              color="error"
              label={
                <Stack direction="row" alignItems="center" gap={1}>
                  <span className="live-dot" style={{ background: '#fff' }} />
                  {st.live.state === 'starting' ? 'STARTING' : st.live.state === 'reconnecting' ? 'RECONNECTING' : `LIVE ${timer}`}
                  {st.live.broadcaster === 'cloud' ? ' · CLOUD' : ''}
                </Stack>
              }
            />
          )}
          <Tooltip title={`Invite guests (${guests.length}/${MAX_GUESTS})`}>
            <Button variant="outlined" startIcon={<Icon name="person_add" />} onClick={() => setInviteOpen(true)}>
              Invite
            </Button>
          </Tooltip>
          <IconButton onClick={toggle}>
            <Icon name={mode === 'dark' ? 'light_mode' : 'dark_mode'} />
          </IconButton>
          {live ? (
            <Button variant="contained" color="error" startIcon={<Icon name="stop_circle" />} onClick={() => void guards(client.endLive())}>
              End broadcast
            </Button>
          ) : (
            <Button variant="contained" startIcon={<Icon name="sensors" />} onClick={() => setLiveOpen(true)}>
              Go live
            </Button>
          )}
        </Toolbar>
      </AppBar>

      <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '220px 1fr', lg: '220px 1fr 360px', xl: '240px 1fr 400px' }, gap: 2, p: 2 }}>
        <Box sx={{ display: { xs: 'none', md: 'block' }, minHeight: 0, bgcolor: 'background.paper', borderRadius: 2, border: 1, borderColor: 'divider', p: 1 }}>
          <SceneRail state={st} onPick={(s) => void guards(client.setScene(s))} />
        </Box>

        {/* stage column: program + backstage are sized together so the 16:9 program uses all free space */}
        <Box sx={{ minWidth: 0, minHeight: { xs: 420, md: 0 }, containerType: 'size', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Stack spacing={1.5} sx={{ width: 'min(100cqw, max(320px, calc((100cqh - 236px) * 16 / 9)))', maxHeight: '100%', overflowY: 'auto', '& > *': { flexShrink: 0 } }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 0.5 }}>
            <Chip size="small" color={live ? 'error' : 'default'} label={live ? 'ON AIR' : 'PREVIEW'} sx={{ fontWeight: 700, letterSpacing: 0.5 }} />
            <Typography variant="subtitle2" noWrap sx={{ flex: 1 }}>
              {SCENES.find((s) => s.id === st.scene)?.name}
            </Typography>
            <RenderStats renderer={client.renderer} encoder={client.encoderKind} sampleEncoderFps={sampleEncFps} />
          </Stack>
          <ProgramCanvas renderer={client.renderer} live={live} />
          <Box sx={{ bgcolor: 'background.paper', borderRadius: 2, border: 1, borderColor: 'divider', px: 1.5, pt: 1, pb: 1.5 }}>
            <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="overline" color="text.secondary" sx={{ flex: 1, lineHeight: 1.6 }}>
                Backstage · {people.filter((p) => p.onStage).length} on stage
              </Typography>
              <ControlBar client={client} onLeave={onLeave} />
            </Stack>
          <Stack direction="row" spacing={1.5} sx={{ overflowX: 'auto', pb: 0.5, px: 0.5, pt: 0.5 }}>
            {people.map((p) => (
              <VideoTile
                key={p.id}
                p={p}
                self={p.id === client.selfId}
                stream={p.id === client.selfId ? client.localStream : client.remote.get(p.id)?.cam ?? null}
                connState={client.peerStates.get(p.id)}
                hostControls
                spotlit={st.spotlightId === p.id}
                onStage={(v) => void guards(client.setStage(p.id, v))}
                onKick={() => void guards(client.kick(p.id))}
                onMute={() => client.requestMute(p.id)}
                onSpotlight={() => void guards(client.patch({ spotlightId: st.spotlightId === p.id ? null : p.id }))}
              />
            ))}
            {guests.length < MAX_GUESTS && (
              <Box
                onClick={() => setInviteOpen(true)}
                sx={{ width: 200, flex: '0 0 auto', aspectRatio: '16/9', borderRadius: 1.5, border: '2px dashed', borderColor: 'divider', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'text.secondary' }}
              >
                <Stack alignItems="center">
                  <Icon name="person_add" />
                  <Typography variant="caption">Invite expert ({guests.length}/{MAX_GUESTS})</Typography>
                </Stack>
              </Box>
            )}
          </Stack>
          </Box>
        </Stack>
        </Box>

        <Box sx={{ display: { xs: 'none', lg: 'flex' }, flexDirection: 'column', minHeight: 0, bgcolor: 'background.paper', borderRadius: 2, border: 1, borderColor: 'divider' }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="fullWidth" sx={{ borderBottom: 1, borderColor: 'divider', px: 0.5 }}>
            {TABS.map((t) => (
              <Tab
                key={t.key}
                value={t.key}
                sx={{ minWidth: 0, px: 0.5 }}
                icon={
                  <Badge color="primary" variant="dot" invisible={!(t.key === 'auto' && client.suggestions.length)}>
                    <Icon name={t.icon} />
                  </Badge>
                }
                label={<Typography variant="caption">{t.label}</Typography>}
              />
            ))}
          </Tabs>
          <Box sx={{ p: 2, overflow: 'auto', flex: 1 }}>
            {tab === 'match' && <MatchPanel client={client} />}
            {tab === 'pilot' && <AutopilotPanel client={client} hostToken={hostToken} hasDestinations={dests.list.some((d) => d.enabled)} onGoCloud={() => void guards(client.goLive('cloud'))} />}
            {tab === 'voice' && <VoiceAiPanel client={client} />}
            {tab === 'auto' && <AutomationPanel client={client} />}
            {tab === 'audio' && <AudioPanel client={client} hostToken={hostToken} />}
            {tab === 'stream' && <DestinationsPanel client={client} hostToken={hostToken} dests={dests} />}
            {tab === 'brand' && <BrandPanel client={client} hostToken={hostToken} />}
            {tab === 'chat' && <ChatPanel client={client} />}
          </Box>
        </Box>
      </Box>

      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} studioId={st.id} hostToken={hostToken} programToken={programToken} guests={guests.length} />
      <GoLiveDialog
        open={liveOpen}
        onClose={() => setLiveOpen(false)}
        dests={dests.list}
        mode={client.mediaMode}
        onManage={() => {
          setLiveOpen(false);
          setTab('stream');
        }}
        onGo={async (broadcaster) => {
          setLiveOpen(false);
          await guards(client.goLive(broadcaster));
        }}
      />
      <Snackbar open={!!toast} autoHideDuration={5000} onClose={() => setToast(null)} message={toast} />
    </Box>
  );
}

function InviteDialog({ open, onClose, studioId, hostToken, programToken, guests }: { open: boolean; onClose: () => void; studioId: string; hostToken: string; programToken: string; guests: number }) {
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (open && !link) void api.invite(studioId, hostToken).then((r) => setLink(`${location.origin}/join/${r.guestToken}`));
  }, [open, link, studioId, hostToken]);
  const programUrl = useMemo(() => `${location.origin}/program/${studioId}?k=${encodeURIComponent(programToken)}`, [studioId, programToken]);
  const copy = (s: string, what: string) => {
    void navigator.clipboard.writeText(s);
    setCopied(what);
    setTimeout(() => setCopied(null), 1600);
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Invite your expert panel</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography color="text.secondary">
            Up to {MAX_GUESTS} guest speakers can join ({guests}/{MAX_GUESTS} in the studio). They land in a green room, then appear backstage — you choose who goes on stage.
          </Typography>
          <Stack direction="row" spacing={1}>
            <TextField fullWidth value={link || 'Generating…'} InputProps={{ readOnly: true }} />
            <Button variant="contained" onClick={() => copy(link, 'guest')} disabled={!link} startIcon={<Icon name="content_copy" />}>
              {copied === 'guest' ? 'Copied' : 'Copy'}
            </Button>
          </Stack>
          <Typography variant="subtitle2">Clean program feed (OBS / vMix browser source, LiveKit egress)</Typography>
          <Stack direction="row" spacing={1}>
            <TextField fullWidth value={programUrl} InputProps={{ readOnly: true }} />
            <Button onClick={() => copy(programUrl, 'program')} startIcon={<Icon name="content_copy" />}>
              {copied === 'program' ? 'Copied' : 'Copy'}
            </Button>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}

function GoLiveDialog({
  open,
  onClose,
  dests,
  mode,
  onGo,
  onManage,
}: {
  open: boolean;
  onClose: () => void;
  dests: ReturnType<typeof useDestinations>['list'];
  mode: 'mesh' | 'livekit';
  onGo: (broadcaster: 'host' | 'cloud') => void;
  onManage: () => void;
}) {
  const [broadcaster, setBroadcaster] = useState<'host' | 'cloud'>(prefs.get('broadcaster', 'host'));
  const enabled = dests.filter((d) => d.enabled);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Go live</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          {enabled.map((d) => (
            <Stack key={d.id} direction="row" spacing={1.5} alignItems="center">
              <PlatformAvatar p={d.platform} size={28} />
              <Typography sx={{ flex: 1 }}>{d.name}</Typography>
              <Icon name="check_circle" color="#34a853" fill />
            </Stack>
          ))}
          {!enabled.length && <Alert severity="info">No platforms enabled yet. Add your YouTube, Facebook, X or Twitch stream keys.</Alert>}
          <Button size="small" onClick={onManage} startIcon={<Icon name="tune" />} sx={{ alignSelf: 'flex-start' }}>
            Manage destinations
          </Button>
          {mode !== 'livekit' && (
            <Stack spacing={1}>
              <Typography variant="subtitle2">Who renders the show?</Typography>
              {(
                [
                  ['host', 'This browser', 'Best with live cameras. If this tab drops, the cloud producer takes over automatically.', 'laptop_chromebook'],
                  ['cloud', 'Cloud producer · 24/7', 'Server renders + streams in Auto Live mode. Close the tab anytime — survives restarts.', 'cloud'],
                ] as const
              ).map(([v, title, desc, icon]) => (
                <Stack
                  key={v}
                  direction="row"
                  spacing={1.5}
                  onClick={() => {
                    setBroadcaster(v);
                    prefs.set('broadcaster', v);
                  }}
                  sx={{ p: 1.5, borderRadius: 1.5, cursor: 'pointer', border: 2, borderColor: broadcaster === v ? 'primary.main' : 'divider' }}
                >
                  <Icon name={icon} />
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {desc}
                    </Typography>
                  </Box>
                </Stack>
              ))}
            </Stack>
          )}
          <Typography variant="caption" color="text.secondary">
            Each platform reconnects independently if it drops — one bad ingest never takes the others down.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" color="error" disabled={!enabled.length} onClick={() => onGo(broadcaster)} startIcon={<Icon name="sensors" />}>
          Start broadcast
        </Button>
      </DialogActions>
    </Dialog>
  );
}
