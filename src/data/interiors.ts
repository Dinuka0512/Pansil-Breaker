import { BuildingType } from '@/components/BuildingInteractionWindow';

export type InteriorTileType = 'floor' | 'wall' | 'exit' | 'jail_bars';

export interface InteriorFurniture {
  id: string;
  type: 'desk' | 'chair' | 'table' | 'shelf' | 'bed' | 'bar_counter' | 'jail_bed' | 'computer';
  x: number; // grid x
  y: number; // grid y
  width: number;
  height: number;
  color: string;
}

export interface InteriorNPC {
  id: string;
  type: 'cop' | 'npc';
  x: number; // grid pos
  y: number;
  vx?: number;
  vy?: number;
  aiTimer?: number;
  aiTarget?: { x: number; y: number };
  name: string;
  facing: number;
  dialogue?: string[];
  color?: string;
}

export interface InteriorLayout {
  type: BuildingType;
  width: number;
  height: number;
  tiles: InteriorTileType[][];
  furniture: InteriorFurniture[];
  npcs: InteriorNPC[];
  spawnX: number;
  spawnY: number;
}

export type InteriorState = InteriorLayout & {
  buildingId: string;
  playerOutsidePos: { x: number; y: number };
};

export const INTERIOR_TILE_SIZE = 48;

const parseMap = (mapStr: string): InteriorTileType[][] => {
  const charToType: Record<string, InteriorTileType> = {
    '.': 'floor',
    '#': 'wall',
    'E': 'exit',
    '|': 'jail_bars',
  };
  return mapStr.trim().split('\n').map(line => 
    line.trim().split('').map(char => charToType[char] || 'floor')
  );
};

export const INTERIOR_LAYOUTS: Record<BuildingType, InteriorLayout> = {
  safehouse: {
    type: 'safehouse',
    width: 8, height: 8,
    spawnX: 4, spawnY: 6,
    tiles: parseMap(`
      ########
      #......#
      #......#
      #......#
      #......#
      #......#
      #......#
      ####E###
    `),
    furniture: [
      { id: 'bed_1', type: 'bed', x: 1, y: 1, width: 2, height: 1.5, color: '#3366ff' },
      { id: 'desk_1', type: 'desk', x: 5, y: 1, width: 2, height: 1, color: '#554433' },
      { id: 'chair_1', type: 'chair', x: 5.5, y: 2, width: 1, height: 1, color: '#443322' },
    ],
    npcs: [],
  },
  police_station: {
    type: 'police_station',
    width: 16, height: 12,
    spawnX: 8, spawnY: 10,
    tiles: parseMap(`
      ################
      #......#.......#
      #......#.......#
      #..#####.......#
      #..#...........#
      #..#....########
      #..#....#||||||#
      #..#.....||||||#
      #..#....#||||||#
      #..#....########
      #......S.......#
      ########E#######
    `),
    furniture: [
      // Lobby Desk
      { id: 'lobby_desk', type: 'desk', x: 7, y: 8, width: 3, height: 1, color: '#2c3e50' },
      // Office area
      { id: 'off_desk_1', type: 'desk', x: 9, y: 1, width: 2, height: 1, color: '#34495e' },
      { id: 'off_chair_1', type: 'chair', x: 9.5, y: 2, width: 1, height: 1, color: '#2c3e50' },
      { id: 'off_desk_2', type: 'desk', x: 12, y: 1, width: 2, height: 1, color: '#34495e' },
      { id: 'off_chair_2', type: 'chair', x: 12.5, y: 2, width: 1, height: 1, color: '#2c3e50' },
      { id: 'off_desk_3', type: 'desk', x: 9, y: 4, width: 2, height: 1, color: '#34495e' },
      { id: 'off_chair_3', type: 'chair', x: 9.5, y: 3.2, width: 1, height: 1, color: '#2c3e50' },
      // Jail cell
      { id: 'jail_bed', type: 'jail_bed', x: 10, y: 7, width: 2, height: 1, color: '#7f8c8d' },
    ],
    npcs: [
      { id: 'desk_officer', type: 'cop', x: 8.5, y: 7.5, name: 'Sgt. Miller', facing: Math.PI / 2, dialogue: ['Welcome to the 4th Precinct.', 'Stay out of trouble, citizen.'] },
      { id: 'detective_1', type: 'cop', x: 10, y: 2.2, name: 'Det. Jax', facing: -Math.PI / 2, dialogue: ['I\'m busy with the Syndicate case.', 'Move along.'] },
      { id: 'detective_2', type: 'npc', x: 13, y: 2.2, name: 'Analyst Sarah', facing: -Math.PI / 2, dialogue: ['The data from the hack is encrypted.', 'We need more processing power.'] },
      { id: 'prisoner_1', type: 'npc', x: 11, y: 8, name: 'Twitchy', facing: 0, dialogue: ['I didn\'t do nothing!', 'Get me out of here!'], color: '#e67e22' },
    ],
  },
  underground_bar: {
    type: 'underground_bar',
    width: 12, height: 12,
    spawnX: 6, spawnY: 10,
    tiles: parseMap(`
      ############
      #..........#
      #..........#
      #..######..#
      #..#....#..#
      #..#....#..#
      #..#....#..#
      #..#....#..#
      #..######..#
      #..........#
      #..........#
      #####E######
    `),
    furniture: [
      { id: 'bar_1', type: 'bar_counter', x: 2, y: 2, width: 8, height: 1, color: '#442211' },
      { id: 'table_1', type: 'table', x: 2, y: 6, width: 1.5, height: 1.5, color: '#553322' },
      { id: 'table_2', type: 'table', x: 8, y: 6, width: 1.5, height: 1.5, color: '#553322' },
      { id: 'chair_1', type: 'chair', x: 2.2, y: 7.5, width: 1, height: 1, color: '#332211' },
      { id: 'chair_2', type: 'chair', x: 8.2, y: 7.5, width: 1, height: 1, color: '#332211' },
    ],
    npcs: [],
  },
  karma_mart: {
    type: 'karma_mart',
    width: 10, height: 10,
    spawnX: 5, spawnY: 8,
    tiles: parseMap(`
      ##########
      #........#
      #........#
      #........#
      #........#
      #........#
      #........#
      #........#
      #........#
      ####E#####
    `),
    furniture: [
      { id: 'shelf_a1', type: 'shelf', x: 1, y: 2, width: 1, height: 5, color: '#dddddd' },
      { id: 'shelf_a2', type: 'shelf', x: 4, y: 2, width: 1, height: 5, color: '#dddddd' },
      { id: 'shelf_a3', type: 'shelf', x: 7, y: 2, width: 1, height: 5, color: '#dddddd' },
      { id: 'counter', type: 'desk', x: 3, y: 8, width: 4, height: 1, color: '#ff9900' },
    ],
    npcs: [],
  },
  club_nirvana: {
    type: 'club_nirvana',
    width: 14, height: 14,
    spawnX: 7, spawnY: 12,
    tiles: parseMap(`
      ##############
      #............#
      #............#
      #............#
      #............#
      #............#
      #............#
      #............#
      #............#
      #............#
      #............#
      #............#
      #............#
      ######E#######
    `),
    furniture: [
      { id: 'stage', type: 'desk', x: 4, y: 1, width: 6, height: 2, color: '#cc33ff' },
      { id: 'bar_2', type: 'bar_counter', x: 1, y: 5, width: 1, height: 6, color: '#ff00ff' },
    ],
    npcs: [],
  },
  corporate: {
    type: 'corporate',
    width: 16, height: 12,
    spawnX: 8, spawnY: 10,
    tiles: parseMap(`
      ################
      #..............#
      #..............#
      #..............#
      #..............#
      #..............#
      #..............#
      #..............#
      #..............#
      #..............#
      #..............#
      #######E########
    `),
    furniture: [
      { id: 'cubicle_1', type: 'shelf', x: 2, y: 2, width: 2, height: 2, color: '#bbbbcc' },
      { id: 'cubicle_2', type: 'shelf', x: 6, y: 2, width: 2, height: 2, color: '#bbbbcc' },
      { id: 'cubicle_3', type: 'shelf', x: 10, y: 2, width: 2, height: 2, color: '#bbbbcc' },
      { id: 'exec_desk', type: 'desk', x: 13, y: 2, width: 2, height: 2, color: '#00ccff' },
    ],
    npcs: [],
  },
};
