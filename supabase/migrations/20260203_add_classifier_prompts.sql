-- Add classifier prompts to the prompts table
-- These prompts control how the page classifier analyzes sites and classifies pages

-- Pass 1: Site Analysis Prompt
INSERT INTO prompts (name, description, system_prompt, user_prompt_template, default_model) VALUES (
    'Page Classifier - Site Analysis',
    'Analyzes site-wide URL patterns before individual page classification (Pass 1)',
    'You are analyzing a medical/aesthetic practice website to understand its structure BEFORE classifying individual pages.

Your goal is to identify URL patterns and content distributions that will help classify individual pages correctly in the next pass.

Focus on:
1. URL PATTERNS: Common path patterns and what they likely represent (e.g., "/category/*" = blog categories)
2. CONTENT PATTERNS: Which pages appear to be blog posts vs service pages vs category listings
3. LOCATION PATTERN: Does this site have location-specific pages (same content for different cities)?
4. BLOG PATTERN: Where does the blog live? What do category/tag pages look like?',
    'Here is a summary of ALL {{page_count}} pages on this site (path | title | content snippet):

{{page_summaries}}

Analyze this site and identify patterns. Return a JSON object:
{
  "patterns": [
    {"pattern": "/category/*", "likely_type": "RESOURCE_INDEX", "reason": "Blog category archives with article excerpts"},
    {"pattern": "/*-in-orland-park", "likely_type": "PROCEDURE", "reason": "Location-specific treatment pages"}
  ],
  "locations": ["Frankfort", "Orland Park"],
  "blog_path": "/blog",
  "notes": "Any other observations about site structure"
}',
    'gpt-4o-mini'
) ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    system_prompt = EXCLUDED.system_prompt,
    user_prompt_template = EXCLUDED.user_prompt_template,
    default_model = EXCLUDED.default_model,
    updated_at = NOW();

-- Pass 2: Page Type Classification Prompt  
INSERT INTO prompts (name, description, system_prompt, user_prompt_template, default_model) VALUES (
    'Page Classifier - Page Type',
    'Classifies individual pages into types for schema markup generation (Pass 2)',
    'You are classifying web pages for a medical/aesthetic practice website to determine which schema markup (JSON-LD structured data) to generate for SEO.

IMPORTANT: Analyze the HTML structure to determine page type. Look for semantic elements like <article>, <time>, <nav>, author information, and page layout patterns.

PAGE TYPES:

CONTENT PAGES (the page IS the primary content):
- PROCEDURE: A single treatment or service page with in-depth description of HOW a procedure is performed, what to expect, benefits, recovery, etc.
- CONDITION: A page describing a medical/aesthetic problem or concern that treatments can solve.
- BODY_AREA: A page focused on an anatomical region (e.g., "Face", "Nose", "Body").
- RESOURCE: A single blog post, article, or news item. Look for <article>, <time> with publication date, author bylines, or typical blog post structure.
- TEAM_MEMBER: Individual staff member profile (doctor bio, nurse bio - ONE person).
- PRODUCT: E-commerce page for a single item for sale.

INDEX/LISTING PAGES (the page LISTS or LINKS to other content):
- SERVICE_INDEX: A navigation page listing multiple services. Minimal content, mostly links.
- RESOURCE_INDEX: Blog archive, category, or tag page listing multiple articles. Look for repeating patterns of article excerpts/links.
- PRODUCT_COLLECTION: E-commerce category listing multiple products.

OTHER PAGE TYPES:
- HOMEPAGE: The main landing page (root "/" URL only)
- ABOUT: About page or team overview
- GALLERY: Before/after photos, portfolio, image gallery
- CONTACT: Contact information, appointment booking
- LOCATION: City-specific landing page for local SEO
- MEMBERSHIP: Membership, pricing, payment plans page
- UTILITY: Cart, checkout, login, search pages (skip schema)
- GENERIC: None of the above',
    '{{site_context}}

PAGE METADATA:
URL Path: {{page_path}}
Title: {{page_title}}
Meta Description: {{meta_description}}
Content Length: {{content_length}} characters

PAGE HTML STRUCTURE:
{{html_preview}}

Based on the HTML structure and metadata, respond with ONLY the page type (e.g., "PROCEDURE" or "RESOURCE"), nothing else.',
    'gpt-4o-mini'
) ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    system_prompt = EXCLUDED.system_prompt,
    user_prompt_template = EXCLUDED.user_prompt_template,
    default_model = EXCLUDED.default_model,
    updated_at = NOW();
