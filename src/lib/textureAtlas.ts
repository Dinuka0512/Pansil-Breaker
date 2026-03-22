/**
 * textureAtlas.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Runtime PixiJS texture atlas generator.
 * Creates three atlases (terrain, building, props) by drawing into a Canvas
 * via the same drawing routines used in texture-generator.html, then bakes them
 * into PIXI.Texture frames cached for the lifetime of the app.
 *
 * Usage:
 *   import { getTerrainTexture, getBuildingTexture, getPropTexture } from './textureAtlas';
 *   // Call inside a PixiJS Stage (requires PIXI.Application renderer):
 *   const tex = getTerrainTexture(app.renderer, TERRAIN_ID.ROAD_H);
 */
import * as PIXI from 'pixi.js';

// ─── Palette ──────────────────────────────────────────────────────────────────
const C = {
    cyan: 0x00e5ff,
    magenta: 0xff2ef6,
    purple: 0xcc33ff,
    blue: 0x0f6fff,
    amber: 0xffb300,
    green: 0x00ff88,
    red: 0xff2233,
    yellow: 0xe8ff00,
};

// ─── Terrain tile IDs ─────────────────────────────────────────────────────────
export const TERRAIN_TEX = {
    CONCRETE: 0,
    ROAD_H: 1,
    ROAD_V: 2,
    ROAD_CORNER_NE: 3,
    ROAD_CORNER_NW: 4,
    ROAD_CORNER_SE: 5,
    ROAD_CORNER_SW: 6,
    ROAD_T_N: 7,
    ROAD_T_S: 8,
    ROAD_T_E: 9,
    ROAD_T_W: 10,
    ROAD_CROSS: 11,
    ROAD_ALLEY: 12,
    SIDEWALK: 13,
    GRASS: 14,
    SAND: 15,
    MUD: 16,
    WATER: 17,
    ZEBRA_CROSS: 18,
    // Interior tiles starting from 32
    INT_FLOOR: 32,
    INT_WALL: 33,
    INT_EXIT: 34,
    INT_JAIL_BARS: 35,
} as const;
export type TerrainTexId = typeof TERRAIN_TEX[keyof typeof TERRAIN_TEX];

// ─── Building tile IDs ────────────────────────────────────────────────────────
export const BUILDING_TEX = {
    COMMERCIAL_SHOP: 0,
    TECH_STORE: 1,
    STREET_FOOD: 2,
    SMALL_MALL: 3,
    APARTMENT: 4,
    COMPACT_HOUSE: 5,
    WAREHOUSE: 6,
    FACTORY: 7,
    UTILITY: 8,
    LANDMARK_TOWER: 9,
    TEMPLE_GATE: 10,
    HOLOGRAM_PLAZA: 11,
    TRANSPORT_HUB: 12,
} as const;
export type BuildingTexId = typeof BUILDING_TEX[keyof typeof BUILDING_TEX];

// Map game buildingType strings → texture IDs
export const BUILDING_TYPE_TO_TEX: Record<string, BuildingTexId> = {
    corporate: BUILDING_TEX.TECH_STORE,
    police_station: BUILDING_TEX.UTILITY,
    underground_bar: BUILDING_TEX.COMMERCIAL_SHOP,
    club_nirvana: BUILDING_TEX.SMALL_MALL,
    safehouse: BUILDING_TEX.COMPACT_HOUSE,
    shop: BUILDING_TEX.COMMERCIAL_SHOP,
    tech_den: BUILDING_TEX.TECH_STORE,
    street_food: BUILDING_TEX.STREET_FOOD,
    mall: BUILDING_TEX.SMALL_MALL,
    apartment: BUILDING_TEX.APARTMENT,
    house: BUILDING_TEX.COMPACT_HOUSE,
    warehouse: BUILDING_TEX.WAREHOUSE,
    factory: BUILDING_TEX.FACTORY,
    landmark_tower: BUILDING_TEX.LANDMARK_TOWER,
    temple: BUILDING_TEX.TEMPLE_GATE,
    hologram_plaza: BUILDING_TEX.HOLOGRAM_PLAZA,
    transport_hub: BUILDING_TEX.TRANSPORT_HUB,
};

// ─── Prop tile IDs ────────────────────────────────────────────────────────────
export const PROP_TEX = {
    STREET_LIGHT: 0,
    SIGNBOARD: 1,
    VENDING: 2,
    BENCH: 3,
    TUK_TUK: 4,
    TRASH_BIN: 5,
    // Furniture starting from 16
    FURN_DESK: 16,
    FURN_CHAIR: 17,
    FURN_TABLE: 18,
    FURN_SHELF: 19,
    FURN_BED: 20,
    FURN_BAR: 21,
    FURN_JAIL_BED: 22,
    FURN_COMPUTER: 23,
} as const;
export type PropTexId = typeof PROP_TEX[keyof typeof PROP_TEX];

// ─── Internal cache ───────────────────────────────────────────────────────────
let _terrainAtlas: PIXI.BaseTexture | null = null;
let _buildingAtlas: PIXI.BaseTexture | null = null;
let _propsAtlas: PIXI.BaseTexture | null = null;

const _terrainCache = new Map<TerrainTexId, PIXI.Texture>();
const _buildingCache = new Map<BuildingTexId, PIXI.Texture>();
const _propsCache = new Map<PropTexId, PIXI.Texture>();

// Flush all cached textures (called on HMR update)
export function flushTextureCache() {
    _terrainAtlas?.destroy(); _terrainAtlas = null;
    _buildingAtlas?.destroy(); _buildingAtlas = null;
    _propsAtlas?.destroy(); _propsAtlas = null;
    _terrainCache.clear(); _buildingCache.clear(); _propsCache.clear();
}

// Vite HMR — regenerate on every hot update
if (import.meta.hot) {
    import.meta.hot.accept(() => { flushTextureCache(); });
}


// ─── Canvas helpers ───────────────────────────────────────────────────────────
function hexA(hex: number, a = 1): string {
    const r = (hex >> 16) & 0xff;
    const g = (hex >> 8) & 0xff;
    const b = hex & 0xff;
    return `rgba(${r},${g},${b},${a})`;
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, col: string, density = 0.12) {
    ctx.fillStyle = col;
    for (let i = 0; i < w * h * density; i++) {
        ctx.fillRect(Math.random() * w | 0, Math.random() * h | 0, 1, 1);
    }
}

// ─── Terrain Atlas (1024×1024, 64×64 tiles) ───────────────────────────────────
function buildTerrainCanvas(): HTMLCanvasElement {
    const T = 64;
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 1024;
    const ctx = canvas.getContext('2d')!;

    function tile(col: number, row: number, fn: (c: CanvasRenderingContext2D) => void) {
        ctx.save();
        ctx.translate(col * T, row * T);
        ctx.beginPath(); ctx.rect(0, 0, T, T); ctx.clip();
        fn(ctx);
        ctx.restore();
    }

    function asphalt(ctx: CanvasRenderingContext2D) {
        ctx.fillStyle = '#131320'; ctx.fillRect(0, 0, T, T);
        noise(ctx, T, T, hexA(C.cyan, 0.04));
        ctx.fillStyle = hexA(C.blue, 0.03);
        for (let i = 0; i < 5; i++) ctx.fillRect(Math.random() * T | 0, Math.random() * T | 0, 16 + Math.random() * 10 | 0, 1);
    }

    function concrete(ctx: CanvasRenderingContext2D) {
        ctx.fillStyle = '#0f0f16'; ctx.fillRect(0, 0, T, T);
        noise(ctx, T, T, '#1a1a26', 0.1);
        ctx.strokeStyle = hexA(C.cyan, 0.04); ctx.lineWidth = 0.5;
        for (let y = 0; y < T; y += 10) for (let x = 0; x < T; x += 12) {
            ctx.strokeRect(x + (y / 10 % 2 ? 6 : 0), y, 10, 9);
        }
    }

    function roadEdges(ctx: CanvasRenderingContext2D, left: boolean, right: boolean, up: boolean, down: boolean) {
        // No visible tile borders — just a very faint wet-road sheen in the road bands
        // This avoids the chess-board / crosshair artefact
        const H = left || right;
        const V = up || down;
        if (H) {
            ctx.fillStyle = hexA(C.blue, 0.04);
            ctx.fillRect(0, T / 2 - 10, T, 20);
        }
        if (V) {
            ctx.fillStyle = hexA(C.blue, 0.04);
            ctx.fillRect(T / 2 - 10, 0, 20, T);
        }
    }

    // 0: Concrete
    tile(0, 0, concrete);

    // 1: Road H
    tile(1, 0, ctx => {
        asphalt(ctx);
        // Dashed centre-lane marking only — no edge borders
        ctx.fillStyle = hexA(0xffffff, 0.13);
        for (let x = 4; x < T - 4; x += 14) ctx.fillRect(x, T / 2 - 1, 9, 2);
    });

    // 2: Road V
    tile(2, 0, ctx => {
        asphalt(ctx);
        // Dashed centre-lane marking only — no edge borders
        ctx.fillStyle = hexA(0xffffff, 0.13);
        for (let y = 4; y < T - 4; y += 14) ctx.fillRect(T / 2 - 1, y, 2, 9);
    });

    // 3–6: Corners
    const corners: [boolean, boolean, boolean, boolean][] = [
        [false, true, true, false], // NE
        [true, false, true, false], // NW
        [false, true, false, true], // SE
        [true, false, false, true], // SW
    ];
    const cornerAngles = [
        [0, T, Math.PI * 1.5],
        [T, T, Math.PI],
        [0, 0, 0],
        [T, 0, Math.PI / 2],
    ];
    corners.forEach(([l, r, u, d], i) => {
        tile(3 + i, 0, ctx => {
            asphalt(ctx);
            roadEdges(ctx, l, r, u, d);
            const [cx, cy, sa] = cornerAngles[i];
            ctx.fillStyle = hexA(C.cyan, 0.08);
            ctx.beginPath(); ctx.arc(cx, cy, T * 0.6, sa, sa + Math.PI / 2); ctx.lineTo(cx, cy); ctx.fill();
        });
    });

    // 7–10: T-junctions
    const tjunctions: [boolean, boolean, boolean, boolean][] = [
        [true, true, true, false], // T-N
        [true, true, false, true], // T-S
        [false, true, true, true], // T-E
        [true, false, true, true], // T-W
    ];
    tjunctions.forEach(([l, r, u, d], i) => tile(7 + i, 0, ctx => { asphalt(ctx); roadEdges(ctx, l, r, u, d); }));

    // 11: Cross
    tile(11, 0, ctx => {
        asphalt(ctx);
        roadEdges(ctx, true, true, true, true);
        ctx.fillStyle = hexA(0xffffff, 0.12);
        ctx.fillRect(T / 2 - 12, T / 2 - 1, 10, 2); ctx.fillRect(T / 2 + 2, T / 2 - 1, 10, 2);
        ctx.fillRect(T / 2 - 1, T / 2 - 12, 2, 10); ctx.fillRect(T / 2 - 1, T / 2 + 2, 2, 10);
    });

    // 12: Alley
    tile(12, 0, ctx => {
        ctx.fillStyle = '#0c0c14'; ctx.fillRect(0, 0, T, T);
        noise(ctx, T, T, hexA(C.magenta, 0.08));
        ctx.fillStyle = hexA(C.magenta, 0.2); ctx.fillRect(T / 2 - 6, 0, 12, T);
    });

    // 13: Sidewalk
    tile(13, 0, ctx => {
        ctx.fillStyle = '#141420'; ctx.fillRect(0, 0, T, T);
        noise(ctx, T, T, hexA(0xffffff, 0.02));
        ctx.strokeStyle = hexA(C.cyan, 0.1); ctx.lineWidth = 0.5;
        for (let y = 0; y < T; y += 16) ctx.strokeRect(0, y, T, 16);
        for (let x = 0; x < T; x += 16) ctx.strokeRect(x, 0, 16, T);
        ctx.fillStyle = hexA(C.cyan, 0.5); ctx.fillRect(0, T - 2, T, 2);
    });

    // Row 1: other terrain
    // 14: Grass
    tile(0, 1, ctx => {
        ctx.fillStyle = '#0a120a'; ctx.fillRect(0, 0, T, T);
        noise(ctx, T, T, hexA(C.green, 0.08), 0.2);
        ctx.fillStyle = hexA(C.green, 0.06);
        for (let i = 0; i < 8; i++) ctx.fillRect(Math.random() * T | 0, Math.random() * T | 0, 2, 5);
    });

    // 15: Sand
    tile(1, 1, ctx => {
        ctx.fillStyle = '#1a1510'; ctx.fillRect(0, 0, T, T);
        noise(ctx, T, T, hexA(C.amber, 0.1));
        ctx.fillStyle = hexA(C.amber, 0.05);
        for (let y = 0; y < T; y += 4) ctx.fillRect(0, y, T, 1);
    });

    // 16: Mud
    tile(2, 1, ctx => {
        ctx.fillStyle = '#100c08'; ctx.fillRect(0, 0, T, T);
        noise(ctx, T, T, hexA(C.blue, 0.06), 0.15);
    });

    // 17: Water
    tile(3, 1, ctx => {
        ctx.fillStyle = '#080e14'; ctx.fillRect(0, 0, T, T);
        ctx.strokeStyle = hexA(C.cyan, 0.12); ctx.lineWidth = 1;
        for (let y = 4; y < T; y += 8) {
            ctx.beginPath();
            for (let x = 0; x < T; x += 4) ctx.lineTo(x, y + Math.sin(x * 0.5) * 2);
            ctx.stroke();
        }
    });

    // 18: Zebra crossing
    tile(4, 1, ctx => {
        asphalt(ctx);
        ctx.fillStyle = hexA(0xffffff, 0.22);
        for (let y = 4; y < T; y += 12) ctx.fillRect(0, y, T, 6);
        ctx.fillStyle = hexA(C.yellow, 0.2);
        ctx.fillRect(0, 0, T, 2); ctx.fillRect(0, T - 2, T, 2);
    });

    // ── Interior Tiles ────────────────────────────────────────────────────────
    // 32: Interior Floor
    tile(0, 2, ctx => {
        ctx.fillStyle = '#1a1a2a'; ctx.fillRect(0, 0, T, T);
        ctx.strokeStyle = hexA(C.cyan, 0.1); ctx.lineWidth = 1;
        for (let x = 0; x <= T; x += 16) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, T); ctx.stroke();
        }
        for (let y = 0; y <= T; y += 16) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(T, y); ctx.stroke();
        }
        noise(ctx, T, T, hexA(C.cyan, 0.03), 0.05);
    });

    // 33: Interior Wall
    tile(1, 2, ctx => {
        ctx.fillStyle = '#2a2a3a'; ctx.fillRect(0, 0, T, T);
        ctx.strokeStyle = hexA(C.cyan, 0.3); ctx.lineWidth = 2;
        ctx.strokeRect(2, 2, T - 4, T - 4);
        ctx.fillStyle = hexA(C.cyan, 0.1);
        ctx.fillRect(8, 8, T - 16, T - 16);
    });

    // 34: Interior Exit
    tile(2, 2, ctx => {
        ctx.fillStyle = '#1a2a1a'; ctx.fillRect(0, 0, T, T);
        const g = ctx.createRadialGradient(T / 2, T / 2, 0, T / 2, T / 2, T / 2);
        g.addColorStop(0, hexA(C.green, 0.6));
        g.addColorStop(1, hexA(C.green, 0.1));
        ctx.fillStyle = g; ctx.fillRect(0, 0, T, T);
        ctx.strokeStyle = hexA(C.green, 0.8); ctx.lineWidth = 2;
        ctx.strokeRect(4, 4, T - 8, T - 8);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 20px Arial'; ctx.textAlign = 'center';
        ctx.fillText('EXIT', T / 2, T / 2 + 7);
    });

    // 35: Interior Jail Bars
    tile(3, 2, ctx => {
        ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, T, T);
        ctx.fillStyle = '#555';
        for (let x = 8; x < T; x += 16) ctx.fillRect(x, 0, 4, T);
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 10, T, 4);
        ctx.fillRect(0, T - 14, T, 4);
    });

    return canvas;
}

// ─── Building Atlas (1024×1024, 128×128 tiles) ────────────────────────────────
function buildBuildingCanvas(): HTMLCanvasElement {
    const T = 128;
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 1024;
    const ctx = canvas.getContext('2d')!;

    function tile(col: number, row: number, fn: (c: CanvasRenderingContext2D) => void) {
        ctx.save(); ctx.translate(col * T, row * T);
        ctx.beginPath(); ctx.rect(0, 0, T, T); ctx.clip(); fn(ctx); ctx.restore();
    }

    function baseRoof(ctx: CanvasRenderingContext2D, fill: string, edge: number) {
        ctx.fillStyle = fill; ctx.fillRect(0, 0, T, T);
        noise(ctx, T, T, 'rgba(255,255,255,0.015)', 0.05);
        // Very faint inner edge glow — no hard border line
        ctx.strokeStyle = hexA(edge, 0.18); ctx.lineWidth = 1;
        ctx.strokeRect(2, 2, T - 4, T - 4);
    }

    function wins(ctx: CanvasRenderingContext2D, cols: number, rows: number, x0: number, y0: number, ww: number, wh: number, glow: number) {
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const on = Math.random() < 0.6;
            ctx.fillStyle = hexA(glow, on ? 0.65 : 0.15);
            ctx.fillRect(x0 + c * (ww + 4), y0 + r * (wh + 5), ww, wh);
        }
    }

    // 0: Commercial shop
    tile(0, 0, ctx => {
        baseRoof(ctx, '#0d0d18', C.cyan);
        for (let x = 0; x < T; x += 8) {
            ctx.fillStyle = hexA(x % 16 < 8 ? C.cyan : C.magenta, 0.25);
            ctx.fillRect(x, T - 20, 8, 18);
        }
        ctx.fillStyle = hexA(C.cyan, 0.5); ctx.fillRect(8, T - 30, T - 16, 8);
        wins(ctx, 4, 2, 8, 20, 22, 18, C.cyan);
        ctx.fillStyle = hexA(C.magenta, 0.9); ctx.fillRect(16, T - 26, 32, 3);
    });

    // 1: Tech store
    tile(1, 0, ctx => {
        baseRoof(ctx, '#080e18', C.blue);
        ctx.strokeStyle = hexA(C.blue, 0.3); ctx.lineWidth = 1;
        for (let i = 0; i < 5; i++) {
            const bx = 10 + i * 22;
            ctx.beginPath(); ctx.moveTo(bx, 10); ctx.lineTo(bx, 40); ctx.lineTo(bx + 18, 40); ctx.stroke();
            ctx.fillStyle = hexA(C.blue, 0.6); ctx.beginPath(); ctx.arc(bx, 10, 2, 0, Math.PI * 2); ctx.fill();
        }
        wins(ctx, 3, 3, 10, 55, 26, 18, C.blue);
    });

    // 2: Street food (Sri Lankan)
    tile(2, 0, ctx => {
        baseRoof(ctx, '#14100a', C.amber);
        ctx.strokeStyle = hexA(C.amber, 0.3); ctx.lineWidth = 1;
        for (let y = 0; y < 50; y += 6) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(T, y); ctx.stroke(); }
        ctx.fillStyle = hexA(0xff4400, 0.7); ctx.beginPath(); ctx.arc(T / 2, T - 28, 14, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = hexA(0xff8800, 0.5); ctx.beginPath(); ctx.arc(T / 2, T - 28, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = hexA(C.amber, 0.6); ctx.fillRect(8, T - 45, T - 16, 10);
        for (let i = 0; i < 4; i++) { ctx.fillStyle = hexA(C.amber, 0.5); ctx.beginPath(); ctx.arc(12 + i * 28, T - 18, 7, 0, Math.PI * 2); ctx.fill(); }
    });

    // 3: Small mall
    tile(3, 0, ctx => {
        baseRoof(ctx, '#0e0a14', C.magenta);
        ctx.strokeStyle = hexA(C.magenta, 0.2); ctx.lineWidth = 1;
        for (let x = 0; x < T; x += 16) ctx.strokeRect(x, 0, 16, T);
        wins(ctx, 5, 4, 8, 12, 16, 16, C.magenta);
        ctx.fillStyle = hexA(C.magenta, 0.45); ctx.fillRect(T / 2 - 16, T - 18, 32, 18);
    });

    // 4: Apartment
    tile(0, 1, ctx => {
        baseRoof(ctx, '#0c0c16', C.cyan);
        ctx.fillStyle = '#1e2030'; ctx.fillRect(T / 2 - 12, 8, 24, 20);
        ctx.strokeStyle = hexA(C.cyan, 0.7); ctx.lineWidth = 1; ctx.strokeRect(T / 2 - 12, 8, 24, 20);
        for (let i = 0; i < 3; i++) {
            ctx.fillStyle = '#1a1a2a'; ctx.fillRect(6 + i * 36, T - 28, 26, 16);
            ctx.strokeStyle = hexA(C.blue, 0.5); ctx.lineWidth = 1; ctx.strokeRect(6 + i * 36, T - 28, 26, 16);
        }
        wins(ctx, 4, 3, 6, 35, 24, 14, C.cyan);
    });

    // 5: Compact house
    tile(1, 1, ctx => {
        baseRoof(ctx, '#100e0c', 0xcc6633);
        for (let y = 0; y < T; y += 12) for (let x = 0; x < T; x += 12) {
            ctx.fillStyle = hexA(y % 24 < 12 ? 0x7a3a10 : 0x6b3010, 0.5);
            ctx.fillRect(x + (y / 12 % 2 ? 6 : 0), y, 10, 10);
        }
        wins(ctx, 2, 2, T / 2 - 28, T / 2 - 16, 22, 16, 0xffcc88);
        ctx.fillStyle = hexA(0x4a2808, 0.9); ctx.fillRect(T / 2 - 8, T - 22, 16, 22);
    });

    // 6: Warehouse
    tile(0, 2, ctx => {
        baseRoof(ctx, '#0c100c', C.green);
        ctx.strokeStyle = hexA(0x2a3a2a, 0.9); ctx.lineWidth = 2;
        for (let x = 0; x < T; x += 8) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, T); ctx.stroke(); }
        for (let i = 0; i < 3; i++) {
            ctx.fillStyle = hexA(C.cyan, 0.12); ctx.fillRect(12 + i * 38, T / 2 - 14, 28, 28);
            ctx.strokeStyle = hexA(C.cyan, 0.35); ctx.lineWidth = 1; ctx.strokeRect(12 + i * 38, T / 2 - 14, 28, 28);
        }
        ctx.fillStyle = hexA(C.green, 0.5); ctx.fillRect(0, T - 4, T, 4);
    });

    // 7: Factory
    tile(1, 2, ctx => {
        baseRoof(ctx, '#0c0c0a', C.green);
        for (let i = 0; i < 3; i++) {
            ctx.fillStyle = '#2a2a20'; ctx.fillRect(8 + i * 38, 4, 18, 28);
            ctx.strokeStyle = hexA(C.green, 0.4); ctx.lineWidth = 1; ctx.strokeRect(8 + i * 38, 4, 18, 28);
            ctx.fillStyle = hexA(0xff4400, 0.6); ctx.beginPath(); ctx.arc(17 + i * 38, 4, 5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.strokeStyle = hexA(0x445544, 0.8); ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(0, T / 2); ctx.lineTo(T, T / 2); ctx.stroke();
    });

    // 8: Utility
    tile(2, 2, ctx => {
        baseRoof(ctx, '#0c0c10', 0x4488aa);
        ctx.strokeStyle = hexA(C.cyan, 0.8); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(T / 2, 8); ctx.lineTo(T / 2, 36); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(T / 2 - 12, 20); ctx.lineTo(T / 2 + 12, 20); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(T / 2 - 8, 14); ctx.lineTo(T / 2 + 8, 14); ctx.stroke();
        ctx.strokeStyle = hexA(C.blue, 0.7); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(T - 28, T - 28, 16, Math.PI * 0.8, Math.PI * 1.8); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(T - 28, T - 28); ctx.lineTo(T - 20, T - 20); ctx.stroke();
        for (let i = 0; i < 4; i++) {
            ctx.fillStyle = '#1a1a22'; ctx.fillRect(4 + i * 22, T - 40, 18, 16);
            ctx.strokeStyle = hexA(C.cyan, 0.3); ctx.lineWidth = 1; ctx.strokeRect(4 + i * 22, T - 40, 18, 16);
        }
    });

    // 9: Landmark tower (Lotus Tower)
    tile(0, 3, ctx => {
        ctx.fillStyle = '#060610'; ctx.fillRect(0, 0, T, T);
        const cx = T / 2, cy = T / 2;
        for (let r = 5; r < T / 2; r += 8) {
            ctx.strokeStyle = hexA(C.cyan, 0.05 + 0.15 * (1 - r / (T / 2))); ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
        }
        for (let i = 0; i < 8; i++) {
            ctx.save(); ctx.translate(cx, cy); ctx.rotate(i * Math.PI / 4);
            ctx.fillStyle = hexA(C.cyan, 0.18);
            ctx.beginPath(); ctx.ellipse(0, -26, 7, 18, 0, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
        }
        ctx.fillStyle = hexA(C.cyan, 0.9); ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, T / 2);
        g.addColorStop(0, hexA(C.cyan, 0.18)); g.addColorStop(1, hexA(C.cyan, 0));
        ctx.fillStyle = g; ctx.fillRect(0, 0, T, T);
    });

    // 10: Temple gate (neon torana)
    tile(1, 3, ctx => {
        ctx.fillStyle = '#080608'; ctx.fillRect(0, 0, T, T);
        ctx.fillStyle = hexA(C.amber, 0.65);
        ctx.fillRect(14, T - 55, 16, 55); ctx.fillRect(T - 30, T - 55, 16, 55);
        ctx.beginPath(); ctx.arc(T / 2, T - 55, T / 2 - 14, Math.PI, 0); ctx.closePath();
        ctx.strokeStyle = hexA(C.amber, 0.8); ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = hexA(C.amber, 0.12); ctx.fill();
        for (let y = T - 52; y < T; y += 10) {
            ctx.fillStyle = hexA(C.cyan, 0.35); ctx.fillRect(14, y, 16, 2); ctx.fillRect(T - 30, y, 16, 2);
        }
        ctx.fillStyle = hexA(C.cyan, 0.9); ctx.beginPath(); ctx.arc(T / 2, T - 55, 6, 0, Math.PI * 2); ctx.fill();
        for (let i = 0; i < 5; i++) {
            const fw = T - i * 24; ctx.fillStyle = hexA(C.amber, 0.4 - i * 0.06);
            ctx.fillRect((T - fw) / 2, 8 + i * 12, fw, 8);
        }
    });

    // 11: Hologram plaza
    tile(2, 3, ctx => {
        ctx.fillStyle = '#060608'; ctx.fillRect(0, 0, T, T);
        const cx = T / 2, cy = T / 2;
        for (let r = 6; r < 50; r += 7) {
            ctx.strokeStyle = hexA(C.purple, 0.15); ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
        }
        for (let i = 0; i < 12; i++) {
            const a = i * Math.PI / 6;
            ctx.strokeStyle = hexA(C.purple, 0.15); ctx.lineWidth = 0.5;
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * 50, cy + Math.sin(a) * 50); ctx.stroke();
        }
        ctx.fillStyle = hexA(C.purple, 0.6); ctx.fillRect(cx - 8, cy - 8, 16, 16);
        ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(cx, cy - 14, 5, 0, Math.PI * 2); ctx.fill();
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 50);
        g.addColorStop(0, hexA(C.purple, 0.22)); g.addColorStop(1, hexA(C.purple, 0));
        ctx.fillStyle = g; ctx.fillRect(0, 0, T, T);
    });

    // 12: Transport hub
    tile(3, 3, ctx => {
        baseRoof(ctx, '#080810', C.blue);
        for (let i = 0; i < 3; i++) {
            ctx.fillStyle = '#0e0e1e'; ctx.fillRect(6 + i * 38, T - 44, 32, 38);
            ctx.strokeStyle = hexA(C.blue, 0.5); ctx.lineWidth = 1; ctx.strokeRect(6 + i * 38, T - 44, 32, 38);
            const bx = 22 + i * 38, by = T - 16;
            ctx.fillStyle = hexA(C.blue, 0.8);
            ctx.beginPath(); ctx.moveTo(bx - 6, by); ctx.lineTo(bx + 6, by); ctx.lineTo(bx, by - 10); ctx.closePath(); ctx.fill();
        }
        for (let x = 0; x < T; x += 10) {
            ctx.fillStyle = hexA(x % 20 < 10 ? C.blue : C.cyan, 0.1); ctx.fillRect(x, 0, 10, T - 44);
        }
    });

    return canvas;
}

// ─── Props Atlas (512×512, 32×32 tiles) ──────────────────────────────────────
function buildPropsCanvas(): HTMLCanvasElement {
    const T = 32;
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    function tile(col: number, row: number, fn: (c: CanvasRenderingContext2D) => void) {
        ctx.save(); ctx.translate(col * T, row * T);
        ctx.beginPath(); ctx.rect(0, 0, T, T); ctx.clip(); fn(ctx); ctx.restore();
    }

    tile(0, 0, ctx => { // street light
        ctx.strokeStyle = hexA(0x445566, 0.9); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(T / 2, T - 2); ctx.lineTo(T / 2, 8); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(T / 2, 8); ctx.lineTo(T / 2 + 10, 8); ctx.stroke();
        ctx.fillStyle = hexA(C.cyan, 0.9); ctx.beginPath(); ctx.arc(T / 2 + 10, 6, 4, 0, Math.PI * 2); ctx.fill();
        const g = ctx.createRadialGradient(T / 2 + 10, 6, 0, T / 2 + 10, 6, 12);
        g.addColorStop(0, hexA(C.cyan, 0.4)); g.addColorStop(1, hexA(C.cyan, 0));
        ctx.fillStyle = g; ctx.fillRect(T / 2 - 2, 0, 24, 20);
    });

    tile(1, 0, ctx => { // signboard
        ctx.fillStyle = '#0a0a18'; ctx.fillRect(2, 6, T - 4, 14);
        ctx.strokeStyle = hexA(C.cyan, 0.8); ctx.lineWidth = 1.5; ctx.strokeRect(2, 6, T - 4, 14);
        ctx.fillStyle = hexA(C.cyan, 0.9); ctx.fillRect(5, 10, 8, 2); ctx.fillRect(5, 14, 12, 2);
        ctx.fillStyle = hexA(C.amber, 0.9); ctx.fillRect(16, 10, 10, 2); ctx.fillRect(16, 14, 8, 2);
        ctx.strokeStyle = hexA(0x334455, 0.8); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(T / 2, 2); ctx.lineTo(T / 2, 6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(T / 2, 20); ctx.lineTo(T / 2, T - 2); ctx.stroke();
    });

    tile(2, 0, ctx => { // vending machine
        ctx.fillStyle = '#0e0e20'; ctx.fillRect(6, 4, 20, 24);
        ctx.strokeStyle = hexA(C.magenta, 0.8); ctx.lineWidth = 1; ctx.strokeRect(6, 4, 20, 24);
        ctx.fillStyle = hexA(C.blue, 0.6); ctx.fillRect(8, 6, 16, 8);
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
            ctx.fillStyle = hexA([C.cyan, C.magenta, C.amber][r], 0.7);
            ctx.fillRect(8 + c * 5, 16 + r * 3, 4, 2);
        }
    });

    tile(3, 0, ctx => { // bench
        ctx.fillStyle = hexA(0x2a2010, 1); ctx.fillRect(4, T / 2 - 2, T - 8, 5);
        ctx.strokeStyle = hexA(C.amber, 0.5); ctx.lineWidth = 1; ctx.strokeRect(4, T / 2 - 2, T - 8, 5);
        ctx.strokeStyle = hexA(0x334, 0.8); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(6, T / 2 + 3); ctx.lineTo(6, T / 2 + 12); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(T - 6, T / 2 + 3); ctx.lineTo(T - 6, T / 2 + 12); ctx.stroke();
        ctx.fillStyle = hexA(0x2a2010, 0.8); ctx.fillRect(4, T / 2 - 8, T - 8, 4);
    });

    tile(4, 0, ctx => { // tuk-tuk
        ctx.fillStyle = hexA(0xcc5500, 0.9); ctx.fillRect(8, 6, 16, 22);
        ctx.strokeStyle = hexA(C.amber, 0.7); ctx.lineWidth = 1; ctx.strokeRect(8, 6, 16, 22);
        ctx.fillStyle = hexA(C.cyan, 0.4); ctx.fillRect(10, 8, 12, 6);
        ctx.fillStyle = '#222230';
        ctx.beginPath(); ctx.arc(10, 28, 3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(22, 28, 3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(16, 8, 3, 0, Math.PI * 2); ctx.fill();
    });

    tile(5, 0, ctx => { // trash bin
        ctx.fillStyle = '#1a1a28'; ctx.fillRect(9, 10, 14, 18);
        ctx.strokeStyle = hexA(C.cyan, 0.4); ctx.lineWidth = 1; ctx.strokeRect(9, 10, 14, 18);
        ctx.fillStyle = '#222232'; ctx.fillRect(7, 8, 18, 4);
        ctx.strokeStyle = hexA(C.cyan, 0.6); ctx.lineWidth = 1; ctx.strokeRect(7, 8, 18, 4);
        ctx.strokeStyle = hexA(C.green, 0.6); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(16, 20, 4, 0, Math.PI * 2); ctx.stroke();
    });

    // ── Furniture ─────────────────────────────────────────────────────────────
    // 16: Desk
    tile(0, 1, ctx => {
        ctx.fillStyle = '#554433'; ctx.fillRect(2, 4, T - 4, T - 8);
        ctx.strokeStyle = '#332211'; ctx.lineWidth = 2;
        ctx.strokeRect(2, 4, T - 4, T - 8);
        ctx.fillStyle = '#665544'; ctx.fillRect(4, 6, 8, 4);
    });

    // 17: Chair
    tile(1, 1, ctx => {
        ctx.fillStyle = '#443322'; ctx.fillRect(8, 8, T - 16, T - 16);
        ctx.strokeStyle = '#221100'; ctx.lineWidth = 2;
        ctx.strokeRect(8, 8, T - 16, T - 16);
        ctx.fillStyle = '#554433'; ctx.fillRect(10, 6, 12, 2);
    });

    // 18: Table
    tile(2, 1, ctx => {
        ctx.fillStyle = '#553322'; ctx.beginPath(); ctx.arc(T / 2, T / 2, 12, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#331100'; ctx.lineWidth = 2;
        ctx.stroke();
    });

    // 19: Shelf
    tile(3, 1, ctx => {
        ctx.fillStyle = '#445566'; ctx.fillRect(2, 2, T - 4, T - 4);
        ctx.strokeStyle = '#223344'; ctx.lineWidth = 1;
        for (let y = 6; y < T - 4; y += 6) {
            ctx.beginPath(); ctx.moveTo(4, y); ctx.lineTo(T - 4, y); ctx.stroke();
        }
    });

    // 20: Bed
    tile(4, 1, ctx => {
        ctx.fillStyle = '#3366ff'; ctx.fillRect(4, 2, T - 8, T - 4);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(6, 4, T - 12, 6);
        ctx.strokeStyle = '#1133aa'; ctx.lineWidth = 1;
        ctx.strokeRect(4, 2, T - 8, T - 4);
    });

    // 21: Bar Counter
    tile(5, 1, ctx => {
        ctx.fillStyle = '#442211'; ctx.fillRect(0, 8, T, T - 16);
        ctx.strokeStyle = '#221100'; ctx.lineWidth = 2;
        ctx.strokeRect(0, 8, T, T - 16);
        ctx.fillStyle = hexA(C.amber, 0.3); ctx.fillRect(4, 10, T - 8, 4);
    });

    // 22: Jail Bed
    tile(6, 1, ctx => {
        ctx.fillStyle = '#7f8c8d'; ctx.fillRect(4, 2, T - 8, T - 4);
        ctx.fillStyle = '#bdc3c7'; ctx.fillRect(4, 2, T - 8, 8); // Pillow
        ctx.strokeStyle = '#2c3e50'; ctx.lineWidth = 1.5; ctx.strokeRect(4, 2, T - 8, T - 4);
    });

    // 23: Computer
    tile(7, 1, ctx => {
        ctx.fillStyle = '#2c3e50'; ctx.fillRect(6, 6, T - 12, T - 12); // Keyboard base
        ctx.fillStyle = '#00e5ff'; ctx.fillRect(10, 10, T - 20, 4); // Screen glow
        ctx.fillStyle = '#555'; ctx.fillRect(8, T - 12, T - 16, 6); // Monitor base
    });

    return canvas;
}

// ─── Public API ───────────────────────────────────────────────────────────────
function ensureTerrainAtlas(renderer: PIXI.Renderer): PIXI.BaseTexture {
    if (!_terrainAtlas) {
        const canvas = buildTerrainCanvas();
        _terrainAtlas = PIXI.BaseTexture.from(canvas);
        _terrainAtlas.scaleMode = PIXI.SCALE_MODES.NEAREST;
    }
    return _terrainAtlas!;
}

function ensureBuildingAtlas(renderer: PIXI.Renderer): PIXI.BaseTexture {
    if (!_buildingAtlas) {
        const canvas = buildBuildingCanvas();
        _buildingAtlas = PIXI.BaseTexture.from(canvas);
        _buildingAtlas.scaleMode = PIXI.SCALE_MODES.LINEAR;
    }
    return _buildingAtlas!;
}

function ensurePropsAtlas(renderer: PIXI.Renderer): PIXI.BaseTexture {
    if (!_propsAtlas) {
        const canvas = buildPropsCanvas();
        _propsAtlas = PIXI.BaseTexture.from(canvas);
        _propsAtlas.scaleMode = PIXI.SCALE_MODES.NEAREST;
    }
    return _propsAtlas!;
}

/** Returns a cropped PIXI.Texture for a terrain tile (64×64 from the 1024×1024 atlas). */
export function getTerrainTexture(renderer: PIXI.Renderer, id: TerrainTexId): PIXI.Texture {
    if (_terrainCache.has(id)) return _terrainCache.get(id)!;
    const base = ensureTerrainAtlas(renderer);
    const T = 64;
    const col = id % 16;
    const row = Math.floor(id / 16);
    const tex = new PIXI.Texture(base, new PIXI.Rectangle(col * T, row * T, T, T));
    _terrainCache.set(id, tex);
    return tex;
}

/** Returns a cropped PIXI.Texture for a building tile (128×128 from 1024×1024 atlas). */
export function getBuildingTexture(renderer: PIXI.Renderer, id: BuildingTexId): PIXI.Texture {
    if (_buildingCache.has(id)) return _buildingCache.get(id)!;
    const base = ensureBuildingAtlas(renderer);
    const T = 128;
    const col = id % 8;
    const row = Math.floor(id / 8);
    const tex = new PIXI.Texture(base, new PIXI.Rectangle(col * T, row * T, T, T));
    _buildingCache.set(id, tex);
    return tex;
}

/** Returns a cropped PIXI.Texture for a prop sprite (32×32 from 512×512 atlas). */
export function getPropTexture(renderer: PIXI.Renderer, id: PropTexId): PIXI.Texture {
    if (_propsCache.has(id)) return _propsCache.get(id)!;
    const base = ensurePropsAtlas(renderer);
    const T = 32;
    const col = id % 16;
    const row = Math.floor(id / 16);
    const tex = new PIXI.Texture(base, new PIXI.Rectangle(col * T, row * T, T, T));
    _propsCache.set(id, tex);
    return tex;
}

/** Determine road texture variant from neighbours. */
export function getRoadTexId(left: boolean, right: boolean, up: boolean, down: boolean): TerrainTexId {
    const H = left || right;
    const V = up || down;
    if (H && V) {
        // Cross or T or corner
        const count = [left, right, up, down].filter(Boolean).length;
        if (count === 4) return TERRAIN_TEX.ROAD_CROSS;
        if (count === 3) {
            if (!left) return TERRAIN_TEX.ROAD_T_W;
            if (!right) return TERRAIN_TEX.ROAD_T_E;
            if (!up) return TERRAIN_TEX.ROAD_T_S;
            return TERRAIN_TEX.ROAD_T_N;
        }
        // Corner
        if (right && down) return TERRAIN_TEX.ROAD_CORNER_SE;
        if (right && up) return TERRAIN_TEX.ROAD_CORNER_NE;
        if (left && down) return TERRAIN_TEX.ROAD_CORNER_SW;
        return TERRAIN_TEX.ROAD_CORNER_NW;
    }
    return V ? TERRAIN_TEX.ROAD_V : TERRAIN_TEX.ROAD_H;
}
