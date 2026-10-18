import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Skeleton,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import type { MatchListItem } from '@cricstudio/shared';
import { useColorMode } from '../App';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { api, apiUrl } from '../lib/api';
import { studioStore, type SavedStudio } from '../lib/storage';
import { AAI } from '../theme';

const FEATURES = [
  { icon: 'record_voice_over', title: 'A commentator with a real voice', body: 'Every boundary, wicket and milestone is written by LLM Gateway from the live scorecard and spoken by AssemblyAI voices — straight into the broadcast mix.', tag: 'Voice Agent API · TTS' },
  { icon: 'forum', title: 'Talk back to the commentary box', body: 'Hold to ask “How many do they need?”. Streaming STT hears you, the agent checks the scorecard with a tool call, and answers out loud in about a second.', tag: 'Voice Agent API · tools' },
  { icon: 'closed_caption', title: 'Realtime captions & voice commands', body: 'Hosts and guests are captioned word-by-word. Say “Studio, show the batting card” and the director obeys — no hands.', tag: 'Universal-Streaming' },
  { icon: 'summarize', title: 'Studio recaps on demand', body: 'One click (or one sentence) and the presenter reads a grounded recap of the passage of play.', tag: 'LLM Gateway' },
];

function Hero({ onDemo }: { onDemo: () => void | Promise<void> }) {
  const [playing, setPlaying] = useState(false);
  const hear = async () => {
    setPlaying(true);
    try {
      const r = await fetch(apiUrl(`/api/aai/tts?voice=charles&text=${encodeURIComponent('And that is FOUR off the final ball! The Stars have done it — what a finish, called live by AssemblyAI!')}`));
      if (!r.ok) throw new Error();
      const a = new Audio(URL.createObjectURL(await r.blob()));
      a.onended = () => setPlaying(false);
      await a.play();
    } catch {
      setPlaying(false);
    }
  };
  return (
    <Box sx={{ mb: 5 }}>
      <Box sx={{ py: { xs: 4, md: 7 }, px: { xs: 3, md: 6 }, borderRadius: 5, border: 1, borderColor: 'divider', bgcolor: 'background.paper', position: 'relative', overflow: 'hidden' }}>
        <Box aria-hidden sx={{ position: 'absolute', right: -40, bottom: -10, display: 'flex', gap: '6px', alignItems: 'flex-end', opacity: 0.18 }}>
          {Array.from({ length: 40 }).map((_, i) => (
            <Box key={i} sx={{ width: 8, borderRadius: 4, bgcolor: i % 6 === 0 ? AAI.blush : AAI.cobalt, height: 20 + Math.abs(Math.sin(i * 0.7)) * 140, animation: `aaiwave ${1.2 + (i % 5) * 0.2}s ease-in-out ${i * 0.05}s infinite alternate` }} />
          ))}
        </Box>
        <Chip label="AssemblyAI Voice Hackathon · Hack into speech" variant="outlined" sx={{ mb: 2 }} />
        <Typography variant="h3" sx={{ maxWidth: 820, fontSize: { xs: 34, md: 54 }, lineHeight: 1.05 }}>
          Live cricket broadcasts, <Box component="span" sx={{ color: 'primary.main' }}>called by voice AI.</Box>
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 2, maxWidth: 680, fontSize: 18 }}>
          A full StreamYard-style studio for cricket — scenes, overlays, autopilot and multistreaming — with an AI commentator you can hear, caption and talk to. Built end-to-end on AssemblyAI.
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 3.5 }}>
          <Button size="large" variant="contained" startIcon={<Icon name="play_arrow" />} onClick={onDemo}>Open the demo studio</Button>
          <Button size="large" variant="outlined" startIcon={<Icon name={playing ? 'graphic_eq' : 'volume_up'} />} onClick={() => void hear()} disabled={playing}>
            {playing ? 'Playing…' : 'Hear the commentator'}
          </Button>
        </Stack>
      </Box>
      <Box sx={{ mt: 2, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', xl: 'repeat(4, 1fr)' } }}>
        {FEATURES.map((f) => (
          <Card key={f.title} sx={{ p: 2.5 }}>
            <Icon name={f.icon} color={AAI.cobalt} size={28} />
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mt: 1 }}>{f.title}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{f.body}</Typography>
            <Typography variant="overline" sx={{ display: 'block', mt: 1.5, color: 'primary.main' }}>{f.tag}</Typography>
          </Card>
        ))}
      </Box>
    </Box>
  );
}

type Filter = 'in' | 'pre' | 'post' | 'all';

function MatchCard({ m, onCreate }: { m: MatchListItem; onCreate: () => void }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardActionArea onClick={onCreate} sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
          {m.state === 'in' ? (
            <Chip size="small" color="error" label={<Stack direction="row" alignItems="center" gap={0.75}><span className="live-dot" style={{ background: '#fff' }} />LIVE</Stack>} />
          ) : (
            <Chip size="small" variant="outlined" label={m.state === 'pre' ? 'Upcoming' : 'Result'} />
          )}
          {m.isDemo && <Chip size="small" color="secondary" label="Demo replay" />}
          <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1 }}>
            {m.leagueName}
          </Typography>
        </Stack>
        {m.teams.map((t) => (
          <Stack key={t.id} direction="row" alignItems="center" spacing={1.5} sx={{ py: 0.6 }}>
            <Avatar src={t.logo} sx={{ width: 28, height: 28, bgcolor: 'action.hover', fontSize: 12 }}>
              {t.abbr.slice(0, 3)}
            </Avatar>
            <Typography sx={{ flex: 1, fontWeight: t.winner ? 700 : 500 }} noWrap>
              {t.name}
            </Typography>
            <Typography sx={{ fontFamily: AAI.mono, fontWeight: 600, fontSize: 15 }} noWrap>
              {t.score}
            </Typography>
          </Stack>
        ))}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, flex: 1 }} noWrap>
          {m.description} · {m.statusText}
        </Typography>
        <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1.5 }}>
          <Button size="small" variant="text" startIcon={<Icon name="videocam" size={18} />} component="span" sx={{ bgcolor: 'action.selected' }}>
            Create studio
          </Button>
        </Stack>
      </CardActionArea>
    </Card>
  );
}

export function Dashboard() {
  const nav = useNavigate();
  const { mode, toggle } = useColorMode();
  const [matches, setMatches] = useState<MatchListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('in');
  const [q, setQ] = useState('');
  const [create, setCreate] = useState<{ match: MatchListItem | null } | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<SavedStudio[]>(studioStore.all());

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .matches()
        .then((m) => alive && (setMatches(m), setError(null)))
        .catch((e) => alive && setError(e.message));
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const shown = useMemo(() => {
    const list = matches ?? [];
    return list.filter(
      (m) =>
        (filter === 'all' || m.state === filter || (m.isDemo && filter === 'in')) &&
        (!q || `${m.name} ${m.leagueName} ${m.description}`.toLowerCase().includes(q.toLowerCase())),
    );
  }, [matches, filter, q]);

  const counts = useMemo(() => {
    const c = { in: 0, pre: 0, post: 0, all: matches?.length ?? 0 };
    matches?.forEach((m) => c[m.state]++);
    return c;
  }, [matches]);

  const openCreate = (m: MatchListItem | null) => {
    setName(m ? `${m.teams.map((t) => t.abbr).join(' vs ')} — Live Watch-along` : 'Cricket Live Show');
    setCreate({ match: m });
  };

  const doCreate = async () => {
    setBusy(true);
    try {
      const mk = create?.match ? (create.match.isDemo ? 'demo:replay' : `${create.match.leagueId}:${create.match.id}`) : null;
      const r = await api.createStudio(name, mk);
      const s: SavedStudio = { ...r, matchKey: mk, createdAt: Date.now() };
      studioStore.save(s);
      setSaved(studioStore.all());
      nav(`/studio/${r.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default' }}>
      <AppBar position="sticky" sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
        <Toolbar sx={{ gap: 2 }}>
          <Logo />
          <Box sx={{ flex: 1 }} />
          <TextField
            placeholder="Search matches, series, teams"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            sx={{ width: { xs: 180, md: 420 }, '& .MuiOutlinedInput-root': { borderRadius: 999, bgcolor: 'action.hover' }, '& fieldset': { border: 'none' } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Icon name="search" /></InputAdornment> }}
          />
          <Tooltip title={mode === 'dark' ? 'Light theme' : 'Dark theme'}>
            <IconButton onClick={toggle}>
              <Icon name={mode === 'dark' ? 'light_mode' : 'dark_mode'} />
            </IconButton>
          </Tooltip>
          <Button variant="contained" startIcon={<Icon name="add" />} onClick={() => openCreate(null)}>
            New studio
          </Button>
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Hero onDemo={async () => { const list = matches ?? (await api.matches().catch(() => [] as MatchListItem[])); openCreate(list.find((m) => m.isDemo) ?? null); }} />
        <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ md: 'flex-end' }} spacing={2} sx={{ mb: 3 }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="overline" color="text.secondary">Matches</Typography>
            <Typography variant="h5">Pick a match to call live</Typography>
          </Box>
          <ToggleButtonGroup exclusive size="small" value={filter} onChange={(_, v) => v && setFilter(v)} sx={{ '& .MuiToggleButton-root': { px: 2, borderRadius: 999 } }}>
            <ToggleButton value="in">Live ({counts.in})</ToggleButton>
            <ToggleButton value="pre">Upcoming ({counts.pre})</ToggleButton>
            <ToggleButton value="post">Results ({counts.post})</ToggleButton>
            <ToggleButton value="all">All</ToggleButton>
          </ToggleButtonGroup>
        </Stack>

        {saved.length > 0 && (
          <Box sx={{ mb: 4 }}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
              Your studios
            </Typography>
            <Stack direction="row" gap={1} flexWrap="wrap">
              {saved.map((s) => (
                <Chip
                  key={s.id}
                  icon={<Icon name="video_camera_front" size={18} />}
                  label={s.name}
                  onClick={() => nav(`/studio/${s.id}`)}
                  onDelete={() => {
                    studioStore.remove(s.id);
                    setSaved(studioStore.all());
                  }}
                  sx={{ py: 2.2, px: 0.5 }}
                />
              ))}
            </Stack>
          </Box>
        )}

        {error && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Could not load live scores ({error}). The demo replay is still available.
          </Alert>
        )}

        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(3, 1fr)', xl: 'repeat(4, 1fr)' } }}>
          {matches === null &&
            Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} variant="rounded" height={200} sx={{ borderRadius: 2 }} />)}
          <AnimatePresence>
            {shown.map((m, i) => (
              <motion.div key={`${m.leagueId}-${m.id}`} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i * 0.03, 0.4) } }} exit={{ opacity: 0 }}>
                <MatchCard m={m} onCreate={() => openCreate(m)} />
              </motion.div>
            ))}
          </AnimatePresence>
        </Box>
        {matches && !shown.length && (
          <Stack alignItems="center" sx={{ py: 8, color: 'text.secondary' }} spacing={1}>
            <Icon name="sports_cricket" size={48} />
            <Typography>No matches in this view right now.</Typography>
          </Stack>
        )}
      </Container>

      <Dialog open={!!create} onClose={() => setCreate(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Create a studio</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {create?.match && (
              <Alert icon={<Icon name="sports_cricket" />} severity="info">
                {create.match.name} · {create.match.description}
              </Alert>
            )}
            <TextField label="Show title" value={name} onChange={(e) => setName(e.target.value)} fullWidth autoFocus />
            <Typography variant="body2" color="text.secondary">
              You'll be the host. Invite up to 4 expert guests with a link. Live data, scenes and automation are attached to this match — you can switch matches anytime.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setCreate(null)}>Cancel</Button>
          <Button variant="contained" onClick={doCreate} disabled={busy || !name.trim()} startIcon={busy ? <CircularProgress size={16} /> : <Icon name="arrow_forward" />}>
            Enter studio
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
