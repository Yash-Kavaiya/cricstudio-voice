import { useEffect, useState } from 'react';
import { Alert, Box, Button, ButtonBase, Divider, FormControlLabel, MenuItem, Slider, Stack, Switch, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { BACKGROUNDS, TRANSITIONS, type CamBubbleCorner } from '@cricstudio/shared';
import { CaptionsSettings } from './CaptionsSettings';
import type { StudioClient } from '../../lib/studioClient';
import { Icon } from '../Icon';

const ACCENTS = ['#3923c7', '#ea4335', '#34a853', '#f9ab00', '#a142f4', '#12b5cb', '#e8710a', '#d01884'];

export function BrandPanel({ client, hostToken }: { client: StudioClient; hostToken: string }) {
  const st = client.state!;
  const b = st.brand;
  const [title, setTitle] = useState(b.title);
  const [ticker, setTicker] = useState(b.ticker);
  const [lt, setLt] = useState({ title: '', subtitle: '' });
  const [sponsors, setSponsors] = useState((b.sponsors ?? []).join('\n'));
  useEffect(() => {
    setSponsors((b.sponsors ?? []).join('\n'));
  }, [(b.sponsors ?? []).join('\n')]);
  const sponsorLines = sponsors.split('\n').map((x) => x.trim()).filter(Boolean);
  const banner = st.banner?.kind ?? null;
  useEffect(() => {
    setTitle(b.title);
  }, [b.title]);
  useEffect(() => {
    setTicker(b.ticker);
  }, [b.ticker]);
  const patchBrand = (p: Partial<typeof b>) => void client.patch({ brand: { ...b, ...p } });

  return (
    <Stack spacing={2}>
      <TextField label="Show title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== b.title && patchBrand({ title })} />
      <TextField label="Ticker message" multiline minRows={2} value={ticker} onChange={(e) => setTicker(e.target.value)} onBlur={() => ticker !== b.ticker && patchBrand({ ticker })} />
      <Box>
        <Typography variant="caption" color="text.secondary">
          Accent colour
        </Typography>
        <Stack direction="row" gap={1} sx={{ mt: 0.5 }} flexWrap="wrap">
          {ACCENTS.map((c) => (
            <Box
              key={c}
              onClick={() => patchBrand({ accent: c })}
              sx={{ width: 30, height: 30, borderRadius: '50%', bgcolor: c, cursor: 'pointer', outline: b.accent === c ? '3px solid' : 'none', outlineColor: 'text.primary', outlineOffset: 2 }}
            />
          ))}
        </Stack>
      </Box>
      <FormControlLabel control={<Switch checked={b.showScorebug} onChange={(e) => patchBrand({ showScorebug: e.target.checked })} />} label="Scorebug on camera scenes" />
      <Box>
        {(
          [
            ['Brand-inspired', 'Design systems: own colours, fonts and card shapes'],
            ['Photo', 'Stadium photos'],
            ['Cricket themes', 'Cricket themes'],
            ['Studio', 'Studio backgrounds'],
          ] as const
        ).map(([group, label]) => (
          <Box key={group} sx={{ mb: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
              {label}
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, mt: 0.5 }}>
              {BACKGROUNDS.filter((bg) => bg.group === group).map((bg) => (
                <ButtonBase
                  key={bg.id}
                  onClick={() => patchBrand({ background: bg.id, ...(bg.accent ? { accent: bg.accent } : {}) })}
                  sx={{
                    height: 58,
                    borderRadius: 2,
                    background: bg.photo
                      ? `linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.75)), url(/themes/${bg.photo}-thumb.jpg) center/cover`
                      : `linear-gradient(135deg, ${bg.colors[0]}, ${bg.colors[1]})`,
                    color: bg.light ? '#1f1f1f' : '#fff',
                    fontSize: 12,
                    fontWeight: 600,
                    textShadow: bg.light ? 'none' : '0 1px 3px rgba(0,0,0,0.8)',
                    border: bg.light ? '1px solid rgba(0,0,0,0.12)' : 'none',
                    alignItems: 'flex-end',
                    justifyContent: 'flex-start',
                    p: 0.75,
                    outline: b.background === bg.id ? '3px solid' : 'none',
                    outlineColor: 'primary.main',
                    outlineOffset: 2,
                  }}
                >
                  {bg.name}
                </ButtonBase>
              ))}
            </Box>
          </Box>
        ))}
      </Box>
      <TextField select label="Scene transition" value={b.transition} onChange={(e) => patchBrand({ transition: e.target.value as typeof b.transition })}>
        <MenuItem value="mixed">Mixed (varies every cut)</MenuItem>
        {TRANSITIONS.map((t) => (
          <MenuItem key={t.id} value={t.id}>
            {t.name}
          </MenuItem>
        ))}
      </TextField>
      <FormControlLabel control={<Switch checked={b.fx3d} onChange={(e) => patchBrand({ fx3d: e.target.checked })} />} label="3D celebrations (four, six, wicket, milestones)" />
      <TextField label="Fan poll question" value={b.pollQuestion} onChange={(e) => patchBrand({ pollQuestion: e.target.value })} />
      <FormControlLabel control={<Switch checked={b.showTicker} onChange={(e) => patchBrand({ showTicker: e.target.checked })} />} label="Bottom ticker (other live scores)" />
      <Divider />
      <Box>
        <FormControlLabel
          control={<Switch checked={!!b.camBubbles} onChange={(e) => patchBrand({ camBubbles: e.target.checked })} />}
          label={
            <Box>
              <Typography variant="body2">Round camera bubbles on every scene</Typography>
              <Typography variant="caption" color="text.secondary">
                Host & guests on stage appear as cricket-ball circles over scoreboards, stats and analysis (camera scenes keep their full-size tiles).
              </Typography>
            </Box>
          }
          sx={{ alignItems: 'flex-start', mx: 0 }}
        />
        {b.camBubbles && (
          <Stack spacing={1} sx={{ mt: 1, pl: 1 }}>
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Typography variant="caption" color="text.secondary" sx={{ width: 56 }}>
                Corner
              </Typography>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={b.camBubbleCorner ?? 'br'}
                onChange={(_, v: CamBubbleCorner | null) => v && patchBrand({ camBubbleCorner: v })}
              >
                <ToggleButton value="tl">Top left</ToggleButton>
                <ToggleButton value="tr">Top right</ToggleButton>
                <ToggleButton value="bl">Bottom left</ToggleButton>
                <ToggleButton value="br">Bottom right</ToggleButton>
              </ToggleButtonGroup>
            </Stack>
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Typography variant="caption" color="text.secondary" sx={{ width: 56 }}>
                Size
              </Typography>
              <Slider
                size="small"
                min={120}
                max={400}
                step={10}
                defaultValue={b.camBubbleSize ?? 220}
                valueLabelDisplay="auto"
                valueLabelFormat={(v) => `${v}px`}
                onChangeCommitted={(_, v) => patchBrand({ camBubbleSize: v as number })}
              />
            </Stack>
            {!client.state?.participants.some((p) => p.onStage && p.role !== 'program') && (
              <Alert severity="info">Add the host or a guest to the stage to see the bubbles.</Alert>
            )}
          </Stack>
        )}
      </Box>
      <Divider />
      <CaptionsSettings client={client} hostToken={hostToken} />
      <Divider />
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Lower third / banner
        </Typography>
        <Stack spacing={1}>
          <TextField label="Headline" value={lt.title} onChange={(e) => setLt({ ...lt, title: e.target.value })} />
          <TextField label="Sub-line" value={lt.subtitle} onChange={(e) => setLt({ ...lt, subtitle: e.target.value })} />
          <Stack direction="row" spacing={1}>
            <Button variant="contained" startIcon={<Icon name="subtitles" />} disabled={!lt.title} onClick={() => void client.overlay({ id: 'custom', title: lt.title, subtitle: lt.subtitle || undefined, ms: 8000, sfx: 'whoosh' })}>
              Show 8s
            </Button>
            <Button onClick={() => void client.overlay(null)}>Clear overlay</Button>
          </Stack>
        </Stack>
      </Box>
      <Divider />
      <Box>
        <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            Banners
          </Typography>
          {banner && <Typography variant="caption" color="error.main">● {banner === 'sponsor' ? 'Sponsors' : 'Quick score'} on air</Typography>}
        </Stack>
        <Stack spacing={1}>
          <TextField
            label="Sponsor lines (one per line, rotate every 6 s)"
            placeholder={'Powered by Acme Sports\nOfficial drinks partner: FizzUp'}
            multiline
            minRows={2}
            value={sponsors}
            onChange={(e) => setSponsors(e.target.value)}
            onBlur={() => sponsorLines.join('\n') !== (b.sponsors ?? []).join('\n') && patchBrand({ sponsors: sponsorLines })}
          />
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button
              variant={banner === 'sponsor' ? 'contained' : 'outlined'}
              startIcon={<Icon name="handshake" />}
              disabled={!sponsorLines.length}
              onClick={() => {
                if (banner === 'sponsor') return void client.patch({ banner: null });
                void client.patch({ brand: { ...b, sponsors: sponsorLines }, banner: { kind: 'sponsor', since: Date.now() } });
              }}
            >
              {banner === 'sponsor' ? 'Hide sponsors' : 'Sponsor banner'}
            </Button>
            <Button
              variant={banner === 'quickScore' ? 'contained' : 'outlined'}
              startIcon={<Icon name="scoreboard" />}
              disabled={!client.match}
              onClick={() => void client.patch({ banner: banner === 'quickScore' ? null : { kind: 'quickScore', since: Date.now() } })}
            >
              {banner === 'quickScore' ? 'Hide quick score' : 'Quick score banner'}
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {client.match ? `Quick score shows ${client.match.title} only.` : 'Pick a match to use the quick score banner.'} Banners match the Background theme and stay on until you hide them.
          </Typography>
        </Stack>
      </Box>
    </Stack>
  );
}
