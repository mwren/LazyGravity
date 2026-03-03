import { parseTelegramCommand, handleTelegramCommand } from '../../src/bot/telegramCommands';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('../../src/utils/logger', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    },
}));

jest.mock('../../src/services/cdpBridgeManager', () => ({
    getCurrentCdp: jest.fn(),
}));

jest.mock('../../src/services/responseMonitor', () => ({
    RESPONSE_SELECTORS: {
        CLICK_STOP_BUTTON: 'mock_stop_script',
    },
}));

jest.mock('../../src/ui/modeUi', () => ({
    buildModePayload: jest.fn().mockReturnValue({ richContent: { title: 'Mode' }, components: [] }),
}));

jest.mock('../../src/ui/modelsUi', () => ({
    buildModelsPayload: jest.fn().mockReturnValue({ richContent: { title: 'Models' }, components: [] }),
}));

jest.mock('../../src/ui/autoAcceptUi', () => ({
    buildAutoAcceptPayload: jest.fn().mockReturnValue({ richContent: { title: 'AutoAccept' }, components: [] }),
    AUTOACCEPT_BTN_ON: 'autoaccept_btn_on',
    AUTOACCEPT_BTN_OFF: 'autoaccept_btn_off',
    AUTOACCEPT_BTN_REFRESH: 'autoaccept_btn_refresh',
}));

jest.mock('../../src/ui/templateUi', () => ({
    buildTemplatePayload: jest.fn().mockReturnValue({ richContent: { title: 'Templates' }, components: [] }),
    TEMPLATE_BTN_PREFIX: 'template_btn_',
    parseTemplateButtonId: jest.fn(),
}));

jest.mock('../../src/ui/screenshotUi', () => ({
    buildScreenshotPayload: jest.fn().mockResolvedValue({ text: 'Not connected to Antigravity.' }),
}));

jest.mock('../../src/utils/logBuffer', () => ({
    logBuffer: {
        getRecent: jest.fn().mockReturnValue([]),
    },
}));

import { getCurrentCdp } from '../../src/services/cdpBridgeManager';
import { buildModePayload } from '../../src/ui/modeUi';
import { buildModelsPayload } from '../../src/ui/modelsUi';
import { buildAutoAcceptPayload } from '../../src/ui/autoAcceptUi';
import { buildTemplatePayload } from '../../src/ui/templateUi';
import { buildScreenshotPayload } from '../../src/ui/screenshotUi';
import { logBuffer } from '../../src/utils/logBuffer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockMessage(content = '') {
    return {
        id: 'msg-1',
        platform: 'telegram' as const,
        content,
        author: { id: 'user-1', platform: 'telegram' as const, username: 'test', isBot: false },
        channel: { id: 'chat-123', platform: 'telegram' as const, send: jest.fn() },
        attachments: [],
        createdAt: new Date(),
        react: jest.fn().mockResolvedValue(undefined),
        reply: jest.fn().mockResolvedValue({
            id: '2',
            platform: 'telegram' as const,
            channelId: 'chat-123',
            edit: jest.fn(),
            delete: jest.fn(),
        }),
    };
}

function createMockBridge(overrides: Record<string, unknown> = {}) {
    return {
        pool: {
            getActiveWorkspaceNames: jest.fn().mockReturnValue([]),
            getConnected: jest.fn().mockReturnValue(null),
        },
        lastActiveWorkspace: null,
        lastActiveChannel: null,
        approvalChannelByWorkspace: new Map(),
        approvalChannelBySession: new Map(),
        autoAccept: {
            isEnabled: jest.fn().mockReturnValue(false),
            handle: jest.fn().mockReturnValue({
                success: true,
                enabled: true,
                changed: true,
                message: 'Auto-accept mode turned ON.',
            }),
        },
        ...overrides,
    } as any;
}

function createMockModeService(mode = 'fast') {
    return { getCurrentMode: jest.fn().mockReturnValue(mode) } as any;
}

// ---------------------------------------------------------------------------
// parseTelegramCommand
// ---------------------------------------------------------------------------

describe('parseTelegramCommand', () => {
    it.each([
        ['/help', 'help', ''],
        ['/status', 'status', ''],
        ['/stop', 'stop', ''],
        ['/ping', 'ping', ''],
        ['/start', 'start', ''],
        ['/mode', 'mode', ''],
        ['/model', 'model', ''],
        ['/screenshot', 'screenshot', ''],
        ['/autoaccept', 'autoaccept', ''],
        ['/template', 'template', ''],
        ['/logs', 'logs', ''],
    ])('parses %s as command=%s args=%s', (input, command, args) => {
        expect(parseTelegramCommand(input)).toEqual({ command, args });
    });

    it('parses command with @BotName suffix', () => {
        expect(parseTelegramCommand('/help@MyBot')).toEqual({ command: 'help', args: '' });
    });

    it('parses command with arguments', () => {
        expect(parseTelegramCommand('/stop now please')).toEqual({ command: 'stop', args: 'now please' });
    });

    it('parses command with @BotName and arguments', () => {
        expect(parseTelegramCommand('/status@LazyBot some arg')).toEqual({ command: 'status', args: 'some arg' });
    });

    it('is case-insensitive', () => {
        expect(parseTelegramCommand('/HELP')).toEqual({ command: 'help', args: '' });
        expect(parseTelegramCommand('/Status')).toEqual({ command: 'status', args: '' });
    });

    it('returns null for unknown commands', () => {
        expect(parseTelegramCommand('/unknown')).toBeNull();
        expect(parseTelegramCommand('/foo')).toBeNull();
        expect(parseTelegramCommand('/bar')).toBeNull();
    });

    it('returns null for /project (handled separately)', () => {
        expect(parseTelegramCommand('/project')).toBeNull();
    });

    it('returns null for non-command text', () => {
        expect(parseTelegramCommand('hello')).toBeNull();
        expect(parseTelegramCommand('just a message')).toBeNull();
        expect(parseTelegramCommand('')).toBeNull();
    });

    it('returns null for text starting with / but no word characters', () => {
        expect(parseTelegramCommand('/ ')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// handleTelegramCommand — /start
// ---------------------------------------------------------------------------

describe('handleTelegramCommand — /start', () => {
    it('sends a welcome message', async () => {
        const message = createMockMessage();
        const bridge = createMockBridge();

        await handleTelegramCommand({ bridge }, message as any, { command: 'start', args: '' });

        expect(message.reply).toHaveBeenCalledTimes(1);
        const text = message.reply.mock.calls[0][0].text;
        expect(text).toContain('Welcome to LazyGravity');
        expect(text).toContain('/project');
    });
});

// ---------------------------------------------------------------------------
// handleTelegramCommand — /help
// ---------------------------------------------------------------------------

describe('handleTelegramCommand — /help', () => {
    it('sends a list of available commands', async () => {
        const message = createMockMessage();
        const bridge = createMockBridge();

        await handleTelegramCommand({ bridge }, message as any, { command: 'help', args: '' });

        expect(message.reply).toHaveBeenCalledTimes(1);
        const text = message.reply.mock.calls[0][0].text;
        expect(text).toContain('Available Commands');
        expect(text).toContain('/project');
        expect(text).toContain('/status');
        expect(text).toContain('/mode');
        expect(text).toContain('/model');
        expect(text).toContain('/screenshot');
        expect(text).toContain('/autoaccept');
        expect(text).toContain('/template');
        expect(text).toContain('/logs');
        expect(text).toContain('/stop');
        expect(text).toContain('/ping');
        expect(text).toContain('/help');
    });
});

// ---------------------------------------------------------------------------
// handleTelegramCommand — /status
// ---------------------------------------------------------------------------

describe('handleTelegramCommand — /status', () => {
    it('shows "Not connected" when no active workspaces', async () => {
        const message = createMockMessage();
        const bridge = createMockBridge();
        const modeService = createMockModeService('fast');

        await handleTelegramCommand({ bridge, modeService }, message as any, { command: 'status', args: '' });

        expect(message.reply).toHaveBeenCalledTimes(1);
        const text = message.reply.mock.calls[0][0].text;
        expect(text).toContain('Not connected');
        expect(text).toContain('fast');
        expect(text).toContain('Active connections: none');
    });

    it('shows connected workspace names', async () => {
        const bridge = createMockBridge();
        bridge.pool.getActiveWorkspaceNames.mockReturnValue(['DemoLG', 'TestProject']);
        const message = createMockMessage();
        const modeService = createMockModeService('plan');

        await handleTelegramCommand({ bridge, modeService }, message as any, { command: 'status', args: '' });

        const text = message.reply.mock.calls[0][0].text;
        expect(text).toContain('DemoLG, TestProject');
        expect(text).toContain('plan');
    });

    it('shows "unknown" mode when modeService is not provided', async () => {
        const message = createMockMessage();
        const bridge = createMockBridge();

        await handleTelegramCommand({ bridge }, message as any, { command: 'status', args: '' });

        const text = message.reply.mock.calls[0][0].text;
        expect(text).toContain('unknown');
    });

    it('shows bound project for current chat', async () => {
        const message = createMockMessage();
        const bridge = createMockBridge();
        const telegramBindingRepo = {
            findByChatId: jest.fn().mockReturnValue({ chatId: 'chat-123', workspacePath: 'MyProject' }),
        } as any;

        await handleTelegramCommand({ bridge, telegramBindingRepo }, message as any, { command: 'status', args: '' });

        const text = message.reply.mock.calls[0][0].text;
        expect(text).toContain('MyProject');
    });

    it('shows "(none)" when no project is bound', async () => {
        const message = createMockMessage();
        const bridge = createMockBridge();
        const telegramBindingRepo = {
            findByChatId: jest.fn().mockReturnValue(undefined),
        } as any;

        await handleTelegramCommand({ bridge, telegramBindingRepo }, message as any, { command: 'status', args: '' });

        const text = message.reply.mock.calls[0][0].text;
        expect(text).toContain('(none)');
    });
});

// ---------------------------------------------------------------------------
// handleTelegramCommand — /stop
// ---------------------------------------------------------------------------

describe('handleTelegramCommand — /stop', () => {
    it('replies "No active workspace connection" when no CDP', async () => {
        (getCurrentCdp as jest.Mock).mockReturnValue(null);
        const message = createMockMessage();
        const bridge = createMockBridge();

        await handleTelegramCommand({ bridge }, message as any, { command: 'stop', args: '' });

        expect(message.reply).toHaveBeenCalledWith({ text: 'No active workspace connection.' });
    });

    it('clicks stop button and confirms', async () => {
        const mockCdp = {
            call: jest.fn().mockResolvedValue({ result: { value: { clicked: true } } }),
        };
        (getCurrentCdp as jest.Mock).mockReturnValue(mockCdp);
        const message = createMockMessage();
        const bridge = createMockBridge();

        await handleTelegramCommand({ bridge }, message as any, { command: 'stop', args: '' });

        expect(mockCdp.call).toHaveBeenCalledWith('Runtime.evaluate', {
            expression: 'mock_stop_script',
            returnByValue: true,
        });
        expect(message.reply).toHaveBeenCalledWith({ text: 'Stop button clicked.' });
    });

    it('reports when stop button is not found', async () => {
        const mockCdp = {
            call: jest.fn().mockResolvedValue({ result: { value: { clicked: false } } }),
        };
        (getCurrentCdp as jest.Mock).mockReturnValue(mockCdp);
        const message = createMockMessage();
        const bridge = createMockBridge();

        await handleTelegramCommand({ bridge }, message as any, { command: 'stop', args: '' });

        expect(message.reply).toHaveBeenCalledWith({
            text: 'Stop button not found (generation may have already finished).',
        });
    });

    it('handles CDP call errors gracefully', async () => {
        const mockCdp = {
            call: jest.fn().mockRejectedValue(new Error('CDP timeout')),
        };
        (getCurrentCdp as jest.Mock).mockReturnValue(mockCdp);
        const message = createMockMessage();
        const bridge = createMockBridge();

        await handleTelegramCommand({ bridge }, message as any, { command: 'stop', args: '' });

        expect(message.reply).toHaveBeenCalledWith({ text: 'Failed to click stop button.' });
    });
});

// ---------------------------------------------------------------------------
// handleTelegramCommand — /ping
// ---------------------------------------------------------------------------

describe('handleTelegramCommand — /ping', () => {
    it('replies with Pong!', async () => {
        const message = createMockMessage();
        const bridge = createMockBridge();

        await handleTelegramCommand({ bridge }, message as any, { command: 'ping', args: '' });

        expect(message.reply).toHaveBeenCalledWith({ text: 'Pong!' });
    });
});

// ---------------------------------------------------------------------------
// handleTelegramCommand — /mode
// ---------------------------------------------------------------------------

describe('handleTelegramCommand — /mode', () => {
    it('returns error when modeService is not available', async () => {
        const message = createMockMessage();
        const bridge = createMockBridge();

        await handleTelegramCommand({ bridge }, message as any, { command: 'mode', args: '' });

        expect(message.reply).toHaveBeenCalledWith({ text: 'Mode service not available.' });
    });

    it('sends mode payload when modeService is available', async () => {
        (getCurrentCdp as jest.Mock).mockReturnValue(null);
        const message = createMockMessage();
        const bridge = createMockBridge();
        const modeService = createMockModeService('fast');

        await handleTelegramCommand({ bridge, modeService }, message as any, { command: 'mode', args: '' });

        expect(buildModePayload).toHaveBeenCalledWith('fast');
        expect(message.reply).toHaveBeenCalledTimes(1);
    });

    it('syncs with live CDP mode before building payload', async () => {
        const mockCdp = { getCurrentMode: jest.fn().mockResolvedValue('plan') };
        (getCurrentCdp as jest.Mock).mockReturnValue(mockCdp);
        const message = createMockMessage();
        const bridge = createMockBridge();
        const modeService = createMockModeService('fast');
        modeService.setMode = jest.fn();

        await handleTelegramCommand({ bridge, modeService }, message as any, { command: 'mode', args: '' });

        expect(modeService.setMode).toHaveBeenCalledWith('plan');
    });
});

// ---------------------------------------------------------------------------
// handleTelegramCommand — /model
// ---------------------------------------------------------------------------

describe('handleTelegramCommand — /model', () => {
    it('returns error when CDP is not connected', async () => {
        (getCurrentCdp as jest.Mock).mockReturnValue(null);
        const message = createMockMessage();
        const bridge = createMockBridge();

        await handleTelegramCommand({ bridge }, message as any, { command: 'model', args: '' });

        expect(message.reply).toHaveBeenCalledWith({ text: 'Not connected to Antigravity.' });
    });

    it('sends model payload when CDP is available', async () => {
        const mockCdp = {
            getUiModels: jest.fn().mockResolvedValue(['model-a', 'model-b']),
            getCurrentModel: jest.fn().mockResolvedValue('model-a'),
        };
        (getCurrentCdp as jest.Mock).mockReturnValue(mockCdp);
        const message = createMockMessage();
        const bridge = createMockBridge();
        const fetchQuota = jest.fn().mockResolvedValue([]);

        await handleTelegramCommand({ bridge, fetchQuota }, message as any, { command: 'model', args: '' });

        expect(buildModelsPayload).toHaveBeenCalledWith(['model-a', 'model-b'], 'model-a', []);
        expect(message.reply).toHaveBeenCalledTimes(1);
    });

    it('shows error when no models are available', async () => {
        const mockCdp = {
            getUiModels: jest.fn().mockResolvedValue([]),
            getCurrentModel: jest.fn().mockResolvedValue(null),
        };
        (getCurrentCdp as jest.Mock).mockReturnValue(mockCdp);
        (buildModelsPayload as jest.Mock).mockReturnValueOnce(null);
        const message = createMockMessage();
        const bridge = createMockBridge();

        await handleTelegramCommand({ bridge }, message as any, { command: 'model', args: '' });

        expect(message.reply).toHaveBeenCalledWith({ text: 'No models available.' });
    });
});

// ---------------------------------------------------------------------------
// handleTelegramCommand — /screenshot
// ---------------------------------------------------------------------------

describe('handleTelegramCommand — /screenshot', () => {
    it('sends screenshot error when CDP is not available', async () => {
        (getCurrentCdp as jest.Mock).mockReturnValue(null);
        (buildScreenshotPayload as jest.Mock).mockResolvedValue({ text: 'Not connected to Antigravity.' });
        const message = createMockMessage();
        const bridge = createMockBridge();

        await handleTelegramCommand({ bridge }, message as any, { command: 'screenshot', args: '' });

        expect(message.reply).toHaveBeenCalledTimes(1);
        const payload = message.reply.mock.calls[0][0];
        expect(payload.text).toContain('Not connected');
    });

    it('sends file payload when screenshot succeeds', async () => {
        const buf = Buffer.from('PNG_DATA');
        (getCurrentCdp as jest.Mock).mockReturnValue({});
        (buildScreenshotPayload as jest.Mock).mockResolvedValue({
            files: [{ name: 'screenshot.png', data: buf, contentType: 'image/png' }],
        });
        const message = createMockMessage();
        const bridge = createMockBridge();

        await handleTelegramCommand({ bridge }, message as any, { command: 'screenshot', args: '' });

        expect(message.reply).toHaveBeenCalledTimes(1);
        const payload = message.reply.mock.calls[0][0];
        expect(payload.files).toBeDefined();
        expect(payload.files[0].name).toBe('screenshot.png');
    });
});

// ---------------------------------------------------------------------------
// handleTelegramCommand — /autoaccept
// ---------------------------------------------------------------------------

describe('handleTelegramCommand — /autoaccept', () => {
    it('sends interactive UI when no args are provided', async () => {
        const message = createMockMessage();
        const bridge = createMockBridge();

        await handleTelegramCommand({ bridge }, message as any, { command: 'autoaccept', args: '' });

        expect(buildAutoAcceptPayload).toHaveBeenCalledWith(false);
        expect(message.reply).toHaveBeenCalledTimes(1);
    });

    it('handles direct "on" argument', async () => {
        const message = createMockMessage();
        const bridge = createMockBridge();

        await handleTelegramCommand({ bridge }, message as any, { command: 'autoaccept', args: 'on' });

        expect(bridge.autoAccept.handle).toHaveBeenCalledWith('on');
        expect(message.reply).toHaveBeenCalledTimes(1);
        const payload = message.reply.mock.calls[0][0];
        expect(payload.text).toContain('Auto-accept mode turned ON');
    });

    it('handles direct "off" argument', async () => {
        const bridge = createMockBridge();
        bridge.autoAccept.handle.mockReturnValue({
            success: true,
            enabled: false,
            changed: true,
            message: 'Auto-accept mode turned OFF.',
        });
        const message = createMockMessage();

        await handleTelegramCommand({ bridge }, message as any, { command: 'autoaccept', args: 'off' });

        expect(bridge.autoAccept.handle).toHaveBeenCalledWith('off');
        expect(message.reply.mock.calls[0][0].text).toContain('OFF');
    });
});

// ---------------------------------------------------------------------------
// handleTelegramCommand — /template
// ---------------------------------------------------------------------------

describe('handleTelegramCommand — /template', () => {
    it('returns error when templateRepo is not available', async () => {
        const message = createMockMessage();
        const bridge = createMockBridge();

        await handleTelegramCommand({ bridge }, message as any, { command: 'template', args: '' });

        expect(message.reply).toHaveBeenCalledWith({ text: 'Template service not available.' });
    });

    it('sends template list payload', async () => {
        const message = createMockMessage();
        const bridge = createMockBridge();
        const templateRepo = { findAll: jest.fn().mockReturnValue([]) } as any;

        await handleTelegramCommand({ bridge, templateRepo }, message as any, { command: 'template', args: '' });

        expect(buildTemplatePayload).toHaveBeenCalledWith([]);
        expect(message.reply).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// handleTelegramCommand — /logs
// ---------------------------------------------------------------------------

describe('handleTelegramCommand — /logs', () => {
    it('shows "No log entries" when buffer is empty', async () => {
        (logBuffer.getRecent as jest.Mock).mockReturnValue([]);
        const message = createMockMessage();
        const bridge = createMockBridge();

        await handleTelegramCommand({ bridge }, message as any, { command: 'logs', args: '' });

        expect(message.reply).toHaveBeenCalledWith({ text: 'No log entries.' });
    });

    it('shows recent log entries', async () => {
        (logBuffer.getRecent as jest.Mock).mockReturnValue([
            { timestamp: '2025-01-15T10:30:45.000Z', level: 'info', message: 'Test log entry' },
            { timestamp: '2025-01-15T10:30:46.000Z', level: 'warn', message: 'Warning entry' },
        ]);
        const message = createMockMessage();
        const bridge = createMockBridge();

        await handleTelegramCommand({ bridge }, message as any, { command: 'logs', args: '' });

        expect(logBuffer.getRecent).toHaveBeenCalledWith(20);
        const text = message.reply.mock.calls[0][0].text;
        expect(text).toContain('Recent Logs (2)');
        expect(text).toContain('Test log entry');
        expect(text).toContain('Warning entry');
    });

    it('accepts count argument', async () => {
        (logBuffer.getRecent as jest.Mock).mockReturnValue([]);
        const message = createMockMessage();
        const bridge = createMockBridge();

        await handleTelegramCommand({ bridge }, message as any, { command: 'logs', args: '5' });

        expect(logBuffer.getRecent).toHaveBeenCalledWith(5);
    });

    it('caps count at 50', async () => {
        (logBuffer.getRecent as jest.Mock).mockReturnValue([]);
        const message = createMockMessage();
        const bridge = createMockBridge();

        await handleTelegramCommand({ bridge }, message as any, { command: 'logs', args: '100' });

        expect(logBuffer.getRecent).toHaveBeenCalledWith(50);
    });

    it('escapes HTML in log messages', async () => {
        (logBuffer.getRecent as jest.Mock).mockReturnValue([
            { timestamp: '2025-01-15T10:30:45.000Z', level: 'error', message: '<script>alert("xss")</script>' },
        ]);
        const message = createMockMessage();
        const bridge = createMockBridge();

        await handleTelegramCommand({ bridge }, message as any, { command: 'logs', args: '' });

        const text = message.reply.mock.calls[0][0].text;
        expect(text).toContain('&lt;script&gt;');
        expect(text).not.toContain('<script>');
    });

    it('parses /logs with @BotName suffix', () => {
        expect(parseTelegramCommand('/logs@MyBot 10')).toEqual({ command: 'logs', args: '10' });
    });
});
