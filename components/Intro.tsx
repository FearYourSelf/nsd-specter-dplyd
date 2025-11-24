
import React, { useState, useEffect } from 'react';

interface IntroProps {
  onComplete: () => void;
}

const Intro: React.FC<IntroProps> = ({ onComplete }) => {
  const [visible, setVisible] = useState(false);
  const [glitch, setGlitch] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setVisible(true), 200);
    const t2 = setTimeout(() => setGlitch(true), 1200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#050505] text-white overflow-hidden">
      
      {/* Background Ambience */}
      <div className="absolute inset-0 opacity-20 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-red-900/10 rounded-full blur-[120px]" />
      </div>

      <div className={`transition-all duration-1000 ease-out transform ${visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'} flex flex-col items-center relative z-10`}>
        
        {/* Animated Logo */}
        <div className="relative mb-12 w-32 h-32 flex items-center justify-center">
           <svg className="absolute w-full h-full animate-spin-slow opacity-30" viewBox="0 0 100 100">
             <circle cx="50" cy="50" r="48" stroke="#ef4444" strokeWidth="0.5" strokeDasharray="4 4" fill="none" />
           </svg>
           <svg className="absolute w-[80%] h-[80%] animate-spin-reverse opacity-50" viewBox="0 0 100 100">
             <path d="M50 10 A40 40 0 0 1 90 50" stroke="#dc2626" strokeWidth="1" fill="none" />
             <path d="M50 90 A40 40 0 0 1 10 50" stroke="#dc2626" strokeWidth="1" fill="none" />
           </svg>
           <div className="w-2 h-2 bg-red-500 rounded-full shadow-[0_0_20px_red] animate-pulse"></div>
        </div>

        <h1 className="text-5xl md:text-8xl font-bold tracking-tighter mb-4 text-center font-tech uppercase relative">
          <span className="text-white mix-blend-difference">NSD</span>
          <span className="text-red-600">-SPECTER</span>
        </h1>
        
        <div className="h-px w-32 bg-gradient-to-r from-transparent via-red-900 to-transparent mb-8"></div>

        <button
          onClick={onComplete}
          className={`group relative px-10 py-3 overflow-hidden bg-transparent border border-neutral-800 text-neutral-400 font-mono text-xs tracking-[0.3em] uppercase transition-all hover:text-white hover:border-red-600 ${glitch ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
          style={{ transitionDelay: '0.2s' }}
        >
          <span className="absolute inset-0 w-0 bg-red-900/20 transition-all duration-[250ms] ease-out group-hover:w-full"></span>
          <span className="relative z-10">Initialize System</span>
        </button>
      </div>
    </div>
  );
};

export default Intro;
