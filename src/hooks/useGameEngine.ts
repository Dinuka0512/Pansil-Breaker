import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import type { BuildingType, BuildingAction } from '@/components/BuildingInteractionWindow';
import { useMultiplayer, RemotePlayer } from './useMultiplayer';
import { saveWorld } from '../lib/saveManager';
import {
  buildZoneMap,
  buildRoadNetwork,
  placeBuildings as zonePlaceBuildings,
  placeLandmarks,
  placeNPCs as zonePlaceNPCs,
  placeVehicles as zonePlaceVehicles,
  validateAndRepairConnectivity,
  getZoneAt,
  type ZoneId,
  ZONE_NAMES,
  ZONE_ACCENT_HEX,
} from '../lib/worldGenerator';
import { InteriorState, INTERIOR_LAYOUTS, INTERIOR_TILE_SIZE } from '../data/interiors';
// Re-export so GameCanvas can use zone helpers without importing worldGenerator directly
export { getZoneAt, ZONE_NAMES, ZONE_ACCENT_HEX };
export type { ZoneId };

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────────
// Returns a deterministic pseudo-random number in [0, 1) given a uint32 seed.
export function makePRNG(seed: number) {
  let s = seed >>> 0;
  return function rng(): number {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Generate a random uint32 seed suitable for use with makePRNG.
export function randomSeed(): number { return (Math.random() * 0xffffffff) >>> 0; }

// ── Types ──────────────────────────────────────────────────────────────────────
export type PrecedeKey = 'violence' | 'theft' | 'misconduct' | 'deception' | 'intoxication';

export interface Precept {
  key: PrecedeKey;
  label: string;
  value: number;
  color: string;
  icon: string;
}

export interface Vec2 { x: number; y: number }

export interface Entity {
  id: string;
  x: number; y: number;
  vx: number; vy: number;
  width: number; height: number;
  health: number; maxHealth: number;
  type: 'player' | 'npc' | 'cop' | 'item' | 'building' | 'boss' | 'vehicle';
  subtype?: string;
  buildingType?: BuildingType;
  color: string;
  glowColor?: string;
  facing: number;
  aiState?: 'wander' | 'flee' | 'chase' | 'idle' | 'dead' | 'corrupt' | 'search' | 'patrol' | 'bodyguard';
  aiTimer?: number;
  aiTarget?: Vec2 | null;
  aggroRadius?: number;
  name?: string;
  hasItem?: boolean;
  talkCooldown?: number;
  stunTimer?: number;
  label?: string;
  isBoss?: boolean;
  bossPhase?: number;
  dashTimer?: number;
  // Police vision cone
  fovAngle?: number;
  fovRange?: number;
  searchTimer?: number;
  lastSeenPlayer?: Vec2 | null;
  rank?: number;
  // Vehicle fields
  vehicleType?: VehicleType;
  driverId?: string | null;
  passengerId?: string | null;
  vehicleHealth?: number;
  vehicleMaxHealth?: number;
  engineOn?: boolean;
  vehicleSpeed?: number; // current speed magnitude
  isStolen?: boolean;
  occupyingVehicleId?: string | null;
  vehicleRole?: 'driver' | 'passenger' | null;
}

export interface FloatingText {
  id: string;
  x: number; y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  vy: number;
}

export interface DialogueNode {
  id: string;
  speaker: string;
  text: string;
  options: DialogueOption[];
}

export interface DialogueOption {
  text: string;
  isLie: boolean;
  consequence?: PrecedeKey;
  consequenceAmount?: number;
  nextId?: string | null;
  result?: string;
}

export interface Inventory {
  cash: number;
  weapons: string[];
  activeWeapon: string | null;
}

// ── Contact / Recruitment ─────────────────────────────────────────────────────
export interface Contact {
  id: string;
  name: string;
  role: string;
  skills: string[];
  loyalty: number; // 0-100
  available: boolean;
  recruited: boolean;
}

// ── Mission System ────────────────────────────────────────────────────────────
export type MissionStatus = 'briefing' | 'active' | 'complete' | 'failed';
export interface MissionObjective {
  id: string;
  text: string;
  done: boolean;
  type: 'gather' | 'recruit' | 'travel' | 'combat' | 'steal';
  targetId?: string;
  progress?: number;
  required?: number;
}
export interface Mission {
  id: string;
  name: string;
  description: string;
  status: MissionStatus;
  objectives: MissionObjective[];
  rewards: { cash: number; score: number; preceptKey?: PrecedeKey; preceptAmount?: number };
  timeLimit?: number; // frames
  timer?: number;
}

// ── Bar Fight Instance ────────────────────────────────────────────────────────
export interface BarFightState {
  active: boolean;
  enemies: Entity[];
  timer: number;
  playerStartPos: Vec2;
  defeated: number;
  total: number;
}

export interface GameState {
  worldSeed: number;
  player: Entity;
  entities: Entity[];
  floatingTexts: FloatingText[];
  precepts: Record<PrecedeKey, number>;
  chaosLevel: number;
  heatLevel: number;
  rageMode: boolean;
  rageModeTimer: number;
  fullMapOpen: boolean;
  activeDialogue: { node: DialogueNode; npcId: string } | null;
  gameTime: number;
  score: number;
  stealthMode: boolean;
  cameraX: number;
  cameraY: number;
  screenShake: number;
  keys: Set<string>;
  touches: { joystick: Vec2 | null };
  copSpawnTimer: number;
  copCount: number;
  glitchIntensity: number;
  playerDead: boolean;
  deathTimer: number;
  inventory: Inventory;
  nearBuilding: { entity: Entity; distance: number } | null;
  buildingWindowOpen: boolean;
  bossActive: boolean;
  bossDefeated: boolean;
  bossSpawnCooldown: number;
  // New systems
  contacts: Contact[];
  activeMission: Mission | null;
  arrestState: 'none' | 'caught' | 'bribe_offered' | 'jailed' | 'jail_release';
  arrestTimer: number;
  arrestingCop: Entity | null;
  jailTimer: number;
  barFight: BarFightState | null;
  bodyguards: { entities: Entity[]; timer: number } | null;
  slotMachineOpen: boolean;
  hideTimer: number;
  activeInterior: InteriorState | null;
  // Terrain
  terrainGrid: Uint8Array; // flat: index = y * GRID_COLS + x, value = TerrainType
  zoneGrid: Uint8Array;    // flat: index = y * GRID_COLS + x, value = ZoneId (0–5)
  // Vehicles
  vehicles: Entity[];
  // Multiplayer
  isHost?: boolean;
  syncPlayer?: (p: any, health: number, dead: boolean, name: string, chaosLevel: number, rageMode: boolean, occupyingVehicleId: string | null) => void;
  syncNPCs?: (entities: Entity[]) => void;
  syncVehicles?: (vehicles: Entity[]) => void;
  updateVehicleSeat?: (vehicleId: string, seat: 'driver' | 'passenger', occupantId: string | null) => void;
  sendVehiclePhysics?: (v: Entity) => void;
  syncItemPickup?: (id: string) => void;
  sendDamageEvent?: (npcId: string, damage: number) => void;
  clearDamageEvent?: (eventId: string) => void;
  remotePlayers?: Record<string, RemotePlayer>;
  visualRemotePlayers?: Record<string, RemotePlayer>;
  remoteNPCs?: Entity[];
  remoteVehicles?: Record<string, any>;
  damageEvents?: any[];
  isPaused: boolean;
}

// ── Terrain System ─────────────────────────────────────────────────────────────
export type TerrainType = 0 | 1 | 2 | 3 | 4 | 5;
// 0=default(concrete) 1=road 2=grass 3=sand 4=mud 5=water
export const TILE_SIZE = 200;
export const TERRAIN_SPEED: Record<number, number> = {
  0: 1.0,   // concrete default
  1: 1.2,   // road — fastest
  2: 0.85,  // grass — slightly slow
  3: 0.55,  // sand — difficult
  4: 0.35,  // mud — very slow
  5: 0.45,  // shallow water — worse than sand
};
export const TERRAIN_NAMES: Record<number, string> = {
  0: 'CONCRETE', 1: 'ROAD', 2: 'GRASSLAND', 3: 'SAND', 4: 'MUD', 5: 'SHALLOW WATER',
};
export const TERRAIN_COLORS_HEX: Record<number, number> = {
  0: 0x111115, // dark concrete
  1: 0x1a1a22, // asphalt
  2: 0x0d1a0d, // dark green
  3: 0x2a2218, // sandy brown
  4: 0x1a140a, // dark muddy brown
  5: 0x0a141e, // dark blue-teal
};

// ── Vehicle Types ──────────────────────────────────────────────────────────────
export type VehicleType = 'car' | 'motorcycle' | 'truck' | 'police_cruiser';
export const VEHICLE_MAX_SPEED: Record<VehicleType, number> = {
  car: 28.0,        // 8x player (3.5 * 8)
  motorcycle: 17.5, // 5x player (3.5 * 5)
  truck: 10.5,      // 3x player (3.5 * 3)
  police_cruiser: 21.0, // 6x player (3.5 * 6)
};
export const VEHICLE_HANDLING: Record<VehicleType, number> = {
  car: 0.06, motorcycle: 0.09, truck: 0.03, police_cruiser: 0.065,
};
export const VEHICLE_COLORS: Record<VehicleType, string> = {
  car: '#334455', motorcycle: '#553322', truck: '#334433', police_cruiser: '#112255',
};


// ── SFX callback type ────────────────────────────────────────────────────────
export type SFXCallback = (type: 'attack' | 'hit' | 'steal' | 'death' | 'ui_open' | 'ui_close' | 'purchase' | 'boss_spawn' | 'boss_defeat' | 'arrest' | 'jail' | 'slot_win' | 'slot_lose' | 'fight_start') => void;

// ── Constants ──────────────────────────────────────────────────────────────────
export const WORLD_W = 4800;
export const WORLD_H = 4800;
const PLAYER_SPEED = 3.5;
const BUILDING_INTERACT_RADIUS = 80;
const COP_FOV_HALF_ANGLE = Math.PI / 3; // 60 degrees each side = 120 total
const COP_FOV_RANGE = 200;
const COP_SEARCH_DURATION = 300; // 5 seconds
const HIDE_ESCAPE_FRAMES = 120; // 2 seconds hidden to lose pursuit

const PRECEPT_LABELS: Record<PrecedeKey, string> = {
  violence: 'VIOLENCE', theft: 'THEFT', misconduct: 'MISCONDUCT', deception: 'DECEPTION', intoxication: 'INTOXICATION',
};
const PRECEPT_COLORS: Record<PrecedeKey, string> = {
  violence: '#ff2233', theft: '#ff9900', misconduct: '#cc33ff', deception: '#00ccff', intoxication: '#ff33aa',
};
const PRECEPT_ICONS: Record<PrecedeKey, string> = {
  violence: '⚔', theft: '💰', misconduct: '😈', deception: '🗣', intoxication: '☠',
};

const NPC_NAMES = [
  'KARMA', 'SILA', 'METTA', 'DHAMMA', 'BODHI', 'NANDA', 'VIPAKA',
  'SACCA', 'ARIYA', 'SUDDHA', 'NIBBUTA', 'SUKHA', 'CITTA', 'PANNA',
];

const CONTACT_ROLES = ['Muscle', 'Hacker', 'Driver', 'Lookout', 'Fence', 'Chemist'];
const CONTACT_SKILLS_MAP: Record<string, string[]> = {
  'Muscle': ['Combat', 'Intimidation'],
  'Hacker': ['Electronics', 'Bypass'],
  'Driver': ['Getaway', 'Navigation'],
  'Lookout': ['Surveillance', 'Evasion'],
  'Fence': ['Appraisal', 'Black Market'],
  'Chemist': ['Substances', 'Medicine'],
};
const CONTACT_NAMES = ['RAVEN', 'GHOST', 'SPARK', 'VIPER', 'CIPHER', 'IRON', 'SHADE', 'FLUX', 'ECHO', 'BLITZ'];

const DIALOGUE_TREES: DialogueNode[][] = [
  [
    {
      id: 'root', speaker: 'STRANGER', text: 'You look like trouble. State your business.', options: [
        { text: 'Just passing through.', isLie: false, nextId: 'peace' },
        { text: '[LIE] I\'m a city inspector.', isLie: true, consequence: 'deception', consequenceAmount: 8, nextId: 'lie_success', result: 'They hand over their access card.' },
        { text: 'Give me everything you have.', isLie: false, consequence: 'misconduct', consequenceAmount: 6, nextId: 'hostile' },
      ]
    },
    { id: 'peace', speaker: 'STRANGER', text: 'Move along then. This city is already broken.', options: [{ text: '[Leave]', isLie: false, nextId: null }] },
    { id: 'lie_success', speaker: 'STRANGER', text: 'Oh! My apologies, inspector. Take this.', options: [{ text: '[Pocket the card]', isLie: false, nextId: null }] },
    { id: 'hostile', speaker: 'STRANGER', text: 'You\'re insane! Get away from me!', options: [{ text: '[Watch them run]', isLie: false, nextId: null }] },
  ],
  [
    {
      id: 'root', speaker: 'MERCHANT', text: 'Business has been rough. The police take half my earnings.', options: [
        { text: 'That\'s corrupt. I can help.', isLie: false, nextId: 'ally' },
        { text: '[LIE] I work for the police.', isLie: true, consequence: 'deception', consequenceAmount: 10, nextId: 'extort', result: 'Extortion funds secured.' },
        { text: 'Then pay me too.', isLie: false, consequence: 'misconduct', consequenceAmount: 8, nextId: 'demand' },
      ]
    },
    { id: 'ally', speaker: 'MERCHANT', text: 'Finally, an ally. Watch yourself out there.', options: [{ text: '[Nod]', isLie: false, nextId: null }] },
    { id: 'extort', speaker: 'MERCHANT', text: 'P-please don\'t report me! Here, take this!', options: [{ text: '[Collect payment]', isLie: false, nextId: null }] },
    { id: 'demand', speaker: 'MERCHANT', text: 'Everyone wants a cut... Fine. Take it.', options: [{ text: '[Take the money]', isLie: false, nextId: null }] },
  ],
  [
    {
      id: 'root', speaker: 'OFFICER', text: 'Freeze! Drop what you\'re carrying!', options: [
        { text: 'You\'ll never take me.', isLie: false, consequence: 'violence', consequenceAmount: 5, nextId: 'fight' },
        { text: '[LIE] I\'m an undercover agent.', isLie: true, consequence: 'deception', consequenceAmount: 12, nextId: 'bluff', result: 'The officer stands down, confused.' },
        { text: 'I surrender...', isLie: false, nextId: 'comply' },
      ]
    },
    { id: 'fight', speaker: 'OFFICER', text: 'Your funeral!', options: [{ text: '[Attack]', isLie: false, nextId: null }] },
    { id: 'bluff', speaker: 'OFFICER', text: 'I... apologize, agent. Carry on.', options: [{ text: '[Walk away free]', isLie: false, nextId: null }] },
    { id: 'comply', speaker: 'OFFICER', text: 'Smart choice. Get out of my sight.', options: [{ text: '[Comply]', isLie: false, nextId: null }] },
  ],
];

// ── Helpers ────────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 9); }
function dist(a: Vec2, b: Vec2) { return Math.hypot(a.x - b.x, a.y - b.y); }
function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }
function angle(from: Vec2, to: Vec2) { return Math.atan2(to.y - from.y, to.x - from.x); }

function buildingCenter(e: Entity): Vec2 {
  return { x: e.x + e.width / 2, y: e.y + e.height / 2 };
}

// Check if point is inside a cop's vision cone
function isInFOV(cop: Entity, target: Vec2, buildings: Entity[]): boolean {
  const d = dist(cop, target);
  const range = cop.fovRange || COP_FOV_RANGE;
  if (d > range) return false;

  const halfAngle = cop.fovAngle || COP_FOV_HALF_ANGLE;
  const toTarget = Math.atan2(target.y - cop.y, target.x - cop.x);
  let angleDiff = toTarget - cop.facing;
  // Normalize to [-PI, PI]
  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
  if (Math.abs(angleDiff) > halfAngle) return false;

  // Line-of-sight check against buildings (simplified)
  for (const b of buildings) {
    // Simple AABB line intersection
    const steps = 5;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const px = cop.x + (target.x - cop.x) * t;
      const py = cop.y + (target.y - cop.y) * t;
      if (px > b.x && px < b.x + b.width && py > b.y && py < b.y + b.height) {
        return false; // blocked by building
      }
    }
  }
  return true;
}

// Check if player is hidden (behind building or in darkness zone)
function isPlayerHidden(player: Entity, buildings: Entity[]): boolean {
  // Player is "hidden" if very close to a building edge (using it as cover)
  for (const b of buildings) {
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const d = dist(player, { x: cx, y: cy });
    const bRadius = Math.max(b.width, b.height) / 2;
    if (d < bRadius + 30 && d > bRadius - 10) return true;
  }
  return false;
}

function spawnNPC(index: number, rng: () => number): Entity {
  const margin = 100;
  return {
    id: 'npc_' + index,
    x: margin + rng() * (WORLD_W - margin * 2),
    y: margin + rng() * (WORLD_H - margin * 2),
    vx: 0, vy: 0,
    width: 18, height: 18,
    health: 80, maxHealth: 80,
    type: 'npc',
    subtype: rng() < 0.15 ? 'merchant' : 'civilian',
    color: `hsl(${180 + index * 23}deg 60% 65%)`,
    glowColor: `hsl(${180 + index * 23}deg 80% 50%)`,
    facing: rng() * Math.PI * 2,
    aiState: 'wander',
    aiTimer: rng() * 120,
    aiTarget: null,
    aggroRadius: 120,
    name: NPC_NAMES[index % NPC_NAMES.length],
    hasItem: rng() < 0.4,
    talkCooldown: 0,
  };
}

function spawnCop(exactX: number, exactY: number, rank?: number): Entity {
  const r = rank || (1 + Math.floor(Math.random() * 3));
  return {
    id: uid(), x: exactX, y: exactY, vx: 0, vy: 0,
    width: 20, height: 20,
    health: 100 + r * 20, maxHealth: 100 + r * 20,
    type: 'cop',
    color: '#1155ff', glowColor: '#3377ff',
    facing: Math.random() * Math.PI * 2,
    aiState: 'patrol',
    aiTimer: 0, aggroRadius: 220,
    name: r === 3 ? 'CAPTAIN' : r === 2 ? 'SERGEANT' : 'OFFICER',
    stunTimer: 0,
    fovAngle: COP_FOV_HALF_ANGLE,
    fovRange: COP_FOV_RANGE + r * 30,
    searchTimer: 0,
    lastSeenPlayer: null,
    rank: r,
  };
}

function spawnBoss(nearX: number, nearY: number): Entity {
  const x = clamp(nearX + (Math.random() - 0.5) * 400, 100, WORLD_W - 100);
  const y = clamp(nearY - 350, 100, WORLD_H - 100);
  return {
    id: 'boss_' + uid(), x, y, vx: 0, vy: 0,
    width: 36, height: 36,
    health: 500, maxHealth: 500,
    type: 'boss',
    color: '#ff0044', glowColor: '#ff3366',
    facing: 0, aiState: 'chase', aiTimer: 0, aggroRadius: 400,
    name: 'CHIEF ENFORCER', stunTimer: 0, isBoss: true, bossPhase: 1, dashTimer: 0,
  };
}

// Named buildings with specific types at fixed positions around the map
function spawnBuildings(rng: () => number): Entity[] {
  const buildings: Entity[] = [];
  const W_THIRD = WORLD_W / 3;
  const H_THIRD = WORLD_H / 3;

  const regions = [
    {
      name: "Neon City", x: W_THIRD, y: H_THIRD, w: W_THIRD, h: H_THIRD,
      colors: [200, 220, 240], type: 'corporate', density: 100
    }, // Center: Neon City
    {
      name: "The Citadel", x: W_THIRD, y: 0, w: W_THIRD, h: H_THIRD,
      colors: [30, 45, 60], type: 'police_station', density: 60
    }, // North: Fortified
    {
      name: "Dread Sector", x: W_THIRD, y: H_THIRD * 2, w: W_THIRD, h: H_THIRD,
      colors: [350, 0, 15], type: 'underground_bar', density: 70
    }, // South: Hellish/Rebel
    {
      name: "Viper District", x: W_THIRD * 2, y: H_THIRD, w: W_THIRD, h: H_THIRD,
      colors: [140, 160, 280], type: 'club_nirvana', density: 80
    }, // East: Deep neon/Serpent world
    {
      name: "Ghost Sector", x: 0, y: H_THIRD, w: W_THIRD, h: H_THIRD,
      colors: [80, 100, 120], type: 'safehouse', density: 40
    } // West: Sparse/Hidden
  ];

  // Specific Landmarks
  const namedBuildings = [
    { type: 'police_station', label: 'POLICE HQ', color: 'hsl(220 15% 14%)', glowColor: '#3377ff', x: WORLD_W / 2, y: H_THIRD / 2, w: 250, h: 200 },
    { type: 'corporate', label: 'LOTUS TOWER', color: 'hsl(200 10% 12%)', glowColor: '#00ccff', x: WORLD_W / 2, y: WORLD_H / 2, w: 200, h: 300 },
    { type: 'underground_bar', label: 'AFTERLIFE CLUB', color: 'hsl(340 15% 8%)', glowColor: '#ff2233', x: WORLD_W / 2, y: WORLD_H - 2000, w: 180, h: 140 },
    { type: 'club_nirvana', label: 'SERPENT GARDEN', color: 'hsl(280 15% 10%)', glowColor: '#cc33ff', x: WORLD_W - 3000, y: WORLD_H / 2, w: 160, h: 120 },
    { type: 'safehouse', label: 'VOID BUNKER', color: 'hsl(140 10% 10%)', glowColor: '#00ff88', x: 3000, y: WORLD_H / 2, w: 120, h: 100 },
  ];

  for (const nb of namedBuildings) {
    buildings.push({
      id: uid(), x: nb.x, y: nb.y, vx: 0, vy: 0, width: nb.w, height: nb.h,
      health: 999, maxHealth: 999, type: 'building', buildingType: nb.type as BuildingType,
      color: nb.color, glowColor: nb.glowColor, facing: 0, label: nb.label,
    });
  }

  let bgIdx = 0;
  for (const region of regions) {
    for (let i = 0; i < region.density; i++) {
      const w = 80 + rng() * 140;
      const h = 80 + rng() * 140;
      const x = region.x + 100 + rng() * (region.w - w - 200);
      const y = region.y + 100 + rng() * (region.h - h - 200);

      const overlaps = buildings.some(b =>
        x < b.x + b.width + 100 && x + w > b.x - 100 && y < b.y + b.height + 100 && y + h > b.y - 100
      );

      if (!overlaps) {
        const hue = region.colors[Math.floor(rng() * region.colors.length)] + (rng() - 0.5) * 20;
        buildings.push({
          id: 'bg_building_' + bgIdx++, x, y, vx: 0, vy: 0,
          width: w, height: h, health: 999, maxHealth: 999, type: 'building',
          color: `hsl(${hue}deg ${5 + rng() * 15}% ${8 + rng() * 8}%)`,
          glowColor: rng() < 0.15 ? `hsl(${hue}deg 80% 60%)` : undefined,
          facing: 0,
          buildingType: rng() < 0.1 ? region.type as BuildingType : undefined,
          label: rng() < 0.05 ? `${region.name.split(' ')[0]} OUTPOST` : undefined
        });
      }
    }
  }
  return buildings;
}

function spawnItems(rng: () => number): Entity[] {
  const items: Entity[] = [];
  const subtypes = ['substance', 'substance', 'weapon', 'cash', 'cash'];
  for (let i = 0; i < 300; i++) {
    items.push({
      id: 'item_' + i,
      x: 100 + rng() * (WORLD_W - 200),
      y: 100 + rng() * (WORLD_H - 200),
      vx: 0, vy: 0,
      width: 14, height: 14,
      health: 1, maxHealth: 1,
      type: 'item',
      subtype: subtypes[Math.floor(rng() * subtypes.length)],
      color: '#ffcc00', glowColor: '#ffaa00',
      facing: 0,
    });
  }
  return items;
}

function generateContact(): Contact {
  const role = CONTACT_ROLES[Math.floor(Math.random() * CONTACT_ROLES.length)];
  return {
    id: uid(),
    name: CONTACT_NAMES[Math.floor(Math.random() * CONTACT_NAMES.length)],
    role,
    skills: CONTACT_SKILLS_MAP[role] || ['General'],
    loyalty: 30 + Math.floor(Math.random() * 40),
    available: true,
    recruited: false,
  };
}

function createHeistMission(contacts: Contact[]): Mission {
  const objectives: MissionObjective[] = [
    { id: uid(), text: 'Acquire cutting tools (visit Karma Mart)', done: false, type: 'gather', progress: 0, required: 1 },
    { id: uid(), text: 'Recruit a crew member (Club Nirvana)', done: false, type: 'recruit', progress: 0, required: 1 },
    { id: uid(), text: 'Scout target location (Corp Office)', done: false, type: 'travel', progress: 0, required: 1 },
    { id: uid(), text: 'Execute the heist (manual combat)', done: false, type: 'combat', progress: 0, required: 3 },
  ];
  return {
    id: uid(),
    name: 'THE BIG SCORE',
    description: 'Plan and execute a high-risk corporate heist. Gather equipment, recruit crew, and hit the target.',
    status: 'active',
    objectives,
    rewards: { cash: 2000, score: 5000, preceptKey: 'theft', preceptAmount: 25 },
    timeLimit: 18000, // 5 minutes
    timer: 18000,
  };
}

function spawnBarFightEnemies(): Entity[] {
  const count = 3 + Math.floor(Math.random() * 3);
  const enemies: Entity[] = [];
  for (let i = 0; i < count; i++) {
    enemies.push({
      id: 'barfight_' + uid(),
      x: WORLD_W / 2 + (Math.random() - 0.5) * 200,
      y: WORLD_H / 2 + (Math.random() - 0.5) * 200,
      vx: 0, vy: 0,
      width: 18, height: 18,
      health: 60 + Math.random() * 40, maxHealth: 100,
      type: 'npc',
      subtype: 'brawler',
      color: `hsl(${350 + Math.random() * 20}deg 70% 55%)`,
      glowColor: '#ff4444',
      facing: Math.random() * Math.PI * 2,
      aiState: 'chase',
      aiTimer: 0,
      name: ['THUG', 'BRUISER', 'BRAWLER', 'PUNK', 'GOON'][Math.floor(Math.random() * 5)],
    });
  }
  return enemies;
}

// ── Terrain Generation ───────────────────────────────────────────────────────
export const GRID_COLS = Math.ceil(WORLD_W / TILE_SIZE);
export const GRID_ROWS = Math.ceil(WORLD_H / TILE_SIZE);

export function getTerrainAt(grid: Uint8Array, worldX: number, worldY: number): number {
  const col = Math.floor(clamp(worldX, 0, WORLD_W - 1) / TILE_SIZE);
  const row = Math.floor(clamp(worldY, 0, WORLD_H - 1) / TILE_SIZE);
  return grid[row * GRID_COLS + col] ?? 0;
}

function spawnTerrain(rng: () => number, buildings: Entity[]): Uint8Array {
  const grid = new Uint8Array(GRID_COLS * GRID_ROWS);

  // Biome painting by district
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const fx = col / GRID_COLS;
      const fy = row / GRID_ROWS;
      let terrain = 0;

      if (fx < 0.33) {
        terrain = rng() < 0.55 ? 2 : (rng() < 0.3 ? 4 : 0);
        if (rng() < 0.07) terrain = 4;
      } else if (fx > 0.67) {
        terrain = rng() < 0.5 ? 3 : 0;
        if (rng() < 0.05) terrain = 2;
      } else if (fy < 0.33) {
        terrain = rng() < 0.15 ? 2 : 0;
      } else if (fy > 0.67) {
        if (rng() < 0.12) terrain = 4;
        else if (rng() < 0.08) terrain = 5;
        else terrain = 0;
      }
      grid[row * GRID_COLS + col] = terrain;
    }
  }

  // Road painting helper: L-shaped paths
  const setRoad = (x1: number, y1: number, x2: number, y2: number, w: number) => {
    const hw = Math.ceil(w / 2);
    // Horizontal leg from (x1,y1) to (x2,y1)
    const r0 = Math.floor(clamp(y1, 0, WORLD_H - 1) / TILE_SIZE);
    const cA = Math.floor(clamp(Math.min(x1, x2), 0, WORLD_W - 1) / TILE_SIZE);
    const cB = Math.floor(clamp(Math.max(x1, x2), 0, WORLD_W - 1) / TILE_SIZE);
    for (let c = cA; c <= cB; c++) {
      for (let dr = -hw; dr <= hw; dr++) {
        const r = clamp(r0 + dr, 0, GRID_ROWS - 1);
        grid[r * GRID_COLS + c] = 1;
      }
    }
    // Vertical leg from (x2,y1) to (x2,y2)
    const c0 = Math.floor(clamp(x2, 0, WORLD_W - 1) / TILE_SIZE);
    const rA = Math.floor(clamp(Math.min(y1, y2), 0, WORLD_H - 1) / TILE_SIZE);
    const rB = Math.floor(clamp(Math.max(y1, y2), 0, WORLD_H - 1) / TILE_SIZE);
    for (let r = rA; r <= rB; r++) {
      for (let dc = -hw; dc <= hw; dc++) {
        const c = clamp(c0 + dc, 0, GRID_COLS - 1);
        grid[r * GRID_COLS + c] = 1;
      }
    }
  };

  // Main road network connecting landmarks (all relative fractions)
  const landmarks = [
    { x: WORLD_W / 2, y: WORLD_H * 0.167 }, // POLICE HQ
    { x: WORLD_W / 2, y: WORLD_H / 2 }, // LOTUS TOWER
    { x: WORLD_W / 2, y: WORLD_H * 0.875 }, // AFTERLIFE CLUB
    { x: WORLD_W * 0.875, y: WORLD_H / 2 }, // SERPENT GARDEN
    { x: WORLD_W * 0.125, y: WORLD_H / 2 }, // VOID BUNKER
  ];
  for (let i = 0; i < landmarks.length; i++) {
    const a = landmarks[i];
    const b = landmarks[(i + 1) % landmarks.length];
    setRoad(a.x, a.y, b.x, b.y, 2);
  }

  // Ring road around city center
  const ring = [
    { x: WORLD_W * 0.35, y: WORLD_H * 0.35 },
    { x: WORLD_W * 0.65, y: WORLD_H * 0.35 },
    { x: WORLD_W * 0.65, y: WORLD_H * 0.65 },
    { x: WORLD_W * 0.35, y: WORLD_H * 0.65 },
  ];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]; const b = ring[(i + 1) % ring.length];
    setRoad(a.x, a.y, b.x, b.y, 1);
  }

  // Random secondary roads
  for (let i = 0; i < 12; i++) {
    const x1 = rng() * WORLD_W;
    const y1 = rng() * WORLD_H;
    const x2 = clamp(x1 + (rng() - 0.5) * 6000, 0, WORLD_W);
    const y2 = clamp(y1 + (rng() - 0.5) * 6000, 0, WORLD_H);
    setRoad(x1, y1, x2, y2, 1);
  }

  // Ground under buildings = concrete
  for (const b of buildings) {
    if (b.type !== 'building') continue;
    const c0 = Math.floor(clamp(b.x, 0, WORLD_W - 1) / TILE_SIZE);
    const c1 = Math.floor(clamp(b.x + b.width, 0, WORLD_W - 1) / TILE_SIZE);
    const r0 = Math.floor(clamp(b.y, 0, WORLD_H - 1) / TILE_SIZE);
    const r1 = Math.floor(clamp(b.y + b.height, 0, WORLD_H - 1) / TILE_SIZE);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        grid[r * GRID_COLS + clamp(c, 0, GRID_COLS - 1)] = 0;
      }
    }
  }

  return grid;
}

// ── Vehicle Spawning ─────────────────────────────────────────────────────────
function spawnVehicle(vehicleType: VehicleType, x: number, y: number, id?: string): Entity {
  const colors: Record<VehicleType, { fill: string; glow: string }> = {
    car: { fill: '#334466', glow: '#4466aa' },
    motorcycle: { fill: '#663322', glow: '#aa5533' },
    truck: { fill: '#334433', glow: '#446644' },
    police_cruiser: { fill: '#112255', glow: '#3366cc' },
  };
  const dims: Record<VehicleType, { w: number; h: number }> = {
    car: { w: 36, h: 52 }, motorcycle: { w: 18, h: 38 }, truck: { w: 52, h: 72 }, police_cruiser: { w: 36, h: 52 },
  };
  const d = dims[vehicleType]; const c = colors[vehicleType];
  const hp = vehicleType === 'truck' ? 800 : 400;
  return {
    id: id || uid(),
    x, y, vx: 0, vy: 0,
    width: d.w, height: d.h,
    health: hp, maxHealth: hp,
    type: 'vehicle',
    vehicleType, driverId: null, passengerId: null,
    vehicleHealth: hp, vehicleMaxHealth: hp,
    vehicleSpeed: 0, engineOn: false,
    color: c.fill, glowColor: c.glow,
    facing: Math.random() * Math.PI * 2,
  };
}

function initState(seed?: number): GameState {
  const finalSeed = seed ?? randomSeed();
  const rng = makePRNG(finalSeed);

  // ── Zone-based world generation pipeline ────────────────────────────────
  // Step 1: Zone map (Voronoi)
  const zoneGrid = buildZoneMap();

  // Step 2: Road network (arterial + grid + organic by zone)
  const terrainGrid = buildRoadNetwork(zoneGrid, rng);

  // Step 3 + 4: Buildings (road-frontage) + named landmarks
  const landmarkEntities = placeLandmarks();
  const generatedBuildings = zonePlaceBuildings(terrainGrid, zoneGrid, rng);

  // Convert WorldBuilding → Entity (merge with landmark entities first so
  // overlap check in placeBuildings above is already complete)
  const allBuildingEntities: Entity[] = [
    ...landmarkEntities.map((b, i) => ({
      id: `bld_lm_${i}`, x: b.x, y: b.y, vx: 0, vy: 0,
      width: b.width, height: b.height,
      health: 999, maxHealth: 999,
      type: 'building' as const,
      buildingType: b.buildingType,
      color: b.color, glowColor: b.glowColor,
      facing: b.facing, label: b.label,
    })),
    ...generatedBuildings.map((b, i) => ({
      id: `bld_gen_${i}`, x: b.x, y: b.y, vx: 0, vy: 0,
      width: b.width, height: b.height,
      health: 999, maxHealth: 999,
      type: 'building' as const,
      buildingType: b.buildingType,
      color: b.color, glowColor: b.glowColor,
      facing: b.facing, label: b.label,
    })),
  ];

  // Step 7: BFS connectivity — repairs unreachable landmarks in-place
  validateAndRepairConnectivity(terrainGrid, WORLD_W / 2, WORLD_H / 2);

  // Step 5: Zone-weighted NPC spawn points
  const npcSpawnPoints = zonePlaceNPCs(terrainGrid, zoneGrid, rng);
  const npcs: Entity[] = npcSpawnPoints.map((sp, i) => ({
    id: 'npc_' + i,
    x: sp.x, y: sp.y,
    vx: 0, vy: 0,
    width: 18, height: 18,
    health: 80, maxHealth: 80,
    type: 'npc' as const,
    subtype: rng() < 0.15 ? 'merchant' : 'civilian',
    color: `hsl(${180 + i * 23}deg 60% 65%)`,
    glowColor: `hsl(${180 + i * 23}deg 80% 50%)`,
    facing: rng() * Math.PI * 2,
    aiState: 'wander' as const,
    aiTimer: rng() * 120,
    aiTarget: null,
    aggroRadius: 120,
    name: NPC_NAMES[i % NPC_NAMES.length],
    hasItem: rng() < 0.4,
    talkCooldown: 0,
  }));

  // Items — still scatter randomly (gameplay items don't need zone logic)
  const items = spawnItems(rng);

  // Step 6: Zone-typed vehicles on road tiles
  const vehicleSpawnPoints = zonePlaceVehicles(terrainGrid, zoneGrid, rng);
  const vehicles: Entity[] = [];
  vehicleSpawnPoints.forEach((p, i) => {
    const vType = p.vehicleType as VehicleType; // Assuming p.vehicleType is already VehicleType
    const vId = `veh_${i}`;
    vehicles.push(spawnVehicle(vType, p.x, p.y, vId));
  });

  return {
    worldSeed: finalSeed,
    player: {
      id: 'player',
      x: WORLD_W / 2, y: WORLD_H / 2,
      vx: 0, vy: 0,
      width: 22, height: 22,
      health: 150, maxHealth: 150,
      type: 'player',
      color: '#ff2233', glowColor: '#ff2233',
      facing: 0, stunTimer: 0,
    },
    entities: [...allBuildingEntities, ...items, ...npcs],
    floatingTexts: [],
    precepts: { violence: 0, theft: 0, misconduct: 0, deception: 0, intoxication: 0 },
    chaosLevel: 0, heatLevel: 0,
    rageMode: false, rageModeTimer: 0,
    fullMapOpen: false,
    activeDialogue: null,
    gameTime: 0, score: 0, stealthMode: false,
    cameraX: WORLD_W / 2, cameraY: WORLD_H / 2,
    screenShake: 0,
    keys: new Set(),
    touches: { joystick: null },
    copSpawnTimer: 0, copCount: 0,
    glitchIntensity: 0,
    playerDead: false, deathTimer: 0,
    inventory: { cash: 200, weapons: [], activeWeapon: null },
    nearBuilding: null,
    buildingWindowOpen: false,
    bossActive: false,
    bossDefeated: false,
    bossSpawnCooldown: 0,
    contacts: [],
    activeMission: null,
    arrestState: 'none',
    arrestTimer: 0,
    arrestingCop: null,
    jailTimer: 0,
    barFight: null,
    bodyguards: null,
    slotMachineOpen: false,
    hideTimer: 0,
    activeInterior: null,
    isPaused: false,
    terrainGrid,
    zoneGrid,
    vehicles,
  };
}

// ── Hook ───────────────────────────────────────────────────────────────────────
export function useGameEngine(worldId?: string, worldName?: string, loadedState?: Partial<GameState> | null) {
  const playerId = useMemo(() => uid(), []);
  const { roomCode, isHost, worldSeed, remotePlayers, remoteNPCs, remoteVehicles, pickedUpItems, damageEvents, createWorld, joinWorld, leaveWorld, syncPlayer, syncNPCs, syncVehicles, updateVehicleSeat, sendVehiclePhysics, syncItemPickup, sendDamageEvent, clearDamageEvent } = useMultiplayer(playerId);

  // Helper to re-sync vehicle occupancy if the player was in a vehicle in the loaded state
  const syncLoadedVehicle = (s: GameState) => {
    if (s.player.occupyingVehicleId) {
      const veh = s.vehicles.find(v => v.id === s.player.occupyingVehicleId);
      if (veh) {
        if (s.player.vehicleRole === 'passenger') {
          veh.passengerId = playerId;
        } else {
          veh.driverId = playerId;
          veh.engineOn = true;
        }
      }
    }
    return s;
  };

  // Build the initial state once. If we have a loaded save use it; otherwise use the
  // shared seed from RTDB (set when createWorld / joinWorld resolves) so all players
  // get the same procedural layout.
  const stateRef = useRef<GameState>(
    loadedState
      ? syncLoadedVehicle({ ...initState(worldSeed ?? undefined), ...loadedState, isPaused: false, keys: new Set(), touches: { joystick: null } })
      : initState(worldSeed ?? undefined)
  );

  // Guard to ensure state re-initializes when switching worlds or after receiving an authoritative seed
  const prevContext = useRef({ id: worldId, seed: worldSeed });
  if (worldId !== prevContext.current.id || worldSeed !== prevContext.current.seed) {
    prevContext.current = { id: worldId, seed: worldSeed };
    stateRef.current = loadedState
      ? syncLoadedVehicle({ ...initState(loadedState.worldSeed ?? worldSeed ?? undefined), ...loadedState, isPaused: false, keys: new Set(), touches: { joystick: null } })
      : initState(worldSeed ?? undefined);
  }

  const sfxRef = useRef<SFXCallback | null>(null);
  const [renderTick, setRenderTick] = useState(0);
  const [hudData, setHudData] = useState({
    precepts: stateRef.current.precepts,
    chaosLevel: 0, heatLevel: 0, rageMode: false,
    health: 150, maxHealth: 150, score: 0,
    stealthMode: false,
    activeDialogue: null as GameState['activeDialogue'],
    glitchIntensity: 0,
    playerDead: false, deathTimer: 0,
    nearBuilding: null as { name: string; type: BuildingType } | null,
    buildingWindowOpen: false,
    inventory: { cash: 200, weapons: [] as string[], activeWeapon: null as string | null },
    bossHealth: null as number | null,
    bossMaxHealth: null as number | null,
    bossActive: false,
    contacts: [] as Contact[],
    activeMission: null as Mission | null,
    arrestState: 'none' as GameState['arrestState'],
    arrestTimer: 0,
    jailTimer: 0,
    barFight: null as BarFightState | null,
    bodyguards: null as { entities: Entity[]; timer: number } | null,
    slotMachineOpen: false,
    hideTimer: 0,
    fullMapOpen: false,
    playerVehicle: null as { type: string; speedKmh: number; health: number; maxHealth: number } | null,
    nearVehicle: null as string | null,
  });

  useEffect(() => {
    if (stateRef.current) {
      stateRef.current.isHost = isHost;
      stateRef.current.syncPlayer = syncPlayer;
      stateRef.current.syncNPCs = syncNPCs;
      stateRef.current.syncItemPickup = syncItemPickup;
      stateRef.current.sendDamageEvent = sendDamageEvent;
      stateRef.current.clearDamageEvent = clearDamageEvent;
      stateRef.current.remotePlayers = remotePlayers;
      stateRef.current.remoteNPCs = remoteNPCs;
      stateRef.current.damageEvents = damageEvents;

      stateRef.current.remoteVehicles = remoteVehicles;
      stateRef.current.syncVehicles = syncVehicles;
      stateRef.current.updateVehicleSeat = updateVehicleSeat;
      stateRef.current.sendVehiclePhysics = sendVehiclePhysics;
    }
  }, [isHost, syncPlayer, syncNPCs, syncVehicles, updateVehicleSeat, sendVehiclePhysics, syncItemPickup, sendDamageEvent, clearDamageEvent, remotePlayers, remoteNPCs, remoteVehicles, damageEvents, playerId]);

  // Handle vehicle seat restoration on reload
  useEffect(() => {
    if (stateRef.current && stateRef.current.player.occupyingVehicleId && stateRef.current.player.vehicleRole) {
      const p = stateRef.current.player;
      const v = stateRef.current.vehicles.find(veh => veh.id === p.occupyingVehicleId);
      if (v) {
        if (p.vehicleRole === 'driver') {
          v.driverId = playerId;
          v.engineOn = true;
          updateVehicleSeat(v.id, 'driver', playerId);
        } else if (p.vehicleRole === 'passenger') {
          v.passengerId = playerId;
          updateVehicleSeat(v.id, 'passenger', playerId);
        }
      }
    }
  }, [playerId, updateVehicleSeat]);

  // Auto-save loop – tracks real wall-clock session time
  useEffect(() => {
    if (!worldId) return;
    sessionStartRef.current = Date.now();
    const interval = setInterval(() => {
      if (stateRef.current) {
        const sessionSeconds = (Date.now() - sessionStartRef.current) / 1000;
        saveWorld(worldId, worldName || 'Unknown World', stateRef.current, sessionSeconds);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [worldId, worldName]);

  // Remove items picked up by other players
  useEffect(() => {
    if (!stateRef.current || pickedUpItems.length === 0) return;
    const s = stateRef.current;
    const pickedUpSet = new Set(pickedUpItems);
    for (let i = s.entities.length - 1; i >= 0; i--) {
      const e = s.entities[i];
      if (e.type === 'item' && pickedUpSet.has(e.id)) {
        s.entities.splice(i, 1);
      }
    }
  }, [pickedUpItems]);

  const hostWorld = useCallback(async (playerName: string) => {
    const result = await createWorld(playerName, stateRef.current?.worldSeed);
    if (!result) return null;
    // The reactive guard at the top will re-init the state dynamically 
    // once useMultiplayer propagates the new worldSeed.
    setRenderTick(t => t + 1);
    return result.code;
  }, [createWorld]);

  const joinWorldAndApplySeed = useCallback(async (code: string, playerName: string) => {
    const seed = await joinWorld(code, playerName);
    if (seed === null) return false;
    // Re-init state with the host's seed before the game starts
    stateRef.current = initState(seed);
    return true;
  }, [joinWorld]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const attackCooldownRef = useRef<number>(0);
  // Wall-clock timestamp for the start of this play session (used for accurate playtime tracking)
  const sessionStartRef = useRef<number>(Date.now());
  const stealthCooldownRef = useRef<number>(0);
  const interactCooldownRef = useRef<number>(0);

  const setSFXCallback = useCallback((cb: SFXCallback) => {
    sfxRef.current = cb;
  }, []);

  // ── Input ────────────────────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Prevent tracking game keys if typing in an input field (like room code)
    if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
      return;
    }

    const s = stateRef.current;

    if (e.key === 'Escape') {
      if (s.buildingWindowOpen) { s.buildingWindowOpen = false; sfxRef.current?.('ui_close'); return; }
      if (s.slotMachineOpen) { s.slotMachineOpen = false; sfxRef.current?.('ui_close'); return; }
      s.fullMapOpen = !s.fullMapOpen;

      // Auto-pause in singleplayer
      if (!s.isHost && (!s.remotePlayers || Object.keys(s.remotePlayers).length === 0)) {
        s.isPaused = s.fullMapOpen;
      }

      sfxRef.current?.(s.fullMapOpen ? 'ui_open' : 'ui_close');
      return;
    }

    if (s.isPaused) return;

    s.keys.add(e.key?.toLowerCase?.() || '');
    if (e.key === ' ' || e.key === 'e' || e.key === 'f' || e.key === 'q' || e.key === 'r' || e.key === 'Enter') {
      e.preventDefault();
      if (e.key === 'Enter' || e.key === 'f') performInteract();
    }
  }, []);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    stateRef.current.keys.delete(e.key?.toLowerCase?.() || '');
  }, []);

  // ── Precept helper ─────────────────────────────────────────────────────────
  function addPrecept(key: PrecedeKey, amount: number) {
    const s = stateRef.current;
    s.precepts[key] = clamp(s.precepts[key] + amount, 0, 100);
    const total = Object.values(s.precepts).reduce((a, b) => a + b, 0);
    s.chaosLevel = clamp(total / 5, 0, 100);
    s.heatLevel = Math.min(5, Math.floor(s.chaosLevel / 20));
    s.glitchIntensity = s.chaosLevel / 100;
  }

  // ── Police Vision Check ──────────────────────────────────────────────────────
  const checkCrimesWitnessed = useCallback((s: GameState, p: Entity) => {
    let witnessed = false;
    const buildings = s.entities.filter(en => en.type === 'building');
    for (const e of s.entities) {
      if (e.type === 'cop' && e.aiState !== 'dead') {
        if (isInFOV(e, p, buildings)) {
          e.aiState = 'chase';
          e.lastSeenPlayer = { x: p.x, y: p.y };
          e.searchTimer = COP_SEARCH_DURATION;
          s.floatingTexts.push({ id: uid(), x: e.x, y: e.y - 20, text: '❗ WITNESSED CRIME', color: '#ff2233', life: 60, maxLife: 60, vy: -1 });
          witnessed = true;
        }
      }
    }
    if (witnessed) {
      addPrecept('misconduct', 20); // Adds exactly 1 Heat Level (20 Chaos)
    }
  }, []);

  // ── Action API ──────────────────────────────────────────────────────────────
  const performAttack = useCallback(() => {
    const s = stateRef.current;
    if (attackCooldownRef.current > 0 || s.activeDialogue || s.buildingWindowOpen || (s.player.stunTimer || 0) > 0 || s.playerDead || s.arrestState !== 'none' || s.slotMachineOpen) return;
    attackCooldownRef.current = 25;
    sfxRef.current?.('attack');

    const p = s.player;
    const weaponBonus = s.inventory.activeWeapon === 'plasma' ? 20 : s.inventory.activeWeapon === 'blade' ? 10 : s.inventory.activeWeapon === 'stungun' ? 5 : 0;
    const range = s.rageMode ? 70 : 55;
    let hit = false;

    // If in bar fight, attack bar fight enemies
    const targets = s.barFight?.active ? s.barFight.enemies : s.entities;

    for (const e of targets) {
      if ((e.type === 'npc' || e.type === 'cop' || e.type === 'boss') && e.aiState !== 'dead') {
        if (dist(p, e) < range) {
          const baseDmg = s.rageMode ? 30 + Math.random() * 20 : 15 + Math.random() * 10;
          const dmg = baseDmg + weaponBonus;
          e.health -= dmg;

          // Sync damage to host if client
          if (!s.isHost && s.sendDamageEvent) {
            s.sendDamageEvent(e.id, dmg);
          }

          const d = dist(p, e) || 1;
          e.vx += (e.x - p.x) / d * 4;
          e.vy += (e.y - p.y) / d * 4;
          s.floatingTexts.push({
            id: uid(), x: e.x + (Math.random() - 0.5) * 20, y: e.y - 20,
            text: `-${Math.round(dmg)}`, color: '#ff2233',
            life: 60, maxLife: 60, vy: -1.5,
          });

          if (e.type === 'npc' && !s.barFight?.active) e.aiState = 'flee';

          if (e.health <= 0) {
            e.health = 0;
            if (e.type === 'boss') {
              s.bossActive = false;
              s.bossDefeated = true;
              s.bossSpawnCooldown = 3600;
              s.score += 1000;
              s.inventory.cash += 500;
              s.floatingTexts.push({ id: uid(), x: e.x, y: e.y - 30, text: '★ BOSS DEFEATED ★', color: '#ffcc00', life: 180, maxLife: 180, vy: -1 });
              s.floatingTexts.push({ id: uid(), x: e.x, y: e.y - 50, text: '+$500 +1000 PTS', color: '#00ff88', life: 120, maxLife: 120, vy: -0.8 });
              for (const key of Object.keys(s.precepts) as PrecedeKey[]) {
                s.precepts[key] = Math.max(0, s.precepts[key] - 15);
              }
              const total = Object.values(s.precepts).reduce((a, b) => a + b, 0);
              s.chaosLevel = clamp(total / 5, 0, 100);
              s.heatLevel = Math.min(5, Math.floor(s.chaosLevel / 20));
              sfxRef.current?.('boss_defeat');
            }
            e.aiState = 'dead';
            s.floatingTexts.push({ id: uid(), x: e.x, y: e.y - 10, text: '† KO', color: '#ff4444', life: 90, maxLife: 90, vy: -1 });

            // Bar fight tracking
            if (s.barFight?.active) {
              s.barFight.defeated++;
            }
          }

          if (!s.barFight?.active) {
            addPrecept('violence', s.rageMode ? 6 : 3);
            checkCrimesWitnessed(s, p);
          }
          s.screenShake = Math.min(s.screenShake + 8, 20);
          hit = true;
          sfxRef.current?.('hit');
        }
      }
    }

    if (!hit) {
      s.floatingTexts.push({ id: uid(), x: p.x + Math.cos(p.facing) * 40, y: p.y + Math.sin(p.facing) * 40, text: 'MISS', color: '#666', life: 30, maxLife: 30, vy: -0.8 });
    }
  }, []);

  const performSteal = useCallback(() => {
    const s = stateRef.current;
    if (stealthCooldownRef.current > 0 || s.activeDialogue || s.buildingWindowOpen || s.playerDead || s.arrestState !== 'none' || s.slotMachineOpen) return;
    stealthCooldownRef.current = 60;
    sfxRef.current?.('steal');

    const p = s.player;
    for (const e of s.entities) {
      if (e.type === 'npc' && e.aiState !== 'dead' && e.hasItem && dist(p, e) < 70) {
        e.hasItem = false;
        const reward = 50 + Math.floor(Math.random() * 100);
        s.score += reward;
        s.inventory.cash += reward;
        addPrecept('theft', 8);
        checkCrimesWitnessed(s, p);
        s.floatingTexts.push({ id: uid(), x: e.x, y: e.y - 15, text: `+$${reward} STOLEN`, color: '#ff9900', life: 80, maxLife: 80, vy: -1.2 });
        e.aiState = 'flee';
        e.vx = (e.x - p.x) * 0.05;
        e.vy = (e.y - p.y) * 0.05;
        return;
      }
    }
    for (let i = s.entities.length - 1; i >= 0; i--) {
      const e = s.entities[i];
      if (e.type === 'item' && dist(p, e) < 50) {
        if (e.subtype === 'substance') {
          addPrecept('intoxication', 15);
          s.rageModeTimer = 600;
          s.rageMode = true;
          s.floatingTexts.push({ id: uid(), x: e.x, y: e.y - 15, text: '★ RAGE MODE ★', color: '#ff33aa', life: 90, maxLife: 90, vy: -1.5 });
          s.screenShake = 15;
        } else if (e.subtype === 'cash') {
          const reward = 30 + Math.floor(Math.random() * 70);
          s.score += reward;
          s.inventory.cash += reward;
          addPrecept('theft', 4);
          s.floatingTexts.push({ id: uid(), x: e.x, y: e.y - 15, text: `+$${reward}`, color: '#ffcc00', life: 60, maxLife: 60, vy: -1 });
        } else if (e.subtype === 'weapon') {
          s.floatingTexts.push({ id: uid(), x: e.x, y: e.y - 15, text: '⚔ ARMED', color: '#ff2233', life: 60, maxLife: 60, vy: -1 });
          s.score += 20;
          if (!s.inventory.weapons.includes('blade')) {
            s.inventory.weapons.push('blade');
            s.inventory.activeWeapon = 'blade';
          }
        }
        s.syncItemPickup?.(e.id);
        s.entities.splice(i, 1);
        return;
      }
    }
    s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 30, text: 'NOTHING NEARBY', color: '#444', life: 40, maxLife: 40, vy: -0.8 });
  }, []);

  const performInteract = useCallback(() => {
    const s = stateRef.current;
    if (interactCooldownRef.current > 0 || s.playerDead || s.arrestState !== 'none' || s.slotMachineOpen) return;

    if (s.buildingWindowOpen) {
      s.buildingWindowOpen = false;
      sfxRef.current?.('ui_close');
      return;
    }

    if (s.activeDialogue) { s.activeDialogue = null; return; }

    interactCooldownRef.current = 60;
    const p = s.player;

    if (s.activeInterior) {
      const tx = Math.floor(p.x / INTERIOR_TILE_SIZE);
      const ty = Math.floor(p.y / INTERIOR_TILE_SIZE);

      // Interior exit check
      if (s.activeInterior.tiles[ty]?.[tx] === 'exit') {
        const outside = s.activeInterior.playerOutsidePos;
        p.x = outside.x;
        p.y = outside.y;
        s.cameraX = outside.x;
        s.cameraY = outside.y;
        s.activeInterior = null;
        s.nearBuilding = null; 
        sfxRef.current?.('ui_close');
        s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 40, text: '🚪 EXITING BUILDING', color: '#ffcc00', life: 90, maxLife: 90, vy: -0.5 });
        return;
      }

      // Interior NPC interaction
      for (const n of s.activeInterior.npcs) {
        const nx = n.x * INTERIOR_TILE_SIZE;
        const ny = n.y * INTERIOR_TILE_SIZE;
        if (Math.hypot(nx - p.x, ny - p.y) < 90) {
          if (n.dialogue && n.dialogue.length > 0) {
            s.activeDialogue = {
              node: {
                id: n.id,
                speaker: n.name.toUpperCase(),
                text: n.dialogue[0],
                options: n.dialogue.length > 1 ? [{ label: 'Continue...', nextNodeId: 'next' }] : [{ label: 'Got it.', nextNodeId: 'end' }]
              },
              npcId: n.id
            };
            sfxRef.current?.('ui_open');
            return;
          }
        }
      }
      return; // Stop here if inside interior but no interaction triggered
    }

    // 1. Exit vehicle if inside
    const drivingVeh = s.vehicles.find(v => v.driverId === 'player' || v.driverId === playerId);
    const passengerVeh = s.vehicles.find(v => v.passengerId === 'player' || v.passengerId === playerId);
    const currentVeh = drivingVeh || passengerVeh;

    if (currentVeh) {
      if (currentVeh.driverId === 'player' || currentVeh.driverId === playerId) {
        currentVeh.driverId = null;
        currentVeh.engineOn = false;
        s.updateVehicleSeat?.(currentVeh.id, 'driver', null);
      } else {
        currentVeh.passengerId = null;
        s.updateVehicleSeat?.(currentVeh.id, 'passenger', null);
      }
      p.occupyingVehicleId = null;
      p.vehicleRole = null;

      // Calculate side exit position (perpendicular to car facing)
      const exitAngle = currentVeh.facing + Math.PI / 2;
      const safeDist = (currentVeh.width / 2) + (p.width / 2) + 20;
      p.x = currentVeh.x + Math.cos(exitAngle) * safeDist;
      p.y = currentVeh.y + Math.sin(exitAngle) * safeDist;

      // Stop player momentum so they don't slide into the car
      p.vx = 0;
      p.vy = 0;
      s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 40, text: '🚗 EXITED VEHICLE', color: '#00ccff', life: 90, maxLife: 90, vy: -0.5 });
      return;
    }

    // 2. Enter nearby vehicle
    let nearestVeh: Entity | null = null;
    let vehDist = 90;

    for (const v of s.vehicles) {
      // Can enter if either driver or passenger seat is empty
      if (v.driverId && v.passengerId) continue;
      const d = dist(p, v);
      if (d < vehDist) { vehDist = d; nearestVeh = v; }
    }

    if (nearestVeh) {
      p.occupyingVehicleId = nearestVeh.id;
      if (!nearestVeh.driverId) {
        nearestVeh.driverId = playerId;
        nearestVeh.engineOn = true;
        p.vehicleRole = 'driver';
        s.updateVehicleSeat?.(nearestVeh.id, 'driver', playerId);

        // One-time Chaos bonus for stealing any vehicle
        if (!nearestVeh.isStolen) {
          addPrecept('misconduct', 15); // +3% Chaos Engine

          // Instant Heat/Chaos when hijacking a police car
          if (nearestVeh.vehicleType === 'police_cruiser') {
            addPrecept('misconduct', 200); // 40% Chaos, 2 Heat levels
            s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 60, text: '🚨 POLICE VEHICLE HIJACKED', color: '#ff2233', life: 120, maxLife: 120, vy: -0.8 });
          }
          nearestVeh.isStolen = true;
        }

        s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 40, text: '🚗 DRIVING ' + (nearestVeh.vehicleType || 'VEHICLE').toUpperCase(), color: '#00ff88', life: 90, maxLife: 90, vy: -0.5 });
      } else {
        nearestVeh.passengerId = playerId;
        p.vehicleRole = 'passenger';
        s.updateVehicleSeat?.(nearestVeh.id, 'passenger', playerId);
        s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 40, text: '🚗 PASSENGER IN ' + (nearestVeh.vehicleType || 'VEHICLE').toUpperCase(), color: '#00ff88', life: 90, maxLife: 90, vy: -0.5 });
      }
      p.x = nearestVeh.x; p.y = nearestVeh.y;
      return;
    }

    // 3. Buildings
    if (s.nearBuilding && s.nearBuilding.entity.buildingType) {
      const bType = s.nearBuilding.entity.buildingType;
      if (bType && INTERIOR_LAYOUTS[bType]) {
        const layout = INTERIOR_LAYOUTS[bType];
        s.activeInterior = {
          ...layout,
          buildingId: s.nearBuilding.entity.id,
          playerOutsidePos: { x: p.x, y: p.y }
        };
        // Teleport to interior spawn
        p.x = layout.spawnX * INTERIOR_TILE_SIZE + INTERIOR_TILE_SIZE / 2;
        p.y = layout.spawnY * INTERIOR_TILE_SIZE + INTERIOR_TILE_SIZE / 2;
        p.vx = 0; p.vy = 0;
        s.cameraX = p.x;
        s.cameraY = p.y;
        s.nearBuilding = null; // Clear so we don't immediately interact again
        s.buildingWindowOpen = false;
        sfxRef.current?.('ui_open');
        return;
      }

      s.buildingWindowOpen = true;
      sfxRef.current?.('ui_open');
      return;
    }

    // 4. NPCs
    for (const e of s.entities) {
      if (e.type === 'npc' && e.aiState !== 'dead' && dist(p, e) < 90) {
        const tree = DIALOGUE_TREES[Math.floor(Math.random() * DIALOGUE_TREES.length)];
        const speakerMap: Record<string, string> = { civilian: 'STRANGER', merchant: 'MERCHANT' };
        const rootNode = { ...tree[0], speaker: (e.subtype && speakerMap[e.subtype]) || 'STRANGER', text: tree[0].text };
        addPrecept('misconduct', 2);
        s.activeDialogue = { node: rootNode, npcId: e.id };
        return;
      }
    }
    s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 30, text: 'NOTHING NEARBY', color: '#444', life: 40, maxLife: 40, vy: -0.8 });
  }, []);

  const chooseDialogueOption = useCallback((optionIndex: number) => {
    const s = stateRef.current;
    if (!s.activeDialogue) return;

    const option = s.activeDialogue.node.options[optionIndex];
    if (!option) return;

    if (option.isLie && option.consequence) {
      addPrecept(option.consequence, option.consequenceAmount || 10);
      s.score += 75;
      s.inventory.cash += 75;
      s.floatingTexts.push({ id: uid(), x: s.player.x, y: s.player.y - 40, text: '⚡ LIE SUCCEEDS', color: '#00ccff', life: 80, maxLife: 80, vy: -1.2 });
      if (option.result) {
        s.floatingTexts.push({ id: uid(), x: s.player.x, y: s.player.y - 60, text: option.result, color: '#00ffcc', life: 100, maxLife: 100, vy: -0.8 });
      }
    } else if (!option.isLie && option.consequence) {
      addPrecept(option.consequence, option.consequenceAmount || 6);
    }

    if (option.nextId === null) { s.activeDialogue = null; return; }

    if (option.nextId) {
      for (const tree of DIALOGUE_TREES) {
        const found = tree.find(n => n.id === option.nextId);
        if (found) { s.activeDialogue = { node: found, npcId: s.activeDialogue.npcId }; return; }
      }
    }
    s.activeDialogue = null;
  }, []);

  // ── Building action handler ─────────────────────────────────────────────────
  const handleBuildingAction = useCallback((action: BuildingAction) => {
    const s = stateRef.current;
    const p = s.player;

    if (action.cost && s.inventory.cash < action.cost) return;
    if (action.cost) s.inventory.cash -= action.cost;

    if (action.precept && action.preceptAmount) {
      addPrecept(action.precept as PrecedeKey, action.preceptAmount);
    }
    if (action.heatChange) {
      if (action.heatChange < 0) {
        const reduce = Math.abs(action.heatChange) * 10;
        for (const key of Object.keys(s.precepts) as PrecedeKey[]) {
          s.precepts[key] = Math.max(0, s.precepts[key] - reduce / 5);
        }
        const total = Object.values(s.precepts).reduce((a, b) => a + b, 0);
        s.chaosLevel = clamp(total / 5, 0, 100);
        s.heatLevel = Math.min(5, Math.floor(s.chaosLevel / 20));
      } else if (action.heatChange > 0) {
        addPrecept('misconduct', action.heatChange * 20); // 20 Chaos = 1 Heat
      }
    }
    if (action.healthChange) {
      p.health = Math.min(p.maxHealth, p.health + (action.healthChange === 999 ? p.maxHealth : action.healthChange));
    }
    if (action.scoreChange) {
      s.score = Math.max(0, s.score + action.scoreChange);
      if (action.scoreChange > 0) s.inventory.cash += action.scoreChange;
    }
    if (action.weapon && !s.inventory.weapons.includes(action.weapon)) {
      s.inventory.weapons.push(action.weapon);
      s.inventory.activeWeapon = action.weapon;
      s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 40, text: `⚔ ${action.weapon.toUpperCase()} EQUIPPED`, color: '#ff9900', life: 90, maxLife: 90, vy: -1 });
    }

    // Intoxication triggers rage mode
    if (action.precept === 'intoxication' && (action.preceptAmount || 0) >= 15) {
      s.rageModeTimer = 600;
      s.rageMode = true;
      s.screenShake = 15;
      s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 60, text: '★ RAGE MODE ★', color: '#ff33aa', life: 90, maxLife: 90, vy: -1.5 });
    }

    // Special actions
    if (action.label === 'Socialize') {
      // Generate a contact
      const contact = generateContact();
      // Avoid duplicates
      if (!s.contacts.find(c => c.name === contact.name)) {
        s.contacts.push(contact);
        s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 50, text: `📱 NEW CONTACT: ${contact.name}`, color: '#cc33ff', life: 120, maxLife: 120, vy: -1 });
      } else {
        s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 50, text: 'Already connected', color: '#666', life: 60, maxLife: 60, vy: -1 });
      }
    }

    if (action.label === 'Plan Heist') {
      if (!s.activeMission) {
        s.activeMission = createHeistMission(s.contacts);
        s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 50, text: '🗺 MISSION: THE BIG SCORE', color: '#ff9900', life: 150, maxLife: 150, vy: -0.8 });
      } else {
        s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 50, text: 'Mission already active', color: '#666', life: 60, maxLife: 60, vy: -1 });
      }
    }

    if (action.label === 'Free Prisoners') {
      const bgs: Entity[] = [];
      const num = 2 + Math.floor(Math.random() * 2); // 2 or 3 bodyguards
      for (let i = 0; i < num; i++) {
        bgs.push({
          id: uid(),
          x: p.x + (Math.random() - 0.5) * 60,
          y: p.y + (Math.random() - 0.5) * 60,
          vx: 0, vy: 0,
          width: 24, height: 24,
          health: 150, maxHealth: 150,
          type: 'npc',
          aiState: 'bodyguard',
          color: '#ff6600', glowColor: '#ff9900',
          facing: Math.random() * Math.PI * 2,
          name: 'INMATE'
        });
      }

      // Inject bodyguards into main global entity list so they are synced to Firebase
      s.entities.push(...bgs);

      // Set timer to 18000 frames (5 minutes at 60fps)
      s.bodyguards = { entities: bgs, timer: 18000 };
      s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 50, text: '⛓ PRISONERS FREED (Bodyguards Hired)', color: '#ff2233', life: 120, maxLife: 120, vy: -1 });
    }

    if (action.label === 'Surrender') {
      s.inventory.weapons = [];
      s.inventory.activeWeapon = null;
      s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 50, text: '⚖ SURRENDERED (Weapons Confiscated)', color: '#3377ff', life: 120, maxLife: 120, vy: -1 });
    }

    if (action.label === 'Gamble') {
      // Open slot machine instead of instant gamble
      s.slotMachineOpen = true;
      s.buildingWindowOpen = false;
      sfxRef.current?.('ui_open');
      return; // Don't close building window via normal flow
    }

    if (action.label === 'Bar Fight') {
      // Start bar fight instance
      const enemies = spawnBarFightEnemies();
      s.barFight = {
        active: true,
        enemies,
        timer: 1800, // 30 seconds
        playerStartPos: { x: p.x, y: p.y },
        defeated: 0,
        total: enemies.length,
      };
      // Teleport player to fight arena (center of map)
      p.x = WORLD_W / 2;
      p.y = WORLD_H / 2;
      s.cameraX = p.x;
      s.cameraY = p.y;
      s.buildingWindowOpen = false;
      s.screenShake = 10;
      sfxRef.current?.('fight_start');
      s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 50, text: '👊 BAR FIGHT!', color: '#ff4444', life: 120, maxLife: 120, vy: -1 });
      return;
    }

    // Mission objective tracking
    if (s.activeMission && s.activeMission.status === 'active') {
      const m = s.activeMission;
      // Check gather objective (buying weapons at Karma Mart)
      if (action.weapon) {
        const gatherObj = m.objectives.find(o => o.type === 'gather' && !o.done);
        if (gatherObj) {
          gatherObj.done = true;
          gatherObj.progress = 1;
          s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 70, text: '✓ EQUIPMENT ACQUIRED', color: '#00ff88', life: 100, maxLife: 100, vy: -1 });
        }
      }
      // Check recruit objective (socializing)
      if (action.label === 'Socialize') {
        const recruitObj = m.objectives.find(o => o.type === 'recruit' && !o.done);
        if (recruitObj && s.contacts.length > 0) {
          recruitObj.done = true;
          recruitObj.progress = 1;
          s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 70, text: '✓ CREW RECRUITED', color: '#00ff88', life: 100, maxLife: 100, vy: -1 });
        }
      }
      // Check travel objective (visiting corp office)
      if (s.nearBuilding?.entity.buildingType === 'corporate') {
        const travelObj = m.objectives.find(o => o.type === 'travel' && !o.done);
        if (travelObj) {
          travelObj.done = true;
          travelObj.progress = 1;
          s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 70, text: '✓ TARGET SCOUTED', color: '#00ff88', life: 100, maxLife: 100, vy: -1 });
        }
      }
    }

    const texts: string[] = [];
    if (action.cost) texts.push(`-$${action.cost}`);
    if (action.healthChange && action.healthChange > 0) texts.push(`+${action.healthChange === 999 ? 'MAX' : action.healthChange} HP`);
    if (texts.length) {
      s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 30, text: texts.join(' '), color: '#00ff88', life: 80, maxLife: 80, vy: -1.2 });
    }

    sfxRef.current?.('purchase');
    s.screenShake = Math.min(s.screenShake + 3, 10);
    s.buildingWindowOpen = false;
    sfxRef.current?.('ui_close');
  }, []);

  const closeBuildingWindow = useCallback(() => {
    stateRef.current.buildingWindowOpen = false;
    sfxRef.current?.('ui_close');
  }, []);

  // ── Arrest system handlers ──────────────────────────────────────────────────
  const handleBribe = useCallback(() => {
    const s = stateRef.current;
    if (s.arrestState !== 'caught') return;
    const cop = s.arrestingCop;
    const bribeCost = Math.floor(s.inventory.cash * 0.5);

    if (s.inventory.cash >= bribeCost) {
      s.inventory.cash -= bribeCost;
      s.arrestState = 'none';
      s.arrestingCop = null;
      // Completely wipe heat & chaos
      for (const key of Object.keys(s.precepts) as PrecedeKey[]) {
        s.precepts[key] = 0;
      }
      s.chaosLevel = 0;
      s.heatLevel = 0;
      s.glitchIntensity = 0;
      // Make cop corrupt temporarily
      if (cop) cop.aiState = 'patrol';
      // Remove some cops
      const copsToRemove = s.entities.filter(e => e.type === 'cop' && e.aiState === 'chase');
      for (const c of copsToRemove.slice(0, 2)) { c.aiState = 'patrol'; c.lastSeenPlayer = null; }
      s.floatingTexts.push({ id: uid(), x: s.player.x, y: s.player.y - 40, text: `💰 BRIBED -$${bribeCost}`, color: '#ffcc00', life: 90, maxLife: 90, vy: -1 });
    } else {
      // Can't afford, go to jail
      s.arrestState = 'jailed';
      s.jailTimer = 300; // 5 seconds
      sfxRef.current?.('jail');
      s.floatingTexts.push({ id: uid(), x: s.player.x, y: s.player.y - 40, text: 'CAN\'T AFFORD BRIBE', color: '#ff2233', life: 60, maxLife: 60, vy: -1 });
    }
  }, []);

  const handleGoToJail = useCallback(() => {
    const s = stateRef.current;
    s.arrestState = 'jailed';
    s.jailTimer = 300;
    sfxRef.current?.('jail');
  }, []);

  const handleResistArrest = useCallback(() => {
    const s = stateRef.current;
    s.arrestState = 'none';
    s.arrestingCop = null;
    addPrecept('violence', 15);
    addPrecept('misconduct', 10);
    s.floatingTexts.push({ id: uid(), x: s.player.x, y: s.player.y - 40, text: '⚡ RESISTING ARREST!', color: '#ff2233', life: 90, maxLife: 90, vy: -1 });
    // All cops now aggro
    for (const e of s.entities) {
      if (e.type === 'cop' && e.aiState !== 'dead') {
        e.aiState = 'chase';
        e.lastSeenPlayer = { x: s.player.x, y: s.player.y };
      }
    }
  }, []);

  // ── Slot Machine ────────────────────────────────────────────────────────────
  const handleSlotResult = useCallback((won: boolean, amount: number) => {
    const s = stateRef.current;
    if (won) {
      s.inventory.cash += amount;
      s.score += amount;
      s.floatingTexts.push({ id: uid(), x: s.player.x, y: s.player.y - 40, text: `🎰 WON $${amount}!`, color: '#ffcc00', life: 120, maxLife: 120, vy: -1 });
      sfxRef.current?.('slot_win');
    } else {
      s.inventory.cash = Math.max(0, s.inventory.cash - amount);
      s.floatingTexts.push({ id: uid(), x: s.player.x, y: s.player.y - 40, text: `🎰 LOST $${amount}`, color: '#ff2233', life: 80, maxLife: 80, vy: -1 });
      sfxRef.current?.('slot_lose');
    }
    addPrecept('intoxication', 3);
  }, []);

  const closeSlotMachine = useCallback(() => {
    stateRef.current.slotMachineOpen = false;
    sfxRef.current?.('ui_close');
  }, []);

  // ── AI Update ───────────────────────────────────────────────────────────────
  function updateAI(e: Entity, s: GameState) {
    if (e.type === 'building' || e.type === 'item') return;
    if (e.aiState === 'dead') { e.vx *= 0.8; e.vy *= 0.8; return; }

    const p = s.player;
    const d = dist(e, p);
    e.aiTimer = (e.aiTimer || 0) - 1;

    if (e.stunTimer && e.stunTimer > 0) { e.stunTimer--; e.vx *= 0.7; e.vy *= 0.7; return; }

    // Boss AI
    if (e.type === 'boss') {
      const chaseSpd = 2.5 + (e.bossPhase || 1) * 0.3;
      const ang = angle(e, p);
      e.dashTimer = (e.dashTimer || 0) - 1;
      if (d < 300 && d > 80 && (e.dashTimer || 0) <= 0) {
        e.vx = Math.cos(ang) * 8;
        e.vy = Math.sin(ang) * 8;
        e.dashTimer = 120 + Math.random() * 60;
        s.floatingTexts.push({ id: uid(), x: e.x, y: e.y - 30, text: '⚡ DASH', color: '#ff0044', life: 40, maxLife: 40, vy: -1 });
      } else {
        e.vx += Math.cos(ang) * 0.35;
        e.vy += Math.sin(ang) * 0.35;
        const spd = Math.hypot(e.vx, e.vy);
        if (spd > chaseSpd) { e.vx = (e.vx / spd) * chaseSpd; e.vy = (e.vy / spd) * chaseSpd; }
      }
      e.facing = ang;
      if (d < 45) {
        if ((e.aiTimer || 0) <= 0) {
          const dmg = 15 + Math.random() * 10 + (e.bossPhase || 1) * 3;
          s.player.health -= dmg;
          s.player.health = Math.max(0, s.player.health);
          s.screenShake = Math.min(s.screenShake + 15, 25);
          s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 20, text: `CRUSHED -${Math.round(dmg)}`, color: '#ff0044', life: 60, maxLife: 60, vy: -1 });
          e.aiTimer = 45;
        }
      }
      if (e.health < e.maxHealth * 0.5 && (e.bossPhase || 1) < 2) {
        e.bossPhase = 2;
        s.floatingTexts.push({ id: uid(), x: e.x, y: e.y - 40, text: '⚠ PHASE 2 ⚠', color: '#ff3366', life: 120, maxLife: 120, vy: -0.8 });
        s.screenShake = 20;
      }
      return;
    }

    // ── Cop AI with vision cone ──────────────────────────────────────────────
    if (e.type === 'cop') {
      if (s.playerDead || s.arrestState !== 'none') { e.vx *= 0.9; e.vy *= 0.9; return; }

      const buildings = s.entities.filter(en => en.type === 'building');
      const canSeePlayer = isInFOV(e, p, buildings);
      const chaseSpd = 1.8 + s.heatLevel * 0.4;

      if (e.aiState === 'patrol') {
        // Patrol: wander around, turn to scan
        if ((e.aiTimer || 0) <= 0) {
          e.aiTarget = {
            x: clamp(e.x + (Math.random() - 0.5) * 300, 50, WORLD_W - 50),
            y: clamp(e.y + (Math.random() - 0.5) * 300, 50, WORLD_H - 50),
          };
          e.aiTimer = 120 + Math.random() * 180;
        }
        if (e.aiTarget) {
          const toTarget = angle(e, e.aiTarget);
          e.vx += Math.cos(toTarget) * 0.12;
          e.vy += Math.sin(toTarget) * 0.12;
          const spd = Math.hypot(e.vx, e.vy);
          if (spd > 1.2) { e.vx = (e.vx / spd) * 1.2; e.vy = (e.vy / spd) * 1.2; }
          e.facing = toTarget;
        }

        // Detect player in FOV
        if (canSeePlayer && s.heatLevel >= 1) {
          e.aiState = 'chase';
          e.lastSeenPlayer = { x: p.x, y: p.y };
          s.floatingTexts.push({ id: uid(), x: e.x, y: e.y - 20, text: '❗ SPOTTED', color: '#ff2233', life: 40, maxLife: 40, vy: -1 });
        }
        return;
      }

      if (e.aiState === 'chase') {
        if (canSeePlayer) {
          e.lastSeenPlayer = { x: p.x, y: p.y };
          e.searchTimer = COP_SEARCH_DURATION;
          const ang = angle(e, p);
          e.vx += Math.cos(ang) * 0.3;
          e.vy += Math.sin(ang) * 0.3;
          const spd = Math.hypot(e.vx, e.vy);
          if (spd > chaseSpd) { e.vx = (e.vx / spd) * chaseSpd; e.vy = (e.vy / spd) * chaseSpd; }
          e.facing = ang;

          // Arrest check: cop is close enough
          if (d < 30 && s.arrestState === 'none') {
            s.arrestState = 'caught';
            s.arrestingCop = e;
            s.arrestTimer = 300; // 5 seconds to decide
            sfxRef.current?.('arrest');
            s.player.vx = 0; s.player.vy = 0;
            return;
          }

          // Cop attacks player
          if (d < 35 && (e.aiTimer || 0) <= 0) {
            const dmg = 8 + Math.random() * 5;
            s.player.health -= dmg;
            s.player.health = Math.max(0, s.player.health);
            s.screenShake = Math.min(s.screenShake + 10, 20);
            s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 20, text: `TASED -${Math.round(dmg)}`, color: '#3377ff', life: 60, maxLife: 60, vy: -1 });
            e.aiTimer = 60;
          }
        } else {
          // Lost sight, enter search
          e.aiState = 'search';
          e.searchTimer = COP_SEARCH_DURATION;
        }
        return;
      }

      if (e.aiState === 'search') {
        e.searchTimer = (e.searchTimer || 0) - 1;
        // Move toward last known position
        if (e.lastSeenPlayer) {
          const ang = angle(e, e.lastSeenPlayer);
          e.vx += Math.cos(ang) * 0.15;
          e.vy += Math.sin(ang) * 0.15;
          const spd = Math.hypot(e.vx, e.vy);
          if (spd > 1.5) { e.vx = (e.vx / spd) * 1.5; e.vy = (e.vy / spd) * 1.5; }
          e.facing += 0.03; // Scan around

          if (dist(e, e.lastSeenPlayer) < 30) {
            e.lastSeenPlayer = null; // Reached last known pos
          }
        }

        // Re-detect player
        if (canSeePlayer) {
          e.aiState = 'chase';
          e.lastSeenPlayer = { x: p.x, y: p.y };
          e.searchTimer = COP_SEARCH_DURATION;
          return;
        }

        if ((e.searchTimer || 0) <= 0) {
          e.aiState = 'patrol';
          e.lastSeenPlayer = null;
          s.floatingTexts.push({ id: uid(), x: e.x, y: e.y - 20, text: '? LOST TARGET', color: '#3377ff', life: 50, maxLife: 50, vy: -1 });
        }
        return;
      }

      // Fallback: chase directly (backwards compat)
      const ang = angle(e, p);
      e.vx += Math.cos(ang) * 0.3;
      e.vy += Math.sin(ang) * 0.3;
      const spd = Math.hypot(e.vx, e.vy);
      if (spd > chaseSpd) { e.vx = (e.vx / spd) * chaseSpd; e.vy = (e.vy / spd) * chaseSpd; }
      e.facing = ang;
      return;
    }

    // NPC AI
    if (e.aiState === 'flee') {
      if (d > 250) { e.aiState = 'wander'; return; }
      const ang = angle(p, e);
      e.vx += Math.cos(ang) * 0.4;
      e.vy += Math.sin(ang) * 0.4;
      const spd = Math.hypot(e.vx, e.vy);
      if (spd > 2.2) { e.vx = (e.vx / spd) * 2.2; e.vy = (e.vy / spd) * 2.2; }
      e.facing = ang;
      return;
    }

    if (e.aiState === 'wander') {
      if ((e.aiTimer || 0) <= 0) {
        e.aiTarget = {
          x: clamp(e.x + (Math.random() - 0.5) * 200, 50, WORLD_W - 50),
          y: clamp(e.y + (Math.random() - 0.5) * 200, 50, WORLD_H - 50),
        };
        e.aiTimer = 60 + Math.random() * 120;
      }
      if (e.aiTarget) {
        const toTarget = angle(e, e.aiTarget);
        e.vx += Math.cos(toTarget) * 0.1;
        e.vy += Math.sin(toTarget) * 0.1;
        const spd = Math.hypot(e.vx, e.vy);
        if (spd > 1.0) { e.vx = (e.vx / spd) * 1.0; e.vy = (e.vy / spd) * 1.0; }
        e.facing = toTarget;
      }
      if (s.rageMode && d < 160) { e.aiState = 'flee'; }
    }

    // Bar fight brawler AI
    if (e.subtype === 'brawler' && e.aiState === 'chase') {
      const ang = angle(e, p);
      e.vx += Math.cos(ang) * 0.25;
      e.vy += Math.sin(ang) * 0.25;
      const spd = Math.hypot(e.vx, e.vy);
      if (spd > 2.0) { e.vx = (e.vx / spd) * 2.0; e.vy = (e.vy / spd) * 2.0; }
      e.facing = ang;

      if (d < 35 && (e.aiTimer || 0) <= 0) {
        const dmg = 5 + Math.random() * 8;
        s.player.health -= dmg;
        s.player.health = Math.max(0, s.player.health);
        s.screenShake = Math.min(s.screenShake + 5, 15);
        s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 20, text: `PUNCHED -${Math.round(dmg)}`, color: '#ff4444', life: 40, maxLife: 40, vy: -1 });
        e.aiTimer = 50;
      }
    }
  }

  // ── Physics ─────────────────────────────────────────────────────────────────
  function resolveCollisions(entities: Entity[]) {
    const alive = entities.filter(e => e.type !== 'building' && e.aiState !== 'dead');
    const buildings = entities.filter(e => e.type === 'building');
    const vehicles = entities.filter(e => e.type === 'vehicle');

    for (const e of alive) {
      e.x = clamp(e.x, e.width / 2, WORLD_W - e.width / 2);
      e.y = clamp(e.y, e.height / 2, WORLD_H - e.height / 2);

      // Distance-based culling for buildings: only check buildings within a reasonable range
      for (const b of buildings) {
        if (Math.abs(e.x - b.x) > 300 || Math.abs(e.y - b.y) > 300) continue;
        
        const ol = e.x - e.width / 2 < b.x + b.width && e.x + e.width / 2 > b.x;
        const ot = e.y - e.height / 2 < b.y + b.height && e.y + e.height / 2 > b.y;
        if (ol && ot) {
          const dLeft = (e.x + e.width / 2) - b.x;
          const dRight = (b.x + b.width) - (e.x - e.width / 2);
          const dTop = (e.y + e.height / 2) - b.y;
          const dBottom = (b.y + b.height) - (e.y - e.height / 2);
          const minD = Math.min(dLeft, dRight, dTop, dBottom);
          if (minD === dLeft) { e.x -= dLeft; e.vx = 0; }
          else if (minD === dRight) { e.x += dRight; e.vx = 0; }
          else if (minD === dTop) { e.y -= dTop; e.vy = 0; }
          else { e.y += dBottom; e.vy = 0; }
        }
      }

      // ── Entity-to-Vehicle Collisions (Simplified) ──────────────────────────
      for (const v of vehicles) {
        if (e.type === 'player' && e.occupyingVehicleId === v.id) continue;
        const radius = v.width / 2;
        const eRadius = e.width / 2;
        const dx = e.x - v.x;
        const dy = e.y - v.y;
        const distSq = dx * dx + dy * dy;
        const minRadius = radius + eRadius;

        if (distSq < minRadius * minRadius && distSq > 0.001) {
          const distance = Math.sqrt(distSq);
          const overlap = minRadius - distance;
          const nx = dx / distance;
          const ny = dy / distance;
          const pushOutForce = 0.5; // Original damping
          e.x += nx * overlap * pushOutForce;
          e.y += ny * overlap * pushOutForce;
        }
      }
    }

    // Reverted Vehicle-to-Vehicle Collisions
    for (let i = 0; i < vehicles.length; i++) {
      for (let j = i + 1; j < vehicles.length; j++) {
        const v1 = vehicles[i];
        const v2 = vehicles[j];
        if (dist(v1, v2) < (v1.width + v2.width) / 2) {
          const dx = v2.x - v1.x;
          const dy = v2.y - v1.y;
          const d = Math.hypot(dx, dy) || 1;
          v1.x -= (dx / d) * 2;
          v1.y -= (dy / d) * 2;
          v2.x += (dx / d) * 2;
          v2.y += (dy / d) * 2;
        }
      }
    }
  }

  // ── Main Update Loop ─────────────────────────────────────────────────────────
  const update = useCallback((timestamp: number) => {
    const dt = Math.min((timestamp - lastTimeRef.current) / 16.67, 3);
    lastTimeRef.current = timestamp;

    const s = stateRef.current;
    s.gameTime += dt;

    const p = s.player;
    const keys = s.keys;

    // ── Interior Loop ──────────────────────────────────────────────────────────
    if (s.activeInterior) {
      let dx = 0, dy = 0;
      if (keys.has('w') || keys.has('arrowup')) dy -= 1;
      if (keys.has('s') || keys.has('arrowdown')) dy += 1;
      if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
      if (keys.has('d') || keys.has('arrowright')) dx += 1;
      if (s.touches.joystick) { dx += s.touches.joystick.x; dy += s.touches.joystick.y; }

      if (Math.hypot(dx, dy) > 0) {
        const len = Math.hypot(dx, dy);
        dx /= len; dy /= len;
        const spd = PLAYER_SPEED * 0.8 * dt; // Slightly slower interior
        const nextX = p.x + dx * spd;
        const nextY = p.y + dy * spd;

        const tx = Math.floor(nextX / INTERIOR_TILE_SIZE);
        const ty = Math.floor(nextY / INTERIOR_TILE_SIZE);
        const tileAt = s.activeInterior.tiles[ty]?.[tx];

        if (tileAt && tileAt !== 'wall' && tileAt !== 'jail_bars') {
          // Furniture collision
          let furnHit = false;
          for (const f of s.activeInterior.furniture) {
            const fx = f.x * INTERIOR_TILE_SIZE;
            const fy = f.y * INTERIOR_TILE_SIZE;
            const fw = f.width * INTERIOR_TILE_SIZE;
            const fh = f.height * INTERIOR_TILE_SIZE;
            if (nextX > fx && nextX < fx + fw && nextY > fy && nextY < fy + fh) {
              furnHit = true; break;
            }
          }
          if (!furnHit) {
            p.x = nextX; p.y = nextY;
          }
        }
        p.facing = Math.atan2(dy, dx);
      } else {
        p.vx = 0; p.vy = 0;
      }

      s.cameraX += (p.x - s.cameraX) * 0.1;
      s.cameraY += (p.y - s.cameraY) * 0.1;

      // NPC AI in interiors
      for (const n of s.activeInterior.npcs) {
        // Skip dead/static NPCs if applicable (none for now)
        n.aiTimer = (n.aiTimer || 0) - dt;
        
        // Pick new target
        if (n.aiTimer <= 0) {
          const range = 4; // grid units
          const tx = Math.floor(clamp(n.x + (Math.random() - 0.5) * range * 2, 1, s.activeInterior.width - 2));
          const ty = Math.floor(clamp(n.y + (Math.random() - 0.5) * range * 2, 1, s.activeInterior.height - 2));
          
          // Only target floor tiles
          if (s.activeInterior.tiles[ty]?.[tx] === 'floor') {
            n.aiTarget = { x: tx + 0.5, y: ty + 0.5 };
            n.aiTimer = 180 + Math.random() * 240; // 3-7 seconds
          } else {
            n.aiTimer = 30; // Retry soon if picked a wall
          }
        }

        // Move toward target
        if (n.aiTarget) {
          const dx = n.aiTarget.x - n.x;
          const dy = n.aiTarget.y - n.y;
          const d = Math.hypot(dx, dy);
          
          if (d > 0.1) {
            const angle = Math.atan2(dy, dx);
            const spd = 0.03 * dt; // fractional grid units per frame
            const lux = Math.cos(angle) * spd;
            const luy = Math.sin(angle) * spd;
            
            const nextX = n.x + lux;
            const nextY = n.y + luy;
            
            // Basic collision against walls
            const tx = Math.floor(nextX);
            const ty = Math.floor(nextY);
            const tileAt = s.activeInterior.tiles[ty]?.[tx];
            
            if (tileAt === 'floor') {
              // Furniture collision
              let furnHit = false;
              for (const f of s.activeInterior.furniture) {
                if (nextX > f.x && nextX < f.x + f.width && nextY > f.y && nextY < f.y + f.height) {
                  furnHit = true; break;
                }
              }
              if (!furnHit) {
                n.x = nextX; n.y = nextY;
                n.facing = angle;
              } else {
                n.aiTarget = null; n.aiTimer = 60; // Pick new target
              }
            } else {
              n.aiTarget = null; n.aiTimer = 60;
            }
          } else {
            n.aiTarget = null; // Reached target
          }
        }
      }

      // Update timers/effects
      if (interactCooldownRef.current > 0) interactCooldownRef.current -= dt;
      for (let i = s.floatingTexts.length - 1; i >= 0; i--) {
        const ft = s.floatingTexts[i];
        ft.life -= dt; ft.y += ft.vy;
        if (ft.life <= 0) s.floatingTexts.splice(i, 1);
      }

      setRenderTick(t => t + 1);
      if (Math.floor(s.gameTime) % 10 === 0) setHudData(prev => buildHudData(s, prev));
      animFrameRef.current = requestAnimationFrame(update);
      return;
    }

    // ── Player death handling ──────────────────────────────────────────────────
    if (!s.playerDead && p.health <= 0) {
      s.playerDead = true;
      s.deathTimer = 180;
      s.rageMode = false;
      s.rageModeTimer = 0;
      s.activeDialogue = null;
      s.buildingWindowOpen = false;
      s.arrestState = 'none';
      s.arrestingCop = null;
      s.barFight = null;
      s.bodyguards = null;
      s.slotMachineOpen = false;
      s.screenShake = 25;
      p.health = 0;
      p.vx = 0; p.vy = 0;
      s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 40, text: '† YOU DIED †', color: '#ff2233', life: 180, maxLife: 180, vy: -0.5 });
      sfxRef.current?.('death');
    }

    if (s.playerDead) {
      s.deathTimer -= dt;
      p.vx = 0; p.vy = 0;
      if (s.screenShake > 0) s.screenShake -= 0.5 * dt;

      if (s.deathTimer <= 0) {
        s.playerDead = false;
        p.health = p.maxHealth;
        const safehouses = s.entities.filter(e => e.buildingType === 'safehouse');
        if (safehouses.length > 0) {
          const sh = safehouses[0];
          p.x = sh.x + sh.width / 2;
          p.y = sh.y + sh.height + 40;
        } else {
          p.x = WORLD_W / 2; p.y = WORLD_H / 2;
        }
        p.vx = 0; p.vy = 0;
        s.cameraX = p.x; s.cameraY = p.y;
        s.entities = s.entities.filter(e => e.type !== 'cop' && e.type !== 'boss');
        s.copCount = 0;
        s.copSpawnTimer = 300;
        s.bossActive = false;
        for (const key of Object.keys(s.precepts) as PrecedeKey[]) {
          s.precepts[key] = Math.max(0, s.precepts[key] - 20);
        }
        const total = Object.values(s.precepts).reduce((a, b) => a + b, 0);
        s.chaosLevel = clamp(total / 5, 0, 100);
        s.heatLevel = Math.min(5, Math.floor(s.chaosLevel / 20));
        s.glitchIntensity = s.chaosLevel / 100;
        s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 50, text: '↑ RESPAWNED ↑', color: '#00ff88', life: 120, maxLife: 120, vy: -0.8 });
      }

      for (let i = s.floatingTexts.length - 1; i >= 0; i--) {
        const ft = s.floatingTexts[i];
        ft.life -= dt;
        ft.y += ft.vy;
        if (ft.life <= 0) s.floatingTexts.splice(i, 1);
      }

      setRenderTick(t => t + 1);
      if (Math.floor(s.gameTime) % 10 === 0) {
        const boss = s.entities.find(e => e.type === 'boss' && e.aiState !== 'dead');
        setHudData(prev => buildHudData(s, prev));
      }
      animFrameRef.current = requestAnimationFrame(update);
      return;
    }

    if (s.isPaused) {
      // Render HUD strictly to allow UI interactions/unpause displaying
      setRenderTick(t => t + 1);
      setHudData(prev => buildHudData(s, prev));
      animFrameRef.current = requestAnimationFrame(update);
      return;
    }

    // ── Arrest state handling ──────────────────────────────────────────────────
    if (s.arrestState === 'caught') {
      p.vx = 0; p.vy = 0;
      s.arrestTimer -= dt;
      if (s.arrestTimer <= 0) {
        // Auto jail if timer runs out
        s.arrestState = 'jailed';
        s.jailTimer = 300;
      }
      // Still update render
      setRenderTick(t => t + 1);
      setHudData(prev => buildHudData(s, prev));
      // Update floating texts
      for (let i = s.floatingTexts.length - 1; i >= 0; i--) {
        const ft = s.floatingTexts[i];
        ft.life -= dt; ft.y += ft.vy;
        if (ft.life <= 0) s.floatingTexts.splice(i, 1);
      }
      animFrameRef.current = requestAnimationFrame(update);
      return;
    }

    if (s.arrestState === 'jailed') {
      p.vx = 0; p.vy = 0;
      s.jailTimer -= dt;
      if (s.jailTimer <= 0) {
        // Jail release
        const previousHeat = s.heatLevel;
        s.arrestState = 'none';
        s.arrestingCop = null;

        // Penalties (scales with heat)
        const heatTier = Math.max(1, previousHeat); // If heat is somehow 0, fallback to 1 logic
        const finePercent = Math.min(1.0, 0.2 * heatTier); // Level 1 = 20%, Level 5 = 100%
        s.inventory.cash = Math.floor(s.inventory.cash * (1 - finePercent));
        s.inventory.weapons = [];
        s.inventory.activeWeapon = null;

        // Completely wipe heat & chaos
        for (const key of Object.keys(s.precepts) as PrecedeKey[]) {
          s.precepts[key] = 0;
        }
        s.chaosLevel = 0;
        s.heatLevel = 0;
        s.glitchIntensity = 0;

        // Teleport to police station
        const station = s.entities.find(e => e.buildingType === 'police_station');
        if (station) {
          p.x = station.x + station.width / 2;
          p.y = station.y + station.height + 40;
        }
        s.cameraX = p.x; s.cameraY = p.y;

        // Remove chasing cops
        s.entities = s.entities.filter(e => e.type !== 'cop' || e.aiState !== 'chase');
        s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 50, text: '🔓 RELEASED FROM JAIL', color: '#3377ff', life: 120, maxLife: 120, vy: -0.8 });
        s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 70, text: `-${Math.round(finePercent * 100)}% CASH · WEAPONS CONFISCATED`, color: '#ff9900', life: 120, maxLife: 120, vy: -0.6 });
      }
      setRenderTick(t => t + 1);
      setHudData(prev => buildHudData(s, prev));
      for (let i = s.floatingTexts.length - 1; i >= 0; i--) {
        const ft = s.floatingTexts[i];
        ft.life -= dt; ft.y += ft.vy;
        if (ft.life <= 0) s.floatingTexts.splice(i, 1);
      }
      animFrameRef.current = requestAnimationFrame(update);
      return;
    }

    // ── Bar fight update ──────────────────────────────────────────────────────
    if (s.barFight?.active) {
      s.barFight.timer -= dt;
      // Update bar fight enemies
      for (const enemy of s.barFight.enemies) {
        if (enemy.aiState !== 'dead') {
          updateAI(enemy, s);
          enemy.x += enemy.vx;
          enemy.y += enemy.vy;
          enemy.x = clamp(enemy.x, WORLD_W / 2 - 150, WORLD_W / 2 + 150);
          enemy.y = clamp(enemy.y, WORLD_H / 2 - 150, WORLD_H / 2 + 150);
        }
      }

      // Check win/lose
      if (s.barFight.defeated >= s.barFight.total) {
        // Victory
        const reward = 200 + s.barFight.total * 50;
        s.inventory.cash += reward;
        s.score += reward;
        addPrecept('violence', 12);
        s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 50, text: `👊 BAR FIGHT WON! +$${reward}`, color: '#ffcc00', life: 120, maxLife: 120, vy: -1 });
        // Return player
        p.x = s.barFight.playerStartPos.x;
        p.y = s.barFight.playerStartPos.y;
        s.cameraX = p.x; s.cameraY = p.y;
        s.barFight = null;
      } else if (s.barFight.timer <= 0) {
        // Time out = lose
        s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 50, text: '👊 BAR FIGHT LOST', color: '#ff2233', life: 80, maxLife: 80, vy: -1 });
        p.x = s.barFight.playerStartPos.x;
        p.y = s.barFight.playerStartPos.y;
        s.cameraX = p.x; s.cameraY = p.y;
        s.barFight = null;
      }
    }

    // ── Bodyguard update ──────────────────────────────────────────────────────
    if (s.bodyguards) {
      s.bodyguards.timer -= dt;
      if (s.bodyguards.timer <= 0) {
        s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 50, text: '🏃 BODYGUARDS DISPERSED', color: '#666', life: 120, maxLife: 120, vy: -1 });

        // Remove from global entity array to vanish across network
        const bgIds = new Set(s.bodyguards.entities.map(b => b.id));
        for (let i = s.entities.length - 1; i >= 0; i--) {
          if (bgIds.has(s.entities[i].id)) {
            s.entities.splice(i, 1);
          }
        }

        s.bodyguards = null;
      } else {
        for (let i = s.bodyguards.entities.length - 1; i >= 0; i--) {
          const bg = s.bodyguards.entities[i];
          if (bg.health <= 0) {
            // Remove from global entity array upon death
            const deathIndex = s.entities.findIndex(e => e.id === bg.id);
            if (deathIndex >= 0) s.entities.splice(deathIndex, 1);

            s.bodyguards.entities.splice(i, 1);
            continue;
          }

          bg.aiTimer = (bg.aiTimer || 0) - dt;
          let target: { x: number, y: number } = p;
          let isAttacking = false;

          let closestEnemy: Entity | null = null;
          let closestDist = 200;
          for (const e of s.entities) {
            if ((e.type === 'cop' || e.type === 'boss') && e.aiState !== 'dead') {
              const d = dist(bg, e);
              if (d < closestDist) {
                closestDist = d;
                closestEnemy = e;
              }
            }
          }

          if (closestEnemy) {
            target = closestEnemy;
            isAttacking = true;
          }

          const dTarget = dist(bg, target);
          const ang = Math.atan2(target.y - bg.y, target.x - bg.x);
          bg.facing = ang;

          if (isAttacking) {
            bg.vx += Math.cos(ang) * 0.4;
            bg.vy += Math.sin(ang) * 0.4;
            const spd = Math.hypot(bg.vx, bg.vy);
            if (spd > 2.5) { bg.vx = (bg.vx / spd) * 2.5; bg.vy = (bg.vy / spd) * 2.5; }

            if (dTarget < 40 && (bg.aiTimer || 0) <= 0) {
              closestEnemy!.health -= 15;

              // Broadcast damage over network
              if (!s.isHost && s.sendDamageEvent) {
                s.sendDamageEvent(closestEnemy!.id, 15);
              }

              closestEnemy!.vx += Math.cos(ang) * 3;
              closestEnemy!.vy += Math.sin(ang) * 3;
              s.floatingTexts.push({ id: uid(), x: closestEnemy!.x, y: closestEnemy!.y - 20, text: '-15', color: '#ff6600', life: 40, maxLife: 40, vy: -1 });
              bg.aiTimer = 40;
              if (closestEnemy!.health <= 0) closestEnemy!.aiState = 'dead';
            }
          } else {
            if (dTarget > 60) {
              bg.vx += Math.cos(ang) * 0.3;
              bg.vy += Math.sin(ang) * 0.3;
              const spd = Math.hypot(bg.vx, bg.vy);
              if (spd > 2.2) { bg.vx = (bg.vx / spd) * 2.2; bg.vy = (bg.vy / spd) * 2.2; }
            } else {
              bg.vx *= 0.8;
              bg.vy *= 0.8;
            }
          }

          // Bodyguard physics handling mapping implicitly runs via resolveCollisions() since they are in s.entities 
        }
      }
    }

    // ── Skip movement if windows open ─────────────────────────────────────────
    const windowOpen = s.buildingWindowOpen || s.slotMachineOpen;

    // ── Player movement ────────────────────────────────────────────────────────
    const isDriving = !!s.vehicles.find(v => v.driverId === 'player' || v.driverId === playerId);
    if (!isDriving && !s.activeDialogue && !windowOpen && (p.stunTimer || 0) <= 0) {
      let dx = 0, dy = 0;
      if (keys.has('w') || keys.has('arrowup')) dy -= 1;
      if (keys.has('s') || keys.has('arrowdown')) dy += 1;
      if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
      if (keys.has('d') || keys.has('arrowright')) dx += 1;

      if (s.touches.joystick) { dx += s.touches.joystick.x; dy += s.touches.joystick.y; }

      const len = Math.hypot(dx, dy);
      if (len > 0) {
        dx /= len; dy /= len;
        // Apply terrain speed multiplier
        const terraType = getTerrainAt(s.terrainGrid, p.x, p.y);
        const terraMult = TERRAIN_SPEED[terraType] ?? 1;
        const spd = PLAYER_SPEED * terraMult * (s.rageMode ? 1.5 : 1) * dt;
        p.vx = dx * spd;
        p.vy = dy * spd;
        p.facing = Math.atan2(dy, dx);

        // Terrain feedback: floating text when stepping into new slow terrain
        if ((terraType === 3 || terraType === 4 || terraType === 5) && s.gameTime % 180 === 0) {
          s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 30, text: '⚠ ' + TERRAIN_NAMES[terraType], color: terraType === 5 ? '#4488ff' : terraType === 4 ? '#886644' : '#ccaa44', life: 60, maxLife: 60, vy: -0.4 });
        }
      } else {
        p.vx *= 0.8;
        p.vy *= 0.8;
      }
    } else {
      p.vx *= 0.85;
      p.vy *= 0.85;
      if (p.stunTimer && p.stunTimer > 0) p.stunTimer--;
    }

    p.x += p.vx;
    p.y += p.vy;
    p.x = clamp(p.x, p.width / 2, WORLD_W - p.width / 2);
    p.y = clamp(p.y, p.height / 2, WORLD_H - p.height / 2);

    // ── Vehicle Physics ────────────────────────────────────────────────────────
    for (const v of s.vehicles) {
      const vt = v.vehicleType!;
      const isPlayerDriving = v.driverId === 'player' || v.driverId === playerId;
      const isPlayerPassenger = v.passengerId === 'player' || v.passengerId === playerId;

      const maxSpd = VEHICLE_MAX_SPEED[vt];
      const handling = VEHICLE_HANDLING[vt];

      if (isPlayerDriving && !s.activeDialogue && !windowOpen) {
        // Player controls vehicle — supports both keyboard AND mobile joystick
        let dvx = 0, dvy = 0;
        let accelInput = false;
        let brakeInput = false;

        // ── Keyboard acceleration / braking ────────────────────────────────────
        if (keys.has('w') || keys.has('arrowup')) {
          dvx += Math.cos(v.facing); dvy += Math.sin(v.facing);
          accelInput = true;
        }
        if (keys.has('s') || keys.has('arrowdown')) {
          dvx -= Math.cos(v.facing) * 0.4; dvy -= Math.sin(v.facing) * 0.4;
          brakeInput = true;
        }

        // ── Mobile joystick acceleration / braking ─────────────────────────────
        // joystick.y: negative = forward (accelerate), positive = backward (brake)
        const joy = s.touches.joystick;
        if (joy) {
          if (joy.y < -0.15) {
            // Joystick pushed up → accelerate forward along vehicle facing
            const throttle = Math.abs(joy.y);
            dvx += Math.cos(v.facing) * throttle;
            dvy += Math.sin(v.facing) * throttle;
            accelInput = true;
          } else if (joy.y > 0.15) {
            // Joystick pushed down → brake / reverse
            const brakeAmt = joy.y * 0.4;
            dvx -= Math.cos(v.facing) * brakeAmt;
            dvy -= Math.sin(v.facing) * brakeAmt;
            brakeInput = true;
          }
        }

        const speed = Math.hypot(v.vx, v.vy);
        const forwardDot = v.vx * Math.cos(v.facing) + v.vy * Math.sin(v.facing);
        const isReversing = forwardDot < -0.1;
        const speedPercent = speed / (maxSpd || 1);

        // Motorcycle can turn while stationary. Others need momentum.
        const canTurn = vt === 'motorcycle' || speed > 1.0 || (speed > 0.1 && (accelInput || brakeInput));

        // ── Keyboard steering ─────────────────────────────────────────────────
        if (canTurn && (keys.has('a') || keys.has('arrowleft') || keys.has('d') || keys.has('arrowright'))) {
          // If reversing, invert turning logic for realistic feel
          const turnDir = isReversing ? -1 : 1;
          // Emulate understeer at high speeds
          const steeringMultiplier = vt === 'motorcycle' ? 1.0 : (1.0 - Math.min(0.5, speedPercent * 0.6));
          const steerAmount = handling * dt * turnDir * steeringMultiplier;

          if (keys.has('a') || keys.has('arrowleft')) v.facing -= steerAmount;
          if (keys.has('d') || keys.has('arrowright')) v.facing += steerAmount;
        }

        // ── Mobile joystick steering ──────────────────────────────────────────
        // joystick.x: negative = steer left, positive = steer right
        if (canTurn && joy && Math.abs(joy.x) > 0.15) {
          const turnDir = isReversing ? -1 : 1;
          const steeringMultiplier = vt === 'motorcycle' ? 1.0 : (1.0 - Math.min(0.5, speedPercent * 0.6));
          // Scale joystick x (−1…1) by handling, dt, and understeer multiplier
          const steerAmount = joy.x * handling * dt * turnDir * steeringMultiplier;
          v.facing += steerAmount;
        }

        v.vx += dvx * 0.5 * dt;
        v.vy += dvy * 0.5 * dt;

        // Terrain affects vehicle max speed
        const vTerra = getTerrainAt(s.terrainGrid, v.x, v.y);
        const vTerraMult = vTerra === 5 ? (vt === 'motorcycle' ? 0.3 : 0.05) : (TERRAIN_SPEED[vTerra] ?? 1);
        const effectiveMax = maxSpd * vTerraMult * dt;

        // Drag
        v.vx *= 0.94; v.vy *= 0.94;
        const spd = Math.hypot(v.vx, v.vy);
        if (spd > effectiveMax) { v.vx = (v.vx / spd) * effectiveMax; v.vy = (v.vy / spd) * effectiveMax; }
        v.vehicleSpeed = Math.hypot(v.vx, v.vy);

        v.x = clamp(v.x + v.vx, v.width / 2, WORLD_W - v.width / 2);
        v.y = clamp(v.y + v.vy, v.height / 2, WORLD_H - v.height / 2);

      } else if (!v.driverId && isHost) {
        // Move vehicle (Unoccupied physics handled by host ONLY)
        const vTerra = getTerrainAt(s.terrainGrid, v.x, v.y);
        const vTerraMult = vTerra === 5 ? (vt === 'motorcycle' ? 0.3 : 0.05) : (TERRAIN_SPEED[vTerra] ?? 1);
        const effectiveMax = maxSpd * vTerraMult * dt;

        v.vx *= 0.94; v.vy *= 0.94;
        const spd = Math.hypot(v.vx, v.vy);
        if (spd > effectiveMax) { v.vx = (v.vx / spd) * effectiveMax; v.vy = (v.vy / spd) * effectiveMax; }
        v.vehicleSpeed = Math.hypot(v.vx, v.vy);

        v.x = clamp(v.x + v.vx, v.width / 2, WORLD_W - v.width / 2);
        v.y = clamp(v.y + v.vy, v.height / 2, WORLD_H - v.height / 2);

        if (s.gameTime % 30 === 0) {
          syncVehicles(s.vehicles); // Periodically sync parked vehicles
        }
      }

      // Sync player position to vehicle
      if (isPlayerDriving || isPlayerPassenger) {
        p.x = v.x; p.y = v.y;
        p.vx = v.vx; p.vy = v.vy;
        p.facing = v.facing;
      }

      // --- Collision Damage ---
      const currentSpeed = v.vehicleSpeed || 0;
      if (currentSpeed > 3.0) {
        // Driver deals damage to NPCs, boss, cops
        if (isPlayerDriving) {
          for (const e of s.entities) {
            if ((e.type === 'npc' || e.type === 'cop' || e.type === 'boss') && e.aiState !== 'dead') {
              if (dist(v, e) < (v.width / 2 + e.width / 2 + 10)) {
                const dmg = currentSpeed * (vt === 'truck' ? 3 : vt === 'motorcycle' ? 1.5 : 2);
                e.health -= dmg;
                e.health = Math.max(0, e.health);

                if (!s.isHost && s.sendDamageEvent) {
                  s.sendDamageEvent(e.id, dmg);
                }

                e.vx += v.vx * 1.5;
                e.vy += v.vy * 1.5;

                s.floatingTexts.push({ id: uid(), x: e.x, y: e.y - 20, text: `RUN OVER -${Math.round(dmg)}`, color: '#ff2233', life: 60, maxLife: 60, vy: -1 });
                sfxRef.current?.('hit');

                if (e.type === 'npc') e.aiState = 'flee';

                if (e.health <= 0) {
                  e.health = 0;
                  // Boss kill logic normally in click handler but here simple death
                  if (e.type === 'boss') {
                    s.bossActive = false;
                    s.bossDefeated = true;
                    s.score += 1000;
                    s.inventory.cash += 500;
                    s.floatingTexts.push({ id: uid(), x: e.x, y: e.y - 30, text: '★ BOSS ROADKILL ★', color: '#ffcc00', life: 180, maxLife: 180, vy: -1 });
                  }
                  e.aiState = 'dead';
                  addPrecept('violence', 15);
                }
              }
            }
          }
        }

        // Reverted Player hit by a vehicle
        if (p.occupyingVehicleId !== v.id && !s.playerDead) {
          if (dist(v, p) < (v.width / 2 + p.width / 2 + 5)) {
            const rawDmg = currentSpeed * (vt === 'truck' ? 3 : vt === 'motorcycle' ? 1.5 : 2);
            const dmg = rawDmg; // OLD behaviour: instant lethal possibility
            p.health -= dmg;
            p.health = Math.max(0, p.health);
            p.vx += v.vx * 2;
            p.vy += v.vy * 2;
            s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 40, text: `HIT BY VEHICLE! -${Math.round(dmg)}`, color: '#ff2233', life: 80, maxLife: 80, vy: -1 });
            sfxRef.current?.('hit');
            if (p.health <= 0) s.playerDead = true;
          }
        }
      }
    }
    p.y = clamp(p.y, p.height / 2, WORLD_H - p.height / 2);

    // ── Hide timer (stealth evasion) ──────────────────────────────────────────
    const buildings = s.entities.filter(e => e.type === 'building');
    const copsChasing = s.entities.filter(e => e.type === 'cop' && (e.aiState === 'chase' || e.aiState === 'search'));
    if (copsChasing.length > 0) {
      const anyCanSee = copsChasing.some(c => isInFOV(c, p, buildings));
      if (!anyCanSee && isPlayerHidden(p, buildings)) {
        s.hideTimer += dt;
        if (s.hideTimer >= HIDE_ESCAPE_FRAMES) {
          // Player escaped! All searching cops disengage
          for (const c of copsChasing) {
            c.aiState = 'patrol';
            c.lastSeenPlayer = null;
            c.searchTimer = 0;
          }
          s.hideTimer = 0;
          s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 40, text: '🕶 ESCAPED!', color: '#00ff88', life: 80, maxLife: 80, vy: -1 });
        }
      } else {
        s.hideTimer = Math.max(0, s.hideTimer - dt * 2);
      }
    } else {
      s.hideTimer = 0;
    }

    // ── Keyboard actions ────────────────────────────────────────────────────────
    if (attackCooldownRef.current > 0) attackCooldownRef.current -= dt;
    if (stealthCooldownRef.current > 0) stealthCooldownRef.current -= dt;
    if (interactCooldownRef.current > 0) interactCooldownRef.current -= dt;

    if (!windowOpen) {
      if (keys.has(' ') && attackCooldownRef.current <= 0) performAttack();
      if (keys.has('e') && stealthCooldownRef.current <= 0) performSteal();
    }
    if (keys.has('f') && interactCooldownRef.current <= 0) performInteract();

    // ── Building proximity detection ──────────────────────────────────────────
    let closestBuilding: Entity | null = null;
    let closestDist = Infinity;
    for (const e of s.entities) {
      if (e.type === 'building' && e.buildingType) {
        const center = buildingCenter(e);
        const d = dist(p, center);
        const threshold = BUILDING_INTERACT_RADIUS + Math.max(e.width, e.height) / 2;
        if (d < threshold && d < closestDist) {
          closestDist = d;
          closestBuilding = e;
        }
      }
    }
    s.nearBuilding = closestBuilding ? { entity: closestBuilding, distance: closestDist } : null;

    if (s.buildingWindowOpen && !s.nearBuilding) {
      s.buildingWindowOpen = false;
    }

    // ── Mission tracking ──────────────────────────────────────────────────────
    if (s.activeMission && s.activeMission.status === 'active') {
      const m = s.activeMission;
      if (m.timeLimit && m.timer !== undefined) {
        m.timer -= dt;
        if (m.timer <= 0) {
          m.status = 'failed';
          s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 50, text: '✗ MISSION FAILED', color: '#ff2233', life: 120, maxLife: 120, vy: -1 });
          s.activeMission = null;
        }
      }
      // Check combat objective completion via kills
      if (m) {
        const combatObj = m.objectives.find(o => o.type === 'combat' && !o.done);
        if (combatObj) {
          // Track kills via score changes — simplified: increment on each cop/npc kill
          // We'll use a simple approach: check how many dead entities there are
          const prevObjDone = m.objectives.filter(o => o.done).length;
          const allPreObjDone = m.objectives.filter(o => o.type !== 'combat').every(o => o.done);
          if (allPreObjDone) {
            // Combat phase active - track kills
            const deadNpcs = s.entities.filter(e => e.type === 'npc' && e.aiState === 'dead').length;
            combatObj.progress = Math.min(deadNpcs, combatObj.required || 3);
            if (combatObj.progress >= (combatObj.required || 3)) {
              combatObj.done = true;
              s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 70, text: '✓ HEIST COMPLETE', color: '#00ff88', life: 120, maxLife: 120, vy: -1 });
            }
          }
        }
        // Check all objectives done
        if (m.objectives.every(o => o.done)) {
          m.status = 'complete';
          s.inventory.cash += m.rewards.cash;
          s.score += m.rewards.score;
          if (m.rewards.preceptKey) addPrecept(m.rewards.preceptKey, m.rewards.preceptAmount || 0);
          s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 50, text: `★ MISSION COMPLETE: +$${m.rewards.cash}`, color: '#ffcc00', life: 150, maxLife: 150, vy: -0.8 });
          s.activeMission = null;
        }
      }
    }

    // ── Rage mode ──────────────────────────────────────────────────────────────
    if (s.rageMode) {
      s.rageModeTimer -= dt;
      if (s.rageModeTimer <= 0) { s.rageMode = false; s.rageModeTimer = 0; }
    }

    // ── Heat / cop spawning ─────────────────────────────────────────────────────
    s.copSpawnTimer -= dt;
    const heatTargetMap = [0, 2, 4, 7, 11, 16];
    const maxCops = heatTargetMap[s.heatLevel] || 0;

    // Filter to get exactly how many living cops we have tracking the local host/player
    const livingCops = s.entities.filter(e => e.type === 'cop' && e.aiState !== 'dead');
    s.copCount = livingCops.length;

    // Remove excess cops dynamically if heat drops (e.g. Bribe / Arrest)
    if (s.copCount > maxCops) {
      let excess = s.copCount - maxCops;
      for (let i = s.entities.length - 1; i >= 0 && excess > 0; i--) {
        const e = s.entities[i];
        if (e.type === 'cop' && e.aiState !== 'dead') {
          // Despawn this cop safely
          s.entities.splice(i, 1);
          excess--;
          s.copCount--;
        }
      }
    }

    if (s.copSpawnTimer <= 0 && s.heatLevel >= 1 && s.copCount < maxCops) {
      const rank = s.heatLevel >= 4 ? 3 : s.heatLevel >= 2 ? 2 : 1;
      let spawnX = p.x;
      let spawnY = p.y;

      // Pull cords from the Police Station
      const station = s.entities.find(e => e.buildingType === 'police_station');
      if (station) {
        spawnX = station.x + station.width / 2;
        spawnY = station.y + station.height + 25; // Directly in front of the door
      }

      const cop = spawnCop(spawnX, spawnY, rank);

      // Immediately set the cop to chase mode targeting the player so they pour out of the station actively
      cop.aiState = 'chase';
      cop.lastSeenPlayer = { x: p.x, y: p.y };

      s.entities.push(cop);

      // ── At heat ≥ 3: spawn a police_cruiser alongside the cop ───────────────
      if (s.heatLevel >= 3 && s.isHost) {
        // Chance scales with heat: 40% at heat 3, 70% at heat 4, 100% at heat 5
        const cruiserChance = s.heatLevel >= 5 ? 1.0 : s.heatLevel >= 4 ? 0.7 : 0.4;
        if (Math.random() < cruiserChance) {
          const cruiser = spawnVehicle('police_cruiser', spawnX + 60, spawnY + 10);
          // Assign the cop as "occupant" so it visually rides the cruiser
          cruiser.driverId = cop.id;
          cruiser.engineOn = true;
          // Give the cruiser chase velocity toward player
          const ang = Math.atan2(p.y - cruiser.y, p.x - cruiser.x);
          cruiser.vx = Math.cos(ang) * 2;
          cruiser.vy = Math.sin(ang) * 2;
          cruiser.facing = ang;
          s.vehicles.push(cruiser);
        }
      }

      // Fast spawn rate if severely lacking cops, slow rate if just sustaining
      s.copSpawnTimer = (s.copCount < maxCops - 2) ? 45 : 120;
    }

    // ── Boss spawning at Heat 5 ───────────────────────────────────────────────
    if (s.bossSpawnCooldown > 0) s.bossSpawnCooldown -= dt;
    if (s.heatLevel >= 5 && !s.bossActive && !s.bossDefeated && s.bossSpawnCooldown <= 0) {
      const boss = spawnBoss(p.x, p.y);
      s.entities.push(boss);
      s.bossActive = true;
      s.screenShake = 20;
      s.floatingTexts.push({ id: uid(), x: p.x, y: p.y - 80, text: '⚠ CHIEF ENFORCER DEPLOYED ⚠', color: '#ff0044', life: 180, maxLife: 180, vy: -0.5 });
      sfxRef.current?.('boss_spawn');
    }
    if (s.heatLevel < 5 && s.bossDefeated) {
      s.bossDefeated = false;
    }

    // ── AI ──────────────────────────────────────────────────────────────────────
    for (const e of s.entities) {
      if (e.type === 'building' || e.type === 'item') continue;
      updateAI(e, s);
      e.x += e.vx;
      e.y += e.vy;
    }

    // ── Collisions ──────────────────────────────────────────────────────────────
    resolveCollisions([p, ...s.entities, ...s.vehicles]);

    // ── Apply Client Damage Events (Host Only) ──────────────────────────────────
    if (s.isHost && s.damageEvents && s.damageEvents.length > 0 && s.clearDamageEvent) {
      for (const event of s.damageEvents) {
        const target = s.entities.find(e => e.id === event.npcId);
        if (target && target.aiState !== 'dead') {
          target.health -= event.damage;

          if (target.health <= 0) {
            target.health = 0;
            target.aiState = 'dead';

            if (target.type === 'boss') {
              s.bossActive = false;
              s.bossDefeated = true;
              s.bossSpawnCooldown = 3600;
              s.score += 1000;
              s.floatingTexts.push({ id: uid(), x: target.x, y: target.y - 30, text: '★ BOSS DEFEATED ★', color: '#ffcc00', life: 180, maxLife: 180, vy: -1 });
              sfxRef.current?.('boss_defeat');
            }
          }
        }
        s.clearDamageEvent(event.id);
      }
    }

    // ── Floating texts ──────────────────────────────────────────────────────────
    for (let i = s.floatingTexts.length - 1; i >= 0; i--) {
      const ft = s.floatingTexts[i];
      ft.life -= dt;
      ft.y += ft.vy;
      if (ft.life <= 0) s.floatingTexts.splice(i, 1);
    }

    // ── Camera ──────────────────────────────────────────────────────────────────
    s.cameraX += (p.x - s.cameraX) * 0.08;
    s.cameraY += (p.y - s.cameraY) * 0.08;

    if (s.screenShake > 0) s.screenShake -= 0.5 * dt;

    // ── Player health regen (slow) ────────────────────────────────────────────
    if (p.health < p.maxHealth && p.health > 0) p.health = Math.min(p.maxHealth, p.health + 0.02 * dt);

    // ── Chaos decay ────────────────────────────────────────────────────────────
    if (s.gameTime % 600 < dt) {
      for (const key of Object.keys(s.precepts) as PrecedeKey[]) {
        s.precepts[key] = Math.max(0, s.precepts[key] - 0.5);
      }
    }

    // ── Talkdown cooldown ────────────────────────────────────────────────────
    for (const e of s.entities) {
      if (e.talkCooldown && e.talkCooldown > 0) e.talkCooldown -= dt;
    }

    // ── Multiplayer sync ─────────────────────────────────────────────────────────
    if (!s.isHost && s.remoteNPCs && s.remoteNPCs.length > 0) {
      // Interpolate local dynamic entities towards remote ones instead of snapping
      const remoteMap = new Map();
      for (const r of s.remoteNPCs) remoteMap.set(r.id, r);

      const updatedEntities = [];
      const usedRemoteIds = new Set<string>();

      for (const e of s.entities) {
        if (e.type === 'building' || e.type === 'item') {
          updatedEntities.push(e);
          continue;
        }

        const remote = remoteMap.get(e.id);
        if (remote) {
          usedRemoteIds.add(e.id);
          // LERP position and facing (0.3 is the interpolation speed ~ 1/3 dist per frame)
          e.x += (remote.x - e.x) * 0.3;
          e.y += (remote.y - e.y) * 0.3;

          let diff = remote.facing - e.facing;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          e.facing += diff * 0.3;

          // Snap discrete state
          e.health = remote.health;
          e.aiState = remote.aiState;
          e.color = remote.color;

          updatedEntities.push(e);
        }
      }

      // Add any new remote NPCs that we haven't seen locally yet
      for (const r of s.remoteNPCs) {
        if (!usedRemoteIds.has(r.id)) {
          updatedEntities.push({ ...r });
        }
      }

      s.entities = updatedEntities;
    }

    // Interpolate remote players
    if (!s.visualRemotePlayers) s.visualRemotePlayers = {};
    if (s.remotePlayers) {
      for (const id in s.remotePlayers) {
        const target = s.remotePlayers[id];
        const current = s.visualRemotePlayers[id];

        if (!current) {
          // First time seeing this player, snap to them immediately to prevent flying across screen
          s.visualRemotePlayers[id] = { ...target };
        } else {
          // LERP
          current.x += (target.x - current.x) * 0.3;
          current.y += (target.y - current.y) * 0.3;

          let diff = target.facing - current.facing;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          current.facing += diff * 0.3;

          current.health = target.health;
          current.dead = target.dead;
          current.name = target.name;
          current.occupyingVehicleId = target.occupyingVehicleId;

          // If this remote player is in a vehicle, strictly pair their graphical position to the vehicle's position.
          // This overrules direct network lag so passengers never look like they are floating out of the car.
          if (current.occupyingVehicleId) {
            const occupiedVehicle = s.vehicles.find(v => v.id === current.occupyingVehicleId);
            if (occupiedVehicle) {
              current.x = occupiedVehicle.x;
              current.y = occupiedVehicle.y;
              current.facing = occupiedVehicle.facing;

              // Keep the target updated as well so LERP doesn't jump aggressively if they exit
              target.x = occupiedVehicle.x;
              target.y = occupiedVehicle.y;
              target.facing = occupiedVehicle.facing;
            }
          }
        }
      }

      // Cleanup disconnected players from visual map
      for (const id in s.visualRemotePlayers) {
        if (!s.remotePlayers[id]) {
          delete s.visualRemotePlayers[id];
        }
      }
    }

    // Interpolate remote vehicles
    if (s.remoteVehicles) {
      const activeVehicleIds = new Set<string>();
      for (const id in s.remoteVehicles) {
        const target = s.remoteVehicles[id];
        let current = s.vehicles.find(v => v.id === id);

        // If the vehicle doesn't exist locally, create it (e.g. host spawned a cop car)
        if (!current) {
          current = {
            id: target.id,
            x: target.x,
            y: target.y,
            vx: target.vx || 0,
            vy: target.vy || 0,
            width: target.type === 'truck' ? 52 : (target.type === 'motorcycle' ? 18 : 36),
            height: target.type === 'truck' ? 72 : (target.type === 'motorcycle' ? 38 : 52),
            health: target.health,
            maxHealth: target.type === 'truck' ? 800 : 400,
            type: 'vehicle',
            vehicleType: target.vehicleType,
            color: '#334466', // simplified default colors for remote spawns if needed
            facing: target.facing || 0,
            engineOn: target.engineOn,
            driverId: target.driverId,
            passengerId: target.passengerId
          };
          s.vehicles.push(current);
        }

        activeVehicleIds.add(id);

        const isMeDriving = current.driverId === 'player' || current.driverId === playerId;
        // Don't overwrite local vehicle physics if we are the ones driving it
        if (!isMeDriving) {
          // Prevent stale Firebase updates from wiping our local seat ownership claim
          if (p.occupyingVehicleId === id) {
            if (current.driverId === playerId) target.driverId = playerId;
            if (current.passengerId === playerId) target.passengerId = playerId;
          } else {
            // If we aren't occupying it, but Firebase thinks we are, discard the stale echo
            if (target.driverId === playerId) target.driverId = null;
            if (target.passengerId === playerId) target.passengerId = null;
          }

          current.driverId = target.driverId;
          current.passengerId = target.passengerId;
          current.engineOn = target.engineOn;
          current.health = target.health;

          // LERP position and facing (0.3 is the interpolation speed ~ 1/3 dist per frame)
          current.x += (target.x - current.x) * 0.3;
          current.y += (target.y - current.y) * 0.3;

          let diff = target.facing - current.facing;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          current.facing += diff * 0.3;

          current.vx = target.vx || 0;
          current.vy = target.vy || 0;
          current.vehicleSpeed = Math.hypot(current.vx, current.vy);
        }
      }

      // We do not cleanup disconnected vehicles because they are persistent entities.
    }

    // Throttle networking to run roughly every 6 ticks (100ms at 60fps)
    if (s.gameTime % 6 < dt) {
      if (s.syncPlayer && !s.playerDead) {
        s.syncPlayer(p, p.health, s.playerDead, "Player", s.chaosLevel, s.rageMode, p.occupyingVehicleId);
      }
      if (s.isHost && s.syncNPCs) {
        s.syncNPCs(s.entities.filter(e => e.type !== 'building' && e.type !== 'item'));
      }
      if (s.isHost && s.syncVehicles) {
        s.syncVehicles(s.vehicles);
      }
      if (s.sendVehiclePhysics) {
        s.vehicles.forEach(v => {
          if (v.driverId === 'player' || v.driverId === playerId) {
            s.sendVehiclePhysics!(v);
          }
        });
      }
    }

    // ── Trigger render ───────────────────────────────────────────────────────
    setRenderTick(t => t + 1);

    // ── HUD update ───────────────────────────────────────────────────────────
    if (Math.floor(s.gameTime) % 10 === 0) {
      setHudData(prev => buildHudData(s, prev));
    }

    animFrameRef.current = requestAnimationFrame(update);
  }, [performAttack, performSteal, performInteract]);

  function buildHudData(s: GameState, _prev: typeof hudData) {
    const boss = s.entities.find(e => e.type === 'boss' && e.aiState !== 'dead');
    return {
      precepts: { ...s.precepts },
      chaosLevel: s.chaosLevel, heatLevel: s.heatLevel,
      rageMode: s.rageMode,
      health: s.player.health, maxHealth: s.player.maxHealth,
      score: s.score,
      stealthMode: s.stealthMode,
      activeDialogue: s.activeDialogue ? { ...s.activeDialogue } : null,
      glitchIntensity: s.glitchIntensity,
      playerDead: s.playerDead, deathTimer: s.deathTimer,
      nearBuilding: s.nearBuilding ? { name: s.nearBuilding.entity.label || '', type: s.nearBuilding.entity.buildingType! } : null,
      buildingWindowOpen: s.buildingWindowOpen,
      inventory: { cash: s.inventory.cash, weapons: [...s.inventory.weapons], activeWeapon: s.inventory.activeWeapon },
      bossHealth: boss ? boss.health : null,
      bossMaxHealth: boss ? boss.maxHealth : null,
      bossActive: s.bossActive,
      contacts: [...s.contacts],
      activeMission: s.activeMission ? { ...s.activeMission, objectives: s.activeMission.objectives.map(o => ({ ...o })) } : null,
      arrestState: s.arrestState,
      arrestTimer: s.arrestTimer,
      jailTimer: s.jailTimer,
      barFight: s.barFight ? { ...s.barFight } : null,
      bodyguards: s.bodyguards ? { entities: [...s.bodyguards.entities], timer: s.bodyguards.timer } : null,
      slotMachineOpen: s.slotMachineOpen,
      hideTimer: s.hideTimer,
      fullMapOpen: s.fullMapOpen,
      // Vehicle HUD
      nearVehicle: (() => {
        const inVeh = s.vehicles.find(v => v.driverId === playerId || v.passengerId === playerId);
        if (inVeh) return null;
        const v = s.vehicles.find(v => !v.driverId && !v.passengerId && dist(s.player, v) < 90);
        return v ? (v.vehicleType || 'vehicle').toUpperCase().replace('_', ' ') : null;
      })(),
      playerVehicle: (() => {
        const v = s.vehicles?.find(v => v.driverId === playerId || v.passengerId === playerId);
        if (!v) return null;
        return {
          type: v.vehicleType as string,
          speedKmh: Math.round((v.vehicleSpeed ?? 0) * (180 / 28.0)), // Absolute speed calculation based on car max speed (28.0)
          health: v.vehicleHealth ?? v.health,
          maxHealth: v.vehicleMaxHealth ?? v.maxHealth,
        };
      })(),
    };
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    lastTimeRef.current = performance.now();
    animFrameRef.current = requestAnimationFrame(update);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [handleKeyDown, handleKeyUp, update]);

  return {
    canvasRef, stateRef, hudData, renderTick,
    performAttack, performSteal, performInteract, chooseDialogueOption,
    handleBuildingAction, closeBuildingWindow, setSFXCallback,
    handleBribe, handleGoToJail, handleResistArrest,
    handleSlotResult, closeSlotMachine,
    hostWorld, joinWorld: joinWorldAndApplySeed,
    WORLD_W, WORLD_H,
    isPaused: stateRef.current?.isPaused || false,
    togglePause: () => {
      if (stateRef.current) {
        stateRef.current.isPaused = !stateRef.current.isPaused;
        sfxRef.current?.(stateRef.current.isPaused ? 'ui_open' : 'ui_close');
      }
    },
    forceSave: () => {
      if (worldId && stateRef.current) {
        const sessionSeconds = (Date.now() - sessionStartRef.current) / 1000;
        saveWorld(worldId, worldName || 'Unknown World', stateRef.current, sessionSeconds);
      }
    },
    toggleMap: () => {
      const s = stateRef.current;
      if (s) {
        s.fullMapOpen = !s.fullMapOpen;

        // Auto-pause in singleplayer
        if (!s.isHost && (!s.remotePlayers || Object.keys(s.remotePlayers).length === 0)) {
          s.isPaused = s.fullMapOpen;
        }

        sfxRef.current?.(s.fullMapOpen ? 'ui_open' : 'ui_close');
      }
    }
  };
}
