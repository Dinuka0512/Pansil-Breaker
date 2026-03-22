import { useState, useEffect, useRef } from 'react';
import { auth } from '@/lib/firebase';
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signInAnonymously,
    updateProfile
} from 'firebase/auth';

interface LoginScreenProps {
    onLoginSuccess: () => void;
    initialMode?: 'login' | 'register';
}

export default function LoginScreen({ onLoginSuccess, initialMode = 'login' }: LoginScreenProps) {
    const [mode, setMode] = useState<'login' | 'register'>(initialMode);
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [scale, setScale] = useState(1);
    const [negativeMargin, setNegativeMargin] = useState(0);
    const cardRef = useRef<HTMLDivElement>(null);

    // Auto-scale the entire wrapper to always fit the viewport — no scroll ever.
    useEffect(() => {
        const recalc = () => {
            const el = cardRef.current;
            if (!el) return;
            // Temporarily remove transform so we read the natural size
            el.style.transform = 'none';
            el.style.marginTop = '0';
            el.style.marginBottom = '0';
            const naturalH = el.offsetHeight;
            const naturalW = el.offsetWidth;
            const vH = window.innerHeight;
            const vW = window.innerWidth;
            const s = Math.min(1, (vH - 16) / naturalH, (vW - 16) / naturalW);
            // Negative margin collapses the extra space the element occupies
            // after being visually scaled down (layout space stays = naturalH).
            const nm = (naturalH * (s - 1)) / 2; // negative when s < 1
            setScale(s);
            setNegativeMargin(nm);
        };
        recalc();
        window.addEventListener('resize', recalc);
        return () => window.removeEventListener('resize', recalc);
    }, [mode, error]);

    const btnStyle = (color: string) => ({
        background: 'transparent',
        border: `2px solid ${color}`,
        color,
        textShadow: `0 0 10px ${color}80`,
        boxShadow: `0 0 20px ${color}33, inset 0 0 20px ${color}0d`,
        letterSpacing: '0.1em',
    });

    const btnHover = (color: string, el: HTMLButtonElement) => {
        el.style.background = `${color}1a`;
        el.style.boxShadow = `0 0 40px ${color}80, inset 0 0 30px ${color}1a`;
    };

    const btnLeave = (color: string, el: HTMLButtonElement) => {
        el.style.background = 'transparent';
        el.style.boxShadow = `0 0 20px ${color}33, inset 0 0 20px ${color}0d`;
    };

    const handleEmailAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            if (mode === 'register') {
                if (!username.trim()) {
                    throw new Error('Username is required for registration.');
                }
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                await updateProfile(userCredential.user, { displayName: username });
            } else {
                await signInWithEmailAndPassword(auth, email, password);
            }
            onLoginSuccess();
        } catch (err: any) {
            setError(err.message || 'Authentication failed.');
        } finally {
            setLoading(false);
        }
    };

    const handleOfflinePlay = async () => {
        setError('');
        setLoading(true);
        try {
            sessionStorage.removeItem('guest_logged_out');
            await signInAnonymously(auth);
            onLoginSuccess();
        } catch (err: any) {
            setError(err.message || 'Could not start offline session.');
            setLoading(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 scanlines overflow-hidden flex flex-col items-center justify-center"
            style={{ background: 'radial-gradient(ellipse at center, #0d0005 0%, #050005 60%, #000 100%)' }}
        >
            {/* Wrapper — flex centers it naturally; negative margins collapse
                the extra layout space left behind after scale shrinks it. */}
            <div
                ref={cardRef}
                style={{
                    width: 'min(380px, 96vw)',
                    transform: `scale(${scale})`,
                    transformOrigin: 'center center',
                    marginTop: `${negativeMargin}px`,
                    marginBottom: `${negativeMargin}px`,
                }}
            >
                {/* Title */}
                <div className="text-center mb-4 select-none">
                    <div
                        className="font-display animate-flicker"
                        style={{
                            color: '#00ccff',
                            textShadow: '0 0 20px #00ccff, 0 0 60px rgba(0,204,255,0.5)',
                            letterSpacing: '0.15em',
                            fontSize: '1.75rem',
                        }}
                    >
                        SYSTEM ACCESS
                    </div>
                </div>

                {/* Card */}
                <div
                    className="relative border border-gray-800 bg-black/60 backdrop-blur-md p-4"
                    style={{ boxShadow: '0 0 30px rgba(0, 204, 255, 0.1)' }}
                >
                    {/* Decorative corners */}
                    <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-[#00ccff]" />
                    <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-[#00ccff]" />
                    <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-[#00ccff]" />
                    <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-[#00ccff]" />

                    {/* Two-column layout: inputs left, buttons right */}
                    <form onSubmit={handleEmailAuth} className="flex flex-row gap-3">

                        {/* LEFT — input fields */}
                        <div className="flex flex-col gap-3 flex-1 min-w-0">
                            {mode === 'register' && (
                                <input
                                    type="text"
                                    placeholder="USERNAME"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    required
                                    className="w-full bg-black/50 border border-gray-700 text-white font-mono px-3 py-2 focus:outline-none focus:border-[#00ccff] transition-colors"
                                    style={{ fontSize: '0.8rem' }}
                                />
                            )}
                            <input
                                type="email"
                                placeholder="EMAIL ALIAS"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className="w-full bg-black/50 border border-gray-700 text-white font-mono px-3 py-2 focus:outline-none focus:border-[#00ccff] transition-colors"
                                style={{ fontSize: '0.8rem' }}
                            />
                            <input
                                type="password"
                                placeholder="SECURITY KEY"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                className="w-full bg-black/50 border border-gray-700 text-white font-mono px-3 py-2 focus:outline-none focus:border-[#00ccff] transition-colors"
                                style={{ fontSize: '0.8rem' }}
                            />
                            {error && (
                                <div className="text-[#ff2233] font-mono text-xs text-center border border-[#ff2233]/30 p-1 bg-[#ff2233]/10 leading-tight">
                                    {error}
                                </div>
                            )}
                        </div>

                        {/* RIGHT — action buttons */}
                        <div className="flex flex-col gap-2 justify-between" style={{ width: '44%', minWidth: '120px' }}>

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full font-display py-2 transition-all duration-200"
                                style={{ ...btnStyle('#00ccff'), opacity: loading ? 0.5 : 1, fontSize: '0.85rem' }}
                                onMouseEnter={e => !loading && btnHover('#00ccff', e.currentTarget)}
                                onMouseLeave={e => !loading && btnLeave('#00ccff', e.currentTarget)}
                            >
                                {loading ? 'LOADING...' : (mode === 'login' ? 'LOGIN' : 'REGISTER')}
                            </button>

                            <div className="flex items-center gap-2 font-mono text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                                <div className="flex-1 border-t border-gray-800" />
                                <span>OR</span>
                                <div className="flex-1 border-t border-gray-800" />
                            </div>

                            <button
                                type="button"
                                onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
                                className="font-mono hover:text-white transition-colors text-center leading-tight"
                                style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.7rem' }}
                            >
                                {mode === 'login' ? <>CREATE<br />ACCOUNT</> : <>LOGIN TO<br />ACCOUNT</>}
                            </button>

                            <div
                                className="border border-gray-800 p-2 flex flex-col gap-1"
                                style={{ background: 'rgba(255,255,255,0.02)' }}
                            >
                                <button
                                    type="button"
                                    onClick={handleOfflinePlay}
                                    disabled={loading}
                                    className="py-1.5 border border-gray-700 hover:border-[#cc33ff] hover:text-[#cc33ff] transition-colors font-mono leading-tight"
                                    style={{ fontSize: '0.65rem' }}
                                >
                                    PLAY OFFLINE<br />
                                    <span style={{ fontSize: '0.85em', opacity: 0.7 }}>(No Account)</span>
                                </button>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}


