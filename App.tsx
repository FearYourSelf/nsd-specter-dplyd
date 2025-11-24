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

        let particles: {x: number, y: number, vx: number, vy: number, size: number}[] = [];
        const particleCount = 50;

        const resize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            particles = [];
            for (let i = 0; i < particleCount; i++) {
                particles.push({
                    x: Math.random() * canvas.width,
                    y: Math.random() * canvas.height,
                    vx: (Math.random() - 0.5) * 0.5,
                    vy: (Math.random() - 0.5) * 0.5,
                    size: Math.random() * 2 + 0.5
                });
            }
        };
        resize();
        window.addEventListener('resize', resize);

        const animate = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = 'rgba(220, 38, 38, 0.4)'; // Red

            particles.forEach(p => {
                p.x += p.vx;
                p.y += p.vy;
                if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
                if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

                const dx = p.x - (mousePos.x * window.innerWidth / 2 + window.innerWidth / 2);
                const dy = p.y - (mousePos.y * window.innerHeight / 2 + window.innerHeight / 2);
                const dist = Math.sqrt(dx*dx + dy*dy);
                
                if (dist < 200) {
                    p.x += dx * 0.01;
                    p.y += dy * 0.01;
                }

                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
            });

            requestAnimationFrame(animate);
        };
        animate();

        return () => window.removeEventListener('resize', resize);
    }, [mousePos]);

    return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none opacity-50 z-0" />;
};


// --- SYSTEM TRANSITION ---
const SystemOverrideTransition: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const [stage, setStage] = useState<'IMPLODE' | 'BLACKOUT'>('IMPLODE');

  useEffect(() => {
    setTimeout(() => setStage('BLACKOUT'), 600);
    setTimeout(onComplete, 1200);
  }, [onComplete]);

  return (
    <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center pointer-events-none transition-opacity duration-500">
        {stage === 'IMPLODE' && (
             <div className="w-full h-full animate-implode flex items-center justify-center">
                 <div className="w-2 h-2 bg-red-500 rounded-full shadow-[0_0_50px_red]"></div>
             </div>
        )}
        {stage === 'BLACKOUT' && (
             <div className="w-full h-full bg-black"></div>
        )}
    </div>
  );
};

const BootSequence: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setProgress(p => p >= 100 ? 100 : p + 2), 30);
    if(progress === 100) setTimeout(onComplete, 1000);
    return () => clearInterval(i);
  }, [progress, onComplete]);

  return (
    <div className="fixed inset-0 z-50 bg-[#0a0a0a] flex flex-col items-center justify-center font-mono text-xs text-red-600">
       <div className="w-64">
          <div className="h-1 bg-neutral-900 mb-2 overflow-hidden">
             <div className="h-full bg-red-600" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-center tracking-widest">LOADING SPECTER KERNEL... {progress}%</p>
       </div>
    </div>
  );
};

const App: React.FC = () => {
  const [viewState, setViewState] = useState<'INTRO' | 'BOOT' | 'LOGIN' | 'TRANSITION' | 'APP'>('INTRO');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [loginErrorMsg, setLoginErrorMsg] = useState<string | null>(null);
  const [isRoasting, setIsRoasting] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(false);
  
  // Console State (Global)
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState<{id: string, timestamp: string, text: string, type: 'info'|'error'|'success'|'warning'|'system'}[]>([]);
  const [consoleInput, setConsoleInput] = useState('');
  const consoleContainerRef = useRef<HTMLDivElement>(null);
  
  // Voice State
  const [currentVoice, setCurrentVoice] = useState('Puck');
  
  // Audio Ref for Roast (Preventing context limits)
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
          logToConsole('--- SYSTEM COMMANDS ---', 'system');
          logToConsole('help             : Display available commands', 'info');
          logToConsole('clear            : Clear terminal output', 'info');
          logToConsole('voice [name]     : Set voice identity', 'info');
          logToConsole('override_demo    : Reset demo counters', 'warning');
      } else if (command === 'clear') {
          setConsoleLogs([]);
      } else if (command === 'override_demo') {
          localStorage.removeItem('nsd_demo_lock_time');
          localStorage.setItem('nsd_demo_count', '0');
          setLoginErrorMsg(null);
          logToConsole('DEMO LOCKS FLUSHED.', 'success');
      } else if (command === 'voice' || command === 'set_voice') {
          if (args.length === 0) {
              logToConsole(`CURRENT VOICE: ${currentVoice}`, 'info');
          } else {
              const newVoice = args[0].charAt(0).toUpperCase() + args[0].slice(1).toLowerCase();
              setCurrentVoice(newVoice);
              logToConsole(`VOICE UPDATED: ${newVoice}`, 'success');
          }
      } else {
          logToConsole(`UNKNOWN COMMAND: ${rawCmd}`, 'error');
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (
            e.key === 'F12' || 
            (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J')) ||
            (e.ctrlKey && e.key === 'U')
        ) {
            e.preventDefault();
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // --- DEMO MODE LOCKOUT LOGIC ---
  const playRoast = async (timeLeft: number) => {
    setIsRoasting(true);
    setLoginErrorMsg("SECURITY PROTOCOLS ENGAGED... ANALYZING...");
    try {
        const client = getClient();
        
        const promptText = `
        Task: Mock the user for trying to access a locked account.
        Time Remaining: ${timeLeft} minutes.
        Style: Short, witty, slightly condescending but playful.
        Rule: NEVER state your name. NEVER say "Specter".
        Rule: DO NOT introduce yourself. Just speak the mock.
        Rule: You must mention the ${timeLeft} minutes remaining.
        `;

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
            // Reuse persistent audio context
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
        
        setTimeout(() => {
           setError(true);
           setLoginErrorMsg(`LOCKED. COOLDOWN: ${timeLeft} MINS.`);
           setIsRoasting(false);
        }, 500);

    } catch (e) {
        setError(true);
        setLoginErrorMsg(`LOCKED. COOLDOWN: ${timeLeft} MINS.`);
        setIsRoasting(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginErrorMsg(null);
    setError(false);

    if (password === 'nsdadmin') {
        setIsDemoMode(false);
        // FORCE CLEAR DEMO ARTIFACTS TO ENSURE LIMITLESS ACCESS
        localStorage.removeItem('nsd_demo_count');
        localStorage.removeItem('nsd_demo_lock_time');
        setViewState('TRANSITION');
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
        setViewState('TRANSITION');
    } else {
        setError(true);
        setPassword('');
    }
  };

  const handleDemoLockout = () => {
      setViewState('LOGIN');
      setIsDemoMode(false);
      setError(true);
      setLoginErrorMsg("DEMO EXPIRED (10/10). LOCKED 1 HR.");
  };

  return (
    <div 
      className="relative min-h-screen bg-[#0a0a0a] text-white overflow-hidden selection:bg-red-900 selection:text-white no-select"
      onContextMenu={(e) => e.preventDefault()}
    >
        <div className="fixed inset-0 pointer-events-none">
            <div className="absolute inset-0 bg-animated-gradient-red opacity-30"></div>
            <div className="perspective-grid-floor opacity-40" style={{ transform: `perspective(500px) rotateX(60deg) translate(${mousePos.x * -20}px, ${mousePos.y * -20}px)` }}></div>
            <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-transparent to-[#0a0a0a]"></div>
        </div>
        
        <ParticleBackground mousePos={mousePos} />

        {viewState === 'INTRO' && <Intro onComplete={() => setViewState('BOOT')} />}
        {viewState === 'BOOT' && <BootSequence onComplete={() => setViewState('LOGIN')} />}
        
        {viewState === 'LOGIN' && (
            <div className="relative z-10 flex flex-col items-center justify-center min-h-screen animate-fade-in">
                <div className="bg-[#0a0a0a]/50 backdrop-blur-md border border-neutral-800 p-12 rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.5)] flex flex-col items-center">
                    <div className="w-16 h-16 mb-6 relative flex items-center justify-center">
                       <svg className="absolute w-full h-full animate-spin-slow opacity-50" viewBox="0 0 100 100">
                         <circle cx="50" cy="50" r="45" stroke="#7f1d1d" strokeWidth="2" strokeDasharray="10 5" fill="none" />
                       </svg>
                       <div className="w-4 h-4 bg-red-600 rounded-full shadow-[0_0_20px_red] animate-pulse"></div>
                    </div>
                    
                    <h2 className="text-3xl font-bold mb-8 tracking-widest text-red-500 font-tech uppercase">NSD-SPECTER</h2>
                    <form onSubmit={handleLogin} className="flex flex-col gap-4 w-64">
                        <input 
                          type="password" 
                          value={password}
                          onChange={e => { setPassword(e.target.value); setError(false); setLoginErrorMsg(null); }}
                          placeholder="••••••••"
                          className={`bg-neutral-900 border ${error ? 'border-red-500 animate-pulse' : 'border-neutral-700 focus:border-red-600'} rounded px-4 py-3 text-center tracking-[0.5em] outline-none transition-colors`}
                          autoFocus
                          disabled={isRoasting}
                        />
                        <button 
                          type="submit" 
                          disabled={isRoasting}
                          className={`bg-red-900/30 border border-red-600 text-red-500 py-3 rounded uppercase text-xs font-bold tracking-widest transition-all ${isRoasting ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-600 hover:text-white'}`}
                        >
                            {isRoasting ? 'ANALYZING...' : 'Authenticate'}
                        </button>
                    </form>
                    <div className="mt-8 text-[10px] text-neutral-600 font-mono text-center min-h-[1.5em]">
                        {loginErrorMsg ? (
                            <span className={`text-red-500 font-bold ${isRoasting ? 'animate-pulse' : ''}`}>{loginErrorMsg}</span>
                        ) : (
                            "SECURE TERMINAL // UNAUTHORIZED ACCESS IS PROHIBITED"
                        )}
                    </div>
                </div>
            </div>
        )}

        {viewState === 'TRANSITION' && <SystemOverrideTransition onComplete={() => setViewState('APP')} />}

        {viewState === 'APP' && (
            <div className="relative z-10 animate-fade-in">
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

        {viewState !== 'INTRO' && viewState !== 'BOOT' && (
            <div className="fixed bottom-0 left-0 right-0 h-10 bg-black/80 backdrop-blur border-t border-neutral-900 z-[60] flex items-center justify-between px-4 animate-slide-in-bottom" style={{ animationDelay: '0.5s' }}>
                <div className="flex items-center gap-4">
                    <div className={`w-2 h-2 rounded-full animate-pulse shadow-[0_0_10px] ${isDemoMode ? 'bg-yellow-500 shadow-yellow-500' : 'bg-green-500 shadow-green-500'}`}></div>
                    <span className={`text-[10px] font-mono tracking-widest ${isDemoMode ? 'text-yellow-500' : 'text-neutral-500'}`}>
                        {isDemoMode ? "DEMO MODE ACTIVE | ACCOUNT: DEMO78" : "SYSTEM READY | MODEL: NSD-SPECTER_VISION 3.5"}
                    </span>
                </div>
                
                <div className="flex items-center gap-6">
                    <a href="https://fearyour.life/" target="_blank" rel="noopener noreferrer" className="text-[10px] font-mono text-neutral-500 hover:text-red-500 tracking-widest transition-colors">
                        POWERED BY: NSD-CORE/70B
                    </a>
                    
                    <button 
                      onClick={() => setIsConsoleOpen(!isConsoleOpen)}
                      className="text-neutral-500 hover:text-red-500 transition-colors"
                      title="Toggle System Terminal"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    </button>
                </div>
            </div>
        )}

        {isConsoleOpen && (
            <div className="fixed bottom-10 left-0 right-0 h-[300px] bg-black/95 border-t border-red-900/50 backdrop-blur-md z-[55] flex flex-col font-mono text-xs animate-slide-in-bottom">
                <div className="flex items-center justify-between px-4 py-1 bg-red-900/20 border-b border-red-900/30 text-red-500">
                    <span className="tracking-widest">SPECTER_KERNEL_DEBUG_SHELL</span>
                    <button onClick={() => setIsConsoleOpen(false)} className="hover:text-white">[MINIMIZE]</button>
                </div>
                <div ref={consoleContainerRef} className="flex-1 overflow-y-auto p-4 space-y-1 text-neutral-400 scrollbar-thin scrollbar-thumb-red-900">
                    {consoleLogs.map((log) => (
                        <div key={log.id} className={`${log.type === 'error' ? 'text-red-500' : log.type === 'success' ? 'text-green-500' : log.type === 'warning' ? 'text-yellow-500' : log.type === 'system' ? 'text-blue-400' : 'text-neutral-400'}`}>
                            <span className="opacity-50">[{log.timestamp}]</span> {log.text}
                        </div>
                    ))}
                </div>
                <form onSubmit={handleConsoleCommand} className="flex items-center px-4 py-2 border-t border-neutral-800">
                    <span className="text-red-500 mr-2">{'>'}</span>
                    <input 
                      type="text" 
                      value={consoleInput} 
                      onChange={(e) => setConsoleInput(e.target.value)}
                      className="flex-1 bg-transparent outline-none text-red-100 placeholder-neutral-700"
                      placeholder="enter system command..."
                      autoFocus
                    />
                </form>
            </div>
        )}

    </div>
  );
};

export default App;