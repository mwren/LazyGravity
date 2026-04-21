import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

export class CliAgentManager extends EventEmitter {
    private agents = new Map<string, ChildProcess>();
    private buffers = new Map<string, string>();
    private debounceTimers = new Map<string, NodeJS.Timeout>();
    private readonly DEBOUNCE_MS = 1000;

    constructor() {
        super();
    }

    public spawnAgent(channelId: string, agentCommand: string, args: string[] = []): boolean {
        if (this.agents.has(channelId)) {
            logger.warn(`[CliAgentManager] Agent already running for channel ${channelId}`);
            return false;
        }

        logger.info(`[CliAgentManager] Spawning agent ${agentCommand} for channel ${channelId}`);
        
        try {
            const child = spawn(agentCommand, args, {
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: true
            });

            this.agents.set(channelId, child);
            this.buffers.set(channelId, '');

            child.stdout?.on('data', (data: Buffer) => {
                this.handleOutput(channelId, data.toString());
            });

            child.stderr?.on('data', (data: Buffer) => {
                logger.warn(`[CliAgentManager:${channelId}] STDERR: ${data.toString()}`);
                // Could choose to send stderr to Discord as well, but might be noisy.
            });

            child.on('close', (code) => {
                logger.info(`[CliAgentManager] Agent for channel ${channelId} exited with code ${code}`);
                this.cleanup(channelId);
                this.emit('agentExited', channelId, code);
            });

            child.on('error', (err) => {
                logger.error(`[CliAgentManager] Failed to start agent for channel ${channelId}:`, err);
                this.cleanup(channelId);
                this.emit('agentError', channelId, err);
            });

            return true;
        } catch (err) {
            logger.error(`[CliAgentManager] Exception spawning agent:`, err);
            return false;
        }
    }

    private handleOutput(channelId: string, dataStr: string) {
        // Strip ANSI codes if needed (basic regex)
        const stripped = dataStr.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
        
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
        const text = this.buffers.get(channelId)?.trim();
        if (text) {
            this.emit('agentMessage', channelId, text);
            this.buffers.set(channelId, '');
        }
    }

    public sendInput(channelId: string, text: string): boolean {
        const child = this.agents.get(channelId);
        if (!child || !child.stdin) {
            return false;
        }

        try {
            logger.debug(`[CliAgentManager] Sending input to agent in channel ${channelId}`);
            child.stdin.write(text + '\n');
            return true;
        } catch (err) {
            logger.error(`[CliAgentManager] Error writing to agent stdin:`, err);
            return false;
        }
    }

    public killAgent(channelId: string): boolean {
        const child = this.agents.get(channelId);
        if (child) {
            logger.info(`[CliAgentManager] Killing agent for channel ${channelId}`);
            child.kill('SIGKILL');
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
