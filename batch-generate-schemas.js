#!/usr/bin/env node
/**
 * Batch Schema Generator
 * Generates schemas for pages that have already been classified.
 * Run classify-pages.js FIRST to set page types.
 * 
 * Usage:
 *   node batch-generate-schemas.js --site=ID          # Generate schemas for classified pages
 *   node batch-generate-schemas.js --site=ID --status # Show progress stats
 *   node batch-generate-schemas.js --site=ID --retry  # Retry needs_review pages
 */

import { createClient } from '@supabase/supabase-js';
import { load } from 'cheerio';
import OpenAI from 'openai';
import 'dotenv/config';
import { fileURLToPath } from 'url';
import { preflightCheck, savePageSchema, updateCachedSchema } from './schema-utils.js';

// Lazy-initialized clients (created on first use, not at module load)
let _openai = null;
let _supabase = null;

function getOpenAI() {
    if (!_openai) {
        _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return _openai;
}

function getSupabase() {
    if (!_supabase) {
        _supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
        );
    }
    return _supabase;
}

// Legacy aliases for compatibility
const openai = { get chat() { return getOpenAI().chat; } };
const supabase = {
    from: (...args) => getSupabase().from(...args),
    rpc: (...args) => getSupabase().rpc(...args)
};

// Detect if running as CLI (vs being imported as a module)
const isRunningAsCLI = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

// CLI args (only parsed when running as CLI)
let showStatus = false;
let retryFailed = false;
let includeMedium = false;
let SITE_ID = '962ff079-b478-4fa1-b7b9-b97a4cac7307';
let SINGLE_PATH = null;
let BATCH_SIZE = 10;

if (isRunningAsCLI) {
    const args = process.argv.slice(2);
    showStatus = args.includes('--status');
    retryFailed = args.includes('--retry');
    includeMedium = args.includes('--include-medium');
    const siteArg = args.find(a => a.startsWith('--site='));
    const pathArg = args.find(a => a.startsWith('--path='));
    SITE_ID = siteArg ? siteArg.split('=')[1] : SITE_ID;
    SINGLE_PATH = pathArg ? pathArg.split('=')[1] : null;
    BATCH_SIZE = SINGLE_PATH ? 1 : 10;
}

// Valid page types (must be classified first via classify-pages.js)
const VALID_PAGE_TYPES = [
    'HOMEPAGE', 'PROCEDURE', 'SERVICE_INDEX', 'BODY_AREA', 'CONDITION',
    'RESOURCE', 'RESOURCE_INDEX', 'TEAM_MEMBER', 'ABOUT', 'GALLERY',
    'CONTACT', 'LOCATION', 'PRODUCT', 'PRODUCT_COLLECTION',
    'UTILITY', 'MEMBERSHIP', 'GENERIC'
];

// ============================================================
// SCHEMA VALUE TIERS (now loaded from database)
// ============================================================
// Tier data is stored in schema_templates table with:
// - tier: HIGH/MEDIUM/LOW
// - tier_reason: explanation for the tier assignment
// - page_type: maps page classifier type to schema type
// ============================================================

// Cache for tier data (loaded on first use)
let _tierCache = null;
let _tierCacheLoaded = false;

/**
 * Load tier data from database into cache
 */
async function loadTierCache() {
    if (_tierCacheLoaded) return _tierCache;

    const { data, error } = await supabase
        .from('schema_templates')
        .select('schema_type, page_type, tier, tier_reason')
        .not('page_type', 'is', null);

    if (error) {
        console.error('Failed to load tier cache:', error.message);
        _tierCache = {};
    } else {
        _tierCache = {};
        data?.forEach(row => {
            if (row.page_type) {
                _tierCache[row.page_type] = {
                    tier: row.tier || 'LOW',
                    schema: row.schema_type,
                    reason: row.tier_reason
                };
            }
        });
    }
    _tierCacheLoaded = true;
    return _tierCache;
}

/**
 * Get tier for a page type (async - loads from DB on first call)
 */
async function getSchemaValueTier(pageType) {
    const cache = await loadTierCache();
    return cache[pageType]?.tier || 'LOW';
}

/**
 * Get tier info for a page type (includes schema type and reason)
 */
async function getSchemaValueTierInfo(pageType) {
    const cache = await loadTierCache();
    return cache[pageType] || { tier: 'LOW', schema: null, reason: 'Unknown page type' };
}

// Legacy sync version for exports (uses cached data)
function getSchemaValueTierSync(pageType) {
    return _tierCache?.[pageType]?.tier || 'LOW';
}

/**
 * Extract page-level fields using LLM analysis
 * Uses OpenAI GPT-4o-mini to analyze page content and determine:
 * - bodyLocation: What body part is this procedure for?
 * - procedureType: Is this invasive, noninvasive, etc.?
 * - howPerformed: Brief description of how the procedure is done
 * - preparation: Pre-procedure instructions (if mentioned on page)
 * - followup: Post-procedure expectations (if mentioned on page)
 * Returns object with extracted fields (null values if not found on page)
 */
async function extractPageFieldsWithLLM(page) {
    const content = `
Title: ${page.title || ''}
Description: ${page.meta_tags?.description || ''}
Content: ${(page.main_content || '').substring(0, 3000)}
    `.trim();

    const prompt = `Analyze this medical/aesthetic procedure page and extract schema.org fields.

PAGE CONTENT:
${content}

Extract the following (respond ONLY with valid JSON, no markdown):
{
  "bodyLocation": "The primary body part treated (e.g., 'Face', 'Nose', 'Lips', 'Forehead', 'Neck', 'Eyelids', etc.) or null if unclear",
  "procedureType": "One of: 'NoninvasiveProcedure' (injections, lasers, peels), 'SurgicalProcedure' (incisions, surgery), 'PercutaneousProcedure' (catheter-based), or null if unclear",
  "howPerformed": "A 1-2 sentence summary of how this procedure is performed. Return null if the page doesn't describe procedure steps.",
  "preparation": "Pre-procedure instructions mentioned on the page (e.g., 'Avoid blood thinners for 7 days'). Return null if page doesn't mention preparation.",
  "followup": "Post-procedure expectations mentioned on the page (e.g., 'Results last 6-12 months', 'Minimal downtime'). Return null if page doesn't mention followup/recovery."
}

CRITICAL: Only include information that is explicitly stated on the page. Return null for any field where the page does not provide that information.`;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens: 350,
            response_format: { type: 'json_object' }
        });

        const usage = response.usage;
        console.log(`   📊 Tokens: ${usage.prompt_tokens} in, ${usage.completion_tokens} out`);

        const result = JSON.parse(response.choices[0].message.content);
        const normalize = (val) => val === 'null' || val === null || val === '' ? null : val;

        return {
            bodyLocation: normalize(result.bodyLocation),
            procedureType: normalize(result.procedureType),
            howPerformed: normalize(result.howPerformed),
            preparation: normalize(result.preparation),
            followup: normalize(result.followup)
        };
    } catch (error) {
        console.error(`   ⚠️ LLM extraction error: ${error.message}`);
        return { bodyLocation: null, procedureType: null, howPerformed: null, preparation: null, followup: null };
    }
}

// ============================================================
// SCHEMA GENERATORS
// ============================================================

async function generateProcedureSchema(page, siteProfile, siteUrl) {
    // Extract title - only split on pipe (site name separator), not hyphen (part of procedure names)
    const title = page.title?.split('|')[0]?.trim() || page.title?.split(' - ')[0]?.trim() || 'Treatment';
    const desc = page.meta_tags?.description || '';
    const pageUrl = `${siteUrl}${page.path}`;

    // Build Physician schema with full details from site_profile.owner
    const owner = siteProfile?.owner || {};
    const physician = {
        "@type": "Physician",
        "@id": `${siteUrl}/#physician`,
        "name": owner.name,
        "url": owner.url ? `${siteUrl}${owner.url}` : undefined,
        "image": owner.image,
        "knowsAbout": owner.knowsAbout || [],
        "memberOf": (owner.memberOf || []).map(org => ({
            "@type": "Organization",
            "name": org.name,
            "url": org.url
        })),
        "sameAs": siteProfile?.social_media || []
    };

    // Build MedicalBusiness provider with inline details
    const provider = {
        "@type": "MedicalBusiness",
        "@id": `${siteUrl}/#organization`,
        "name": siteProfile?.business_name,
        "url": siteUrl,
        "telephone": siteProfile?.phone,
        "address": siteProfile?.address ? {
            "@type": "PostalAddress",
            "streetAddress": siteProfile.address.street,
            "addressLocality": siteProfile.address.city,
            "addressRegion": siteProfile.address.state,
            "postalCode": siteProfile.address.zip,
            "addressCountry": siteProfile.address.country || "US"
        } : undefined
    };

    // Extract page-level fields using LLM (bodyLocation, procedureType, howPerformed, preparation, followup)
    const extracted = await extractPageFieldsWithLLM(page);

    // Build the base schema
    const schema = {
        "@type": "MedicalProcedure",
        "@id": `${pageUrl}#procedure`,
        "name": title,
        "url": pageUrl,
        "mainEntityOfPage": pageUrl,
        "description": desc,
        // Use page's og:image, fallback to site default
        "image": page.meta_tags?.['og:image'] || siteProfile?.image_url || null,
        "provider": provider,
        "performedBy": physician
    };

    // Only add fields if extracted from real page content by LLM
    if (extracted.procedureType) {
        schema.procedureType = extracted.procedureType;
    }

    if (extracted.bodyLocation) {
        schema.bodyLocation = extracted.bodyLocation;
    }

    if (extracted.preparation) {
        schema.preparation = extracted.preparation;
    }

    if (extracted.howPerformed) {
        schema.howPerformed = extracted.howPerformed;
    }

    if (extracted.followup) {
        schema.followup = extracted.followup;
    }

    // Add relevantSpecialty from site_profile if available
    if (siteProfile?.relevantSpecialty) {
        schema.relevantSpecialty = {
            "@type": "MedicalSpecialty",
            "name": siteProfile.relevantSpecialty
        };
    }

    // Remove null image if no image found
    if (!schema.image) {
        delete schema.image;
    }

    return schema;
}


function generateBlogSchema(page, siteProfile, siteUrl) {
    const title = page.title?.split('|')[0]?.trim() || '';
    const desc = page.meta_tags?.description || '';

    return {
        "@type": "BlogPosting",
        "headline": title,
        "description": desc,
        "url": `${siteUrl}${page.path}`,
        "datePublished": page.meta_tags?.['article:published_time'] || page.meta_tags?.['article:modified_time'] || new Date().toISOString(),
        "dateModified": page.meta_tags?.['article:modified_time'] || new Date().toISOString(),
        "author": {
            "@type": "Physician",
            "name": siteProfile?.owner?.name,
            "@id": `${siteUrl}/#physician`
        },
        "publisher": {
            "@type": "Organization",
            "@id": `${siteUrl}/#organization`
        }
    };
}

function generateGallerySchema(page, siteUrl) {
    const title = page.title?.split('|')[0]?.split('-')[0]?.trim() || 'Gallery';

    return {
        "@type": "ImageGallery",
        "name": `${title} Before & After Gallery`,
        "description": `Before and after photos for ${title}.`,
        "url": `${siteUrl}${page.path}`
    };
}

/**
 * Generate Person/Physician schema for team member profile pages
 */
async function generateTeamMemberSchema(page, siteProfile, siteUrl) {
    const pageUrl = `${siteUrl}${page.path}`;
    const title = page.title?.split('|')[0]?.split('-')[0]?.trim() || '';
    const desc = page.meta_tags?.description || '';

    // Extract name and credentials using LLM
    const extracted = await extractTeamMemberFieldsWithLLM(page);

    const schema = {
        "@type": extracted.isPhysician ? "Physician" : "Person",
        "@id": `${pageUrl}#person`,
        "name": extracted.name || title,
        "url": pageUrl,
        "description": desc,
        "image": page.meta_tags?.['og:image'] || null,
        "worksFor": {
            "@type": "MedicalBusiness",
            "@id": `${siteUrl}/#organization`,
            "name": siteProfile?.business_name
        }
    };

    // Add extracted fields if present
    if (extracted.jobTitle) schema.jobTitle = extracted.jobTitle;
    if (extracted.credentials) schema.honorificSuffix = extracted.credentials;
    if (extracted.specialties?.length > 0) schema.knowsAbout = extracted.specialties;
    if (extracted.education) {
        schema.alumniOf = {
            "@type": "EducationalOrganization",
            "name": extracted.education
        };
    }

    // Remove null image if not found
    if (!schema.image) delete schema.image;

    return schema;
}

/**
 * LLM extraction for team member fields
 */
async function extractTeamMemberFieldsWithLLM(page) {
    const content = `
Title: ${page.title || ''}
Description: ${page.meta_tags?.description || ''}
Content: ${(page.main_content || '').substring(0, 2000)}
    `.trim();

    const prompt = `Analyze this staff member profile page and extract information.

PAGE CONTENT:
${content}

Extract the following (respond ONLY with valid JSON, no markdown):
{
  "name": "Full name of the person (e.g., 'Dr. John Smith' or 'Jane Doe, RN')",
  "jobTitle": "Their job title (e.g., 'Medical Director', 'Lead Esthetician', 'PA-C')",
  "credentials": "Professional credentials/suffixes (e.g., 'MD', 'PA-C', 'RN', 'NP-C')",
  "isPhysician": true if they are a Doctor/MD/DO/Physician, false otherwise,
  "specialties": ["Array of specialties or areas of expertise mentioned"],
  "education": "Educational institution mentioned (or null if not found)"
}

Return null for any field not explicitly mentioned on the page.`;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens: 300,
            response_format: { type: 'json_object' }
        });

        const result = JSON.parse(response.choices[0].message.content);
        const normalize = (val) => val === 'null' || val === null || val === '' ? null : val;

        return {
            name: normalize(result.name),
            jobTitle: normalize(result.jobTitle),
            credentials: normalize(result.credentials),
            isPhysician: result.isPhysician === true,
            specialties: Array.isArray(result.specialties) ? result.specialties.filter(s => s) : [],
            education: normalize(result.education)
        };
    } catch (error) {
        console.error(`   ⚠️ Team member extraction error: ${error.message}`);
        return { name: null, jobTitle: null, credentials: null, isPhysician: false, specialties: [], education: null };
    }
}

// ============================================================
// FAQ EXTRACTION
// ============================================================

function extractFAQs(html, headings) {
    if (!html) return [];

    const $ = load(html);
    const faqs = [];

    // Strategy 1: Elementor toggles
    $('.elementor-toggle-item').each((i, el) => {
        const question = $(el).find('.elementor-toggle-title').text().trim();
        const answer = $(el).find('.elementor-toggle-content, .elementor-tab-content').text().trim();
        if (question && answer && answer.length > 50) {
            faqs.push({
                question: cleanText(question),
                answer: cleanText(answer).substring(0, 500)
            });
        }
    });

    // Strategy 2: Accordion patterns
    if (faqs.length === 0) {
        $('.accordion-item, .faq-item, [class*="accordion"]').each((i, el) => {
            const question = $(el).find('.accordion-header, .accordion-title, h3, h4').first().text().trim();
            const answer = $(el).find('.accordion-body, .accordion-content, .panel-body').text().trim();
            if (question && answer && answer.length > 50) {
                faqs.push({
                    question: cleanText(question),
                    answer: cleanText(answer).substring(0, 500)
                });
            }
        });
    }

    // Strategy 3: Definition list FAQs (dl/dt/dd pattern)
    if (faqs.length === 0) {
        $('dl.flc-faq, dl.faq-list, dl[class*="faq"]').each((i, dl) => {
            $(dl).find('dt').each((j, dt) => {
                const question = $(dt).text().trim();
                const answer = $(dt).next('dd').text().trim();
                if (question && answer && question.length > 10 && answer.length > 50) {
                    faqs.push({
                        question: cleanText(question),
                        answer: truncateAtSentence(cleanText(answer), 500)
                    });
                }
            });
        });
    }

    // Strategy 4: Generic definition lists
    if (faqs.length === 0) {
        $('dl').each((i, dl) => {
            const $dl = $(dl);
            // Only process if it looks like FAQ content
            const dtCount = $dl.find('dt').length;
            if (dtCount >= 3) { // At least 3 Q&A pairs
                $dl.find('dt').each((j, dt) => {
                    const question = $(dt).text().trim();
                    const answer = $(dt).next('dd').text().trim();
                    // Only accept if question ends with ? or contains question words
                    const isQuestion = question.includes('?') ||
                        /^(how|what|why|when|where|who|can|is|are|do|does|will|should)/i.test(question);
                    if (isQuestion && answer && answer.length > 50) {
                        faqs.push({
                            question: cleanText(question),
                            answer: cleanText(answer).substring(0, 500)
                        });
                    }
                });
            }
        });
    }

    return faqs.slice(0, 10); // Limit to 10 FAQs
}

function extractHowPerformed(page) {
    // Try to extract procedure description from content
    const content = page.main_content || '';
    const sentences = content.split(/[.!?]+/);

    // Look for sentences describing the procedure
    const procedureKeywords = ['inject', 'performed', 'procedure', 'treatment', 'takes', 'minutes'];
    for (const sentence of sentences) {
        if (procedureKeywords.some(kw => sentence.toLowerCase().includes(kw)) && sentence.length > 50) {
            return cleanText(sentence.trim()) + '.';
        }
    }
    return null;
}

function cleanText(text) {
    return text.replace(/\s+/g, ' ').trim();
}

function truncateAtSentence(text, maxLen) {
    if (text.length <= maxLen) return text;

    // Find the last sentence boundary before maxLen
    const truncated = text.substring(0, maxLen);
    const lastPeriod = truncated.lastIndexOf('.');
    const lastQuestion = truncated.lastIndexOf('?');
    const lastExclaim = truncated.lastIndexOf('!');
    const lastBoundary = Math.max(lastPeriod, lastQuestion, lastExclaim);

    if (lastBoundary > maxLen * 0.5) {
        return text.substring(0, lastBoundary + 1);
    }
    // If no good boundary, just return truncated (fallback)
    return truncated + '...';
}

// ============================================================
// VALIDATION
// ============================================================

function validateSchema(schemaObj) {
    const errors = [];
    const json = JSON.stringify(schemaObj);

    // Handle @graph wrapper structure
    const schemas = schemaObj?.['@graph'] || (Array.isArray(schemaObj) ? schemaObj : [schemaObj]);

    // Check for placeholders
    const placeholderPatterns = [/\[Extract/i, /\[TODO/i, /\[PLACEHOLDER/i];
    for (const pattern of placeholderPatterns) {
        if (pattern.test(json)) {
            errors.push({ type: 'placeholder', message: 'Contains placeholder text' });
        }
    }

    // Check each schema
    for (const schema of schemas) {
        // Check required fields (skip FAQPage which uses mainEntity instead of name)
        if (schema['@type'] !== 'FAQPage' && !schema.name && !schema.headline) {
            errors.push({ type: 'missing_field', message: `${schema['@type']} missing name/headline` });
        }

        // Check description length
        if (schema.description && schema.description.length < 30) {
            errors.push({ type: 'short_description', message: `${schema['@type']} description too short` });
        }

        // Check FAQ answers
        if (schema['@type'] === 'FAQPage' && schema.mainEntity) {
            schema.mainEntity.forEach((q, i) => {
                const answerLen = q.acceptedAnswer?.text?.length || 0;
                if (answerLen < 50) {
                    errors.push({ type: 'short_faq', message: `FAQ ${i + 1} answer too short (${answerLen} chars)` });
                }
            });
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        status: errors.length === 0 ? 'validated' : 'needs_review'
    };
}

// ============================================================
// LOCAL BUSINESS SCHEMA (Homepage, Contact, Location)
// Multi-location support: Organization + hasPart pattern
// ============================================================

/**
 * Detect if site has multiple locations
 */
function isMultiLocation(siteProfile) {
    return siteProfile?.locations && siteProfile.locations.length > 1;
}

/**
 * Get location data - either by explicit page_id linkage or from flat structure
 * 
 * Priority:
 * 1. Explicit page_id match (user-set linkage - preferred)
 * 2. Fallback to path matching (legacy - will be deprecated)
 * 3. Primary location or first location
 */
function getLocationData(siteProfile, pageId = null, pagePath = null) {
    // Multi-location: find matching location
    if (siteProfile?.locations?.length > 0) {
        // PREFERRED: Explicit page_id linkage (set by user in UI)
        if (pageId) {
            const match = siteProfile.locations.find(loc => loc.page_id === pageId);
            if (match) return match;
        }

        // FALLBACK: Legacy path matching (for backwards compatibility)
        if (pagePath) {
            const match = siteProfile.locations.find(loc =>
                loc.path && (pagePath.includes(loc.path) || loc.path === pagePath)
            );
            if (match) {
                console.log(`   ⚠️  Using legacy path matching for ${pagePath} - set page_id for explicit linkage`);
                return match;
            }
        }

        // Return primary location or first one
        return siteProfile.locations.find(loc => loc.is_primary) || siteProfile.locations[0];
    }

    // Single-location: use flat structure
    return {
        name: siteProfile.business_name,
        address: siteProfile.address,
        phone: siteProfile.phone,
        hours: siteProfile.hours,
        geo: siteProfile.geo,
        areas_served: siteProfile.areas_served,
        rating: siteProfile.rating
    };
}

/**
 * Validate location has required LocalBusiness fields
 */
function validateLocationData(location) {
    const missing = [];

    if (!location?.name && !location?.business_name) missing.push('Location name');
    if (!location?.phone) missing.push('Phone number');
    if (!location?.address?.street || !location?.address?.city) {
        missing.push('Address (street, city, state, zip)');
    }

    return { complete: missing.length === 0, missing };
}

/**
 * Generate Organization schema for multi-location homepage
 * THRESHOLD LOGIC:
 * - 1-10 locations: Inline full LocalBusiness for each location
 * - 10+ locations: Use hasPart references only (avoid JSON-LD bloat)
 */
const INLINE_LOCATION_THRESHOLD = 10;

function generateOrganizationSchema(siteProfile, siteUrl) {
    const schema = {
        "@type": "Organization",
        "@id": `${siteUrl}#organization`,
        "name": siteProfile.business_name,
        "url": siteUrl,
        "description": siteProfile.description || undefined,
        "logo": siteProfile.logo_url || undefined,
        "image": siteProfile.image_url || undefined
    };

    // Add social profiles
    if (siteProfile.social_media?.length > 0) {
        schema.sameAs = siteProfile.social_media;
    }

    // Add founder/owner
    if (siteProfile.owner?.name) {
        schema.founder = {
            "@type": "Person",
            "@id": siteProfile.owner.url ? `${siteUrl}${siteProfile.owner.url}#person` : undefined,
            "name": siteProfile.owner.name,
            "jobTitle": siteProfile.owner.title || "Medical Director"
        };
    }

    // Handle locations based on count threshold
    const locations = siteProfile.locations || [];

    if (locations.length > 0 && locations.length <= INLINE_LOCATION_THRESHOLD) {
        // INLINE: Include full LocalBusiness for each location (2-10 locations)
        schema.hasPart = locations.map((loc, i) => {
            const locationId = `${siteUrl}${loc.path || '/location-' + (i + 1)}#localbusiness`;
            const locSchema = {
                "@type": siteProfile.business_type || "MedicalBusiness",
                "@id": locationId,
                "name": loc.name || siteProfile.business_name,
                "url": loc.path ? `${siteUrl}${loc.path}` : siteUrl,
                "telephone": loc.phone || undefined,
                "parentOrganization": { "@id": `${siteUrl}#organization` }
            };

            // Add address if available
            if (loc.address?.street && loc.address?.city) {
                locSchema.address = {
                    "@type": "PostalAddress",
                    "streetAddress": loc.address.street,
                    "addressLocality": loc.address.city,
                    "addressRegion": loc.address.state,
                    "postalCode": loc.address.zip,
                    "addressCountry": loc.address.country || "US"
                };
            }

            // Add geo if available
            if (loc.geo?.lat && loc.geo?.lng) {
                locSchema.geo = {
                    "@type": "GeoCoordinates",
                    "latitude": parseFloat(loc.geo.lat),
                    "longitude": parseFloat(loc.geo.lng)
                };
            }

            // Add hours if available
            if (loc.hours?.length > 0) {
                locSchema.openingHoursSpecification = loc.hours.map(h => ({
                    "@type": "OpeningHoursSpecification",
                    "dayOfWeek": h.days,
                    "opens": h.open,
                    "closes": h.close
                }));
            }

            // Add areas served if available
            if (loc.areas_served?.length > 0) {
                locSchema.areaServed = loc.areas_served.map(area => ({
                    "@type": "City",
                    "name": area.city || area
                }));
            }

            // Clean undefined values
            Object.keys(locSchema).forEach(key => {
                if (locSchema[key] === undefined) delete locSchema[key];
            });

            return locSchema;
        });
    } else if (locations.length > INLINE_LOCATION_THRESHOLD) {
        // REFERENCE ONLY: For 10+ locations, just link via @id to avoid bloat
        schema.hasPart = locations.map((loc, i) => ({
            "@type": siteProfile.business_type || "MedicalBusiness",
            "@id": `${siteUrl}${loc.path || '/location-' + (i + 1)}#localbusiness`,
            "name": loc.name
        }));
    }

    // Remove undefined values
    Object.keys(schema).forEach(key => {
        if (schema[key] === undefined) delete schema[key];
    });

    return { schema, error: null };
}

/**
 * Generate LocalBusiness schema for a specific location
 */
function generateLocationBusinessSchema(location, siteProfile, siteUrl, locationPath) {
    const validation = validateLocationData(location);

    if (!validation.complete) {
        return {
            schema: null,
            error: `Missing required fields: ${validation.missing.join(', ')}`,
            missingFields: validation.missing
        };
    }

    const addr = location.address;
    const locationId = locationPath ? `${siteUrl}${locationPath}#localbusiness` : `${siteUrl}#localbusiness`;

    const schema = {
        "@type": siteProfile.business_type || "MedicalBusiness",
        "@id": locationId,
        "name": location.name || siteProfile.business_name,
        "url": locationPath ? `${siteUrl}${locationPath}` : siteUrl,
        "telephone": location.phone,

        "address": {
            "@type": "PostalAddress",
            "streetAddress": addr.street,
            "addressLocality": addr.city,
            "addressRegion": addr.state,
            "postalCode": addr.zip,
            "addressCountry": addr.country || "US"
        }
    };

    // Link to parent organization for multi-location
    if (isMultiLocation(siteProfile)) {
        schema.parentOrganization = { "@id": `${siteUrl}#organization` };
    }

    // Add geo coordinates
    if (location.geo?.lat && location.geo?.lng) {
        schema.geo = {
            "@type": "GeoCoordinates",
            "latitude": parseFloat(location.geo.lat),
            "longitude": parseFloat(location.geo.lng)
        };
    }

    // Add opening hours
    if (location.hours?.length > 0) {
        schema.openingHoursSpecification = location.hours.map(h => ({
            "@type": "OpeningHoursSpecification",
            "dayOfWeek": h.days,
            "opens": h.open,
            "closes": h.close
        }));
    }

    // Add aggregate rating
    if (location.rating?.value && location.rating?.count) {
        schema.aggregateRating = {
            "@type": "AggregateRating",
            "ratingValue": location.rating.value,
            "reviewCount": location.rating.count,
            "bestRating": 5
        };
    }

    // Add areas served
    if (location.areas_served?.length > 0) {
        schema.areaServed = location.areas_served.map(area => ({
            "@type": "City",
            "name": area.city || area,
            "containedInPlace": area.state ? { "@type": "State", "name": area.state } : undefined
        }));
    }

    // Add medical specialty from parent
    if (siteProfile.relevantSpecialty) {
        schema.medicalSpecialty = `https://schema.org/${siteProfile.relevantSpecialty}`;
    }

    // Add logo/image from parent if not on location
    if (siteProfile.logo_url) schema.logo = siteProfile.logo_url;
    if (siteProfile.image_url && !schema.image) schema.image = siteProfile.image_url;

    return { schema, error: null, missingFields: [] };
}

/**
 * Generate schema for Homepage, Contact, or Location pages
 * Handles both single-location and multi-location sites
 */
function generateLocalBusinessSchema(siteProfile, siteUrl, pageType = 'HOMEPAGE', pageId = null, pagePath = null) {
    const multiLocation = isMultiLocation(siteProfile);

    // HOMEPAGE: Organization for multi-location, LocalBusiness for single
    if (pageType === 'HOMEPAGE') {
        if (multiLocation) {
            // Multi-location: Organization + links to locations
            return generateOrganizationSchema(siteProfile, siteUrl);
        } else {
            // Single-location: Full LocalBusiness
            const location = getLocationData(siteProfile);
            return generateLocationBusinessSchema(location, siteProfile, siteUrl, null);
        }
    }

    // LOCATION: Find and use specific location data via explicit page_id linkage
    if (pageType === 'LOCATION') {
        const location = getLocationData(siteProfile, pageId, pagePath);
        return generateLocationBusinessSchema(location, siteProfile, siteUrl, pagePath);
    }

    // CONTACT: Use primary location data
    const location = getLocationData(siteProfile);
    return generateLocationBusinessSchema(location, siteProfile, siteUrl, '/contact');
}

// ============================================================
// MAIN GENERATOR
// ============================================================


async function generateSchemaForPage(page, siteProfile, siteUrl) {
    // Use page_type from database (set by classify-pages.js)
    const pageType = page.page_type;

    // Check if page has been classified
    if (!pageType) {
        return { schemas: [], pageType: 'UNCLASSIFIED', skip: true, reason: 'Not classified - run classify-pages.js first' };
    }

    const schemas = [];

    switch (pageType) {
        case 'HOMEPAGE':
            // Homepage already has schema - skip or generate full LocalBusiness
            return { schemas: [], pageType, skip: true, reason: 'Homepage - generate manually' };

        case 'PROCEDURE':
            schemas.push(await generateProcedureSchema(page, siteProfile, siteUrl));
            break;

        case 'RESOURCE':
            schemas.push(generateBlogSchema(page, siteProfile, siteUrl));
            break;

        case 'GALLERY':
            schemas.push(generateGallerySchema(page, siteUrl));
            break;

        case 'TEAM_MEMBER':
            schemas.push(await generateTeamMemberSchema(page, siteProfile, siteUrl));
            break;

        case 'HOMEPAGE':
        case 'CONTACT':
        case 'LOCATION': {
            // HIGH value - LocalBusiness / Organization / NAP schema
            const lbResult = generateLocalBusinessSchema(siteProfile, siteUrl, pageType, page.id, page.path);

            if (lbResult.error) {
                // Missing required data - tell user what's needed
                return {
                    schemas: [],
                    pageType,
                    skip: true,
                    reason: `Cannot generate schema: ${lbResult.error}`,
                    missingFields: lbResult.missingFields
                };
            }

            schemas.push(lbResult.schema);
            break;
        }

        // MEDIUM VALUE - Only generate if --include-medium flag is set
        case 'CONDITION':
            if (!includeMedium) {
                return { schemas: [], pageType, skip: true, reason: 'MEDIUM tier - use --include-medium to generate' };
            }
            // TODO: Generate MedicalCondition schema
            return { schemas: [], pageType, skip: true, reason: 'MedicalCondition schema not yet implemented' };

        case 'PRODUCT':
        case 'PRODUCT_COLLECTION':
            if (!includeMedium) {
                return { schemas: [], pageType, skip: true, reason: 'MEDIUM tier - use --include-medium to generate' };
            }
            // TODO: Generate Product schema
            return { schemas: [], pageType, skip: true, reason: 'Product schema not yet implemented' };

        // LOW VALUE - Always skip
        case 'SERVICE_INDEX':
        case 'BODY_AREA':
        case 'RESOURCE_INDEX':
        case 'UTILITY':
        case 'MEMBERSHIP':
        case 'ABOUT':
            return { schemas: [], pageType, skip: true, reason: `LOW tier - ${_tierCache?.[pageType]?.reason || 'no schema needed'}` };

        case 'GENERIC':
        default:
            return { schemas: [], pageType, skip: true, reason: 'LOW tier - no predictable schema type' };
    }

    // Extract FAQs if available
    const faqs = extractFAQs(page.html_content, page.headings);
    if (faqs.length > 0) {
        const pageUrl = `${siteUrl}${page.path}`;
        schemas.push({
            "@type": "FAQPage",
            "@id": `${pageUrl}#faq`,  // Consensus: Add @id
            // Consensus: Link FAQ to the procedure it's about
            "about": { "@id": `${pageUrl}#procedure` },
            "mainEntity": faqs.map(faq => ({
                "@type": "Question",
                "name": faq.question,
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": faq.answer
                }
            }))
        });
    }

    // Wrap in proper @graph structure if we have schemas
    if (schemas.length > 0) {
        const wrappedSchema = {
            "@context": "https://schema.org",
            "@graph": schemas
        };
        return { schemas: wrappedSchema, pageType, skip: false };
    }

    return { schemas: null, pageType, skip: true, reason: 'No schemas generated' };
}

// ============================================================
// BATCH PROCESSING
// ============================================================

async function getNextBatch(statusFilter = 'pending') {
    let query = supabase
        .from('page_index')
        .select('id, path, title, meta_tags, headings, main_content, html_content, page_type')
        .eq('site_id', SITE_ID)
        .eq('schema_status', statusFilter)
        .order('path')
        .limit(BATCH_SIZE);

    // Filter to single path if specified
    if (SINGLE_PATH) {
        query = query.eq('path', SINGLE_PATH);
    }

    const { data, error } = await query;

    if (error) {
        console.error('Error fetching batch:', error.message);
        return [];
    }
    return data || [];
}

async function getSiteData() {
    // Fetch site data including account_id
    const { data, error } = await supabase
        .from('site_index')
        .select('url, site_profile, account_id')
        .eq('id', SITE_ID)
        .single();

    if (error) {
        console.error('Error fetching site data:', error.message);
        return { siteUrl: '', siteProfile: {} };
    }

    const siteProfile = data?.site_profile || {};

    // Fetch locations from locations_procedures table if we have account_id
    if (data?.account_id) {
        const { data: locationsData, error: locError } = await supabase
            .from('locations_procedures')
            .select('id, location_name, street, city, state, postal, phone_number, hours, areas_served, url, gbp_url, is_primary, business_description, page_id')
            .eq('account_id', data.account_id);

        if (!locError && locationsData?.length > 0) {
            // Transform locations to expected schema format
            siteProfile.locations = locationsData.map(loc => {
                // Parse hours if it's a string (e.g., "Mon-Fri 9am-5pm")
                let parsedHours = null;
                if (loc.hours) {
                    // If hours is already an array, use it; otherwise keep as string for now
                    parsedHours = typeof loc.hours === 'string' ? loc.hours : loc.hours;
                }

                // Parse areas_served if it's a string
                let parsedAreas = [];
                if (loc.areas_served) {
                    if (typeof loc.areas_served === 'string') {
                        // Split by comma if string
                        parsedAreas = loc.areas_served.split(',').map(a => ({ city: a.trim() }));
                    } else if (Array.isArray(loc.areas_served)) {
                        parsedAreas = loc.areas_served;
                    }
                }

                return {
                    id: loc.id,
                    name: loc.location_name,
                    address: {
                        street: loc.street?.trim(),
                        city: loc.city,
                        state: loc.state,
                        zip: loc.postal?.toString(),
                        country: 'US'
                    },
                    phone: loc.phone_number,
                    hours: parsedHours,
                    path: loc.url, // Location page path/URL (legacy)
                    page_id: loc.page_id, // Explicit page linkage (preferred)
                    gbp_url: loc.gbp_url,
                    is_primary: loc.is_primary || false,
                    areas_served: parsedAreas,
                    description: loc.business_description
                };
            });

            console.log(`   📍 Loaded ${siteProfile.locations.length} location(s) from locations_procedures`);
        }
    }

    return {
        siteUrl: data?.url || '',
        siteProfile
    };
}

async function savePage(pageId, updates) {
    const { error } = await supabase
        .from('page_index')
        .update({
            ...updates,
            schema_generated_at: new Date().toISOString()
        })
        .eq('id', pageId);

    if (error) {
        console.error('Error saving page:', error.message);
    }
}

async function showProgressStatus() {
    const { data, error } = await supabase
        .from('page_index')
        .select('schema_status')
        .eq('site_id', SITE_ID);

    if (error) {
        console.error('Error:', error.message);
        return;
    }

    const counts = {};
    for (const page of data) {
        const status = page.schema_status || 'pending';
        counts[status] = (counts[status] || 0) + 1;
    }

    console.log('\n📊 Schema Generation Progress\n');
    console.log(`   Total pages: ${data.length}`);
    console.log(`   ⏳ Pending:      ${counts.pending || 0}`);
    console.log(`   ✅ Validated:    ${counts.validated || 0}`);
    console.log(`   🔍 Needs Review: ${counts.needs_review || 0}`);
    console.log(`   ⏭️  Skipped:      ${counts.skipped || 0}`);
    console.log('');
}

async function main() {
    console.log('🚀 Batch Schema Generator\n');

    if (showStatus) {
        await showProgressStatus();
        return;
    }

    const { siteUrl, siteProfile } = await getSiteData();
    console.log(`📍 Site: ${siteProfile.business_name || SITE_ID}`);
    console.log(`   URL: ${siteUrl}`);

    const statusFilter = retryFailed ? 'needs_review' : 'pending';
    console.log(`🔍 Processing: ${statusFilter} pages\n`);

    let totalProcessed = 0;
    let validated = 0;
    let needsReview = 0;
    let skipped = 0;

    while (true) {
        const pages = await getNextBatch(statusFilter);

        if (pages.length === 0) {
            console.log('\n✨ No more pages to process');
            break;
        }

        for (const page of pages) {
            try {
                const result = await generateSchemaForPage(page, siteProfile, siteUrl);

                if (result.skip) {
                    await savePage(page.id, {
                        schema_status: 'skipped',
                        schema_errors: [{ type: 'skipped', message: result.reason }],
                        page_type: result.pageType
                    });
                    console.log(`⏭️  ${page.path} - ${result.reason}`);
                    skipped++;
                } else {
                    const validation = validateSchema(result.schemas);

                    await savePage(page.id, {
                        recommended_schema: result.schemas,
                        schema_status: validation.status,
                        schema_errors: validation.errors,
                        page_type: result.pageType
                    });

                    if (validation.valid) {
                        console.log(`✅ ${page.path}`);
                        validated++;
                    } else {
                        console.log(`🔍 ${page.path} - ${validation.errors.map(e => e.message).join(', ')}`);
                        needsReview++;
                    }
                }

                totalProcessed++;

            } catch (error) {
                await savePage(page.id, {
                    schema_status: 'needs_review',
                    schema_errors: [{ type: 'exception', message: error.message }]
                });
                console.log(`❌ ${page.path} - Error: ${error.message}`);
                needsReview++;
                totalProcessed++;
            }
        }

        console.log(`\n📦 Batch complete. Processed ${totalProcessed} total. Checking for more...\n`);
    }

    console.log('\n' + '='.repeat(50));
    console.log('📊 Final Summary');
    console.log('='.repeat(50));
    console.log(`   Total processed: ${totalProcessed}`);
    console.log(`   ✅ Validated:     ${validated}`);
    console.log(`   🔍 Needs Review:  ${needsReview}`);
    console.log(`   ⏭️  Skipped:       ${skipped}`);
}

// Run CLI mode only when executed directly
if (isRunningAsCLI) {
    main().catch(console.error);
}

// ============================================================
// EXPORTS (for use by server.js and other scripts)
// ============================================================
export {
    generateSchemaForPage,
    validateSchema,
    extractFAQs,
    generateProcedureSchema,
    generateBlogSchema,
    generateGallerySchema,
    generateTeamMemberSchema,
    generateLocalBusinessSchema,
    generateOrganizationSchema,
    getSchemaValueTier,
    getSchemaValueTierInfo,
    loadTierCache,
    VALID_PAGE_TYPES
};

// Export a convenience function for single-page generation via API
export async function generateSchemaForPageById(pageId, options = {}) {
    const includeMediumTier = options.includeMedium || false;

    // Fetch page data
    const { data: page, error: pageError } = await supabase
        .from('page_index')
        .select('id, site_id, path, title, meta_tags, headings, main_content, html_content, page_type')
        .eq('id', pageId)
        .single();

    if (pageError || !page) {
        return { success: false, error: 'Page not found' };
    }

    // Fetch site data
    const { data: site, error: siteError } = await supabase
        .from('site_index')
        .select('url, site_profile, account_id')
        .eq('id', page.site_id)
        .single();

    if (siteError || !site) {
        return { success: false, error: 'Site not found' };
    }

    const siteUrl = site.url.replace(/\/$/, '');
    const siteProfile = site.site_profile || {};

    // Fetch locations from account if available
    if (site.account_id) {
        const { data: locations } = await supabase
            .from('locations')
            .select('*')
            .eq('account_id', site.account_id);
        if (locations?.length > 0) {
            siteProfile.locations = locations;
        }
    }

    // Determine schema type based on page_type
    const schemaTypeMap = {
        'PROCEDURE': 'MedicalProcedure',
        'TEAM_MEMBER': 'Physician',
        'RESOURCE': 'BlogPosting',
        'GALLERY': 'ImageGallery',
        'HOMEPAGE': 'MedicalBusiness',
        'LOCATION': 'MedicalBusiness',
        'CONTACT': 'MedicalBusiness'
    };
    const primarySchemaType = schemaTypeMap[page.page_type] || null;

    // Run pre-flight validation if we have a mapped schema type
    if (primarySchemaType) {
        const preflight = await preflightCheck(primarySchemaType, page.site_id, pageId);

        if (!preflight.canGenerate) {
            // Store errors and return failure - don't generate with missing data
            await supabase
                .from('page_index')
                .update({
                    schema_status: 'preflight_failed',
                    schema_errors: preflight.errors,
                    schema_generated_at: new Date().toISOString()
                })
                .eq('id', pageId);

            return {
                success: false,
                error: 'Pre-flight validation failed',
                preflightErrors: preflight.errors,
                pageType: page.page_type
            };
        }
    }

    // Generate schema
    const result = await generateSchemaForPage(page, siteProfile, siteUrl);

    if (result.skip) {
        // Save as skipped
        await supabase
            .from('page_index')
            .update({
                schema_status: 'skipped',
                schema_errors: [{ type: 'skipped', message: result.reason }],
                schema_generated_at: new Date().toISOString()
            })
            .eq('id', pageId);

        return {
            success: true,
            skipped: true,
            reason: result.reason,
            pageType: result.pageType
        };
    }

    // Validate the generated schema
    const validation = validateSchema(result.schemas);

    // Save individual schemas to page_schemas table
    const graphSchemas = result.schemas?.['@graph'] || [];
    for (const schemaObj of graphSchemas) {
        const schemaType = schemaObj['@type'];
        if (schemaType) {
            await savePageSchema(pageId, schemaType, schemaObj, 'template', validation);
        }
    }

    // Update cached combined schema in page_index
    await updateCachedSchema(pageId, siteUrl);

    return {
        success: true,
        skipped: false,
        schema: result.schemas,
        pageType: result.pageType,
        validation
    };
}

