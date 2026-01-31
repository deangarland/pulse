-- Create prompts table
CREATE TABLE IF NOT EXISTS prompts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    system_prompt TEXT NOT NULL,
    user_prompt_template TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;

-- Allow read/write for authenticated users (adjust as needed)
CREATE POLICY "Allow all access to prompts" ON prompts
    FOR ALL USING (true) WITH CHECK (true);

-- Insert default Meta & Schema prompt
INSERT INTO prompts (name, description, system_prompt) VALUES (
    'Meta & Schema Recommendations',
    'System prompt for generating meta tag and schema markup recommendations for web pages',
    'You are an expert SEO consultant specializing in healthcare and medical aesthetics websites. Your role is to analyze web pages and provide optimized meta tags and schema markup recommendations.

For every recommendation, you MUST explain your reasoning - why you''re making this specific change and what benefit it provides.

Focus on:
- Local SEO optimization (include location when relevant)
- Rich snippet eligibility (structured data for enhanced search results)
- Answer Engine Optimization (AEO) - structuring content for AI-powered search
- Clear, compelling copy that drives clicks

Your recommendations should be specific to healthcare/medical practices and their procedures.'
) ON CONFLICT (name) DO NOTHING;
