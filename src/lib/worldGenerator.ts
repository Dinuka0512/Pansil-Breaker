/**
 * worldGenerator.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Zone-based deterministic world generation for Chaos Engine.
 *
 * Pipeline (11 steps):
 *  1  buildZoneMap        – Voronoi-style zone assignment per tile
 *  2  buildRoadNetwork    – Arterial + grid + organic roads by zone
 *  3  placeBuildings      – Road-frontage placement per zone
 *  4  placeLandmarks      – Fixed named landmarks at hardcoded positions
 *  5  placeNPCs           – Zone-weighted NPC spawning to road/sidewalk tiles
 *  6  placeVehicles       – Road-tile-only vehicle spawning
 *  7  validateConnectivity– BFS reachability from player spawn to landmarks
 */

import type { BuildingType } from '@/components/BuildingInteractionWindow';

// ── Re-export zone type for consumers ────────────────────────────────────────
export type ZoneId = 0 | 1 | 2 | 3 | 4 | 5;

export const ZONE_NAMES: Record<ZoneId, string> = {
    0: 'Urban Core',
    1: 'Commercial Strip',
    2: 'Suburban',
    3: 'Village / Rural',
    4: 'Industrial',
    5: 'Landmark District',
};

// Neon-mood accent colours (PIXI hex) per zone — used for terrain tinting
export const ZONE_ACCENT_HEX: Record<ZoneId, number> = {
    0: 0x003355, // cyan-blue   – Urban Core
    1: 0x331100, // amber-red   – Commercial
    2: 0x001a1a, // dim teal    – Suburban
    3: 0x001100, // dark green  – Village
    4: 0x1a0800, // amber       – Industrial
    5: 0x220011, // deep red    – Landmark
};

// ── Tile dimensions (must match useGameEngine constants) ──────────────────────
export const TILE_SIZE = 200;
export const WORLD_W = 4800;
export const WORLD_H = 4800;
export const GRID_COLS = Math.ceil(WORLD_W / TILE_SIZE); // 24
export const GRID_ROWS = Math.ceil(WORLD_H / TILE_SIZE); // 24

// ── Terrain tile values (must match useGameEngine) ────────────────────────────
// 0=concrete  1=road  2=grass  3=sand  4=mud  5=water
const T_CONCRETE = 0;
const T_ROAD = 1;
const T_GRASS = 2;
const T_SAND = 3;
const T_MUD = 4;

// ── Zone seed points (in tile coords) ────────────────────────────────────────
// These are the "centres" of each zone before Voronoi expansion.
const ZONE_SEEDS: { zone: ZoneId; col: number; row: number }[] = [
    { zone: 0, col: 12, row: 12 }, // Urban Core — dead centre
    { zone: 1, col: 12, row: 6 }, // Commercial — north corridor
    { zone: 1, col: 12, row: 18 }, // Commercial — south corridor
    { zone: 2, col: 7, row: 7 }, // Suburban   — NW mid-ring
    { zone: 2, col: 17, row: 7 }, // Suburban   — NE mid-ring
    { zone: 2, col: 7, row: 17 }, // Suburban   — SW mid-ring
    { zone: 2, col: 17, row: 17 }, // Suburban   — SE mid-ring
    { zone: 3, col: 3, row: 12 }, // Village    — far west
    { zone: 4, col: 21, row: 12 }, // Industrial — far east
    { zone: 5, col: 12, row: 3 }, // Landmark   — north (Citadel)
    { zone: 5, col: 12, row: 21 }, // Landmark   — south (Sector)
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function idx(col: number, row: number) { return row * GRID_COLS + col; }
function inBounds(col: number, row: number) {
    return col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS;
}
function tileToWorld(col: number, row: number) {
    return { x: col * TILE_SIZE + TILE_SIZE / 2, y: row * TILE_SIZE + TILE_SIZE / 2 };
}
function uid(): string { return Math.random().toString(36).slice(2, 9); }

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Zone Map (Voronoi)
// ─────────────────────────────────────────────────────────────────────────────
export function buildZoneMap(): Uint8Array {
    const zones = new Uint8Array(GRID_COLS * GRID_ROWS);
    for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
            let bestZone: ZoneId = 2; // default Suburban
            let bestDist = Infinity;
            for (const seed of ZONE_SEEDS) {
                const dc = col - seed.col;
                const dr = row - seed.row;
                const d = dc * dc + dr * dr; // squared Euclidean
                if (d < bestDist) { bestDist = d; bestZone = seed.zone; }
            }
            zones[idx(col, row)] = bestZone;
        }
    }
    return zones;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Road Network
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Fills a Uint8Array terrain grid with road tiles (T_ROAD = 1) following
 * zone-appropriate road topology, then layers the background biome terrain.
 */
export function buildRoadNetwork(
    zoneMap: Uint8Array,
    rng: () => number,
): Uint8Array {
    const grid = new Uint8Array(GRID_COLS * GRID_ROWS);

    // ── 2a. Background biome by zone ─────────────────────────────────────────
    for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
            const z = zoneMap[idx(col, row)] as ZoneId;
            let terrain = T_CONCRETE;
            switch (z) {
                case 0: terrain = T_CONCRETE; break;                          // Urban
                case 1: terrain = T_CONCRETE; break;                          // Commercial
                case 2: terrain = rng() < 0.4 ? T_GRASS : T_CONCRETE; break; // Suburban
                case 3: terrain = rng() < 0.6 ? T_GRASS : (rng() < 0.3 ? T_MUD : T_CONCRETE); break; // Village
                case 4: terrain = rng() < 0.15 ? T_SAND : T_CONCRETE; break; // Industrial
                case 5: terrain = T_CONCRETE; break;                          // Landmark
            }
            grid[idx(col, row)] = terrain;
        }
    }

    // ── Helper: paint a road row/column segment ───────────────────────────────
    const setRoadHoriz = (row: number, colStart: number, colEnd: number, halfWidth = 1) => {
        const r0 = Math.max(0, row - halfWidth);
        const r1 = Math.min(GRID_ROWS - 1, row + halfWidth);
        const cA = Math.min(colStart, colEnd);
        const cB = Math.max(colStart, colEnd);
        for (let r = r0; r <= r1; r++)
            for (let c = Math.max(0, cA); c <= Math.min(GRID_COLS - 1, cB); c++)
                grid[idx(c, r)] = T_ROAD;
    };
    const setRoadVert = (col: number, rowStart: number, rowEnd: number, halfWidth = 1) => {
        const c0 = Math.max(0, col - halfWidth);
        const c1 = Math.min(GRID_COLS - 1, col + halfWidth);
        const rA = Math.min(rowStart, rowEnd);
        const rB = Math.max(rowStart, rowEnd);
        for (let c = c0; c <= c1; c++)
            for (let r = Math.max(0, rA); r <= Math.min(GRID_ROWS - 1, rB); r++)
                grid[idx(c, r)] = T_ROAD;
    };

    // ── 2b. Arterial roads — one horizontal + one vertical spine ─────────────
    // Horizontal arterial across the entire map at row 12 (centred)
    setRoadHoriz(12, 0, GRID_COLS - 1, 1);
    // Vertical arterial at col 12
    setRoadVert(12, 0, GRID_ROWS - 1, 1);
    // Ring road roughly at col/row 8 and 16
    setRoadHoriz(8, 4, 20, 0);
    setRoadHoriz(16, 4, 20, 0);
    setRoadVert(4, 8, 16, 0);
    setRoadVert(20, 8, 16, 0);
    // Close the ring
    setRoadHoriz(8, 4, 4, 0);
    setRoadHoriz(16, 4, 4, 0);
    setRoadHoriz(8, 20, 20, 0);
    setRoadHoriz(16, 20, 20, 0);

    // ── 2c. Urban Core strict grid (rows/cols 10–14: 5-tile band) ─────────────
    for (let c = 9; c <= 15; c += 2) setRoadVert(c, 9, 15, 0);
    for (let r = 9; r <= 15; r += 2) setRoadHoriz(r, 9, 15, 0);

    // ── 2d. Commercial semi-grid (N corridor rows 4–8, S corridor rows 16–20) ─
    // North commercial: cols 10-14, rows 4-8 with slight jitter
    for (let c = 10; c <= 14; c += 2) {
        const jitter = Math.round((rng() - 0.5)); // ±1 tile jitter
        setRoadVert(c + jitter, 4, 8, 0);
    }
    for (let r = 5; r <= 8; r += 2) {
        const jitter = Math.round((rng() - 0.5));
        setRoadHoriz(r + jitter, 10, 14, 0);
    }
    // South commercial
    for (let c = 10; c <= 14; c += 2) {
        const jitter = Math.round((rng() - 0.5));
        setRoadVert(c + jitter, 16, 20, 0);
    }
    for (let r = 17; r <= 20; r += 2) {
        const jitter = Math.round((rng() - 0.5));
        setRoadHoriz(r + jitter, 10, 14, 0);
    }

    // ── 2e. Suburban streets (mid-ring, wider spacing) ────────────────────────
    for (let c = 5; c <= 8; c += 3)  setRoadVert(c, 5, 19, 0);
    for (let c = 16; c <= 19; c += 3) setRoadVert(c, 5, 19, 0);
    for (let r = 5; r <= 8; r += 3)  setRoadHoriz(r, 5, 21, 0);
    for (let r = 16; r <= 19; r += 3) setRoadHoriz(r, 5, 21, 0);

    // ── 2f. Industrial wide alleys (east side, cols 19–23) ───────────────────
    for (let c = 19; c <= 23; c += 2) setRoadVert(c, 8, 16, 0);
    for (let r = 9; r <= 16; r += 3) setRoadHoriz(r, 19, 23, 0);

    // ── 2g. Village organic roads (west side, cols 1–6) ──────────────────────
    // Random-walk from entry point on arterial
    const organicWalk = (startCol: number, startRow: number, steps: number) => {
        let c = startCol; let r = startRow;
        const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (let s = 0; s < steps; s++) {
            const [dc, dr] = dirs[Math.floor(rng() * dirs.length)];
            const nc = clampNum(c + dc, 1, 6);
            const nr = clampNum(r + dr, 1, GRID_ROWS - 2);
            grid[idx(nc, nr)] = T_ROAD;
            c = nc; r = nr;
        }
    };
    // Three organic paths from the arterial
    organicWalk(4, 12, 60);
    organicWalk(4, 10, 40);
    organicWalk(4, 14, 40);
    // Connect north and south
    setRoadVert(2, 8, 16, 0);

    // ── 2h. Landmark plaza approach roads ────────────────────────────────────
    // POLICE HQ (col 12, row 3) — approach from south
    setRoadVert(12, 3, 8, 0);
    // AFTERLIFE CLUB (col 12, row 21) — approach from north
    setRoadVert(12, 16, 21, 0);

    return grid;
}

function clampNum(v: number, min: number, max: number) {
    return Math.max(min, Math.min(max, v));
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — Building placement (road-frontage rule)
// ─────────────────────────────────────────────────────────────────────────────
export interface WorldBuilding {
    id: string;
    x: number; y: number;
    width: number; height: number;
    color: string;
    glowColor?: string;
    label?: string;
    buildingType?: BuildingType;
    facing: number; // radians — 0=right, PI/2=down, etc.
}

interface ZoneBuildingSpec {
    minW: number; maxW: number;
    minH: number; maxH: number;
    glowChance: number;
    typeChance: number; // chance of having a buildingType
    hueRange: [number, number];
    allowedTypes: (BuildingType | undefined)[];
}

const ZONE_BUILDING_SPEC: Record<ZoneId, ZoneBuildingSpec> = {
    0: { // Urban Core
        minW: 120, maxW: 240, minH: 120, maxH: 200,
        glowChance: 0.3, typeChance: 0.15,
        hueRange: [200, 240],
        allowedTypes: ['corporate', 'club_nirvana', undefined],
    },
    1: { // Commercial
        minW: 80, maxW: 160, minH: 80, maxH: 140,
        glowChance: 0.2, typeChance: 0.1,
        hueRange: [20, 40],
        allowedTypes: ['underground_bar', 'corporate', undefined],
    },
    2: { // Suburban
        minW: 60, maxW: 120, minH: 60, maxH: 100,
        glowChance: 0.08, typeChance: 0.05,
        hueRange: [160, 200],
        allowedTypes: ['safehouse', undefined],
    },
    3: { // Village/Rural
        minW: 40, maxW: 100, minH: 40, maxH: 90,
        glowChance: 0.04, typeChance: 0.04,
        hueRange: [80, 130],
        allowedTypes: ['safehouse', undefined],
    },
    4: { // Industrial
        minW: 150, maxW: 350, minH: 100, maxH: 200,
        glowChance: 0.12, typeChance: 0.06,
        hueRange: [25, 50],
        allowedTypes: ['corporate', undefined],
    },
    5: { // Landmark District
        minW: 100, maxW: 180, minH: 80, maxH: 140,
        glowChance: 0.35, typeChance: 0.2,
        hueRange: [330, 360],
        allowedTypes: ['police_station', 'underground_bar', undefined],
    },
};

const GLOW_COLORS: Record<ZoneId, string[]> = {
    0: ['#00ccff', '#33aaff', '#0088ff'],
    1: ['#ff9900', '#ff6633', '#ffcc00'],
    2: ['#00ff88', '#33ffcc', '#00cc66'],
    3: ['#66ff66', '#44cc44', '#88ff44'],
    4: ['#ff6600', '#ff4400', '#ffaa00'],
    5: ['#ff2233', '#cc33ff', '#3377ff'],
};

export function placeBuildings(
    terrainGrid: Uint8Array,
    zoneMap: Uint8Array,
    rng: () => number,
): WorldBuilding[] {
    const buildings: WorldBuilding[] = [];
    const occupied = new Set<number>(); // tile indices occupied by buildings

    // Mark road tiles in a quick lookup
    const isRoad = (c: number, r: number) =>
        inBounds(c, r) && terrainGrid[idx(c, r)] === T_ROAD;

    // Scan all tiles looking for spots adjacent to roads
    const candidates: { col: number; row: number; zone: ZoneId; roadDir: number }[] = [];

    for (let row = 1; row < GRID_ROWS - 1; row++) {
        for (let col = 1; col < GRID_COLS - 1; col++) {
            const tileIdx = idx(col, row);
            if (terrainGrid[tileIdx] === T_ROAD) continue; // skip road tiles

            const zone = zoneMap[tileIdx] as ZoneId;

            // Check all 4 orthogonal neighbours for a road
            const neighbours = [
                { dc: 0, dr: -1, dir: 0 }, // north → face south (PI/2)
                { dc: 0, dr: 1, dir: Math.PI }, // south → face north (-PI/2)
                { dc: -1, dr: 0, dir: Math.PI * 1.5 }, // west → face east (0)
                { dc: 1, dr: 0, dir: Math.PI * 0.5 }, // east → face west (PI)
            ];

            for (const n of neighbours) {
                if (isRoad(col + n.dc, row + n.dr)) {
                    candidates.push({ col, row, zone, roadDir: n.dir });
                    break; // one road neighbour is enough
                }
            }
        }
    }

    // Shuffle candidates (Fisher-Yates) so we place in random order
    for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    // Density targets per zone (approx number of buildings)
    const DENSITY: Record<ZoneId, number> = {
        0: 80,   // Urban Core — dense
        1: 60,   // Commercial
        2: 40,   // Suburban
        3: 25,   // Village sparse
        4: 50,   // Industrial large blocks
        5: 15,   // Landmark — sparse (plazas)
    };

    const zoneCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

    for (const cand of candidates) {
        const z = cand.zone;
        if (zoneCounts[z] >= DENSITY[z]) continue;

        const spec = ZONE_BUILDING_SPEC[z];
        const bw = Math.round(spec.minW + rng() * (spec.maxW - spec.minW));
        const bh = Math.round(spec.minH + rng() * (spec.maxH - spec.minH));

        // World-space position: align to near road edge
        const wx = cand.col * TILE_SIZE;
        const wy = cand.row * TILE_SIZE;

        // Footprint in tiles
        const tilesW = Math.ceil(bw / TILE_SIZE);
        const tilesH = Math.ceil(bh / TILE_SIZE);

        // Check no occupied tile or road tile in footprint
        let fits = true;
        const footprintTiles: number[] = [];
        for (let dr = 0; dr < tilesH && fits; dr++) {
            for (let dc = 0; dc < tilesW && fits; dc++) {
                const fc = cand.col + dc;
                const fr = cand.row + dr;
                if (!inBounds(fc, fr)) { fits = false; break; }
                const fi = idx(fc, fr);
                if (terrainGrid[fi] === T_ROAD || occupied.has(fi)) { fits = false; break; }
                footprintTiles.push(fi);
            }
        }
        if (!fits) continue;

        footprintTiles.forEach(fi => occupied.add(fi));

        const hue = spec.hueRange[0] + rng() * (spec.hueRange[1] - spec.hueRange[0]);
        const sat = 6 + rng() * 12;
        const lit = 8 + rng() * 8;
        const hasGlow = rng() < spec.glowChance;
        const glowColors = GLOW_COLORS[z];
        const buildingType = rng() < spec.typeChance
            ? spec.allowedTypes[Math.floor(rng() * spec.allowedTypes.length)] as BuildingType
            : undefined;

        buildings.push({
            id: 'b_' + uid(),
            x: wx, y: wy,
            width: bw, height: bh,
            color: `hsl(${hue}deg ${sat}% ${lit}%)`,
            glowColor: hasGlow ? glowColors[Math.floor(rng() * glowColors.length)] : undefined,
            buildingType,
            facing: cand.roadDir,
        });
        zoneCounts[z]++;
    }

    return buildings;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — Named Landmarks (preserves existing 5 landmarks at fixed positions)
// ─────────────────────────────────────────────────────────────────────────────
export interface LandmarkDef {
    type: BuildingType;
    label: string;
    color: string;
    glowColor: string;
    x: number; y: number;
    w: number; h: number;
}

const LANDMARKS: LandmarkDef[] = [
    {
        type: 'police_station', label: 'POLICE HQ',
        color: 'hsl(220 15% 14%)', glowColor: '#3377ff',
        x: WORLD_W / 2, y: WORLD_H * 0.15,
        w: 240, h: 180,
    },
    {
        type: 'corporate', label: 'CORP OFFICE',
        color: 'hsl(200 10% 12%)', glowColor: '#00ccff',
        x: WORLD_W * 0.45, y: WORLD_H * 0.45,
        w: 200, h: 280,
    },
    {
        type: 'corporate', label: 'LOTUS TOWER',
        color: 'hsl(200 10% 12%)', glowColor: '#00ccff',
        x: WORLD_W / 2, y: WORLD_H / 2,
        w: 220, h: 320,
    },
    {
        type: 'underground_bar', label: 'BLACK LOTUS',
        color: 'hsl(350 15% 8%)', glowColor: '#ff2233',
        x: WORLD_W * 0.35, y: WORLD_H * 0.65,
        w: 180, h: 160,
    },
    {
        type: 'karma_mart', label: 'KARMA MART',
        color: 'hsl(40 15% 12%)', glowColor: '#ff9900',
        x: WORLD_W * 0.65, y: WORLD_H * 0.35,
        w: 160, h: 120,
    },
    {
        type: 'underground_bar', label: 'AFTERLIFE CLUB',
        color: 'hsl(340 15% 8%)', glowColor: '#ff2233',
        x: WORLD_W / 2, y: WORLD_H * 0.85,
        w: 180, h: 140,
    },
    {
        type: 'club_nirvana', label: 'CLUB NRVANA',
        color: 'hsl(280 15% 10%)', glowColor: '#cc33ff',
        x: WORLD_W * 0.85, y: WORLD_H / 2,
        w: 160, h: 120,
    },
    {
        type: 'safehouse', label: 'VOID BUNKER',
        color: 'hsl(140 10% 10%)', glowColor: '#00ff88',
        x: WORLD_W * 0.15, y: WORLD_H / 2,
        w: 120, h: 100,
    },
];

export function placeLandmarks(): WorldBuilding[] {
    return LANDMARKS.map(lm => ({
        id: 'lm_' + lm.label.replace(/\s+/g, '_').toLowerCase(),
        x: lm.x, y: lm.y,
        width: lm.w, height: lm.h,
        color: lm.color,
        glowColor: lm.glowColor,
        label: lm.label,
        buildingType: lm.type,
        facing: 0,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5 — NPC Placement (zone-weighted, road-adjacent tiles)
// ─────────────────────────────────────────────────────────────────────────────
export interface SpawnPoint {
    x: number; y: number; zone: ZoneId;
}

const NPC_ZONE_BUDGET: Record<ZoneId, number> = {
    0: 16, // Urban Core — high density
    1: 10, // Commercial
    2: 6, // Suburban
    3: 5, // Village
    4: 2, // Industrial — low
    5: 1, // Landmark — minimal
};

export function placeNPCs(
    terrainGrid: Uint8Array,
    zoneMap: Uint8Array,
    rng: () => number,
): SpawnPoint[] {
    // Collect all road tiles per zone
    const roadTilesByZone: Record<number, { col: number; row: number }[]> = {
        0: [], 1: [], 2: [], 3: [], 4: [], 5: [],
    };

    for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
            if (terrainGrid[idx(col, row)] === T_ROAD) {
                const z = zoneMap[idx(col, row)];
                roadTilesByZone[z].push({ col, row });
            }
        }
    }

    const spawnPoints: SpawnPoint[] = [];

    for (let z = 0; z <= 5; z++) {
        const budget = NPC_ZONE_BUDGET[z as ZoneId];
        const pool = roadTilesByZone[z];
        if (pool.length === 0) continue;

        for (let i = 0; i < budget; i++) {
            const tile = pool[Math.floor(rng() * pool.length)];
            // Offset within tile so NPCs don't all stack at tile centre
            const wx = tile.col * TILE_SIZE + 20 + rng() * (TILE_SIZE - 40);
            const wy = tile.row * TILE_SIZE + 20 + rng() * (TILE_SIZE - 40);
            spawnPoints.push({ x: wx, y: wy, zone: z as ZoneId });
        }
    }

    return spawnPoints;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 6 — Vehicle Placement (road tiles only, zone-typed)
// ─────────────────────────────────────────────────────────────────────────────
export type VehicleType = 'car' | 'motorcycle' | 'truck' | 'police_cruiser';

export interface VehicleSpawnPoint {
    vehicleType: VehicleType;
    x: number; y: number;
}

const ZONE_VEHICLES: Record<ZoneId, VehicleType[]> = {
    0: ['car', 'car', 'police_cruiser'],
    1: ['car', 'car', 'motorcycle'],
    2: ['car', 'motorcycle'],
    3: ['motorcycle'],
    4: ['truck', 'truck', 'car'],
    5: ['police_cruiser', 'police_cruiser'],
};

const VEHICLE_BUDGET_PER_ZONE = 4;

export function placeVehicles(
    terrainGrid: Uint8Array,
    zoneMap: Uint8Array,
    rng: () => number,
): VehicleSpawnPoint[] {
    const roadTilesByZone: Record<number, { col: number; row: number }[]> = {
        0: [], 1: [], 2: [], 3: [], 4: [], 5: [],
    };

    for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
            if (terrainGrid[idx(col, row)] === T_ROAD) {
                const z = zoneMap[idx(col, row)];
                roadTilesByZone[z].push({ col, row });
            }
        }
    }

    const vehicles: VehicleSpawnPoint[] = [];

    for (let z = 0; z <= 5; z++) {
        const pool = roadTilesByZone[z];
        const types = ZONE_VEHICLES[z as ZoneId];
        if (pool.length === 0) continue;

        // Shuffle the pool to pick random tiles without repetition
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }

        const count = Math.min(VEHICLE_BUDGET_PER_ZONE, pool.length);
        for (let i = 0; i < count; i++) {
            const tile = pool[Math.floor(rng() * pool.length)];
            const wx = tile.col * TILE_SIZE;
            const wy = tile.row * TILE_SIZE;
            const vt = types[Math.floor(rng() * types.length)];
            vehicles.push({ vehicleType: vt, x: wx, y: wy });
        }
    }

    return vehicles;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 7 — BFS Connectivity Validation
// ─────────────────────────────────────────────────────────────────────────────
/**
 * BFS from player start tile to all landmark tiles.
 * Returns the set of unreachable landmark labels.
 * If any landmarks are unreachable, we punch a direct road segment to fix it.
 */
export function validateAndRepairConnectivity(
    terrainGrid: Uint8Array,
    startWorldX: number,
    startWorldY: number,
): void {
    const startCol = Math.floor(startWorldX / TILE_SIZE);
    const startRow = Math.floor(startWorldY / TILE_SIZE);

    // BFS on road + concrete tiles (walkable)
    const visited = new Set<number>();
    const queue: number[] = [idx(startCol, startRow)];
    visited.add(idx(startCol, startRow));

    while (queue.length > 0) {
        const cur = queue.shift()!;
        const r = Math.floor(cur / GRID_COLS);
        const c = cur % GRID_COLS;
        for (const [dc, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nc = c + dc; const nr = r + dr;
            if (!inBounds(nc, nr)) continue;
            const ni = idx(nc, nr);
            if (visited.has(ni)) continue;
            // Walkable = road or concrete (not water/mud)
            const t = terrainGrid[ni];
            if (t === T_ROAD || t === T_CONCRETE || t === T_GRASS || t === T_SAND) {
                visited.add(ni);
                queue.push(ni);
            }
        }
    }

    // Check each landmark — if not reachable, punch a vertical road to it
    for (const lm of LANDMARKS) {
        const lmCol = Math.floor(lm.x / TILE_SIZE);
        const lmRow = Math.floor(lm.y / TILE_SIZE);
        if (!visited.has(idx(lmCol, lmRow))) {
            // Punch a road from arterial (row 12) down/up to landmark
            const rA = Math.min(12, lmRow);
            const rB = Math.max(12, lmRow);
            for (let r = rA; r <= rB; r++) {
                const c = clampNum(lmCol, 0, GRID_COLS - 1);
                terrainGrid[idx(c, r)] = T_ROAD;
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience helper for consumers
// ─────────────────────────────────────────────────────────────────────────────
export function getZoneAt(zoneMap: Uint8Array, worldX: number, worldY: number): ZoneId {
    const col = Math.floor(clampNum(worldX, 0, WORLD_W - 1) / TILE_SIZE);
    const row = Math.floor(clampNum(worldY, 0, WORLD_H - 1) / TILE_SIZE);
    return (zoneMap[idx(col, row)] ?? 2) as ZoneId;
}
