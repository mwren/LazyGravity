import * as googleTTS from 'google-tts-api';
import { logger } from './logger';
import { fetch as undiciFetch } from 'undici';

/**
 * Generate a complete audio buffer for a given text by chunking it
 * into pieces of ~200 characters natively handled by google-tts-api.
 * 
 * @param text The response text to convert to spoken audio
 * @param lang ISO language code (default 'en')
 * @returns A Buffer representing the combined MP3 audio file
 */
export async function generateAudioStream(text: string, lang: string = 'en'): Promise<Buffer | null> {
    try {
        const cleanText = text.replace(/[*_~`]/g, '').trim();
        if (cleanText.length === 0) return null;

        // google-tts-api restricts characters to 200 per buffer request.
        // getAllAudioUrls natively handles splitting lines by sentence.
        const audioNodes = googleTTS.getAllAudioUrls(cleanText, {
            lang,
            slow: false,
            host: 'https://translate.google.com',
            splitPunct: ',.?!', // Split text carefully so audio chunks sound natural
        });

        if (!audioNodes || audioNodes.length === 0) {
            return null;
        }

        const audioBuffers: Buffer[] = [];
        
        for (const node of audioNodes) {
            try {
                // We use undici to respect network layers
                const response = await undiciFetch(node.url);
                if (!response.ok) {
                    logger.error(`[AudioHandler] Failed to download audio chunk. HTTP ${response.status}`);
                    continue;
                }
                const arrayBuffer = await response.arrayBuffer();
                audioBuffers.push(Buffer.from(arrayBuffer));
            } catch (err) {
                logger.error('[AudioHandler] Network error while fetching TTS url:', err);
            }
        }

        return Buffer.concat(audioBuffers);
    } catch (e) {
        logger.error('[AudioHandler] Failed to generate complete audio stream:', e);
        return null;
    }
}
