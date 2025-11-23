
import React, { useState, useEffect } from 'react';

interface IntroProps {
  onComplete: () => void;
}

const Intro: React.FC<IntroProps> = ({ onComplete }) => {
  const [visible, setVisible] = useState(false);
  const [showButton, setShowButton] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setVisible(true), 500);
    const t2 = setTimeout(() => setShowButton(true), 2500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0a0a0a] text-white overflow-hidden">
      <div className="absolute inset-0 opacity-20 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-red-900/20 rounded-full blur-[100px] animate-pulse" />
      </div>

      <div className={`transition-all duration-1000 ease-out transform ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'} flex flex-col items-center w-full`}>
        
        {/* New Spectral Eye Logo */}
        <div className="relative mb-12 w-40 h-40 flex items-center justify-center">
           {/* Glitchy Rings */}
           <svg className="absolute w-full h-full animate-spin-slow opacity-50" viewBox="0 0 100 100">
             <circle cx="50" cy="50" r="45" stroke="#7f1d1d" strokeWidth="1" strokeDasharray="10 5" fill="none" />
             <path d="M50 5 L50 15 M50 85 L50 95 M5 50 L15 50 M85 50 L95 50" stroke="#ef4444" strokeWidth="2" />
           </svg>
           <svg className="absolute w-3/4 h-3/4 animate-spin-slow-reverse opacity-70" viewBox="0 0 100 100">
             <path d="M50 10 A40 40 0 0 1 90 50" stroke="#dc2626" strokeWidth="2" fill="none" />
             <path d="M50 90 A40 40 0 0 1 10 50" stroke="#dc2626" strokeWidth="2" fill="none" />
           </svg>
           
           {/* Central Eye */}
           <div className="absolute w-16 h-16 bg-black border border-red-500 rounded-full flex items-center justify-center shadow-[0_0_50px_rgba(220,38,38,0.5)] animate-breathe-red">
              <div className="w-6 h-1 bg-red-500 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 blur-[2px]"></div>
              <div className="w-1 h-6 bg-red-500 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 blur-[2px]"></div>
              <div className="w-3 h-3 bg-white rounded-full shadow-[0_0_15px_white]"></div>
           </div>
        </div>

        <h1 className="text-6xl md:text-9xl font-bold tracking-tighter mb-6 text-center font-tech uppercase relative">
          <span className="text-white text-stroke">NSD-</span>
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-600 to-red-400 text-glow">SPECTER</span>
        </h1>
        <p className="text-red-500/80 tracking-[0.2em] text-[10px] md:text-sm uppercase mb-12 font-mono text-center whitespace-nowrap w-full overflow-visible">
          ADAPTIVE VISUAL INTELLIGENCE AT YOUR COMMAND.
        </p>

        <button
          onClick={onComplete}
          className={`px-8 py-4 bg-red-900/10 border border-red-600/50 text-red-500 hover:text-white hover:bg-red-600/80 hover:border-red-500 transition-all duration-500 font-bold tracking-widest uppercase text-xs rounded-lg ${showButton ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
        >
          INITIALIZE UPLINK
        </button>
      </div>
    </div>
  );
};

export default Intro;
