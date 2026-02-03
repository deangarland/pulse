-- Migration: Add data_sources to schema_templates and create page_schemas table
-- Purpose: Enable data-driven schema generation with field-to-table mappings

-- ============================================
-- 1. Add data_sources column to schema_templates
-- ============================================
ALTER TABLE schema_templates
ADD COLUMN IF NOT EXISTS data_sources JSONB DEFAULT '{}';

COMMENT ON COLUMN schema_templates.data_sources IS 
'Maps schema fields to database tables/columns. Example: {"telephone": {"table": "locations", "field": "phone"}}';

-- ============================================
-- 2. Create page_schemas table for individual schema storage
-- ============================================
CREATE TABLE IF NOT EXISTS page_schemas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id UUID NOT NULL REFERENCES page_index(id) ON DELETE CASCADE,
    schema_type TEXT NOT NULL,              -- e.g., "MedicalProcedure", "FAQPage"
    schema_json JSONB NOT NULL,             -- The individual schema object
    generation_method TEXT DEFAULT 'template', -- "template", "llm", "hybrid", "manual"
    is_valid BOOLEAN DEFAULT true,
    validation_errors JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Ensure one schema type per page
    UNIQUE(page_id, schema_type)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_page_schemas_page_id ON page_schemas(page_id);
CREATE INDEX IF NOT EXISTS idx_page_schemas_type ON page_schemas(schema_type);
CREATE INDEX IF NOT EXISTS idx_page_schemas_valid ON page_schemas(is_valid);

-- Enable RLS
ALTER TABLE page_schemas ENABLE ROW LEVEL SECURITY;

-- Allow access based on page ownership (inherits from page_index)
CREATE POLICY "Allow all access to page_schemas" ON page_schemas
    FOR ALL USING (true) WITH CHECK (true);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_page_schemas_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER page_schemas_updated_at
    BEFORE UPDATE ON page_schemas
    FOR EACH ROW
    EXECUTE FUNCTION update_page_schemas_updated_at();

-- ============================================
-- 3. Populate data_sources for existing templates
-- ============================================

-- MedicalProcedure: most fields from page + site_profile
UPDATE schema_templates SET data_sources = '{
    "name": {"source": "page", "field": "title", "transform": "extractTitle"},
    "description": {"source": "page", "field": "meta_tags.description"},
    "url": {"source": "computed", "template": "{{siteUrl}}{{page.path}}"},
    "image": {"source": "page", "field": "meta_tags.og:image", "fallback": "site_profile.image_url"},
    "provider.name": {"source": "site_profile", "field": "business_name", "required": true},
    "provider.telephone": {"source": "locations", "field": "phone", "fallback": "site_profile.phone"},
    "provider.address": {"source": "locations", "transform": "buildPostalAddress"},
    "performedBy.name": {"source": "site_profile", "field": "owner.name"},
    "performedBy.url": {"source": "site_profile", "field": "owner.url", "prefix": "{{siteUrl}}"}
}'::jsonb
WHERE schema_type = 'MedicalProcedure';

-- MedicalBusiness/LocalBusiness: heavily uses locations table
UPDATE schema_templates SET data_sources = '{
    "name": {"source": "site_profile", "field": "business_name", "required": true},
    "url": {"source": "site_index", "field": "url"},
    "telephone": {"source": "locations", "field": "phone", "fallback": "site_profile.phone", "required": true},
    "email": {"source": "site_profile", "field": "email"},
    "address": {"source": "locations", "transform": "buildPostalAddress", "required": true},
    "geo": {"source": "locations", "fields": ["lat", "lng"], "transform": "buildGeoCoordinates"},
    "openingHoursSpecification": {"source": "locations", "field": "hours", "transform": "buildHoursSpec"},
    "priceRange": {"source": "site_profile", "field": "price_range"},
    "image": {"source": "site_profile", "field": "image_url"},
    "logo": {"source": "site_profile", "field": "logo_url"},
    "aggregateRating": {"source": "site_profile", "field": "rating", "transform": "buildAggregateRating"}
}'::jsonb
WHERE schema_type = 'MedicalBusiness';

-- Physician: uses owner data + LLM extraction
UPDATE schema_templates SET data_sources = '{
    "name": {"source": "llm_extract", "field": "name", "required": true},
    "url": {"source": "computed", "template": "{{siteUrl}}{{page.path}}"},
    "image": {"source": "page", "field": "meta_tags.og:image"},
    "jobTitle": {"source": "llm_extract", "field": "jobTitle"},
    "honorificSuffix": {"source": "llm_extract", "field": "credentials"},
    "knowsAbout": {"source": "llm_extract", "field": "specialties"},
    "worksFor.name": {"source": "site_profile", "field": "business_name"},
    "worksFor.telephone": {"source": "site_profile", "field": "phone"}
}'::jsonb
WHERE schema_type = 'Physician';

-- BlogPosting: mostly from page data
UPDATE schema_templates SET data_sources = '{
    "headline": {"source": "page", "field": "title", "required": true},
    "description": {"source": "page", "field": "meta_tags.description"},
    "url": {"source": "computed", "template": "{{siteUrl}}{{page.path}}", "required": true},
    "datePublished": {"source": "page", "field": "meta_tags.article:published_time", "fallback": "crawled_at"},
    "dateModified": {"source": "page", "field": "meta_tags.article:modified_time"},
    "image": {"source": "page", "field": "meta_tags.og:image"},
    "author.name": {"source": "site_profile", "field": "owner.name", "fallback": "business_name"},
    "publisher.name": {"source": "site_profile", "field": "business_name"},
    "publisher.logo": {"source": "site_profile", "field": "logo_url"}
}'::jsonb
WHERE schema_type = 'BlogPosting';

-- FAQPage: extracted from page content
UPDATE schema_templates SET data_sources = '{
    "mainEntity": {"source": "dom_extract", "selector": "faq", "transform": "buildFAQItems", "required": true}
}'::jsonb
WHERE schema_type = 'FAQPage';

-- ImageGallery: from page
UPDATE schema_templates SET data_sources = '{
    "name": {"source": "page", "field": "title", "required": true},
    "description": {"source": "page", "field": "meta_tags.description"},
    "url": {"source": "computed", "template": "{{siteUrl}}{{page.path}}"}
}'::jsonb
WHERE schema_type = 'ImageGallery';

-- PostalAddress: from locations table
UPDATE schema_templates SET data_sources = '{
    "streetAddress": {"source": "locations", "field": "address_line1", "required": true},
    "addressLocality": {"source": "locations", "field": "city", "required": true},
    "addressRegion": {"source": "locations", "field": "state", "required": true},
    "postalCode": {"source": "locations", "field": "zip"},
    "addressCountry": {"source": "locations", "field": "country", "default": "US"}
}'::jsonb
WHERE schema_type = 'PostalAddress';

-- GeoCoordinates: from locations table
UPDATE schema_templates SET data_sources = '{
    "latitude": {"source": "locations", "field": "lat", "required": true},
    "longitude": {"source": "locations", "field": "lng", "required": true}
}'::jsonb
WHERE schema_type = 'GeoCoordinates';
