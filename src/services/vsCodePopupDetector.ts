import { logger } from '../utils/logger';
import { CdpService } from './cdpService';

export interface VsCodePopupInfo {
    type: 'dialog' | 'notification' | 'quickpick';
    text: string;
    buttons: string[];
}

export interface VsCodePopupDetectorOptions {
    cdpService: CdpService;
    pollIntervalMs?: number;
    onPopupDetected: (info: VsCodePopupInfo) => void;
    onResolved?: () => void;
}

const DETECT_POPUP_SCRIPT = `(() => {
    const dialogs = document.querySelectorAll('.monaco-dialog-box');
    const notifications = document.querySelectorAll('.notification-toast');
    const quickPicks = document.querySelectorAll('.quick-input-widget');
    const results = [];

    dialogs.forEach(d => {
        if (d.offsetParent === null) return;
        const textEl = d.querySelector('.dialog-message') || d;
        const text = (textEl.textContent || '').trim();
        const buttons = Array.from(d.querySelectorAll('.monaco-button')).filter(b => b.offsetParent !== null).map(b => (b.textContent || '').trim());
        results.push({ type: 'dialog', text, buttons });
    });

    notifications.forEach(n => {
        if (n.offsetParent === null) return;
        const textEl = n.querySelector('.notification-list-item-message') || n;
        const text = (textEl.textContent || '').trim();
        const buttons = Array.from(n.querySelectorAll('.monaco-button')).filter(b => b.offsetParent !== null).map(b => (b.textContent || '').trim());
        if (buttons.length > 0) {
            results.push({ type: 'notification', text, buttons });
        }
    });

    quickPicks.forEach(q => {
        if (q.offsetParent === null || q.style.display === 'none') return;
        const textEl = q.querySelector('.quick-input-title') || q.querySelector('.quick-input-header') || q;
        const text = (textEl.textContent || '').trim() || 'Input requested';
        results.push({ type: 'quickpick', text, buttons: [] });
    });

    if (results.length > 0) return results[0];
    return null;
})()`;

export function buildClickVsCodeButtonScript(buttonText: string): string {
    const safeText = JSON.stringify(buttonText);
    return `(() => {
        const normalize = (text) => (text || '').toLowerCase().replace(/\\s+/g, ' ').trim();
        const wanted = normalize(${safeText});
        const buttons = Array.from(document.querySelectorAll('.monaco-dialog-box .monaco-button, .notification-toast .monaco-button'))
            .filter(btn => btn.offsetParent !== null);
        const target = buttons.find(btn => normalize(btn.textContent || '') === wanted || normalize(btn.getAttribute('aria-label') || '') === wanted);
        if (!target) return { ok: false, error: 'Button not found' };
        
        target.click();
        return { ok: true };
    })()`;
}

export class VsCodePopupDetector {
    private cdpService: CdpService;
    private pollIntervalMs: number;
    private onPopupDetected: (info: VsCodePopupInfo) => void;
    private onResolved?: () => void;

    private pollTimer: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;
    private lastDetectedKey: string | null = null;

    constructor(options: VsCodePopupDetectorOptions) {
        this.cdpService = options.cdpService;
        this.pollIntervalMs = options.pollIntervalMs ?? 2000;
        this.onPopupDetected = options.onPopupDetected;
        this.onResolved = options.onResolved;
    }

    start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastDetectedKey = null;
        this.schedulePoll();
    }

    async stop(): Promise<void> {
        this.isRunning = false;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
    }

    private schedulePoll(): void {
        if (!this.isRunning) return;
        this.pollTimer = setTimeout(async () => {
            await this.poll();
            if (this.isRunning) {
                this.schedulePoll();
            }
        }, this.pollIntervalMs);
    }

    private async poll(): Promise<void> {
        try {
            const callParams: Record<string, unknown> = {
                expression: DETECT_POPUP_SCRIPT,
                returnByValue: true,
                awaitPromise: false,
            };

            const result = await this.cdpService.call('Runtime.evaluate', callParams);
            const info: VsCodePopupInfo | null = result?.result?.value ?? null;

            if (info) {
                const key = `${info.type}::${info.text}`;
                if (key !== this.lastDetectedKey) {
                    this.lastDetectedKey = key;
                    this.onPopupDetected(info);
                }
            } else {
                const wasDetected = this.lastDetectedKey !== null;
                this.lastDetectedKey = null;
                if (wasDetected && this.onResolved) {
                    this.onResolved();
                }
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes('WebSocket is not connected')) {
                return;
            }
            logger.error('[VsCodePopupDetector] Error during polling:', error);
        }
    }

    async clickButton(buttonText: string): Promise<boolean> {
        try {
            const script = buildClickVsCodeButtonScript(buttonText);
            const callParams: Record<string, unknown> = {
                expression: script,
                returnByValue: true,
                awaitPromise: false,
            };
            const result = await this.cdpService.call('Runtime.evaluate', callParams);
            const data = result?.result?.value;
            if (data?.ok !== true) {
                logger.warn(`[VsCodePopupDetector] Click failed for "${buttonText}":`, data?.error ?? 'unknown');
            } else {
                logger.debug(`[VsCodePopupDetector] Click OK for "${buttonText}"`);
            }
            return data?.ok === true;
        } catch (error) {
            logger.error('[VsCodePopupDetector] Error while clicking button:', error);
            return false;
        }
    }

    isActive(): boolean {
        return this.isRunning;
    }
}
