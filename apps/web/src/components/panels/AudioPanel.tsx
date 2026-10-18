import { useRef, useState } from 'react';
import { Alert, Box, Button, Chip, FormControlLabel, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Slider, Stack, Switch, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import type { AmbienceMood, AmbienceState, SfxId } from '@cricstudio/shared';
import { TRACKS } from '../../audio/music';
import { SFX_LABELS } from '../../audio/sfx';
import { api } from '../../lib/api';
import { prefs } from '../../lib/storage';
import type { StudioClient } from '../../lib/studioClient';
import { Icon } from '../Icon';

export function AudioPanel({ client, hostToken }: { client: StudioClient; hostToken: string }) {
  const st = client.state!;
  const m = st.music;
  const key = `uploads.${st.id}`;
  const [uploads, setUploads] = useState<{ url: string; title: string }[]>(prefs.get(key, []));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [monitor, setMonitor] = useState(prefs.get('monitorLevel', 0.6));
  const fileRef = useRef<HTMLInputElement>(null);

  const amb: AmbienceState = m.ambience ?? { on: false, volume: 0.3, mood: 'buzzing' };
  const setAmb = (p: Partial<AmbienceState>) => void client.patch({ music: { ...m, ambience: { ...amb, ...p } } });

  const play = (track: string) => void client.patch({ music: { ...m, track, playing: !(m.playing && m.track === track) } });

  const upload = async (f: File) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.uploadMusic(st.id, hostToken, f);
      const next = [...uploads, r];
      setUploads(next);
      prefs.set(key, next);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const row = (id: string, title: string, sub: string, icon: string) => {
    const on = m.playing && m.track === id;
    return (
      <ListItemButton key={id} selected={on} onClick={() => play(id)} sx={{ borderRadius: 2 }}>
        <ListItemIcon sx={{ minWidth: 36 }}>
          <Icon name={on ? 'pause_circle' : icon} fill={on} color={on ? '#3923c7' : undefined} />
        </ListItemIcon>
        <ListItemText primary={title} secondary={sub} />
        {on && <Chip size="small" label="On air" color="primary" />}
      </ListItemButton>
    );
  };

  return (
    <Stack spacing={2}>
      <Box>
        <Stack direction="row" alignItems="center">
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            Music bed
          </Typography>
          {m.playing && (
            <Button size="small" startIcon={<Icon name="stop" />} onClick={() => void client.patch({ music: { ...m, playing: false } })}>
              Stop
            </Button>
          )}
        </Stack>
        <Typography variant="caption" color="text.secondary">
          Original tracks generated live in your browser — 100% royalty-free, safe for YouTube/Facebook Content ID.
        </Typography>
        {st.autopilot.enabled && st.autopilot.autoMusic && (
          <Alert severity="info" sx={{ mt: 1, py: 0 }}>
            Auto Live is choosing the music. Pressing Stop also turns off “Auto music bed”.
          </Alert>
        )}
        <List dense sx={{ mx: -1 }}>
          {TRACKS.map((t) => row(t.id, t.title, t.mood, 'play_circle'))}
          {uploads.map((u) => row(u.url, u.title, 'Uploaded track', 'library_music'))}
        </List>
        <input ref={fileRef} type="file" accept="audio/*" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        <Button size="small" startIcon={<Icon name="upload" />} disabled={busy} onClick={() => fileRef.current?.click()}>
          Upload your own (Pixabay / YouTube Audio Library…)
        </Button>
        {err && <Alert severity="error">{err}</Alert>}
      </Box>
      <Box>
        <Typography variant="caption" color="text.secondary">
          Music volume
        </Typography>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Icon name="music_note" />
          <Slider size="small" min={0} max={1} step={0.01} defaultValue={m.volume} onChangeCommitted={(_, v) => void client.patch({ music: { ...m, volume: v as number } })} />
        </Stack>
        <FormControlLabel
          control={<Switch size="small" checked={m.duck} onChange={(e) => void client.patch({ music: { ...m, duck: e.target.checked } })} />}
          label={<Typography variant="body2">Auto-duck music when someone speaks</Typography>}
        />
        <Typography variant="caption" color="text.secondary">
          Your headphone monitor level (only you)
        </Typography>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Icon name="headphones" />
          <Slider
            size="small"
            min={0}
            max={1}
            step={0.01}
            value={monitor}
            onChange={(_, v) => {
              setMonitor(v as number);
              client.audio.setMonitorLevel(v as number);
              prefs.set('monitorLevel', v);
            }}
          />
        </Stack>
      </Box>
      <Box>
        <Stack direction="row" alignItems="center">
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            Stadium crowd ambience
          </Typography>
          <Switch size="small" checked={!!amb.on} onChange={(e) => setAmb({ on: e.target.checked })} />
        </Stack>
        <Typography variant="caption" color="text.secondary">
          A live-ground atmosphere under the show: crowd murmur, scattered claps, “ooohs”, fan horns and dhol drums. Synthesised, royalty-free.
        </Typography>
        <ToggleButtonGroup exclusive size="small" fullWidth value={amb.mood} onChange={(_, v) => v && setAmb({ mood: v as AmbienceMood })} sx={{ mt: 1 }}>
          <ToggleButton value="calm">Test match calm</ToggleButton>
          <ToggleButton value="buzzing">ODI buzz</ToggleButton>
          <ToggleButton value="packed">Packed T20</ToggleButton>
        </ToggleButtonGroup>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 1 }}>
          <Icon name="stadium" />
          <Slider size="small" min={0} max={1} step={0.01} defaultValue={amb.volume} onChangeCommitted={(_, v) => setAmb({ volume: v as number })} />
        </Stack>
      </Box>
      <Box>
        <Stack direction="row" alignItems="center">
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            Cricket sound effects
          </Typography>
          <Switch size="small" checked={st.brand.sfx} onChange={(e) => void client.patch({ brand: { ...st.brand, sfx: e.target.checked } })} />
        </Stack>
        <Typography variant="caption" color="text.secondary">
          Played automatically with overlays. Tap a name to preview locally; the megaphone fires it on air.
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mt: 1 }}>
          {(Object.keys(SFX_LABELS) as SfxId[]).map((id) => (
            <Stack key={id} direction="row" alignItems="center" sx={{ border: 1, borderColor: 'divider', borderRadius: 2, pl: 1 }}>
              <Typography variant="body2" sx={{ flex: 1, cursor: 'pointer', py: 0.75 }} noWrap onClick={() => client.playSfxLocal(id)}>
                {SFX_LABELS[id]}
              </Typography>
              <IconButton size="small" title="Play on air" onClick={() => void client.overlay({ id: 'custom', title: '', sfx: id, ms: 1 })}>
                <Icon name="campaign" size={18} />
              </IconButton>
            </Stack>
          ))}
        </Box>
        <Typography variant="caption" color="text.secondary">
          SFX volume
        </Typography>
        <Slider
          size="small"
          min={0}
          max={1}
          step={0.01}
          defaultValue={st.brand.sfxVolume}
          onChangeCommitted={(_, v) => void client.patch({ brand: { ...st.brand, sfxVolume: v as number } })}
        />
      </Box>
    </Stack>
  );
}
