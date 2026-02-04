-- Migration: Create page_content_templates table
-- Purpose: Define expected content sections for each page type

CREATE TABLE IF NOT EXISTS page_content_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_type TEXT NOT NULL UNIQUE,       -- 'PROCEDURE', 'LOCATION', 'ABOUT', etc.
    name TEXT NOT NULL,                    -- Human-readable name
    description TEXT,                      -- Description of this page type
    
    -- Expected sections for this page type
    -- Array of section definitions with id, name, required flag, description
    sections JSONB NOT NULL DEFAULT '[]',
    
    -- AI prompts
    section_analysis_prompt TEXT,          -- Prompt to identify sections in existing content
    rewrite_prompt TEXT,                   -- Prompt to rewrite individual sections
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE page_content_templates ENABLE ROW LEVEL SECURITY;

-- Allow all access (admin table)
CREATE POLICY "Allow all access to page_content_templates" ON page_content_templates
    FOR ALL USING (true);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_page_content_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER page_content_templates_updated_at
    BEFORE UPDATE ON page_content_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_page_content_templates_updated_at();

-- SEED DATA: Common page types with expected sections

-- PROCEDURE pages (medical/aesthetic procedures)
INSERT INTO page_content_templates (page_type, name, description, sections, section_analysis_prompt, rewrite_prompt)
VALUES (
    'PROCEDURE',
    'Procedure Page',
    'Pages describing medical or aesthetic procedures/services',
    '[
        {"id": "hero", "name": "Hero Section", "required": true, "description": "Page title (H1), subtitle/tagline, hero image or video", "example_elements": ["h1", "tagline", "hero_image"]},
        {"id": "intro", "name": "Introduction", "required": true, "description": "Brief overview explaining what the procedure is and who it benefits", "example_elements": ["overview_paragraph", "key_benefits_list"]},
        {"id": "benefits", "name": "Benefits/Why Choose", "required": false, "description": "Key benefits, advantages, or reasons to choose this procedure", "example_elements": ["benefits_list", "comparison_points"]},
        {"id": "process", "name": "How It Works/Process", "required": true, "description": "Step-by-step explanation of what to expect during the procedure", "example_elements": ["numbered_steps", "timeline"]},
        {"id": "candidates", "name": "Ideal Candidates", "required": false, "description": "Who is a good candidate for this procedure", "example_elements": ["criteria_list", "contraindications"]},
        {"id": "results", "name": "Expected Results", "required": false, "description": "What results to expect, before/after info, timeline", "example_elements": ["results_description", "before_after_images"]},
        {"id": "recovery", "name": "Recovery/Aftercare", "required": false, "description": "Recovery timeline, aftercare instructions", "example_elements": ["timeline", "care_instructions"]},
        {"id": "pricing", "name": "Pricing/Cost", "required": false, "description": "Pricing information, financing options", "example_elements": ["price_range", "financing_info"]},
        {"id": "faq", "name": "FAQ Section", "required": false, "description": "Frequently asked questions about the procedure", "example_elements": ["question_answer_pairs"]},
        {"id": "cta", "name": "Call to Action", "required": true, "description": "Contact form, booking button, consultation CTA", "example_elements": ["contact_form", "phone_number", "book_button"]}
    ]'::jsonb,
    'Analyze this page content and identify which sections are present. For each section found, note its location (heading text or HTML structure) and provide a brief summary of its content. Also identify any content that doesn''t fit the expected sections.',
    'Rewrite this section to be more engaging, SEO-friendly, and persuasive while maintaining the same factual information. Preserve the tone and voice of the original but improve clarity and readability.'
)
ON CONFLICT (page_type) DO UPDATE SET
    sections = EXCLUDED.sections,
    section_analysis_prompt = EXCLUDED.section_analysis_prompt,
    rewrite_prompt = EXCLUDED.rewrite_prompt;

-- LOCATION pages (office/clinic locations)
INSERT INTO page_content_templates (page_type, name, description, sections, section_analysis_prompt, rewrite_prompt)
VALUES (
    'LOCATION',
    'Location Page',
    'Pages describing a physical office, clinic, or store location',
    '[
        {"id": "hero", "name": "Hero Section", "required": true, "description": "Location name, address, hero image of the facility", "example_elements": ["h1", "address", "facility_image"]},
        {"id": "about", "name": "About This Location", "required": true, "description": "Overview of the location, what makes it unique", "example_elements": ["description", "unique_features"]},
        {"id": "services", "name": "Services Offered", "required": false, "description": "List of services available at this location", "example_elements": ["services_list", "service_links"]},
        {"id": "team", "name": "Our Team", "required": false, "description": "Staff or providers at this location", "example_elements": ["team_member_cards", "bios"]},
        {"id": "hours", "name": "Hours of Operation", "required": true, "description": "Business hours for this location", "example_elements": ["hours_table", "holiday_hours"]},
        {"id": "directions", "name": "Directions/Getting Here", "required": false, "description": "Directions, parking info, accessibility", "example_elements": ["map", "directions_text", "parking_info"]},
        {"id": "contact", "name": "Contact Information", "required": true, "description": "Phone, email, contact form", "example_elements": ["phone", "email", "contact_form"]}
    ]'::jsonb,
    'Analyze this location page and identify which sections are present. Note the address, hours, and services mentioned.',
    'Rewrite this section to highlight what makes this location special while being informative and locally optimized.'
)
ON CONFLICT (page_type) DO UPDATE SET
    sections = EXCLUDED.sections,
    section_analysis_prompt = EXCLUDED.section_analysis_prompt,
    rewrite_prompt = EXCLUDED.rewrite_prompt;

-- ABOUT pages
INSERT INTO page_content_templates (page_type, name, description, sections, section_analysis_prompt, rewrite_prompt)
VALUES (
    'ABOUT',
    'About Page',
    'Pages about the company, organization, or individual',
    '[
        {"id": "hero", "name": "Hero Section", "required": true, "description": "About us headline, company tagline", "example_elements": ["h1", "tagline", "team_photo"]},
        {"id": "story", "name": "Our Story/History", "required": true, "description": "Company history, founding story, journey", "example_elements": ["narrative", "timeline", "milestones"]},
        {"id": "mission", "name": "Mission & Values", "required": false, "description": "Mission statement, core values, vision", "example_elements": ["mission_statement", "values_list"]},
        {"id": "team", "name": "Meet the Team", "required": false, "description": "Key team members, leadership", "example_elements": ["team_cards", "bios", "headshots"]},
        {"id": "credentials", "name": "Credentials/Awards", "required": false, "description": "Certifications, awards, recognition", "example_elements": ["credentials_list", "award_logos"]},
        {"id": "cta", "name": "Call to Action", "required": false, "description": "Contact us, learn more", "example_elements": ["contact_link", "cta_button"]}
    ]'::jsonb,
    'Analyze this about page to identify the company story, mission, team information, and credentials mentioned.',
    'Rewrite this section to build trust and credibility while telling a compelling story about the organization.'
)
ON CONFLICT (page_type) DO UPDATE SET
    sections = EXCLUDED.sections,
    section_analysis_prompt = EXCLUDED.section_analysis_prompt,
    rewrite_prompt = EXCLUDED.rewrite_prompt;

-- HOMEPAGE
INSERT INTO page_content_templates (page_type, name, description, sections, section_analysis_prompt, rewrite_prompt)
VALUES (
    'HOMEPAGE',
    'Homepage',
    'The main landing page of a website',
    '[
        {"id": "hero", "name": "Hero Section", "required": true, "description": "Main headline, value proposition, primary CTA", "example_elements": ["h1", "tagline", "cta_button", "hero_image"]},
        {"id": "services", "name": "Services Overview", "required": true, "description": "Summary of main services or offerings", "example_elements": ["service_cards", "service_links"]},
        {"id": "trust", "name": "Trust Signals", "required": false, "description": "Credentials, certifications, partner logos, stats", "example_elements": ["logos", "stats", "certifications"]},
        {"id": "testimonials", "name": "Testimonials/Reviews", "required": false, "description": "Customer testimonials, reviews, case studies", "example_elements": ["testimonial_cards", "star_ratings"]},
        {"id": "about", "name": "About Preview", "required": false, "description": "Brief intro to the company/team", "example_elements": ["about_blurb", "team_photo"]},
        {"id": "cta", "name": "Call to Action", "required": true, "description": "Main conversion action - contact, book, buy", "example_elements": ["contact_form", "cta_button", "phone_number"]}
    ]'::jsonb,
    'Analyze this homepage to identify the main value proposition, services highlighted, and conversion elements.',
    'Rewrite this section to create a strong first impression, clearly communicate value, and drive conversions.'
)
ON CONFLICT (page_type) DO UPDATE SET
    sections = EXCLUDED.sections,
    section_analysis_prompt = EXCLUDED.section_analysis_prompt,
    rewrite_prompt = EXCLUDED.rewrite_prompt;

-- TEAM_MEMBER pages
INSERT INTO page_content_templates (page_type, name, description, sections, section_analysis_prompt, rewrite_prompt)
VALUES (
    'TEAM_MEMBER',
    'Team Member/Bio Page',
    'Individual profile pages for team members, doctors, staff',
    '[
        {"id": "hero", "name": "Hero/Profile", "required": true, "description": "Name, title, headshot", "example_elements": ["h1_name", "title", "headshot"]},
        {"id": "bio", "name": "Biography", "required": true, "description": "Professional biography, background", "example_elements": ["bio_paragraphs"]},
        {"id": "credentials", "name": "Education & Credentials", "required": false, "description": "Degrees, certifications, training", "example_elements": ["education_list", "certifications"]},
        {"id": "specialties", "name": "Specialties/Services", "required": false, "description": "Areas of expertise, services provided", "example_elements": ["specialty_list", "service_links"]},
        {"id": "philosophy", "name": "Philosophy/Approach", "required": false, "description": "Personal philosophy, patient approach", "example_elements": ["philosophy_statement"]},
        {"id": "cta", "name": "Contact/Book", "required": false, "description": "Book with this provider, contact", "example_elements": ["book_button", "contact_link"]}
    ]'::jsonb,
    'Analyze this team member page to identify their name, credentials, specialties, and professional background.',
    'Rewrite this section to present the team member as credible, approachable, and expert in their field.'
)
ON CONFLICT (page_type) DO UPDATE SET
    sections = EXCLUDED.sections,
    section_analysis_prompt = EXCLUDED.section_analysis_prompt,
    rewrite_prompt = EXCLUDED.rewrite_prompt;

-- RESOURCE/BLOG pages
INSERT INTO page_content_templates (page_type, name, description, sections, section_analysis_prompt, rewrite_prompt)
VALUES (
    'RESOURCE',
    'Resource/Blog Article',
    'Educational content, blog posts, articles',
    '[
        {"id": "hero", "name": "Article Header", "required": true, "description": "Title, author, date, featured image", "example_elements": ["h1_title", "author", "date", "featured_image"]},
        {"id": "intro", "name": "Introduction", "required": true, "description": "Hook and overview of what the article covers", "example_elements": ["intro_paragraph", "key_points_preview"]},
        {"id": "body", "name": "Main Content", "required": true, "description": "The main article body with subheadings", "example_elements": ["h2_sections", "paragraphs", "images"]},
        {"id": "conclusion", "name": "Conclusion/Summary", "required": false, "description": "Key takeaways, summary", "example_elements": ["summary", "key_takeaways"]},
        {"id": "cta", "name": "Related Content/CTA", "required": false, "description": "Related articles, subscription CTA", "example_elements": ["related_links", "subscribe_form"]}
    ]'::jsonb,
    'Analyze this article to identify the main topic, key points covered, and content structure.',
    'Rewrite this section to be more engaging, informative, and SEO-optimized while maintaining accuracy.'
)
ON CONFLICT (page_type) DO UPDATE SET
    sections = EXCLUDED.sections,
    section_analysis_prompt = EXCLUDED.section_analysis_prompt,
    rewrite_prompt = EXCLUDED.rewrite_prompt;
