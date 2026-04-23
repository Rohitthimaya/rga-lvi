#!/bin/bash

set -e

API_URL="${API_URL:-http://localhost:3000}"
PDF_DIR="${PDF_DIR:-test-pdfs}"

echo "Uploading all PDFs from $PDF_DIR..."
echo ""

for pdf in "$PDF_DIR"/*.pdf; do
  filename=$(basename "$pdf")
  echo "→ $filename"

  response=$(curl -s -X POST "$API_URL/upload" -F "file=@$pdf")
  file_id=$(echo "$response" | jq -r '.fileId // "null"')

  if [ "$file_id" = "null" ]; then
    echo "  ✗ Upload failed: $response"
  else
    echo "  ✓ Uploaded as $file_id"
  fi
done

echo ""
echo "All files queued. Watch the worker terminal for processing progress."
echo "Each PDF takes ~30-90 seconds depending on page count."