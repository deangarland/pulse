-- Migration: Move SCHEMA_VALUE_TIERS from code to database
-- Adds tier column and ensures all page types have entries

-- ============================================
-- 1. Add tier and reason columns to schema_templates
-- ============================================
ALTER TABLE schema_templates
ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'LOW' CHECK (tier IN ('HIGH', 'MEDIUM', 'LOW'));

ALTER TABLE schema_templates
ADD COLUMN IF NOT EXISTS tier_reason TEXT;

-- Add page_type column to map page types (from classifier) to schema types
ALTER TABLE schema_templates
ADD COLUMN IF NOT EXISTS page_type TEXT;

COMMENT ON COLUMN schema_templates.tier IS 'Generation priority: HIGH=auto-generate, MEDIUM=on-request, LOW=skip';
COMMENT ON COLUMN schema_templates.page_type IS 'Page classifier type that maps to this schema (e.g., PROCEDURE, RESOURCE)';

-- ============================================
-- 2. Update existing entries with tier data
-- ============================================

-- HIGH tier - Auto-generate
UPDATE schema_templates SET tier = 'HIGH', tier_reason = 'Core service pages, procedure rich results, FAQs', page_type = 'PROCEDURE'
WHERE schema_type = 'MedicalProcedure';

UPDATE schema_templates SET tier = 'HIGH', tier_reason = 'Article rich results, freshness signals, author credibility', page_type = 'RESOURCE'
WHERE schema_type = 'BlogPosting';

UPDATE schema_templates SET tier = 'HIGH', tier_reason = 'E-E-A-T signals, medical expertise, trust', page_type = 'TEAM_MEMBER'
WHERE schema_type = 'Physician';

UPDATE schema_templates SET tier = 'HIGH', tier_reason = 'Image search visibility, social proof', page_type = 'GALLERY'
WHERE schema_type = 'ImageGallery';

UPDATE schema_templates SET tier = 'HIGH', tier_reason = 'Foundation NAP schema, reviews, hours', page_type = 'HOMEPAGE'
WHERE schema_type = 'MedicalBusiness';

-- ============================================
-- 3. Insert missing page type entries
-- ============================================

-- HIGH tier entries
INSERT INTO schema_templates (schema_type, page_type, tier, tier_reason, base_fields, required_fields)
VALUES 
    ('ContactPage', 'CONTACT', 'HIGH', 'NAP consistency, contact information rich results', 
     '{"@type": "ContactPage"}', ARRAY['name', 'telephone', 'address']),
    ('LocalBusiness', 'LOCATION', 'HIGH', 'Local SEO, NAP for each location, Google Business Profile alignment',
     '{"@type": "LocalBusiness"}', ARRAY['name', 'telephone', 'address', 'geo'])
ON CONFLICT (schema_type) DO UPDATE SET
    page_type = EXCLUDED.page_type,
    tier = EXCLUDED.tier,
    tier_reason = EXCLUDED.tier_reason;

-- MEDIUM tier entries
INSERT INTO schema_templates (schema_type, page_type, tier, tier_reason, base_fields, required_fields)
VALUES 
    ('MedicalCondition', 'CONDITION', 'MEDIUM', 'Health queries, but limited Google rich result support',
     '{"@type": "MedicalCondition"}', ARRAY['name', 'description']),
    ('Product', 'PRODUCT', 'MEDIUM', 'E-commerce rich results, but complex pricing/availability',
     '{"@type": "Product"}', ARRAY['name', 'offers']),
    ('ItemList', 'PRODUCT_COLLECTION', 'MEDIUM', 'Collection pages, products have individual schema',
     '{"@type": "ItemList"}', ARRAY['name', 'itemListElement'])
ON CONFLICT (schema_type) DO UPDATE SET
    page_type = EXCLUDED.page_type,
    tier = EXCLUDED.tier,
    tier_reason = EXCLUDED.tier_reason;

-- LOW tier entries (no schema generation needed)
INSERT INTO schema_templates (schema_type, page_type, tier, tier_reason, base_fields, required_fields)
VALUES 
    ('SKIP_SERVICE_INDEX', 'SERVICE_INDEX', 'LOW', 'Listing page, individual procedures have the value', '{}', ARRAY[]::text[]),
    ('SKIP_BODY_AREA', 'BODY_AREA', 'LOW', 'Grouping page, link to procedures/conditions instead', '{}', ARRAY[]::text[]),
    ('SKIP_RESOURCE_INDEX', 'RESOURCE_INDEX', 'LOW', 'Blog archive/tags, no unique content to schema', '{}', ARRAY[]::text[]),
    ('SKIP_UTILITY', 'UTILITY', 'LOW', 'Cart, account, search - no content value', '{}', ARRAY[]::text[]),
    ('SKIP_MEMBERSHIP', 'MEMBERSHIP', 'LOW', 'Pricing pages too variable for schema', '{}', ARRAY[]::text[]),
    ('SKIP_ABOUT', 'ABOUT', 'LOW', 'AboutPage schema has minimal SEO value', '{}', ARRAY[]::text[]),
    ('SKIP_GENERIC', 'GENERIC', 'LOW', 'Catch-all, no predictable schema type', '{}', ARRAY[]::text[])
ON CONFLICT (schema_type) DO UPDATE SET
    page_type = EXCLUDED.page_type,
    tier = EXCLUDED.tier,
    tier_reason = EXCLUDED.tier_reason;

-- ============================================
-- 4. Create index for page_type lookups
-- ============================================
CREATE INDEX IF NOT EXISTS idx_schema_templates_page_type ON schema_templates(page_type);
CREATE INDEX IF NOT EXISTS idx_schema_templates_tier ON schema_templates(tier);
