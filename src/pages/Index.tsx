import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useGameEngine, GameState } from '@/hooks/useGameEngine';
import { useAudioSystem } from '@/hooks/useAudioSystem';
import GameCanvas from '@/components/GameCanvas';
import GameHUD from '@/components/GameHUD';
import DialogueSystem from '@/components/DialogueSystem';
import MobileControls from '@/components/MobileControls';
import BuildingInteractionWindow from '@/components/BuildingInteractionWindow';
import ArrestOverlay from '@/components/ArrestOverlay';
import SlotMachine from '@/components/SlotMachine';
import {
  listSaves, loadSave, generateSaveId,
  exportSavesToString, importSavesFromString,
  WorldSaveMetadata, deleteSave, fetchSavesFromFirebase
} from '@/lib/saveManager';
import LoginScreen from '@/components/LoginScreen';
import CreditsPage from '@/components/CreditsPage';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';

// ── Shared button helpers ─────────────────────────────────────────────────────
const btnStyle = (color: string) => ({
  background: 'transparent',
  border: `2px solid ${color}`,
  color,
  textShadow: `0 0 10px ${color}80`,
  boxShadow: `0 0 20px ${color}33, inset 0 0 20px ${color}0d`,
  letterSpacing: '0.3em',
});
const btnHover = (color: string, el: HTMLButtonElement) => {
  el.style.background = `${color}1a`;
  el.style.boxShadow = `0 0 40px ${color}80, inset 0 0 30px ${color}1a`;
};
const btnLeave = (color: string, el: HTMLButtonElement) => {
  el.style.background = 'transparent';
  el.style.boxShadow = `0 0 20px ${color}33, inset 0 0 20px ${color}0d`;
};

// ── Corner brackets ───────────────────────────────────────────────────────────
function Corners() {
  return (
    <>
      {(['top-4 left-4', 'top-4 right-4', 'bottom-4 left-4', 'bottom-4 right-4'] as const).map((pos, i) => (
        <div key={i} className={`absolute ${pos} w-12 h-12`}
          style={{
            borderTop: i < 2 ? '1px solid rgba(255,34,51,0.3)' : 'none',
            borderBottom: i >= 2 ? '1px solid rgba(255,34,51,0.3)' : 'none',
            borderLeft: i % 2 === 0 ? '1px solid rgba(255,34,51,0.3)' : 'none',
            borderRight: i % 2 === 1 ? '1px solid rgba(255,34,51,0.3)' : 'none',
          }}
        />
      ))}
    </>
  );
}

// ── Custom Dialog Modal ──────────────────────────────────────────────────────
export type DialogState = {
  isOpen: boolean;
  title: string;
  message: string;
  type: 'alert' | 'confirm';
  onConfirm?: () => void;
  onCancel?: () => void;
} | null;

function CustomDialog({ dialog, onClose }: { dialog: DialogState, onClose: () => void }) {
  if (!dialog || !dialog.isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 scanlines"
      style={{ background: 'rgba(5, 0, 5, 0.85)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-sm border p-6 flex flex-col items-center text-center animate-fade-in"
        style={{
          background: 'linear-gradient(135deg, rgba(20,0,5,0.95), rgba(10,0,5,0.98))',
          borderColor: dialog.type === 'alert' ? '#ff2233' : '#00ccff',
          boxShadow: dialog.type === 'alert' ? '0 0 30px rgba(255,34,51,0.2)' : '0 0 30px rgba(0,204,255,0.2)'
        }}>
        <div className="font-display text-2xl tracking-widest mb-4"
          style={{
            color: dialog.type === 'alert' ? '#ff2233' : '#00ccff',
            textShadow: dialog.type === 'alert' ? '0 0 10px #ff2233' : '0 0 10px #00ccff'
          }}>
          {dialog.title}
        </div>
        <div className="font-mono-game text-sm mb-8" style={{ color: 'rgba(255,255,255,0.8)', lineHeight: 1.6 }}>
          {dialog.message.split('\n').map((line, i) => (
            <React.Fragment key={i}>
              {line}<br />
            </React.Fragment>
          ))}
        </div>
        <div className="flex gap-4 w-full">
          {dialog.type === 'confirm' && (
            <button onClick={() => { if (dialog.onCancel) dialog.onCancel(); onClose(); }}
              className="flex-1 py-3 font-display text-sm tracking-widest transition-colors"
              style={{ border: '1px solid #666', color: '#888' }}
              onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.border = '1px solid #fff'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#888'; e.currentTarget.style.border = '1px solid #666'; }}>
              CANCEL
            </button>
          )}
          <button onClick={() => { if (dialog.onConfirm) dialog.onConfirm(); onClose(); }}
            className={`flex-1 py-3 font-display text-sm tracking-widest transition-colors`}
            style={{
              border: `1px solid ${dialog.type === 'alert' ? '#ff2233' : '#00ff88'}`,
              color: dialog.type === 'alert' ? '#ff2233' : '#00ff88'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = dialog.type === 'alert' ? 'rgba(255,34,51,0.1)' : 'rgba(0,255,136,0.1)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent';
            }}>
            {dialog.type === 'alert' ? 'ACKNOWLEDGE' : 'CONFIRM'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Landing Screen ────────────────────────────────────────────────────────────
function LandingScreen({
  onPlay, onHost, onJoin,
  isCreatingHost, hostedCode, onStartHosted,
  initialRoomCode, isAnonymous, isLoggedIn, onUpgradeAccount,
  onShowCredits, onLogout, onShowDialog
}: {
  onPlay: () => void;
  onHost: () => void;
  onJoin: (code: string) => void;
  isCreatingHost: boolean;
  hostedCode: string | null;
  onStartHosted: () => void;
  initialRoomCode: string;
  isAnonymous: boolean;
  isLoggedIn: boolean;
  onUpgradeAccount: () => void;
  onShowCredits: () => void;
  onLogout: () => void;
  onShowDialog: (dialog: DialogState) => void;
}) {
  const [joinMode, setJoinMode] = useState(!!initialRoomCode);
  const [roomCodeInput, setRoomCodeInput] = useState(initialRoomCode || '');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const toggleFullscreen = useCallback(async () => {
    try {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
      const isStandalone = ('standalone' in window.navigator) && (window.navigator as any).standalone;

      if (!document.fullscreenElement && !(document as any).webkitFullscreenElement) {
        const elem = document.documentElement;
        if (elem.requestFullscreen) {
          await elem.requestFullscreen();
        } else if ((elem as any).webkitRequestFullscreen) {
          await (elem as any).webkitRequestFullscreen();
        } else if (isIOS && !isStandalone) {
          onShowDialog({
            isOpen: true,
            title: 'iOS FULLSCREEN',
            message: "To play in True Fullscreen on iOS:\n1. Tap the Safari Share icon.\n2. Tap 'Add to Home Screen'.\n3. Launch PB1 from your home screen!",
            type: 'alert'
          });
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        }
      }
    } catch (e) {
      console.error("Fullscreen toggle failed", e);
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
      if (isIOS) {
        onShowDialog({
          isOpen: true,
          title: 'iOS FULLSCREEN',
          message: "To play in True Fullscreen on iOS:\n1. Tap the Safari Share icon.\n2. Tap 'Add to Home Screen'.\n3. Launch PB1 from your home screen!",
          type: 'alert'
        });
      }
    }
  }, [onShowDialog]);

  useEffect(() => {
    if (initialRoomCode && initialRoomCode.length === 5) onJoin(initialRoomCode);
  }, [initialRoomCode, onJoin]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center scanlines overflow-y-auto"
      style={{ background: 'radial-gradient(ellipse at center, #0d0005 0%, #050005 60%, #000 100%)' }}>

      {/* ── Top nav bar (replaces absolute corners — wraps gracefully on mobile) */}
      {!hostedCode && !joinMode && (
        // TOP NAV BAR
        <div className="w-full flex flex-wrap items-center justify-between gap-2 p-7 select-none z-10">
          {/* Left part creating new account register section*/}
          <div className="flex flex-wrap gap-2">
            {(isLoggedIn && !isAnonymous) ? (
              // IF IS LOGED
              <>
                <button onClick={onHost} disabled={isCreatingHost}
                  className="font-display text-xs sm:text-sm tracking-widest px-4 sm:px-8 py-2 sm:py-3 transition-all landing-top-btn"
                  style={{
                    border: '2px solid #00ccff', color: '#00ccff', background: 'transparent',
                    opacity: isCreatingHost ? 0.5 : 1,
                    boxShadow: '0 0 15px rgba(0,204,255,0.2), inset 0 0 10px rgba(0,204,255,0.05)'
                  }}
                  onMouseEnter={e => !isCreatingHost && (e.currentTarget.style.background = 'rgba(0,204,255,0.1)')}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  {isCreatingHost ? 'CREATING...' : 'HOST RUN'}
                </button>
                <button onClick={() => setJoinMode(true)} disabled={isCreatingHost}
                  className="font-display text-xs sm:text-sm tracking-widest px-4 sm:px-8 py-2 sm:py-3 transition-all landing-top-btn"
                  style={{
                    border: '2px solid #cc33ff', color: '#cc33ff', background: 'transparent',
                    opacity: isCreatingHost ? 0.5 : 1,
                    boxShadow: '0 0 15px rgba(204,51,255,0.2), inset 0 0 10px rgba(204,51,255,0.05)'
                  }}
                  onMouseEnter={e => !isCreatingHost && (e.currentTarget.style.background = 'rgba(204,51,255,0.1)')}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  JOIN RUN
                </button>
              </>
            ) : (
              // IF NOT LOGED IN
              <div className="flex flex-col gap-1">
                <div className="font-mono text-xs px-3 py-1 border border-gray-700"
                  style={{ color: 'rgba(255,255,255,0.35)', background: 'rgba(0,0,0,0.5)' }}>
                  🔒 OFFLINE MODE · Online Co-op disabled
                </div>
                <button onClick={onUpgradeAccount}
                  className="font-display text-xs tracking-widest px-4 py-1 transition-all"
                  style={{
                    border: '2px solid #00ff88', color: '#00ff88', background: 'transparent',
                    boxShadow: '0 0 15px rgba(0,255,136,0.2)'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,255,136,0.1)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  ↑ UPGRADE 2 FREE ACCOUNT
                </button>
              </div>
            )}
          </div>

          {/* Right -> FULLSCREEN + CREDITS + LOGOUT */}
          <div className="flex flex-wrap gap-2">
            {/* FULL SCREEN */}
            <button onClick={toggleFullscreen}
              className="font-display text-xs sm:text-sm tracking-widest px-4 sm:px-8 py-2 sm:py-3 transition-all landing-top-btn"
              style={{
                border: '2px solid #00ccff', color: '#00ccff', background: 'transparent',
                opacity: 0.8,
                boxShadow: '0 0 15px rgba(0,204,255,0.2), inset 0 0 10px rgba(0,204,255,0.05)'
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,204,255,0.1)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              ⛶ FULLSCREEN
            </button>

            {/* CREDITS */}
            <button onClick={onShowCredits}
              className="font-display text-xs sm:text-sm tracking-widest px-4 sm:px-8 py-2 sm:py-3 transition-all landing-top-btn"
              style={{
                border: '2px solid #00ff88', color: '#00ff88', background: 'transparent',
                opacity: 0.8,
                boxShadow: '0 0 15px rgba(0,255,136,0.2), inset 0 0 10px rgba(0,255,136,0.05)'
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,255,136,0.1)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              CREDITS
            </button>

            {(isLoggedIn && !isAnonymous) && (
              // IF LOGED IN
              <button onClick={onLogout}
                className="font-display text-xs sm:text-sm tracking-widest px-4 sm:px-8 py-2 sm:py-3 transition-all landing-top-btn"
                style={{
                  border: '2px solid #ff2233', color: '#ff2233', background: 'transparent',
                  opacity: 0.8,
                  boxShadow: '0 0 15px rgba(255,34,51,0.2), inset 0 0 10px rgba(255,34,51,0.05)'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,34,51,0.1)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                LOGOUT
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Spacer for host/join screens so title isn't flush to top */}
      {(hostedCode || joinMode) && <div className="h-8 sm:h-16 shrink-0 landing-spacer" />}

      {/* ── Title */}
      <div className="flex text-center mb-6 sm:mb-8 select-none mt-2 sm:mt-4 px-4 landing-title">
        <div className="font-display text-5xl sm:text-6xl md:text-8xl mt-4 mb-0 animate-flicker landing-title-text"
          style={{ color: 'white', letterSpacing: '0.15em' }}>
          PANSIL BREAKER I
        </div>
      </div>



      {/* ── Precept icons */}
      <div className="flex gap-4 sm:gap-6 mb-8 sm:mb-12 select-none landing-icons">
        {[
          { icon: '⚔', label: 'VIOLENCE', color: '#ff2233' },
          { icon: '💰', label: 'THEFT', color: '#ff9900' },
          { icon: '😈', label: 'MISCONDUCT', color: '#cc33ff' },
          { icon: '🗣', label: 'DECEPTION', color: '#00ccff' },
          { icon: '☠', label: 'INTOXICATION', color: '#ff33aa' },
        ].map((p, i) => (
          <div key={i} className="flex flex-col items-center gap-1 opacity-0"
            style={{ animation: `fade-in 0.5s ease-out ${i * 0.15}s forwards` }}>
            <div className="text-2xl md:text-3xl" style={{ filter: `drop-shadow(0 0 8px ${p.color})` }}>{p.icon}</div>
            <div className="font-display text-xs hidden md:block" style={{ color: p.color, opacity: 0.7, letterSpacing: '0.1em' }}>{p.label}</div>
          </div>
        ))}
      </div>

      {/* ── Action area: Enter Chaos / Host / Join */}
      <div className="flex flex-col gap-4 items-center select-none w-full max-w-xs sm:max-w-sm px-4">
        {hostedCode ? (
          /* HOST SCREEN — room code display */
          <div className="flex flex-col gap-3 items-center w-full">
            <div className="text-lg sm:text-xl font-display" style={{ color: '#00ccff', letterSpacing: '0.1em' }}>ROOM CODE:</div>
            <div className="text-4xl sm:text-5xl font-display tracking-widest mb-2 animate-flicker"
              style={{ color: '#00ccff', textShadow: '0 0 20px rgba(0,204,255,0.6)' }}>
              {hostedCode}
            </div>
            <div className="text-xs font-mono-game mb-4 text-center"
              style={{ color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em' }}>
              SHARE THIS CODE FOR OTHERS TO JOIN
            </div>
            <button onClick={onStartHosted}
              className="font-display text-base sm:text-xl tracking-widest px-8 sm:px-12 py-3 sm:py-4 rounded transition-all duration-200 w-full landing-action-btn"
              style={btnStyle('#00ccff')}
              onMouseEnter={e => btnHover('#00ccff', e.currentTarget)}
              onMouseLeave={e => btnLeave('#00ccff', e.currentTarget)}>
              START CO-OP RUN
            </button>
          </div>
        ) : !joinMode ? (
          /* MAIN — enter chaos */
          <div className="flex flex-col gap-3 items-center w-full">
            <button
              onClick={async () => {
                setIsLoggingIn(true);
                try {
                  await onPlay();
                } finally {
                  setIsLoggingIn(false);
                }
              }}
              disabled={isLoggingIn}
              className="font-display text-base sm:text-xl tracking-widest px-8 sm:px-12 py-3 sm:py-4 rounded transition-all duration-200 w-full landing-action-btn"
              style={btnStyle('#ff2233')}
              onMouseEnter={e => !isLoggingIn && btnHover('#ff2233', e.currentTarget)}
              onMouseLeave={e => !isLoggingIn && btnLeave('#ff2233', e.currentTarget)}>
              {isLoggingIn ? 'INITIALIZING...' : 'PLAY NOW'}
            </button>

            {/* <button className='font-display text-base sm:text-xl tracking-widest px-8 sm:px-12 py-3 sm:py-4 rounded transition-all duration-200 w-full landing-action-btn'>
              Game Controlls
            </button> */}
          </div>
        ) : (
          /* JOIN SCREEN — room code input */
          <div className="flex flex-col gap-3 items-center w-full">
            <input type="text" placeholder="ROOM CODE"
              value={roomCodeInput}
              onChange={e => setRoomCodeInput(e.target.value.toUpperCase())}
              maxLength={5}
              className="px-4 py-3 bg-transparent text-center font-display tracking-widest text-xl focus:outline-none w-full"
              style={{ border: '2px solid #00ccff', color: '#00ccff' }}
            />
            <div className="flex gap-3 w-full">
              <button onClick={() => onJoin(roomCodeInput)} disabled={roomCodeInput.length !== 5}
                className="font-display text-sm px-6 py-3 rounded flex-1"
                style={{ border: '2px solid #00ccff', color: '#00ccff', opacity: roomCodeInput.length === 5 ? 1 : 0.5 }}>
                JOIN
              </button>
              <button onClick={() => setJoinMode(false)}
                className="font-display text-sm px-6 py-3 rounded flex-1"
                style={{ border: '2px solid #666', color: '#888' }}>
                BACK
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Controls hint */}
      <div className="mt-6 sm:mt-8 mb-6 font-mono-game text-xs animate-flicker text-center px-4"
        style={{ color: 'rgba(255,255,255,0.2)', letterSpacing: '0.1em' }}>
        <span className="hidden sm:inline">WASD TO MOVE · SPACE ATTACK · E STEAL · F INTERACT</span>
        <span className="sm:hidden">TAP JOYSTICK TO MOVE · BUTTONS TO ACT</span>
      </div>

      {/* ── Tagline */}
      <div className="font-mono-game text-center mb-6 sm:mb-10 max-w-xs sm:max-w-md px-4 landing-tagline"
        style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, lineHeight: 1.8, letterSpacing: '0.05em' }}>
        CHAOS ENGINE v6.7 (Public Beta)<br />FIVE PRECEPTS. ZERO MERCY.<br />
        VIOLENCE · THEFT · MISCONDUCT · DECEPTION · INTOXICATION
      </div>

      <Corners />
    </div>
  );
}

// ── Worlds Screen ─────────────────────────────────────────────────────────────
function WorldsScreen({
  onStartWorld,
  onBack,
  isAnonymous,
  onShowDialog
}: {
  onStartWorld: (id: string, name: string, state: Partial<GameState> | null, isHost: boolean) => void;
  onBack: () => void;
  isAnonymous: boolean;
  onShowDialog: (dialog: DialogState) => void;
}) {
  const [view, setView] = useState<'worlds' | 'settings'>('worlds');
  const [saves, setSaves] = useState<WorldSaveMetadata[]>([]);
  const [selected, setSelected] = useState<WorldSaveMetadata | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setSaves(listSaves()); }, []);

  const handleNewWorld = () => {
    const id = generateSaveId();
    onStartWorld(id, `World ${saves.length + 1}`, null, false);
  };

  const handleDelete = (id: string) => {
    onShowDialog({
      isOpen: true,
      title: 'DELETE WORLD?',
      message: 'Delete this world? This cannot be undone.',
      type: 'confirm',
      onConfirm: () => {
        deleteSave(id);
        setSaves(listSaves());
        if (selected?.id === id) setSelected(null);
      }
    });
  };

  const handleExport = () => {
    const blob = new Blob([exportSavesToString()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pansil_saves_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      if (typeof ev.target?.result === 'string') {
        if (importSavesFromString(ev.target.result)) {
          setSaves(listSaves());
          setView('worlds');
          onShowDialog({
            isOpen: true,
            title: 'SUCCESS',
            message: 'Saves imported successfully!',
            type: 'alert'
          });
        } else {
          onShowDialog({
            isOpen: true,
            title: 'ERROR',
            message: 'Import failed: invalid format.',
            type: 'alert'
          });
        }
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return `<1m`;
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center scanlines"
      style={{ background: 'radial-gradient(ellipse at center, #0d0005 0%, #050005 60%, #000 100%)' }}>

      <div className="w-full max-w-2xl px-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <button onClick={onBack}
            className="font-display text-sm px-4 py-2 transition-colors"
            style={{ border: '1px solid #555', color: '#777' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = '#fff'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#777'; e.currentTarget.style.borderColor = '#555'; }}>
            ← BACK
          </button>
          <div className="font-display text-2xl tracking-widest"
            style={{ color: '#00ccff', textShadow: '0 0 15px #00ccff' }}>
            {view === 'settings' ? 'SAVE DATA' : 'SELECT WORLD'}
          </div>
          <button onClick={() => setView(view === 'settings' ? 'worlds' : 'settings')}
            className="font-display text-sm px-4 py-2 transition-colors"
            style={{ border: '1px solid #555', color: '#777' }}
            onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = '#fff'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#777'; e.currentTarget.style.borderColor = '#555'; }}>
            {view === 'settings' ? 'WORLDS' : 'SETTINGS'}
          </button>
        </div>

        {view === 'worlds' ? (
          <div className="flex gap-4">
            {/* World list */}
            <div className="flex-1 flex flex-col gap-2 border border-gray-800 p-4 bg-black/60"
              style={{ maxHeight: 360, overflowY: 'auto' }}>
              {saves.length === 0 && (
                <div className="text-gray-600 font-mono text-sm py-8 text-center">NO SAVED WORLDS</div>
              )}
              {saves.map(s => (
                <div key={s.id}
                  onClick={() => setSelected(s)}
                  className="p-3 border cursor-pointer transition-colors flex justify-between items-center group"
                  style={{
                    borderColor: selected?.id === s.id ? '#00ccff' : '#2a2a2a',
                    background: selected?.id === s.id ? 'rgba(0,204,255,0.05)' : 'transparent'
                  }}>
                  <div>
                    <div className="font-display text-white text-lg">{s.name}</div>
                    <div className="font-mono text-xs mt-1" style={{ color: '#555' }}>
                      {formatTime(s.playTime)} · last played {new Date(s.lastPlayed).toLocaleDateString()}
                    </div>
                  </div>
                  <button onClick={e => { e.stopPropagation(); handleDelete(s.id); }}
                    className="text-red-700 hover:text-red-400 font-bold px-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    ✕
                  </button>
                </div>
              ))}
              <button onClick={handleNewWorld}
                className="mt-2 py-3 border font-display transition-colors"
                style={{ borderColor: '#00ff88', color: '#00ff88' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,255,136,0.08)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                + NEW WORLD
              </button>
            </div>

            {/* Action panel */}
            <div className="w-52 flex flex-col justify-between border border-gray-800 p-4 bg-black/60">
              {selected ? (
                <div className="flex flex-col gap-3 h-full">
                  <div className="font-display text-white text-xl leading-tight">{selected.name}</div>
                  <div className="font-mono text-xs" style={{ color: '#555' }}>
                    Playtime: {formatTime(selected.playTime)}
                  </div>
                  <div className="flex flex-col gap-2 mt-auto">
                    <button onClick={() => {
                      const sv = loadSave(selected.id);
                      onStartWorld(selected.id, selected.name, sv?.state || null, false);
                    }}
                      className="py-3 border font-display tracking-widest transition-colors text-sm"
                      style={{ borderColor: '#ff2233', color: '#ff2233' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,34,51,0.1)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      PLAY SOLO
                    </button>
                    {isAnonymous ? (
                      <div className="py-2 border font-mono text-xs text-center"
                        style={{ borderColor: '#333', color: '#555' }}>
                        🔒 HOST CO-OP<br />
                        <span style={{ color: '#333' }}>Account required</span>
                      </div>
                    ) : (
                      <button onClick={() => {
                        const sv = loadSave(selected.id);
                        onStartWorld(selected.id, selected.name, sv?.state || null, true);
                      }}
                        className="py-3 border font-display tracking-widest transition-colors text-sm"
                        style={{ borderColor: '#cc33ff', color: '#cc33ff' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(204,51,255,0.1)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        HOST CO-OP
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full font-mono text-sm text-center"
                  style={{ color: '#333' }}>
                  ← SELECT<br />A WORLD
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Settings / Save Data */
          <div className="flex flex-col gap-3 border border-gray-800 p-6 bg-black/60 max-w-sm mx-auto">
            <div className="font-mono text-xs text-center mb-2" style={{ color: '#555' }}>
              Export all worlds to a .json file, or import a previously exported file.
              Importing merges with existing saves.
            </div>
            <button onClick={handleExport}
              className="py-3 border font-display transition-colors"
              style={{ borderColor: '#00ccff', color: '#00ccff' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,204,255,0.1)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              EXPORT ALL SAVES
            </button>
            <button onClick={() => fileInputRef.current?.click()}
              className="py-3 border font-display transition-colors"
              style={{ borderColor: '#cc33ff', color: '#cc33ff' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(204,51,255,0.1)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              IMPORT SAVES
            </button>
            <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={handleImport} />
          </div>
        )}
      </div>

      <Corners />
    </div>
  );
}

// ── Root Index ────────────────────────────────────────────────────────────────
type Screen = 'login' | 'login-register' | 'landing' | 'worlds' | 'game';

export default function Index() {
  const [screen, setScreen] = useState<Screen>('landing');
  const [hostedCode, setHostedCode] = useState<string | null>(null);
  const [isCreatingHost, setIsCreatingHost] = useState(false);
  const [worldParams, setWorldParams] = useState<{
    id: string; name: string; state: Partial<GameState> | null;
  } | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showCredits, setShowCredits] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);

  const [initialRoomCode] = useState(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash.replace('#', '') : '';
    return hash.toUpperCase().slice(0, 5);
  });

  const { initAudio, updateHeatMusic, updateRageAudio, playSFX, updateVehicleAudio } = useAudioSystem();

  const {
    canvasRef, stateRef, hudData, renderTick,
    performAttack, performSteal, performInteract, chooseDialogueOption,
    handleBuildingAction, closeBuildingWindow, setSFXCallback,
    handleBribe, handleGoToJail, handleSlotResult, closeSlotMachine,
    hostWorld, joinWorld,
    WORLD_W, WORLD_H, isPaused, togglePause, forceSave, toggleMap
  } = useGameEngine(worldParams?.id, worldParams?.name, worldParams?.state);

  // ── Mobile minimap tap → Pause + open full map ───────────────────────────
  // When the player taps the minimap on mobile, we pause the game and show
  // the full-map overlay (acting as the Pause Menu containing the map).
  const handleMobileMinimapTap = useCallback(() => {
    if (!stateRef.current) return;
    // Only open if the map is not already open
    if (!stateRef.current.fullMapOpen) {
      if (!stateRef.current.isPaused) togglePause();
      toggleMap();
    }
  }, [stateRef, togglePause, toggleMap]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Fetch cloud saves if logged in
        await fetchSavesFromFirebase();
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => { setSFXCallback(playSFX); }, [setSFXCallback, playSFX]);
  useEffect(() => { updateHeatMusic(hudData.heatLevel); }, [hudData.heatLevel, updateHeatMusic]);
  useEffect(() => { updateRageAudio(hudData.rageMode || false); }, [hudData.rageMode, updateRageAudio]);

  useEffect(() => {
    let animFrame: number;
    const loop = () => {
      if (stateRef.current) {
        const s = stateRef.current;
        const p = s.player;
        const vehiclesData = s.vehicles.map(v => {
          const dx = v.x - p.x;
          const dy = v.y - p.y;
          const dist = Math.hypot(dx, dy);
          const pan = Math.max(-1, Math.min(1, dx / 400));
          return {
            id: v.id,
            type: v.vehicleType || 'car',
            speed: v.vehicleSpeed || 0,
            engineOn: !!v.engineOn,
            distance: dist,
            pan: pan
          };
        });
        updateVehicleAudio(vehiclesData as any);
      }
      animFrame = requestAnimationFrame(loop);
    };
    animFrame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrame);
  }, [stateRef, updateVehicleAudio]);

  // Host a world: set hosting state first, navigate to game after code is ready
  const doHost = useCallback((id: string, name: string, state: Partial<GameState> | null) => {
    setWorldParams({ id, name, state });
    setIsCreatingHost(true);
    hostWorld('Player 1').then(code => {
      if (code) {
        setHostedCode(code);
        setScreen('landing');
        window.location.hash = code;
      }
      setIsCreatingHost(false);
    }).catch(() => setIsCreatingHost(false));
  }, [hostWorld]);

  const handleStartWorld = useCallback((
    id: string, name: string,
    state: Partial<GameState> | null,
    isHost: boolean,
  ) => {
    if (isHost) {
      doHost(id, name, state);
      // Stay on worlds/landing screen until user clicks "Start Co-op"
    } else {
      setWorldParams({ id, name, state });
      setScreen('game');
      initAudio();
    }
  }, [doHost, initAudio]);

  const handleStartHosted = useCallback(() => {
    setScreen('game');
    initAudio();
  }, [initAudio]);

  const handleJoin = useCallback((code: string) => {
    setWorldParams(null);
    joinWorld(code, 'Player 2').then(success => {
      if (success) {
        window.location.hash = code;
        setScreen('game');
        initAudio();
      } else {
        setDialog({
          isOpen: true,
          title: 'CONNECTION FAILED',
          message: 'Room not found or error joining.',
          type: 'alert'
        });
        window.location.hash = '';
      }
    });
  }, [joinWorld, initAudio, setDialog]);

  const handleExitToMenu = useCallback(() => {
    forceSave();
    updateRageAudio(false);
    updateVehicleAudio([]); // silence any engine noises as well
    setScreen('worlds');
    setWorldParams(null);
    setHostedCode(null);
    window.location.hash = '';
  }, [forceSave, updateRageAudio, updateVehicleAudio]);

  const handleJoystick = useCallback((x: number, y: number) => {
    if (stateRef.current) stateRef.current.touches.joystick = { x, y };
  }, [stateRef]);

  const handleJoystickEnd = useCallback(() => {
    if (stateRef.current) stateRef.current.touches.joystick = null;
  }, [stateRef]);

  // ── Screen routing ─────────────────────────────────────────────────────────

  if (authLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black">
        <div className="font-display text-2xl text-[#00ccff] animate-pulse">CONNECTING TO NETWORK...</div>
      </div>
    );
  }

  if (showCredits) {
    return <CreditsPage onBack={() => setShowCredits(false)} />;
  }

  const isAnonymous = user?.isAnonymous ?? false;

  if (screen === 'login') {
    return (
      <>
        <LoginScreen onLoginSuccess={() => setScreen('landing')} />
        <CustomDialog dialog={dialog} onClose={() => setDialog(null)} />
      </>
    );
  }

  if (screen === 'login-register') {
    return (
      <>
        <LoginScreen initialMode="register" onLoginSuccess={() => setScreen('landing')} />
        <CustomDialog dialog={dialog} onClose={() => setDialog(null)} />
      </>
    );
  }

  if (screen === 'landing') {
    return (
      <>
        <LandingScreen
          onPlay={async () => {
            // Firebase's onAuthStateChanged might take a moment.
            // Check if we already have a persistent user session.
            if (!auth.currentUser) {
              try {
                const { signInAnonymously } = await import('firebase/auth');
                await signInAnonymously(auth);
              } catch (err) {
                console.error("Auto-login failed:", err);
                // We can still try to move to worlds, but it might fail.
              }
            }
            setScreen('worlds');
          }}
          onHost={() => {
            const id = generateSaveId();
            doHost(id, 'New World', null);
          }}
          onJoin={handleJoin}
          isCreatingHost={isCreatingHost}
          hostedCode={hostedCode}
          onStartHosted={handleStartHosted}
          initialRoomCode={initialRoomCode}
          isAnonymous={isAnonymous}
          isLoggedIn={!!user}
          onUpgradeAccount={() => setScreen('login-register')}
          onShowCredits={() => setShowCredits(true)}
          onLogout={() => import('@/lib/firebase').then(m => m.auth.signOut())}
          onShowDialog={setDialog}
        />
        <CustomDialog dialog={dialog} onClose={() => setDialog(null)} />
      </>
    );
  }

  if (screen === 'worlds') {
    return (
      <>
        <WorldsScreen
          onStartWorld={handleStartWorld}
          onBack={() => setScreen('landing')}
          isAnonymous={isAnonymous}
          onShowDialog={setDialog}
        />
        <CustomDialog dialog={dialog} onClose={() => setDialog(null)} />
      </>
    );
  }

  // ── Game ───────────────────────────────────────────────────────────────────
  return (
    // touch-action: none prevents the browser from handling gestures (scroll/zoom)
    // on the game canvas, giving full control to our custom touch handlers.
    <div className={`fixed inset-0 overflow-hidden scanlines ${hudData.rageMode ? 'animate-rage' : ''}`}
      style={{ background: '#050507', touchAction: 'none' }}>
      <GameCanvas canvasRef={canvasRef} stateRef={stateRef} renderTick={renderTick} WORLD_W={WORLD_W} WORLD_H={WORLD_H} toggleMap={toggleMap} onExitGame={handleExitToMenu} onPause={handleMobileMinimapTap} />

      {/*
        ── Mobile Minimap Tap Target (DOM layer) ──────────────────────────────
        The PixiJS Stage canvas has `pointer-events: none` CSS, so the browser
        never delivers touch events to it, meaning PixiJS can never fire its
        internal pointer handlers on the minimap Graphics object.
        Solution: place a transparent DOM div exactly over the minimap position.
        On mobile it intercepts taps and opens the Pause/Map overlay.
        On desktop it is hidden (pointer-events: none) so the keyboard shortcut
        and the existing toggleMap flow are unaffected.
      */}
      <div
        className="hide-on-non-touch"
        onClick={handleMobileMinimapTap}
        style={{
          position: 'fixed',
          top: 10,
          right: 10,
          width: 140,
          height: 140,
          zIndex: 25,        // Above canvas (z-20) but below HUD panels (z-30)
          cursor: 'pointer',
          // Transparent — only here to capture touch/pointer events
          background: 'transparent',
          // Allow the browser to dispatch pointer events on this element
          touchAction: 'manipulation',
          WebkitTapHighlightColor: 'transparent',  // no blue flash on iOS
        }}
        aria-label="Open map"
      />
      {hudData.rageMode && <div className="rage-overlay" />}

      <CustomDialog dialog={dialog} onClose={() => setDialog(null)} />

      <GameHUD
        precepts={hudData.precepts}
        chaosLevel={hudData.chaosLevel}
        heatLevel={hudData.heatLevel}
        rageMode={hudData.rageMode}
        health={hudData.health}
        maxHealth={hudData.maxHealth}
        score={hudData.score}
        stealthMode={hudData.stealthMode}
        glitchIntensity={hudData.glitchIntensity}
        inventory={hudData.inventory}
        bossHealth={hudData.bossHealth}
        bossMaxHealth={hudData.bossMaxHealth}
        bossActive={hudData.bossActive}
        nearBuilding={hudData.nearBuilding}
        buildingWindowOpen={hudData.buildingWindowOpen}
        contacts={hudData.contacts}
        activeMission={hudData.activeMission}
        barFight={hudData.barFight}
        hideTimer={hudData.hideTimer}
        playerVehicle={hudData.playerVehicle}
        nearVehicle={hudData.nearVehicle}
      />


      {hudData.activeDialogue && (
        <DialogueSystem node={hudData.activeDialogue.node} onChoose={chooseDialogueOption} />
      )}

      {hudData.buildingWindowOpen && hudData.nearBuilding && (
        <BuildingInteractionWindow
          buildingName={hudData.nearBuilding.name}
          buildingType={hudData.nearBuilding.type}
          playerCash={hudData.inventory.cash}
          playerWeapons={hudData.inventory.weapons}
          playerHealth={hudData.health}
          playerMaxHealth={hudData.maxHealth}
          onAction={handleBuildingAction}
          onClose={closeBuildingWindow}
        />
      )}

      {hudData.arrestState === 'caught' && (
        <ArrestOverlay
          heatLevel={hudData.heatLevel}
          copRank={stateRef.current?.arrestingCop?.rank || 1}
          playerCash={hudData.inventory.cash}
          onBribe={handleBribe}
          onJail={handleGoToJail}
          timer={hudData.arrestTimer}
        />
      )}

      {hudData.arrestState === 'jailed' && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center pointer-events-none"
          style={{ background: 'rgba(0,0,0,0.8)' }}>
          <div className="font-display text-6xl md:text-8xl animate-flicker select-none"
            style={{ color: '#3377ff', textShadow: '0 0 30px #3377ff', letterSpacing: '0.15em' }}>
            ⛓ JAILED
          </div>
          <div className="font-mono-game mt-4 text-sm" style={{ color: 'rgba(255,255,255,0.4)', letterSpacing: '0.2em' }}>
            SERVING TIME... {Math.ceil(Math.max(0, hudData.jailTimer) / 60)}s
          </div>
          <div className="mt-4 font-display text-base" style={{ color: 'rgba(51,119,255,0.5)', letterSpacing: '0.1em' }}>
            -20% CASH · ALL WEAPONS CONFISCATED · HEAT REDUCED
          </div>
        </div>
      )}

      {hudData.slotMachineOpen && (
        <SlotMachine playerCash={hudData.inventory.cash} onResult={handleSlotResult} onClose={closeSlotMachine} />
      )}

      <MobileControls
        onJoystick={handleJoystick}
        onJoystickEnd={handleJoystickEnd}
        onAttack={performAttack}
        onSteal={performSteal}
        onInteract={performInteract}
      />

      {hudData.playerDead && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center pointer-events-none"
          style={{ background: 'rgba(0,0,0,0.75)' }}>
          <div className="font-display text-7xl md:text-9xl animate-flicker select-none"
            style={{ color: '#ff2233', textShadow: '0 0 30px #ff2233', letterSpacing: '0.15em' }}>
            YOU DIED
          </div>
          <div className="font-mono-game mt-6 text-sm" style={{ color: 'rgba(255,255,255,0.4)', letterSpacing: '0.2em' }}>
            RESPAWNING IN {Math.ceil(Math.max(0, hudData.deathTimer) / 60)}...
          </div>
          <div className="mt-4 font-display text-base" style={{ color: 'rgba(255,34,51,0.5)', letterSpacing: '0.1em' }}>
            SCORE: {hudData.score}
          </div>
        </div>
      )}

      {/* ── Full Map DOM Overlay ─────────────────────────────────────── */}
      {hudData.fullMapOpen && stateRef.current && (() => {
        const s = stateRef.current!;
        const WORLD_W_val = WORLD_W;
        const WORLD_H_val = WORLD_H;
        return (
          <FullMapDOMOverlay
            s={s}
            WORLD_W={WORLD_W_val}
            WORLD_H={WORLD_H_val}
            onClose={toggleMap}
            onExitGame={handleExitToMenu}
          />
        );
      })()}
    </div>
  );
}

// ── Full Map DOM Overlay Component ────────────────────────────────────────────
function FullMapDOMOverlay({ s, WORLD_W, WORLD_H, onClose, onExitGame }: {
  s: any; WORLD_W: number; WORLD_H: number;
  onClose: () => void; onExitGame: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1.5);
  const [pan, setPan] = useState({ x: -s.player.x, y: -s.player.y });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const [selectedEntity, setSelectedEntity] = useState<any | null>(null);

  // ── Pinch-to-zoom state ───────────────────────────────────────────────────
  // lastPinchDist: distance between two fingers on last touchmove (null = not pinching)
  const lastPinchDist = useRef<number | null>(null);
  // isPinching: true when 2+ touch points are active (suppress pan during pinch)  
  const isPinching = useRef(false);

  const W = window.innerWidth;
  const H = window.innerHeight;
  const mapW = Math.min(W * 0.88, H * 0.88);
  const mapH = mapW;
  const startX = (W - mapW) / 2;
  const startY = (H - mapH) / 2;
  const mapScale = (mapW / WORLD_W) * zoom;

  const toMapX = (worldX: number) => startX + mapW / 2 + (worldX + pan.x) * mapScale;
  const toMapY = (worldY: number) => startY + mapH / 2 + (worldY + pan.y) * mapScale;

  // Draw map on canvas
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    cvs.width = W;
    cvs.height = H;

    // Dark overlay
    ctx.fillStyle = 'rgba(0,0,0,0.88)';
    ctx.fillRect(0, 0, W, H);

    // Map bounding box
    ctx.strokeStyle = 'rgba(255,51,170,0.5)';
    ctx.lineWidth = 2;
    ctx.fillStyle = 'rgba(7,7,9,0.9)';
    ctx.beginPath();
    ctx.rect(startX, startY, mapW, mapH);
    ctx.fill();
    ctx.stroke();

    // Clip to map area
    ctx.save();
    ctx.beginPath();
    ctx.rect(startX, startY, mapW, mapH);
    ctx.clip();

    // Draw region labels
    const regions = [
      { x: WORLD_W / 2, y: WORLD_H / 2, name: 'NEON CITY' },
      { x: WORLD_W / 2, y: WORLD_H * 0.15, name: 'THE CITADEL' },
      { x: WORLD_W / 2, y: WORLD_H * 0.85, name: 'DREAD SECTOR' },
      { x: WORLD_W * 0.85, y: WORLD_H / 2, name: 'VIPER DISTRICT' },
      { x: WORLD_W * 0.15, y: WORLD_H / 2, name: 'GHOST SECTOR' },
    ];
    for (const r of regions) {
      const rx = toMapX(r.x);
      const ry = toMapY(r.y);
      if (rx < startX - 100 || rx > startX + mapW + 100 || ry < startY - 30 || ry > startY + mapH + 30) continue;
      ctx.fillStyle = 'rgba(34,51,68,0.45)';
      ctx.fillRect(rx - 80 * zoom, ry - 14 * zoom, 160 * zoom, 28 * zoom);
      ctx.strokeStyle = 'rgba(0,204,255,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(rx - 16 * zoom, ry); ctx.lineTo(rx + 16 * zoom, ry);
      ctx.moveTo(rx, ry - 16 * zoom); ctx.lineTo(rx, ry + 16 * zoom);
      ctx.stroke();
      ctx.fillStyle = 'rgba(0,204,255,0.7)';
      ctx.font = `${Math.max(9, 11 * zoom)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(r.name, rx, ry);
    }

    // Draw buildings
    for (const e of s.entities) {
      const mx = toMapX(e.x);
      const my = toMapY(e.y);
      if (mx < startX - 20 || mx > startX + mapW + 20 || my < startY - 20 || my > startY + mapH + 20) continue;
      if (e.type === 'building') {
        const bw = e.width * mapScale;
        const bh = e.height * mapScale;
        if (selectedEntity && selectedEntity.id === e.id) {
          ctx.strokeStyle = '#00ff88';
          ctx.lineWidth = 2;
          ctx.fillStyle = 'rgba(68,85,102,0.85)';
        } else {
          ctx.strokeStyle = 'transparent';
          ctx.fillStyle = 'rgba(68,85,102,0.6)';
        }
        ctx.beginPath();
        ctx.rect(mx - bw / 2, my - bh / 2, bw, bh);
        ctx.fill();
        if (selectedEntity && selectedEntity.id === e.id) ctx.stroke();
      } else if (e.type === 'cop' && e.aiState !== 'dead') {
        ctx.fillStyle = '#3377ff';
        ctx.beginPath();
        ctx.arc(mx, my, 3 * Math.max(1, zoom * 0.5), 0, Math.PI * 2);
        ctx.fill();
      } else if (e.type === 'boss' && e.aiState !== 'dead') {
        ctx.fillStyle = '#ff0044';
        ctx.beginPath();
        ctx.arc(mx, my, 4 * Math.max(1, zoom * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw remote players
    if (s.visualRemotePlayers) {
      for (const id in s.visualRemotePlayers) {
        const rp = s.visualRemotePlayers[id];
        if (!rp.dead) {
          ctx.fillStyle = '#00ccff';
          ctx.beginPath();
          ctx.arc(toMapX(rp.x), toMapY(rp.y), 5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Draw local player (golden dot)
    const px = toMapX(s.player.x);
    const py = toMapY(s.player.y);
    ctx.fillStyle = '#ffaa00';
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();

    // MAP TITLE
    ctx.fillStyle = 'rgba(0,204,255,0.85)';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('WORLD MAP — SCROLL TO ZOOM • DRAG TO PAN • CLICK BUILDING FOR INFO', W / 2, startY - 22);

    // Map border
    ctx.strokeStyle = 'rgba(0,204,255,0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(startX, startY, mapW, mapH);

  }, [zoom, pan.x, pan.y, s.entities, s.player.x, s.player.y, selectedEntity, W, H]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const dir = e.deltaY > 0 ? -0.12 : 0.12;
    setZoom(z => Math.min(Math.max(0.4, z + dir), 5.0));
  };

  // ── Touch gesture handlers (mobile pinch-to-zoom + swipe-to-pan) ─────────
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault(); // prevent page scroll / browser zoom
    if (e.touches.length === 2) {
      // Two fingers — begin pinch gesture
      isPinching.current = true;
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      lastPinchDist.current = Math.hypot(dx, dy);
    } else if (e.touches.length === 1 && !isPinching.current) {
      // Single finger — begin swipe-to-pan
      setIsDragging(true);
      dragStart.current = {
        x: e.touches[0].clientX - pan.x,
        y: e.touches[0].clientY - pan.y,
      };
    }
  }, [pan.x, pan.y]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault(); // prevent page scroll during map gesture
    if (e.touches.length === 2) {
      // Pinch-to-zoom: compare current pinch distance vs last frame
      isPinching.current = true;
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      const newDist = Math.hypot(dx, dy);
      if (lastPinchDist.current !== null) {
        const delta = newDist - lastPinchDist.current;
        // Scale factor: 0.005 per pixel of pinch change gives smooth zoom
        const zoomDelta = delta * 0.005;
        setZoom(z => Math.min(Math.max(0.4, z + zoomDelta), 5.0));
      }
      lastPinchDist.current = newDist;
    } else if (e.touches.length === 1 && !isPinching.current && isDragging) {
      // Single-finger swipe-to-pan (only when not in a pinch gesture)
      setPan({
        x: e.touches[0].clientX - dragStart.current.x,
        y: e.touches[0].clientY - dragStart.current.y,
      });
    }
  }, [isDragging]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      // One or zero fingers remaining — reset pinch state
      lastPinchDist.current = null;
      isPinching.current = false;
    }
    if (e.touches.length === 0) {
      setIsDragging(false);
    }
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setPan({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    // Check click (short drag)
    const dx = e.clientX - (dragStart.current.x + pan.x);
    const dy = e.clientY - (dragStart.current.y + pan.y);
    if (Math.hypot(dx, dy) < 5) {
      const worldClickX = (((e.clientX - startX) - mapW / 2) / mapScale) - pan.x;
      const worldClickY = (((e.clientY - startY) - mapH / 2) / mapScale) - pan.y;
      let found: any = null;
      for (const ent of s.entities) {
        if (ent.type === 'building') {
          const hw = ent.width / 2 + 10;
          const hh = ent.height / 2 + 10;
          if (Math.abs(worldClickX - ent.x) < hw && Math.abs(worldClickY - ent.y) < hh) { found = ent; break; }
        }
      }
      setSelectedEntity(found);
    }
  };

  return (
    <div className="fixed inset-0 z-[200]"
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      style={{
        cursor: isDragging ? 'grabbing' : 'grab',
        backdropFilter: 'blur(2px)',
        // Prevent native browser pinch-zoom and page scroll while interacting with the map
        touchAction: 'none',
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }} />

      {/* Selected entity info card */}
      {selectedEntity && (
        <div className="absolute z-[210] p-4 rounded-lg shadow-2xl animate-fade-in"
          style={{
            top: startY + 16, right: W - startX - mapW + 16,
            width: 260,
            background: 'linear-gradient(135deg, rgba(20,20,30,0.97), rgba(10,10,15,0.99))',
            border: '1px solid rgba(0,255,136,0.35)',
            boxShadow: '0 0 20px rgba(0,0,0,0.9), inset 0 0 10px rgba(0,255,136,0.1)',
            pointerEvents: 'none'
          }}>
          <div className="font-display text-base tracking-widest text-[#00ff88] mb-1">{selectedEntity.label?.toUpperCase() || selectedEntity.buildingType?.toUpperCase() || 'STRUCTURE'}</div>
          <div className="font-mono-game text-[10px] text-[#00ccff] uppercase tracking-wider mb-3">{selectedEntity.buildingType || 'CLASSIFIED'}</div>
          <div className="font-display text-[10px] text-[#555] mb-1">LOCATION DATA</div>
          <div className="font-mono-game text-xs text-[#aaa] mb-3">LAT: {(selectedEntity.y / WORLD_H * 100).toFixed(2)}° · LON: {(selectedEntity.x / WORLD_W * 100).toFixed(2)}°</div>
          <div className="p-2 bg-[#00000066] rounded border border-[#333] font-mono-game text-[10px] text-[#888] leading-relaxed">
            {selectedEntity.buildingType === 'shop' && 'COMMERCIAL SECTOR. Registered vendor for local goods.'}
            {selectedEntity.buildingType === 'safehouse' && 'RESTRICTED ACCESS. Known operational safehouse.'}
            {selectedEntity.buildingType === 'landmark' && 'CULTURAL HERITAGE SITE. Anomalous activity detected.'}
            {selectedEntity.buildingType === 'void' && 'VOID BAR. Unregulated. High criminal encounter rate.'}
            {selectedEntity.buildingType === 'police_station' && 'POLICE HQ. Surrender is advised.'}
            {!selectedEntity.buildingType && 'STANDARD ARCHITECTURE. No remarkable signatures.'}
          </div>
        </div>
      )}

      {/* CLOSE / RESUME button */}
      <button
        className="absolute z-[210] px-5 py-2.5 font-display tracking-widest text-sm"
        style={{
          top: startY - 2,
          right: W - startX - mapW,
          border: '2px solid rgba(0,204,255,0.6)',
          color: '#00ccff',
          background: 'linear-gradient(135deg, rgba(20,20,30,0.96), rgba(10,10,15,0.98))',
          boxShadow: '0 0 10px rgba(0,204,255,0.15)',
          cursor: 'pointer'
        }}
        onClick={onClose}>
        ✕ CLOSE MAP
      </button>

      {/* SAVE & EXIT button */}
      <button
        className="absolute z-[210] px-5 py-2.5 font-display tracking-widest text-sm"
        style={{
          top: startY - 2,
          left: startX,
          border: '2px solid #ff2233',
          color: '#ff2233',
          background: 'linear-gradient(135deg, rgba(20,20,30,0.96), rgba(10,10,15,0.98))',
          boxShadow: '0 0 10px rgba(255,34,51,0.15)',
          cursor: 'pointer'
        }}
        onClick={() => { onExitGame(); }}>
        ⬛ SAVE & EXIT
      </button>

      {/* Zoom controls */}
      <div className="absolute z-[210] flex flex-col gap-1"
        style={{ bottom: H - startY - mapH + 12, right: W - startX - mapW + 8 }}>
        <button
          className="w-9 h-9 font-display text-lg text-[#00ccff] flex items-center justify-center"
          style={{ border: '1px solid rgba(0,204,255,0.3)', background: 'rgba(10,10,20,0.9)', cursor: 'pointer' }}
          onClick={() => setZoom(z => Math.min(5, z + 0.3))}>+</button>
        <button
          className="w-9 h-9 font-display text-lg text-[#00ccff] flex items-center justify-center"
          style={{ border: '1px solid rgba(0,204,255,0.3)', background: 'rgba(10,10,20,0.9)', cursor: 'pointer' }}
          onClick={() => setZoom(z => Math.max(0.4, z - 0.3))}>−</button>
      </div>
    </div>
  );
}
