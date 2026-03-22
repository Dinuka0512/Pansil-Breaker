import { useEffect, useRef, useState, useCallback } from 'react';
import { ref, onValue, set, remove, onDisconnect, get, update } from 'firebase/database';
import { getRTDB } from '../lib/firebase';
import { Entity, randomSeed } from './useGameEngine';

export interface RemotePlayer {
    id: string;
    x: number;
    y: number;
    facing: number;
    health: number;
    dead: boolean;
    name: string;
    chaosLevel?: number;
    rageMode?: boolean;
    occupyingVehicleId?: string | null;
}

export interface DamageEvent {
    id: string;
    npcId: string;
    damage: number;
    timestamp: number;
}

export function useMultiplayer(playerId: string) {
    const [roomCode, setRoomCode] = useState<string | null>(null);
    const [isHost, setIsHost] = useState(false);
    const [worldSeed, setWorldSeed] = useState<number | null>(null);
    const [remotePlayers, setRemotePlayers] = useState<Record<string, RemotePlayer>>({});
    const [remoteNPCs, setRemoteNPCs] = useState<Entity[]>([]);
    const [remoteVehicles, setRemoteVehicles] = useState<Record<string, any>>({});
    const [pickedUpItems, setPickedUpItems] = useState<string[]>([]);
    const [damageEvents, setDamageEvents] = useState<DamageEvent[]>([]);

    const isHostRef = useRef(false);
    const remotePlayerCountRef = useRef(0);
    const hasSetupDisconnectRef = useRef(false);

    const rtdb = getRTDB();

    // Create a new room – generates a seed and stores it in RTDB
    const createWorld = useCallback(async (playerName: string, existingSeed?: number) => {
        if (!rtdb) return null;
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 5; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));

        const seed = existingSeed ?? randomSeed();

        setRoomCode(code);
        setIsHost(true);
        isHostRef.current = true;
        setWorldSeed(seed);

        const roomRef = ref(rtdb, `rooms/${code}`);
        await set(roomRef, {
            createdAt: Date.now(),
            host: playerId,
            seed,           // ← store seed so clients can derive identical world
        });

        onDisconnect(roomRef).remove();
        return { code, seed };
    }, [rtdb, playerId]);

    // Join a room – reads the stored seed so the client builds an identical world
    const joinWorld = useCallback(async (code: string, playerName: string) => {
        if (!rtdb) return null;
        const roomRef = ref(rtdb, `rooms/${code.toUpperCase()}`);

        const snapshot = await get(roomRef);
        if (!snapshot.exists()) return null;

        const data = snapshot.val();
        const seed: number = data.seed ?? 0;

        setRoomCode(code.toUpperCase());
        setIsHost(false);
        isHostRef.current = false;
        setWorldSeed(seed);

        return seed;
    }, [rtdb]);

    const leaveWorld = useCallback(() => {
        if (!roomCode || !rtdb) return;
        const playerRef = ref(rtdb, `rooms/${roomCode}/players/${playerId}`);
        remove(playerRef);
        if (isHost) remove(ref(rtdb, `rooms/${roomCode}`));
        setRoomCode(null);
        setIsHost(false);
        isHostRef.current = false;
        setWorldSeed(null);
        setRemotePlayers({});
        setRemoteNPCs([]);
        setPickedUpItems([]);
        setDamageEvents([]);
        hasSetupDisconnectRef.current = false;
    }, [roomCode, isHost, playerId, rtdb]);

    // Sync own player state
    const syncPlayer = useCallback((p: any, health: number, dead: boolean, name: string, chaosLevel: number, rageMode: boolean, occupyingVehicleId: string | null = null) => {
        if (!roomCode || !rtdb) return;
        if (isHostRef.current && remotePlayerCountRef.current === 0) return;
        const playerRef = ref(rtdb, `rooms/${roomCode}/players/${playerId}`);
        set(playerRef, {
            id: playerId,
            x: Math.round(p.x),
            y: Math.round(p.y),
            facing: p.facing,
            health,
            dead,
            name,
            chaosLevel,
            rageMode,
            occupyingVehicleId,
            timestamp: Date.now()
        });

        if (!hasSetupDisconnectRef.current) {
            onDisconnect(playerRef).remove();
            hasSetupDisconnectRef.current = true;
        }
    }, [roomCode, playerId, rtdb]);

    // Sync an item pickup
    const syncItemPickup = useCallback((itemId: string) => {
        if (!roomCode || !rtdb) return;
        if (isHostRef.current && remotePlayerCountRef.current === 0) return;
        const itemRef = ref(rtdb, `rooms/${roomCode}/itemPickups/${itemId}`);
        set(itemRef, true);
    }, [roomCode, rtdb]);

    // Send a damage event to the host (Clients only)
    const sendDamageEvent = useCallback((npcId: string, damage: number) => {
        if (!roomCode || !rtdb || isHostRef.current) return;
        const eventId = `dmg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const eventRef = ref(rtdb, `rooms/${roomCode}/damageEvents/${eventId}`);
        set(eventRef, {
            id: eventId,
            npcId,
            damage,
            timestamp: Date.now()
        });
    }, [roomCode, rtdb]);

    // Clear a damage event once processed (Host only)
    const clearDamageEvent = useCallback((eventId: string) => {
        if (!roomCode || !rtdb || !isHostRef.current) return;
        const eventRef = ref(rtdb, `rooms/${roomCode}/damageEvents/${eventId}`);
        remove(eventRef);
    }, [roomCode, rtdb]);

    // Sync NPCs (Host only)
    const syncNPCs = useCallback((entities: Entity[]) => {
        if (!isHost || !roomCode || !rtdb) return;
        const npcs = entities.filter(e => e.type === 'npc' || e.type === 'cop' || e.type === 'boss');
        const simplifiedNPCs = npcs.map(e => {
            const npcPayload: any = {
                id: e.id,
                type: e.type,
                x: Math.round(e.x),
                y: Math.round(e.y),
                facing: e.facing,
                health: e.health,
                width: e.width,
                height: e.height,
                color: e.color
            };
            if (e.subtype !== undefined) npcPayload.subtype = e.subtype;
            if (e.aiState !== undefined) npcPayload.aiState = e.aiState;
            return npcPayload;
        });

        const npcsRef = ref(rtdb, `rooms/${roomCode}/npcs`);
        set(npcsRef, simplifiedNPCs);
    }, [isHost, roomCode, rtdb]);

    // Sync Vehicles (Host only for base state, Drivers for physics)
    const syncVehicles = useCallback((vehicles: Entity[]) => {
        if (!isHost || !roomCode || !rtdb) return;

        const vehiclesRef = ref(rtdb, `rooms/${roomCode}/vehicles`);
        // Use deep update to avoid overwriting seat occupancy
        const updates: Record<string, any> = {};
        vehicles.forEach(v => {
            // Only sync vehicles that are NOT occupied by someone else
            if (!v.driverId || v.driverId === 'player' || v.driverId === playerId) {
                updates[`${v.id}/x`] = Math.round(v.x);
                updates[`${v.id}/y`] = Math.round(v.y);
                updates[`${v.id}/vx`] = v.vx;
                updates[`${v.id}/vy`] = v.vy;
                updates[`${v.id}/facing`] = v.facing;
                updates[`${v.id}/health`] = v.health;
                updates[`${v.id}/engineOn`] = v.engineOn;
                updates[`${v.id}/vehicleType`] = v.vehicleType;
                updates[`${v.id}/type`] = v.type;
                updates[`${v.id}/id`] = v.id;
            }
        });

        if (Object.keys(updates).length > 0) {
            update(vehiclesRef, updates);
        }
    }, [isHost, roomCode, rtdb, playerId]);

    // Update Vehicle Seat (Any player)
    const updateVehicleSeat = useCallback((vehicleId: string, seat: 'driver' | 'passenger', occupantId: string | null) => {
        if (!roomCode || !rtdb) return;
        const updates: Record<string, any> = {};
        updates[`rooms/${roomCode}/vehicles/${vehicleId}/${seat}Id`] = occupantId;
        // Also update player's occupancy status
        updates[`rooms/${roomCode}/players/${playerId}/occupyingVehicleId`] = occupantId ? vehicleId : null;
        update(ref(rtdb), updates);
    }, [roomCode, rtdb, playerId]);

    // Send Vehicle Physics (Driver only)
    const sendVehiclePhysics = useCallback((v: Entity) => {
        if (!roomCode || !rtdb) return;
        const vRef = ref(rtdb, `rooms/${roomCode}/vehicles/${v.id}`);
        // Deep update to avoid wiping other fields
        const updates: Record<string, any> = {
            x: Math.round(v.x),
            y: Math.round(v.y),
            vx: v.vx,
            vy: v.vy,
            facing: v.facing,
            health: v.health,
            engineOn: v.engineOn || false,
            driverId: v.driverId || null,
            passengerId: v.passengerId || null,
            timestamp: Date.now()
        };
        update(vRef, updates);
    }, [roomCode, rtdb]);

    // Listen for remote updates
    useEffect(() => {
        if (!roomCode || !rtdb) return;

        const playersRef = ref(rtdb, `rooms/${roomCode}/players`);
        const unsubPlayers = onValue(playersRef, (snapshot) => {
            if (snapshot.exists()) {
                const val = snapshot.val();
                const otherPlayers: Record<string, RemotePlayer> = {};
                for (const pid in val) {
                    if (pid !== playerId) otherPlayers[pid] = val[pid];
                }
                setRemotePlayers(otherPlayers);
                remotePlayerCountRef.current = Object.keys(otherPlayers).length;
            } else {
                setRemotePlayers({});
                remotePlayerCountRef.current = 0;
            }
        });

        // Clients subscribe to NPC updates from host
        let unsubNPCs = () => { };
        if (!isHost) {
            const npcsRef = ref(rtdb, `rooms/${roomCode}/npcs`);
            unsubNPCs = onValue(npcsRef, (snapshot) => {
                if (snapshot.exists()) setRemoteNPCs(snapshot.val());
            });
        }

        // All players subscribe to item pickups
        const pickupsRef = ref(rtdb, `rooms/${roomCode}/itemPickups`);
        const unsubPickups = onValue(pickupsRef, (snapshot) => {
            if (snapshot.exists()) {
                setPickedUpItems(Object.keys(snapshot.val()));
            } else {
                setPickedUpItems([]);
            }
        });

        // All players subscribe to vehicles
        const vehiclesRef = ref(rtdb, `rooms/${roomCode}/vehicles`);
        const unsubVehicles = onValue(vehiclesRef, (snapshot) => {
            if (snapshot.exists()) {
                setRemoteVehicles(snapshot.val());
            } else {
                setRemoteVehicles({});
            }
        });

        // Host subscribes to damage events
        let unsubDamage = () => { };
        if (isHost) {
            const damageRef = ref(rtdb, `rooms/${roomCode}/damageEvents`);
            unsubDamage = onValue(damageRef, (snapshot) => {
                if (snapshot.exists()) {
                    setDamageEvents(Object.values(snapshot.val()));
                } else {
                    setDamageEvents([]);
                }
            });
        }

        return () => {
            unsubPlayers();
            unsubNPCs();
            unsubPickups();
            unsubVehicles();
            unsubDamage();
        };
    }, [roomCode, isHost, playerId, rtdb]);

    return {
        roomCode,
        isHost,
        worldSeed,
        remotePlayers,
        remoteNPCs,
        remoteVehicles,
        pickedUpItems,
        damageEvents,
        createWorld,
        joinWorld,
        leaveWorld,
        syncPlayer,
        syncNPCs,
        syncVehicles,
        updateVehicleSeat,
        sendVehiclePhysics,
        syncItemPickup,
        sendDamageEvent,
        clearDamageEvent
    };
}
