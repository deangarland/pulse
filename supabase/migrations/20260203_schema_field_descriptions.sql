-- Migration: Enhanced data_sources structure with descriptions
-- Each field now has: source, table, column, required, description

-- Update MedicalProcedure with full field descriptions
UPDATE schema_templates
SET data_sources = '{
  "name": {
    "source": "page",
    "table": "page_index",
    "column": "title",
    "required": true,
    "description": "The name of the medical procedure (e.g., Botox Injections, Rhinoplasty)"
  },
  "description": {
    "source": "page",
    "table": "page_index",
    "column": "meta_tags.description",
    "required": true,
    "description": "A brief description of what this procedure does and its benefits"
  },
  "url": {
    "source": "page",
    "table": "page_index",
    "column": "url",
    "required": true,
    "description": "The canonical URL of this procedure page"
  },
  "image": {
    "source": "page",
    "table": "page_index",
    "column": "meta_tags.og:image",
    "required": false,
    "description": "Featured image for this procedure (og:image or hero image)"
  },
  "provider": {
    "source": "site",
    "table": "site_profile",
    "column": "business_name",
    "required": true,
    "description": "The medical practice or clinic offering this procedure"
  },
  "performedBy": {
    "source": "site",
    "table": "site_profile",
    "column": "owner.name",
    "required": false,
    "description": "The physician or practitioner who performs this procedure"
  },
  "bodyLocation": {
    "source": "llm",
    "extraction": "dynamic",
    "required": false,
    "description": "The body part treated (e.g., Face, Lips, Nose, Abdomen)"
  },
  "procedureType": {
    "source": "llm",
    "extraction": "dynamic",
    "required": false,
    "description": "NoninvasiveProcedure (injections, lasers) or SurgicalProcedure (incisions)"
  },
  "howPerformed": {
    "source": "llm",
    "extraction": "dynamic",
    "required": false,
    "description": "Brief explanation of how the procedure is performed"
  },
  "preparation": {
    "source": "llm",
    "extraction": "dynamic",
    "required": false,
    "description": "Pre-procedure patient instructions (e.g., avoid blood thinners)"
  },
  "followup": {
    "source": "llm",
    "extraction": "dynamic",
    "required": false,
    "description": "Recovery expectations and results timeline"
  }
}'::jsonb
WHERE schema_type = 'MedicalProcedure';

-- Update BlogPosting with full field descriptions
UPDATE schema_templates
SET data_sources = '{
  "headline": {
    "source": "page",
    "table": "page_index",
    "column": "title",
    "required": true,
    "description": "The article headline/title"
  },
  "description": {
    "source": "page",
    "table": "page_index",
    "column": "meta_tags.description",
    "required": true,
    "description": "Brief summary of the article content"
  },
  "url": {
    "source": "page",
    "table": "page_index",
    "column": "url",
    "required": true,
    "description": "The canonical URL of this blog post"
  },
  "datePublished": {
    "source": "page",
    "table": "page_index",
    "column": "meta_tags.article:published_time",
    "required": true,
    "description": "When the article was first published (ISO 8601 format)"
  },
  "dateModified": {
    "source": "page",
    "table": "page_index",
    "column": "meta_tags.article:modified_time",
    "required": false,
    "description": "When the article was last updated"
  },
  "author": {
    "source": "site",
    "table": "site_profile",
    "column": "owner.name",
    "required": true,
    "description": "The author of the article (important for E-E-A-T)"
  },
  "publisher": {
    "source": "site",
    "table": "site_profile",
    "column": "business_name",
    "required": true,
    "description": "The organization publishing the content"
  },
  "image": {
    "source": "page",
    "table": "page_index",
    "column": "meta_tags.og:image",
    "required": false,
    "description": "Featured image for the article"
  }
}'::jsonb
WHERE schema_type = 'BlogPosting';

-- Update LocalBusiness with full field descriptions
UPDATE schema_templates
SET data_sources = '{
  "name": {
    "source": "location",
    "table": "locations",
    "column": "name",
    "required": true,
    "description": "Business name for this location"
  },
  "telephone": {
    "source": "location",
    "table": "locations",
    "column": "phone",
    "required": true,
    "description": "Phone number for this location"
  },
  "address": {
    "source": "location",
    "table": "locations",
    "column": "address",
    "required": true,
    "description": "Full street address (street, city, state, zip)"
  },
  "geo": {
    "source": "location",
    "table": "locations",
    "column": "geo",
    "required": false,
    "description": "Latitude and longitude coordinates"
  },
  "openingHours": {
    "source": "location",
    "table": "locations",
    "column": "hours",
    "required": false,
    "description": "Business hours for this location"
  },
  "areaServed": {
    "source": "location",
    "table": "locations",
    "column": "areas_served",
    "required": false,
    "description": "Cities/regions this location serves"
  },
  "aggregateRating": {
    "source": "location",
    "table": "locations",
    "column": "rating",
    "required": false,
    "description": "Average rating and review count"
  }
}'::jsonb
WHERE schema_type = 'LocalBusiness';

-- Update Physician with full field descriptions  
UPDATE schema_templates
SET data_sources = '{
  "name": {
    "source": "llm",
    "extraction": "from_page",
    "required": true,
    "description": "Full name of the physician (e.g., Dr. John Smith, MD)"
  },
  "jobTitle": {
    "source": "llm",
    "extraction": "from_page",
    "required": false,
    "description": "Professional title (e.g., Medical Director, Plastic Surgeon)"
  },
  "credentials": {
    "source": "llm",
    "extraction": "from_page",
    "required": false,
    "description": "Professional credentials and suffixes (e.g., MD, FACS, PA-C)"
  },
  "worksFor": {
    "source": "site",
    "table": "site_profile",
    "column": "business_name",
    "required": true,
    "description": "The medical practice where they work"
  },
  "knowsAbout": {
    "source": "llm",
    "extraction": "from_page",
    "required": false,
    "description": "Areas of expertise and specialties"
  },
  "alumniOf": {
    "source": "llm",
    "extraction": "from_page",
    "required": false,
    "description": "Educational institution (medical school, residency)"
  },
  "image": {
    "source": "page",
    "table": "page_index",
    "column": "meta_tags.og:image",
    "required": false,
    "description": "Professional headshot photograph"
  }
}'::jsonb
WHERE schema_type = 'Physician';

-- Update MedicalBusiness (homepage) with full field descriptions
UPDATE schema_templates
SET data_sources = '{
  "name": {
    "source": "site",
    "table": "site_profile",
    "column": "business_name",
    "required": true,
    "description": "Official business name of the medical practice"
  },
  "url": {
    "source": "site",
    "table": "site_index",
    "column": "site_url",
    "required": true,
    "description": "Homepage URL of the practice website"
  },
  "description": {
    "source": "site",
    "table": "site_profile",
    "column": "description",
    "required": false,
    "description": "Brief description of the practice and services"
  },
  "telephone": {
    "source": "site",
    "table": "site_profile",
    "column": "phone",
    "required": true,
    "description": "Main phone number"
  },
  "address": {
    "source": "site",
    "table": "site_profile",
    "column": "address",
    "required": true,
    "description": "Primary business address"
  },
  "logo": {
    "source": "site",
    "table": "site_profile",
    "column": "logo_url",
    "required": false,
    "description": "Business logo image URL"
  },
  "sameAs": {
    "source": "site",
    "table": "site_profile",
    "column": "social_media",
    "required": false,
    "description": "Social media profile URLs"
  }
}'::jsonb
WHERE schema_type = 'MedicalBusiness';
