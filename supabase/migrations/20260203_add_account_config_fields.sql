-- Add schema-related fields to accounts table for client configuration

-- Provider/business identity fields
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS provider_name TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS legal_name TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS business_type TEXT DEFAULT 'MedicalBusiness';

-- Contact defaults
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS default_phone TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS default_email TEXT;

-- Branding
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Add comments for clarity
COMMENT ON COLUMN accounts.provider_name IS 'Business name used in schema.org markup';
COMMENT ON COLUMN accounts.legal_name IS 'Legal entity name (e.g., LLC name)';
COMMENT ON COLUMN accounts.business_type IS 'Schema.org LocalBusiness subtype';
COMMENT ON COLUMN accounts.default_phone IS 'Default phone for schemas';
COMMENT ON COLUMN accounts.default_email IS 'Default email for schemas';
COMMENT ON COLUMN accounts.logo_url IS 'Logo URL for Organization/LocalBusiness schemas';
