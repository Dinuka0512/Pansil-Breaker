import React from 'react';

interface CreditsPageProps {
    onBack: () => void;
}

export default function CreditsPage({ onBack }: CreditsPageProps) {
    const neonBlue = '#00ccff';
    const neonRed = '#ff2233';
    const neonPurple = '#cc33ff';
    const neonGreen = '#00ff88';

    const sectionStyle = "mb-12 text-center";
    const labelStyle = "font-mono-game text-[10px] uppercase tracking-[0.4em] mb-2 opacity-50";
    const valueStyle = "font-display text-2xl md:text-4xl tracking-widest";
    const linkStyle = "font-mono text-xs hover:text-white transition-all duration-300 opacity-60 hover:opacity-100 mt-2 inline-block";

    return (
        <div className="fixed inset-0 z-[100] flex flex-col items-center p-6 scanlines overflow-y-auto"
            style={{ background: 'radial-gradient(ellipse at center, #0d0005 0%, #050005 60%, #000 100%)' }}>

            {/* Decorative background element */}
            <div className="absolute inset-0 opacity-10 pointer-events-none"
                style={{
                    backgroundImage: `linear-gradient(${neonBlue}11 1px, transparent 1px), linear-gradient(90deg, ${neonBlue}11 1px, transparent 1px)`,
                    backgroundSize: '40px 40px'
                }}
            />

            {/* Content Container */}
            <div className="w-full max-w-2xl relative py-20 animate-fade-in flex flex-col items-center">

                {/* Game Title */}
                <div className="mb-20 text-center">
                    <div className="font-display text-5xl md:text-7xl mb-2 animate-flicker"
                        style={{ color: neonRed, textShadow: `0 0 20px ${neonRed}, 0 0 40px ${neonRed}80`, letterSpacing: '0.15em' }}>
                        PANSIL
                    </div>
                    <div className="font-display text-5xl md:text-7xl"
                        style={{ color: neonBlue, textShadow: `0 0 20px ${neonBlue}, 0 0 40px ${neonBlue}80`, letterSpacing: '0.15em' }}>
                        BREAKER
                    </div>
                </div>

                {/* Credits Sections */}
                <div className={sectionStyle}>
                    <div className={labelStyle} style={{ color: neonGreen }}>Created By</div>
                    <div className={valueStyle} style={{ color: '#fff' }}>KUMAR JAYARANGA</div>
                    <a href="https://kumarjayaranga.com" target="_blank" rel="noopener noreferrer" className={linkStyle} style={{ color: neonGreen }}>
                        WWW.KUMARJAYARANGA.COM
                    </a>
                </div>

                <div className={sectionStyle}>
                    <div className={labelStyle} style={{ color: neonPurple }}>Company</div>
                    <div className={valueStyle} style={{ color: '#fff' }}>TRINGLEDO (PVT) LTD</div>
                    <a href="https://tringledo.com" target="_blank" rel="noopener noreferrer" className={linkStyle} style={{ color: neonPurple }}>
                        WWW.TRINGLEDO.COM
                    </a>
                </div>

                <div className={sectionStyle}>
                    <div className={labelStyle} style={{ color: neonBlue }}>Developers</div>
                    <div className={valueStyle} style={{ color: '#fff' }}>KUMAR JAYARANGA</div>
                    <div className={valueStyle} style={{ color: '#fff' }}>UDA BHAGYA</div>
                    <div className={valueStyle} style={{ color: '#fff' }}>DINUKA LAKMAL</div>
                </div>

                <div className={sectionStyle}>
                    <div className={labelStyle} style={{ color: neonRed }}>Story Writers</div>
                    <div className={valueStyle} style={{ color: '#fff' }}>KUMAR JAYARANGA</div>
                    <div className={valueStyle} style={{ color: '#fff' }}>UDA BHAGYA</div>
                </div>

                {/* Engine Info */}
                <div className="mt-12 pt-12 border-t border-white/5 text-center w-full">
                    <div className="font-mono-game text-[9px] tracking-[0.2em] opacity-30">
                        POWERED BY CHAOS ENGINE v6.7<br />
                        © {new Date().getFullYear()} ALL SYSTEMS OPERATIONAL
                    </div>
                </div>

                {/* Back Button */}
                <button
                    onClick={onBack}
                    className="mt-16 font-display text-sm tracking-[0.3em] px-12 py-4 transition-all duration-300 relative group"
                    style={{
                        border: `2px solid ${neonRed}`,
                        color: neonRed,
                        background: 'transparent',
                        boxShadow: `0 0 20px ${neonRed}33`
                    }}
                    onMouseEnter={e => {
                        e.currentTarget.style.background = `${neonRed}1a`;
                        e.currentTarget.style.boxShadow = `0 0 40px ${neonRed}66, inset 0 0 20px ${neonRed}1a`;
                    }}
                    onMouseLeave={e => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.boxShadow = `0 0 20px ${neonRed}33`;
                    }}
                >
                    <span className="relative z-10">RETURN TO NEXUS</span>
                    {/* Decorative bracket detail */}
                    <div className="absolute -top-1 -left-1 w-2 h-2 border-t border-l border-white/40 group-hover:border-white transition-colors" />
                    <div className="absolute -bottom-1 -right-1 w-2 h-2 border-b border-r border-white/40 group-hover:border-white transition-colors" />
                </button>

            </div>
        </div>
    );
}
