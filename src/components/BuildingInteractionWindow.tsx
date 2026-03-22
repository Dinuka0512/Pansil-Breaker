import { useState } from 'react';

export type BuildingType = 'karma_mart' | 'club_nirvana' | 'corporate' | 'underground_bar' | 'safehouse' | 'police_station';

export interface BuildingAction {
  label: string;
  description: string;
  path: 'clean' | 'neutral' | 'chaos';
  icon: string;
  cost?: number;
  precept?: string;
  preceptAmount?: number;
  heatChange?: number;
  healthChange?: number;
  scoreChange?: number;
  weapon?: string;
  requiresCash?: number;
}

interface Props {
  buildingName: string;
  buildingType: BuildingType;
  playerCash: number;
  playerWeapons: string[];
  playerHealth: number;
  playerMaxHealth: number;
  onAction: (action: BuildingAction) => void;
  onClose: () => void;
}

const PATH_COLORS = {
  clean: { border: '#00ff88', bg: 'rgba(0,255,136,0.06)', text: '#00ff88', label: '☮ CLEAN' },
  neutral: { border: '#ffcc00', bg: 'rgba(255,204,0,0.06)', text: '#ffcc00', label: '◐ NEUTRAL' },
  chaos: { border: '#ff2233', bg: 'rgba(255,34,51,0.06)', text: '#ff2233', label: '☠ CHAOS' },
};

const BUILDING_CONFIGS: Record<BuildingType, { title: string; icon: string; color: string; actions: BuildingAction[] }> = {
  karma_mart: {
    title: 'KARMA MART',
    icon: '🏪',
    color: '#ff9900',
    actions: [
      { label: 'Buy Medkit', description: 'Restore health (+50 HP)', path: 'clean', icon: '💊', cost: 100, healthChange: 50 },
      { label: 'Buy Blade', description: 'A sharp combat knife', path: 'neutral', icon: '🔪', cost: 200, weapon: 'blade', scoreChange: 20 },
      { label: 'Buy Stun Gun', description: 'Non-lethal takedown tool', path: 'neutral', icon: '⚡', cost: 350, weapon: 'stungun', scoreChange: 30 },
      { label: 'Buy Plasma Cutter', description: 'Military-grade weapon', path: 'chaos', icon: '🔫', cost: 600, weapon: 'plasma', precept: 'violence', preceptAmount: 5, heatChange: 1, scoreChange: 50 },
      { label: 'Shoplift', description: 'Steal random merchandise', path: 'chaos', icon: '🤏', precept: 'theft', preceptAmount: 12, heatChange: 1, scoreChange: 150 },
      { label: 'Rob Register', description: 'Hold up the cashier', path: 'chaos', icon: '💰', precept: 'violence', preceptAmount: 15, heatChange: 2, scoreChange: 300 },
    ],
  },
  club_nirvana: {
    title: 'CLUB NIRVANA',
    icon: '🎵',
    color: '#cc33ff',
    actions: [
      { label: 'Chill & Dance', description: 'Reduce stress, lower Heat', path: 'clean', icon: '💃', heatChange: -1, healthChange: 10 },
      { label: 'Socialize', description: 'Gather intel from patrons', path: 'neutral', icon: '🗣', precept: 'deception', preceptAmount: 3, scoreChange: 50 },
      { label: 'Buy Drinks', description: 'Get tipsy (slight rage boost)', path: 'neutral', icon: '🍸', cost: 50, precept: 'intoxication', preceptAmount: 5 },
      { label: 'Take Substances', description: 'Enter Rage Mode instantly', path: 'chaos', icon: '💉', cost: 150, precept: 'intoxication', preceptAmount: 20 },
      { label: 'Start a Fight', description: 'Brawl with patrons', path: 'chaos', icon: '👊', precept: 'violence', preceptAmount: 10, heatChange: 1, scoreChange: 80 },
      { label: 'Seduce & Betray', description: 'Manipulate for cash', path: 'chaos', icon: '😈', precept: 'misconduct', preceptAmount: 15, scoreChange: 200 },
    ],
  },
  corporate: {
    title: 'CORPORATE OFFICE',
    icon: '🏢',
    color: '#00ccff',
    actions: [
      { label: 'Report Crime', description: 'Cooperate with authorities (-Heat)', path: 'clean', icon: '📋', heatChange: -2 },
      { label: 'Apply for Job', description: 'Earn honest pay', path: 'clean', icon: '💼', scoreChange: 100 },
      { label: 'Hack Terminal', description: 'Access classified data', path: 'neutral', icon: '💻', precept: 'deception', preceptAmount: 8, scoreChange: 120 },
      { label: 'Bribe Executive', description: 'Pay for protection', path: 'chaos', icon: '💵', cost: 300, precept: 'deception', preceptAmount: 12, heatChange: -1 },
      { label: 'Steal Documents', description: 'Corporate espionage', path: 'chaos', icon: '📁', precept: 'theft', preceptAmount: 15, heatChange: 1, scoreChange: 250 },
      { label: 'Plant Evidence', description: 'Frame a rival', path: 'chaos', icon: '🎭', precept: 'deception', preceptAmount: 20, scoreChange: 300 },
    ],
  },
  underground_bar: {
    title: 'VOID BAR',
    icon: '🍺',
    color: '#ff33aa',
    actions: [
      { label: 'Drink Water', description: 'Stay sober, heal slightly', path: 'clean', icon: '💧', healthChange: 20 },
      { label: 'Gamble', description: 'Risk cash for more', path: 'neutral', icon: '🎰', cost: 100, scoreChange: 250 },
      { label: 'Buy Info', description: 'Criminal contacts', path: 'neutral', icon: '🔍', cost: 75, precept: 'deception', preceptAmount: 5, scoreChange: 80 },
      { label: 'Get Wasted', description: 'Heavy intoxication + rage', path: 'chaos', icon: '🥃', cost: 80, precept: 'intoxication', preceptAmount: 25 },
      { label: 'Bar Fight', description: 'Smash everything', path: 'chaos', icon: '🪑', precept: 'violence', preceptAmount: 12, heatChange: 1, scoreChange: 100 },
      { label: 'Drug Deal', description: 'Move product for profit', path: 'chaos', icon: '☠', precept: 'intoxication', preceptAmount: 18, heatChange: 1, scoreChange: 350 },
    ],
  },
  safehouse: {
    title: 'SAFEHOUSE',
    icon: '🏠',
    color: '#00ff88',
    actions: [
      { label: 'Rest & Heal', description: 'Full health restoration', path: 'clean', icon: '🛏', healthChange: 999, heatChange: -1 },
      { label: 'Lay Low', description: 'Reduce all Heat by 2', path: 'clean', icon: '🕶', heatChange: -2 },
      { label: 'Stash Loot', description: 'Bank your score safely', path: 'neutral', icon: '📦', scoreChange: 50 },
      { label: 'Plan Heist', description: 'Scout for big scores', path: 'chaos', icon: '🗺', precept: 'theft', preceptAmount: 8, scoreChange: 150 },
      { label: 'Cook Substances', description: 'Produce rage inducers', path: 'chaos', icon: '⚗', precept: 'intoxication', preceptAmount: 15, scoreChange: 200 },
    ],
  },
  police_station: {
    title: 'POLICE STATION',
    icon: '🚔',
    color: '#3377ff',
    actions: [
      { label: 'Surrender', description: 'Clear all Heat, lose score', path: 'clean', icon: '🏳', heatChange: -5, scoreChange: -500 },
      { label: 'Community Service', description: 'Reduce Heat moderately', path: 'clean', icon: '🧹', heatChange: -2 },
      { label: 'File Report', description: 'Minor Heat reduction', path: 'neutral', icon: '📝', heatChange: -1 },
      { label: 'Bribe Officers', description: 'Pay to clear wanted level', path: 'chaos', icon: '💰', cost: 400, precept: 'deception', preceptAmount: 10, heatChange: -3 },
      { label: 'Steal Evidence', description: 'Remove criminal records', path: 'chaos', icon: '🔓', precept: 'theft', preceptAmount: 18, heatChange: 2, scoreChange: 200 },
      { label: 'Free Prisoners', description: 'Break out criminals', path: 'chaos', icon: '⛓', precept: 'misconduct', preceptAmount: 20, heatChange: 3, scoreChange: 400 },
    ],
  },
};

export default function BuildingInteractionWindow({ buildingName, buildingType, playerCash, playerWeapons, playerHealth, playerMaxHealth, onAction, onClose }: Props) {
  const [selectedPath, setSelectedPath] = useState<'all' | 'clean' | 'neutral' | 'chaos'>('all');
  const config = BUILDING_CONFIGS[buildingType];
  if (!config) return null;

  const filteredActions = selectedPath === 'all' ? config.actions : config.actions.filter(a => a.path === selectedPath);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="relative w-full max-w-md mx-4 animate-fade-in"
        style={{
          background: 'linear-gradient(135deg, hsl(0 0% 5% / 0.98), hsl(0 0% 8% / 0.98))',
          border: `1px solid ${config.color}55`,
          borderTop: `2px solid ${config.color}`,
          borderRadius: 6,
          boxShadow: `0 0 40px ${config.color}33, inset 0 1px 0 ${config.color}22`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${config.color}22` }}>
          <div className="flex items-center gap-2">
            <span className="text-xl">{config.icon}</span>
            <span className="font-display text-lg tracking-widest" style={{ color: config.color, textShadow: `0 0 10px ${config.color}66` }}>
              {config.title}
            </span>
          </div>
          <button
            onClick={onClose}
            className="font-display text-sm px-2 py-1 rounded transition-colors"
            style={{ color: '#666', border: '1px solid #333' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#ff2233'; e.currentTarget.style.borderColor = '#ff223366'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#666'; e.currentTarget.style.borderColor = '#333'; }}
          >
            ✕ ESC
          </button>
        </div>

        {/* Player info bar */}
        <div className="flex items-center gap-4 px-4 py-2" style={{ background: 'rgba(255,255,255,0.02)' }}>
          <span className="font-mono-game text-xs" style={{ color: '#ffcc00' }}>💰 ${playerCash}</span>
          <span className="font-mono-game text-xs" style={{ color: playerHealth / playerMaxHealth > 0.5 ? '#00ff88' : '#ff2233' }}>
            ♥ {Math.round(playerHealth)}/{playerMaxHealth}
          </span>
          {playerWeapons.length > 0 && (
            <span className="font-mono-game text-xs" style={{ color: '#ff9900' }}>⚔ {playerWeapons.length} wpn</span>
          )}
        </div>

        {/* Path filter tabs */}
        <div className="flex gap-1 px-4 py-2">
          {(['all', 'clean', 'neutral', 'chaos'] as const).map(path => (
            <button
              key={path}
              onClick={() => setSelectedPath(path)}
              className="font-display text-xs px-2 py-1 rounded transition-all"
              style={{
                background: selectedPath === path
                  ? (path === 'all' ? 'rgba(255,255,255,0.08)' : PATH_COLORS[path as 'clean' | 'neutral' | 'chaos'].bg)
                  : 'transparent',
                border: `1px solid ${selectedPath === path
                  ? (path === 'all' ? '#555' : PATH_COLORS[path as 'clean' | 'neutral' | 'chaos'].border + '66')
                  : '#222'}`,
                color: selectedPath === path
                  ? (path === 'all' ? '#aaa' : PATH_COLORS[path as 'clean' | 'neutral' | 'chaos'].text)
                  : '#555',
                letterSpacing: '0.08em',
              }}
            >
              {path === 'all' ? '◉ ALL' : PATH_COLORS[path].label}
            </button>
          ))}
        </div>

        {/* Actions list */}
        <div className="px-4 pb-4 space-y-1.5 max-h-64 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: '#333 transparent' }}>
          {filteredActions.map((action, i) => {
            const pathStyle = PATH_COLORS[action.path];
            const canAfford = !action.cost || playerCash >= action.cost;
            const alreadyHas = action.weapon && playerWeapons.includes(action.weapon);

            return (
              <button
                key={i}
                onClick={() => {
                  if (!canAfford || alreadyHas) return;
                  onAction(action);
                }}
                disabled={!canAfford || !!alreadyHas}
                className="w-full text-left px-3 py-2.5 rounded transition-all flex items-start gap-2.5 group"
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: `1px solid ${canAfford && !alreadyHas ? pathStyle.border + '33' : '#222'}`,
                  opacity: canAfford && !alreadyHas ? 1 : 0.4,
                  cursor: canAfford && !alreadyHas ? 'pointer' : 'not-allowed',
                }}
                onMouseEnter={e => {
                  if (canAfford && !alreadyHas) {
                    e.currentTarget.style.background = pathStyle.bg;
                    e.currentTarget.style.borderColor = pathStyle.border + '88';
                  }
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                  e.currentTarget.style.borderColor = canAfford && !alreadyHas ? pathStyle.border + '33' : '#222';
                }}
              >
                <span className="text-base mt-0.5">{action.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-sm tracking-wide" style={{ color: pathStyle.text }}>
                      {action.label}
                    </span>
                    {action.cost && (
                      <span className="font-mono-game text-xs" style={{ color: canAfford ? '#ffcc00' : '#ff2233' }}>
                        ${action.cost}
                      </span>
                    )}
                    {alreadyHas && (
                      <span className="font-mono-game text-xs" style={{ color: '#00ff88' }}>OWNED</span>
                    )}
                  </div>
                  <div className="font-mono-game text-xs mt-0.5" style={{ color: '#666' }}>
                    {action.description}
                  </div>
                  {/* Effect tags */}
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {action.heatChange && action.heatChange !== 0 && (
                      <span className="font-mono-game px-1 rounded" style={{
                        fontSize: 9,
                        background: action.heatChange > 0 ? 'rgba(255,34,51,0.1)' : 'rgba(0,255,136,0.1)',
                        color: action.heatChange > 0 ? '#ff2233' : '#00ff88',
                        border: `1px solid ${action.heatChange > 0 ? '#ff223333' : '#00ff8833'}`,
                      }}>
                        HEAT {action.heatChange > 0 ? '+' : ''}{action.heatChange}
                      </span>
                    )}
                    {action.precept && (
                      <span className="font-mono-game px-1 rounded" style={{
                        fontSize: 9,
                        background: 'rgba(204,51,255,0.1)',
                        color: '#cc33ff',
                        border: '1px solid #cc33ff33',
                      }}>
                        {(action.precept as string).toUpperCase()} +{action.preceptAmount}
                      </span>
                    )}
                    {action.healthChange && action.healthChange > 0 && (
                      <span className="font-mono-game px-1 rounded" style={{
                        fontSize: 9, background: 'rgba(0,255,136,0.1)', color: '#00ff88', border: '1px solid #00ff8833',
                      }}>HP +{action.healthChange === 999 ? 'MAX' : action.healthChange}</span>
                    )}
                    {action.scoreChange && action.scoreChange !== 0 && (
                      <span className="font-mono-game px-1 rounded" style={{
                        fontSize: 9,
                        background: action.scoreChange > 0 ? 'rgba(255,204,0,0.1)' : 'rgba(255,34,51,0.1)',
                        color: action.scoreChange > 0 ? '#ffcc00' : '#ff2233',
                        border: `1px solid ${action.scoreChange > 0 ? '#ffcc0033' : '#ff223333'}`,
                      }}>
                        SCORE {action.scoreChange > 0 ? '+' : ''}{action.scoreChange}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer hint */}
        <div className="px-4 pb-3 text-center">
          <span className="font-mono-game text-xs" style={{ color: '#333' }}>ESC or click outside to close</span>
        </div>
      </div>
    </div>
  );
}
