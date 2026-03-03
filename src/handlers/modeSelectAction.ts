/**
 * Platform-agnostic SelectAction for mode_select interactions.
 *
 * When a user selects a mode from the inline dropdown, this action:
 *   1. Updates the ModeService
 *   2. Syncs the mode change to Antigravity via CDP
 *   3. Refreshes the mode selection UI
 */

import type { PlatformSelectInteraction } from '../platform/types';
import type { SelectAction } from './selectHandler';
import type { CdpBridge } from '../services/cdpBridgeManager';
import { getCurrentCdp } from '../services/cdpBridgeManager';
import type { ModeService } from '../services/modeService';
import { MODE_DISPLAY_NAMES } from '../services/modeService';
import { buildModePayload } from '../ui/modeUi';
import { logger } from '../utils/logger';

export interface ModeSelectActionDeps {
    readonly bridge: CdpBridge;
    readonly modeService: ModeService;
}

export function createModeSelectAction(deps: ModeSelectActionDeps): SelectAction {
    return {
        match(customId: string): boolean {
            return customId === 'mode_select';
        },

        async execute(
            interaction: PlatformSelectInteraction,
            values: readonly string[],
        ): Promise<void> {
            const selectedMode = values[0];
            if (!selectedMode) return;

            await interaction.deferUpdate();

            const result = deps.modeService.setMode(selectedMode);
            if (!result.success) {
                await interaction.followUp({ text: result.error ?? 'Invalid mode.' }).catch(() => {});
                return;
            }

            // Sync to Antigravity UI
            const cdp = getCurrentCdp(deps.bridge);
            if (cdp) {
                const res = await cdp.setUiMode(selectedMode);
                if (!res.ok) {
                    logger.warn(`[ModeSelect] UI mode switch failed: ${res.error}`);
                }
            }

            // Refresh the mode UI in the original message
            const payload = buildModePayload(deps.modeService.getCurrentMode());
            await interaction.update(payload);

            // Confirmation
            const displayName = MODE_DISPLAY_NAMES[selectedMode] || selectedMode;
            await interaction.followUp({ text: `Mode changed to ${displayName}.` }).catch(() => {});
        },
    };
}
