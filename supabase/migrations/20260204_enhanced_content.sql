-- Add enhanced content storage to page_index table
-- This stores AI-enhanced content per section, with reasoning and history

ALTER TABLE page_index ADD COLUMN IF NOT EXISTS enhanced_content JSONB;
ALTER TABLE page_index ADD COLUMN IF NOT EXISTS content_analyzed_at TIMESTAMPTZ;

-- Create index for efficient querying of pages with enhanced content
CREATE INDEX IF NOT EXISTS idx_page_index_enhanced_content 
ON page_index USING GIN (enhanced_content) 
WHERE enhanced_content IS NOT NULL;

-- Add comment explaining structure
COMMENT ON COLUMN page_index.enhanced_content IS 
'Stores AI-enhanced content per section. Structure:
{
  "sections": {
    "hero": {
      "original": "<h1>Original...</h1>",
      "enhanced": "<h1>Enhanced...</h1>",
      "reasoning": "Why this is better...",
      "changes": ["Change 1", "Change 2"],
      "enhanced_at": "2026-02-04T15:00:00Z",
      "heading_level": "H1"
    }
  },
  "overall_score": 80,
  "analyzed_at": "2026-02-04T15:00:00Z"
}';
