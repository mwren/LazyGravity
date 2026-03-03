import { createModeSelectAction } from '../../src/handlers/modeSelectAction';

jest.mock('../../src/utils/logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../src/services/cdpBridgeManager', () => ({
    getCurrentCdp: jest.fn(),
}));

jest.mock('../../src/ui/modeUi', () => ({
    buildModePayload: jest.fn().mockReturnValue({ richContent: { title: 'Mode' }, components: [] }),
}));

import { getCurrentCdp } from '../../src/services/cdpBridgeManager';
import { buildModePayload } from '../../src/ui/modeUi';

function createMockInteraction() {
    return {
        id: 'int-1',
        platform: 'telegram' as const,
        customId: 'mode_select',
        user: { id: 'user-1', platform: 'telegram' as const, username: 'test', isBot: false },
        channel: { id: 'ch-1', platform: 'telegram' as const, send: jest.fn() },
        values: ['plan'],
        messageId: 'msg-1',
        deferUpdate: jest.fn().mockResolvedValue(undefined),
        reply: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
        editReply: jest.fn().mockResolvedValue(undefined),
        followUp: jest.fn().mockResolvedValue({ id: '2', platform: 'telegram', channelId: 'ch-1', edit: jest.fn(), delete: jest.fn() }),
    };
}

describe('createModeSelectAction', () => {
    const modeService = {
        getCurrentMode: jest.fn().mockReturnValue('fast'),
        setMode: jest.fn().mockReturnValue({ success: true, mode: 'plan' }),
    } as any;

    const bridge = {
        lastActiveWorkspace: null,
        pool: { getConnected: jest.fn().mockReturnValue(null) },
    } as any;

    it('matches mode_select customId', () => {
        const action = createModeSelectAction({ bridge, modeService });
        expect(action.match('mode_select')).toBe(true);
    });

    it('does not match other customIds', () => {
        const action = createModeSelectAction({ bridge, modeService });
        expect(action.match('other_select')).toBe(false);
    });

    it('sets mode via modeService and updates UI', async () => {
        (getCurrentCdp as jest.Mock).mockReturnValue(null);
        const action = createModeSelectAction({ bridge, modeService });
        const interaction = createMockInteraction();

        await action.execute(interaction as any, ['plan']);

        expect(interaction.deferUpdate).toHaveBeenCalled();
        expect(modeService.setMode).toHaveBeenCalledWith('plan');
        expect(buildModePayload).toHaveBeenCalled();
        expect(interaction.update).toHaveBeenCalled();
        expect(interaction.followUp).toHaveBeenCalled();
    });

    it('syncs mode to CDP when available', async () => {
        const mockCdp = { setUiMode: jest.fn().mockResolvedValue({ ok: true }) };
        (getCurrentCdp as jest.Mock).mockReturnValue(mockCdp);
        const action = createModeSelectAction({ bridge, modeService });
        const interaction = createMockInteraction();

        await action.execute(interaction as any, ['plan']);

        expect(mockCdp.setUiMode).toHaveBeenCalledWith('plan');
    });
});
