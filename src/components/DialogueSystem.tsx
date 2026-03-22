import { DialogueNode } from '@/hooks/useGameEngine';

interface Props {
  node: DialogueNode;
  onChoose: (index: number) => void;
}

export default function DialogueSystem({ node, onChoose }: Props) {
  return (
    <div className="absolute bottom-0 left-0 right-0 z-40 p-4 md:p-6">
      <div className="dialogue-box rounded-t-lg max-w-2xl mx-auto">
        {/* Speaker */}
        <div className="flex items-center gap-3 px-5 pt-4 pb-2 border-b" style={{ borderColor: 'rgba(0,204,255,0.15)' }}>
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-display"
            style={{ background: 'rgba(0,204,255,0.1)', border: '1px solid rgba(0,204,255,0.4)', color: '#00ccff' }}
          >
            {node.speaker[0]}
          </div>
          <span
            className="font-display text-sm tracking-widest"
            style={{ color: '#00ccff', textShadow: '0 0 10px rgba(0,204,255,0.5)' }}
          >
            {node.speaker}
          </span>
          <div className="ml-auto font-mono-game text-xs" style={{ color: 'rgba(0,204,255,0.4)' }}>
            INTERCOM ◉
          </div>
        </div>

        {/* Dialogue text */}
        <div className="px-5 py-3">
          <p
            className="font-ui text-sm leading-relaxed"
            style={{ color: 'rgba(255,255,255,0.85)' }}
          >
            "{node.text}"
          </p>
        </div>

        {/* Options */}
        <div className="px-5 pb-4 space-y-1.5">
          {node.options.map((opt, i) => (
            <button
              key={i}
              onClick={() => onChoose(i)}
              className={`dialogue-option w-full text-left px-3 py-2 rounded text-sm flex items-start gap-2 ${opt.isLie ? 'lie-option' : ''}`}
            >
              <span
                className="font-mono-game text-xs mt-0.5 shrink-0"
                style={{ color: opt.isLie ? 'rgba(255,34,51,0.5)' : 'rgba(0,204,255,0.5)' }}
              >
                [{i + 1}]
              </span>
              <span className="flex-1">{opt.text}</span>
              {opt.isLie && (
                <span
                  className="font-display text-xs shrink-0 px-1.5 py-0.5 rounded"
                  style={{
                    background: 'rgba(255,34,51,0.1)',
                    border: '1px solid rgba(255,34,51,0.3)',
                    color: '#ff2233',
                    letterSpacing: '0.1em',
                  }}
                >
                  LIE
                </span>
              )}
              {opt.consequence && !opt.isLie && (
                <span
                  className="font-display text-xs shrink-0 px-1.5 py-0.5 rounded"
                  style={{
                    background: 'rgba(204,51,255,0.1)',
                    border: '1px solid rgba(204,51,255,0.3)',
                    color: '#cc33ff',
                    letterSpacing: '0.1em',
                  }}
                >
                  SIN
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="px-5 pb-3 flex justify-end">
          <span className="font-mono-game text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>
            [F] CLOSE
          </span>
        </div>
      </div>
    </div>
  );
}
