/**
 * Firecrawl Service
 * Replaces Playwright-based crawling with Firecrawl API.
 * 
 * Key functions:
 * - scrapePage(url) - Scrape a single page (for recrawl)
 * - crawlSite(siteId, url, options) - Crawl entire site with real-time progress
 */

import Firecrawl from '@mendable/firecrawl-js';
import { createClient } from '@supabase/supabase-js';

// Lazy-load dotenv only when running as CLI
const isMainModule = process.argv[1]?.endsWith('firecrawl-service.js')
if (isMainModule) {
    await import('dotenv/config')
}

// Initialize Supabase lazily
let _supabase = null
function getSupabase() {
    if (!_supabase) {
        const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
        const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY ||
            process.env.VITE_SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY

        if (!supabaseUrl || !supabaseKey) {
            throw new Error(`Missing Supabase credentials`)
        }
        _supabase = createClient(supabaseUrl, supabaseKey)
    }
    return _supabase
}

// Clean Firecrawl markdown: strip pre-heading junk, images, and footer noise
function cleanMarkdown(md) {
    if (!md) return ''
    const lines = md.split('\n')

    // Find the first heading line (# ...)
    let firstHeadingIdx = lines.findIndex(l => /^#{1,6}\s+/.test(l))
    if (firstHeadingIdx === -1) firstHeadingIdx = 0

    // Find last meaningful content (trim footer junk)
    let lastContentIdx = lines.length - 1
    const footerPatterns = [
        /^©\s*\d{4}/i,
        /all\s*rights?\s*reserved/i,
        /powered\s*by\s*(shopify|wordpress|squarespace|wix)/i,
        /privacy\s*policy/i,
        /terms\s*(of\s*service|&\s*conditions|\s*of\s*use)/i,
        /^follow\s*us/i,
        /^\[?(facebook|instagram|twitter|linkedin|youtube|tiktok)\]?\s*$/i,
    ]
    for (let i = lines.length - 1; i > firstHeadingIdx; i--) {
        const trimmed = lines[i].trim()
        if (!trimmed) continue
        if (footerPatterns.some(p => p.test(trimmed))) {
            lastContentIdx = i - 1
        } else {
            break
        }
    }

    return lines.slice(firstHeadingIdx, lastContentIdx + 1)
        .filter(line => {
            const trimmed = line.trim()
            if (/^!\[.*?\]\(.*?\)\s*$/.test(trimmed)) return false
            if (/^\[(call|book|schedule|get\s+\d+%)/i.test(trimmed)) return false
            return true
        })
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

// Initialize Firecrawl lazily
let _firecrawl = null
function getFirecrawl() {
    if (!_firecrawl) {
        const apiKey = process.env.FIRECRAWL_API_KEY
        if (!apiKey) {
            throw new Error('Missing FIRECRAWL_API_KEY environment variable')
        }
        _firecrawl = new Firecrawl({ apiKey })
    }
    return _firecrawl
}

// ============================================================
// Single Page Scrape (for recrawl operations)
// ============================================================

/**
 * Scrape a single page using Firecrawl
 * @param {string} url - URL to scrape
 * @param {Object} options - Scrape options
 * @returns {Object} - { markdown, html, rawHtml, metadata, links }
 */
export async function scrapePage(url, options = {}) {
    const firecrawl = getFirecrawl()

    console.log(`🔥 Firecrawl scraping: ${url}`)

    const result = await firecrawl.scrape(url, {
        formats: ['markdown', 'html', 'rawHtml', 'links'],
        onlyMainContent: options.onlyMainContent !== false, // Default true
        excludeTags: options.excludeTags || [],
        timeout: options.timeout || 30000,
    })

    // Firecrawl SDK returns data at root level, not wrapped in .success/.data
    if (!result || !result.markdown) {
        throw new Error('Firecrawl scrape failed - no content returned')
    }

    console.log(`✅ Firecrawl scraped: ${url} (${result.metadata?.title || 'untitled'})`)

    return {
        markdown: result.markdown || '',
        html: result.html || '',           // Cleaned HTML (no scripts/styles, main content)
        rawHtml: result.rawHtml || '',     // Full unmodified HTML
        metadata: result.metadata || {},
        links: result.links || [],
    }
}

/**
 * Parse Firecrawl response into page_index format
 * @param {Object} data - Firecrawl response data
 * @param {string} siteId - Site ID
 * @returns {Object} - page_index record
 */
export function parseFirecrawlResponse(data, siteId) {
    const url = data.metadata?.sourceURL || ''
    const parsedUrl = new URL(url)

    // Extract headings from markdown
    const headings = extractHeadingsFromMarkdown(data.markdown)

    // Separate internal vs external links
    const domain = parsedUrl.hostname
    const internalLinks = []
    const externalLinks = []

    for (const link of (data.links || [])) {
        try {
            const linkUrl = new URL(link, url)
            if (linkUrl.hostname === domain) {
                internalLinks.push(linkUrl.pathname)
            } else {
                externalLinks.push(link)
            }
        } catch {
            // Invalid URL, skip
        }
    }

    return {
        site_id: siteId,
        url: url,
        path: parsedUrl.pathname,
        title: data.metadata?.title || '',
        html_content: data.rawHtml,        // Full HTML for reference
        cleaned_html: data.html,           // Cleaned HTML (main content only)
        main_content: cleanMarkdown(data.markdown),       // LLM-ready markdown (cleaned)
        headings: headings,
        meta_tags: {
            description: data.metadata?.description || '',
            keywords: data.metadata?.keywords || '',
            ogTitle: data.metadata?.ogTitle || '',
            ogDescription: data.metadata?.ogDescription || '',
            ogImage: data.metadata?.ogImage || '',
        },
        links_internal: internalLinks,
        links_external: externalLinks,
        status_code: data.metadata?.statusCode || 200,
        crawled_at: new Date().toISOString(),
    }
}

/**
 * Extract heading structure from markdown
 */
function extractHeadingsFromMarkdown(markdown) {
    if (!markdown) return []

    const headings = []
    const lines = markdown.split('\n')

    for (const line of lines) {
        const match = line.match(/^(#{1,6})\s+(.+)$/)
        if (match) {
            headings.push({
                level: match[1].length,
                text: match[2].trim()
            })
        }
    }

    return headings
}

// ============================================================
// Full Site Crawl
// ============================================================

/**
 * Crawl an entire site using Firecrawl
 * @param {string} siteId - Site ID in database
 * @param {string} url - Starting URL
 * @param {Object} options - Crawl options
 */
export async function crawlSite(siteId, url, options = {}) {
    const firecrawl = getFirecrawl()
    const limit = options.limit || 200
    const excludePaths = options.exclude || []
    const runClassifier = options.runClassifier !== false

    console.log(`🕷️ Firecrawl crawling: ${url} (limit: ${limit})`)

    // Update site status to crawling
    await updateSiteStatus(siteId, 'crawling', 0, limit)

    try {
        // Start the crawl with polling
        const crawlResult = await firecrawl.crawl(url, {
            limit: limit,
            excludePaths: excludePaths,
            scrapeOptions: {
                formats: ['markdown', 'html', 'rawHtml', 'links'],
                onlyMainContent: true,
            },
        })

        // Firecrawl SDK crawl returns: { status, data: [...pages], total, ... }
        // Status can be 'completed', 'failed', etc.
        if (!crawlResult || crawlResult.status === 'failed') {
            throw new Error('Firecrawl crawl failed')
        }

        // Process all pages - data is at root level
        const pages = crawlResult.data || []
        console.log(`📄 Received ${pages.length} pages from Firecrawl (status: ${crawlResult.status})`)

        let processedCount = 0
        for (const pageData of pages) {
            try {
                const parsed = parseFirecrawlResponse(pageData, siteId)
                await savePage(parsed)
                processedCount++

                // Update progress every 10 pages
                if (processedCount % 10 === 0) {
                    await updateSiteStatus(siteId, 'crawling', processedCount, limit)
                    console.log(`   📊 Progress: ${processedCount}/${pages.length} pages`)
                }
            } catch (err) {
                console.error(`   ❌ Error saving page: ${pageData.metadata?.sourceURL}`, err.message)
            }
        }

        // Update final status
        await updateSiteStatus(siteId, 'complete', processedCount, limit)
        console.log(`✅ Crawl complete: ${processedCount} pages saved`)

        // Run classifier if enabled
        if (runClassifier) {
            console.log(`🏷️ Starting classifier for site ${siteId}...`)
            await updateSiteStatus(siteId, 'classifying', processedCount, limit)

            // Import and run classifier
            try {
                const { runClassification } = await import('./classify-pages.js')
                await runClassification(siteId)
                console.log(`✅ Classification complete`)
            } catch (err) {
                console.error(`❌ Classifier failed:`, err.message)
            }
        }

        // Final status update
        await updateSiteStatus(siteId, 'complete', processedCount, limit)

        return { success: true, pagesProcessed: processedCount }
    } catch (error) {
        console.error(`❌ Crawl failed:`, error.message)
        await updateSiteStatus(siteId, 'error', 0, limit, error.message)
        throw error
    }
}

// ============================================================
// Database Helpers
// ============================================================

async function updateSiteStatus(siteId, status, pagesProcessed = null, pageLimit = null, errorMessage = null) {
    const update = {
        crawl_status: status,
        updated_at: new Date().toISOString(),
    }

    if (pagesProcessed !== null) update.pages_crawled = pagesProcessed
    if (pageLimit !== null) update.page_limit = pageLimit
    if (errorMessage) update.error_message = errorMessage

    const { error } = await getSupabase()
        .from('site_index')
        .update(update)
        .eq('id', siteId)

    if (error) {
        console.error(`Failed to update site status:`, error.message)
    }
}

async function savePage(pageData) {
    const { error } = await getSupabase()
        .from('page_index')
        .upsert(pageData, { onConflict: 'site_id,url' })

    if (error) {
        throw new Error(`Failed to save page: ${error.message}`)
    }
}

// ============================================================
// CLI Entry Point (for testing)
// ============================================================

if (isMainModule) {
    const args = process.argv.slice(2)

    if (args.includes('--test-scrape')) {
        const url = args.find(a => a.startsWith('--url='))?.split('=')[1] || 'https://example.com'
        scrapePage(url)
            .then(result => {
                console.log('\n📄 Scrape Result:')
                console.log('Title:', result.metadata.title)
                console.log('Markdown length:', result.markdown.length)
                console.log('HTML length:', result.html.length)
                console.log('Links:', result.links.length)
            })
            .catch(err => console.error('Error:', err.message))
    } else {
        console.log('Usage:')
        console.log('  node firecrawl-service.js --test-scrape --url=https://example.com')
    }
}
