import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';

import { OutputFormat } from '../database/userPreferenceRepository';
import type { MessagePayload } from '../platform/types';
import {
    createRichContent,
    withTitle,
    withDescription,
    withColor,
    withFooter,
    withTimestamp,
} from '../platform/richContentBuilder';

export const OUTPUT_BTN_EMBED = 'output_btn_embed';
export const OUTPUT_BTN_PLAIN = 'output_btn_plain';
export const OUTPUT_BTN_AUDIO = 'output_btn_audio';
export const OUTPUT_SELECT_VOICE = 'output_select_voice';

export const TOP_KOKORO_VOICES = [
    { label: 'Bella (US Female)', value: 'af_bella', description: 'Smooth, high-quality American female voice', emoji: '🇺🇸' },
    { label: 'Sky (US Female)', value: 'af_sky', description: 'Clear and professional American female voice', emoji: '🇺🇸' },
    { label: 'Adam (US Male)', value: 'am_adam', description: 'Deep, resonant American male voice', emoji: '🇺🇸' },
    { label: 'Puck (US Male)', value: 'am_puck', description: 'Energetic and dynamic American male voice', emoji: '🇺🇸' },
    { label: 'Emma (UK Female)', value: 'bf_emma', description: 'Refined British female voice', emoji: '🇬🇧' },
    { label: 'George (UK Male)', value: 'bm_george', description: 'Aristocratic British male voice', emoji: '🇬🇧' },
    { label: 'Dora (Spanish Female)', value: 'ef_dora', description: 'Authentic Spanish localized female voice', emoji: '🇪🇸' },
    { label: 'Alex (Spanish Male)', value: 'em_alex', description: 'Authentic Spanish localized male voice', emoji: '🇪🇸' }
];

/**
 * Build a platform-agnostic MessagePayload for output format UI.
 */
export function buildOutputPayload(currentFormat: OutputFormat): MessagePayload {
    const isEmbed = currentFormat === 'embed';

    const rc = withTimestamp(
        withFooter(
            withDescription(
                withColor(
                    withTitle(createRichContent(), 'Output Format'),
                    isEmbed ? 0x5865F2 : currentFormat === 'plain' ? 0x2ECC71 : 0xE67E22,
                ),
                `**Current Format:** ${isEmbed ? 'Embed' : currentFormat === 'plain' ? 'Plain Text' : 'Audio (TTS)'}\n\n` +
                'Embed: Rich formatting with colored borders (default).\n' +
                'Plain Text: Simple text output, easy to copy on mobile.\n' +
                'Audio: Responses will be narrated into a downloadable voice message!',
            ),
            'Use buttons below to change format',
        ),
    );

    return {
        richContent: rc,
        components: [
            {
                components: [
                    {
                        type: 'button' as const,
                        customId: OUTPUT_BTN_EMBED,
                        label: 'Embed',
                        style: isEmbed ? 'primary' as const : 'secondary' as const,
                    },
                    {
                        type: 'button' as const,
                        customId: OUTPUT_BTN_PLAIN,
                        label: 'Plain Text',
                        style: currentFormat === 'plain' ? 'success' as const : 'secondary' as const,
                    },
                    {
                        type: 'button' as const,
                        customId: OUTPUT_BTN_AUDIO,
                        label: 'Audio (TTS)',
                        style: currentFormat === 'audio' ? 'success' as const : 'secondary' as const,
                    },
                ],
            },
        ],
    };
}

export async function sendOutputUI(
    target: { editReply: (opts: any) => Promise<any> },
    currentFormat: OutputFormat,
    currentVoice: string = 'af_bella'
): Promise<void> {
    const isEmbed = currentFormat === 'embed';

    const embed = new EmbedBuilder()
        .setTitle('Output Format')
        .setColor(isEmbed ? 0x5865F2 : currentFormat === 'plain' ? 0x2ECC71 : 0xE67E22)
        .setDescription(
            `**Current Format:** ${isEmbed ? '📋 Embed' : currentFormat === 'plain' ? '📝 Plain Text' : '🔊 Audio (TTS)'}\n\n` +
            'Embed: Rich formatting with colored borders (default).\n' +
            'Plain Text: Simple text output, easy to copy on mobile.\n' +
            'Audio: Responses will be narrated into a downloadable voice message!',
        )
        .setFooter({ text: 'Use buttons to change format or dropdown to preview voices!' })
        .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(OUTPUT_BTN_EMBED)
            .setLabel('Embed')
            .setStyle(isEmbed ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(OUTPUT_BTN_PLAIN)
            .setLabel('Plain Text')
            .setStyle(currentFormat === 'plain' ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(OUTPUT_BTN_AUDIO)
            .setLabel('Audio (TTS)')
            .setStyle(currentFormat === 'audio' ? ButtonStyle.Success : ButtonStyle.Secondary),
    );

    const voiceSelectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(OUTPUT_SELECT_VOICE)
            .setPlaceholder('🎙️ Sample & Select Voice Actor...')
            .addOptions(
                TOP_KOKORO_VOICES.map(voice => ({
                    label: voice.label,
                    description: voice.description,
                    value: voice.value,
                    default: voice.value === currentVoice,
                    emoji: voice.emoji
                }))
            )
    );

    await target.editReply({
        content: '',
        embeds: [embed],
        components: [row, voiceSelectRow],
    });
}
