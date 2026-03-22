import { useRef, useCallback } from 'react';

interface Props {
  onJoystick: (x: number, y: number) => void;
  onJoystickEnd: () => void;
  onAttack: () => void;
  onSteal: () => void;
  onInteract: () => void;
}

export default function MobileControls({ onJoystick, onJoystickEnd, onAttack, onSteal, onInteract }: Props) {
  const joystickRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const touchIdRef = useRef<number | null>(null);
  const basePos = useRef({ x: 0, y: 0 });
  const RADIUS = 50;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const touch = e.changedTouches[0];
    touchIdRef.current = touch.identifier;
    const rect = joystickRef.current!.getBoundingClientRect();
    basePos.current = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier !== touchIdRef.current) continue;
      const dx = touch.clientX - basePos.current.x;
      const dy = touch.clientY - basePos.current.y;
      const len = Math.hypot(dx, dy);
      const clamped = Math.min(len, RADIUS);
      const nx = len > 0 ? dx / len : 0;
      const ny = len > 0 ? dy / len : 0;

      if (knobRef.current) {
        knobRef.current.style.transform = `translate(${nx * clamped}px, ${ny * clamped}px)`;
      }
      onJoystick(nx, ny);
    }
  }, [onJoystick]);

  const handleTouchEnd = useCallback(() => {
    touchIdRef.current = null;
    if (knobRef.current) knobRef.current.style.transform = 'translate(0, 0)';
    onJoystickEnd();
  }, [onJoystickEnd]);

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 pointer-events-none hide-on-non-touch">
      <div className="flex justify-between items-end px-6 pb-6 w-full pointer-events-auto">
        {/* Joystick */}
        <div
          ref={joystickRef}
          className="joystick-base rounded-full flex items-center justify-center relative"
          style={{ width: 110, height: 110 }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
        >
          <div
            ref={knobRef}
            className="joystick-knob rounded-full transition-transform will-change-transform"
            style={{
              width: 44,
              height: 44,
              transition: 'none',
            }}
          />
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-3 items-end">
          <div className="flex gap-3">
            <button
              className="action-btn rounded-full font-display text-xs flex items-center justify-center"
              style={{ width: 58, height: 58, fontSize: 13, letterSpacing: '0.05em' }}
              onTouchStart={(e) => { e.preventDefault(); onSteal(); }}
            >
              <div className="flex flex-col items-center leading-none gap-0.5">
                <span style={{ fontSize: 18 }}>💰</span>
                <span>STEAL</span>
              </div>
            </button>
            <button
              className="action-btn rounded-full font-display text-xs flex items-center justify-center"
              style={{ width: 58, height: 58, fontSize: 13, letterSpacing: '0.05em' }}
              onTouchStart={(e) => { e.preventDefault(); onInteract(); }}
            >
              <div className="flex flex-col items-center leading-none gap-0.5">
                {/* Renamed from TALK → INT (interact abbreviation for mobile space) */}
                <span style={{ fontSize: 18 }}>🗣</span>
                <span>INT</span>
              </div>
            </button>
          </div>
          <button
            className="action-btn action-btn-red rounded-full font-display flex items-center justify-center"
            style={{ width: 72, height: 72, fontSize: 13, letterSpacing: '0.05em' }}
            onTouchStart={(e) => { e.preventDefault(); onAttack(); }}
          >
            <div className="flex flex-col items-center leading-none gap-0.5">
              <span style={{ fontSize: 22 }}>⚔</span>
              <span>ATTACK</span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
