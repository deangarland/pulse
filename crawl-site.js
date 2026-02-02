#!/usr/bin/env node
/**
 * Site Crawler
 * Background crawler script that crawls a site and triggers classification on completion.
 * 
 * Usage:
 *   node crawl-site.js --site-id=123 --limit=200 --exclude=/blog/page/*,/tag/*
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { load } from 'cheerio'
import axios from 'axios'
import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Initialize Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
)

// Parse CLI arguments
const args = process.argv.slice(2)
const siteIdArg = args.find(a => a.startsWith('--site-id='))
const limitArg = args.find(a => a.startsWith('--limit='))
const excludeArg = args.find(a => a.startsWith('--exclude='))

const SITE_ID = siteIdArg ? siteIdArg.split('=')[1] : null
const PAGE_LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : 200
const EXCLUDE_PATTERNS = excludeArg ? excludeArg.split('=')[1].split(',') : []

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

    // H1
    const h1 = $('h1').first().text().trim() || null

    // Extract internal links
    const internalLinks = []
    $('a[href]').each((_, el) => {
        const href = $(el).attr('href')
        if (!href) return
        if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return

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
            return parsed.hostname === this.baseUrl.hostname
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
                'User-Agent': 'PulseCrawler/1.0 (SEO Analysis)',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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

    await supabase.from('site_index').update(updates).eq('id', siteId)
}

async function updatePagesCount(siteId, count) {
    await supabase.from('site_index')
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
        meta_description: data.meta_description,
        h1: data.h1,
        status_code: data.statusCode,
        html_content: data.html,
        cleaned_html: data.cleanedHtml,
        crawled_at: new Date().toISOString()
    }

    // Upsert to handle re-crawls
    const { error } = await supabase
        .from('page_index')
        .upsert(pageData, { onConflict: 'site_id,path' })

    if (error) {
        console.error(`  ❌ Error saving ${path}:`, error.message)
    }
}

// ============================================================
// Classifier Integration
// ============================================================

function runClassifier(siteId) {
    return new Promise((resolve, reject) => {
        console.log(`\n🧠 Starting page classification...`)

        const classifier = spawn('node', ['../classify-pages.js', `--site=${siteId}`], {
            cwd: __dirname,
            stdio: 'inherit'
        })

        classifier.on('close', (code) => {
            if (code === 0) {
                resolve()
            } else {
                reject(new Error(`Classifier exited with code ${code}`))
            }
        })

        classifier.on('error', reject)
    })
}

// ============================================================
// Main Crawler
// ============================================================

async function crawlSite() {
    if (!SITE_ID) {
        console.error('Usage: node crawl-site.js --site-id=123 --limit=200')
        process.exit(1)
    }

    console.log(`\n🕷️ Starting crawl for site ${SITE_ID}`)
    console.log(`   Page limit: ${PAGE_LIMIT}`)
    console.log(`   Exclude patterns: ${EXCLUDE_PATTERNS.length > 0 ? EXCLUDE_PATTERNS.join(', ') : 'none'}`)

    // Get site info
    const { data: site, error: siteError } = await supabase
        .from('site_index')
        .select('*')
        .eq('id', SITE_ID)
        .single()

    if (siteError || !site) {
        console.error('Site not found:', siteError?.message)
        process.exit(1)
    }

    console.log(`   URL: ${site.url}`)

    // Initialize queue with starting URL
    const queue = new UrlQueue(site.url, PAGE_LIMIT, EXCLUDE_PATTERNS)
    queue.add(site.url)

    let pagesProcessed = 0

    try {
        await updateSiteStatus(SITE_ID, 'crawling')

        while (queue.canContinue()) {
            const item = queue.next()
            if (!item) break

            const { url } = item

            console.log(`\n📄 [${pagesProcessed + 1}/${PAGE_LIMIT}] ${url}`)
            await updateSiteStatus(SITE_ID, 'crawling', url)

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

            // Clean HTML
            const cleanedHtml = cleanHtml(result.html)
            console.log(`   ✓ Cleaned: ${(result.html.length / 1024).toFixed(0)}KB → ${(cleanedHtml.length / 1024).toFixed(0)}KB`)

            // Save to database
            await savePage(SITE_ID, result.finalUrl, {
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
            await updatePagesCount(SITE_ID, pagesProcessed)
        }

        console.log(`\n✅ Crawl complete! Processed ${pagesProcessed} pages.`)

        // Run classifier
        await updateSiteStatus(SITE_ID, 'classifying')
        await runClassifier(SITE_ID)

        // Mark complete
        await updateSiteStatus(SITE_ID, 'complete')
        console.log(`\n🎉 Site ${SITE_ID} fully processed!`)

    } catch (error) {
        console.error('\n❌ Crawl failed:', error.message)
        await updateSiteStatus(SITE_ID, 'error')
        process.exit(1)
    }
}

// Run
crawlSite().catch(console.error)
