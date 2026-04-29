import { downloadFromS3 } from '../lib/storage';
import { parsePdf } from './llamaparse';
import { chunkMarkdown } from './chunker';
import { extractMetadataForNodes } from './metadata';
import { pool } from '../db/client';

async function main() {
  const { rows } = await pool.query(
    `SELECT id, original_name, storage_key 
     FROM files 
     WHERE status = 'ready' 
     ORDER BY updated_at DESC 
     LIMIT 1`
  );

  if (rows.length === 0) {
    console.error('No ready files found. Upload a PDF first.');
    process.exit(1);
  }

  const file = rows[0];
  console.log(`Testing metadata extraction on: ${file.original_name}`);
  console.log('─'.repeat(60));

  const buffer = await downloadFromS3(file.storage_key);
  const { markdown } = await parsePdf({
    buffer,
    filename: file.original_name,
  });

  const nodes = chunkMarkdown(markdown);
  console.log(`Chunked into ${nodes.length} nodes. Extracting metadata...\n`);

  const firstPageContent = markdown.split(/^---\s*$/m)[0];

  const t0 = Date.now();
  const metadata = await extractMetadataForNodes(nodes, {
    filename: file.original_name,
    firstPageContent,
  });
  const elapsed = Date.now() - t0;
  console.log(`Extracted in ${elapsed}ms (${Math.round(elapsed / nodes.length)}ms/node avg)\n`);

  nodes.forEach((node, i) => {
    const m = metadata[i];
    console.log(`── Node ${i + 1} (${node.type}, page ${node.page}) ──`);
    console.log(`  crop:                ${m.crop}`);
    console.log(`  region:              ${m.region}`);
    console.log(`  doc_type:            ${m.doc_type}`);
    console.log(`  source_year:         ${m.source_year}`);
    console.log(`  section:             ${m.section}`);
    console.log(`  has_spray_advice:    ${m.has_spray_advice}`);
    console.log(`  has_regulatory_info: ${m.has_regulatory_info}`);
    console.log();
  });

  await pool.end();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});