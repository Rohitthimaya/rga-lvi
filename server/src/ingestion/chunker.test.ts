import { downloadFromS3 } from '../lib/storage';
import { parsePdf } from './llamaparse';
import { chunkMarkdown } from './chunker';
import { pool } from '../db/client';

async function main() {
  // Grab the most recent successfully-parsed file from the DB
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
  console.log(`Testing chunker on: ${file.original_name}`);
  console.log('─'.repeat(60));

  const buffer = await downloadFromS3(file.storage_key);
  const { markdown, pageCount } = await parsePdf({
    buffer,
    filename: file.original_name,
  });
  console.log(`Parsed: ${pageCount} pages, ${markdown.length} chars\n`);

  const nodes = chunkMarkdown(markdown);
  console.log(`Produced ${nodes.length} nodes:\n`);

  const summary: Record<string, number> = {};
  nodes.forEach((n) => {
    summary[n.type] = (summary[n.type] || 0) + 1;
  });
  console.log('Breakdown by type:', summary, '\n');

  nodes.forEach((node, i) => {
    console.log(`── Node ${i + 1} ──`);
    console.log(`  Type:    ${node.type}`);
    console.log(`  Page:    ${node.page}`);
    console.log(`  Section: ${node.section || '(none)'}`);
    console.log(`  Tokens:  ${node.tokenCount}`);
    console.log(`  Figures: ${node.figureRefs.join(', ') || '(none)'}`);
    console.log(`  Content preview:`);
    const preview = node.content.slice(0, 200).replace(/\n/g, ' ');
    console.log(`    ${preview}${node.content.length > 200 ? '…' : ''}`);
    console.log();
  });

  await pool.end();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});