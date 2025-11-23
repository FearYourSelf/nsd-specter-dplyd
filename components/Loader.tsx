
import React from 'react';

const Loader: React.FC = () => {
  return (
    <div className="flex flex-col items-center justify-center space-y-4">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 border-2 border-red-900 rounded-full"></div>
        <div className="absolute inset-0 border-t-2 border-red-500 rounded-full animate-spin"></div>
      </div>
      <p className="text-red-500/50 font-mono text-xs tracking-widest animate-pulse">ESTABLISHING UPLINK...</p>
    </div>
  );
};

export default Loader;
