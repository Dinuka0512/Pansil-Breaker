interface Props {
  heatLevel: number;
  copRank: number;
  playerCash: number;
  onBribe: () => void;
  onJail: () => void;
  timer: number;
}

export default function ArrestOverlay({ heatLevel, copRank, playerCash, onBribe, onJail, timer }: Props) {
  const bribeCost = Math.floor(playerCash * 0.5);
  const canAfford = playerCash >= bribeCost; // Technically always true now
  const rankLabel = copRank === 3 ? 'CAPTAIN' : copRank === 2 ? 'SERGEANT' : 'OFFICER';
  const timerSec = Math.ceil(Math.max(0, timer) / 60);

  const heatTier = Math.max(1, heatLevel);
  const finePercentDisplay = Math.round(Math.min(1.0, 0.2 * heatTier) * 100);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.8)' }}>
      <div
        className="w-full max-w-md mx-4 animate-fade-in"
        style={{
          background: 'linear-gradient(135deg, hsl(220 20% 6% / 0.98), hsl(220 15% 10% / 0.98))',
          border: '1px solid #3377ff55',
          borderTop: '3px solid #3377ff',
          borderRadius: 8,
          boxShadow: '0 0 60px #3377ff33',
        }}
      >
        {/* Header */}
        <div className="px-5 pt-4 pb-3 text-center" style={{ borderBottom: '1px solid #3377ff22' }}>
          <div className="font-display text-3xl tracking-widest mb-1" style={{
            color: '#3377ff',
            textShadow: '0 0 20px #3377ff88',
          }}>
            🚔 BUSTED
          </div>
          <div className="font-mono-game text-xs" style={{ color: '#3377ff88' }}>
            {rankLabel} HAS YOU CORNERED
          </div>
          <div className="font-mono-game text-xs mt-1" style={{ color: '#ff223388' }}>
            DECIDE IN {timerSec}s...
          </div>
        </div>

        {/* Options */}
        <div className="px-5 py-4 space-y-3">
          {/* Bribe */}
          <button onClick={onBribe} disabled={!canAfford}
            className="w-full text-left px-4 py-3 rounded transition-all"
            style={{
              background: canAfford ? 'rgba(255,204,0,0.05)' : 'rgba(255,255,255,0.02)',
              border: `1px solid ${canAfford ? '#ffcc0066' : '#222'}`,
              opacity: canAfford ? 1 : 0.4,
              cursor: canAfford ? 'pointer' : 'not-allowed',
            }}
            onMouseEnter={e => { if (canAfford) e.currentTarget.style.background = 'rgba(255,204,0,0.1)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = canAfford ? 'rgba(255,204,0,0.05)' : 'rgba(255,255,255,0.02)'; }}
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">💰</span>
              <div>
                <div className="font-display text-sm tracking-wider" style={{ color: '#ffcc00' }}>BRIBE — ${bribeCost} (50%)</div>
                <div className="font-mono-game text-xs" style={{ color: '#666' }}>
                  Pay off the {rankLabel.toLowerCase()} to clear your heat. Keep your weapons.
                </div>
              </div>
            </div>
            {!canAfford && (
              <div className="font-mono-game text-xs mt-1" style={{ color: '#ff2233' }}>NOT ENOUGH CASH</div>
            )}
          </button>

          {/* Go to Jail */}
          <button onClick={onJail}
            className="w-full text-left px-4 py-3 rounded transition-all"
            style={{
              background: 'rgba(51,119,255,0.05)',
              border: '1px solid #3377ff44',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(51,119,255,0.1)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(51,119,255,0.05)'; }}
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">⛓</span>
              <div>
                <div className="font-display text-sm tracking-wider" style={{ color: '#3377ff' }}>SURRENDER</div>
                <div className="font-mono-game text-xs" style={{ color: '#666' }}>
                  Lose {finePercentDisplay}% cash, all weapons. Heat reduced.
                </div>
              </div>
            </div>
          </button>

        </div>

        <div className="px-5 pb-3 text-center">
          <span className="font-mono-game text-xs" style={{ color: '#333' }}>
            HEAT: {heatLevel} · CASH: ${playerCash}
          </span>
        </div>
      </div>
    </div>
  );
}
