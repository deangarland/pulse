/**
 * Schema Utilities - Data-driven schema generation
 * 
 * This module provides:
 * - Pre-flight validation (check required data exists before generation)
 * - Data source resolution (fetch field values from DB tables)
 * - Template-based schema building
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY
);

/**
 * Pre-flight check - verify all required data exists before generation
 * Returns errors if any required fields are missing or contain placeholder values
 */
export async function preflightCheck(schemaType, siteId, pageId = null) {
    // 1. Fetch template with data_sources
    const { data: template, error: templateError } = await supabase
        .from('schema_templates')
        .select('schema_type, required_fields, data_sources')
        .eq('schema_type', schemaType)
        .single();

    if (templateError || !template) {
        return {
            canGenerate: false,
            errors: [{ field: 'template', error: `Template not found: ${schemaType}` }]
        };
    }

    // 2. Fetch site data
    const { data: site } = await supabase
        .from('site_index')
        .select('url, site_profile')
        .eq('id', siteId)
        .single();

    // 3. Fetch page data if provided
    let page = null;
    if (pageId) {
        const { data: pageData } = await supabase
            .from('page_index')
            .select('*')
            .eq('id', pageId)
            .single();
        page = pageData;
    }

    // 4. Fetch primary location
    const { data: locations } = await supabase
        .from('locations')
        .select('*')
        .eq('account_id', site?.site_profile?.account_id || siteId)
        .eq('is_primary', true)
        .limit(1);

    const location = locations?.[0] || null;

    // 5. Check each data source for required fields
    const errors = [];
    const dataSources = template.data_sources || {};

    for (const [field, source] of Object.entries(dataSources)) {
        if (!source.required) continue;

        const value = resolveDataSourceSync(source, { site, page, location });

        if (!value) {
            errors.push({
                field,
                source: source.source,
                table: source.table || source.source,
                error: `Missing required field: ${field}`
            });
        } else if (isPlaceholder(value)) {
            errors.push({
                field,
                source: source.source,
                error: `Field contains placeholder: ${field} = "${value}"`
            });
        }
    }

    return {
        canGenerate: errors.length === 0,
        errors,
        template,
        context: { site, page, location }
    };
}

/**
 * Check if a value looks like a placeholder
 */
function isPlaceholder(value) {
    if (typeof value !== 'string') return false;

    const placeholderPatterns = [
        /\[.*?\]/,                    // [placeholder]
        /\{\{.*?\}\}/,                // {{placeholder}}
        /your.*here/i,                // "your phone here"
        /enter.*here/i,               // "enter email here"
        /todo/i,                      // TODO
        /xxx/i,                       // XXX
        /123-456-7890/,               // Fake phone
        /example\.com/i,              // example.com
        /lorem ipsum/i                // Lorem ipsum
    ];

    return placeholderPatterns.some(p => p.test(value));
}

/**
 * Resolve a data source synchronously given pre-fetched context
 */
function resolveDataSourceSync(source, context) {
    const { site, page, location } = context;
    const siteProfile = site?.site_profile || {};

    switch (source.source) {
        case 'page':
            return getNestedValue(page, source.field);

        case 'site_profile':
            return getNestedValue(siteProfile, source.field);

        case 'site_index':
            return getNestedValue(site, source.field);

        case 'locations':
            if (!location) return source.fallback ? getNestedValue(siteProfile, source.fallback) : null;
            return getNestedValue(location, source.field);

        case 'computed':
            return resolveTemplate(source.template, { siteUrl: site?.url, page });

        case 'llm_extract':
            // LLM extraction happens during generation, not preflight
            return '[LLM_EXTRACT]';

        case 'dom_extract':
            // DOM extraction happens during generation
            return '[DOM_EXTRACT]';

        default:
            return null;
    }
}

/**
 * Get nested value from object using dot notation
 * e.g., getNestedValue(obj, 'site_profile.owner.name')
 */
function getNestedValue(obj, path) {
    if (!obj || !path) return null;
    return path.split('.').reduce((o, k) => o?.[k], obj);
}

/**
 * Resolve template string with context values
 * e.g., "{{siteUrl}}{{page.path}}" => "https://example.com/contact"
 */
function resolveTemplate(template, context) {
    if (!template) return null;
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, path) => {
        return getNestedValue(context, path) || '';
    });
}

/**
 * Resolve all data sources for a schema type
 * Returns field values ready for schema building
 */
export async function resolveAllDataSources(schemaType, siteId, pageId) {
    const preflight = await preflightCheck(schemaType, siteId, pageId);

    if (!preflight.canGenerate) {
        return { success: false, errors: preflight.errors };
    }

    const { template, context } = preflight;
    const dataSources = template.data_sources || {};
    const fieldValues = {};

    for (const [field, source] of Object.entries(dataSources)) {
        const value = resolveDataSourceSync(source, context);

        // Apply fallback if value is null
        if (value === null && source.fallback) {
            fieldValues[field] = getNestedValue(context.site?.site_profile, source.fallback);
        } else if (value === null && source.default) {
            fieldValues[field] = source.default;
        } else {
            fieldValues[field] = value;
        }

        // Apply transform if specified (these are handled by the generator)
        if (source.transform) {
            fieldValues[`${field}__transform`] = source.transform;
        }
    }

    return {
        success: true,
        fieldValues,
        template,
        context
    };
}

/**
 * Save individual schema to page_schemas table
 */
export async function savePageSchema(pageId, schemaType, schemaJson, method = 'template', validationResult = null) {
    const { data, error } = await supabase
        .from('page_schemas')
        .upsert({
            page_id: pageId,
            schema_type: schemaType,
            schema_json: schemaJson,
            generation_method: method,
            is_valid: validationResult?.valid ?? true,
            validation_errors: validationResult?.errors || []
        }, {
            onConflict: 'page_id,schema_type'
        })
        .select()
        .single();

    if (error) {
        console.error('Error saving page schema:', error);
        return { success: false, error };
    }

    return { success: true, data };
}

/**
 * Fetch all schemas for a page and assemble into @graph
 */
export async function assembleGraphForPage(pageId, siteUrl) {
    const { data: schemas, error } = await supabase
        .from('page_schemas')
        .select('schema_type, schema_json, is_valid')
        .eq('page_id', pageId);

    if (error || !schemas?.length) {
        return null;
    }

    // Filter to valid schemas only
    const validSchemas = schemas
        .filter(s => s.is_valid)
        .map(s => s.schema_json);

    if (validSchemas.length === 0) {
        return null;
    }

    return {
        "@context": "https://schema.org",
        "@graph": validSchemas
    };
}

/**
 * Update cached recommended_schema in page_index
 */
export async function updateCachedSchema(pageId, siteUrl) {
    const graph = await assembleGraphForPage(pageId, siteUrl);

    if (!graph) return { success: false, error: 'No valid schemas' };

    const { error } = await supabase
        .from('page_index')
        .update({
            recommended_schema: graph,
            schema_status: 'validated',
            schema_generated_at: new Date().toISOString()
        })
        .eq('id', pageId);

    return { success: !error, error };
}

export {
    isPlaceholder,
    resolveDataSourceSync,
    getNestedValue,
    resolveTemplate
};
