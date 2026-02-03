#!/usr/bin/env node
/**
 * Site Crawler
 * Background crawler script that crawls a site and triggers classification on completion.
 * 
 * Usage:
 *   node crawl-site.js --site-id=123 --limit=200 --exclude=/blog/page/*,/tag/*
 */
import { createClient } from '@supabase/supabase-js'
import { load } from 'cheerio'
import axios from 'axios'
import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Lazy-load dotenv only when running as CLI
const isMainModule = process.argv[1]?.endsWith('crawl-site.js')
if (isMainModule) {
    await import('dotenv/config')
}

// Initialize Supabase lazily
let _supabase = null
function getSupabase() {
    if (!_supabase) {
        // Support both VITE_ prefixed (dev) and non-prefixed (Railway) env vars
        const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
        const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY ||
            process.env.VITE_SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY

        if (!supabaseUrl || !supabaseKey) {
            console.error('Supabase Init Failed. Env vars present:')
            console.error('SUPABASE_URL:', !!process.env.SUPABASE_URL)
            console.error('VITE_SUPABASE_URL:', !!process.env.VITE_SUPABASE_URL)
            console.error('SUPABASE_SERVICE_KEY:', !!process.env.SUPABASE_SERVICE_KEY)
            console.error('VITE_SUPABASE_SERVICE_KEY:', !!process.env.VITE_SUPABASE_SERVICE_KEY)
            throw new Error(`Missing Supabase credentials. URL: ${!!supabaseUrl}, Key: ${!!supabaseKey}`)
        }

        _supabase = createClient(supabaseUrl, supabaseKey)
    }
    return _supabase
}

const DELAY_MS = 500  // Polite delay between requests
const TIMEOUT_MS = 30000
const MAX_CLEANED_HTML_LENGTH = 15000

// ============================================================
// HTML Cleaning (from clean-html.js)
// ============================================================

const KEEP_ATTRIBUTES = new Set([
    'href', 'src', 'alt', 'title',
    'datetime', 'role', 'aria-label', 'aria-labelledby',
    'type', 'rel', 'name', 'content', 'property'
])

const REMOVE_TAGS = new Set([
    'script', 'style', 'noscript', 'iframe', 'svg', 'path', 'link', 'meta'
])

function cleanHtml(rawHtml) {
    if (!rawHtml) return ''

    const $ = load(rawHtml)

    REMOVE_TAGS.forEach(tag => $(tag).remove())

    // Remove comments
    $('*').contents().filter(function () {
        return this.type === 'comment'
    }).remove()

    // Process all elements
    $('*').each((_, el) => {
        const $el = $(el)
        const attribs = el.attribs || {}
        Object.keys(attribs).forEach(attr => {
            if (!KEEP_ATTRIBUTES.has(attr)) {
                $el.removeAttr(attr)
            }
        })
    })

    let cleaned = $.html()
        .replace(/\s+/g, ' ')
        .replace(/>\s+</g, '><')
        .replace(/\s+>/g, '>')
        .replace(/<\s+/g, '<')
        .trim()

    if (cleaned.length > MAX_CLEANED_HTML_LENGTH) {
        const truncatePoint = cleaned.lastIndexOf('>', MAX_CLEANED_HTML_LENGTH)
        if (truncatePoint > MAX_CLEANED_HTML_LENGTH * 0.8) {
            cleaned = cleaned.substring(0, truncatePoint + 1) + '<!-- truncated -->'
        } else {
            cleaned = cleaned.substring(0, MAX_CLEANED_HTML_LENGTH) + '<!-- truncated -->'
        }
    }

    return cleaned
}

// ============================================================
// Page Parsing
// ============================================================

function parsePage(html, baseUrl) {
    const $ = load(html)
    const base = new URL(baseUrl)

    // Title
    const title = $('title').first().text().trim() || null

    // Meta description
    const metaDesc = $('meta[name="description"]').attr('content') || null

    // Canonical URL
    const canonicalUrl = $('link[rel="canonical"]').attr('href') || null

    // H1
    const h1 = $('h1').first().text().trim() || null

    // Extract internal links
    const internalLinks = []
    $('a[href]').each((_, el) => {
        const href = $(el).attr('href')
        if (!href) return
        if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return
        // Skip malformed URLs containing HTML tags (e.g., broken iframe embeds)
        if (href.includes('<') || href.includes('%3C')) return

        try {
            const resolved = new URL(href, base.origin)
            if (resolved.hostname === base.hostname) {
                // Remove fragment
                resolved.hash = ''
                internalLinks.push(resolved.href)
            }
        } catch {
            // Invalid URL, skip
        }
    })

    // Main content (simplified extraction)
    $('script, style, nav, header, footer, aside, noscript, iframe, form').remove()
    const mainContent = $('main, article, [role="main"], .content, #content, body')
        .first().text().replace(/\s+/g, ' ').trim().slice(0, 5000)

    return {
        title,
        meta_description: metaDesc,
        canonical_url: canonicalUrl,
        h1,
        internal_links: [...new Set(internalLinks)],
        main_content: mainContent
    }
}

// ============================================================
// URL Queue
// ============================================================

class UrlQueue {
    constructor(baseUrl, maxPages, excludePatterns = []) {
        this.baseUrl = new URL(baseUrl)
        this.maxPages = maxPages
        this.excludePatterns = excludePatterns
        this.queue = []
        this.seen = new Set()
        this.processedCount = 0
    }

    add(url, depth = 0) {
        const normalized = this.normalizeUrl(url)
        if (!normalized) return false
        if (this.seen.has(normalized)) return false
        if (!this.isSameDomain(normalized)) return false
        if (this.isExcluded(normalized)) return false

        this.queue.push({ url: normalized, depth })
        this.seen.add(normalized)
        return true
    }

    next() {
        return this.queue.shift() || null
    }

    markProcessed() {
        this.processedCount++
    }

    canContinue() {
        return this.processedCount < this.maxPages && this.queue.length > 0
    }

    normalizeUrl(url) {
        try {
            const parsed = new URL(url, this.baseUrl.origin)
            parsed.hash = ''
            parsed.searchParams.sort()
            return parsed.href
        } catch {
            return null
        }
    }

    isSameDomain(url) {
        try {
            const parsed = new URL(url)
            // Normalize by stripping www. prefix to handle redirects
            const normalizeHost = (host) => host.replace(/^www\./, '')
            return normalizeHost(parsed.hostname) === normalizeHost(this.baseUrl.hostname)
        } catch {
            return false
        }
    }

    isExcluded(url) {
        try {
            const parsed = new URL(url)
            const path = parsed.pathname

            for (const pattern of this.excludePatterns) {
                const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
                if (regex.test(path)) {
                    return true
                }
            }
            return false
        } catch {
            return false
        }
    }
}

// ============================================================
// Fetcher
// ============================================================

let lastFetchTime = 0

async function fetchPage(url) {
    // Rate limiting
    const elapsed = Date.now() - lastFetchTime
    if (elapsed < DELAY_MS) {
        await new Promise(resolve => setTimeout(resolve, DELAY_MS - elapsed))
    }

    try {
        const response = await axios.get(url, {
            timeout: TIMEOUT_MS,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            },
            maxRedirects: 5,
            validateStatus: () => true,
            responseType: 'text',
        })

        lastFetchTime = Date.now()

        const contentType = response.headers['content-type'] || ''
        const isHtml = contentType.includes('text/html') || contentType.includes('xhtml')

        return {
            url,
            finalUrl: response.request?.res?.responseUrl || url,
            statusCode: response.status,
            html: isHtml ? response.data : null,
            isHtml,
            contentType
        }
    } catch (error) {
        lastFetchTime = Date.now()
        return {
            url,
            finalUrl: url,
            statusCode: 0,
            html: null,
            isHtml: false,
            error: error.message
        }
    }
}

// ============================================================
// Database Operations
// ============================================================

async function updateSiteStatus(siteId, status, currentUrl = null) {
    const updates = { crawl_status: status, updated_at: new Date().toISOString() }
    if (currentUrl) updates.current_url = currentUrl

    await getSupabase().from('site_index').update(updates).eq('id', siteId)
}

async function updatePagesCount(siteId, count) {
    await getSupabase().from('site_index')
        .update({ pages_crawled: count, updated_at: new Date().toISOString() })
        .eq('id', siteId)
}

async function savePage(siteId, url, data) {
    const path = new URL(url).pathname + new URL(url).search

    const pageData = {
        site_id: siteId,
        url,
        path,
        title: data.title,
        status_code: data.statusCode,
        html_content: data.html,
        cleaned_html: data.cleanedHtml,
        headings: data.headings || null,
        meta_tags: data.meta_tags || null,
        links_internal: data.internal_links || null,
        links_external: data.external_links || null,
        crawled_at: new Date().toISOString()
    }

    // Upsert to handle re-crawls
    const { error } = await getSupabase()
        .from('page_index')
        .upsert(pageData, { onConflict: 'site_id,url' })

    if (error) {
        console.error(`  ❌ Error saving ${path}:`, error.message)
    }
}

// ============================================================
// Classifier Integration
// ============================================================

// ============================================================
// Classifier Integration
// ============================================================

function runClassifier(siteId) {
    return new Promise((resolve, reject) => {
        console.log(`\n🧠 Starting page classification...`)

        // Import dynamically to avoid circular dependencies
        import('./classify-pages.js')
            .then(({ runClassification }) => {
                runClassification(siteId)
                    .then(resolve)
                    .catch(err => reject(new Error(`Classification failed: ${err.message}`)))
            })
            .catch(err => reject(new Error(`Failed to import classifier: ${err.message}`)))
    })
}

// ============================================================
// Main Crawler - Exported for in-process use
// ============================================================

export async function runCrawl(siteId, pageLimit = 200, excludePatterns = []) {
    if (!siteId) {
        throw new Error('siteId is required')
    }

    // Initialize queue with starting URL
    let queue;

    try {
        console.log(`\n🕷️ Starting crawl for site ${siteId}`)
        console.log(`   Page limit: ${pageLimit}`)
        console.log(`   Exclude patterns: ${excludePatterns.length > 0 ? excludePatterns.join(', ') : 'none'}`)

        // Get site info
        const { data: site, error: siteError } = await getSupabase()
            .from('site_index')
            .select('*')
            .eq('id', siteId)
            .single()

        if (siteError || !site) {
            throw new Error(`Site not found: ${siteError?.message}`)
        }

        console.log(`   URL: ${site.url}`)

        queue = new UrlQueue(site.url, pageLimit, excludePatterns)
        queue.add(site.url)

        let pagesProcessed = 0
        await updateSiteStatus(siteId, 'in_progress')

        while (queue.canContinue()) {
            const item = queue.next()
            if (!item) break

            const { url } = item

            console.log(`\n📄 [${pagesProcessed + 1}/${pageLimit}] ${url}`)
            await updateSiteStatus(siteId, 'in_progress', url)

            // Fetch page
            const result = await fetchPage(url)

            if (!result.isHtml || !result.html) {
                console.log(`   ⏭️ Skipped (not HTML or error)`)
                continue
            }

            console.log(`   ✓ Status: ${result.statusCode}`)

            // Parse page
            const parsed = parsePage(result.html, result.finalUrl)
            console.log(`   ✓ Title: ${parsed.title?.slice(0, 50) || '(none)'}...`)

            // Check canonical - skip if it points elsewhere (e.g., paginated pages)
            if (parsed.canonical_url) {
                try {
                    const canonical = new URL(parsed.canonical_url, result.finalUrl).href
                    const current = result.finalUrl
                    // Normalize by removing trailing slashes for comparison
                    const normalizedCanonical = canonical.replace(/\/$/, '')
                    const normalizedCurrent = current.replace(/\/$/, '')
                    if (normalizedCanonical !== normalizedCurrent) {
                        console.log(`   ⏭️ Skipped (canonical points to ${parsed.canonical_url})`)
                        continue
                    }
                } catch {
                    // Invalid canonical URL, proceed anyway
                }
            }

            // Clean HTML
            const cleanedHtml = cleanHtml(result.html)
            console.log(`   ✓ Cleaned: ${(result.html.length / 1024).toFixed(0)}KB → ${(cleanedHtml.length / 1024).toFixed(0)}KB`)

            // Save to database
            await savePage(siteId, result.finalUrl, {
                ...parsed,
                statusCode: result.statusCode,
                html: result.html,
                cleanedHtml
            })

            // Add discovered links to queue
            let addedLinks = 0
            for (const link of parsed.internal_links) {
                if (queue.add(link, item.depth + 1)) {
                    addedLinks++
                }
            }
            console.log(`   ✓ Discovered ${addedLinks} new links`)

            pagesProcessed++
            queue.markProcessed()
            await updatePagesCount(siteId, pagesProcessed)
        }

        console.log(`\n✅ Crawl complete! Processed ${pagesProcessed} pages.`)

        // Run classifier
        await updateSiteStatus(siteId, 'classifying')
        await runClassifier(siteId)

        // Mark complete
        await updateSiteStatus(siteId, 'complete')
        console.log(`\n🎉 Site ${siteId} fully processed!`)

    } catch (error) {
        console.error('\n❌ Crawl failed:', error.message)
        await updateSiteStatus(siteId, 'error')
        throw error
    }
}

// CLI entry point - only runs when executed directly
if (isMainModule) {
    const args = process.argv.slice(2)
    const siteIdArg = args.find(a => a.startsWith('--site-id='))
    const limitArg = args.find(a => a.startsWith('--limit='))
    const excludeArg = args.find(a => a.startsWith('--exclude='))

    const siteId = siteIdArg ? siteIdArg.split('=')[1] : null
    const pageLimit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 200
    const excludePatterns = excludeArg ? excludeArg.split('=')[1].split(',') : []

    if (!siteId) {
        console.error('Usage: node crawl-site.js --site-id=123 --limit=200')
        process.exit(1)
    }

    runCrawl(siteId, pageLimit, excludePatterns)
        .then(() => process.exit(0))
        .catch(() => process.exit(1))
}
