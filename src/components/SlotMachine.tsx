import { useState, useCallback, useRef, useEffect } from 'react';

const SYMBOLS = ['🍒', '🍋', '💎', '7️⃣', '🔔', '☠', '💰', '⭐'];
const PAYOUTS: Record<string, number> = {
  '7️⃣7️⃣7️⃣': 10,
  '💎💎💎': 7,
  '💰💰💰': 5,
  '⭐⭐⭐': 4,
  '🔔🔔🔔': 3,
  '🍒🍒🍒': 2,
  '☠☠☠': 0, // lose extra
};

interface Props {
  playerCash: number;
  onResult: (won: boolean, amount: number) => void;
  onClose: () => void;
}

export default function SlotMachine({ playerCash, onResult, onClose }: Props) {
  const [reels, setReels] = useState(['🍒', '💎', '7️⃣']);
  const [spinning, setSpinning] = useState(false);
  const [bet, setBet] = useState(100);
  const [isCustomBet, setIsCustomBet] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [reelPositions, setReelPositions] = useState([0, 0, 0]);
  const spinTimers = useRef<number[]>([]);

  const spin = useCallback(() => {
    if (spinning || playerCash < bet) return;
    setSpinning(true);
    setResult(null);
    onResult(false, bet); // Deduct bet immediately

    // Determine final symbols
    const finalReels = [0, 1, 2].map(() => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]);

    // Animate each reel stopping sequentially
    let animFrame = 0;
    const totalFrames = [20, 30, 40]; // Each reel spins longer

    const animateReels = () => {
      animFrame++;
      setReelPositions(prev => prev.map((p, i) => {
        if (animFrame < totalFrames[i]) return p + 1;
        return p;
      }));
      setReels(prev => prev.map((_, i) => {
        if (animFrame >= totalFrames[i]) return finalReels[i];
        return SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
      }));

      if (animFrame < totalFrames[2]) {
        spinTimers.current.push(window.setTimeout(animateReels, 60));
      } else {
        // Check result
        const key = finalReels.join('');
        const multiplier = PAYOUTS[key];
        const twoMatch = finalReels[0] === finalReels[1] || finalReels[1] === finalReels[2] || finalReels[0] === finalReels[2];

        if (multiplier !== undefined && multiplier > 0) {
          const winAmount = bet * multiplier;
          setResult(`🎉 JACKPOT! x${multiplier} = $${winAmount}`);
          onResult(true, winAmount);
        } else if (multiplier === 0) {
          setResult('☠ SKULL COMBO — EXTRA LOSS!');
          onResult(false, bet); // Extra loss
        } else if (twoMatch) {
          const winAmount = Math.floor(bet * 1.5);
          setResult(`✨ PARTIAL MATCH! $${winAmount}`);
          onResult(true, winAmount);
        } else {
          setResult('❌ NO MATCH');
        }
        setSpinning(false);
      }
    };
    animateReels();
  }, [spinning, bet, playerCash, onResult]);

  useEffect(() => {
    return () => { spinTimers.current.forEach(t => clearTimeout(t)); };
  }, []);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget && !spinning) onClose(); }}
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="relative w-full max-w-sm mx-4 animate-fade-in"
        style={{
          background: 'linear-gradient(135deg, hsl(340 20% 6% / 0.98), hsl(340 15% 10% / 0.98))',
          border: '1px solid #ff33aa55',
          borderTop: '2px solid #ff33aa',
          borderRadius: 8,
          boxShadow: '0 0 60px #ff33aa33, inset 0 1px 0 #ff33aa22',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid #ff33aa22' }}>
          <span className="font-display text-xl tracking-widest" style={{ color: '#ff33aa', textShadow: '0 0 15px #ff33aa66' }}>
            🎰 VOID SLOTS
          </span>
          <button onClick={onClose} disabled={spinning}
            className="font-display text-sm px-2 py-1 rounded"
            style={{ color: spinning ? '#333' : '#666', border: '1px solid #333' }}>
            ✕
          </button>
        </div>

        {/* Reels */}
        <div className="flex items-center justify-center gap-3 py-6 px-4">
          {reels.map((symbol, i) => (
            <div key={i}
              className="flex items-center justify-center rounded-lg transition-all"
              style={{
                width: 80, height: 90,
                background: 'hsl(0 0% 5%)',
                border: `2px solid ${spinning ? '#ff33aa' : '#333'}`,
                boxShadow: spinning ? '0 0 20px #ff33aa44' : 'none',
                fontSize: 42,
                transform: spinning && reelPositions[i] % 2 === 0 ? 'translateY(-2px)' : 'translateY(0)',
              }}
            >
              {symbol}
            </div>
          ))}
        </div>

        {/* Bet selection */}
        <div className="flex flex-wrap items-center justify-center gap-2 pb-3 px-2">
          <span className="font-display text-xs tracking-wider" style={{ color: '#ff33aa88' }}>BET</span>
          {[100, 300, 1000].map(b => (
            <button key={b} onClick={() => { if (!spinning) { setBet(b); setIsCustomBet(false); } }}
              className="font-mono-game text-xs px-2 py-1 rounded transition-all"
              style={{
                background: bet === b && !isCustomBet ? 'rgba(255,51,170,0.15)' : 'transparent',
                border: `1px solid ${bet === b && !isCustomBet ? '#ff33aa' : '#333'}`,
                color: bet === b && !isCustomBet ? '#ff33aa' : '#666',
              }}>
              ${b}
            </button>
          ))}
          <div className="flex items-center gap-1">
            <span className="font-mono-game text-xs" style={{ color: isCustomBet ? '#ff33aa' : '#666' }}>$</span>
            <input
              type="number"
              value={bet || ''}
              onChange={(e) => {
                if (spinning) return;
                const val = parseInt(e.target.value) || 0;
                setBet(val > 0 ? val : 0);
                setIsCustomBet(true);
              }}
              disabled={spinning}
              className="font-mono-game text-xs px-1 py-1 rounded transition-all bg-transparent focus:outline-none"
              style={{
                width: 50,
                border: `1px solid ${isCustomBet ? '#ff33aa' : '#333'}`,
                color: isCustomBet ? '#ff33aa' : '#666',
                borderBottom: `2px solid ${isCustomBet ? '#ff33aa' : '#333'}`,
              }}
            />
          </div>
        </div>

        {/* Cash display */}
        <div className="text-center pb-2">
          <span className="font-mono-game text-sm" style={{ color: '#ffcc00' }}>
            💰 ${playerCash}
          </span>
        </div>

        {/* Result */}
        {result && (
          <div className="text-center pb-3 animate-fade-in">
            <span className="font-display text-sm tracking-wider" style={{
              color: result.includes('JACKPOT') || result.includes('MATCH') ? '#ffcc00' : '#ff2233',
              textShadow: result.includes('JACKPOT') ? '0 0 15px #ffcc0066' : 'none',
            }}>
              {result}
            </span>
          </div>
        )}

        {/* Spin button */}
        <div className="px-5 pb-5">
          <button onClick={spin} disabled={spinning || playerCash < bet}
            className="w-full font-display text-lg tracking-widest py-3 rounded transition-all"
            style={{
              background: spinning ? '#222' : playerCash < bet ? '#1a0a10' : 'linear-gradient(135deg, #ff33aa22, #ff33aa11)',
              border: `2px solid ${spinning ? '#333' : playerCash < bet ? '#331122' : '#ff33aa'}`,
              color: spinning ? '#555' : playerCash < bet ? '#442233' : '#ff33aa',
              boxShadow: !spinning && playerCash >= bet ? '0 0 20px #ff33aa33' : 'none',
              cursor: spinning || playerCash < bet ? 'not-allowed' : 'pointer',
            }}>
            {spinning ? '⟳ SPINNING...' : playerCash < bet ? 'NOT ENOUGH CASH' : 'SPIN — $' + bet}
          </button>
        </div>

        {/* Payout table */}
        <div className="px-5 pb-4">
          <div className="font-display text-xs tracking-wider mb-1" style={{ color: '#555' }}>PAYOUTS</div>
          <div className="grid grid-cols-2 gap-1" style={{ fontSize: 9 }}>
            {Object.entries(PAYOUTS).filter(([, v]) => v > 0).map(([k, v]) => (
              <div key={k} className="font-mono-game flex justify-between" style={{ color: '#444' }}>
                <span>{k.match(/.{2}/g)?.join(' ')}</span>
                <span style={{ color: '#ff33aa88' }}>x{v}</span>
              </div>
            ))}
            <div className="font-mono-game flex justify-between" style={{ color: '#444' }}>
              <span>2 MATCH</span>
              <span style={{ color: '#ff33aa88' }}>x1.5</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
