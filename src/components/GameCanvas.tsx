import * as React from 'react';
import { useEffect, useRef, useMemo } from 'react';
import { Stage, Container, Sprite, Graphics, Text, useApp, useTick } from '@pixi/react';
import * as PIXI from 'pixi.js';
import { GameState, TILE_SIZE, TERRAIN_COLORS_HEX, GRID_COLS, GRID_ROWS, WORLD_W, WORLD_H, ZONE_ACCENT_HEX } from '@/hooks/useGameEngine';
import { GlowFilter } from '@pixi/filter-glow';
import {
  getTerrainTexture, getBuildingTexture, getPropTexture,
  getRoadTexId, TERRAIN_TEX, BUILDING_TEX, BUILDING_TYPE_TO_TEX, PROP_TEX,
  type TerrainTexId, type PropTexId
} from '@/lib/textureAtlas';
import { INTERIOR_TILE_SIZE } from '@/data/interiors';

// ─── Performance Constants ────────────────────────────────────────────────────
const IS_MOBILE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
const RENDER_RESOLUTION = IS_MOBILE ? Math.min(window.devicePixelRatio, 1.2) : window.devicePixelRatio;
const USE_GLOW = !IS_MOBILE; // GlowFilter is expensive on mobile GPU

// Defensive Monkey Patch for unmounted sprite race conditions in React 18
const _originalCalculateVertices = PIXI.Sprite.prototype.calculateVertices;
PIXI.Sprite.prototype.calculateVertices = function () {
  if (!this.texture || !this.texture._uvs) {
    this.texture = PIXI.Texture.EMPTY; // Fallback to avoid crashing the ticker
  }
  return _originalCalculateVertices.call(this);
};

// Expose PIXI renderer/stage to devtools extension
function PixiDevTools() {
  const app = useApp();
  useEffect(() => {
    if (app) {
      (globalThis as any).__PIXI_APP__ = app;
      (globalThis as any).__PIXI_STAGE__ = app.stage;
      (globalThis as any).__PIXI_RENDERER__ = app.renderer;
    }
  }, [app]);
  return null;
}

// Apply filters to Container
function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

interface Props {
  canvasRef: React.RefObject<HTMLCanvasElement>; // Kept for interface compatibility, though Pixi manages its own canvas inside Stage
  stateRef: React.RefObject<GameState>;
  renderTick: number;
  WORLD_W: number;
  WORLD_H: number;
  toggleMap: () => void;
  onExitGame: () => void;
  /** Called when the minimap is tapped on mobile — used to open the Pause/Map overlay */
  onPause?: () => void;
}

export default function GameCanvas({ stateRef, renderTick, WORLD_W, WORLD_H, toggleMap, onExitGame, onPause }: Props) {
  // We use standard React state for window dimensions to keep Stage sized correctly
  const [dimensions, setDimensions] = React.useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    const handleResize = () => setDimensions({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const s = stateRef.current;
  if (!s) return null;

  const W = dimensions.width;
  const H = dimensions.height;
  const camX = s.cameraX;
  const camY = s.cameraY;

  // Shake offset
  const shake = s.screenShake;
  const shakeX = shake > 0 ? (Math.random() - 0.5) * shake : 0;
  const shakeY = shake > 0 ? (Math.random() - 0.5) * shake : 0;

  // Center container translation
  const tx = (W / 2) - camX + shakeX;
  const ty = (H / 2) - camY + shakeY;

  const parseColor = (c: string) => {
    if (!c || c === 'transparent') return { hex: 0xffaa50, alpha: 0.1 };
    try {
      const color = new PIXI.Color(c);
      return { hex: color.toNumber(), alpha: color.alpha };
    } catch {
      return { hex: 0xffffff, alpha: 1 };
    }
  };

  const drawBackground = (g: PIXI.Graphics) => {
    g.clear();
    // Base color - much deeper pure purple
    g.beginFill(s.rageMode ? 0x1a0026 : 0x070709);
    g.drawRect(camX - W / 2, camY - H / 2, W, H);
    g.endFill();

    const p = s.player;
    // Rage Mode Ripples
    if (s.rageMode && p) {
      const numRipples = 4;
      for (let i = 0; i < numRipples; i++) {
        const offset = (s.gameTime * 0.05 + i * (100 / numRipples)) % 100;
        const pct = offset / 100;
        const radius = pct * Math.max(W, H) * 1.5;
        const alpha = Math.max(0, 1 - pct) * 0.15;
        g.lineStyle(8, 0xff33aa, alpha);
        g.drawCircle(p.x, p.y, radius);
      }
      g.lineStyle(0); // Reset
    }

    // Grid (simplified for Pixi via lines)
    // Only draw grid if not mobile or if explicitly needed, and use a simpler drawing method
    const gridSize = 80;
    const startX = Math.floor((camX - W / 2) / gridSize) * gridSize;
    const startY = Math.floor((camY - H / 2) / gridSize) * gridSize;
    const gridColor = s.rageMode ? 0x880055 : 0xff2233;
    const gridAlpha = s.rageMode ? 0.03 : 0.04;
    
    if (!IS_MOBILE || s.rageMode) {
      g.lineStyle(1, gridColor, gridAlpha);
      for (let gx = startX; gx < startX + W + gridSize; gx += gridSize) {
        g.moveTo(gx, startY); g.lineTo(gx, startY + H + gridSize);
      }
      for (let gy = startY; gy < startY + H + gridSize; gy += gridSize) {
        g.moveTo(startX, gy); g.lineTo(startX + W + gridSize, gy);
      }
    }

    // ── World Borders ─────────────────────────────────────────────────────────
    // Outer void zone: dark zone past the border
    const voidThick = 600;
    g.beginFill(0x000000, 0.85);
    g.drawRect(-voidThick, -voidThick, WORLD_W + voidThick * 2, voidThick);          // top
    g.drawRect(-voidThick, WORLD_H, WORLD_W + voidThick * 2, voidThick);              // bottom
    g.drawRect(-voidThick, 0, voidThick, WORLD_H);                                    // left
    g.drawRect(WORLD_W, 0, voidThick, WORLD_H);                                       // right
    g.endFill();

    // Danger glow wall layers
    const borderWidth = 80;
    const wallAlpha = 0.18 + 0.06 * Math.sin(s.gameTime * 0.05); // subtle pulse
    // Outer thick danger line
    g.lineStyle(borderWidth, 0xff2233, wallAlpha);
    g.drawRect(borderWidth / 2, borderWidth / 2, WORLD_W - borderWidth, WORLD_H - borderWidth);
    // Inner bright edge
    g.lineStyle(4, 0xff4400, 0.9);
    g.drawRect(0, 0, WORLD_W, WORLD_H);
    // Innermost orange glow
    g.lineStyle(2, 0xffaa00, 0.4);
    g.drawRect(6, 6, WORLD_W - 12, WORLD_H - 12);
    g.lineStyle(0);

    // "OUT OF BOUNDS" label markers at each edge wall (only when player is near)
    const p2 = s.player;
    const nearEdgeDist = WORLD_W * 0.05; // 5% of world = ~240px at 4800
    const showBorderWarning =
      p2.x < nearEdgeDist || p2.x > WORLD_W - nearEdgeDist ||
      p2.y < nearEdgeDist || p2.y > WORLD_H - nearEdgeDist;

    if (showBorderWarning) {
      // Flashing red near-border zone overlay
      const flashAlpha = 0.07 + 0.05 * Math.sin(s.gameTime * 0.25);
      g.beginFill(0xff0000, flashAlpha);
      // Left danger strip
      if (p2.x < nearEdgeDist) g.drawRect(0, 0, Math.min(nearEdgeDist - p2.x, nearEdgeDist), WORLD_H);
      // Right danger strip
      if (p2.x > WORLD_W - nearEdgeDist) g.drawRect(WORLD_W - nearEdgeDist, 0, nearEdgeDist, WORLD_H);
      // Top danger strip
      if (p2.y < nearEdgeDist) g.drawRect(0, 0, WORLD_W, Math.min(nearEdgeDist - p2.y, nearEdgeDist));
      // Bottom danger strip
      if (p2.y > WORLD_H - nearEdgeDist) g.drawRect(0, WORLD_H - nearEdgeDist, WORLD_W, nearEdgeDist);
      g.endFill();
    }
  };


  const p = s.player;

  return (
    <Stage
      width={W}
      height={H}
      options={{ backgroundColor: 0x070709, resolution: RENDER_RESOLUTION, antialias: !IS_MOBILE }}
      className="absolute inset-0 w-full h-full pointer-events-none"
    >
      <PixiDevTools />
      <Container
        position={[tx, ty]}
      >
        {s.activeInterior ? (
          <>
            <InteriorLayer s={s} />
            <PlayerGraphic p={s.player} s={s} parseColor={parseColor} />
            {s.floatingTexts.map(ft => (
              <FloatingTextGraphic key={ft.id} ft={ft} />
            ))}
          </>
        ) : (
          <>
            {/* Global monolithic drawings for static or basic elements */}
            <Graphics draw={drawBackground} />

            {/* Terrain tiles (world-space, baked texture — no per-frame cost) */}
            <TerrainLayer s={s} />

            {/* Dynamic Entities Mapping */}
            {/* Render the Player explicitely */}
            {(() => {
              return <PlayerGraphic key={p.id} p={p} s={s} parseColor={parseColor} />;
            })()}

            {/* Remote Players */}
            {s.remotePlayers && Object.values(s.remotePlayers).map((rp: any) => {
              if (rp.dead) return null;

              // Format as required by PlayerGraphic
              const remoteP = {
                ...rp,
                width: 22,
                height: 22,
                maxHealth: 150,
                color: '#00ccff',
                glowColor: '#00ccff'
              };
              return <PlayerGraphic key={rp.id} p={remoteP} s={s} parseColor={parseColor} />;
            })}

            {s.entities.map(e => {
              // Culling check natively in array map - account for width/height to prevent pop-out for large buildings
              const ew = e.width || 40;
              const eh = e.height || 40;
              const buffer = 150; // Increased buffer for safety
              if (e.x + ew < camX - W / 2 - buffer || e.x > camX + W / 2 + buffer) return null;
              if (e.y + eh < camY - H / 2 - buffer || e.y > camY + H / 2 + buffer) return null;

              if (e.type === 'building') {
                return <BuildingGraphic key={e.id} e={e} s={s} parseColor={parseColor} />;
              }

              if (e.type === 'cop' || e.type === 'npc') {
                const distToPlayer = Math.hypot(e.x - p.x, e.y - p.y);
                return <ActorGraphic key={e.id} e={e} distToPlayer={distToPlayer} parseColor={parseColor} />;
              }

              if (e.type === 'item') {
                return <ItemGraphic key={e.id} e={e} gameTime={s.gameTime} />;
              }

              // Fallback
              const fallbackDraw = (g: PIXI.Graphics) => {
                g.clear();
                const c = parseColor(e.color);
                g.beginFill(c.hex, c.alpha);
                g.drawCircle(0, 0, e.width);
                g.endFill();
              };
              return (
                <Container key={e.id} x={e.x} y={e.y}>
                  <Graphics draw={fallbackDraw} />
                </Container>
              );
            })}

            {/* Floating Texts */}
            {s.floatingTexts.map(ft => (
              (Math.abs(ft.x - camX) < W / 2 + 100 && Math.abs(ft.y - camY) < H / 2 + 100)
                ? <FloatingTextGraphic key={ft.id} ft={ft} />
                : null
            ))}

            {/* Vehicles */}
            {s.vehicles && s.vehicles.map(v => (
              <VehicleGraphic key={v.id} v={v} />
            ))}
          </>
        )}
      </Container>

      {/* Static HUD/Map Layer (ignores camera translation) */}
      <MapOverlay s={s} W={W} H={H} WORLD_W={WORLD_W} WORLD_H={WORLD_H} toggleMap={toggleMap} onExitGame={onExitGame} onPause={onPause} />
    </Stage>
  );
}

// Helpers for the components
const BuildingGraphic = React.memo(({ e, s, parseColor }: { e: any, s: GameState, parseColor: any }) => {
  const parsed = parseColor(e.color);

  // ── Rooftop texture from atlas ────────────────────────────────────────────
  const app = useApp();
  const rooftopTexture = useMemo(() => {
    try {
      const texId = e.buildingType
        ? (BUILDING_TYPE_TO_TEX[e.buildingType] ?? BUILDING_TEX.TECH_STORE)
        : BUILDING_TEX.WAREHOUSE;
      return getBuildingTexture(app.renderer as PIXI.Renderer, texId);
    } catch { return null; }
  }, [e.buildingType, app.renderer]);

  // Neon Glow Filter for entire building Container (if it has glow)
  const filters = useMemo(() => {
    if (!USE_GLOW || !e.glowColor || e.glowColor === 'transparent') return [];
    try {
      const color = new PIXI.Color(e.glowColor);
      const glow = new GlowFilter({ distance: 15, outerStrength: 1.5, innerStrength: 0, color: color.toNumber(), quality: 0.1 });
      glow.padding = 20; 
      return [glow];
    } catch { return []; }
  }, [e.glowColor]);

  const drawBody = React.useCallback((g: PIXI.Graphics) => {
    g.clear();
    // Fill
    g.beginFill(parsed.hex, parsed.alpha);
    g.drawRect(0, 0, e.width, e.height);
    g.endFill();

    // Highlights
    g.beginFill(0xffffff, 0.04);
    g.drawRect(0, 0, e.width, 3);
    g.drawRect(0, 0, 3, e.height);
    g.endFill();

    // Pulse stroke
    if (e.glowColor && e.glowColor !== 'transparent') {
      const glowParsed = parseColor(e.glowColor);
      g.lineStyle(1.5, glowParsed.hex, 0.3 + Math.sin(s.gameTime * 0.05 + e.x) * 0.1);
      g.drawRect(0, 0, e.width, e.height);
      g.lineStyle(0);
    }

    // Windows
    const winCols = Math.floor(e.width / 18);
    const winRows = Math.floor(e.height / 18);
    for (let wr = 0; wr < winRows; wr++) {
      for (let wc = 0; wc < winCols; wc++) {
        const seeded = Math.abs(Math.sin(e.x * 12.9898 + e.y * 78.233 + wc * 7 + wr * 13)) * 100;
        if (seeded < 40) { // 40% chance
          const isRed = seeded < 10;
          g.beginFill(isRed ? 0xff2233 : 0xffc850, isRed ? 0.4 : 0.12);
          g.drawRect(4 + wc * 18, 6 + wr * 18, 8, 8);
        }
      }
    }
    g.endFill();

    // Interaction pulse
    if (e.buildingType && s.nearBuilding?.entity.id === e.id && !s.buildingWindowOpen) {
      const glowParsed = parseColor(e.glowColor || '#00ccff');
      g.lineStyle(2, glowParsed.hex, 0.15 + Math.sin(s.gameTime * 0.08) * 0.1);
      // Faint pulsing bounding box instead of dashed
      g.drawRect(-4, -4, e.width + 8, e.height + 8);
      g.lineStyle(0);
    }
  }, [e, parsed, s.gameTime, s.nearBuilding, s.buildingWindowOpen, parseColor]);

  // Label text styling
  const labelStyle = useMemo(() => {
    if (!e.label) return null;
    return new PIXI.TextStyle({
      fill: e.glowColor || '#ff2233',
      fontFamily: '"Bebas Neue", sans-serif',
      fontWeight: 'bold',
      fontSize: Math.min(e.width / e.label.length * 1.5, 16),
      dropShadow: true,
      dropShadowColor: e.glowColor || '#ff2233',
      dropShadowBlur: 8,
      dropShadowDistance: 0
    });
  }, [e.label, e.glowColor, e.width]);

  // Interaction text styling
  const interactStyle = useMemo(() => {
    return new PIXI.TextStyle({
      fill: e.glowColor || '#00ccff',
      fontFamily: '"Rajdhani", sans-serif',
      fontWeight: 'bold',
      fontSize: 12,
      dropShadow: true,
      dropShadowColor: e.glowColor || '#00ccff',
      dropShadowBlur: 10,
      dropShadowDistance: 0
    });
  }, [e.glowColor]);

  // We conditionally spread the filters array to avoid warnings for empty arrays
  return (
    <Container position={[e.x, e.y]} {...(filters.length > 0 ? { filters } : {})}>
      {/* Rooftop texture base layer */}
      {rooftopTexture && (
        <Sprite
          texture={rooftopTexture}
          width={e.width}
          height={e.height}
          alpha={0.72}
        />
      )}
      <Graphics draw={drawBody} />

      {e.label && labelStyle && (
        <Text
          text={e.label}
          x={e.width / 2}
          y={e.height / 2}
          anchor={0.5}
          style={labelStyle}
          alpha={0.8 + Math.sin(s.gameTime * 0.03) * 0.1}
        />
      )}

      {e.buildingType && s.nearBuilding?.entity.id === e.id && !s.buildingWindowOpen && (
        <Text
          text={`[F] ENTER ${e.label || ''}`}
          x={e.width / 2}
          y={-12}
          anchor={0.5}
          style={interactStyle}
          alpha={0.7 + Math.sin(s.gameTime * 0.1) * 0.3}
        />
      )}
    </Container>
  );
});

const PlayerGraphic = ({ p, s, parseColor }: { p: any, s: GameState, parseColor: any }) => {
  const isLocal = p.id === s.player.id;
  const chaos = isLocal ? s.chaosLevel : (p.chaosLevel || 0);
  const rage = isLocal ? s.rageMode : (p.rageMode || false);
  const inVehicle = !!p.occupyingVehicleId;

  const filters = useMemo(() => {
    if (!USE_GLOW || chaos <= 0 || inVehicle) return []; 
    try {
      const intensity = chaos / 100;
      if (intensity <= 0) return [];

      const glowColor = rage ? 0xff33aa : 0xff2233;
      const glow = new GlowFilter({
        distance: (10 + Math.floor(25 * intensity)) / 5,
        outerStrength: (1 + (3 * intensity)) / 5,
        innerStrength: 0,
        color: glowColor,
        quality: 0.1
      });
      glow.padding = 15;
      return [glow];
    } catch { return []; }
  }, [chaos, rage, inVehicle]);

  const drawFn = React.useCallback((g: PIXI.Graphics) => {
    g.clear();
    const rageMode = isLocal ? s.rageMode : (p.rageMode || false);
    const pw = p.width * 0.75;
    const ph = p.height * 0.9;

    g.beginFill(rageMode ? 0xff33aa : 0xff2233);
    g.drawRect(-pw / 2, -ph / 2, pw, ph);
    g.endFill();

    g.beginFill(rageMode ? 0xff88cc : 0xffddcc);
    g.drawCircle(ph * 0.35, 0, pw * 0.42);
    g.endFill();

    g.beginFill(rageMode ? 0xffffff : 0xff0000);
    g.drawCircle(ph * 0.44, 0, pw * 0.15);
    g.endFill();
  }, [p.width, p.height, isLocal, s.rageMode, p.rageMode]);

  // HP Draw
  const hpDraw = React.useCallback((g: PIXI.Graphics) => {
    g.clear();
    if (inVehicle) return; // Hide HP bar if in vehicle
    const phPct = Math.max(0, p.health / p.maxHealth);
    const phW = 50;
    const phX = -phW / 2;
    const phY = -p.height / 2 - 14;
    g.beginFill(0x000000, 0.7);
    g.drawRect(phX, phY, phW, 4);
    g.endFill();
    const color = phPct > 0.5 ? 0x00ff88 : phPct > 0.25 ? 0xffcc00 : 0xff2233;
    g.beginFill(color);
    g.drawRect(phX, phY, phW * phPct, 4);
    g.endFill();
  }, [p.health, p.maxHealth, p.height, inVehicle]);

  return (
    <Container x={p.x} y={p.y} filters={filters} scale={inVehicle ? 0.35 : 1} zIndex={inVehicle ? 15 : 10}>
      <Container rotation={p.facing} alpha={s.stealthMode ? 0.5 : 1}>
        <Graphics draw={drawFn} />
      </Container>
      <Graphics draw={hpDraw} />
    </Container>
  );
};



const InteriorLayer = React.memo(({ s }: { s: GameState }) => {
  const layout = s.activeInterior;
  if (!layout) return null;
  const app = useApp();
  const renderer = app.renderer as PIXI.Renderer;

  const parseColor = (c?: string) => {
    if (!c || c === 'transparent') return { hex: 0xffffff, alpha: 1 };
    try {
      const color = new PIXI.Color(c);
      return { hex: color.toNumber(), alpha: color.alpha };
    } catch {
      return { hex: 0xffffff, alpha: 1 };
    }
  };

  const bgDraw = React.useCallback((g: PIXI.Graphics) => {
    g.clear();
    g.beginFill(0x000000); // Deep black void outside the rooms
    g.drawRect(-2000, -2000, 4000 + layout.width * INTERIOR_TILE_SIZE, 4000 + layout.height * INTERIOR_TILE_SIZE);
    g.endFill();
  }, [layout.width, layout.height]);

  const p = s.player;
  const tx = Math.floor(p.x / INTERIOR_TILE_SIZE);
  const ty = Math.floor(p.y / INTERIOR_TILE_SIZE);
  const onExit = layout.tiles[ty]?.[tx] === 'exit';

  const exitPromptStyle = useMemo(() => new PIXI.TextStyle({
    fill: '#ffcc00',
    fontFamily: '"Rajdhani", sans-serif',
    fontSize: 14,
    fontWeight: 'bold',
    dropShadow: true,
    dropShadowColor: '#ff2233',
    dropShadowBlur: 10,
    dropShadowDistance: 0
  }), []);

  return (
    <Container>
      <Graphics draw={bgDraw} />
      {layout.tiles.map((row, y) => (
        row.map((tile, x) => {
          let texId: TerrainTexId = TERRAIN_TEX.INT_FLOOR;
          if (tile === 'wall') texId = TERRAIN_TEX.INT_WALL;
          else if (tile === 'exit') texId = TERRAIN_TEX.INT_EXIT;
          else if (tile === 'jail_bars') texId = TERRAIN_TEX.INT_JAIL_BARS;
          
          return (
            <Sprite
              key={`tile-${x}-${y}`}
              texture={getTerrainTexture(renderer, texId)}
              x={x * INTERIOR_TILE_SIZE}
              y={y * INTERIOR_TILE_SIZE}
              width={INTERIOR_TILE_SIZE}
              height={INTERIOR_TILE_SIZE}
            />
          );
        })
      ))}

      {layout.furniture.map((f, i) => {
        let texId: PropTexId = PROP_TEX.FURN_CHAIR;
        if (f.type === 'desk') texId = PROP_TEX.FURN_DESK;
        else if (f.type === 'chair') texId = PROP_TEX.FURN_CHAIR;
        else if (f.type === 'bed') texId = PROP_TEX.FURN_BED;
        else if (f.type === 'bar_counter') texId = PROP_TEX.FURN_BAR;
        else if (f.type === 'shelf') texId = PROP_TEX.FURN_SHELF;
        else if (f.type === 'table') texId = PROP_TEX.FURN_TABLE;
        else if (f.type === 'jail_bed') texId = PROP_TEX.FURN_JAIL_BED;
        else if (f.type === 'computer') texId = PROP_TEX.FURN_COMPUTER;
        
        return (
          <Sprite
            key={`furn-${i}`}
            texture={getPropTexture(renderer, texId)}
            x={f.x * INTERIOR_TILE_SIZE}
            y={f.y * INTERIOR_TILE_SIZE}
            width={f.width * INTERIOR_TILE_SIZE}
            height={f.height * INTERIOR_TILE_SIZE}
          />
        );
      })}

      {layout.npcs.map((n) => {
        const nx = n.x * INTERIOR_TILE_SIZE;
        const ny = n.y * INTERIOR_TILE_SIZE;
        const distToPlayer = Math.hypot(nx - p.x, ny - p.y);
        
        // Map to Entity structure for ActorGraphic
        const e = {
          id: n.id,
          x: nx,
          y: ny,
          width: 32,
          height: 32,
          type: n.type,
          color: n.color || (n.type === 'cop' ? '#1144cc' : '#ffffff'),
          name: n.name,
          facing: n.facing,
          aiState: 'idle'
        };
        
        return (
          <Container key={n.id} x={nx} y={ny}>
            <ActorGraphic e={e} distToPlayer={distToPlayer} parseColor={parseColor} />
          </Container>
        );
      })}

      {onExit && (
        <Text
          text="[F] EXIT BUILDING"
          x={p.x}
          y={p.y - 30}
          anchor={0.5}
          style={exitPromptStyle}
          alpha={0.7 + Math.sin(s.gameTime * 0.1) * 0.3}
        />
      )}
    </Container>
  );
});

const ActorGraphic = ({ e, distToPlayer, parseColor }: { e: any, distToPlayer: number, parseColor: any }) => {
  const isCop = e.type === 'cop';
  const isDead = e.aiState === 'dead';

  const showPrompt = distToPlayer < 90 && (e.type === 'npc' || isCop) && !isDead && e.subtype !== 'brawler';

  const promptStyle = useMemo(() => new PIXI.TextStyle({
    fontFamily: '"Rajdhani", sans-serif',
    fontSize: 12,
    fontWeight: 'bold',
    fill: '#00ccff',
    align: 'center'
  }), []);

  const nameColor = e.glowColor || e.color || '#00ccff';
  const nameStyle = useMemo(() => new PIXI.TextStyle({
    fontFamily: '"Share Tech Mono", monospace',
    fontSize: 14,
    fontWeight: 'bold',
    fill: nameColor,
    align: 'center',
    dropShadow: true,
    dropShadowColor: isCop ? '#3377ff' : nameColor,
    dropShadowBlur: 6,
    dropShadowDistance: 0
  }), [isCop, nameColor]);

  const drawCone = React.useCallback((g: PIXI.Graphics) => {
    g.clear();
    if (!isCop || isDead || !e.fovRange || !e.fovAngle) return;

    // Determine color based on whether cop is chasing/searching or patrolling
    const isAlert = e.aiState === 'chase' || e.aiState === 'search';
    const color = isAlert ? 0xff2233 : 0x3377ff;
    const alpha = isAlert ? 0.15 : 0.08;

    g.beginFill(color, alpha);
    g.moveTo(0, 0);
    g.arc(0, 0, e.fovRange, -e.fovAngle, e.fovAngle);
    g.lineTo(0, 0);
    g.endFill();

    // Outline
    g.lineStyle(1, color, alpha * 2.5);
    g.moveTo(0, 0);
    g.arc(0, 0, e.fovRange, -e.fovAngle, e.fovAngle);
    g.lineTo(0, 0);
  }, [e.fovRange, e.fovAngle, e.aiState, isCop, isDead]);

  const drawBody = React.useCallback((g: PIXI.Graphics) => {
    g.clear();
    if (isDead) {
      g.beginFill(0x550000, 0.35);
      // Draw flattened ellipse
      g.drawEllipse(0, e.height / 4, e.width * 0.9, e.height * 0.5);
      g.endFill();
      return;
    }

    const bw = e.width * 0.7;
    const bh = e.height * 0.85;
    const parsed = parseColor(isCop ? '#1144cc' : e.color);

    g.beginFill(parsed.hex, parsed.alpha);
    g.drawRect(-bw / 2, -bh / 2, bw, bh);
    g.endFill();

    g.beginFill(isCop ? 0x2255dd : 0xdfb88f);
    g.drawCircle(bh * 0.35, 0, bw * 0.38);
    g.endFill();

    g.beginFill(isCop ? 0x00ffff : 0xff2233);
    g.drawCircle(bh * 0.42, 0, bw * 0.12);
    g.endFill();
  }, [e.width, e.height, e.color, isCop, isDead]);

  const hpDraw = React.useCallback((g: PIXI.Graphics) => {
    g.clear();
    if (isDead || e.health >= e.maxHealth) return;
    const barW = e.width * 1.2;
    const barH = 3;
    const barX = -barW / 2;
    const barY = -e.height / 2 - 10;
    g.beginFill(0x000000, 0.6);
    g.drawRect(barX, barY, barW, barH);
    g.endFill();
    const pct = Math.max(0, e.health / e.maxHealth);
    const color = pct > 0.5 ? 0x00ff88 : pct > 0.25 ? 0xffcc00 : 0xff2233;
    g.beginFill(color);
    g.drawRect(barX, barY, barW * pct, barH);
    g.endFill();
  }, [e.health, e.maxHealth, e.width, e.height, isDead]);

  return (
    <Container x={e.x} y={e.y}>
      <Container rotation={isDead ? 0 : e.facing}>
        <Graphics draw={drawCone} />
        <Graphics draw={drawBody} />
      </Container>
      <Graphics draw={hpDraw} />
      {showPrompt && (
        <>
          <Text text="[F] TALK  [E] STEAL" y={-e.height / 2 - 14} anchor={[0.5, 1]} style={promptStyle} />
          <Text text={e.name || ''} y={-e.height / 2 - 3} anchor={[0.5, 1]} style={nameStyle} />
        </>
      )}
    </Container>
  );
};

const ItemGraphic = React.memo(({ e, gameTime }: { e: any, gameTime: number }) => {
  const isSub = e.subtype === 'substance';
  const isWep = e.subtype === 'weapon';
  const icon = isSub ? '☠' : isWep ? '⚔' : '$';
  const color = isSub ? '#ff33aa' : isWep ? '#ff4444' : '#ffcc00';
  const shadowColor = isSub ? '#ff33aa' : isWep ? '#ff2233' : '#ffcc00';

  // We construct the style dynamically exactly once based on subtype
  const style = useMemo(() => new PIXI.TextStyle({
    fill: color,
    fontSize: 24, // Baseline high-res for crisp scaling
    dropShadow: true,
    dropShadowColor: shadowColor,
    dropShadowBlur: 16,
    dropShadowDistance: 0
  }), [color, shadowColor]);

  const pulse = Math.sin(gameTime * 0.1 + e.x);
  const yOffset = Math.sin(gameTime * 0.06 + e.x) * 3;
  const alpha = 0.8 + Math.sin(gameTime * 0.08) * 0.15;
  const scale = 0.5 + pulse * 0.05;

  return (
    <Text
      text={icon}
      x={e.x}
      y={e.y + yOffset}
      anchor={0.5}
      style={style}
      alpha={alpha}
      scale={scale}
    />
  );
});

const FloatingTextGraphic = React.memo(({ ft }: { ft: any }) => {
  const style = useMemo(() => new PIXI.TextStyle({
    fill: ft.color,
    fontFamily: 'sans-serif',
    fontSize: 16,
    fontWeight: 'bold',
    dropShadow: true,
    dropShadowColor: '#000000',
    dropShadowBlur: 4,
    dropShadowDistance: 0
  }), [ft.color]);

  const alpha = ft.life / ft.maxLife;

  return <Text text={ft.text} x={ft.x} y={ft.y} anchor={0.5} style={style} alpha={alpha} />;
});

// ── TerrainLayer — baked RenderTexture (zero per-frame cost) ─────────────────
// Bakes terrain + textured road tiles into a single PIXI.RenderTexture once
// per world seed using the runtime texture atlas from textureAtlas.ts.
const TERRAIN_SCALE = 4; // Render at 1/4 scale → 200px TILE_SIZE → 50px in texture

// Fallback colours for terrain types (used when atlas not yet ready)
const TERRAIN_FALLBACK: Record<number, number> = {
  0: 0x111115, 1: 0x141420, 2: 0x0d1a0d, 3: 0x2a2218, 4: 0x1a140a, 5: 0x0a141e,
};

function TerrainLayerInner({
  terrainGrid, zoneGrid, worldSeed,
}: { terrainGrid: Uint8Array; zoneGrid: Uint8Array | null; worldSeed: number }) {
  const app = useApp();
  const [texture, setTexture] = React.useState<PIXI.Texture | null>(null);
  const lastSeed = useRef(-1);

  useEffect(() => {
    if (!terrainGrid || lastSeed.current === worldSeed) return;
    lastSeed.current = worldSeed;

    const renderer = app.renderer as PIXI.Renderer;
    const tileSize = TILE_SIZE / TERRAIN_SCALE; // 50px per tile at 1/4 scale
    const texW = Math.ceil(WORLD_W / TERRAIN_SCALE);
    const texH = Math.ceil(WORLD_H / TERRAIN_SCALE);

    // Build a temporary container to render all tiles into
    const container = new PIXI.Container();

    // ── Layer 0: Zone accent tint ─────────────────────────────────────────────
    if (zoneGrid) {
      const gZone = new PIXI.Graphics();
      for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
          const z = zoneGrid[row * GRID_COLS + col];
          const accent = (ZONE_ACCENT_HEX as Record<number, number>)[z] ?? 0;
          if (!accent) continue;
          gZone.beginFill(accent, 0.25);
          gZone.drawRect(col * tileSize, row * tileSize, tileSize, tileSize);
          gZone.endFill();
        }
      }
      container.addChild(gZone);
    }

    // ── Layer 1: Terrain tiles (textured sprites) ─────────────────────────────
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const t = terrainGrid[row * GRID_COLS + col];

        let texId: TerrainTexId;
        if (t === 0) {
          texId = TERRAIN_TEX.CONCRETE;
        } else if (t === 1) {
          // Road — pick variant by neighbours
          const L = col > 0 && terrainGrid[row * GRID_COLS + col - 1] === 1;
          const R = col < GRID_COLS - 1 && terrainGrid[row * GRID_COLS + col + 1] === 1;
          const U = row > 0 && terrainGrid[(row - 1) * GRID_COLS + col] === 1;
          const D = row < GRID_ROWS - 1 && terrainGrid[(row + 1) * GRID_COLS + col] === 1;
          texId = getRoadTexId(L, R, U, D);
        } else if (t === 2) {
          texId = TERRAIN_TEX.GRASS;
        } else if (t === 3) {
          texId = TERRAIN_TEX.SAND;
        } else if (t === 4) {
          texId = TERRAIN_TEX.MUD;
        } else {
          texId = TERRAIN_TEX.WATER;
        }

        const tileTex = getTerrainTexture(renderer, texId);
        const spr = new PIXI.Sprite(tileTex);
        spr.x = col * tileSize;
        spr.y = row * tileSize;
        spr.width = tileSize;
        spr.height = tileSize;
        container.addChild(spr);
      }
    }

    // Bake into RenderTexture — one-time GPU upload
    const rt = PIXI.RenderTexture.create({ width: texW, height: texH });
    renderer.render(container, { renderTexture: rt });
    container.destroy({ children: true });

    setTexture(rt);
    return () => { rt.destroy(true); };
  }, [terrainGrid, zoneGrid, worldSeed, app]);

  if (!texture) return null;

  return (
    <Sprite
      texture={texture}
      x={0} y={0}
      scale={{ x: TERRAIN_SCALE, y: TERRAIN_SCALE }}
    />
  );
}

// Wrapper so useApp() is only called inside Stage context
const TerrainLayer = React.memo(
  ({ s }: { s: GameState }) => (
    <TerrainLayerInner
      terrainGrid={s.terrainGrid}
      zoneGrid={s.zoneGrid ?? null}
      worldSeed={s.worldSeed}
    />
  ),
  (prev, next) => prev.s.worldSeed === next.s.worldSeed
    && prev.s.terrainGrid === next.s.terrainGrid
    && prev.s.zoneGrid === next.s.zoneGrid
);




// ── VehicleGraphic (TEXTURED) ────────────────────────────────────────────────
const VehicleGraphic = ({ v }: { v: any }) => {
  const vt = v.vehicleType || 'car';
  const textureUrl = {
    car: '/assets/vehicles/car.png',
    motorcycle: '/assets/vehicles/motorcycle.png',
    truck: '/assets/vehicles/truck.png',
    police_cruiser: '/assets/vehicles/police.png',
  }[vt as string] || '/assets/vehicles/car.png';

  const texture = useMemo(() => PIXI.Texture.from(textureUrl), [textureUrl]);

  const drawOverlays = React.useCallback((g: PIXI.Graphics) => {
    g.clear();
    const hw = v.width / 2;
    const hh = v.height / 2;

    // Driver dot
    if (v.driverId) {
      g.beginFill(0xffaa00, 1);
      g.drawCircle(-3, 5, 4);
      g.endFill();
    }

    // Passenger dot
    if (v.passengerId) {
      g.beginFill(0x00ccff, 1);
      g.drawCircle(3, 5, 4);
      g.endFill();
    }

    // Health bar (only if damaged)
    const hp = v.vehicleHealth ?? v.health;
    const maxHp = v.vehicleMaxHealth ?? v.maxHealth;
    if (hp < maxHp) {
      g.beginFill(0x222222, 0.7); g.drawRect(-hw, hh + 10, v.width, 5); g.endFill();
      const pct = Math.max(0, hp / maxHp);
      g.beginFill(pct > 0.5 ? 0x00ff88 : pct > 0.25 ? 0xffaa00 : 0xff2233, 1);
      g.drawRect(-hw, hh + 10, v.width * pct, 5);
      g.endFill();
    }
  }, [v.width, v.height, v.driverId, v.passengerId, v.vehicleHealth, v.vehicleMaxHealth, v.health, v.maxHealth]);

  return (
    <Container x={v.x} y={v.y} rotation={v.facing + Math.PI / 2}>
      <Sprite
        texture={texture}
        anchor={0.5}
        width={v.width * 1.4} // Slightly larger than physics box for better fit
        height={v.height * 1.4}
      />
      <Graphics draw={drawOverlays} />
    </Container>
  );
};

// ── Map Overlay ────────────────────────────────────────────────────────────────

const MapOverlay = React.memo(({ s, W, H, WORLD_W, WORLD_H, toggleMap, onExitGame, onPause }: { s: GameState, W: number, H: number, WORLD_W: number, WORLD_H: number, toggleMap: () => void, onExitGame: () => void, onPause?: () => void }) => {
  const p = s.player;
  const isFullMap = s.fullMapOpen;
  // Better mobile detection that handles landscape phones and tablets
  const isMobile = W < 768 || (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches);

  // Minimap sizes
  const miniW = isMobile ? 130 : 200;
  const miniH = isMobile ? 130 : 200;
  const miniViewSize = isMobile ? 4000 : 6000;

  // Fullmap tracking states
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = React.useState(false);
  const dragStart = React.useRef({ x: 0, y: 0 });
  const [selectedEntity, setSelectedEntity] = React.useState<any | null>(null);

  // Auto center full map on player initially
  React.useEffect(() => {
    if (isFullMap) {
      setZoom(1.5);
      setPan({ x: -p.x, y: -p.y });
      setSelectedEntity(null);
    }
  }, [isFullMap, p.x, p.y]);

  // Fullmap sizes
  const fullMapW = Math.min(W * 0.9, H * 0.9);
  const fullMapH = fullMapW;

  const gRef = React.useRef<PIXI.Graphics>(null);

  const redraw = React.useCallback(() => {
    const g = gRef.current;
    if (!g) return;
    g.clear();

    if (isFullMap) {
      // Full screen dark overlay
      g.beginFill(0x000000, 0.85);
      g.drawRect(0, 0, W, H);
      g.endFill();

      // Full map bounding box
      const startX = (W - fullMapW) / 2;
      const startY = (H - fullMapH) / 2;

      g.lineStyle(2, 0xff33aa, 0.5);
      g.beginFill(0x070709, 0.9);
      g.drawRect(startX, startY, fullMapW, fullMapH);
      g.endFill();
      g.lineStyle(0);

      // Apply GTA Map zoom/pan transformations
      const mapScale = (fullMapW / WORLD_W) * zoom;

      const toMapX = (worldX: number) => startX + (fullMapW / 2) + ((worldX + pan.x) * mapScale);
      const toMapY = (worldY: number) => startY + (fullMapH / 2) + ((worldY + pan.y) * mapScale);

      // Mask viewing window so moving map pieces don't bleed out of the bounding box
      g.beginHole();
      g.drawRect(0, 0, startX, H); // Left mask
      g.drawRect(startX, startY + fullMapH, fullMapW, H - startY - fullMapH); // Bottom mask
      g.drawRect(startX + fullMapW, 0, W - startX - fullMapW, H); // Right mask
      g.drawRect(startX, 0, fullMapW, startY); // Top mask
      g.endHole();

      // Region labels (statically placed in the world)
      const drawRegionLabel = (worldX: number, worldY: number, text: string) => {
        const px = toMapX(worldX);
        const py = toMapY(worldY);
        // We simulate text with simple thick geometry lines, or rely on GameCanvas to render actual HUD text separately.
        // For pure Graphics context, we draw stylized marker boxes for Regions.
        g.beginFill(0x223344, 0.4);
        g.drawRect(px - 100 * zoom, py - 20 * zoom, 200 * zoom, 40 * zoom);
        g.endFill();
        g.lineStyle(2, 0x00ccff, 0.3 * zoom); // A subtle crosshair showing region center
        g.moveTo(px - 20 * zoom, py); g.lineTo(px + 20 * zoom, py);
        g.moveTo(px, py - 20 * zoom); g.lineTo(px, py + 20 * zoom);
        g.lineStyle(0);
      };

      // Draw mythic regional labels at their centers
      drawRegionLabel(WORLD_W / 2, WORLD_H / 2, "NEON CITY");
      drawRegionLabel(WORLD_W / 2, WORLD_H * 0.15, "THE CITADEL");
      drawRegionLabel(WORLD_W / 2, WORLD_H * 0.85, "DREAD SECTOR");
      drawRegionLabel(WORLD_W * 0.85, WORLD_H / 2, "VIPER DISTRICT");
      drawRegionLabel(WORLD_W * 0.15, WORLD_H / 2, "GHOST SECTOR");

      // Draw entities
      for (const e of s.entities) {
        const mx = toMapX(e.x);
        const my = toMapY(e.y);

        // Frustum culling for map viewport
        if (mx < startX - 20 || mx > startX + fullMapW + 20 || my < startY - 20 || my > startY + fullMapH + 20) continue;

        if (e.type === 'building') {
          // Highlight selected entity
          if (selectedEntity && selectedEntity.id === e.id) {
            g.lineStyle(2, 0x00ff88, 1);
            g.beginFill(0x445566, 0.8);
            g.drawRect(mx - (e.width / 2 * mapScale), my - (e.height / 2 * mapScale), e.width * mapScale, e.height * mapScale);
            g.endFill();
            g.lineStyle(0);
          } else {
            g.beginFill(0x445566, 0.6);
            g.drawRect(mx - (e.width / 2 * mapScale), my - (e.height / 2 * mapScale), e.width * mapScale, e.height * mapScale);
            g.endFill();
          }
        } else if (e.type === 'cop' || e.type === 'boss') {
          if (e.aiState !== 'dead') {
            g.beginFill(e.type === 'boss' ? 0xff0044 : 0x3377ff, 0.8);
            g.drawCircle(mx, my, 2.5 * Math.max(1, zoom * 0.5));
            g.endFill();
          }
        }
      }

      // Draw local player
      g.beginFill(0xffaa00, 1);
      g.drawCircle(toMapX(p.x), toMapY(p.y), 4 * Math.max(1, zoom * 0.5));
      g.endFill();

      // Draw remote players
      if (s.visualRemotePlayers) {
        for (const id in s.visualRemotePlayers) {
          const rp = s.visualRemotePlayers[id];
          if (!rp.dead) {
            g.beginFill(0x00ccff, 1);
            g.drawCircle(toMapX(rp.x), toMapY(rp.y), 4 * Math.max(1, zoom * 0.5));
            g.endFill();
          }
        }
      }

    } else {
      // Minimap logic (top right)
      const startX = W - miniW - (isMobile ? 10 : 20);
      const startY = isMobile ? 10 : 20;

      g.beginFill(0x000000, 0.6);
      g.drawRect(startX, startY, miniW, miniH);
      g.endFill();

      const scale = miniW / miniViewSize;

      const toMiniX = (worldX: number) => startX + miniW / 2 + (worldX - p.x) * scale;
      const toMiniY = (worldY: number) => startY + miniH / 2 + (worldY - p.y) * scale;

      // Draw road tiles on minimap
      if (s.terrainGrid && s.zoneGrid) {
        const terrGrid = s.terrainGrid;
        const tileScaleM = miniW / miniViewSize * TILE_SIZE;
        for (let row = 0; row < GRID_ROWS; row++) {
          for (let col = 0; col < GRID_COLS; col++) {
            if (terrGrid[row * GRID_COLS + col] !== 1) continue;
            const worldTX = col * TILE_SIZE + TILE_SIZE / 2;
            const worldTY = row * TILE_SIZE + TILE_SIZE / 2;
            if (Math.abs(worldTX - p.x) > miniViewSize / 2 || Math.abs(worldTY - p.y) > miniViewSize / 2) continue;
            const rx = toMiniX(col * TILE_SIZE);
            const ry = toMiniY(row * TILE_SIZE);
            if (rx < startX || rx > startX + miniW || ry < startY || ry > startY + miniH) continue;
            g.beginFill(0x1a1a2a, 0.8);
            g.drawRect(rx, ry, Math.max(1, tileScaleM), Math.max(1, tileScaleM));
            g.endFill();
          }
        }
      }

      for (const e of s.entities) {
        if (Math.abs(e.x - p.x) > miniViewSize / 2 || Math.abs(e.y - p.y) > miniViewSize / 2) continue;

        if (e.type === 'building') {
          const bx = toMiniX(e.x);
          const by = toMiniY(e.y);
          const bw = e.width * scale;
          const bh = e.height * scale;

          const clampX = Math.max(startX, bx);
          const clampY = Math.max(startY, by);
          const clampRight = Math.min(startX + miniW, bx + bw);
          const clampBottom = Math.min(startY + miniH, by + bh);

          if (clampRight > clampX && clampBottom > clampY) {
            // Landmark buildings glow on minimap
            const isLandmark = !!e.label;
            g.beginFill(isLandmark ? 0x00ff88 : 0x445566, isLandmark ? 0.9 : 0.5);
            g.drawRect(clampX, clampY, clampRight - clampX, clampBottom - clampY);
            g.endFill();
          }
        } else if (e.type === 'cop' || e.type === 'boss') {
          if (e.aiState !== 'dead') {
            g.beginFill(e.type === 'boss' ? 0xff0044 : 0x3377ff, 0.8);
            g.drawCircle(toMiniX(e.x), toMiniY(e.y), 2.5);
            g.endFill();
          }
        }
      }

      // Draw local player (always center of minimap)
      g.beginFill(0xffaa00, 1);
      g.drawCircle(startX + miniW / 2, startY + miniH / 2, 3);
      g.endFill();

      // Draw remote players
      if (s.visualRemotePlayers) {
        for (const id in s.visualRemotePlayers) {
          const rp = s.visualRemotePlayers[id];
          if (!rp.dead && Math.abs(rp.x - p.x) <= miniViewSize / 2 && Math.abs(rp.y - p.y) <= miniViewSize / 2) {
            g.beginFill(0x00ccff, 1);
            g.drawCircle(toMiniX(rp.x), toMiniY(rp.y), 3);
            g.endFill();
          }
        }
      }

      // Draw minimap border on top
      g.lineStyle(2, 0x00ccff, 0.3);
      g.drawRect(startX, startY, miniW, miniH);
      g.lineStyle(0);
    }

  }, [isFullMap, p.x, p.y, W, H, WORLD_W, WORLD_H, s.entities, s.visualRemotePlayers, isMobile, zoom, pan.x, pan.y, selectedEntity]);

  useTick(() => {
    redraw();
  });

  // Pointer Intercept implementations for GTA-style Map Dragging
  const onPointerDown = React.useCallback((e: PIXI.FederatedPointerEvent) => {
    if (!isFullMap) return;
    setIsDragging(true);
    dragStart.current = { x: e.globalX - pan.x, y: e.globalY - pan.y };
  }, [isFullMap, pan.x, pan.y]);

  const onPointerMove = React.useCallback((e: PIXI.FederatedPointerEvent) => {
    if (!isFullMap || !isDragging) return;
    setPan({
      x: e.globalX - dragStart.current.x,
      y: e.globalY - dragStart.current.y
    });
  }, [isFullMap, isDragging]);

  const onPointerUp = React.useCallback((e: PIXI.FederatedPointerEvent) => {
    if (!isFullMap) {
      if (isMobile) {
        // On mobile, tapping the minimap opens the Pause Menu (which contains the full map).
        // We call onPause (pause + toggleMap) if provided, otherwise fall back to toggleMap directly.
        if (onPause) {
          onPause();
        } else {
          toggleMap();
        }
      }
      return;
    }
    setIsDragging(false);

    // If it was a short click, evaluate selected entities
    const dx = e.globalX - (dragStart.current.x + pan.x);
    const dy = e.globalY - (dragStart.current.y + pan.y);
    if (Math.hypot(dx, dy) < 5) {
      // Calculate inverse world coordinates from screen click
      const startX = (W - fullMapW) / 2;
      const startY = (H - fullMapH) / 2;
      const mapScale = (fullMapW / WORLD_W) * zoom;

      const worldClickX = ((e.globalX - startX - (fullMapW / 2)) / mapScale) - pan.x;
      const worldClickY = ((e.globalY - startY - (fullMapH / 2)) / mapScale) - pan.y;

      // Find closest clicked building
      let found = null;
      for (const ent of s.entities) {
        if (ent.type === 'building') {
          const hw = ent.width / 2;
          const hh = ent.height / 2;
          if (Math.abs(worldClickX - ent.x) < hw && Math.abs(worldClickY - ent.y) < hh) {
            found = ent;
            break;
          }
        }
      }
      setSelectedEntity(found);
    }
  }, [isFullMap, pan.x, pan.y, W, fullMapW, H, fullMapH, WORLD_W, zoom, s.entities]);

  const onWheel = React.useCallback((e: PIXI.FederatedWheelEvent) => {
    if (!isFullMap) return;
    e.stopPropagation();

    // Smooth zoom clamping
    const zoomDir = e.deltaY > 0 ? -0.1 : 0.1;
    const newZoom = Math.min(Math.max(0.5, zoom + zoomDir), 5.0);
    setZoom(newZoom);
  }, [isFullMap, zoom]);

  // Minimap bounds for touch hitArea
  const miniStartX = W - miniW - (isMobile ? 10 : 20);
  const miniStartY = isMobile ? 10 : 20;

  return (
    <>
      <Graphics
        ref={gRef}
        interactive={isFullMap || isMobile}
        hitArea={!isFullMap ? new PIXI.Rectangle(miniStartX, miniStartY, miniW, miniH) : undefined}
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointerupoutside={onPointerUp}
        onwheel={onWheel}
      />
      {/* HTML DOM HUD for Selected Entity Details */}
      {isFullMap && selectedEntity && (
        <div
          className="absolute z-[100] p-4 rounded-lg shadow-2xl animate-fade-in pointer-events-none"
          style={{
            top: H * 0.1,
            right: W * 0.1,
            width: 300,
            background: 'linear-gradient(135deg, rgba(20,20,30,0.95), rgba(10,10,15,0.98))',
            border: '1px solid rgba(0,255,136,0.3)',
            boxShadow: '0 0 20px rgba(0,0,0,0.8), inset 0 0 10px rgba(0,255,136,0.1)'
          }}
        >
          <div className="flex justify-between items-start mb-2 border-b border-[#00ff8833] pb-2">
            <div>
              <div className="font-display text-lg tracking-widest text-[#00ff88] drop-shadow-[0_0_8px_rgba(0,255,136,0.5)]">
                {selectedEntity.name.toUpperCase()}
              </div>
              <div className="font-mono-game text-[10px] text-[#00ccff] uppercase tracking-wider">
                {selectedEntity.buildingType || 'CLASSIFIED STRUCTURE'}
              </div>
            </div>
            <div className="font-mono-game text-xs text-[#666]">
              ID:{selectedEntity.id.toString().substring(0, 6)}
            </div>
          </div>

          <div className="space-y-3 mt-3">
            <div>
              <div className="font-display text-[10px] text-[#555] mb-1">LOCATION DATA</div>
              <div className="font-mono-game text-xs text-[#aaa]">
                LAT: {(selectedEntity.y / WORLD_H * 100).toFixed(2)}°
                <br />
                LON: {(selectedEntity.x / WORLD_W * 100).toFixed(2)}°
              </div>
            </div>

            <div className="p-2 bg-[#00000066] rounded border border-[#333] font-mono-game text-[10px] text-[#888] leading-relaxed">
              {selectedEntity.buildingType === 'shop' && 'COMMERCIAL SECTOR. Registered vendor for local goods and services. Taxation pending.'}
              {selectedEntity.buildingType === 'safehouse' && 'RESTRICTED ACCESS. Known operational safehouse. Enter at your own risk.'}
              {selectedEntity.buildingType === 'landmark' && 'CULTURAL HERITAGE SITE. Heavy anomalous activity detected in this sector.'}
              {selectedEntity.buildingType === 'void' && 'VOID BAR. Unregulated nightlife establishment. High chance of criminal encounters.'}
              {!selectedEntity.buildingType && 'STANDARD ARCHITECTURE. No remarkable signatures detected.'}
            </div>
          </div>
        </div>
      )}
      {/* Save & Exit Button overlay when map is open */}
      {isFullMap && (
        <button
          onClick={() => {
            // Unpause before exiting to prevent frozen menus
            if (s.isPaused) s.isPaused = false;
            onExitGame();
          }}
          className="absolute z-[100] px-6 py-3 font-display tracking-widest text-sm transition-all animate-fade-in"
          style={{
            top: H * 0.1,
            left: W * 0.1,
            border: '2px solid #ff2233',
            color: '#ff2233',
            background: 'linear-gradient(135deg, rgba(20,20,30,0.95), rgba(10,10,15,0.98))',
            boxShadow: '0 0 15px rgba(255,34,51,0.2), inset 0 0 10px rgba(255,34,51,0.05)'
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,34,51,0.1)'}
          onMouseLeave={e => e.currentTarget.style.background = 'linear-gradient(135deg, rgba(20,20,30,0.95), rgba(10,10,15,0.98))'}>
          SAVE & EXIT
        </button>
      )}
    </>
  );
});
