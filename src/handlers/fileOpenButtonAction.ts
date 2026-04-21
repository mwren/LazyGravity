import fs from 'fs';
import path from 'path';
import type { PlatformButtonInteraction } from '../platform/types';
import type { ButtonAction } from './buttonHandler';
import { parseFileOpenCustomId } from '../services/cdpBridgeManager';
import type { FileLinkRepository } from '../database/fileLinkRepository';
import { logger } from '../utils/logger';

export interface FileOpenButtonActionDeps {
    readonly fileLinkRepo: FileLinkRepository;
}

const MAX_FILE_CONTENT = 4096;

export function createFileOpenButtonAction(
    deps: FileOpenButtonActionDeps,
): ButtonAction {
    return {
        match(customId: string): Record<string, string> | null {
            const parsed = parseFileOpenCustomId(customId);
            if (!parsed) return null;
            return {
                id: parsed.id,
            };
        },

        async execute(
            interaction: PlatformButtonInteraction,
            params: Record<string, string>,
        ): Promise<void> {
            const { id } = params;

            await interaction.deferUpdate().catch(() => {});

            const fileLink = deps.fileLinkRepo.findById(id);
            if (!fileLink) {
                await interaction
                    .followUp({ text: 'File link expired or not found.', ephemeral: true })
                    .catch(() => {});
                return;
            }

            try {
                // Read the file locally
                const content = await fs.promises.readFile(fileLink.filePath, 'utf-8');
                
                let ext = path.extname(fileLink.filePath).toLowerCase();
                if (ext.startsWith('.')) ext = ext.substring(1);
                
                // Format appropriately:
                let formattedContent = '';
                if (ext === 'md') {
                    // Render markdown natively
                    formattedContent = content;
                } else {
                    // Wrap with code block
                    const lang = ext || 'txt';
                    // Escape triple backticks if the file contains them to prevent breaking block
                    const safeContent = content.replace(/\`\`\`/g, '\\`\\`\\`');
                    formattedContent = '```' + lang + '\n' + safeContent + '\n```';
                }

                // Truncate logic
                const truncated = formattedContent.length > MAX_FILE_CONTENT
                    ? formattedContent.substring(0, MAX_FILE_CONTENT - 15) + '\\n\\n(truncated)'
                    : formattedContent;
                
                // For proper wrapper logic, if it's truncated during a backtick block, it might leave backticks open.
                // Simple heuristic: if we are in a backtick block and truncated, add closing backticks.
                let finalContent = truncated;
                if (ext !== 'md' && formattedContent.length > MAX_FILE_CONTENT) {
                     finalContent += '\\n\`\`\`';
                }

                // Add header info
                const header = `📁 **${path.basename(fileLink.filePath)}** opened:\n\n`;

                await interaction
                    .followUp({ text: header + finalContent })
                    .catch((err) => {
                        logger.warn('[FileOpenAction] followUp failed:', err);
                    });

            } catch (error: any) {
                logger.error('[FileOpenAction] Error reading file:', error);
                await interaction
                    .followUp({ text: `Error reading file: ${error.message}`, ephemeral: true })
                    .catch(() => {});
            }
        },
    };
}
