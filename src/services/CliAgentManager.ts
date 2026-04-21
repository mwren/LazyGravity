import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

interface AgentState {
    child: pty.IPty;
    userId: string;
}

export class CliAgentManager extends EventEmitter {
    private agents = new Map<string, AgentState>();
    private buffers = new Map<string, string>();
    private debounceTimers = new Map<string, NodeJS.Timeout>();
    private readonly DEBOUNCE_MS = 1000;

    constructor() {
        super();
    }

    public spawnAgent(channelId: string, userId: string, agentCommand: string, args: string[] = [], cwd?: string): boolean {
        if (this.agents.has(channelId)) {
            logger.warn(`[CliAgentManager] Agent already running for channel ${channelId}`);
            return false;
        }

        logger.info(`[CliAgentManager] Spawning agent ${agentCommand} for channel ${channelId}${cwd ? ` (cwd: ${cwd})` : ''}`);
        
        try {
            const child = pty.spawn(agentCommand, args, {
                name: 'xterm-color',
                cols: 1000,
                rows: 30,
                cwd: cwd || process.cwd(),
                env: process.env as Record<string, string>
            });

            this.agents.set(channelId, { child, userId });
            this.buffers.set(channelId, '');

            child.onData((data: string) => {
                this.handleOutput(channelId, data);
            });

            child.onExit(({ exitCode, signal }) => {
                logger.info(`[CliAgentManager] Agent for channel ${channelId} exited with code ${exitCode}`);
                this.cleanup(channelId);
                this.emit('agentExited', channelId, exitCode);
            });

            return true;
        } catch (err) {
            logger.error(`[CliAgentManager] Exception spawning agent:`, err);
            return false;
        }
    }

    private handleOutput(channelId: string, dataStr: string) {
        // Log raw data to filesystem for debugging
        try {
            const logDir = path.join(process.cwd(), 'logs');
            if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
            fs.appendFileSync(path.join(logDir, `agent-${channelId}-raw.log`), `\n--- CHUNK ---\n${JSON.stringify(dataStr)}\n`);
        } catch (e) {
            // ignore
        }

        // Robust regex to strip ALL terminal ANSI codes, control characters, cursor movements, etc.
        // eslint-disable-next-line no-control-regex
        const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
        // Regex to strip OSC (Operating System Command) sequences (like terminal titles and hyperlinks)
        // eslint-disable-next-line no-control-regex
        const oscRegex = /\x1B\][^\x07\x1B]*[\x07\x1B]\\?/g;
        
        let stripped = dataStr.replace(ansiRegex, '');
        stripped = stripped.replace(oscRegex, '');
        
        const currentBuffer = this.buffers.get(channelId) || '';
        this.buffers.set(channelId, currentBuffer + stripped);

        // Clear existing debounce timer
        if (this.debounceTimers.has(channelId)) {
            clearTimeout(this.debounceTimers.get(channelId)!);
        }

        // Set a new timer to flush the output to Discord when the CLI goes quiet
        const timer = setTimeout(() => {
            this.flushOutput(channelId);
        }, this.DEBOUNCE_MS);

        this.debounceTimers.set(channelId, timer);
    }

    private flushOutput(channelId: string) {
        let text = this.buffers.get(channelId) || '';
        
        // Resolve terminal backspaces
        let previousText = '';
        while (text.includes('\b') && text !== previousText) {
            previousText = text;
            text = text.replace(/[^\b]\b/g, '');
        }
        text = text.replace(/\b/g, '');

        // Strip terminal carriage returns to prevent markdown breaks without destroying text
        text = text.replace(/\r/g, '');
        
        // Clean up common CLI artifacts before sending to Discord
        text = text.replace(/─{10,}/g, '──────────'); // Shorten massive horizontal rules
        text = text.trim();

        // Strip remaining non-printable control characters that break discord (except newlines/tabs)
        // eslint-disable-next-line no-control-regex
        text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

        const agent = this.agents.get(channelId);
        if (text && agent) {
            this.emit('agentMessage', channelId, agent.userId, text);
            this.buffers.set(channelId, '');
        }
    }

    public sendInput(channelId: string, text: string): boolean {
        const agent = this.agents.get(channelId);
        if (!agent) {
            return false;
        }

        try {
            logger.debug(`[CliAgentManager] Sending input to agent in channel ${channelId}`);
            agent.child.write(text + '\r');
            return true;
        } catch (err) {
            logger.error(`[CliAgentManager] Error writing to agent stdin:`, err);
            return false;
        }
    }

    public killAgent(channelId: string): boolean {
        const agent = this.agents.get(channelId);
        if (agent) {
            logger.info(`[CliAgentManager] Killing agent for channel ${channelId}`);
            agent.child.kill();
            this.cleanup(channelId);
            return true;
        }
        return false;
    }

    public hasAgent(channelId: string): boolean {
        return this.agents.has(channelId);
    }

    private cleanup(channelId: string) {
        this.agents.delete(channelId);
        this.buffers.delete(channelId);
        if (this.debounceTimers.has(channelId)) {
            clearTimeout(this.debounceTimers.get(channelId)!);
            this.debounceTimers.delete(channelId);
        }
    }
}

// Export as a singleton
export const cliAgentManager = new CliAgentManager();
