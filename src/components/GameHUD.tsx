import { PrecedeKey, Contact, Mission, BarFightState } from '@/hooks/useGameEngine';

const PRECEPT_COLORS: Record<PrecedeKey, string> = {
  violence: '#ff2233', theft: '#ff9900', misconduct: '#cc33ff', deception: '#00ccff', intoxication: '#ff33aa',
};
const PRECEPT_ICONS: Record<PrecedeKey, string> = {
  violence: '⚔', theft: '💰', misconduct: '😈', deception: '🗣', intoxication: '☠',
};
const PRECEPT_LABELS: Record<PrecedeKey, string> = {
  violence: 'VIOLENCE', theft: 'THEFT', misconduct: 'MISCONDUCT', deception: 'DECEPTION', intoxication: 'INTOXICATION',
};

interface HUDProps {
  precepts: Record<PrecedeKey, number>;
  chaosLevel: number;
  heatLevel: number;
  rageMode: boolean;
  health: number;
  maxHealth: number;
  score: number;
  stealthMode: boolean;
  glitchIntensity: number;
  inventory: { cash: number; weapons: string[]; activeWeapon: string | null };
  bossHealth: number | null;
  bossMaxHealth: number | null;
  bossActive: boolean;
  nearBuilding: { name: string; type: string } | null;
  buildingWindowOpen: boolean;
  nearVehicle: string | null;
  contacts: Contact[];
  activeMission: Mission | null;
  barFight: BarFightState | null;
  hideTimer: number;
  playerVehicle: { type: string; speedKmh: number; health: number; maxHealth: number } | null;
}

const HEAT_LABELS = ['CLEAN', 'WANTED', 'PURSUIT', 'MANHUNT', 'CRISIS', 'CHAOS'];
const HEAT_COLORS = ['#00ff88', '#ffcc00', '#ff9900', '#ff5500', '#ff2233', '#ff33aa'];

export default function GameHUD({
  precepts, chaosLevel, heatLevel, rageMode, health, maxHealth, score, glitchIntensity,
  inventory, bossHealth, bossMaxHealth, bossActive, nearBuilding, buildingWindowOpen,
  nearVehicle, contacts, activeMission, barFight, hideTimer, playerVehicle,
}: HUDProps) {
  const healthPct = health / maxHealth;

  return (
    <>
      {/* Top-left: Chaos + Heat */}
      <div className="absolute top-3 left-3 z-20 flex flex-col gap-2 select-none origin-top-left transform scale-75 md:scale-100">
        {/* Score + Cash */}
        <div className="hud-panel px-3 py-1.5 rounded">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-display text-xs tracking-widest" style={{ color: '#ff9900' }}>SCORE</div>
              <div className="font-mono-game text-lg" style={{ color: '#ffcc00', textShadow: '0 0 10px rgba(255,204,0,0.7)' }}>
                {score.toString().padStart(8, '0')}
              </div>
            </div>
            <div className="text-right">
              <div className="font-display text-xs tracking-widest" style={{ color: '#00ff88' }}>CASH</div>
              <div className="font-mono-game text-sm" style={{ color: '#00ff88', textShadow: '0 0 8px rgba(0,255,136,0.5)' }}>
                ${inventory.cash}
              </div>
            </div>
          </div>
        </div>

        {/* Heat Level */}
        <div className="hud-panel px-3 py-2 rounded">
          <div className="font-display text-xs tracking-widest mb-1.5" style={{ color: '#ff9900' }}>HEAT LEVEL</div>
          <div className="flex items-center gap-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-sm transition-all duration-300"
                style={{
                  width: 20, height: 16,
                  background: i < heatLevel ? HEAT_COLORS[heatLevel] : 'rgba(255,255,255,0.05)',
                  boxShadow: i < heatLevel ? `0 0 8px ${HEAT_COLORS[heatLevel]}` : 'none',
                  border: `1px solid ${i < heatLevel ? HEAT_COLORS[heatLevel] : 'rgba(255,255,255,0.08)'}`,
                  animation: i < heatLevel && heatLevel >= 4 ? 'pulse-red 0.8s infinite' : 'none',
                }}
              />
            ))}
            <span className="font-display text-xs ml-1 tracking-wider" style={{ color: HEAT_COLORS[heatLevel] }}>
              {HEAT_LABELS[heatLevel]}
            </span>
          </div>
        </div>

        {/* Chaos Meter */}
        <div className="hud-panel px-3 py-2 rounded">
          <div className="flex justify-between items-baseline mb-1">
            <span className="font-display text-xs tracking-widest" style={{ color: '#ff2233' }}>CHAOS ENGINE</span>
            <span className="font-mono-game text-xs" style={{ color: '#ff2233' }}>{Math.round(chaosLevel)}%</span>
          </div>
          <div className="precept-bar w-40">
            <div className="precept-fill"
              style={{
                width: `${chaosLevel}%`,
                background: `linear-gradient(90deg, #ff2233, ${chaosLevel > 70 ? '#ff33aa' : '#ff6600'})`,
                boxShadow: `0 0 ${8 + chaosLevel * 0.2}px rgba(255,34,51,0.7)`,
              }}
            />
          </div>
        </div>

        {/* Weapon indicator */}
        {inventory.activeWeapon && (
          <div className="hud-panel px-3 py-1.5 rounded">
            <div className="font-display text-xs tracking-widest" style={{ color: '#ff9900' }}>⚔ WEAPON</div>
            <div className="font-mono-game text-sm" style={{ color: '#ff9900', textShadow: '0 0 8px rgba(255,153,0,0.5)' }}>
              {inventory.activeWeapon.toUpperCase()}
            </div>
          </div>
        )}

        {/* Hide meter */}
        {hideTimer > 10 && (
          <div className="hud-panel px-3 py-1.5 rounded animate-fade-in">
            <div className="font-display text-xs tracking-widest mb-1" style={{ color: '#00ff88' }}>🕶 HIDING</div>
            <div className="precept-bar" style={{ width: 100 }}>
              <div className="precept-fill" style={{
                width: `${Math.min(hideTimer / 120 * 100, 100)}%`,
                background: '#00ff88',
                boxShadow: '0 0 8px rgba(0,255,136,0.5)',
              }} />
            </div>
          </div>
        )}
      </div>

      {/* Top-right: Precepts (Positioned to the left of minimap on mobile) */}
      <div className="absolute z-20 flex flex-col gap-1.5 select-none top-[10px] md:top-[230px] right-[145px] md:right-[20px] w-[160px] md:w-[200px] origin-top-right transform scale-[0.65] md:scale-100">
        <div className="hud-panel px-3 py-2 rounded">
          <div className="font-display text-xs tracking-widest mb-2 text-center" style={{ color: '#cc33ff' }}>
            ☯ PANSIL BREAKER
          </div>
          {(Object.keys(precepts) as PrecedeKey[]).map(key => (
            <div key={key} className="mb-1.5">
              <div className="flex justify-between items-center mb-0.5">
                <span className="font-display text-xs tracking-wide flex items-center gap-1" style={{ color: PRECEPT_COLORS[key] }}>
                  <span style={{ fontSize: 11 }}>{PRECEPT_ICONS[key]}</span>
                  {PRECEPT_LABELS[key]}
                </span>
                <span className="font-mono-game text-xs" style={{ color: PRECEPT_COLORS[key], opacity: 0.8 }}>
                  {Math.round(precepts[key])}
                </span>
              </div>
              <div className="precept-bar" style={{ width: '100%' }}>
                <div className="precept-fill"
                  style={{
                    width: `${precepts[key]}%`,
                    background: PRECEPT_COLORS[key],
                    boxShadow: `0 0 6px ${PRECEPT_COLORS[key]}88`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Contacts roster */}
        {contacts.length > 0 && (
          <div className="hud-panel px-3 py-2 rounded" style={{ width: '100%' }}>
            <div className="font-display text-xs tracking-widest mb-1" style={{ color: '#cc33ff' }}>📱 CONTACTS ({contacts.length})</div>
            <div className="space-y-1 max-h-24 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: '#333 transparent' }}>
              {contacts.slice(0, 4).map(c => (
                <div key={c.id} className="flex items-center justify-between">
                  <span className="font-mono-game" style={{ fontSize: 9, color: '#cc33ff' }}>{c.name}</span>
                  <span className="font-mono-game" style={{ fontSize: 8, color: '#666' }}>{c.role}</span>
                </div>
              ))}
              {contacts.length > 4 && (
                <div className="font-mono-game text-center" style={{ fontSize: 8, color: '#444' }}>+{contacts.length - 4} more</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Mission tracker (below boss bar area) */}
      {activeMission && activeMission.status === 'active' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 select-none" style={{ marginTop: bossActive ? 80 : 30 }}>
          <div className="hud-panel px-4 py-2.5 rounded" style={{ borderColor: '#ff990044', minWidth: 260, maxWidth: 320 }}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-display text-xs tracking-widest" style={{ color: '#ff9900', textShadow: '0 0 8px #ff990044' }}>
                🗺 {activeMission.name}
              </span>
              {activeMission.timer !== undefined && (
                <span className="font-mono-game text-xs" style={{ color: activeMission.timer < 3600 ? '#ff2233' : '#666' }}>
                  {Math.floor(activeMission.timer / 3600)}:{String(Math.floor((activeMission.timer % 3600) / 60)).padStart(2, '0')}
                </span>
              )}
            </div>
            <div className="space-y-1">
              {activeMission.objectives.map(obj => (
                <div key={obj.id} className="flex items-center gap-1.5">
                  <span className="font-mono-game" style={{ fontSize: 9, color: obj.done ? '#00ff88' : '#666' }}>
                    {obj.done ? '✓' : '○'}
                  </span>
                  <span className="font-mono-game" style={{ fontSize: 9, color: obj.done ? '#00ff8888' : '#888', textDecoration: obj.done ? 'line-through' : 'none' }}>
                    {obj.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Boss Health Bar (top center) */}
      {bossActive && bossHealth !== null && bossMaxHealth !== null && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 select-none">
          <div className="hud-panel px-4 py-2.5 rounded" style={{ borderColor: '#ff004466', minWidth: 280 }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-display text-sm tracking-widest" style={{ color: '#ff0044', textShadow: '0 0 10px #ff004466' }}>
                ⚠ CHIEF ENFORCER
              </span>
              <span className="font-mono-game text-xs" style={{ color: '#ff3366' }}>
                {Math.round(bossHealth)}/{bossMaxHealth}
              </span>
            </div>
            <div className="precept-bar" style={{ width: '100%', height: 8 }}>
              <div className="precept-fill"
                style={{
                  width: `${(bossHealth / bossMaxHealth) * 100}%`,
                  background: bossHealth / bossMaxHealth > 0.5 ? 'linear-gradient(90deg, #ff0044, #ff3366)' : 'linear-gradient(90deg, #ff0044, #ffcc00)',
                  boxShadow: '0 0 12px rgba(255,0,68,0.7)',
                  height: 8,
                }}
              />
            </div>
            {bossHealth < bossMaxHealth * 0.5 && (
              <div className="font-mono-game text-xs mt-1 text-center animate-pulse" style={{ color: '#ff3366' }}>
                ⚡ PHASE 2 — ENRAGED ⚡
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bar fight HUD */}
      {barFight?.active && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 select-none">
          <div className="hud-panel px-4 py-2.5 rounded" style={{ borderColor: '#ff444466', minWidth: 240 }}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-display text-sm tracking-widest" style={{ color: '#ff4444', textShadow: '0 0 10px #ff444466' }}>
                👊 BAR FIGHT
              </span>
              <span className="font-mono-game text-xs" style={{ color: barFight.timer < 600 ? '#ff2233' : '#666' }}>
                {Math.ceil(barFight.timer / 60)}s
              </span>
            </div>
            <div className="font-mono-game text-xs" style={{ color: '#ff9900' }}>
              DEFEATED: {barFight.defeated}/{barFight.total}
            </div>
          </div>
        </div>
      )}

      {/* Bottom-left: Health */}
      <div className="absolute bottom-28 left-3 z-20 select-none md:bottom-3 origin-bottom-left transform scale-75 md:scale-100">
        <div className="hud-panel px-3 py-2 rounded">
          <div className="font-display text-xs tracking-widest mb-1" style={{ color: healthPct > 0.5 ? '#00ff88' : '#ff2233' }}>
            ♥ VITALITY
          </div>
          <div className="flex items-center gap-2">
            <div className="precept-bar" style={{ width: 100 }}>
              <div className="precept-fill transition-all duration-200"
                style={{
                  width: `${healthPct * 100}%`,
                  background: healthPct > 0.5 ? '#00ff88' : healthPct > 0.25 ? '#ffcc00' : '#ff2233',
                  boxShadow: `0 0 8px ${healthPct > 0.5 ? '#00ff88' : '#ff2233'}88`,
                }}
              />
            </div>
            <span className="font-mono-game text-xs" style={{ color: '#aaa' }}>
              {Math.round(health)}/{maxHealth}
            </span>
          </div>
        </div>
      </div>

      {/* Rage Mode Banner */}
      {rageMode && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none select-none" style={{ marginTop: -80 }}>
          <div className="font-display text-5xl tracking-widest text-center animate-pulse"
            style={{ color: '#ff33aa', textShadow: '0 0 20px #ff33aa, 0 0 50px #ff33aa, 0 0 100px rgba(255,51,170,0.5)', letterSpacing: '0.2em' }}>
            ★ RAGE MODE ★
          </div>
          <div className="font-mono-game text-center text-sm mt-1" style={{ color: 'rgba(255,51,170,0.7)' }}>
            ALL LIMITS BROKEN
          </div>
        </div>
      )}

      {/* Glitch overlay edges */}
      {glitchIntensity > 0.4 && (
        <div className="absolute inset-0 z-10 pointer-events-none"
          style={{ boxShadow: `inset 0 0 ${glitchIntensity * 60}px rgba(255,34,51,${glitchIntensity * 0.3})` }}
        />
      )}

      {/* Building proximity prompt */}
      {nearBuilding && !buildingWindowOpen && (
        <div className="absolute bottom-40 left-1/2 -translate-x-1/2 z-20 select-none md:bottom-16">
          <div className="hud-panel px-4 py-2 rounded animate-fade-in" style={{ borderColor: 'rgba(0,204,255,0.4)' }}>
            <div className="font-display text-sm tracking-widest text-center" style={{ color: '#00ccff' }}>
              [F] ENTER {nearBuilding.name}
            </div>
          </div>
        </div>
      )}

      {/* Vehicle proximity prompt */}
      {nearVehicle && !playerVehicle && (
        <div className="absolute bottom-40 left-1/2 -translate-x-1/2 z-20 select-none md:bottom-16">
          <div className="hud-panel px-4 py-2 rounded animate-fade-in" style={{ borderColor: 'rgba(0,255,136,0.4)' }}>
            <div className="font-display text-sm tracking-widest text-center" style={{ color: '#00ff88' }}>
              [F] ENTER {nearVehicle}
            </div>
          </div>
        </div>
      )}

      {/* Controls hint */}
      <div className="hidden md:block absolute bottom-3 right-3 z-20 select-none">
        <div className="hud-panel px-2.5 py-2 rounded">
          <div className="font-display text-xs tracking-widest mb-1" style={{ color: '#555' }}>CONTROLS</div>
          <div className="font-mono-game text-xs space-y-0.5" style={{ color: '#444', fontSize: 9 }}>
            <div><span style={{ color: '#666' }}>WASD</span> — MOVE</div>
            <div><span style={{ color: '#ff2233' }}>SPACE</span> — ATTACK</div>
            <div><span style={{ color: '#ff9900' }}>E</span> — STEAL / PICK UP</div>
            <div><span style={{ color: '#00ccff' }}>F</span> — INTERACT</div>
          </div>
        </div>
      </div>

      {/* Title watermark */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none select-none">
        <div className="font-display text-xl tracking-widest"
          style={{ color: 'rgba(255,34,51,0.25)', textShadow: '0 0 20px rgba(255,34,51,0.1)', letterSpacing: '0.3em' }}>
          PANSIL BREAKER 1
        </div>
      </div>

      {/* Vehicle HUD: Speedometer + Health */}
      {playerVehicle && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 select-none flex flex-col items-center gap-2 animate-fade-in">
          {/* Speedometer ring */}
          <div className="hud-panel px-4 py-3 rounded-lg flex items-center gap-4" style={{ minWidth: 220 }}>
            {/* SVG Dial */}
            <div style={{ position: 'relative', width: 72, height: 72, flexShrink: 0 }}>
              <svg width="72" height="72" viewBox="0 0 72 72">
                {/* Background ring */}
                <circle cx="36" cy="36" r="28" fill="none" stroke="rgba(0,204,255,0.1)" strokeWidth="6" />
                {/* Speed arc */}
                <circle
                  cx="36" cy="36" r="28"
                  fill="none"
                  stroke={playerVehicle.speedKmh > 120 ? '#ff2233' : playerVehicle.speedKmh > 80 ? '#ff9900' : '#00ccff'}
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={`${Math.min(1, playerVehicle.speedKmh / 180) * 176} 176`}
                  strokeDashoffset="44"
                  style={{ transition: 'stroke-dasharray 0.1s ease' }}
                />
              </svg>
              {/* Speed number */}
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <span className="font-mono-game" style={{ fontSize: 18, color: '#00ccff', lineHeight: 1 }}>
                  {playerVehicle.speedKmh}
                </span>
                <span className="font-display" style={{ fontSize: 7, color: '#556', letterSpacing: '0.15em' }}>KM/H</span>
              </div>
            </div>

            {/* Vehicle info column */}
            <div className="flex flex-col gap-1.5 flex-1">
              <div className="font-display text-xs tracking-widest" style={{ color: '#00ccff' }}>
                {playerVehicle.type === 'police_cruiser' ? '🚔 POLICE' : playerVehicle.type === 'motorcycle' ? '🏍 MOTO' : playerVehicle.type === 'truck' ? '🚛 TRUCK' : '🚗 CAR'}
              </div>
              {/* Vehicle health bar */}
              <div>
                <div className="font-display text-[9px] tracking-widest mb-0.5" style={{ color: '#446' }}>VEHICLE</div>
                <div style={{ height: 5, width: '100%', background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${(playerVehicle.health / playerVehicle.maxHealth) * 100}%`,
                    background: playerVehicle.health / playerVehicle.maxHealth > 0.5 ? '#00ff88' : playerVehicle.health / playerVehicle.maxHealth > 0.25 ? '#ffaa00' : '#ff2233',
                    transition: 'width 0.2s ease, background 0.3s',
                    borderRadius: 3,
                  }} />
                </div>
              </div>
              <div className="font-display text-[9px] tracking-widest" style={{ color: '#446' }}>
                PRESS F TO EXIT
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
