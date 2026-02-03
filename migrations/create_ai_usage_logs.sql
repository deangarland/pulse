-- AI Usage Logs Table
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS ai_usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT now(),
    
    -- What action was performed
    action VARCHAR(100) NOT NULL,  -- e.g., 'meta_schema_generation', 'page_classification'
    page_id UUID REFERENCES page_index(id) ON DELETE SET NULL,
    page_url TEXT,
    
    -- Model info
    provider VARCHAR(50) NOT NULL,  -- 'openai', 'anthropic', 'gemini'
    model VARCHAR(100) NOT NULL,
    
    -- Token usage
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,
    
    -- Cost (in USD, stored as cents for precision)
    input_cost_cents INTEGER NOT NULL DEFAULT 0,
    output_cost_cents INTEGER NOT NULL DEFAULT 0,
    total_cost_cents INTEGER GENERATED ALWAYS AS (input_cost_cents + output_cost_cents) STORED,
    
    -- Request metadata
    request_duration_ms INTEGER,
    success BOOLEAN DEFAULT true,
    error_message TEXT
);

-- Indexes for quick filtering
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created_at ON ai_usage_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_provider ON ai_usage_logs(provider);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_action ON ai_usage_logs(action);

-- Enable RLS
ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role has full access to ai_usage_logs"
ON ai_usage_logs
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Allow authenticated users to read
CREATE POLICY "Authenticated users can view ai_usage_logs"
ON ai_usage_logs
FOR SELECT
USING (auth.role() = 'authenticated');
