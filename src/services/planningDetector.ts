import { logger } from '../utils/logger';
import { buildClickScript } from './approvalDetector';
import { CdpService } from './cdpService';

/** Planning mode button information */
export interface PlanningInfo {
    /** Open button text */
    openText: string;
    /** Proceed button text */
    proceedText: string;
    /** Plan title (file name shown in the card) */
    planTitle: string;
    /** Plan summary text */
    planSummary: string;
    /** Plan description (markdown rendered in leading-relaxed container) */
    description: string;
}

export interface PlanningDetectorOptions {
    /** CDP service instance */
    cdpService: CdpService;
    /** Poll interval in milliseconds (default: 2000ms) */
    pollIntervalMs?: number;
    /** Callback when planning buttons are detected */
    onPlanningRequired: (info: PlanningInfo) => void;
    /** Callback when a previously detected planning state is resolved (buttons disappeared) */
    onResolved?: () => void;
}

/**
 * Detection script for the Antigravity UI planning mode.
 *
 * Looks for Open/Proceed button pairs inside .notify-user-container
 * and extracts plan metadata from the surrounding DOM elements.
 */
const DETECT_PLANNING_SCRIPT = `(() => {
    // Check if the chat is currently generating (if generating, it's not waiting for approval)
    const stopButtonEls = document.querySelectorAll('.lucide-square, .lucide-circle-stop, [aria-label="Stop Generation"], [aria-label="Stop Generating"], button[class*="square"]');
    const isGenerating = Array.from(stopButtonEls).some(el => el.offsetParent !== null);
    if (isGenerating) return null;

    // Get the last generic message
    const messages = Array.from(document.querySelectorAll('.leading-relaxed.select-text, .prose'));
    if (messages.length === 0) return null;

    const lastMsg = messages[messages.length - 1];
    const rawText = (lastMsg.innerText || lastMsg.textContent || '').trim();
    const text = rawText.toLowerCase();

    // The Antigravity extension no longer renders a dedicated planning UI with buttons.
    // Instead, it relies on the user typing approval in the chat.
    const isPlan = (text.includes('implementation plan') || text.includes('plan for a way')) && 
                   (text.includes('approve') || text.includes('review') || text.includes('proceed') || text.includes('approval') || text.includes('execute'));

    if (!isPlan) return null;

    return {
        openText: 'Open',
        proceedText: 'Proceed',
        planTitle: 'Implementation Plan',
        planSummary: 'An implementation plan is awaiting your approval.',
        description: rawText.substring(0, 500)
    };
})()`;

/**
 * Extract plan content displayed after clicking Open.
 *
 * Looks for the rendered markdown inside the plan content area
 * and returns the text, truncated to 4000 characters for Discord embed limits.
 */
const EXTRACT_PLAN_CONTENT_SCRIPT = `(() => {
    // Simple HTML-to-Markdown converter for plan content
    const htmlToMd = (el) => {
        const parts = [];
        const process = (node) => {
            if (node.nodeType === 3) {
                parts.push(node.textContent || '');
                return;
            }
            if (node.nodeType !== 1) return;
            const tag = node.tagName;
            if (tag === 'H1') { parts.push('\\n# '); node.childNodes.forEach(process); parts.push('\\n'); return; }
            if (tag === 'H2') { parts.push('\\n## '); node.childNodes.forEach(process); parts.push('\\n'); return; }
            if (tag === 'H3') { parts.push('\\n### '); node.childNodes.forEach(process); parts.push('\\n'); return; }
            if (tag === 'H4') { parts.push('\\n#### '); node.childNodes.forEach(process); parts.push('\\n'); return; }
            if (tag === 'STRONG' || tag === 'B') { parts.push('**'); node.childNodes.forEach(process); parts.push('**'); return; }
            if (tag === 'EM' || tag === 'I') { parts.push('*'); node.childNodes.forEach(process); parts.push('*'); return; }
            if (tag === 'PRE') {
                const code = node.querySelector('code');
                const text = code ? (code.textContent || '') : (node.textContent || '');
                parts.push('\\n\`\`\`\\n' + text + '\\n\`\`\`\\n');
                return;
            }
            if (tag === 'CODE') { parts.push('\`' + (node.textContent || '') + '\`'); return; }
            if (tag === 'A') {
                const href = node.getAttribute('href') || '';
                parts.push('['); node.childNodes.forEach(process); parts.push('](' + href + ')');
                return;
            }
            if (tag === 'LI') { parts.push('\\n- '); node.childNodes.forEach(process); return; }
            if (tag === 'BR') { parts.push('\\n'); return; }
            if (tag === 'P') { parts.push('\\n\\n'); node.childNodes.forEach(process); parts.push('\\n'); return; }
            if (tag === 'UL' || tag === 'OL') { node.childNodes.forEach(process); parts.push('\\n'); return; }
            if (tag === 'STYLE' || tag === 'SCRIPT') return;
            node.childNodes.forEach(process);
        };
        process(el);
        return parts.join('').replace(/\\n{3,}/g, '\\n\\n').trim();
    };

    // Primary selector: plan content container
    const contentContainer = document.querySelector(
        'div.relative.pl-4.pr-4.py-1, div.relative.pl-4.pr-4'
    );
    if (contentContainer) {
        const textEl = contentContainer.querySelector('.leading-relaxed.select-text');
        if (textEl) {
            return htmlToMd(textEl);
        }
    }

    // Fallback: any leading-relaxed.select-text with significant content
    const allLeading = Array.from(document.querySelectorAll('.leading-relaxed.select-text'));
    for (const el of allLeading) {
        const md = htmlToMd(el);
        if (md.length > 100) {
            return md;
        }
    }

    return null;
})()`;

/**
 * Detects planning mode buttons (Open/Proceed) in the Antigravity UI via polling.
 *
 * Follows the same polling pattern as ApprovalDetector:
 * - start()/stop() lifecycle
 * - Duplicate notification prevention via lastDetectedKey
 * - CDP error tolerance (continues polling on error)
 */
export class PlanningDetector {
    private cdpService: CdpService;
    private pollIntervalMs: number;
    private onPlanningRequired: (info: PlanningInfo) => void;
    private onResolved?: () => void;

    private pollTimer: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;
    /** Key of the last detected planning info (for duplicate notification prevention) */
    private lastDetectedKey: string | null = null;
    /** Full PlanningInfo from the last detection */
    private lastDetectedInfo: PlanningInfo | null = null;
    /** Timestamp of last notification (for cooldown-based dedup) */
    private lastNotifiedAt: number = 0;
    /** Cooldown period in ms to suppress duplicate notifications */
    private static readonly COOLDOWN_MS = 5000;

    constructor(options: PlanningDetectorOptions) {
        this.cdpService = options.cdpService;
        this.pollIntervalMs = options.pollIntervalMs ?? 2000;
        this.onPlanningRequired = options.onPlanningRequired;
        this.onResolved = options.onResolved;
    }

    /** Start monitoring. */
    start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastDetectedKey = null;
        this.lastDetectedInfo = null;
        this.lastNotifiedAt = 0;
        this.schedulePoll();
    }

    /** Stop monitoring. */
    async stop(): Promise<void> {
        this.isRunning = false;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
    }

    /** Return the last detected planning info. Returns null if nothing has been detected. */
    getLastDetectedInfo(): PlanningInfo | null {
        return this.lastDetectedInfo;
    }

    /** Returns whether monitoring is currently active. */
    isActive(): boolean {
        return this.isRunning;
    }

    async clickOpenButton(buttonText?: string): Promise<boolean> {
        // Mock successful open, since the UI is no longer button driven
        return true;
    }

    async clickProceedButton(buttonText?: string): Promise<boolean> {
        // Native UI no longer has a proceed button. Instead, we inject an approval
        // message into the chat as if the user typed it.
        const result = await this.cdpService.injectMessage('Looks good. Please proceed!');
        return result.ok;
    }

    async extractPlanContent(): Promise<string | null> {
        // Instead of executing specific DOM extraction that usually fails 
        // because plan contents are now embedded in an iframe context, 
        // we'll just extract the context text directly or return the description.
        return this.lastDetectedInfo?.description ?? null;
    }

    /** Schedule the next poll. */
    private schedulePoll(): void {
        if (!this.isRunning) return;
        this.pollTimer = setTimeout(async () => {
            await this.poll();
            if (this.isRunning) {
                this.schedulePoll();
            }
        }, this.pollIntervalMs);
    }

    /**
     * Single poll iteration:
     *   1. Get planning button info from DOM (with contextId)
     *   2. Notify via callback only on new detection (prevent duplicates)
     *   3. Reset lastDetectedKey / lastDetectedInfo when buttons disappear
     */
    private async poll(): Promise<void> {
        try {
            const contextId = this.cdpService.getPrimaryContextId();
            const callParams: Record<string, unknown> = {
                expression: DETECT_PLANNING_SCRIPT,
                returnByValue: true,
                awaitPromise: false,
            };
            if (contextId !== null) {
                callParams.contextId = contextId;
            }

            const result = await this.cdpService.call('Runtime.evaluate', callParams);
            const info: PlanningInfo | null = result?.result?.value ?? null;

            if (info) {
                // Duplicate prevention: use button text pair as key (stable across DOM redraws)
                const key = `${info.openText}::${info.proceedText}`;
                const now = Date.now();
                const withinCooldown = (now - this.lastNotifiedAt) < PlanningDetector.COOLDOWN_MS;
                if (key !== this.lastDetectedKey && !withinCooldown) {
                    this.lastDetectedKey = key;
                    this.lastDetectedInfo = info;
                    this.lastNotifiedAt = now;
                    this.onPlanningRequired(info);
                } else if (key === this.lastDetectedKey) {
                    // Same key — update stored info silently
                    this.lastDetectedInfo = info;
                }
            } else {
                // Reset when buttons disappear (prepare for next planning detection)
                const wasDetected = this.lastDetectedKey !== null;
                this.lastDetectedKey = null;
                this.lastDetectedInfo = null;
                if (wasDetected && this.onResolved) {
                    this.onResolved();
                }
            }
        } catch (error) {
            // Ignore CDP errors and continue monitoring
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes('WebSocket is not connected')) {
                return;
            }
            logger.error('[PlanningDetector] Error during polling:', error);
        }
    }

    /** Internal click handler using buildClickScript from approvalDetector. */
    private async clickButton(buttonText: string): Promise<boolean> {
        try {
            const result = await this.runEvaluateScript(buildClickScript(buttonText));
            return result?.ok === true;
        } catch (error) {
            logger.error('[PlanningDetector] Error while clicking button:', error);
            return false;
        }
    }

    /** Execute Runtime.evaluate with contextId and return result.value. */
    private async runEvaluateScript(expression: string): Promise<any> {
        const contextId = this.cdpService.getPrimaryContextId();
        const callParams: Record<string, unknown> = {
            expression,
            returnByValue: true,
            awaitPromise: false,
        };
        if (contextId !== null) {
            callParams.contextId = contextId;
        }
        const result = await this.cdpService.call('Runtime.evaluate', callParams);
        return result?.result?.value;
    }
}
