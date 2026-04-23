import { config } from '../config';

const LLAMA_CLOUD_BASE = 'https://api.cloud.llamaindex.ai/api/v1/parsing';

export interface ParseResult {
  jobId: string;
  markdown: string;
  pageCount: number;
}

/**
 * Upload a PDF to LlamaParse and get back structured markdown.
 * Uses premium mode with agent-based parsing for best quality on technical docs.
 */
export async function parsePdf(params: {
  buffer: Buffer;
  filename: string;
}): Promise<ParseResult> {
  const { buffer, filename } = params;

  // Step 1: Upload file
  const uploadFormData = new FormData();
  const blob = new Blob([new Uint8Array(buffer)], { type: 'application/pdf' });
  uploadFormData.append('file', blob, filename);
  uploadFormData.append('parse_mode', 'parse_page_with_agent');
  uploadFormData.append('high_res_ocr', 'true');
  uploadFormData.append('adaptive_long_table', 'true');
  uploadFormData.append('outlined_table_extraction', 'true');
  uploadFormData.append('output_tables_as_HTML', 'true');

  const uploadResp = await fetch(`${LLAMA_CLOUD_BASE}/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.LLAMA_CLOUD_API_KEY}`,
    },
    body: uploadFormData,
  });

  if (!uploadResp.ok) {
    const errText = await uploadResp.text();
    throw new Error(`LlamaParse upload failed (${uploadResp.status}): ${errText}`);
  }

  const uploadJson = (await uploadResp.json()) as { id: string };
  const jobId = uploadJson.id;
  console.log(`  LlamaParse job created: ${jobId}`);

  // Step 2: Poll for completion (up to 5 minutes)
  const maxAttempts = 60;
  const delayMs = 5000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    const statusResp = await fetch(`${LLAMA_CLOUD_BASE}/job/${jobId}`, {
      headers: { Authorization: `Bearer ${config.LLAMA_CLOUD_API_KEY}` },
    });

    if (!statusResp.ok) {
      const errText = await statusResp.text();
      throw new Error(`LlamaParse status check failed (${statusResp.status}): ${errText}`);
    }

    const statusJson = (await statusResp.json()) as { status: string };

    if (statusJson.status === 'SUCCESS') {
      console.log(`  LlamaParse complete after ${attempt * 5}s`);
      break;
    }
    if (statusJson.status === 'ERROR' || statusJson.status === 'CANCELED') {
      throw new Error(`LlamaParse job failed: ${statusJson.status}`);
    }
    if (attempt === maxAttempts) {
      throw new Error(`LlamaParse job timed out after ${maxAttempts * 5}s`);
    }

    if (attempt % 6 === 0) {
      console.log(`  LlamaParse still processing (${attempt * 5}s elapsed)...`);
    }
  }

  // Step 3: Download markdown result
  const mdResp = await fetch(`${LLAMA_CLOUD_BASE}/job/${jobId}/result/markdown`, {
    headers: { Authorization: `Bearer ${config.LLAMA_CLOUD_API_KEY}` },
  });

  if (!mdResp.ok) {
    const errText = await mdResp.text();
    throw new Error(`LlamaParse markdown download failed (${mdResp.status}): ${errText}`);
  }

  const mdJson = (await mdResp.json()) as { markdown: string };
  const markdown = mdJson.markdown;

  // Estimate page count by counting page separators (LlamaParse uses `---` between pages)
  const pageCount = (markdown.match(/^---$/gm) || []).length + 1;

  return {
    jobId,
    markdown,
    pageCount,
  };
}