ALTER TABLE nodes ADD COLUMN IF NOT EXISTS crop text;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS region text;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS doc_type text DEFAULT 'production_guide';
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS source_year integer;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS has_spray_advice boolean DEFAULT false;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS has_regulatory_info boolean DEFAULT false;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS corpus_version text DEFAULT 'v1';

ALTER TABLE vectors ADD COLUMN IF NOT EXISTS crop text;
ALTER TABLE vectors ADD COLUMN IF NOT EXISTS region text;
ALTER TABLE vectors ADD COLUMN IF NOT EXISTS doc_type text;

CREATE TABLE IF NOT EXISTS corpus_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crop text NOT NULL UNIQUE,
  region text,
  status text NOT NULL DEFAULT 'active',
  doc_count integer DEFAULT 0,
  chunk_count integer DEFAULT 0,
  last_indexed_at timestamp,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

INSERT INTO corpus_registry (crop, region, status) VALUES
  ('blueberry', 'Fraser Valley', 'active'),
  ('apple', 'Okanagan', 'active'),
  ('cherry', 'Okanagan', 'active'),
  ('grape', 'Okanagan', 'active'),
  ('programs', 'all', 'active'),
  ('regulations', 'all', 'active'),
  ('raspberry', 'Fraser Valley', 'coming_soon'),
  ('strawberry', 'Fraser Valley', 'coming_soon'),
  ('cranberry', 'Fraser Valley', 'coming_soon'),
  ('peach', 'Okanagan', 'coming_soon'),
  ('pear', 'Okanagan', 'coming_soon'),
  ('soil', 'all', 'coming_soon')
ON CONFLICT (crop) DO NOTHING;

CREATE TABLE IF NOT EXISTS farmer_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text,
  query text NOT NULL,
  crop_detected text,
  region_detected text,
  had_image boolean DEFAULT false,
  had_voice boolean DEFAULT false,
  answer_verified boolean,
  chunks_used integer,
  response_ms integer,
  created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS farmer_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  note_text text NOT NULL,
  crop text,
  region text,
  image_url text,
  created_at timestamp DEFAULT now()
);
