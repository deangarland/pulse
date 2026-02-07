-- Add enhancement_guidance column to page_content_templates
-- This stores page-type-specific SEO enhancement rules

ALTER TABLE page_content_templates 
ADD COLUMN IF NOT EXISTS enhancement_guidance TEXT;

-- Populate for service page type
UPDATE page_content_templates 
SET enhancement_guidance = 'Hero: Include primary service keyword + location in H1. Keep intro concise and benefit-focused.
Benefits: Use bullet/list format for scannability. Preserve industry terms (these are SEO keywords). Keep specific conditions/symptoms mentioned.
Process: Build trust with clear numbered steps. Keep any pricing if present.
FAQ: Target long-tail keywords. Keep question/answer format for featured snippets.
Testimonials: NEVER modify - preserve exactly as written.
CTA: Clear action verb, add urgency if appropriate.'
WHERE page_type = 'service';

-- Populate for location page type  
UPDATE page_content_templates 
SET enhancement_guidance = 'Hero: Emphasize geographic location prominently in H1.
Location details: Include nearby areas, neighborhoods, landmarks if present.
Local differentiators: Highlight what makes this location unique.
Service areas: List all areas served if mentioned.
Contact: Preserve address, phone, hours exactly.'
WHERE page_type = 'location';

-- Populate for blog page type
UPDATE page_content_templates 
SET enhancement_guidance = 'Title: Include primary keyword, keep engaging.
Intro: Hook reader, preview value.
Body: Break into scannable sections with clear H2s.
Images: Preserve alt text and captions.
Author: Preserve byline and credentials exactly.
CTA: Include relevant next steps or related content.'
WHERE page_type = 'blog';

COMMENT ON COLUMN page_content_templates.enhancement_guidance IS 'SEO enhancement rules specific to this page type. Injected into AI prompt as {{enhancement_guidance}}.';
