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

// Clean Firecrawl markdown: strip pre-heading junk, images, nav/footer noise, and browser errors
function cleanMarkdown(md) {
    if (!md) return ''
    let lines = md.split('\n')

    // Find the first heading line (# ...)
    let firstHeadingIdx = lines.findIndex(l => /^#{1,6}\s+/.test(l))
    if (firstHeadingIdx === -1) firstHeadingIdx = 0

    // Trim everything before first heading
    lines = lines.slice(firstHeadingIdx)

    // ── Step 1: Remove browser error blocks ──
    lines = lines.filter(line => {
        const trimmed = line.trim()
        if (/ERR_BLOCKED_BY_CLIENT/i.test(trimmed)) return false
        if (/^this page has been blocked by an extension/i.test(trimmed)) return false
        if (/^try disabling your extensions/i.test(trimmed)) return false
        if (/is blocked$/i.test(trimmed)) return false
        return true
    })

    // ── Step 2: Detect and remove repeated nav/sidebar blocks ──
    // Navigation blocks look like clusters of heading lines that are just links
    // e.g. "# [Service Name](url)" appearing in groups, repeated 2+ times
    const headingLinkLines = new Map()  // heading text -> count
    for (const line of lines) {
        const match = line.match(/^#{1,6}\s+\[(.+?)\]\(.*?\)\s*$/)
        if (match) {
            const key = match[1].trim().toLowerCase()
            headingLinkLines.set(key, (headingLinkLines.get(key) || 0) + 1)
        }
    }
    // If a heading-link appears 2+ times, it's navigation — remove all instances
    const navHeadings = new Set()
    for (const [text, count] of headingLinkLines) {
        if (count >= 2) navHeadings.add(text)
    }
    if (navHeadings.size > 0) {
        lines = lines.filter(line => {
            const match = line.match(/^#{1,6}\s+\[(.+?)\]\(.*?\)\s*$/)
            if (match && navHeadings.has(match[1].trim().toLowerCase())) return false
            return true
        })
    }

    // ── Step 3: Detect nav/footer blocks by heading density ──
    // If a trailing block is mostly headings with minimal body text, it's nav/footer
    // Scan from the end looking for where real content stops
    let lastContentIdx = lines.length - 1

    // Universal footer patterns (truly generic across all sites)
    const footerPatterns = [
        /^©\s*\d{4}/i,
        /all\s*rights?\s*reserved/i,
        /powered\s*by\s*/i,
        /privacy\s*policy/i,
        /terms\s*(of\s*service|&\s*conditions|\s*of\s*use)/i,
        /^follow\s*us/i,
        /^\[?(facebook|instagram|twitter|linkedin|youtube|tiktok)\]?\s*$/i,
    ]

    // Walk backward, skipping blanks and footer lines
    for (let i = lines.length - 1; i > 0; i--) {
        const trimmed = lines[i].trim()
        if (!trimmed) continue
        if (footerPatterns.some(p => p.test(trimmed))) {
            lastContentIdx = i - 1
            continue
        }
        break
    }

    // Heading-density check on trailing content:
    // If the last ~30 non-empty lines are >60% headings, chop them — that's a nav block
    const trailingLines = lines.slice(Math.max(0, lastContentIdx - 40), lastContentIdx + 1)
    const nonEmptyTrailing = trailingLines.filter(l => l.trim().length > 0)
    if (nonEmptyTrailing.length >= 8) {
        const headingCount = nonEmptyTrailing.filter(l => /^#{1,6}\s+/.test(l)).length
        const headingRatio = headingCount / nonEmptyTrailing.length
        if (headingRatio > 0.6) {
            // Find where this dense heading block starts
            for (let i = lastContentIdx; i > 0; i--) {
                const trimmed = lines[i].trim()
                if (!trimmed) continue
                // Count headings in a sliding window backward
                const windowStart = Math.max(0, i - 10)
                const window = lines.slice(windowStart, i + 1).filter(l => l.trim().length > 0)
                const windowHeadings = window.filter(l => /^#{1,6}\s+/.test(l)).length
                if (window.length >= 4 && windowHeadings / window.length > 0.6) {
                    lastContentIdx = windowStart - 1
                } else {
                    break
                }
            }
        }
    }

    // ── Step 4: Filter individual junk lines ──
    return lines.slice(0, lastContentIdx + 1)
        .filter(line => {
            const trimmed = line.trim()
            // Remove image-only lines: ![alt](url)
            if (/^!\[.*?\]\(.*?\)\s*$/.test(trimmed)) return false
            // Remove standalone phone/CTA lines
            if (/^\[(call|book|schedule|get\s+\d+%)/i.test(trimmed)) return false
            return true
        })
        .join('\n')
        // Collapse 3+ blank lines into 2
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

    const cleaned = cleanMarkdown(data.markdown)

    return {
        site_id: siteId,
        url: url,
        path: parsedUrl.pathname,
        title: data.metadata?.title || '',
        html_content: data.rawHtml,        // Full HTML for reference
        cleaned_html: data.html,           // Cleaned HTML (main content only)
        main_content: cleaned,             // LLM-ready markdown (cleaned)
        headings: headings,
        content_sections: parseSectionsFromMarkdown(cleaned),
        schema_existing: extractSchemaMarkup(data.rawHtml || ''),
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

/**
 * Parse markdown into content sections using heading-based splitting.
 * Auto-detects the "section level" heading (most common among H1-H3).
 * @param {string} markdown - Cleaned markdown content
 * @returns {Array} - [{index, heading, level, content, word_count, has_list, has_faq_pattern}]
 */
export function parseSectionsFromMarkdown(markdown) {
    if (!markdown || markdown.trim().length === 0) return []

    const lines = markdown.split('\n')

    // Count headings at each level (H1-H3 only — H4+ are sub-headings)
    const levelCounts = { 1: 0, 2: 0, 3: 0 }
    const headingLines = []
    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^(#{1,3})\s+(.+)$/)
        if (match) {
            const level = match[1].length
            levelCounts[level]++
            headingLines.push({ lineIndex: i, level, text: match[2].trim() })
        }
    }

    // Determine the section-level heading:
    // - If there's only 1 H1 (page title), skip it and use the next most common
    // - Otherwise, use the heading level with the most occurrences
    let sectionLevel
    if (levelCounts[1] === 1 && (levelCounts[2] > 0 || levelCounts[3] > 0)) {
        // Single H1 = page title; use H2 if available, else H3
        sectionLevel = levelCounts[2] >= levelCounts[3] ? 2 : 3
    } else if (levelCounts[1] > 1) {
        // Multiple H1s — they're being used as sections
        sectionLevel = 1
    } else if (levelCounts[2] > 0) {
        sectionLevel = 2
    } else if (levelCounts[3] > 0) {
        sectionLevel = 3
    } else {
        // No headings at all — treat entire content as one section
        const content = markdown.trim()
        return [{
            index: 1,
            heading: '(No heading)',
            level: 0,
            content: content,
            word_count: content.split(/\s+/).filter(Boolean).length,
            has_list: /^[-*]\s+/m.test(content) || /^\d+\.\s+/m.test(content),
            has_faq_pattern: /\?\s*$/m.test(content)
        }]
    }

    // Split content at section-level headings
    const sectionHeadings = headingLines.filter(h => h.level === sectionLevel)
    const sections = []

    // Check for content before the first section heading (pre-heading content)
    if (sectionHeadings.length > 0 && sectionHeadings[0].lineIndex > 0) {
        const preContent = lines.slice(0, sectionHeadings[0].lineIndex).join('\n').trim()
        if (preContent.length > 0) {
            // Check if there's an H1 in the pre-content
            const h1Match = preContent.match(/^#\s+(.+)$/m)
            sections.push({
                index: 1,
                heading: h1Match ? h1Match[1].trim() : '(Page intro)',
                level: h1Match ? 1 : 0,
                content: preContent,
                word_count: preContent.split(/\s+/).filter(Boolean).length,
                has_list: /^[-*]\s+/m.test(preContent) || /^\d+\.\s+/m.test(preContent),
                has_faq_pattern: false
            })
        }
    }

    // Build sections from each section-level heading to the next
    for (let i = 0; i < sectionHeadings.length; i++) {
        const startIdx = sectionHeadings[i].lineIndex
        const endIdx = i + 1 < sectionHeadings.length
            ? sectionHeadings[i + 1].lineIndex
            : lines.length

        const content = lines.slice(startIdx, endIdx).join('\n').trim()
        const wordCount = content.split(/\s+/).filter(Boolean).length

        // Detect FAQ patterns: headings ending in ?, or Q&A structures
        const hasFaq = /\?\s*$/.test(sectionHeadings[i].text) ||
            (content.match(/\?\s*$/gm) || []).length >= 2 ||
            /frequently\s+asked|faq/i.test(sectionHeadings[i].text)

        sections.push({
            index: sections.length + 1,
            heading: sectionHeadings[i].text,
            level: sectionHeadings[i].level,
            content: content,
            word_count: wordCount,
            has_list: /^[-*]\s+/m.test(content) || /^\d+\.\s+/m.test(content),
            has_faq_pattern: hasFaq
        })
    }

    // ── Post-parse: filter out nav/footer junk sections ──
    const filtered = sections.filter(section => {
        const { content, heading, word_count } = section

        // Skip sections that are mostly links (nav blocks)
        const linkCount = (content.match(/\[.*?\]\(.*?\)/g) || []).length
        if (linkCount >= 3 && word_count < linkCount * 10) return false

        // Skip browser error sections (underscores may be escaped in markdown)
        if (/ERR[\\_]*BLOCKED[\\_]*BY[\\_]*CLIENT/i.test(content)) return false

        // Skip sections whose content is just a heading + a link (thin CTA)
        if (word_count < 15 && linkCount >= 1 && !/faq|question|pricing|cost/i.test(heading)) return false

        // Skip sections with quoted headings (boilerplate like "Our spa locations...")
        if (/^[""]/.test(heading) && linkCount >= 2) return false

        return true
    })

    // Reindex after filtering
    return filtered.map((s, i) => ({ ...s, index: i + 1 }))
}

/**
 * Extract existing JSON-LD schema.org markup from raw HTML.
 * @param {string} rawHtml - Full unmodified HTML
 * @returns {Array} - Array of parsed JSON-LD objects
 */
export function extractSchemaMarkup(rawHtml) {
    if (!rawHtml) return []

    const schemas = []
    const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    let match

    while ((match = regex.exec(rawHtml)) !== null) {
        try {
            const parsed = JSON.parse(match[1].trim())
            // Handle both single objects and arrays of schemas
            if (Array.isArray(parsed)) {
                schemas.push(...parsed)
            } else {
                schemas.push(parsed)
            }
        } catch {
            // Invalid JSON in script tag — skip
        }
    }

    return schemas
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
