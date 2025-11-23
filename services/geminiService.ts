
// This service file is intentionally left minimal as the Live API connection 
// requires direct integration with the AudioContext and WebSocket event listeners
// which are best managed within the React Component lifecycle or a custom hook.

import { GoogleGenAI } from "@google/genai";

export const getClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API_KEY is missing from environment variables.");
  }
  return new GoogleGenAI({ apiKey });
};
