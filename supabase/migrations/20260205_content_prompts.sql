-- Add Content Analysis and Section Enhancement prompts to the prompts table
-- These prompts are used by the Page Content feature to analyze and enhance page sections

INSERT INTO prompts (name, description, system_prompt, default_model)
VALUES (
    'Content Analysis',
    'Analyzes webpage content against template sections to identify what is present, missing, and should be enhanced',
    'You are a content analyst for webpages. Analyze webpage structure and identify sections. Be thorough in detecting optional content like FAQs, testimonials, and pricing.',
    'gpt-4o'
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    system_prompt = EXCLUDED.system_prompt,
    default_model = EXCLUDED.default_model,
    updated_at = NOW();

INSERT INTO prompts (name, description, system_prompt, default_model)
VALUES (
    'Section Enhancement',
    'Enhances individual page sections with SEO-optimized, engaging content while preserving all original elements',
    'You are an expert content writer who creates engaging, SEO-optimized content for websites. CRITICAL: Always preserve and enhance all elements from the original content - never remove FAQs, testimonials, statistics, or other valuable content. Your enhanced version should be at least as thorough as the original.',
    'gpt-4o'
)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    system_prompt = EXCLUDED.system_prompt,
    default_model = EXCLUDED.default_model,
    updated_at = NOW();
