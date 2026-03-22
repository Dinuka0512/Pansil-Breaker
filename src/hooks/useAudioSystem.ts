import { useRef, useCallback, useEffect } from 'react';

// Lightweight synth-wave audio system using Web Audio API
// No external files needed — all procedurally generated

export interface VehicleAudioData {
  id: string;
  type: 'car' | 'motorcycle' | 'truck' | 'police_cruiser';
  speed: number;
  engineOn: boolean;
  distance: number;
  pan: number;
}

interface AudioSystemState {
  ctx: AudioContext | null;
  masterGain: GainNode | null;
  musicGain: GainNode | null;
  sfxGain: GainNode | null;
  currentHeatLevel: number;
  bassOsc: OscillatorNode | null;
  padOsc: OscillatorNode | null;
  arpOsc: OscillatorNode | null;
  arpGain: GainNode | null;
  arpInterval: number | null;
  started: boolean;
  rageAudio: HTMLAudioElement | null;
  vehicleNodes: Record<string, { osc: OscillatorNode, gain: GainNode, panner: StereoPannerNode | null }>;
}

const HEAT_MUSIC_PARAMS = [
  { bassFreq: 55, padFreq: 220, tempo: 400, bassVol: 0.08, padVol: 0.03, arpVol: 0 },       // Heat 0: ambient
  { bassFreq: 55, padFreq: 247, tempo: 350, bassVol: 0.10, padVol: 0.04, arpVol: 0.02 },     // Heat 1
  { bassFreq: 65, padFreq: 262, tempo: 300, bassVol: 0.12, padVol: 0.05, arpVol: 0.04 },     // Heat 2
  { bassFreq: 73, padFreq: 294, tempo: 250, bassVol: 0.14, padVol: 0.06, arpVol: 0.06 },     // Heat 3
  { bassFreq: 82, padFreq: 330, tempo: 200, bassVol: 0.16, padVol: 0.07, arpVol: 0.08 },     // Heat 4
  { bassFreq: 98, padFreq: 392, tempo: 160, bassVol: 0.18, padVol: 0.08, arpVol: 0.10 },     // Heat 5: chaos
];

const ARP_NOTES = [130.81, 164.81, 196, 261.63, 329.63, 392, 523.25, 659.25];

export function useAudioSystem() {
  const stateRef = useRef<AudioSystemState>({
    ctx: null, masterGain: null, musicGain: null, sfxGain: null,
    currentHeatLevel: 0, bassOsc: null, padOsc: null, arpOsc: null,
    arpGain: null, arpInterval: null, started: false, rageAudio: null,
    vehicleNodes: {},
  });
  const rageFadeIntervalRef = useRef<number | null>(null);
  // Tracks the Promise returned by rageAudio.play() so we can safely pause()
  // after it resolves. On mobile, calling pause() before play() resolves
  // throws an AbortError that leaves the audio looping in a broken state.
  const ragePlayPromiseRef = useRef<Promise<void> | null>(null);
  // Set to true whenever rage ends so any in-flight fade-in interval stops
  // immediately and the pending play() promise chain knows to pause on resolve.
  const rageShouldStopRef = useRef<boolean>(false);

  const initAudio = useCallback(() => {
    const s = stateRef.current;
    if (s.started) return;
    s.started = true;

    try {
      const ctx = new AudioContext();
      s.ctx = ctx;

      // Master chain
      const master = ctx.createGain();
      master.gain.value = 0.6;
      master.connect(ctx.destination);
      s.masterGain = master;

      const musicGain = ctx.createGain();
      musicGain.gain.value = 0.5;
      musicGain.connect(master);
      s.musicGain = musicGain;

      const sfxGain = ctx.createGain();
      sfxGain.gain.value = 0.7;
      sfxGain.connect(master);
      s.sfxGain = sfxGain;

      // Bass oscillator (sawtooth)
      const bassOsc = ctx.createOscillator();
      bassOsc.type = 'sawtooth';
      bassOsc.frequency.value = 55;
      const bassFilter = ctx.createBiquadFilter();
      bassFilter.type = 'lowpass';
      bassFilter.frequency.value = 200;
      bassFilter.Q.value = 2;
      const bassGain = ctx.createGain();
      bassGain.gain.value = 0.08;
      bassOsc.connect(bassFilter).connect(bassGain).connect(musicGain);
      bassOsc.start();
      s.bassOsc = bassOsc;

      // Pad oscillator (triangle + detune for width)
      const padOsc = ctx.createOscillator();
      padOsc.type = 'triangle';
      padOsc.frequency.value = 220;
      padOsc.detune.value = 7;
      const padFilter = ctx.createBiquadFilter();
      padFilter.type = 'lowpass';
      padFilter.frequency.value = 800;
      const padGainNode = ctx.createGain();
      padGainNode.gain.value = 0.03;
      padOsc.connect(padFilter).connect(padGainNode).connect(musicGain);
      padOsc.start();
      s.padOsc = padOsc;

      // Arp oscillator (square)
      const arpOsc = ctx.createOscillator();
      arpOsc.type = 'square';
      arpOsc.frequency.value = 130.81;
      const arpFilter = ctx.createBiquadFilter();
      arpFilter.type = 'bandpass';
      arpFilter.frequency.value = 1200;
      arpFilter.Q.value = 5;
      const arpGainNode = ctx.createGain();
      arpGainNode.gain.value = 0;
      arpOsc.connect(arpFilter).connect(arpGainNode).connect(musicGain);
      arpOsc.start();
      s.arpOsc = arpOsc;
      s.arpGain = arpGainNode;

      // Arp sequencer
      let arpStep = 0;
      const runArp = () => {
        const params = HEAT_MUSIC_PARAMS[s.currentHeatLevel] || HEAT_MUSIC_PARAMS[0];
        if (s.arpOsc && s.arpGain && s.ctx) {
          const note = ARP_NOTES[arpStep % ARP_NOTES.length];
          s.arpOsc.frequency.setTargetAtTime(note, s.ctx.currentTime, 0.02);
          s.arpGain.gain.setTargetAtTime(params.arpVol, s.ctx.currentTime, 0.01);
          // Quick decay
          s.arpGain.gain.setTargetAtTime(params.arpVol * 0.3, s.ctx.currentTime + 0.08, 0.05);
          arpStep++;
        }
        s.arpInterval = window.setTimeout(runArp, params.tempo) as unknown as number;
      };
      runArp();

      // Store gain node refs on oscillators for later access
      (bassOsc as any)._gain = bassGain;
      (padOsc as any)._gain = padGainNode;

      const rageAudio = new Audio('/sounds/rage.mp3');
      rageAudio.loop = true;
      s.rageAudio = rageAudio;
    } catch {
      // Audio not available
    }
  }, []);

  const updateHeatMusic = useCallback((heatLevel: number) => {
    const s = stateRef.current;
    if (!s.ctx || !s.started) return;
    if (heatLevel === s.currentHeatLevel) return;
    s.currentHeatLevel = heatLevel;

    const params = HEAT_MUSIC_PARAMS[heatLevel] || HEAT_MUSIC_PARAMS[0];
    const t = s.ctx.currentTime;

    if (s.bassOsc) {
      s.bassOsc.frequency.setTargetAtTime(params.bassFreq, t, 0.5);
      (s.bassOsc as any)._gain?.gain.setTargetAtTime(params.bassVol, t, 0.3);
    }
    if (s.padOsc) {
      s.padOsc.frequency.setTargetAtTime(params.padFreq, t, 0.5);
      (s.padOsc as any)._gain?.gain.setTargetAtTime(params.padVol, t, 0.3);
    }
  }, []);

  const updateRageAudio = useCallback((isRage: boolean) => {
    const s = stateRef.current;
    if (!s.rageAudio) return;

    // Always clear any running fade interval before starting a new one
    if (rageFadeIntervalRef.current) {
      window.clearInterval(rageFadeIntervalRef.current);
      rageFadeIntervalRef.current = null;
    }

    if (isRage) {
      // ── Rage ON: fade in ────────────────────────────────────────────────────
      rageShouldStopRef.current = false;   // clear any prior stop request
      s.rageAudio.volume = 0;
      s.rageAudio.currentTime = 0;

      // Store the play() Promise. On mobile, play() is asynchronous and we
      // MUST resolve it before ever calling pause(), otherwise the browser
      // throws an AbortError which leaves the element looping indefinitely.
      const playPromise = s.rageAudio.play().catch(() => {
        // Autoplay blocked or other error — silently ignore
      });
      ragePlayPromiseRef.current = playPromise ?? null;

      // If rage ended before play() resolved, honour the stop immediately.
      if (ragePlayPromiseRef.current) {
        ragePlayPromiseRef.current.then(() => {
          if (rageShouldStopRef.current) {
            const audio = stateRef.current.rageAudio;
            if (audio) { audio.volume = 0; audio.pause(); audio.currentTime = 0; }
            ragePlayPromiseRef.current = null;
            rageShouldStopRef.current = false;
          }
        }).catch(() => { });
      }

      rageFadeIntervalRef.current = window.setInterval(() => {
        // Abort fade-in the moment rage ends
        if (!s.rageAudio || rageShouldStopRef.current) {
          if (rageFadeIntervalRef.current) {
            window.clearInterval(rageFadeIntervalRef.current);
            rageFadeIntervalRef.current = null;
          }
          return;
        }
        try { s.rageAudio.volume = Math.min(1, s.rageAudio.volume + 0.05); } catch (e) { }

        // Use a counter or check to break out if volume properties are read-only (iOS)
        const currentVol = s.rageAudio.volume;
        if (currentVol >= 1 || currentVol === 0 /* means assignment was ignored */) {
          if (rageFadeIntervalRef.current) {
            window.clearInterval(rageFadeIntervalRef.current);
            rageFadeIntervalRef.current = null;
          }
        }
      }, 50) as unknown as number;

    } else {
      // ── Rage OFF: fade out ──────────────────────────────────────────────────
      // Signal any pending fade-in to stop
      rageShouldStopRef.current = true;

      if (s.rageAudio && s.rageAudio.volume > 0) {
        // Start a fade-out interval
        let steps = 20; // Force maximum 20 steps (1 second) to prevent infinite loops on iOS
        rageFadeIntervalRef.current = window.setInterval(() => {
          steps--;
          if (!s.rageAudio || steps <= 0) {
            if (rageFadeIntervalRef.current) window.clearInterval(rageFadeIntervalRef.current);
            const safePause = () => {
              const audio = stateRef.current.rageAudio;
              if (audio) {
                try { audio.volume = 0; } catch (e) { }
                audio.pause();
                audio.currentTime = 0;
              }
              ragePlayPromiseRef.current = null;
              rageShouldStopRef.current = false;
            };

            if (ragePlayPromiseRef.current) {
              ragePlayPromiseRef.current.then(safePause).catch(safePause);
            } else {
              safePause();
            }
            return;
          }

          try { s.rageAudio.volume = Math.max(0, s.rageAudio.volume - 0.05); } catch (e) { }
        }, 50) as unknown as number; // ~1 second total fade (0.05 per 50ms = 20 steps)
      } else {
        // Already silent or no audio, just ensure it's stopped
        const safePause = () => {
          const audio = stateRef.current.rageAudio;
          if (audio) {
            audio.volume = 0;
            audio.pause();
            audio.currentTime = 0;
          }
          ragePlayPromiseRef.current = null;
          rageShouldStopRef.current = false;
        };
        if (ragePlayPromiseRef.current) {
          ragePlayPromiseRef.current.then(safePause).catch(safePause);
        } else {
          safePause();
        }
      }
    }
  }, []);

  const playSFX = useCallback((type: 'attack' | 'hit' | 'steal' | 'death' | 'ui_open' | 'ui_close' | 'purchase' | 'boss_spawn' | 'boss_defeat') => {
    const s = stateRef.current;
    if (!s.ctx || !s.sfxGain) return;
    const ctx = s.ctx;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain).connect(s.sfxGain);

    switch (type) {
      case 'attack':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, t);
        osc.frequency.exponentialRampToValueAtTime(80, t + 0.15);
        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        osc.start(t); osc.stop(t + 0.15);
        break;
      case 'hit':
        osc.type = 'square';
        osc.frequency.setValueAtTime(400, t);
        osc.frequency.exponentialRampToValueAtTime(100, t + 0.1);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        osc.start(t); osc.stop(t + 0.1);
        break;
      case 'steal':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, t);
        osc.frequency.exponentialRampToValueAtTime(1200, t + 0.1);
        osc.frequency.exponentialRampToValueAtTime(600, t + 0.2);
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        osc.start(t); osc.stop(t + 0.2);
        break;
      case 'death':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(300, t);
        osc.frequency.exponentialRampToValueAtTime(40, t + 0.8);
        gain.gain.setValueAtTime(0.4, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
        osc.start(t); osc.stop(t + 0.8);
        // Second voice for dissonance
        const osc2 = ctx.createOscillator();
        const g2 = ctx.createGain();
        osc2.connect(g2).connect(s.sfxGain!);
        osc2.type = 'square';
        osc2.frequency.setValueAtTime(150, t);
        osc2.frequency.exponentialRampToValueAtTime(20, t + 1);
        g2.gain.setValueAtTime(0.2, t);
        g2.gain.exponentialRampToValueAtTime(0.001, t + 1);
        osc2.start(t); osc2.stop(t + 1);
        break;
      case 'ui_open':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, t);
        osc.frequency.exponentialRampToValueAtTime(800, t + 0.08);
        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        osc.start(t); osc.stop(t + 0.12);
        break;
      case 'ui_close':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, t);
        osc.frequency.exponentialRampToValueAtTime(300, t + 0.08);
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        osc.start(t); osc.stop(t + 0.1);
        break;
      case 'purchase':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523, t);
        osc.frequency.setValueAtTime(659, t + 0.08);
        osc.frequency.setValueAtTime(784, t + 0.16);
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        osc.start(t); osc.stop(t + 0.3);
        break;
      case 'boss_spawn':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(80, t);
        osc.frequency.exponentialRampToValueAtTime(200, t + 0.3);
        osc.frequency.exponentialRampToValueAtTime(60, t + 0.8);
        gain.gain.setValueAtTime(0.4, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 1);
        osc.start(t); osc.stop(t + 1);
        break;
      case 'boss_defeat':
        osc.type = 'square';
        osc.frequency.setValueAtTime(200, t);
        osc.frequency.exponentialRampToValueAtTime(800, t + 0.4);
        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
        osc.start(t); osc.stop(t + 0.6);
        break;
    }
  }, []);

  const updateVehicleAudio = useCallback((vehicles: VehicleAudioData[]) => {
    const s = stateRef.current;
    if (!s.ctx || !s.started || !s.sfxGain) return;

    const PROFILES = {
      car: { baseFreq: 65, speedMult: 2.5, type: 'sawtooth' as const },
      motorcycle: { baseFreq: 110, speedMult: 6, type: 'square' as const },
      truck: { baseFreq: 45, speedMult: 1.5, type: 'sawtooth' as const },
      police_cruiser: { baseFreq: 75, speedMult: 3, type: 'sawtooth' as const },
    };

    const currentIds = new Set<string>();

    vehicles.forEach(v => {
      if (!v.engineOn) return;
      currentIds.add(v.id);

      let node = s.vehicleNodes[v.id];
      if (!node) {
        try {
          const osc = s.ctx!.createOscillator();
          const p = PROFILES[v.type] || PROFILES.car;
          osc.type = p.type;
          osc.frequency.value = p.baseFreq;

          const gain = s.ctx!.createGain();
          gain.gain.value = 0;

          let panner: StereoPannerNode | null = null;
          if (s.ctx!.createStereoPanner) {
            panner = s.ctx!.createStereoPanner();
            osc.connect(gain).connect(panner).connect(s.sfxGain);
          } else {
            osc.connect(gain).connect(s.sfxGain);
          }

          osc.start();
          node = { osc, gain, panner };
          s.vehicleNodes[v.id] = node;
        } catch (e) {
          return;
        }
      }

      try {
        const p = PROFILES[v.type] || PROFILES.car;
        const targetFreq = p.baseFreq + v.speed * p.speedMult;

        // Spatial max distance
        const maxDist = 900;
        let vol = 0;
        if (v.distance < maxDist) {
          vol = (1 - (v.distance / maxDist)) * 0.12; // Base volume mapping
          // Idle volume is lower
          if (v.speed < 1) vol *= 0.4;
        }

        node.osc.frequency.setTargetAtTime(targetFreq, s.ctx!.currentTime, 0.1);
        node.gain.gain.setTargetAtTime(vol, s.ctx!.currentTime, 0.1);
        if (node.panner) {
          node.panner.pan.setTargetAtTime(v.pan, s.ctx!.currentTime, 0.1);
        }
      } catch (e) { }
    });

    // Cleanup nodes array of inactive vehicles
    Object.keys(s.vehicleNodes).forEach(id => {
      if (!currentIds.has(id)) {
        const node = s.vehicleNodes[id];
        try { node.osc.stop(); node.osc.disconnect(); node.gain.disconnect(); if (node.panner) node.panner.disconnect(); } catch (e) { }
        delete s.vehicleNodes[id];
      }
    });
  }, []);

  useEffect(() => {
    return () => {
      const s = stateRef.current;
      if (rageFadeIntervalRef.current) window.clearInterval(rageFadeIntervalRef.current);
      if (s.arpInterval) clearTimeout(s.arpInterval);
      if (s.bassOsc) try { s.bassOsc.stop(); } catch { }
      if (s.padOsc) try { s.padOsc.stop(); } catch { }
      if (s.arpOsc) try { s.arpOsc.stop(); } catch { }
      if (s.rageAudio) { s.rageAudio.pause(); s.rageAudio.currentTime = 0; }
      Object.values(s.vehicleNodes).forEach(node => {
        try { node.osc.stop(); } catch { }
      });
    };
  }, []);

  return { initAudio, updateHeatMusic, updateRageAudio, playSFX, updateVehicleAudio };
}
