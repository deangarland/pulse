-- Create schema_templates table to store schema.org templates by schema type
CREATE TABLE IF NOT EXISTS schema_templates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    schema_type TEXT NOT NULL UNIQUE,          -- e.g., "MedicalProcedure", "MedicalBusiness"
    description TEXT,                          -- Human-readable description
    
    -- Template structure
    base_fields JSONB NOT NULL DEFAULT '[]',   -- Array of fields for this schema type
    required_fields TEXT[] DEFAULT '{}',       -- Fields that must be extracted
    optional_fields TEXT[] DEFAULT '{}',       -- Fields that may be extracted
    
    -- Nesting configuration
    nesting_rules JSONB DEFAULT '{}',          -- What schemas can nest under this one
    common_parents TEXT[] DEFAULT '{}',        -- Schema types this often nests under
    
    -- Example for LLM context
    example_output JSONB,                      -- Example JSON-LD output
    
    -- Field extraction prompt (used by LLM)
    extraction_prompt TEXT,                    -- Prompt template for extracting fields
    
    -- Metadata
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE schema_templates ENABLE ROW LEVEL SECURITY;

-- Allow read/write for authenticated users
CREATE POLICY "Allow all access to schema_templates" ON schema_templates
    FOR ALL USING (true) WITH CHECK (true);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_schema_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER schema_templates_updated_at
    BEFORE UPDATE ON schema_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_schema_templates_updated_at();

-- ============================================
-- SEED DATA: Port existing hardcoded templates
-- ============================================

-- MedicalProcedure Template
INSERT INTO schema_templates (schema_type, description, base_fields, required_fields, optional_fields, nesting_rules, extraction_prompt, example_output, display_order)
VALUES (
    'MedicalProcedure',
    'Schema for medical/aesthetic procedures like Botox, fillers, surgical procedures',
    '["@type", "@id", "name", "url", "mainEntityOfPage", "description", "image", "procedureType", "bodyLocation", "preparation", "howPerformed", "followup"]'::jsonb,
    ARRAY['name', 'url', 'description'],
    ARRAY['image', 'procedureType', 'bodyLocation', 'preparation', 'howPerformed', 'followup'],
    '{"provider": "MedicalBusiness"}'::jsonb,
    'Analyze this medical/aesthetic procedure page and extract schema.org fields.

PAGE CONTENT:
{{content}}

Extract the following (respond ONLY with valid JSON, no markdown):
{
  "bodyLocation": "The primary body part treated (e.g., ''Face'', ''Nose'', ''Lips'', ''Forehead'', ''Neck'', ''Eyelids'', etc.) or null if unclear",
  "procedureType": "One of: ''NoninvasiveProcedure'' (injections, lasers, peels), ''SurgicalProcedure'' (incisions, surgery), ''PercutaneousProcedure'' (catheter-based), or null if unclear",
  "howPerformed": "A 1-2 sentence summary of how this procedure is performed. Return null if the page doesn''t describe procedure steps.",
  "preparation": "Pre-procedure instructions mentioned on the page. Return null if page doesn''t mention preparation.",
  "followup": "Post-procedure expectations mentioned on the page. Return null if page doesn''t mention followup/recovery."
}

CRITICAL: Only include information that is explicitly stated on the page. Return null for any field where the page does not provide that information.',
    '{
        "@type": "MedicalProcedure",
        "@id": "https://example.com/botox#procedure",
        "name": "Botox Injections",
        "url": "https://example.com/botox",
        "mainEntityOfPage": "https://example.com/botox",
        "description": "Botox injections to reduce wrinkles and fine lines.",
        "procedureType": "NoninvasiveProcedure",
        "bodyLocation": "Face",
        "provider": {
            "@type": "MedicalBusiness",
            "@id": "https://example.com/#organization",
            "name": "Example Medical Spa"
        }
    }'::jsonb,
    1
) ON CONFLICT (schema_type) DO UPDATE SET
    description = EXCLUDED.description,
    base_fields = EXCLUDED.base_fields,
    required_fields = EXCLUDED.required_fields,
    optional_fields = EXCLUDED.optional_fields,
    nesting_rules = EXCLUDED.nesting_rules,
    extraction_prompt = EXCLUDED.extraction_prompt,
    example_output = EXCLUDED.example_output;

-- MedicalBusiness Template
INSERT INTO schema_templates (schema_type, description, base_fields, required_fields, optional_fields, nesting_rules, common_parents, display_order)
VALUES (
    'MedicalBusiness',
    'Schema for medical practices, clinics, med spas',
    '["@type", "@id", "name", "url", "telephone", "email", "priceRange", "openingHours"]'::jsonb,
    ARRAY['name', 'url'],
    ARRAY['telephone', 'email', 'priceRange', 'openingHours', 'image', 'logo'],
    '{"address": "PostalAddress", "geo": "GeoCoordinates", "areaServed": "Place"}'::jsonb,
    ARRAY['MedicalProcedure', 'Physician', 'BlogPosting'],
    2
) ON CONFLICT (schema_type) DO UPDATE SET
    description = EXCLUDED.description,
    base_fields = EXCLUDED.base_fields,
    required_fields = EXCLUDED.required_fields,
    optional_fields = EXCLUDED.optional_fields,
    nesting_rules = EXCLUDED.nesting_rules,
    common_parents = EXCLUDED.common_parents;

-- Physician Template
INSERT INTO schema_templates (schema_type, description, base_fields, required_fields, optional_fields, nesting_rules, extraction_prompt, display_order)
VALUES (
    'Physician',
    'Schema for doctors, physicians, medical directors',
    '["@type", "@id", "name", "url", "description", "image", "jobTitle", "honorificSuffix", "knowsAbout"]'::jsonb,
    ARRAY['name', 'url'],
    ARRAY['image', 'jobTitle', 'honorificSuffix', 'knowsAbout', 'alumniOf', 'medicalSpecialty'],
    '{"worksFor": "MedicalBusiness", "alumniOf": "EducationalOrganization"}'::jsonb,
    'Analyze this staff member profile page and extract information.

PAGE CONTENT:
{{content}}

Extract the following (respond ONLY with valid JSON, no markdown):
{
  "name": "Full name of the person (e.g., ''Dr. John Smith'' or ''Jane Doe, RN'')",
  "jobTitle": "Their job title (e.g., ''Medical Director'', ''Lead Esthetician'', ''PA-C'')",
  "credentials": "Professional credentials/suffixes (e.g., ''MD'', ''PA-C'', ''RN'', ''NP-C'')",
  "isPhysician": true if they are a Doctor/MD/DO/Physician, false otherwise,
  "specialties": ["Array of specialties or areas of expertise mentioned"],
  "education": "Educational institution mentioned (or null if not found)"
}

Return null for any field not explicitly mentioned on the page.',
    3
) ON CONFLICT (schema_type) DO UPDATE SET
    description = EXCLUDED.description,
    base_fields = EXCLUDED.base_fields,
    required_fields = EXCLUDED.required_fields,
    optional_fields = EXCLUDED.optional_fields,
    nesting_rules = EXCLUDED.nesting_rules,
    extraction_prompt = EXCLUDED.extraction_prompt;

-- Person Template (non-physician staff)
INSERT INTO schema_templates (schema_type, description, base_fields, required_fields, optional_fields, nesting_rules, display_order)
VALUES (
    'Person',
    'Schema for non-physician team members (nurses, estheticians, admin staff)',
    '["@type", "@id", "name", "url", "description", "image", "jobTitle", "knowsAbout"]'::jsonb,
    ARRAY['name', 'url'],
    ARRAY['image', 'jobTitle', 'knowsAbout', 'alumniOf'],
    '{"worksFor": "MedicalBusiness", "alumniOf": "EducationalOrganization"}'::jsonb,
    4
) ON CONFLICT (schema_type) DO UPDATE SET
    description = EXCLUDED.description,
    base_fields = EXCLUDED.base_fields,
    required_fields = EXCLUDED.required_fields,
    optional_fields = EXCLUDED.optional_fields,
    nesting_rules = EXCLUDED.nesting_rules;

-- BlogPosting Template
INSERT INTO schema_templates (schema_type, description, base_fields, required_fields, optional_fields, nesting_rules, display_order)
VALUES (
    'BlogPosting',
    'Schema for blog posts, articles, resources',
    '["@type", "headline", "description", "url", "datePublished", "dateModified", "image", "wordCount"]'::jsonb,
    ARRAY['headline', 'url', 'datePublished'],
    ARRAY['description', 'dateModified', 'image', 'wordCount', 'keywords'],
    '{"author": "Person", "publisher": "Organization"}'::jsonb,
    5
) ON CONFLICT (schema_type) DO UPDATE SET
    description = EXCLUDED.description,
    base_fields = EXCLUDED.base_fields,
    required_fields = EXCLUDED.required_fields,
    optional_fields = EXCLUDED.optional_fields,
    nesting_rules = EXCLUDED.nesting_rules;

-- ImageGallery Template
INSERT INTO schema_templates (schema_type, description, base_fields, required_fields, optional_fields, display_order)
VALUES (
    'ImageGallery',
    'Schema for before/after galleries, photo collections',
    '["@type", "name", "description", "url"]'::jsonb,
    ARRAY['name', 'url'],
    ARRAY['description', 'image'],
    6
) ON CONFLICT (schema_type) DO UPDATE SET
    description = EXCLUDED.description,
    base_fields = EXCLUDED.base_fields,
    required_fields = EXCLUDED.required_fields,
    optional_fields = EXCLUDED.optional_fields;

-- PostalAddress Template
INSERT INTO schema_templates (schema_type, description, base_fields, required_fields, optional_fields, common_parents, display_order)
VALUES (
    'PostalAddress',
    'Schema for physical addresses',
    '["@type", "streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry"]'::jsonb,
    ARRAY['streetAddress', 'addressLocality', 'addressRegion'],
    ARRAY['postalCode', 'addressCountry'],
    ARRAY['MedicalBusiness', 'LocalBusiness', 'Organization'],
    7
) ON CONFLICT (schema_type) DO UPDATE SET
    description = EXCLUDED.description,
    base_fields = EXCLUDED.base_fields,
    required_fields = EXCLUDED.required_fields,
    optional_fields = EXCLUDED.optional_fields,
    common_parents = EXCLUDED.common_parents;

-- GeoCoordinates Template
INSERT INTO schema_templates (schema_type, description, base_fields, required_fields, common_parents, display_order)
VALUES (
    'GeoCoordinates',
    'Schema for latitude/longitude coordinates',
    '["@type", "latitude", "longitude"]'::jsonb,
    ARRAY['latitude', 'longitude'],
    ARRAY['MedicalBusiness', 'LocalBusiness', 'Place'],
    8
) ON CONFLICT (schema_type) DO UPDATE SET
    description = EXCLUDED.description,
    base_fields = EXCLUDED.base_fields,
    required_fields = EXCLUDED.required_fields,
    common_parents = EXCLUDED.common_parents;

-- BreadcrumbList Template  
INSERT INTO schema_templates (schema_type, description, base_fields, required_fields, nesting_rules, display_order)
VALUES (
    'BreadcrumbList',
    'Schema for navigation breadcrumbs',
    '["@type", "itemListElement"]'::jsonb,
    ARRAY['itemListElement'],
    '{"itemListElement": "ListItem"}'::jsonb,
    9
) ON CONFLICT (schema_type) DO UPDATE SET
    description = EXCLUDED.description,
    base_fields = EXCLUDED.base_fields,
    required_fields = EXCLUDED.required_fields,
    nesting_rules = EXCLUDED.nesting_rules;

-- FAQPage Template
INSERT INTO schema_templates (schema_type, description, base_fields, required_fields, nesting_rules, extraction_prompt, display_order)
VALUES (
    'FAQPage',
    'Schema for FAQ pages or pages with Q&A content',
    '["@type", "mainEntity"]'::jsonb,
    ARRAY['mainEntity'],
    '{"mainEntity": "Question"}'::jsonb,
    'Extract FAQ questions and answers from this page.

PAGE CONTENT:
{{content}}

Return as JSON array:
{
  "questions": [
    {"question": "Question text?", "answer": "Answer text"}
  ]
}

Only extract actual FAQ content, not random text. Return empty array if no FAQs found.',
    10
) ON CONFLICT (schema_type) DO UPDATE SET
    description = EXCLUDED.description,
    base_fields = EXCLUDED.base_fields,
    required_fields = EXCLUDED.required_fields,
    nesting_rules = EXCLUDED.nesting_rules,
    extraction_prompt = EXCLUDED.extraction_prompt;

-- Service Template
INSERT INTO schema_templates (schema_type, description, base_fields, required_fields, optional_fields, nesting_rules, display_order)
VALUES (
    'Service',
    'Schema for general services offered',
    '["@type", "@id", "name", "description", "url", "serviceType", "areaServed"]'::jsonb,
    ARRAY['name', 'url'],
    ARRAY['description', 'serviceType', 'areaServed', 'provider'],
    '{"provider": "Organization", "areaServed": "Place"}'::jsonb,
    11
) ON CONFLICT (schema_type) DO UPDATE SET
    description = EXCLUDED.description,
    base_fields = EXCLUDED.base_fields,
    required_fields = EXCLUDED.required_fields,
    optional_fields = EXCLUDED.optional_fields,
    nesting_rules = EXCLUDED.nesting_rules;

-- ============================================
-- Also add extraction prompts to prompts table
-- ============================================

-- Procedure Field Extraction Prompt
INSERT INTO prompts (name, description, system_prompt, user_prompt_template)
VALUES (
    'Schema: Procedure Field Extraction',
    'Extract procedure-specific schema fields from page content',
    'You are an expert at extracting structured data from medical/aesthetic procedure pages. Extract only information that is explicitly stated on the page. Return null for any field not found.',
    'Analyze this medical/aesthetic procedure page and extract schema.org fields.

PAGE CONTENT:
Title: {{title}}
Description: {{description}}
Content: {{content}}

Extract the following (respond ONLY with valid JSON, no markdown):
{
  "bodyLocation": "The primary body part treated (e.g., ''Face'', ''Nose'', ''Lips'', ''Forehead'', ''Neck'', ''Eyelids'', etc.) or null if unclear",
  "procedureType": "One of: ''NoninvasiveProcedure'' (injections, lasers, peels), ''SurgicalProcedure'' (incisions, surgery), ''PercutaneousProcedure'' (catheter-based), or null if unclear",
  "howPerformed": "A 1-2 sentence summary of how this procedure is performed. Return null if the page doesn''t describe procedure steps.",
  "preparation": "Pre-procedure instructions mentioned on the page. Return null if page doesn''t mention preparation.",
  "followup": "Post-procedure expectations mentioned on the page. Return null if page doesn''t mention followup/recovery."
}

CRITICAL: Only include information that is explicitly stated on the page. Return null for any field where the page does not provide that information.'
) ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    system_prompt = EXCLUDED.system_prompt,
    user_prompt_template = EXCLUDED.user_prompt_template;

-- Team Member Field Extraction Prompt
INSERT INTO prompts (name, description, system_prompt, user_prompt_template)
VALUES (
    'Schema: Team Member Extraction',
    'Extract team member/staff schema fields from profile pages',
    'You are an expert at extracting structured data from staff profile pages. Extract only information that is explicitly stated on the page. Return null for any field not found.',
    'Analyze this staff member profile page and extract information.

PAGE CONTENT:
Title: {{title}}
Description: {{description}}
Content: {{content}}

Extract the following (respond ONLY with valid JSON, no markdown):
{
  "name": "Full name of the person (e.g., ''Dr. John Smith'' or ''Jane Doe, RN'')",
  "jobTitle": "Their job title (e.g., ''Medical Director'', ''Lead Esthetician'', ''PA-C'')",
  "credentials": "Professional credentials/suffixes (e.g., ''MD'', ''PA-C'', ''RN'', ''NP-C'')",
  "isPhysician": true if they are a Doctor/MD/DO/Physician, false otherwise,
  "specialties": ["Array of specialties or areas of expertise mentioned"],
  "education": "Educational institution mentioned (or null if not found)"
}

Return null for any field not explicitly mentioned on the page.'
) ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    system_prompt = EXCLUDED.system_prompt,
    user_prompt_template = EXCLUDED.user_prompt_template;

-- FAQ Extraction Prompt
INSERT INTO prompts (name, description, system_prompt, user_prompt_template)
VALUES (
    'Schema: FAQ Extraction',
    'Extract FAQ content from pages for FAQPage schema',
    'You are an expert at identifying FAQ content on web pages. Extract question/answer pairs that represent genuine FAQs or Q&A content.',
    'Extract FAQ questions and answers from this page.

PAGE CONTENT:
{{content}}

Return as JSON:
{
  "questions": [
    {"question": "Question text?", "answer": "Answer text"}
  ]
}

Guidelines:
- Only extract actual FAQ content or explicit Q&A sections
- Do not create questions from regular content
- Return empty array if no FAQs found
- Keep answers concise but complete'
) ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    system_prompt = EXCLUDED.system_prompt,
    user_prompt_template = EXCLUDED.user_prompt_template;

-- Full Schema Generation Prompt (new LLM-based approach)
INSERT INTO prompts (name, description, system_prompt, user_prompt_template)
VALUES (
    'Schema: Full JSON-LD Generation',
    'Generate complete JSON-LD schema markup using templates and linked schemas',
    'You are an expert at generating JSON-LD schema markup for healthcare/medical websites. Your task is to generate complete, valid schema.org JSON-LD that will enhance search visibility and enable rich results.

Follow these rules:
1. Always use @graph format for multiple schemas
2. Use @id references to link related entities
3. Include all required fields, omit optional fields if data unavailable
4. Nest related schemas (e.g., provider inside MedicalProcedure)
5. Use proper schema.org types and properties
6. Generate realistic, SEO-optimized content based on page data',
    'Generate JSON-LD schema markup for this page.

PAGE TYPE: {{pageType}}
PAGE URL: {{pageUrl}}
SITE URL: {{siteUrl}}

PAGE DATA:
Title: {{title}}
Description: {{description}}
Content Preview: {{contentPreview}}

SITE PROFILE:
{{siteProfile}}

LINKED SCHEMAS TO INCLUDE:
{{linkedSchemas}}

TEMPLATE STRUCTURE:
{{template}}

Generate a complete @graph array with all linked schemas properly nested. Return ONLY valid JSON, no markdown code blocks.'
) ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    system_prompt = EXCLUDED.system_prompt,
    user_prompt_template = EXCLUDED.user_prompt_template;
