import { logger } from './logger';
import { fetch as undiciFetch } from 'undici';

const KOKORO_API_URL = process.env.TTS_API_URL || 'http://darrowby:8880/v1/audio/speech';
const DEFAULT_VOICE = 'af_bella'; // High quality American Female voice

/**
 * Generate a complete audio buffer for a given text by calling the local
 * Kokoro TTS API endpoint running on matt-windows.
 * 
 * @param text The response text to convert to spoken audio
 * @param voice The requested Kokoro voice file identifier (default 'af_bella')
 * @returns A Buffer representing the generated MP3 audio file
 */
export async function generateAudioStream(text: string, voice: string = DEFAULT_VOICE): Promise<Buffer | null> {
    try {
        const cleanText = text.replace(/[*_~`]/g, '').trim();
        if (cleanText.length === 0) return null;

        // Post to the OpenAI-compatible Kokoro endpoint
        const response = await undiciFetch(KOKORO_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer not-needed'
            },
            body: JSON.stringify({
                model: 'kokoro',
                input: cleanText,
                voice: voice,
                response_format: 'mp3',
                speed: 1.0
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.error(`[AudioHandler] Failed to generate Kokoro audio chunk. HTTP ${response.status}: ${errorText}`);
            return null;
        }

        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    } catch (e) {
        logger.error('[AudioHandler] Network error while fetching Kokoro TTS:', e);
        return null;
    }
}
