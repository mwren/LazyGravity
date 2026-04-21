import Database from 'better-sqlite3';
import crypto from 'crypto';

export interface FileLinkRecord {
    id: string;
    workspacePath: string;
    filePath: string;
    createdAt?: string;
}

export class FileLinkRepository {
    private readonly db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
        this.initialize();
    }

    private initialize(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS file_links (
                id TEXT PRIMARY KEY,
                workspace_path TEXT NOT NULL,
                file_path TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
    }

    /**
     * Create a new file link and return its short ID.
     */
    public create(workspacePath: string, filePath: string): string {
        const id = crypto.randomBytes(8).toString('hex');
        const stmt = this.db.prepare(`
            INSERT INTO file_links (id, workspace_path, file_path)
            VALUES (?, ?, ?)
        `);
        stmt.run(id, workspacePath, filePath);
        return id;
    }

    public findById(id: string): FileLinkRecord | undefined {
        const row = this.db.prepare(
            'SELECT * FROM file_links WHERE id = ?'
        ).get(id) as any;
        if (!row) return undefined;
        return {
            id: row.id,
            workspacePath: row.workspace_path,
            filePath: row.file_path,
            createdAt: row.created_at,
        };
    }
}
