import { pool } from './client';

export interface FileRecord {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  storage_url: string;
  storage_key: string;
  status: 'uploaded' | 'parsing' | 'ready' | 'failed';
  product_models: string[] | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function createFileRecord(params: {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storageUrl: string;
  storageKey: string;
}): Promise<FileRecord> {
  const result = await pool.query<FileRecord>(
    `INSERT INTO files (original_name, mime_type, size_bytes, storage_url, storage_key, status)
     VALUES ($1, $2, $3, $4, $5, 'uploaded')
     RETURNING *`,
    [
      params.originalName,
      params.mimeType,
      params.sizeBytes,
      params.storageUrl,
      params.storageKey,
    ]
  );
  return result.rows[0];
}

export async function getFileById(id: string): Promise<FileRecord | null> {
  const result = await pool.query<FileRecord>(
    `SELECT * FROM files WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

export async function listFiles(limit = 50): Promise<FileRecord[]> {
  const result = await pool.query<FileRecord>(
    `SELECT * FROM files ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return result.rows;
}

export async function updateFileStatus(
  id: string,
  status: FileRecord['status'],
  errorMessage?: string
): Promise<void> {
  await pool.query(
    `UPDATE files 
     SET status = $1, error_message = $2, updated_at = NOW()
     WHERE id = $3`,
    [status, errorMessage ?? null, id]
  );
}