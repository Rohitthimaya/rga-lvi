# AICanGrow Bot

AICanGrow Bot is an AI crop advisory platform for British Columbia farmers. Farmers ask questions about crop disease, pests, soil, irrigation, pesticide rules, or farm programs and receive answers grounded in indexed BC Ministry of Agriculture documents with source and page citations.

## Architecture

This project keeps the production RAG architecture from the original system:

1. PDF upload through the admin UI stores the document in S3.
2. BullMQ sends an ingestion job to the worker.
3. LlamaParse converts the PDF to markdown.
4. The chunker creates typed grounding nodes.
5. The BC metadata extractor tags crop, region, document type, source year, spray advice, and regulatory information.
6. The summarizer creates short retrieval text for each node.
7. Voyage embeds those retrieval summaries.
8. Postgres stores full grounding content in `nodes` and retrieval summaries/vectors in `vectors`.
9. `/api/ask` performs hybrid dense + BM25 retrieval, RRF fusion, optional reranking, grounded Claude generation, verification, citations, and farmer query logging.

The important design is the 2-layer RAG model: full chunk content is used for grounding and answer generation, while short summaries are used for fast and accurate retrieval.

## Supported Crops And Regions

Active launch crops:

- Blueberry in Fraser Valley
- Apple in Okanagan
- Cherry in Okanagan
- Grape in Okanagan
- Programs and regulations for all BC regions

Coming soon:

- Raspberry, strawberry, cranberry
- Peach, pear
- Soil and water corpus

Regions recognized by metadata and retrieval filters:

- Fraser Valley
- Okanagan
- Vancouver Island
- Northern BC
- all

## Setup

Install dependencies:

```bash
npm install
```

Create an environment file:

```bash
cp .env.example .env
```

Fill in `DATABASE_URL`, S3 credentials, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `LLAMA_CLOUD_API_KEY`, and optional `COHERE_API_KEY`.

Start Redis:

```bash
docker-compose up
```

Run the API server:

```bash
npm run dev:server
```

Run the worker:

```bash
npm run dev:worker
```

Run the Next.js app:

```bash
npm run dev
```

Apply the schema migration in `server/src/db/migrations/001_aicangrow_schema.sql` to your Postgres database before ingesting documents.

## Add A New Crop

Add or activate the crop in `corpus_registry`:

```sql
INSERT INTO corpus_registry (crop, region, status)
VALUES ('raspberry', 'Fraser Valley', 'active')
ON CONFLICT (crop) DO UPDATE
SET status = 'active', region = EXCLUDED.region, updated_at = now();
```

Then upload the crop documents through the admin upload UI and let the worker re-index them. No code changes are needed for normal crop expansion.

## Run Ingestion

Open the admin UI and upload BC Ministry PDFs from `/admin/upload`. The worker parses, chunks, tags, summarizes, embeds, and writes vectors automatically. Use `/admin/docs` to inspect document status and chunk metadata.

For free-tier/local provider limits, throttle ingestion in `.env`:

```bash
SUMMARY_MODE=anthropic
SUMMARY_CONCURRENCY=1
SUMMARY_DELAY_MS=2000
SUMMARY_MAX_ATTEMPTS=8
SUMMARY_RETRY_MAX_DELAY_MS=65000
VOYAGE_EMBED_BATCH_SIZE=5
VOYAGE_EMBED_DELAY_MS=30000
VOYAGE_EMBED_MAX_ATTEMPTS=8
```

`SUMMARY_MODE` can be `anthropic`, `gemini`, or `fallback`. `fallback` uses no summary model and embeds deterministic metadata plus chunk text. For a quick partial test, add `INGEST_MAX_PAGES=30`. Remove it later to index the full PDF; throttling the full PDF gives the same final retrieval corpus, just slower.

## Test The Ask Endpoint

```bash
curl -X POST http://localhost:3000/api/ask \
  -H "Content-Type: application/json" \
  -H "x-session-id: demo-george" \
  -d '{
    "query": "My blueberry leaves are turning yellow, what could be wrong?",
    "crop": "blueberry",
    "region": "Fraser Valley"
  }'
```

```bash
curl -X POST http://localhost:3000/api/ask \
  -H "Content-Type: application/json" \
  -H "x-session-id: demo-george" \
  -d '{
    "query": "How do I manage Spotted Wing Drosophila on my blueberry crop?",
    "crop": "blueberry",
    "region": "Fraser Valley"
  }'
```

```bash
curl -X POST http://localhost:3000/api/ask \
  -H "Content-Type: application/json" \
  -H "x-session-id: demo-george" \
  -d '{
    "query": "What fertilizer rates are recommended for highbush blueberries in BC?",
    "crop": "blueberry",
    "region": "Fraser Valley"
  }'
```

## Farmer Notes

Create a note:

```bash
curl -X POST http://localhost:3000/api/notes \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "demo-george",
    "note_text": "Yellowing leaves in block 4 after heavy rain.",
    "crop": "blueberry",
    "region": "Fraser Valley"
  }'
```

List notes:

```bash
curl http://localhost:3000/api/notes/demo-george
```

## Demo Scenarios

- Blueberry leaves turning yellow: shows diagnosis-style answer, recommendations, and cited BC Blueberry Production Guide pages.
- Spotted Wing Drosophila on blueberries: shows IPM and pesticide caution behavior, including the Health Canada label disclaimer.
- Fertilizer rates for highbush blueberries: shows production-guide retrieval, page citations, and no invented rates.
- Unsupported crop, such as pear before activation: returns a graceful corpus coverage message without calling Claude.
