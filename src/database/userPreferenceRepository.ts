import Database from 'better-sqlite3';

/**
 * Output format preference type
 */
export type OutputFormat = 'embed' | 'plain' | 'audio';

/**
 * User preference record type definition
 */
export interface UserPreferenceRecord {
    /** Unique ID (auto-increment) */
    id: number;
    /** Discord user ID (unique) */
    userId: string;
    /** Output format preference */
    outputFormat: OutputFormat;
    /** Preferred TTS voice actor */
    ttsVoice: string;
    /** Default model name (free-text, may become stale) */
    defaultModel: string | null;
    /** Creation timestamp (ISO string) */
    createdAt?: string;
    /** Last update timestamp (ISO string) */
    updatedAt?: string;
}

/**
 * Repository class for SQLite persistence of per-user preferences.
 * Currently stores output format preference (embed vs plain text).
 */
export class UserPreferenceRepository {
    private db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
        this.initialize();
    }

    /**
     * Initialize table (create if not exists) and run migrations
     */
    private initialize(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS user_preferences (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL UNIQUE,
                output_format TEXT NOT NULL DEFAULT 'embed',
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
        this.migrateDefaultModel();
        this.migrateTtsVoice();
    }

    /**
     * Safe migration: add default_model column if it does not exist.
     * Uses pragma when available, falls back to try/catch ALTER TABLE.
     */
    private migrateDefaultModel(): void {
        if (typeof this.db.pragma === 'function') {
            const columns = this.db.pragma('table_info(user_preferences)') as { name: string }[];
            const hasColumn = columns.some(c => c.name === 'default_model');
            if (!hasColumn) {
                this.db.exec('ALTER TABLE user_preferences ADD COLUMN default_model TEXT DEFAULT NULL');
            }
        } else {
            // Fallback for mock/alternate DB implementations without pragma
            try {
                this.db.exec('ALTER TABLE user_preferences ADD COLUMN default_model TEXT DEFAULT NULL');
            } catch {
                // Column already exists — safe to ignore
            }
        }
    }

    /**
     * Safe migration: add tts_voice column if it does not exist.
     */
    private migrateTtsVoice(): void {
        if (typeof this.db.pragma === 'function') {
            const columns = this.db.pragma('table_info(user_preferences)') as { name: string }[];
            const hasColumn = columns.some(c => c.name === 'tts_voice');
            if (!hasColumn) {
                this.db.exec("ALTER TABLE user_preferences ADD COLUMN tts_voice TEXT DEFAULT 'af_bella'");
            }
        } else {
            try {
                this.db.exec("ALTER TABLE user_preferences ADD COLUMN tts_voice TEXT DEFAULT 'af_bella'");
            } catch {
                // Column already exists
            }
        }
    }

    /**
     * Get the output format preference for a user.
     * Returns 'embed' as default if no preference is stored.
     */
    public getOutputFormat(userId: string): OutputFormat {
        const row = this.db.prepare(
            'SELECT output_format FROM user_preferences WHERE user_id = ?'
        ).get(userId) as { output_format: string } | undefined;

        if (!row) return 'embed';
        if (row.output_format === 'plain') return 'plain';
        if (row.output_format === 'audio') return 'audio';
        return 'embed';
    }

    /**
     * Set the output format preference for a user (upsert).
     */
    public setOutputFormat(userId: string, format: OutputFormat): void {
        this.db.prepare(`
            INSERT INTO user_preferences (user_id, output_format)
            VALUES (?, ?)
            ON CONFLICT(user_id)
            DO UPDATE SET output_format = excluded.output_format,
                          updated_at = datetime('now')
        `).run(userId, format);
    }

    /**
     * Get the preferred TTS voice for a user.
     * Returns 'af_bella' if not set.
     */
    public getVoice(userId: string): string {
        const row = this.db.prepare(
            'SELECT tts_voice FROM user_preferences WHERE user_id = ?'
        ).get(userId) as { tts_voice: string | null } | undefined;

        return row?.tts_voice ?? 'af_bella';
    }

    /**
     * Set the preferred TTS voice for a user.
     */
    public setVoice(userId: string, voiceId: string): void {
        this.db.prepare(`
            INSERT INTO user_preferences (user_id, tts_voice)
            VALUES (?, ?)
            ON CONFLICT(user_id)
            DO UPDATE SET tts_voice = excluded.tts_voice,
                          updated_at = datetime('now')
        `).run(userId, voiceId);
    }

    /**
     * Get the default model for a user.
     * Returns null if no default is stored.
     */
    public getDefaultModel(userId: string): string | null {
        const row = this.db.prepare(
            'SELECT default_model FROM user_preferences WHERE user_id = ?'
        ).get(userId) as { default_model: string | null } | undefined;

        return row?.default_model ?? null;
    }

    /**
     * Set the default model for a user (upsert).
     * Pass null to clear the default.
     */
    public setDefaultModel(userId: string, modelName: string | null): void {
        this.db.prepare(`
            INSERT INTO user_preferences (user_id, default_model)
            VALUES (?, ?)
            ON CONFLICT(user_id)
            DO UPDATE SET default_model = excluded.default_model,
                          updated_at = datetime('now')
        `).run(userId, modelName);
    }

    /**
     * Get full preference record for a user
     */
    public findByUserId(userId: string): UserPreferenceRecord | undefined {
        const row = this.db.prepare(
            'SELECT * FROM user_preferences WHERE user_id = ?'
        ).get(userId) as any;

        if (!row) return undefined;
        return this.mapRow(row);
    }

    /**
     * Map a DB row to UserPreferenceRecord
     */
    private mapRow(row: any): UserPreferenceRecord {
        return {
            id: row.id,
            userId: row.user_id,
            outputFormat: row.output_format as OutputFormat,
            ttsVoice: row.tts_voice ?? 'af_bella',
            defaultModel: row.default_model ?? null,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}
