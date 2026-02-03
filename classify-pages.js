#!/usr/bin/env node
/**
 * Page Type Classifier
 * Classifies crawled pages into page types using LLM-based content analysis.
 * This is STEP 1 of the workflow - run BEFORE schema generation.
 * 
 * Prompts are loaded from the database (Admin > Prompts) and costs are logged
 * to ai_usage_logs for tracking in Token Cost Log.
 * 
 * Usage:
 *   node classify-pages.js --site=ID           # Classify all unclassified pages for a site
 *   node classify-pages.js --site=ID --status  # Show classification progress
 *   node classify-pages.js --site=ID --reclassify  # Re-classify all pages
 */

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
// Lazy-load dotenv only when running as CLI
const isMainModule = process.argv[1]?.endsWith('classify-pages.js')
if (isMainModule) {
    await import('dotenv/config')
}

// Lazy load clients
let _openai = null
function getOpenAI() {
    if (!_openai) {
        // Support both VITE_ and non-prefixed env vars
        const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY
        if (!apiKey) {
            throw new Error('Missing OPENAI_API_KEY')
        }
        _openai = new OpenAI({ apiKey });
    }
    return _openai
}

let _supabase = null
function getSupabase() {
    if (!_supabase) {
        const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
        const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY ||
            process.env.VITE_SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY

        if (!supabaseUrl || !supabaseKey) {
            throw new Error('Missing Supabase credentials')
        }
        _supabase = createClient(supabaseUrl, supabaseKey);
    }
    return _supabase
}

// ============================================================
// AI Model Pricing (per 1M tokens, in cents) - matches server.js
// ============================================================
const MODEL_PRICING = {
    'gpt-4o-mini': { input: 15, output: 60 },
    'gpt-4o': { input: 250, output: 1000 },
    'gpt-4-turbo': { input: 1000, output: 3000 },
    'gpt-3.5-turbo': { input: 50, output: 150 },
}

function calculateCost(model, inputTokens, outputTokens) {
    const pricing = MODEL_PRICING[model] || { input: 15, output: 60 } // default to gpt-4o-mini pricing
    const inputCostCents = Math.round((inputTokens / 1000000) * pricing.input)
    const outputCostCents = Math.round((outputTokens / 1000000) * pricing.output)
    return { inputCostCents, outputCostCents }
}

// Log AI usage to database
async function logAIUsage({
    action,
    pageId = null,
    pageUrl = null,
    provider = 'openai',
    model,
    inputTokens,
    outputTokens,
    requestDurationMs = null,
    success = true,
    errorMessage = null
}) {
    try {
        const { inputCostCents, outputCostCents } = calculateCost(model, inputTokens, outputTokens)

        await getSupabase().from('ai_usage_logs').insert({
            action,
            page_id: pageId,
            page_url: pageUrl,
            provider,
            model,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            input_cost_cents: inputCostCents,
            output_cost_cents: outputCostCents,
            request_duration_ms: requestDurationMs,
            success,
            error_message: errorMessage
        })

        console.log(`   📊 Logged: ${action} | ${model} | ${inputTokens}+${outputTokens} tokens`)
    } catch (error) {
        console.error('   ⚠️ Failed to log AI usage:', error.message)
    }
}

// ============================================================
// Prompt Fetching from Database
// ============================================================

// Cache for prompts (avoid repeated DB calls)
const promptCache = {}

async function getPrompt(promptName) {
    if (promptCache[promptName]) {
        return promptCache[promptName]
    }

    try {
        const { data, error } = await getSupabase()
            .from('prompts')
            .select('system_prompt, user_prompt_template, default_model')
            .eq('name', promptName)
            .single()

        if (error || !data) {
            console.warn(`   ⚠️ Prompt "${promptName}" not found in DB, using fallback`)
            return null
        }

        promptCache[promptName] = data
        return data
    } catch (err) {
        console.error(`   ⚠️ Error fetching prompt: ${err.message}`)
        return null
    }
}

// Global state for execution
let SITE_ID = null;
let reclassify = false;
let totalTokensIn = 0;
let totalTokensOut = 0;
let currentOffset = 0;

const BATCH_SIZE = 10;

// Valid page types
const VALID_PAGE_TYPES = [
    'HOMEPAGE',
    'PROCEDURE',
    'SERVICE_INDEX',
    'BODY_AREA',
    'CONDITION',
    'RESOURCE',
    'RESOURCE_INDEX',
    'TEAM_MEMBER',
    'ABOUT',
    'GALLERY',
    'CONTACT',
    'LOCATION',
    'PRODUCT',
    'PRODUCT_COLLECTION',
    'UTILITY',
    'MEMBERSHIP',
    'GENERIC'
];

// ============================================================
// PAGE TYPE CLASSIFICATION (Intelligent LLM-based)
// ============================================================

/**
 * Quick heuristic checks for universal utility/skip pages
 * These patterns are truly universal across all platforms
 */
function quickHeuristicClassify(path) {
    if (path === '/') return 'HOMEPAGE';

    // Universal utility pages (skip schema, but still indexed)
    const utilitySignals = ['cart', 'checkout', 'account', 'login', 'signin', 'sign-in', 'register', 'signup', 'sign-up', 'search', 'wishlist', 'favorites', 'privacy', 'terms', 'policy'];
    if (utilitySignals.some(s => path.includes(s))) return 'UTILITY';

    // Contact pages - obvious from URL
    if (path.includes('contact') || path.includes('appointment') || path.includes('book-now') || path.includes('schedule')) return 'CONTACT';

    // About/team pages
    if (path === '/about' || path === '/about-us' || path === '/about/') return 'ABOUT';
    if (path.includes('/team') || path.includes('/staff') || path.includes('/providers') || path.includes('/our-team')) return 'ABOUT';

    // Gallery pages
    if (path.includes('gallery') || path.includes('before-after') || path.includes('results') || path.includes('portfolio')) return 'GALLERY';

    // Membership/pricing pages
    if (path.includes('membership') || path.includes('pricing') || path.includes('specials') || path.includes('financing')) return 'MEMBERSHIP';

    // Blog post patterns (question titles, listicles) - these are RESOURCES
    const blogPatterns = ['/blog/', '/news/', '/article/', '/post/'];
    if (blogPatterns.some(p => path.includes(p))) return 'RESOURCE';

    // Blog index/archive patterns
    if (path.includes('/category/') || path.includes('/tag/') || path.includes('/tagged/') || path.includes('/archive/')) return 'RESOURCE_INDEX';

    return null; // No quick classification, use LLM
}

// Global site context (populated by analyzeSiteStructure)
let siteContext = null;

// Fallback prompts if database prompts are not available
const FALLBACK_SITE_ANALYSIS_PROMPT = `You are analyzing a medical/aesthetic practice website to understand its structure BEFORE classifying individual pages.

Here is a summary of ALL {{page_count}} pages on this site (path | title | content snippet):

{{page_summaries}}

Analyze this site and identify:
1. URL PATTERNS: Common path patterns and what they likely represent
2. CONTENT PATTERNS: Which pages appear to be blog posts vs service pages
3. LOCATION PATTERN: Does this site have location-specific pages?
4. BLOG PATTERN: Where does the blog live? Which pages are blog articles?

Return a JSON object:
{
  "patterns": [{"pattern": "/category/*", "likely_type": "RESOURCE_INDEX", "reason": "..."}],
  "locations": ["City1", "City2"],
  "blog_path": "/blog",
  "notes": "Any observations"
}`

const FALLBACK_PAGE_TYPE_PROMPT = `{{site_context}}

PAGE METADATA:
URL Path: {{page_path}}
Title: {{page_title}}
Meta Description: {{meta_description}}
Content Length: {{content_length}} characters

PAGE HTML STRUCTURE:
{{html_preview}}

Classify this page. Valid types: HOMEPAGE, PROCEDURE, SERVICE_INDEX, BODY_AREA, CONDITION, RESOURCE, RESOURCE_INDEX, TEAM_MEMBER, ABOUT, GALLERY, CONTACT, LOCATION, PRODUCT, PRODUCT_COLLECTION, UTILITY, MEMBERSHIP, GENERIC.

Respond with ONLY the page type (e.g., "PROCEDURE" or "RESOURCE"), nothing else.`

/**
 * PASS 1: Analyze entire site structure before classifying individual pages
 * Identifies URL patterns, content distributions, and page groupings
 */
async function analyzeSiteStructure(pages) {
    console.log('\n📊 PASS 1: Analyzing site structure...');

    // Build site summary with content snippets
    const pageSummaries = pages.map(p => {
        const content = (p.main_content || '').substring(0, 150).replace(/\s+/g, ' ');
        return `${p.path} | ${p.title?.substring(0, 40) || 'No title'} | ${content}...`;
    });

    // Try to get prompt from database
    const promptData = await getPrompt('Page Classifier - Site Analysis')
    const model = promptData?.default_model || 'gpt-4o-mini'

    let prompt
    if (promptData?.system_prompt && promptData?.user_prompt_template) {
        // Combine system prompt and user template
        prompt = promptData.system_prompt + '\n\n' + promptData.user_prompt_template
            .replace('{{page_count}}', pages.length.toString())
            .replace('{{page_summaries}}', pageSummaries.join('\n'))
    } else {
        // Use fallback
        prompt = FALLBACK_SITE_ANALYSIS_PROMPT
            .replace('{{page_count}}', pages.length.toString())
            .replace('{{page_summaries}}', pageSummaries.join('\n'))
    }

    const startTime = Date.now()

    try {
        const response = await getOpenAI().chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 800,
            temperature: 0,
            response_format: { type: 'json_object' }
        });

        const inputTokens = response.usage?.prompt_tokens || 0
        const outputTokens = response.usage?.completion_tokens || 0
        totalTokensIn += inputTokens
        totalTokensOut += outputTokens

        // Log to ai_usage_logs
        await logAIUsage({
            action: 'page_classification_site_analysis',
            provider: 'openai',
            model,
            inputTokens,
            outputTokens,
            requestDurationMs: Date.now() - startTime,
            success: true
        })

        const context = JSON.parse(response.choices[0].message.content);
        console.log(`   ✓ Identified ${context.patterns?.length || 0} URL patterns`);
        console.log(`   ✓ Locations: ${context.locations?.join(', ') || 'none detected'}`);
        if (context.notes) console.log(`   ℹ️ ${context.notes}`);

        return context;
    } catch (error) {
        console.error(`   ⚠️ Site analysis failed: ${error.message}`);
        return { patterns: [], locations: [], notes: 'Analysis failed' };
    }
}

/**
 * LLM-based page classification using content signals
 * Analyzes title, meta description, H1, and content to determine page type
 */
async function llmClassifyPage(page) {
    const mainContent = page.main_content || '';
    const cleanedHtml = page.cleaned_html || '';
    const contentLength = mainContent.length;

    // Build site context section (from Pass 1 analysis)
    let siteContextSection = '';
    if (siteContext) {
        const patterns = siteContext.patterns?.map(p =>
            `  - "${p.pattern}" → ${p.likely_type} (${p.reason})`
        ).join('\n') || '  (none identified)';

        siteContextSection = `SITE CONTEXT (from site-wide analysis):
URL Patterns identified on this site:
${patterns}
Locations: ${siteContext.locations?.join(', ') || 'not detected'}
${siteContext.notes ? `Notes: ${siteContext.notes}` : ''}

Use these patterns to help classify this page.`;
    }

    // Truncate cleaned HTML to reasonable size for LLM
    const htmlPreview = cleanedHtml.length > 12000
        ? cleanedHtml.substring(0, 12000) + '<!-- truncated -->'
        : cleanedHtml;

    // Try to get prompt from database
    const promptData = await getPrompt('Page Classifier - Page Type')
    const model = promptData?.default_model || 'gpt-4o-mini'

    let prompt
    if (promptData?.system_prompt && promptData?.user_prompt_template) {
        // Combine system prompt and user template with replacements
        prompt = promptData.system_prompt + '\n\n' + promptData.user_prompt_template
            .replace('{{site_context}}', siteContextSection)
            .replace('{{page_path}}', page.path || '')
            .replace('{{page_title}}', page.title || '')
            .replace('{{meta_description}}', page.meta_tags?.description || '')
            .replace('{{content_length}}', contentLength.toString())
            .replace('{{html_preview}}', htmlPreview)
    } else {
        // Use fallback
        prompt = FALLBACK_PAGE_TYPE_PROMPT
            .replace('{{site_context}}', siteContextSection)
            .replace('{{page_path}}', page.path || '')
            .replace('{{page_title}}', page.title || '')
            .replace('{{meta_description}}', page.meta_tags?.description || '')
            .replace('{{content_length}}', contentLength.toString())
            .replace('{{html_preview}}', htmlPreview)
    }

    const startTime = Date.now()

    try {
        const response = await getOpenAI().chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 20,
            temperature: 0
        });

        const inputTokens = response.usage?.prompt_tokens || 0
        const outputTokens = response.usage?.completion_tokens || 0
        totalTokensIn += inputTokens
        totalTokensOut += outputTokens

        // Log to ai_usage_logs
        await logAIUsage({
            action: 'page_classification',
            pageId: page.id,
            pageUrl: page.url || page.path,
            provider: 'openai',
            model,
            inputTokens,
            outputTokens,
            requestDurationMs: Date.now() - startTime,
            success: true
        })

        const result = response.choices[0].message.content.trim().toUpperCase();
        return VALID_PAGE_TYPES.includes(result) ? result : 'GENERIC';
    } catch (error) {
        console.error(`   ⚠️ Classification error: ${error.message}`);
        return 'GENERIC';
    }
}

/**
 * Hybrid classifier: quick heuristics first, then LLM for content-based classification
 */
async function classifyPageType(page) {
    const path = (page.path || '').toLowerCase();

    // Try quick heuristics first (no LLM needed)
    const quickResult = quickHeuristicClassify(path);
    if (quickResult) return quickResult;

    // Use LLM for intelligent content-based classification
    return await llmClassifyPage(page);
}

// ============================================================
// BATCH PROCESSING
// ============================================================

async function getNextBatch() {
    let query = getSupabase()
        .from('page_index')
        .select('id, path, url, title, meta_tags, main_content, cleaned_html')
        .eq('site_id', SITE_ID)
        .order('path');

    if (!reclassify) {
        // When filtering for unclassified only, use .limit() instead of .range()
        // Range with offset doesn't work with filters because offsets are based
        // on the FULL list, not the filtered results
        query = query.is('page_type', null).limit(BATCH_SIZE);
    } else {
        // When reclassifying all pages, offset pagination works correctly
        query = query.range(currentOffset, currentOffset + BATCH_SIZE - 1);
        currentOffset += BATCH_SIZE;
    }

    const { data, error } = await query;

    if (error) {
        console.error('Error fetching batch:', error.message);
        return [];
    }

    return data || [];
}

async function getSiteName() {
    const { data, error } = await getSupabase()
        .from('site_index')
        .select('url, site_profile')
        .eq('id', SITE_ID)
        .single();

    if (error) return SITE_ID;
    return data?.site_profile?.business_name || data?.url || SITE_ID;
}

async function savePage(pageId, pageType) {
    const { error } = await getSupabase()
        .from('page_index')
        .update({
            page_type: pageType
        })
        .eq('id', pageId);

    if (error) {
        console.error('Error saving page:', error.message);
    }
}

async function showProgressStatus() {
    const { data, error } = await getSupabase()
        .from('page_index')
        .select('page_type')
        .eq('site_id', SITE_ID);

    if (error) {
        console.error('Error:', error.message);
        return;
    }

    const counts = {};
    let unclassified = 0;
    for (const page of data) {
        if (page.page_type) {
            counts[page.page_type] = (counts[page.page_type] || 0) + 1;
        } else {
            unclassified++;
        }
    }

    console.log('\n📊 Classification Progress\n');
    console.log(`   Total pages: ${data.length}`);
    console.log(`   ⏳ Unclassified: ${unclassified}`);
    console.log('\n   Page Types:');

    Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .forEach(([type, count]) => {
            console.log(`     ${type}: ${count}`);
        });

    console.log('');
}

export async function runClassification(siteId, isReclassify = false) {
    console.log('🏷️  Page Type Classifier\n');

    if (!siteId) {
        throw new Error('siteId is required');
    }

    // Reset global state for this run
    SITE_ID = siteId;
    reclassify = isReclassify;
    totalTokensIn = 0;
    totalTokensOut = 0;
    currentOffset = 0;
    siteContext = null;

    const siteName = await getSiteName();
    console.log(`📍 Site: ${siteName}`);
    console.log(`   ID: ${SITE_ID}`);
    console.log(`🔍 Mode: ${reclassify ? 'Re-classifying ALL pages' : 'Classifying unclassified pages only'}`);

    // PASS 1: Fetch all pages for site analysis
    console.log('\n📥 Fetching all pages for analysis...');
    const { data: allPages, error: fetchError } = await getSupabase()
        .from('page_index')
        .select('id, path, title, main_content')
        .eq('site_id', SITE_ID)
        .order('path');

    if (fetchError) {
        throw new Error(`Failed to fetch pages: ${fetchError.message}`);
    }
    console.log(`   Found ${allPages.length} pages`);

    // Run site structure analysis (Pass 1)
    siteContext = await analyzeSiteStructure(allPages);

    console.log('\n📝 PASS 2: Classifying individual pages...\n');

    let totalProcessed = 0;
    const typeCounts = {};

    while (true) {
        const pages = await getNextBatch();

        if (pages.length === 0) {
            console.log('\n✨ No more pages to classify');
            break;
        }

        for (const page of pages) {
            try {
                const pageType = await classifyPageType(page);
                await savePage(page.id, pageType);

                typeCounts[pageType] = (typeCounts[pageType] || 0) + 1;
                console.log(`${pageType.padEnd(18)} ${page.path}`);

                totalProcessed++;
            } catch (error) {
                console.log(`❌ ${page.path} - Error: ${error.message}`);
                totalProcessed++;
            }
        }

        console.log(`\n📦 Batch complete. Processed ${totalProcessed} total.\n`);
    }

    console.log('\n' + '='.repeat(50));
    console.log('📊 Final Summary');
    console.log('='.repeat(50));
    console.log(`   Total classified: ${totalProcessed}`);
    console.log(`   📊 Tokens: ~${totalTokensIn.toLocaleString()} in, ~${totalTokensOut.toLocaleString()} out`);
    console.log(`   💵 Est. Cost: $${((totalTokensIn * 0.15 / 1000000) + (totalTokensOut * 0.6 / 1000000)).toFixed(4)}`);
    console.log('');
    Object.entries(typeCounts)
        .sort((a, b) => b[1] - a[1])
        .forEach(([type, count]) => {
            console.log(`   ${type}: ${count}`);
        });
}

// CLI entry point
if (isMainModule) {
    const args = process.argv.slice(2);
    const showStatus = args.includes('--status');
    const reclassify = args.includes('--reclassify');
    const siteArg = args.find(a => a.startsWith('--site='));
    const siteId = siteArg ? siteArg.split('=')[1] : null;

    if (!siteId) {
        console.error('❌ Error: --site=ID is required');
        process.exit(1);
    }

    if (showStatus) {
        SITE_ID = siteId;
        showProgressStatus().then(() => process.exit(0)).catch(err => {
            console.error(err);
            process.exit(1);
        });
    } else {
        runClassification(siteId, reclassify).then(() => process.exit(0)).catch(err => {
            console.error(err);
            process.exit(1);
        });
    }
}
