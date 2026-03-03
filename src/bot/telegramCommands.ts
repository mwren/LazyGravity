/**
 * Telegram command parser and handlers.
 *
 * Handles built-in bot commands that can be answered immediately
 * without routing through CDP/Antigravity:
 *   /start  — Welcome message
 *   /help   — List available commands
 *   /status — Show bot connection status
 *   /stop   — Interrupt active LLM generation
 *   /ping   — Latency check
 */

import type { PlatformMessage } from '../platform/types';
import type { CdpBridge } from '../services/cdpBridgeManager';
import { getCurrentCdp } from '../services/cdpBridgeManager';
import { RESPONSE_SELECTORS } from '../services/responseMonitor';
import type { ModeService } from '../services/modeService';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Known commands (used by both parser and /help output)
// ---------------------------------------------------------------------------

const KNOWN_COMMANDS = ['start', 'help', 'status', 'stop', 'ping'] as const;
type KnownCommand = typeof KNOWN_COMMANDS[number];

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export interface ParsedTelegramCommand {
    readonly command: string;
    readonly args: string;
}

/**
 * Parse a Telegram command from message text.
 *
 * Accepted formats:
 *   /command
 *   /command args text
 *   /command@BotName
 *   /command@BotName args text
 *
 * Returns null if the text is not a known command (unknown commands
 * are forwarded to Antigravity as normal messages).
 */
export function parseTelegramCommand(text: string): ParsedTelegramCommand | null {
    const trimmed = text.trim();
    const match = trimmed.match(/^\/(\w+)(?:@\S+)?(?:\s+(.*))?$/);
    if (!match) return null;

    const command = match[1].toLowerCase();
    if (!(KNOWN_COMMANDS as readonly string[]).includes(command)) return null;

    return {
        command,
        args: (match[2] ?? '').trim(),
    };
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface TelegramCommandDeps {
    readonly bridge: CdpBridge;
    readonly modeService?: ModeService;
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Handle a parsed Telegram command.
 * Routes to the appropriate sub-handler based on command name.
 */
export async function handleTelegramCommand(
    deps: TelegramCommandDeps,
    message: PlatformMessage,
    parsed: ParsedTelegramCommand,
): Promise<void> {
    switch (parsed.command as KnownCommand) {
        case 'start':
            await handleStart(message);
            break;
        case 'help':
            await handleHelp(message);
            break;
        case 'status':
            await handleStatus(deps, message);
            break;
        case 'stop':
            await handleStop(deps, message);
            break;
        case 'ping':
            await handlePing(message);
            break;
        default:
            // Should not happen — parser filters unknowns
            break;
    }
}

// ---------------------------------------------------------------------------
// Sub-handlers
// ---------------------------------------------------------------------------

async function handleStart(message: PlatformMessage): Promise<void> {
    const text = [
        '<b>Welcome to LazyGravity!</b>',
        '',
        'This bot connects you to Antigravity AI workspaces.',
        '',
        'Get started:',
        '1. Use /project to bind this chat to a workspace',
        '2. Send any message to start chatting with Antigravity',
        '',
        'Type /help for a list of available commands.',
    ].join('\n');

    await message.reply({ text }).catch(logger.error);
}

async function handleHelp(message: PlatformMessage): Promise<void> {
    const text = [
        '<b>Available Commands</b>',
        '',
        '/project — Manage workspace bindings',
        '/status — Show bot status and connections',
        '/stop — Interrupt active LLM generation',
        '/ping — Check bot latency',
        '/help — Show this help message',
        '',
        'Any other message is forwarded to Antigravity.',
    ].join('\n');

    await message.reply({ text }).catch(logger.error);
}

async function handleStatus(deps: TelegramCommandDeps, message: PlatformMessage): Promise<void> {
    const activeWorkspaces = deps.bridge.pool.getActiveWorkspaceNames();
    const cdpStatus = activeWorkspaces.length > 0
        ? `Connected (${activeWorkspaces.join(', ')})`
        : 'Not connected';

    const mode = deps.modeService
        ? deps.modeService.getCurrentMode()
        : 'unknown';

    const text = [
        '<b>Bot Status</b>',
        '',
        `CDP: ${cdpStatus}`,
        `Mode: ${mode}`,
        `Active workspaces: ${activeWorkspaces.length}`,
    ].join('\n');

    await message.reply({ text }).catch(logger.error);
}

async function handleStop(deps: TelegramCommandDeps, message: PlatformMessage): Promise<void> {
    const cdp = getCurrentCdp(deps.bridge);
    if (!cdp) {
        await message.reply({ text: 'No active workspace connection.' }).catch(logger.error);
        return;
    }

    try {
        const result = await cdp.call(
            'Runtime.evaluate',
            { expression: RESPONSE_SELECTORS.CLICK_STOP_BUTTON, returnByValue: true },
        );
        const value = result?.result?.value;
        if (value && typeof value === 'object' && value.clicked) {
            await message.reply({ text: 'Stop button clicked.' }).catch(logger.error);
        } else {
            await message.reply({ text: 'Stop button not found (generation may have already finished).' }).catch(logger.error);
        }
    } catch (err: any) {
        logger.error('[TelegramCommand:stop]', err?.message || err);
        await message.reply({ text: 'Failed to click stop button.' }).catch(logger.error);
    }
}

async function handlePing(message: PlatformMessage): Promise<void> {
    await message.reply({ text: 'Pong!' }).catch(logger.error);
}
