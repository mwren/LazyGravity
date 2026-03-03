/**
 * Telegram command parser and handlers.
 *
 * Handles built-in bot commands that can be answered immediately
 * without routing through CDP/Antigravity:
 *   /start      — Welcome message
 *   /help       — List available commands
 *   /status     — Show bot connection status
 *   /stop       — Interrupt active LLM generation
 *   /ping       — Latency check
 *   /mode       — Switch execution mode
 *   /model      — Switch LLM model
 *   /screenshot — Capture Antigravity screenshot
 *   /autoaccept — Toggle auto-accept for approval dialogs
 *   /template   — List and execute prompt templates
 *   /logs       — Show recent log entries
 */

import type { PlatformMessage, MessagePayload } from '../platform/types';
import type { CdpBridge } from '../services/cdpBridgeManager';
import { getCurrentCdp } from '../services/cdpBridgeManager';
import { RESPONSE_SELECTORS } from '../services/responseMonitor';
import type { ModeService } from '../services/modeService';
import type { TelegramBindingRepository } from '../database/telegramBindingRepository';
import type { TemplateRepository } from '../database/templateRepository';
import { buildModePayload } from '../ui/modeUi';
import { buildModelsPayload } from '../ui/modelsUi';
import { buildAutoAcceptPayload } from '../ui/autoAcceptUi';
import { buildTemplatePayload } from '../ui/templateUi';
import { buildScreenshotPayload } from '../ui/screenshotUi';
import { logBuffer } from '../utils/logBuffer';
import { escapeHtml } from '../platform/telegram/telegramFormatter';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Known commands (used by both parser and /help output)
// ---------------------------------------------------------------------------

const KNOWN_COMMANDS = ['start', 'help', 'status', 'stop', 'ping', 'mode', 'model', 'screenshot', 'autoaccept', 'template', 'logs'] as const;
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
    readonly telegramBindingRepo?: TelegramBindingRepository;
    readonly templateRepo?: TemplateRepository;
    readonly fetchQuota?: () => Promise<any[]>;
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
        case 'mode':
            await handleMode(deps, message);
            break;
        case 'model':
            await handleModel(deps, message);
            break;
        case 'screenshot':
            await handleScreenshot(deps, message);
            break;
        case 'autoaccept':
            await handleAutoAccept(deps, message, parsed.args);
            break;
        case 'template':
            await handleTemplate(deps, message);
            break;
        case 'logs':
            await handleLogs(message, parsed.args);
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
        '/mode — Switch execution mode',
        '/model — Switch LLM model',
        '/screenshot — Capture Antigravity screenshot',
        '/autoaccept — Toggle auto-accept mode',
        '/template — List prompt templates',
        '/logs — Show recent log entries',
        '/stop — Interrupt active LLM generation',
        '/ping — Check bot latency',
        '/help — Show this help message',
        '',
        'Any other message is forwarded to Antigravity.',
    ].join('\n');

    await message.reply({ text }).catch(logger.error);
}

async function handleStatus(deps: TelegramCommandDeps, message: PlatformMessage): Promise<void> {
    const chatId = message.channel.id;

    // Current chat binding
    const binding = deps.telegramBindingRepo?.findByChatId(chatId);
    const boundProject = binding?.workspacePath ?? '(none)';

    // CDP connection status for this chat's project
    const activeWorkspaces = deps.bridge.pool.getActiveWorkspaceNames();
    const projectConnected = binding
        ? activeWorkspaces.some((name) => binding.workspacePath.includes(name) || name.includes(binding.workspacePath))
        : false;

    const mode = deps.modeService
        ? deps.modeService.getCurrentMode()
        : 'unknown';

    const lines = [
        '<b>Bot Status</b>',
        '',
        `<b>This chat:</b>`,
        `  Project: ${escapeHtml(boundProject)}`,
        `  CDP: ${projectConnected ? 'Connected' : 'Not connected'}`,
        '',
        `Mode: ${escapeHtml(mode)}`,
        `Active connections: ${activeWorkspaces.length > 0 ? activeWorkspaces.map(escapeHtml).join(', ') : 'none'}`,
    ];

    await message.reply({ text: lines.join('\n') }).catch(logger.error);
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

async function handleMode(deps: TelegramCommandDeps, message: PlatformMessage): Promise<void> {
    if (!deps.modeService) {
        await message.reply({ text: 'Mode service not available.' }).catch(logger.error);
        return;
    }

    // Sync with live CDP mode if available
    const cdp = getCurrentCdp(deps.bridge);
    if (cdp) {
        const liveMode = await cdp.getCurrentMode();
        if (liveMode) {
            deps.modeService.setMode(liveMode);
        }
    }

    const payload = buildModePayload(deps.modeService.getCurrentMode());
    await message.reply(payload).catch(logger.error);
}

async function handleModel(deps: TelegramCommandDeps, message: PlatformMessage): Promise<void> {
    const cdp = getCurrentCdp(deps.bridge);
    if (!cdp) {
        await message.reply({ text: 'Not connected to Antigravity.' }).catch(logger.error);
        return;
    }

    const models = await cdp.getUiModels();
    const currentModel = await cdp.getCurrentModel();
    const quotaData = deps.fetchQuota ? await deps.fetchQuota() : [];

    const payload = buildModelsPayload(models, currentModel, quotaData);
    if (!payload) {
        await message.reply({ text: 'No models available.' }).catch(logger.error);
        return;
    }

    await message.reply(payload).catch(logger.error);
}

async function handleScreenshot(deps: TelegramCommandDeps, message: PlatformMessage): Promise<void> {
    const cdp = getCurrentCdp(deps.bridge);
    const payload = await buildScreenshotPayload(cdp);

    // If the payload contains files, send them as text (base64) since
    // Telegram file sending requires special API calls handled by the adapter.
    if (payload.files && payload.files.length > 0) {
        await sendFilePayload(message, payload);
    } else {
        await message.reply(payload).catch(logger.error);
    }
}

async function handleAutoAccept(deps: TelegramCommandDeps, message: PlatformMessage, args: string): Promise<void> {
    // If args are provided (e.g. /autoaccept on), handle directly
    if (args) {
        const result = deps.bridge.autoAccept.handle(args);
        await message.reply({ text: result.message }).catch(logger.error);
        return;
    }

    // No args — show interactive UI with buttons
    const payload = buildAutoAcceptPayload(deps.bridge.autoAccept.isEnabled());
    await message.reply(payload).catch(logger.error);
}

async function handleTemplate(deps: TelegramCommandDeps, message: PlatformMessage): Promise<void> {
    if (!deps.templateRepo) {
        await message.reply({ text: 'Template service not available.' }).catch(logger.error);
        return;
    }

    const templates = deps.templateRepo.findAll();
    const payload = buildTemplatePayload(templates);
    await message.reply(payload).catch(logger.error);
}

async function handleLogs(message: PlatformMessage, args: string): Promise<void> {
    const countArg = args ? parseInt(args, 10) : 20;
    const count = isNaN(countArg) ? 20 : Math.min(Math.max(countArg, 1), 50);

    const entries = logBuffer.getRecent(count);
    if (entries.length === 0) {
        await message.reply({ text: 'No log entries.' }).catch(logger.error);
        return;
    }

    const lines = entries.map(
        (e) => `<code>${e.timestamp.slice(11, 19)}</code> [${e.level.toUpperCase()}] ${escapeHtml(e.message)}`,
    );

    const text = `<b>Recent Logs (${entries.length})</b>\n\n${lines.join('\n')}`;

    // Telegram message limit is 4096 chars
    const truncated = text.length > 4096 ? text.slice(0, 4090) + '\n...' : text;
    await message.reply({ text: truncated }).catch(logger.error);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Send a MessagePayload that contains file attachments.
 * Falls back to a text reply if file sending is not supported.
 */
async function sendFilePayload(message: PlatformMessage, payload: MessagePayload): Promise<void> {
    // Try sending with files — the Telegram adapter supports this if sendPhoto is available
    try {
        await message.reply(payload);
    } catch (err: unknown) {
        logger.warn('[TelegramCommand:screenshot] File sending failed:', err instanceof Error ? err.message : err);
        await message.reply({ text: 'Screenshot captured but file sending failed.' }).catch(logger.error);
    }
}
