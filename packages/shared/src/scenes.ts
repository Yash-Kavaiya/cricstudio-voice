export type SceneId =
  | 'startingSoon'
  | 'hostSolo'
  | 'panel'
  | 'scoreHero'
  | 'ballByBall'
  | 'battingCard'
  | 'bowlingCard'
  | 'batters'
  | 'bowlerSpotlight'
  | 'manhattan'
  | 'worm'
  | 'fallOfWickets'
  | 'playingXI'
  | 'aroundGrounds'
  | 'commentaryDesk'
  | 'screenShare'
  | 'break'
  | 'message'
  | 'result'
  // insights pack
  | 'winPredictor'
  | 'projectedScore'
  | 'phaseAnalysis'
  | 'boundaryTracker'
  | 'matchup'
  | 'wagonWheel'
  | 'starPerformer'
  | 'keyMoments'
  | 'upcomingMatches'
  | 'fanPoll'
  // analysis pack
  | 'runRateGraph'
  | 'overHeatmap'
  | 'scoringBreakdown'
  | 'partnerships'
  | 'battingImpact'
  | 'bowlingAnalysis'
  | 'dismissalAnalysis'
  | 'extrasDiscipline'
  | 'momentum'
  | 'inningsComparison'
  | 'chaseCalculator'
  | 'matchReport';

export interface SceneMeta {
  id: SceneId;
  name: string;
  short: string;
  group: 'Show' | 'Cameras' | 'Score' | 'Stats' | 'Insights' | 'Analysis' | 'Match';
  icon: string; // Material Symbols name
  usesCameras: boolean;
  hotkey?: string;
  /** included in the autopilot rotation */
  autopilot: boolean;
}

export const SCENES: SceneMeta[] = [
  { id: 'startingSoon', name: 'Starting Soon', short: 'Starting', group: 'Show', icon: 'schedule', usesCameras: false, hotkey: '1', autopilot: false },
  { id: 'hostSolo', name: 'Host Solo', short: 'Solo', group: 'Cameras', icon: 'person', usesCameras: true, hotkey: '2', autopilot: true },
  { id: 'panel', name: 'Expert Panel', short: 'Panel', group: 'Cameras', icon: 'groups', usesCameras: true, hotkey: '3', autopilot: true },
  { id: 'commentaryDesk', name: 'Commentary Desk', short: 'Desk', group: 'Cameras', icon: 'mic_external_on', usesCameras: true, hotkey: '4', autopilot: true },
  { id: 'scoreHero', name: 'Live Score', short: 'Score', group: 'Score', icon: 'scoreboard', usesCameras: false, hotkey: '5', autopilot: true },
  { id: 'ballByBall', name: 'Ball by Ball', short: 'Balls', group: 'Score', icon: 'sports_cricket', usesCameras: false, hotkey: '6', autopilot: true },
  { id: 'battingCard', name: 'Batting Scorecard', short: 'Batting', group: 'Score', icon: 'table_rows', usesCameras: false, hotkey: '7', autopilot: true },
  { id: 'bowlingCard', name: 'Bowling Figures', short: 'Bowling', group: 'Score', icon: 'sports_baseball', usesCameras: false, hotkey: '8', autopilot: true },
  { id: 'batters', name: 'At the Crease', short: 'Crease', group: 'Stats', icon: 'handshake', usesCameras: false, hotkey: '9', autopilot: true },
  { id: 'bowlerSpotlight', name: 'Bowler Spotlight', short: 'Bowler', group: 'Stats', icon: 'flare', usesCameras: false, autopilot: true },
  { id: 'manhattan', name: 'Manhattan', short: 'Manhattan', group: 'Stats', icon: 'bar_chart', usesCameras: false, autopilot: true },
  { id: 'worm', name: 'Worm', short: 'Worm', group: 'Stats', icon: 'show_chart', usesCameras: false, autopilot: true },
  { id: 'fallOfWickets', name: 'Fall of Wickets', short: 'FoW', group: 'Stats', icon: 'trending_down', usesCameras: false, autopilot: true },
  { id: 'winPredictor', name: 'Win Predictor', short: 'Win %', group: 'Insights', icon: 'percent', usesCameras: false, autopilot: true },
  { id: 'projectedScore', name: 'Projected Score', short: 'Projected', group: 'Insights', icon: 'query_stats', usesCameras: false, autopilot: true },
  { id: 'phaseAnalysis', name: 'Phase Analysis', short: 'Phases', group: 'Insights', icon: 'view_timeline', usesCameras: false, autopilot: true },
  { id: 'boundaryTracker', name: 'Boundary Tracker', short: 'Boundaries', group: 'Insights', icon: 'crisis_alert', usesCameras: false, autopilot: true },
  { id: 'matchup', name: 'Batter vs Bowler', short: 'Matchup', group: 'Insights', icon: 'swords', usesCameras: false, autopilot: true },
  { id: 'wagonWheel', name: 'Wagon Wheel', short: 'Wagon', group: 'Insights', icon: 'radar', usesCameras: false, autopilot: true },
  { id: 'starPerformer', name: 'Star Performer', short: 'Star', group: 'Insights', icon: 'military_tech', usesCameras: false, autopilot: true },
  { id: 'keyMoments', name: 'Key Moments', short: 'Moments', group: 'Insights', icon: 'timeline', usesCameras: false, autopilot: true },
  { id: 'runRateGraph', name: 'Run Rate Graph', short: 'Run rate', group: 'Analysis', icon: 'monitoring', usesCameras: false, autopilot: true },
  { id: 'overHeatmap', name: 'Over-by-Over Heatmap', short: 'Heatmap', group: 'Analysis', icon: 'grid_view', usesCameras: false, autopilot: true },
  { id: 'scoringBreakdown', name: 'Scoring Breakdown', short: 'Scoring', group: 'Analysis', icon: 'donut_large', usesCameras: false, autopilot: true },
  { id: 'partnerships', name: 'Partnerships', short: 'Partners', group: 'Analysis', icon: 'group_work', usesCameras: false, autopilot: true },
  { id: 'battingImpact', name: 'Batting Impact', short: 'Impact', group: 'Analysis', icon: 'bubble_chart', usesCameras: false, autopilot: true },
  { id: 'bowlingAnalysis', name: 'Bowling Analysis', short: 'Bowl stats', group: 'Analysis', icon: 'speed', usesCameras: false, autopilot: true },
  { id: 'dismissalAnalysis', name: 'How Wickets Fell', short: 'Dismissals', group: 'Analysis', icon: 'pie_chart', usesCameras: false, autopilot: true },
  { id: 'extrasDiscipline', name: 'Extras & Discipline', short: 'Extras', group: 'Analysis', icon: 'gavel', usesCameras: false, autopilot: true },
  { id: 'momentum', name: 'Momentum Swing', short: 'Momentum', group: 'Analysis', icon: 'swap_vert', usesCameras: false, autopilot: true },
  { id: 'inningsComparison', name: 'At This Stage', short: 'Compare', group: 'Analysis', icon: 'compare_arrows', usesCameras: false, autopilot: true },
  { id: 'chaseCalculator', name: 'Chase Calculator', short: 'Chase', group: 'Analysis', icon: 'calculate', usesCameras: false, autopilot: true },
  { id: 'matchReport', name: 'Match Report', short: 'Report', group: 'Analysis', icon: 'summarize', usesCameras: false, autopilot: true },
  { id: 'playingXI', name: 'Playing XIs & Toss', short: 'XIs', group: 'Match', icon: 'badge', usesCameras: false, autopilot: true },
  { id: 'aroundGrounds', name: 'Around the Grounds', short: 'Grounds', group: 'Match', icon: 'public', usesCameras: false, autopilot: true },
  { id: 'upcomingMatches', name: 'Upcoming Matches', short: 'Upcoming', group: 'Match', icon: 'event_upcoming', usesCameras: false, autopilot: true },
  { id: 'fanPoll', name: 'Fan Poll', short: 'Poll', group: 'Match', icon: 'how_to_vote', usesCameras: false, autopilot: true },
  { id: 'screenShare', name: 'Screen Share + PiP', short: 'Screen', group: 'Cameras', icon: 'present_to_all', usesCameras: true, hotkey: '0', autopilot: false },
  { id: 'message', name: 'Announcement', short: 'Message', group: 'Show', icon: 'campaign', usesCameras: false, autopilot: false },
  { id: 'break', name: 'Innings Break / BRB', short: 'Break', group: 'Show', icon: 'coffee', usesCameras: false, autopilot: false },
  { id: 'result', name: 'Result & Thanks', short: 'Result', group: 'Show', icon: 'emoji_events', usesCameras: false, autopilot: false },
];

export const SCENE_IDS = SCENES.map((s) => s.id);

/* ---------------- looks ---------------- */

export type BackgroundId =
  | 'stadiumNight'
  | 'pitchGreen'
  | 'constellation'
  | 'hexTech'
  | 'liquidWaves'
  | 'prism'
  | 'teamClash'
  | 'seamLines'
  // cricket themes (colour stories only: no logos or official marks)
  | 'worldCup23'
  | 'lordsScoreboard'
  | 'iplNight'
  | 'bblNeon'
  | 'wtcFinal'
  | 'womensWc'
  | 'ausGoldGreen'
  | 'ashes'
  | 'royalIvory'
  | 'electricBlue'
  | 'platinumPavilion'
  | 'usaStars'
  | 'proteasGreenGold'
  // brand-inspired design systems (colours, type and shapes only: no logos)
  | 'assemblyai'
  | 'microsoftFluent'
  | 'claudePaper'
  | 'xMono'
  // photo themes (Unsplash, see apps/web/public/themes/CREDITS.md)
  | 'photoFloodlit'
  | 'photoSunsetOval'
  | 'photoRedSky'
  | 'photoMountain'
  | 'photoRedBall'
  | 'photoRainCovers'
  | 'photoBigHit'
  | 'photoGrandstand';

export interface BackgroundMeta {
  id: BackgroundId;
  name: string;
  colors: [string, string];
  /** accent colour applied when the theme is picked */
  accent?: string;
  group: 'Brand-inspired' | 'Photo' | 'Cricket themes' | 'Studio';
  /** photo themes: picture under /themes (thumbnail: `<name>-thumb.jpg`) */
  photo?: string;
  /** light theme (dark text on a bright page) */
  light?: boolean;
}

export const BACKGROUNDS: BackgroundMeta[] = [
  { id: 'assemblyai', name: 'AssemblyAI · Paper', colors: ['#fdfcf8', '#3923c7'], accent: '#3923c7', group: 'Brand-inspired', light: true },
  { id: 'microsoftFluent', name: 'Microsoft · Fluent', colors: ['#0b0f1a', '#0078d4'], accent: '#0078d4', group: 'Brand-inspired' },
  { id: 'claudePaper', name: 'Claude · Paper', colors: ['#f0eee6', '#d97757'], accent: '#d97757', group: 'Brand-inspired', light: true },
  { id: 'xMono', name: 'X · Mono', colors: ['#000000', '#2f3336'], accent: '#1d9bf0', group: 'Brand-inspired' },
  { id: 'photoFloodlit', name: 'Floodlit Night', colors: ['#0a1530', '#2d5a1e'], accent: '#4c8df6', group: 'Photo', photo: 'floodlit' },
  { id: 'photoSunsetOval', name: 'Sunset Oval', colors: ['#3b1f4a', '#e8836b'], accent: '#ff8a65', group: 'Photo', photo: 'sunset-oval' },
  { id: 'photoRedSky', name: 'Red Sky Stadium', colors: ['#2a0a08', '#c0392b'], accent: '#ff5a3c', group: 'Photo', photo: 'red-sky' },
  { id: 'photoMountain', name: 'Mountain Ground', colors: ['#1f4f7a', '#3f7a2b'], accent: '#5ab0ff', group: 'Photo', photo: 'mountain' },
  { id: 'photoRedBall', name: 'Red Ball', colors: ['#16300f', '#b23a2b'], accent: '#e2452f', group: 'Photo', photo: 'red-ball' },
  { id: 'photoRainCovers', name: 'Rain Covers', colors: ['#2b3a4a', '#4f7a3a'], accent: '#5fb8ff', group: 'Photo', photo: 'rain-covers' },
  { id: 'photoBigHit', name: 'Big Hit', colors: ['#3a3128', '#8a5a3a'], accent: '#f0a04b', group: 'Photo', photo: 'big-hit' },
  { id: 'photoGrandstand', name: 'Grandstand', colors: ['#334155', '#2f6b2f'], accent: '#7fd36b', group: 'Photo', photo: 'grandstand' },
  { id: 'worldCup23', name: "World Cup '23 style", colors: ['#1d0c58', '#e6007e'], accent: '#e6007e', group: 'Cricket themes' },
  { id: 'lordsScoreboard', name: 'Old Scoreboard', colors: ['#143322', '#e9dfc0'], accent: '#d9c98f', group: 'Cricket themes' },
  { id: 'iplNight', name: 'T20 League Night', colors: ['#0b1a66', '#ffb300'], accent: '#ffb300', group: 'Cricket themes' },
  { id: 'bblNeon', name: 'Big Bash Neon', colors: ['#07070d', '#39ff14'], accent: '#39ff14', group: 'Cricket themes' },
  { id: 'wtcFinal', name: 'Test Championship', colors: ['#06142e', '#d4af37'], accent: '#d4af37', group: 'Cricket themes' },
  { id: 'womensWc', name: "Women's World Cup", colors: ['#2a0b3f', '#19c3b8'], accent: '#ff4f9a', group: 'Cricket themes' },
  { id: 'ausGoldGreen', name: 'Australia Green & Gold', colors: ['#00843d', '#ffcd00'], accent: '#ffcd00', group: 'Cricket themes' },
  { id: 'ashes', name: 'The Ashes · AUS v ENG', colors: ['#00843d', '#0b1f4b'], accent: '#c8102e', group: 'Cricket themes' },
  { id: 'royalIvory', name: 'Royal Ivory & Gold', colors: ['#2e2313', '#e9d9a6'], accent: '#d4af37', group: 'Cricket themes' },
  { id: 'electricBlue', name: 'Electric Blue Arena', colors: ['#010618', '#00b4ff'], accent: '#00b4ff', group: 'Cricket themes' },
  { id: 'platinumPavilion', name: 'Platinum Pavilion', colors: ['#15171b', '#c9ced8'], accent: '#aeb8c8', group: 'Cricket themes' },
  { id: 'usaStars', name: 'USA Stars & Stripes', colors: ['#0a1f44', '#b22234'], accent: '#b22234', group: 'Cricket themes' },
  { id: 'proteasGreenGold', name: 'South Africa Green & Gold', colors: ['#004d2e', '#ffb612'], accent: '#ffb612', group: 'Cricket themes' },
  { id: 'stadiumNight', name: 'Stadium Night', colors: ['#050a1a', '#1b2a52'], group: 'Studio' },
  { id: 'pitchGreen', name: 'Pitch Green', colors: ['#06210f', '#1f5d2c'], group: 'Studio' },
  { id: 'constellation', name: 'Constellation', colors: ['#020617', '#1e3a8a'], group: 'Studio' },
  { id: 'hexTech', name: 'Hex Tech', colors: ['#03121c', '#0e7490'], group: 'Studio' },
  { id: 'liquidWaves', name: 'Liquid Waves', colors: ['#06132b', '#1a73e8'], group: 'Studio' },
  { id: 'prism', name: 'Prism Glass', colors: ['#120c24', '#ea4335'], group: 'Studio' },
  { id: 'teamClash', name: 'Team Clash', colors: ['#111827', '#f59e0b'], group: 'Studio' },
  { id: 'seamLines', name: 'Ball Seam', colors: ['#2a0606', '#b91c1c'], group: 'Studio' },
];

export type TransitionId = 'fadeZoom' | 'slideLeft' | 'wipeDiagonal' | 'circleReveal' | 'blinds' | 'flip3d' | 'pushUp' | 'stingerBall' | 'glitch' | 'zoomBlur';

export const TRANSITIONS: { id: TransitionId; name: string }[] = [
  { id: 'fadeZoom', name: 'Fade + zoom' },
  { id: 'slideLeft', name: 'Slide' },
  { id: 'wipeDiagonal', name: 'Diagonal wipe' },
  { id: 'circleReveal', name: 'Circle reveal' },
  { id: 'blinds', name: 'Blinds' },
  { id: 'flip3d', name: '3D flip' },
  { id: 'pushUp', name: 'Push up' },
  { id: 'stingerBall', name: 'Cricket-ball stinger' },
  { id: 'glitch', name: 'Glitch' },
  { id: 'zoomBlur', name: 'Zoom blur' },
];
