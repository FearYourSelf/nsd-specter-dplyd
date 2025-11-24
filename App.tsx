
import React, { useState, useEffect, useRef } from 'react';
import Intro from './components/Intro';
import Generator from './components/Generator';
import { getClient } from './services/geminiService';
import { decodeBase64, decodeAudioData } from './services/audioUtils';

// --- PARTICLE SYSTEM ---
const ParticleBackground: React.FC<{ mousePos: {x: number, y: number} }> = ({ mousePos }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let particles: {x: number, y: number, vx: number, vy: number, size: number, alpha: number}[] = [];
        const particleCount = 40;

        const resize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            particles = [];
            for (let i = 0; i < particleCount; i++) {
                particles.push({
                    x: Math.random() * canvas.width,
                    y: Math.random() * canvas.height,
                    vx: (Math.random() - 0.5) * 0.2,
                    vy: (Math.random() - 0.5) * 0.2,
                    size: Math.random() * 1.5 + 0.5,
                    alpha: Math.random() * 0.5 + 0.1
                });
            }
        };
        resize();
        window.addEventListener('resize', resize);

        const animate = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            particles.forEach(p => {
                p.x += p.vx;
                p.y += p.vy;
                if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
                if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

                // Subtle parallax based on mouse
                const dx = p.x - (mousePos.x * window.innerWidth / 2 + window.innerWidth / 2);
                const dy = p.y - (mousePos.y * window.innerHeight / 2 + window.innerHeight / 2);
                const dist = Math.sqrt(dx*dx + dy*dy);
                
                let moveX = 0; 
                let moveY = 0;

                if (dist < 400) {
                    moveX = dx * 0.02;
                    moveY = dy * 0.02;
                }

                ctx.fillStyle = `rgba(220, 38, 38, ${p.alpha})`;
                ctx.beginPath();
                ctx.arc(p.x - moveX, p.y - moveY, p.size, 0, Math.PI * 2);
                ctx.fill();
            });

            requestAnimationFrame(animate);
        };
        animate();

        return () => window.removeEventListener('resize', resize);
    }, [mousePos]);

    return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none opacity-30 z-0" />;
};

const BootSequence: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setProgress(p => p >= 100 ? 100 : p + 4), 50); // Faster boot
    if(progress === 100) setTimeout(onComplete, 500);
    return () => clearInterval(i);
  }, [progress, onComplete]);

  return (
    <div className="fixed inset-0 z-50 bg-[#050505] flex flex-col items-center justify-center font-mono text-[10px] text-red-600">
       <div className="w-64 flex flex-col gap-2">
          <div className="flex justify-between opacity-50">
              <span>KERNEL_LOAD</span>
              <span>{progress}%</span>
          </div>
          <div className="h-0.5 bg-neutral-900 w-full overflow-hidden">
             <div className="h-full bg-red-600 transition-all duration-75" style={{ width: `${progress}%` }} />
          </div>
       </div>
    </div>
  );
};

const App: React.FC = () => {
  const [viewState, setViewState] = useState<'INTRO' | 'BOOT' | 'LOGIN' | 'APP'>('INTRO');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [loginErrorMsg, setLoginErrorMsg] = useState<string | null>(null);
  const [isRoasting, setIsRoasting] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  
  // Console State
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState<{id: string, timestamp: string, text: string, type: 'info'|'error'|'success'|'warning'|'system'}[]>([]);
  const [consoleInput, setConsoleInput] = useState('');
  const consoleContainerRef = useRef<HTMLDivElement>(null);
  
  const [currentVoice, setCurrentVoice] = useState('Puck');
  const roastAudioContextRef = useRef<AudioContext | null>(null);

  const logToConsole = (text: string, type: 'info'|'error'|'success'|'warning'|'system' = 'info') => {
      const now = new Date();
      const time = now.toLocaleTimeString([], { hour12: false, hour:'2-digit', minute:'2-digit', second:'2-digit' });
      const ms = now.getMilliseconds().toString().padStart(3, '0');
      const log = {
          id: Math.random().toString(36).substr(2, 9),
          timestamp: `${time}.${ms}`,
          text,
          type
      };
      setConsoleLogs(prev => [...prev, log]);
      setTimeout(() => {
         if (consoleContainerRef.current) {
             consoleContainerRef.current.scrollTop = consoleContainerRef.current.scrollHeight;
         }
      }, 10);
  };

  const handleConsoleCommand = (e: React.FormEvent) => {
      e.preventDefault();
      const rawCmd = consoleInput.trim();
      if (!rawCmd) return;
      logToConsole(`> ${rawCmd}`, 'system');

      const parts = rawCmd.split(' ');
      const command = parts[0].toLowerCase();
      const args = parts.slice(1);

      if (command === 'help') {
          logToConsole('--- COMMANDS ---', 'system');
          logToConsole('clear            : Flush terminal', 'info');
          logToConsole('voice [name]     : Set identity', 'info');
          logToConsole('override_demo    : Reset constraints', 'warning');
      } else if (command === 'clear') {
          setConsoleLogs([]);
      } else if (command === 'override_demo') {
          localStorage.removeItem('nsd_demo_lock_time');
          localStorage.setItem('nsd_demo_count', '0');
          setLoginErrorMsg(null);
          logToConsole('CONSTRAINTS REMOVED', 'success');
      } else if (command === 'voice' || command === 'set_voice') {
          if (args.length === 0) {
              logToConsole(`CURRENT: ${currentVoice}`, 'info');
          } else {
              const newVoice = args[0].charAt(0).toUpperCase() + args[0].slice(1).toLowerCase();
              setCurrentVoice(newVoice);
              logToConsole(`VOICE: ${newVoice}`, 'success');
          }
      } else {
          logToConsole(`ERR: UNKNOWN COMMAND`, 'error');
      }
      setConsoleInput('');
  };
  
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
        setMousePos({ 
            x: (e.clientX / window.innerWidth) * 2 - 1, 
            y: (e.clientY / window.innerHeight) * 2 - 1 
        });
    };
    window.addEventListener('mousemove', handleMove);
    return () => window.removeEventListener('mousemove', handleMove);
  }, []);

  // --- DEMO MODE LOCKOUT LOGIC ---
  const playRoast = async (timeLeft: number) => {
    setIsRoasting(true);
    setLoginErrorMsg("PROTOCOL VIOLATION. ANALYZING...");
    try {
        const client = getClient();
        const promptText = `User tried to login too soon. ${timeLeft} mins left. Mock them briefly. No intro.`;
        const response = await client.models.generateContent({
            model: 'gemini-2.5-flash-preview-tts',
            contents: { parts: [{ text: promptText }] },
            config: {
                responseModalities: ['AUDIO'],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } }
            }
        });
        const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (audioData) {
            if (!roastAudioContextRef.current) {
                roastAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            }
            const ctx = roastAudioContextRef.current;
            if (ctx.state === 'suspended') await ctx.resume();
            const uint8 = decodeBase64(audioData);
            const buffer = await decodeAudioData(uint8, ctx);
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(ctx.destination);
            source.start();
        }
        setTimeout(() => { setError(true); setLoginErrorMsg(`LOCKED: ${timeLeft}M`); setIsRoasting(false); }, 500);
    } catch (e) {
        setError(true); setLoginErrorMsg(`LOCKED: ${timeLeft}M`); setIsRoasting(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginErrorMsg(null);
    setError(false);

    if (password === 'nsdadmin') {
        setIsDemoMode(false);
        localStorage.removeItem('nsd_demo_count');
        localStorage.removeItem('nsd_demo_lock_time');
        setViewState('APP');
    } else if (password === 'demo78') {
        const storedLockTime = localStorage.getItem('nsd_demo_lock_time');
        if (storedLockTime) {
             const diff = Date.now() - parseInt(storedLockTime);
             if (diff < 3600000) {
                 const minLeft = Math.ceil((3600000 - diff) / 60000);
                 await playRoast(minLeft);
                 return;
             } else {
                 localStorage.removeItem('nsd_demo_lock_time');
                 localStorage.setItem('nsd_demo_count', '0');
             }
        }
        setIsDemoMode(true);
        setViewState('APP');
    } else {
        setError(true);
        setPassword('');
    }
  };

  const handleDemoLockout = () => {
      setViewState('LOGIN');
      setIsDemoMode(false);
      setError(true);
      setLoginErrorMsg("SESSION EXPIRED");
  };

  return (
    <div className="relative min-h-screen bg-[#050505] text-white overflow-hidden selection:bg-red-500/30 selection:text-white">
        <ParticleBackground mousePos={mousePos} />

        {viewState === 'INTRO' && <Intro onComplete={() => setViewState('BOOT')} />}
        {viewState === 'BOOT' && <BootSequence onComplete={() => setViewState('LOGIN')} />}
        
        {viewState === 'LOGIN' && (
            <div className="relative z-10 flex flex-col items-center justify-center min-h-screen animate-fade-in px-4">
                <div className="glass-panel p-12 rounded-2xl flex flex-col items-center max-w-md w-full relative overflow-hidden">
                    {/* Decorative Top Border */}
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-red-600 to-transparent opacity-50"></div>
                    
                    <div className="w-20 h-20 mb-8 relative flex items-center justify-center">
                       <svg className="absolute w-full h-full animate-spin-slower opacity-30" viewBox="0 0 100 100">
                         <circle cx="50" cy="50" r="45" stroke="#7f1d1d" strokeWidth="1" strokeDasharray="2 4" fill="none" />
                       </svg>
                       <div className="w-2 h-2 bg-red-500 rounded-full shadow-[0_0_15px_red] animate-pulse"></div>
                    </div>
                    
                    <h2 className="text-2xl font-bold mb-8 tracking-[0.2em] text-white font-tech uppercase text-center">Identity Verification</h2>
                    
                    <form onSubmit={handleLogin} className="flex flex-col gap-6 w-full">
                        <div className="relative">
                            <input 
                            type="password" 
                            value={password}
                            onChange={e => { setPassword(e.target.value); setError(false); setLoginErrorMsg(null); }}
                            placeholder="ACCESS CODE"
                            className={`w-full bg-black/40 border ${error ? 'border-red-500 text-red-500' : 'border-neutral-800 focus:border-red-800 text-white'} rounded-lg px-4 py-4 text-center tracking-[0.5em] text-sm outline-none transition-all placeholder-neutral-700 font-mono`}
                            autoFocus
                            disabled={isRoasting}
                            />
                            {error && <div className="absolute right-4 top-1/2 -translate-y-1/2 text-red-500 text-xs">!</div>}
                        </div>
                        
                        <button 
                          type="submit" 
                          disabled={isRoasting || !password}
                          className={`w-full bg-white/5 hover:bg-white/10 border border-white/10 hover:border-red-500/50 text-neutral-300 hover:text-white py-3 rounded-lg uppercase text-[10px] font-bold tracking-[0.2em] transition-all duration-300 ${isRoasting ? 'opacity-50 cursor-wait' : ''}`}
                        >
                            {isRoasting ? 'SYSTEM BUSY' : 'CONNECT'}
                        </button>
                    </form>

                    <div className="mt-8 h-4 flex items-center justify-center">
                        {loginErrorMsg && (
                            <span className="text-[10px] text-red-500 font-mono animate-pulse">{loginErrorMsg}</span>
                        )}
                    </div>
                </div>
                
                <div className="mt-8 text-[10px] text-neutral-600 font-mono tracking-widest">
                    SECURE TERMINAL // V.3.5.0
                </div>
            </div>
        )}

        {viewState === 'APP' && (
            <div className="relative z-10 animate-fade-in h-screen overflow-hidden">
                <Generator 
                  setIsConsoleOpen={setIsConsoleOpen} 
                  isConsoleOpen={isConsoleOpen} 
                  logToConsole={logToConsole} 
                  voiceName={currentVoice}
                  isDemoMode={isDemoMode}
                  onDemoLockout={handleDemoLockout}
                />
            </div>
        )}

        {/* Console Overlay */}
        {isConsoleOpen && (
            <div className="fixed bottom-0 left-0 right-0 h-[40vh] bg-[#050505]/95 border-t border-red-900/30 backdrop-blur-xl z-[100] flex flex-col font-mono text-xs animate-slide-in-bottom shadow-[0_-10px_40px_rgba(0,0,0,0.8)]">
                <div className="flex items-center justify-between px-4 py-2 bg-red-900/10 border-b border-red-900/20 text-red-500/80">
                    <span className="tracking-widest">root@specter:~#</span>
                    <button onClick={() => setIsConsoleOpen(false)} className="hover:text-white transition-colors">[CLOSE]</button>
                </div>
                <div ref={consoleContainerRef} className="flex-1 overflow-y-auto p-4 space-y-1.5 scrollbar-thin scrollbar-thumb-red-900/50 scrollbar-track-transparent">
                    {consoleLogs.map((log) => (
                        <div key={log.id} className={`${log.type === 'error' ? 'text-red-500' : log.type === 'success' ? 'text-green-500' : log.type === 'warning' ? 'text-yellow-500' : log.type === 'system' ? 'text-blue-400' : 'text-neutral-400'}`}>
                            <span className="opacity-30 mr-2">{log.timestamp}</span>
                            <span>{log.text}</span>
                        </div>
                    ))}
                </div>
                <form onSubmit={handleConsoleCommand} className="flex items-center px-4 py-3 bg-black/20">
                    <span className="text-red-500 mr-2 animate-pulse">{'>'}</span>
                    <input 
                      type="text" 
                      value={consoleInput} 
                      onChange={(e) => setConsoleInput(e.target.value)}
                      className="flex-1 bg-transparent outline-none text-red-50 placeholder-neutral-700 font-mono"
                      placeholder="Enter command..."
                      autoFocus
                    />
                </form>
            </div>
        )}
    </div>
  );
};

export default App;
