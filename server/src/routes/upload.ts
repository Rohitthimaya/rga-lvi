import { Router, Request, Response } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import path from 'path';
import { downloadFromS3, uploadToS3 } from '../lib/storage';
import { createFileRecord, listFiles, getFileById } from '../db/files';
import { enqueueFileJob } from '../queues/fileQueue';
import { getNodesByFileId } from '../db/nodes';

const router = Router();

// Configure multer to keep files in memory (they're small PDFs, no need to touch disk)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB max — PDFs rarely exceed this
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      cb(new Error('Only PDF files are allowed'));
      return;
    }
    cb(null, true);
  },
});


// GET /files/:id/nodes — inspect the chunks for a file
router.get('/files/:id/nodes', async (req: Request, res: Response) => {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    if (typeof id !== 'string' || !id) {
      return res.status(400).json({ error: 'Invalid file id' });
    }
    const nodes = await getNodesByFileId(id);
    res.json({
      fileId: id,
      nodeCount: nodes.length,
      nodes: nodes.map((n) => ({
        id: n.id,
        page: n.page,
        type: n.type,
        section: n.section,
        product_model: n.product_model,
        doc_type: n.doc_type,
        has_safety_warning: n.has_safety_warning,
        has_torque_spec: n.has_torque_spec,
        figure_refs: n.figure_refs,
        content_preview: n.content.slice(0, 150),
        content_length: n.content.length,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch nodes', details: message });
  }
});

// POST /upload — upload a single PDF
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded. Use form field "file".' });
    }

    const { buffer, originalname, mimetype, size } = req.file;

    // Build a unique S3 key: uploads/<uuid>-<original-filename>
    const id = randomUUID();
    const sanitizedName = path.basename(originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = `uploads/${id}-${sanitizedName}`;

    // Upload to S3
    const { url } = await uploadToS3({
      key: storageKey,
      body: buffer,
      contentType: mimetype,
    });

    // Write metadata to Postgres
    const fileRecord = await createFileRecord({
      originalName: originalname,
      mimeType: mimetype,
      sizeBytes: size,
      storageUrl: url,
      storageKey,
    });


    // Enqueue the file for background processing
    await enqueueFileJob({
        fileId: fileRecord.id,
        storageKey: fileRecord.storage_key,
        storageUrl: fileRecord.storage_url,
        originalName: fileRecord.original_name,
        mimeType: fileRecord.mime_type,
    });
  

    res.status(201).json({
      fileId: fileRecord.id,
      status: fileRecord.status,
      originalName: fileRecord.original_name,
      sizeBytes: fileRecord.size_bytes,
      storageKey: fileRecord.storage_key,
      createdAt: fileRecord.created_at,
    });
  } catch (err) {
    console.error('Upload failed:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: 'Upload failed', details: message });
  }
});

// GET /files — list recent uploads (handy for verifying)
router.get('/files', async (_req: Request, res: Response) => {
  try {
    const files = await listFiles(50);
    res.json({ files });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to list files', details: message });
  }
});

// GET /files/:id — fetch one file's metadata
router.get('/files/:id', async (req: Request, res: Response) => {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    if (typeof id !== 'string' || !id) {
      return res.status(400).json({ error: 'Invalid file id' });
    }
    const file = await getFileById(id);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.json(file);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch file', details: message });
  }
});

// GET /files/:id/download — proxy the original PDF from S3
router.get('/files/:id/download', async (req: Request, res: Response) => {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    if (typeof id !== 'string' || !id) {
      return res.status(400).json({ error: 'Invalid file id' });
    }

    const file = await getFileById(id);
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    const buffer = await downloadFromS3(file.storage_key);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${file.original_name}"`);
    res.send(buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to download file', details: message });
  }
});

export default router;