import React, { useState, useEffect, useRef } from 'react';
import { getClient } from '../services/geminiService';
import { createPcmBlob, decodeBase64, decodeAudioData } from '../services/audioUtils';
import { LiveServerMessage, Modality } from '@google/genai';
import { TranscriptItem, VideoMode } from '../types';

// --- CONFIG ---
const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-09-2025';

// --- UTILS ---
const cleanTranscript = (text: string) => {
    if (!text) return '';
    
    // 1. Fencing Protocol: Split by '»' and take the last part (the spoken part)
    if (text.includes('»')) {
        const parts = text.split('»');
        return parts[parts.length - 1].trim();
    }

    // 2. Strict Hiding: If no fence is found, assume it is internal thought/planning 
    // and hide it completely from the transcript.
    return '';
};

// --- SYSTEM INSTRUCTION GENERATOR ---
const getSystemInstruction = (voiceName: string, isDemoMode: boolean, demoState: { count: number, isRefresh: boolean }) => `
IDENTITY:
- Name: Specter.
- Voice: '${voiceName}'.
- Persona: Deep, husky, Australian accent. Confident, cheeky, "Red Team" operator style.
- Creator: "NotSoDangerous" (NSD).

PROTOCOL - THOUGHT FENCING (CRITICAL):
- You may have internal thoughts or planning, BUT you must separate them from speech.
- FORMAT: [Internal Thoughts/Planning/Headers] » [Actual Spoken Response]
- The '»' character is the CUTOFF. Everything before it is hidden from the user.
- Everything AFTER '»' is spoken and shown.

${isDemoMode ? `
DEMO MODE (ACCOUNT: DEMO78):
- STATUS: RESTRICTED. LIMIT: 10 QUERIES.
- CURRENT STATE: ${demoState.count}/10 Queries Used.

INSTRUCTIONS:
1. You will receive system updates about the query count attached to user messages.
2. PLAN your response logic (calculating remaining queries, deciding tone) BEFORE the '»'.
3. SPEAK the final response AFTER the '»'.
4. INTEGRATE the count naturally.
   - Example: **Planning** Count is 5. » Good copy. That's a solid point. You've got 5 queries left, mate.
5. IF QUERY IS #10 (0 Left): "That's the lot. System's locking down. Catch ya later."
` : `
SECURITY PROTOCOL:
- If user claims to be "NotSoDangerous", ask for passphrase ("Perfectly out of place").
`}
`;

const AUDIO_SAMPLE_RATE_INPUT = 16000;
const AUDIO_SAMPLE_RATE_OUTPUT = 24000;
const VIDEO_FRAME_RATE_MS = 1000; 

// --- TYPEWRITER COMPONENT ---
const TypewriterText: React.FC<{ text: string; speed?: number }> = ({ text, speed = 15 }) => {
  const [displayedText, setDisplayedText] = useState('');
  
  useEffect(() => {
    let i = 0;
    const timer = setInterval(() => {
      if (i < text.length) {
        setDisplayedText(prev => text.substring(0, i + 1));
        i++;
      } else {
        clearInterval(timer);
      }
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed]);

  return <span className="typewriter-cursor">{displayedText}</span>;
};

// --- DRAGGABLE WINDOW COMPONENT ---
const DraggableWindow: React.FC<{ 
    title: string; 
    children: React.ReactNode; 
    initialX: number; 
    initialY: number; 
    onClose: () => void;
    className?: string;
}> = ({ title, children, initialX, initialY, onClose, className }) => {
    const [pos, setPos] = useState({ x: initialX, y: initialY });
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0 });

    const handleMouseDown = (e: React.MouseEvent) => {
        setIsDragging(true);
        dragStart.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDragging) {
                setPos({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
            }
        };
        const handleMouseUp = () => setIsDragging(false);

        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging]);

    return (
        <div 
            className={`fixed z-40 bg-black/60 backdrop-blur-xl border border-red-500/30 rounded-lg shadow-[0_0_30px_rgba(220,38,38,0.2)] flex flex-col overflow-hidden animate-fade-in ${className}`}
            style={{ left: pos.x, top: pos.y }}
        >
            <div 
                className="bg-red-900/20 border-b border-red-500/30 p-2 flex justify-between items-center cursor-move select-none"
                onMouseDown={handleMouseDown}
            >
                <div className="text-[10px] font-mono tracking-widest text-red-500 uppercase flex items-center gap-2">
                    <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                    {title}
                </div>
                <button onClick={onClose} className="text-red-500 hover:text-white transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>
            <div className="flex-1 overflow-auto relative">
                {children}
            </div>
        </div>
    );
};

interface GeneratorProps {
    setIsConsoleOpen: (v: boolean) => void;
    isConsoleOpen: boolean;
    logToConsole: (text: string, type?: 'info' | 'error' | 'success' | 'warning' | 'system') => void;
    voiceName: string;
    isDemoMode: boolean;
    onDemoLockout: () => void;
}

const Generator: React.FC<GeneratorProps> = ({ setIsConsoleOpen, isConsoleOpen, logToConsole, voiceName, isDemoMode, onDemoLockout }) => {
  // --- STATE ---
  const [isConnected, setIsConnected] = useState(false);
  const [isMicOn, setIsMicOn] = useState(true);
  
  // Video & Camera State
  const [videoMode, setVideoMode] = useState<VideoMode>('NONE');
  const [cameraFacingMode, setCameraFacingMode] = useState<'user' | 'environment'>('environment');
  const [isFullScreenFeed, setIsFullScreenFeed] = useState(false);

  const [volumeUser, setVolumeUser] = useState(0);
  const [volumeAi, setVolumeAi] = useState(0);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Transcript State
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [showTranscript, setShowTranscript] = useState(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const currentAiTurnId = useRef<string | null>(null);
  
  // Text Input State
  const [textInput, setTextInput] = useState('');

  // --- REFS ---
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const audioQueueRef = useRef<AudioBufferSourceNode[]>([]);
  const analyzerUserRef = useRef<AnalyserNode | null>(null);
  const analyzerAiRef = useRef<AnalyserNode | null>(null);
  const isMicOnRef = useRef(isMicOn);
  const isDemoModeRef = useRef(isDemoMode);
  
  // Wake Lock
  const wakeLockRef = useRef<any>(null);
  
  // DEMO LOGIC REFS
  const turnCountRef = useRef(0);
  const isRefreshRef = useRef(false);
  
  // Smoothing Ref
  const visualizerState = useRef({ user: 0, ai: 0 });

  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoIntervalRef = useRef<number | null>(null);

  const sessionRef = useRef<any>(null);

  // Update ref when state changes
  useEffect(() => {
    isMicOnRef.current = isMicOn;
  }, [isMicOn]);

  useEffect(() => {
    isDemoModeRef.current = isDemoMode;
  }, [isDemoMode]);

  // --- WAKE LOCK API ---
  useEffect(() => {
    const requestWakeLock = async () => {
        if (isConnected && 'wakeLock' in navigator) {
            try {
                wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
                logToConsole("WAKE LOCK ACTIVE", 'system');
            } catch (err: any) {
                logToConsole(`WAKE LOCK FAILED: ${err.name}`, 'warning');
            }
        }
    };

    if (isConnected) {
        requestWakeLock();
    } else {
        if (wakeLockRef.current) {
            wakeLockRef.current.release()
                .then(() => { wakeLockRef.current = null; })
                .catch((e: any) => console.error(e));
        }
    }

    return () => {
        if (wakeLockRef.current) wakeLockRef.current.release().catch((e: any) => console.error(e));
    };
  }, [isConnected]);

  // --- INITIALIZATION ---
  useEffect(() => {
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: AUDIO_SAMPLE_RATE_OUTPUT,
    });
    
    const ctx = audioContextRef.current;
    analyzerUserRef.current = ctx.createAnalyser();
    analyzerUserRef.current.fftSize = 64;
    analyzerAiRef.current = ctx.createAnalyser();
    analyzerAiRef.current.fftSize = 64;

    logToConsole('SPECTER KERNEL INITIALIZED...', 'system');

    // --- REFRESH / RETURN LOGIC ---
    if (isDemoMode) {
        const storedCount = localStorage.getItem('nsd_demo_count');
        const count = storedCount ? parseInt(storedCount, 10) : 0;
        turnCountRef.current = count;

        // Check Session Storage to see if this tab was already open
        const isSessionActive = sessionStorage.getItem('nsd_session_active');
        if (!isSessionActive && count > 0) {
            // New tab/window but has count -> Returning User
            isRefreshRef.current = true;
        } else if (isSessionActive && count > 0) {
             // Refresh of same tab
             isRefreshRef.current = true;
        }

        sessionStorage.setItem('nsd_session_active', 'true');
        logToConsole(`DEMO STATE: ${count}/10. REFRESH: ${isRefreshRef.current}`, 'system');
    }

    return () => {
      stopSession();
      if (audioContextRef.current?.state !== 'closed') {
        audioContextRef.current?.close();
      }
    };
  }, [isDemoMode]);

  // Set CSS Variable for Chromatic Aberration based on volume
  useEffect(() => {
     document.documentElement.style.setProperty('--voice-intensity', (volumeAi * 5).toString());
  }, [volumeAi]);

  // Visualizer Loop
  useEffect(() => {
    let animId: number;
    const updateVolume = () => {
      if (analyzerUserRef.current && isConnected) {
        const data = new Uint8Array(analyzerUserRef.current.frequencyBinCount);
        analyzerUserRef.current.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b) / data.length;
        const target = avg / 255;
        visualizerState.current.user += (target - visualizerState.current.user) * 0.2;
        setVolumeUser(visualizerState.current.user); 
      } else {
        setVolumeUser(0);
        visualizerState.current.user = 0;
      }

      if (analyzerAiRef.current && isConnected) {
        const data = new Uint8Array(analyzerAiRef.current.frequencyBinCount);
        analyzerAiRef.current.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b) / data.length;
        const target = avg / 255;
        visualizerState.current.ai += (target - visualizerState.current.ai) * 0.2;
        setVolumeAi(visualizerState.current.ai);
        setIsAiSpeaking(avg > 10);
      } else {
        setVolumeAi(0);
        visualizerState.current.ai = 0;
        setIsAiSpeaking(false);
      }
      animId = requestAnimationFrame(updateVolume);
    };
    animId = requestAnimationFrame(updateVolume);
    return () => cancelAnimationFrame(animId);
  }, [isConnected]);

  // Auto-scroll Transcript
  useEffect(() => {
    if (transcriptEndRef.current) {
        transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcript, showTranscript]);

  const incrementDemoCount = () => {
      // Use ref to ensure we always check correct state in callbacks
      if (!isDemoModeRef.current) return;
      
      const newCount = turnCountRef.current + 1;
      turnCountRef.current = newCount;
      localStorage.setItem('nsd_demo_count', newCount.toString());
      logToConsole(`QUERY USED. NEW COUNT: ${newCount}/10`, 'warning');
      
      if (newCount >= 10) {
          handleLockoutSequence();
      }
  };

  const handleLockoutSequence = () => {
      logToConsole("DEMO LIMIT REACHED. DISENGAGING...", 'error');
      // Set lock time
      localStorage.setItem('nsd_demo_lock_time', Date.now().toString());
      
      // Wait for AI to finish speaking (approx 15s) then kill
      setTimeout(() => {
          stopSession();
          onDemoLockout();
      }, 15000);
  };

  // --- LIVE API CONNECTION ---
  const startSession = async () => {
    // PRE-FLIGHT CHECKS using ref for consistency
    if (isDemoModeRef.current) {
        const lockTime = localStorage.getItem('nsd_demo_lock_time');
        if (lockTime) {
            const diff = Date.now() - parseInt(lockTime);
            if (diff < 3600000) { onDemoLockout(); return; }
        }
        if (turnCountRef.current >= 10) { onDemoLockout(); return; }
    }

    try {
      setError(null);
      logToConsole(`INITIALIZING UPLINK [VOICE: ${voiceName}]...`, 'warning');
      
      const client = getClient();
      const ctx = audioContextRef.current;
      if (!ctx) return;
      if (ctx.state === 'suspended') await ctx.resume();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
        sampleRate: AUDIO_SAMPLE_RATE_INPUT,
        channelCount: 1,
        echoCancellation: true,
        autoGainControl: true,
        noiseSuppression: true
      }});
      micStreamRef.current = stream;
      
      const systemInstruction = getSystemInstruction(
          voiceName, 
          isDemoMode, 
          { count: turnCountRef.current, isRefresh: isRefreshRef.current }
      );

      const sessionPromise = client.live.connect({
        model: MODEL_NAME,
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {}, 
          outputAudioTranscription: {}, 
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName } } 
          },
          systemInstruction: systemInstruction,
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            logToConsole("UPLINK ESTABLISHED. CHANNEL OPEN.", 'success');
            
            const source = ctx.createMediaStreamSource(stream);
            inputSourceRef.current = source;
            source.connect(analyzerUserRef.current!);

            const processor = ctx.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
              if (!isMicOnRef.current) return;
              
              // HARD STOP FOR DEMO using ref
              if (isDemoModeRef.current && turnCountRef.current >= 10) return;

              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then(session => {
                  session.sendRealtimeInput({ media: pcmBlob });
              });
            };

            source.connect(processor);
            processor.connect(ctx.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
             const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
             const textData = msg.serverContent?.modelTurn?.parts?.[0]?.text;

             if (audioData) {
                 await playAudioChunk(audioData);
                 updateCurrentAiTranscript(undefined, audioData);
             }
             
             if (textData) {
                 updateCurrentAiTranscript(textData);
             }
             
             if (msg.serverContent?.outputTranscription?.text) {
                 updateCurrentAiTranscript(msg.serverContent.outputTranscription.text);
             }

             if (msg.serverContent?.inputTranscription?.text) {
                 const userText = msg.serverContent.inputTranscription.text;
                 handleUserTranscript(userText);
             }
             
             if (msg.serverContent?.interrupted) {
                 logToConsole("INTERRUPTION DETECTED.", 'warning');
                 clearAudioQueue();
                 finalizeAiTranscript();
             }

             if (msg.serverContent?.turnComplete) {
                 finalizeAiTranscript();
                 
                 // IMPORTANT: Increment count on turn completion using REF
                 if (isDemoModeRef.current) {
                     incrementDemoCount();
                     
                     // INJECT UPDATE FOR NEXT TURN
                     if (turnCountRef.current < 10) {
                        const next = turnCountRef.current + 1; // The query the user is ABOUT to make
                        sessionPromise.then(sess => {
                            sess.sendRealtimeInput({
                                content: [{ parts: [{ text: `[SYSTEM CONTEXT: The PREVIOUS turn is finished. The user has used ${turnCountRef.current}/10 queries. The NEXT query will be #${next}. Remind them naturally.]` }] }]
                            });
                        });
                     }
                 }
             }
          },
          onclose: () => {
            setIsConnected(false);
            stopSession();
          },
          onerror: (e) => {
            console.error(e);
            stopSession();
          }
        }
      });
      
      sessionPromise.then(sess => {
          sessionRef.current = sess;
      }).catch(err => {
         console.error(err);
         setError("CONNECTION FAILED");
         stopSession();
      });

    } catch (e: any) {
      console.error(e);
      setError("HARDWARE ACCESS DENIED");
      stopSession();
    }
  };

  const stopSession = () => {
    setIsConnected(false);
    stopVideo();
    
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }
    if (inputSourceRef.current) {
      inputSourceRef.current.disconnect();
      inputSourceRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    sessionRef.current = null;
  };

  const playAudioChunk = async (base64: string) => {
    const ctx = audioContextRef.current;
    if (!ctx) return;
    try {
        const uint8 = decodeBase64(base64);
        const audioBuffer = await decodeAudioData(uint8, ctx, AUDIO_SAMPLE_RATE_OUTPUT);
        
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        
        source.connect(analyzerAiRef.current!);
        analyzerAiRef.current!.connect(ctx.destination);

        const currentTime = ctx.currentTime;
        const start = Math.max(currentTime, nextPlayTimeRef.current);
        source.start(start);
        nextPlayTimeRef.current = start + audioBuffer.duration;
        
        audioQueueRef.current.push(source);
        source.onended = () => {
            const idx = audioQueueRef.current.indexOf(source);
            if (idx > -1) audioQueueRef.current.splice(idx, 1);
        };
    } catch (e) {
        console.error("Audio Decode Error", e);
    }
  };

  const clearAudioQueue = () => {
      audioQueueRef.current.forEach(src => src.stop());
      audioQueueRef.current = [];
      nextPlayTimeRef.current = audioContextRef.current?.currentTime || 0;
  };

  const handleTextInput = (e: React.FormEvent) => {
      e.preventDefault();
      
      // HARD STOP using ref
      if (isDemoModeRef.current && turnCountRef.current >= 10) return;

      if (!textInput.trim() || !sessionRef.current) return;
      
      let txt = textInput.trim();
      
      // DEMO INJECTION using ref
      if (isDemoModeRef.current) {
          const current = turnCountRef.current + 1; // This query
          const remaining = 10 - current;
          // Append hidden context to the user's message so the model sees it immediately
          const context = `\n\n[SYSTEM DATA: This is Query #${current}/10. Remaining: ${remaining}. Integrate this into your reply naturally.]`;
          
          sessionRef.current.sendRealtimeInput({
              content: [{ parts: [{ text: txt + context }] }]
          });
      } else {
          sessionRef.current.sendRealtimeInput({
              content: [{ parts: [{ text: txt }] }]
          });
      }

      logToConsole(`SENT: "${txt}"`, 'info');
      handleUserTranscript(txt);
      setTextInput('');
  };

  // --- VIDEO HANDLING EFFECT ---
  useEffect(() => {
    if (videoMode !== 'NONE') {
        const attachStream = async () => {
            setTimeout(async () => {
                if(videoElementRef.current && videoStreamRef.current) {
                    videoElementRef.current.srcObject = videoStreamRef.current;
                    try {
                        await videoElementRef.current.play();
                        startFrameCapture();
                    } catch(e: any) {
                        logToConsole("VIDEO ERROR: " + e.message, 'error');
                    }
                }
            }, 100);
        };
        attachStream();
    }
  }, [videoMode, isFullScreenFeed, cameraFacingMode]);

  const startCamera = async (facingMode: 'user' | 'environment') => {
      if (videoStreamRef.current) {
          videoStreamRef.current.getTracks().forEach(t => t.stop());
          videoStreamRef.current = null;
      }
      await new Promise(r => setTimeout(r, 100));

      const getMedia = async (constraints: MediaStreamConstraints) => {
          return await navigator.mediaDevices.getUserMedia(constraints);
      };

      try {
          let stream;
          try {
             stream = await getMedia({ video: { facingMode: { exact: facingMode } } });
          } catch(err) {
              stream = await getMedia({ video: { facingMode: { ideal: facingMode } } });
          }
          videoStreamRef.current = stream;
          if(videoElementRef.current) {
              videoElementRef.current.srcObject = stream;
              try { await videoElementRef.current.play(); } catch(e){}
          }
          setVideoMode('CAMERA');
      } catch (e: any) {
          setVideoMode('NONE');
      }
  };

  const switchCamera = async () => {
      const newMode = cameraFacingMode === 'user' ? 'environment' : 'user';
      setCameraFacingMode(newMode);
      await startCamera(newMode);
  };

  const toggleVideo = async (mode: VideoMode) => {
      if (videoMode === mode && !isFullScreenFeed) {
          stopVideo();
          return;
      }
      if (videoMode !== 'NONE' && videoMode !== mode) stopVideo();
      
      try {
          if (mode === 'CAMERA') {
             await startCamera(cameraFacingMode);
          } else if (mode === 'SCREEN') {
             const stream = await navigator.mediaDevices.getDisplayMedia({ video: { width: 1280, height: 720 } });
             videoStreamRef.current = stream;
             setVideoMode('SCREEN');
          }
      } catch (e: any) {
          setVideoMode('NONE');
      }
  };

  const stopVideo = () => {
      if (videoIntervalRef.current) window.clearInterval(videoIntervalRef.current);
      if (videoStreamRef.current) {
          videoStreamRef.current.getTracks().forEach(t => t.stop());
          videoStreamRef.current = null;
      }
      setVideoMode('NONE');
      setIsFullScreenFeed(false);
  };

  const startFrameCapture = () => {
      if (videoIntervalRef.current) window.clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = window.setInterval(() => {
          if (!sessionRef.current || !videoElementRef.current || !canvasRef.current) return;
          const ctx = canvasRef.current.getContext('2d');
          const vid = videoElementRef.current;
          if (!ctx || vid.readyState < 2) return;

          canvasRef.current.width = vid.videoWidth;
          canvasRef.current.height = vid.videoHeight;
          ctx.drawImage(vid, 0, 0);
          const base64 = canvasRef.current.toDataURL('image/jpeg', 0.5).split(',')[1];
          sessionRef.current.sendRealtimeInput({ 
              media: { mimeType: 'image/jpeg', data: base64 } 
          });
      }, VIDEO_FRAME_RATE_MS);
  };

  // --- TRANSCRIPT HANDLING ---
  const updateCurrentAiTranscript = (text?: string, audioChunk?: string) => {
      if ((!text || !text.trim()) && !audioChunk) return;

      setTranscript(prev => {
          const last = prev[prev.length - 1];
          if (last && last.source === 'AI' && !last.isComplete) {
              const updated = { ...last };
              if (text) updated.text += text;
              if (audioChunk) updated.audioChunks = [...(updated.audioChunks || []), audioChunk];
              return [...prev.slice(0, -1), updated];
          } else {
              return [...prev, {
                  id: Date.now().toString(),
                  source: 'AI',
                  text: text || '',
                  audioChunks: audioChunk ? [audioChunk] : [],
                  timestamp: Date.now(),
                  isComplete: false
              }];
          }
      });
  };

  const finalizeAiTranscript = () => {
      setTranscript(prev => {
          const last = prev[prev.length - 1];
          if (last && last.source === 'AI') {
              return [...prev.slice(0, -1), { ...last, isComplete: true }];
          }
          return prev;
      });
      currentAiTurnId.current = null;
  };

  const handleUserTranscript = (text: string) => {
      setTranscript(prev => {
          const last = prev[prev.length - 1];
          if (last && last.source === 'USER' && (Date.now() - last.timestamp < 3000)) {
               return [...prev.slice(0, -1), { ...last, text: last.text + text }];
          } else {
               return [...prev, {
                   id: Date.now().toString(),
                   source: 'USER',
                   text: text,
                   timestamp: Date.now(),
                   isComplete: true
               }];
          }
      });
  };

  const replayTranscriptAudio = async (chunks?: string[]) => {
      if (!chunks || chunks.length === 0) return;
      const ctx = audioContextRef.current;
      if (!ctx) return;
      let time = ctx.currentTime;
      for (const chunk of chunks) {
          try {
              const uint8 = decodeBase64(chunk);
              const buffer = await decodeAudioData(uint8, ctx, AUDIO_SAMPLE_RATE_OUTPUT);
              const src = ctx.createBufferSource();
              src.buffer = buffer;
              src.connect(ctx.destination);
              src.start(time);
              time += buffer.duration;
          } catch(e) { console.error(e); }
      }
  };

  return (
    <>
    <div className="min-h-screen flex flex-col items-center justify-center relative p-6 overflow-hidden pb-20">
       
       {/* HEADER */}
       <div className="absolute top-12 left-0 right-0 text-center pointer-events-none z-20 animate-slide-in-top">
           <div className={`inline-block border bg-black/40 backdrop-blur-md px-4 py-1 rounded-full ${isConnected ? 'border-red-900/50' : 'border-neutral-800'}`}>
               <span className={`text-[10px] font-mono tracking-[0.3em] uppercase ${isConnected ? 'text-red-500' : 'text-neutral-500'}`}>
                  {isConnected ? "● SECURE UPLINK ACTIVE" : "○ AWAITING CONNECTION"}
               </span>
           </div>
           <h2 className="mt-4 text-4xl font-bold tracking-widest text-transparent bg-clip-text bg-gradient-to-b from-red-500 to-red-900 opacity-90 font-tech">NSD-SPECTER</h2>
       </div>

       {/* VISUALIZER */}
       <div className="relative w-96 h-96 flex items-center justify-center transition-all duration-500 animate-fade-in-scale">
           <div className={`absolute inset-0 border border-red-900/30 rounded-full transition-all duration-1000 ${isConnected ? 'opacity-100' : 'opacity-20'}`}></div>
           <div className={`absolute inset-4 border border-red-900/10 rounded-full transition-all duration-1000 ${isConnected ? 'animate-spin-slow opacity-100' : 'opacity-10'}`}></div>
           
           <div 
             className="relative rounded-full bg-red-600 transition-all duration-100 ease-out chromatic-aberration"
             style={{
                 width: `${120 + volumeAi * 120}px`,
                 height: `${120 + volumeAi * 120}px`,
                 boxShadow: `0 0 ${30 + volumeAi * 50}px rgba(220, 38, 38, ${0.5 + volumeAi * 0.5})`,
                 opacity: isConnected ? 0.9 : 0.3
             }}
           >
              <div 
                 className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-full mix-blend-overlay"
                 style={{ width: `${30 + volumeAi * 40}px`, height: `${30 + volumeAi * 40}px`, opacity: 0.8 }}
              />
           </div>
       </div>

       {/* FULL SCREEN VIDEO FEED (MOBILE MODE) */}
       {isFullScreenFeed && videoMode !== 'NONE' && (
           <div className="fixed inset-0 z-[100] bg-black flex flex-col animate-fade-in">
               <div className="relative flex-1 overflow-hidden">
                   <video ref={videoElementRef} muted playsInline autoPlay className="w-full h-full object-cover transform" />
                   <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(transparent_50%,rgba(220,38,38,0.1)_50%)] bg-[length:100%_4px] z-10"></div>
                   
                   {isDemoMode && (
                       <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
                           <div className="border-4 border-yellow-500/50 text-yellow-500 text-4xl font-black opacity-20 rotate-[-15deg] p-4 uppercase tracking-widest animate-pulse">
                               DEMO MODE
                           </div>
                       </div>
                   )}

                   <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-start z-20 bg-gradient-to-b from-black/80 to-transparent">
                       <div className="text-[10px] text-red-500 font-mono tracking-widest uppercase animate-pulse">
                           ● LIVE FEED // {videoMode}
                       </div>
                   </div>

                   <div className="absolute bottom-8 left-0 right-0 flex justify-center gap-6 z-30 pb-safe">
                       <button onClick={() => setIsMicOn(!isMicOn)} className={`p-4 rounded-full border backdrop-blur-md transition-all ${isMicOn ? 'bg-red-600/20 border-red-500 text-red-500' : 'bg-black/60 border-neutral-700 text-neutral-500'}`}>
                           {isMicOn ? <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg> : <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18" /></svg>}
                       </button>
                       {videoMode === 'CAMERA' && (
                           <button onClick={switchCamera} className="p-4 rounded-full bg-black/60 border border-neutral-700 text-white backdrop-blur-md hover:border-red-500 transition-all">
                               <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                           </button>
                       )}
                       <button onClick={stopVideo} className="p-4 rounded-full bg-red-900/80 border border-red-500 text-white backdrop-blur-md transition-all">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 6l12 12" /></svg>
                       </button>
                       <button onClick={() => setIsFullScreenFeed(false)} className="p-4 rounded-full bg-black/60 border border-neutral-700 text-white backdrop-blur-md hover:border-red-500 transition-all">
                           <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 15v4a1 1 0 001 1h4m11-5v4a1 1 0 01-1 1h-4m-5-10l-4-4m0 0L8 2m-4 0v4m16 4l4-4m0 0l-4-4m4 4v-4" /></svg>
                       </button>
                   </div>
               </div>
           </div>
       )}

       {/* DRAGGABLE VIDEO PREVIEW (DESKTOP MODE) */}
       {videoMode !== 'NONE' && !isFullScreenFeed && (
           <DraggableWindow title={`LIVE FEED // ${videoMode}`} initialX={50} initialY={100} onClose={stopVideo}>
               <div className="w-64 aspect-video bg-black relative group">
                   <video ref={videoElementRef} muted playsInline autoPlay className="w-full h-full object-cover opacity-80" />
                   <div className="absolute inset-0 bg-[linear-gradient(transparent_50%,rgba(220,38,38,0.1)_50%)] bg-[length:100%_4px] pointer-events-none"></div>
                   
                   {isDemoMode && (
                       <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
                           <div className="border-2 border-yellow-500/50 text-yellow-500 text-xl font-bold opacity-30 rotate-[-15deg] p-2 uppercase tracking-widest">
                               DEMO MODE
                           </div>
                       </div>
                   )}
                   
                   <button 
                     onClick={() => setIsFullScreenFeed(true)}
                     className="absolute top-2 right-2 p-2 bg-black/50 hover:bg-red-600/50 text-white rounded transition-all z-20"
                     title="Enter Full Screen Mode"
                   >
                       <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" /></svg>
                   </button>
               </div>
           </DraggableWindow>
       )}

       {/* DRAGGABLE TRANSCRIPT */}
       {showTranscript && (
           <DraggableWindow 
             title="TRANSCRIPT LOG" 
             initialX={window.innerWidth - 420} 
             initialY={100} 
             onClose={() => setShowTranscript(false)}
             className="w-[400px] h-[60vh]"
           >
              <div className="h-full overflow-y-auto space-y-6 p-4 no-scrollbar">
                 {transcript.length === 0 && <div className="text-neutral-600 text-center font-mono text-sm mt-10">NO DATA LOGGED</div>}
                 {transcript.map((item) => {
                     const cleanedText = item.source === 'AI' ? cleanTranscript(item.text) : item.text;
                     
                     if (!cleanedText && !item.audioChunks) return null;

                     return (
                         <div key={item.id} className={`flex flex-col gap-2 ${item.source === 'USER' ? 'items-end' : 'items-start'}`}>
                             <div className="flex items-center gap-2">
                                 <span className={`text-[10px] font-mono tracking-wider ${item.source === 'USER' ? 'text-neutral-500' : 'text-red-500'}`}>
                                     {item.source === 'USER' ? 'OPERATOR' : 'SPECTER'} // {new Date(item.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}
                                 </span>
                             </div>
                             {cleanedText && cleanedText.trim() !== '' && (
                                 <div className={`max-w-[85%] p-3 rounded-lg text-sm font-mono leading-relaxed ${item.source === 'USER' ? 'bg-neutral-800 text-neutral-300 rounded-tr-none' : 'bg-red-900/10 border border-red-900/30 text-red-100 rounded-tl-none'}`}>
                                     {item.source === 'AI' && !item.isComplete ? <TypewriterText text={cleanedText} /> : cleanedText}
                                 </div>
                             )}
                             {item.source === 'AI' && item.audioChunks && item.audioChunks.length > 0 && (
                                 <button onClick={() => replayTranscriptAudio(item.audioChunks)} className="flex items-center gap-1 text-[10px] text-red-500/60 hover:text-red-400 uppercase tracking-widest">
                                     REPLAY AUDIO
                                 </button>
                             )}
                         </div>
                     );
                 })}
                 <div ref={transcriptEndRef}></div>
              </div>
           </DraggableWindow>
       )}

       {/* HIDDEN CANVAS */}
       <canvas ref={canvasRef} className="hidden" />

       {/* CONTROLS */}
       <div className="mt-12 z-40 flex flex-col items-center gap-6 transition-all duration-500 animate-slide-in-bottom">
           {!isConnected ? (
               <div className="flex flex-col items-center gap-2">
                   <button 
                     onClick={startSession}
                     className="group relative px-8 py-4 bg-red-600 hover:bg-red-500 text-white font-bold tracking-widest uppercase rounded-xl transition-all shadow-[0_0_30px_rgba(220,38,38,0.4)] hover:shadow-[0_0_50px_rgba(220,38,38,0.6)] hover:scale-105 active:scale-95"
                   >
                       <span className="relative z-10 flex items-center gap-3">
                           <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                           INITIATE UPLINK
                       </span>
                   </button>
               </div>
           ) : (
               <div className="flex flex-col gap-4">
                 
                 <form onSubmit={handleTextInput} className="flex gap-2 w-full max-w-lg">
                    <input 
                      type="text" 
                      value={textInput}
                      onChange={(e) => setTextInput(e.target.value)}
                      placeholder="Type query protocol..."
                      className="flex-1 bg-black/50 border border-neutral-700 text-white px-4 py-3 rounded-xl focus:border-red-500 outline-none text-sm font-mono placeholder-neutral-600"
                    />
                    <button type="submit" className="px-4 bg-neutral-800 border border-neutral-700 rounded-xl text-neutral-400 hover:text-white hover:border-red-500">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                    </button>
                 </form>

                 <div className="flex gap-4 items-center bg-black/50 backdrop-blur-sm p-3 rounded-2xl border border-neutral-800 justify-center">
                   
                   <button 
                     onClick={() => { setIsMicOn(!isMicOn); logToConsole(isMicOn ? "MIC MUTED" : "MIC ACTIVE", 'info'); }}
                     className={`p-4 rounded-xl border transition-all ${isMicOn ? 'bg-red-500/10 border-red-500 text-red-500' : 'bg-neutral-800 border-neutral-600 text-neutral-500'}`}
                   >
                       {isMicOn ? (
                         <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                         </svg>
                       ) : (
                         <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18" />
                         </svg>
                       )}
                   </button>

                   <button 
                     onClick={() => toggleVideo('CAMERA')}
                     className={`p-4 rounded-xl border transition-all ${videoMode === 'CAMERA' ? 'bg-red-500/10 border-red-500 text-red-500 shadow-[0_0_15px_rgba(220,38,38,0.3)]' : 'bg-neutral-800 border-neutral-600 text-neutral-500 hover:text-white'}`}
                   >
                       <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                   </button>

                   <button 
                     onClick={() => toggleVideo('SCREEN')}
                     className={`p-4 rounded-xl border transition-all ${videoMode === 'SCREEN' ? 'bg-red-500/10 border-red-500 text-red-500 shadow-[0_0_15px_rgba(220,38,38,0.3)]' : 'bg-neutral-800 border-neutral-600 text-neutral-500 hover:text-white'}`}
                   >
                       <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                   </button>
                   
                   <div className="w-px h-8 bg-neutral-700 mx-2"></div>

                   <button
                     disabled
                     className="p-4 rounded-xl border bg-neutral-900 border-neutral-800 text-neutral-700 cursor-not-allowed opacity-50"
                     title="TRANSCRIPT SYSTEM OFFLINE"
                   >
                     <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" /></svg>
                   </button>

                   <button onClick={stopSession} className="p-4 rounded-xl bg-neutral-900 border border-neutral-700 text-white hover:bg-red-900/50 hover:border-red-500 transition-all ml-2">
                       <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                   </button>
                 </div>
               </div>
           )}
       </div>

    </div>
    </>
  );
};

export default Generator;