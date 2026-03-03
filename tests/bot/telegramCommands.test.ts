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

import { getCurrentCdp } from '../../src/services/cdpBridgeManager';

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
        autoAccept: { isEnabled: () => false },
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
        expect(parseTelegramCommand('/mode')).toBeNull();
        expect(parseTelegramCommand('/model')).toBeNull();
        expect(parseTelegramCommand('/screenshot')).toBeNull();
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
        expect(text).toContain('Active workspaces: 0');
    });

    it('shows connected workspace names', async () => {
        const bridge = createMockBridge();
        bridge.pool.getActiveWorkspaceNames.mockReturnValue(['DemoLG', 'TestProject']);
        const message = createMockMessage();
        const modeService = createMockModeService('plan');

        await handleTelegramCommand({ bridge, modeService }, message as any, { command: 'status', args: '' });

        const text = message.reply.mock.calls[0][0].text;
        expect(text).toContain('Connected (DemoLG, TestProject)');
        expect(text).toContain('plan');
        expect(text).toContain('Active workspaces: 2');
    });

    it('shows "unknown" mode when modeService is not provided', async () => {
        const message = createMockMessage();
        const bridge = createMockBridge();

        await handleTelegramCommand({ bridge }, message as any, { command: 'status', args: '' });

        const text = message.reply.mock.calls[0][0].text;
        expect(text).toContain('unknown');
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
