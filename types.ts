
export enum AudioStatus {
  DISCONNECTED = "disconnected",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  ERROR = "error"
}

export interface AudioVisualizerState {
  isUserSpeaking: boolean;
  isAiSpeaking: boolean;
  userVolume: number; // 0-1
  aiVolume: number; // 0-1
}

export interface LogEntry {
  id: string;
  timestamp: string;
  source: 'USER' | 'AI' | 'SYSTEM';
  text: string;
}

export interface TranscriptItem {
  id: string;
  source: 'USER' | 'AI';
  text: string;
  audioChunks?: string[]; // Array of Base64 strings for replay
  groundingMetadata?: any; // Search results and citations
  timestamp: number;
  isComplete: boolean;
}

export type VideoMode = 'NONE' | 'CAMERA' | 'SCREEN';
