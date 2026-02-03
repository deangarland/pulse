import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(cors())
app.use(express.json())

// Supabase client
const supabase = createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
    process.env.VITE_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY
)

// OpenAI client (optional - only needed for generation endpoints)
let openai = null
if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
    })
} else {
    console.log('Warning: OPENAI_API_KEY not set - AI generation endpoints will be unavailable')
}

// Anthropic (Claude) client
const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
}) : null

// Google Gemini client
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null

// ============================================
// AI Model Pricing (per 1M tokens, in cents)
// ============================================
const MODEL_PRICING = {
    // OpenAI
    'o3-mini': { input: 110, output: 440 },
    'o1': { input: 1500, output: 6000 },
    'o1-mini': { input: 300, output: 1200 },
    'gpt-4.5-preview': { input: 250, output: 1000 },
    'gpt-4o': { input: 250, output: 1000 },
    'gpt-4o-mini': { input: 15, output: 60 },
    'gpt-4-turbo': { input: 1000, output: 3000 },
    'gpt-4-turbo-preview': { input: 1000, output: 3000 },
    'gpt-4': { input: 3000, output: 6000 },
    'gpt-3.5-turbo': { input: 50, output: 150 },
    // Anthropic Claude 4.5
    'claude-opus-4-5-20251101': { input: 500, output: 2500 },
    'claude-sonnet-4-5-20250929': { input: 300, output: 1500 },
    'claude-haiku-4-5-20251001': { input: 100, output: 500 },
    // Google Gemini 2.5
    'gemini-2.5-pro': { input: 125, output: 1000 },
    'gemini-2.5-flash': { input: 15, output: 60 },
    'gemini-2.5-flash-lite': { input: 7.5, output: 30 },
}

// Helper to calculate cost in cents
function calculateCost(model, inputTokens, outputTokens) {
    const pricing = MODEL_PRICING[model] || { input: 0, output: 0 }
    // pricing is in cents per 1M tokens
    // Example: gpt-4o = 250 cents ($2.50) per 1M input tokens
    // For 1000 tokens: (1000 / 1000000) * 250 = 0.25 cents
    const inputCostCents = Math.round((inputTokens / 1000000) * pricing.input)
    const outputCostCents = Math.round((outputTokens / 1000000) * pricing.output)
    return { inputCostCents, outputCostCents }
}

// Log AI usage to database
async function logAIUsage({
    action,
    pageId = null,
    pageUrl = null,
    provider,
    model,
    inputTokens,
    outputTokens,
    requestDurationMs = null,
    success = true,
    errorMessage = null
}) {
    try {
        const { inputCostCents, outputCostCents } = calculateCost(model, inputTokens, outputTokens)

        await supabase.from('ai_usage_logs').insert({
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

        console.log(`📊 AI Usage: ${action} | ${model} | ${inputTokens}+${outputTokens} tokens | $${((inputCostCents + outputCostCents) / 100).toFixed(4)}`)
    } catch (error) {
        console.error('Failed to log AI usage:', error.message)
    }
}

const DEFAULT_SYSTEM_PROMPT = `You are an expert SEO consultant specializing in healthcare and medical aesthetics websites. Your role is to analyze web pages and provide optimized meta tags and schema markup recommendations.

For every recommendation, you MUST explain your reasoning - why you're making this specific change and what benefit it provides.

Focus on:
- Local SEO optimization (include location when relevant)
- Rich snippet eligibility (structured data for enhanced search results)
- Answer Engine Optimization (AEO) - structuring content for AI-powered search
- Clear, compelling copy that drives clicks

Your recommendations should be specific to healthcare/medical practices and their procedures.`

// Fetch system prompt from database
async function getSystemPrompt(promptName = 'Meta & Schema Recommendations') {
    try {
        const { data, error } = await supabase
            .from('prompts')
            .select('system_prompt')
            .eq('name', promptName)
            .single()

        if (error || !data) {
            console.log('Using default system prompt (DB prompt not found)')
            return DEFAULT_SYSTEM_PROMPT
        }
        return data.system_prompt
    } catch (err) {
        console.log('Using default system prompt (fetch failed)')
        return DEFAULT_SYSTEM_PROMPT
    }
}

const USER_PROMPT_TEMPLATE = `Analyze this page and provide optimized recommendations:

**Page URL:** {{url}}
**Page Type:** {{page_type}}
**Current Title:** {{current_title}}
**Current Meta Description:** {{current_description}}
**Current Schema Markup:** {{current_schema}}

**Page Content Summary:**
{{content_summary}}

**Headings on page:**
{{headings}}

---

Provide your recommendations in this exact JSON format:
{
  "meta": {
    "title": {
      "recommended": "Your optimized title tag (50-60 chars)",
      "reasoning": "Explain why this title is better - what SEO/UX benefits it provides"
    },
    "description": {
      "recommended": "Your optimized meta description (150-160 chars)",
      "reasoning": "Explain why this description is better - what improvements it makes"
    }
  },
  "schemas": [
    {
      "type": "SchemaType (e.g., LocalBusiness, MedicalProcedure, FAQPage)",
      "priority": "high|medium|low",
      "reasoning": "Why this schema type is recommended for this page",
      "json_ld": { ...complete JSON-LD object... }
    }
  ],
  "overall_reasoning": "High-level summary of the SEO strategy for this page"
}

Only include schema types that are genuinely relevant to this page content. Be specific in your reasoning.`

function buildPrompt(page) {
    const headings = page.headings || {}
    const headingsText = [
        ...(headings.h1 || []).map(h => `H1: ${h}`),
        ...(headings.h2 || []).map(h => `H2: ${h}`),
        ...(headings.h3 || []).slice(0, 5).map(h => `H3: ${h}`)
    ].join('\n') || 'No headings found'

    const metaTags = page.meta_tags || {}
    const currentSchema = page.schema_markup?.length > 0
        ? JSON.stringify(page.schema_markup, null, 2)
        : 'None found'

    const contentSummary = (page.main_content || '')
        .substring(0, 2000)
        .replace(/\s+/g, ' ')
        .trim() || 'No content extracted'

    return USER_PROMPT_TEMPLATE
        .replace('{{url}}', page.url)
        .replace('{{page_type}}', page.page_type || 'Unknown')
        .replace('{{current_title}}', metaTags.title || page.title || 'None')
        .replace('{{current_description}}', metaTags.description || 'None')
        .replace('{{current_schema}}', currentSchema)
        .replace('{{content_summary}}', contentSummary)
        .replace('{{headings}}', headingsText)
}

// API Routes
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        openai: !!process.env.OPENAI_API_KEY,
        anthropic: !!process.env.ANTHROPIC_API_KEY,
        gemini: !!process.env.GEMINI_API_KEY
    })
})

app.post('/api/generate-recommendations', async (req, res) => {
    try {
        const { pageId, model } = req.body

        if (!pageId) {
            return res.status(400).json({ error: 'pageId is required' })
        }

        // Model mappings by provider
        const OPENAI_MODELS = [
            'o3-mini', 'o1', 'o1-mini',
            'gpt-4.5-preview',
            'gpt-4o', 'gpt-4o-mini',
            'gpt-4-turbo', 'gpt-4-turbo-preview', 'gpt-4',
            'gpt-3.5-turbo'
        ]
        const ANTHROPIC_MODELS = [
            'claude-opus-4-5-20251101', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001'
        ]
        const GEMINI_MODELS = [
            'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'
        ]

        // Determine provider and validate model
        let provider = 'openai'
        let selectedModel = 'gpt-4o'

        if (model) {
            if (OPENAI_MODELS.includes(model)) {
                if (!openai) {
                    return res.status(400).json({ error: 'OpenAI API key not configured' })
                }
                provider = 'openai'
                selectedModel = model
            } else if (ANTHROPIC_MODELS.includes(model)) {
                if (!anthropic) {
                    return res.status(400).json({ error: 'Anthropic API key not configured' })
                }
                provider = 'anthropic'
                selectedModel = model
            } else if (GEMINI_MODELS.includes(model)) {
                if (!genAI) {
                    return res.status(400).json({ error: 'Gemini API key not configured' })
                }
                provider = 'gemini'
                selectedModel = model
            }
        }

        // Fetch page data
        const { data: page, error: fetchError } = await supabase
            .from('page_index')
            .select('*')
            .eq('id', pageId)
            .single()

        if (fetchError) {
            return res.status(404).json({ error: `Page not found: ${fetchError.message}` })
        }

        // Fetch system prompt from database
        const systemPrompt = await getSystemPrompt()

        // Generate recommendations
        const prompt = buildPrompt(page)
        let content

        // Track timing and tokens
        const startTime = Date.now()
        let inputTokens = 0
        let outputTokens = 0

        if (provider === 'openai') {
            const response = await openai.chat.completions.create({
                model: selectedModel,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.7,
                max_tokens: 4000
            })
            content = response.choices[0]?.message?.content
            // Capture token usage
            inputTokens = response.usage?.prompt_tokens || 0
            outputTokens = response.usage?.completion_tokens || 0

        } else if (provider === 'anthropic') {
            const response = await anthropic.messages.create({
                model: selectedModel,
                max_tokens: 4000,
                system: systemPrompt,
                messages: [
                    { role: 'user', content: prompt + '\n\nRespond with valid JSON only.' }
                ]
            })
            content = response.content[0]?.text
            // Capture token usage
            inputTokens = response.usage?.input_tokens || 0
            outputTokens = response.usage?.output_tokens || 0

        } else if (provider === 'gemini') {
            const geminiModel = genAI.getGenerativeModel({ model: selectedModel })
            const result = await geminiModel.generateContent({
                contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + prompt + '\n\nRespond with valid JSON only.' }] }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 4000,
                    responseMimeType: 'application/json'
                }
            })
            content = result.response.text()
            // Capture token usage
            const usageMetadata = result.response.usageMetadata
            inputTokens = usageMetadata?.promptTokenCount || 0
            outputTokens = usageMetadata?.candidatesTokenCount || 0
        }

        const requestDurationMs = Date.now() - startTime

        if (!content) {
            // Log failed attempt
            await logAIUsage({
                action: 'meta_schema_generation',
                pageId,
                pageUrl: page.url,
                provider,
                model: selectedModel,
                inputTokens,
                outputTokens,
                requestDurationMs,
                success: false,
                errorMessage: `No response from ${provider}`
            })
            return res.status(500).json({ error: `No response from ${provider}` })
        }

        // Parse JSON - handle potential markdown wrapping
        let jsonContent = content.trim()
        if (jsonContent.startsWith('```')) {
            jsonContent = jsonContent.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
        }
        const recommendations = JSON.parse(jsonContent)

        // Log successful usage
        await logAIUsage({
            action: 'meta_schema_generation',
            pageId,
            pageUrl: page.url,
            provider,
            model: selectedModel,
            inputTokens,
            outputTokens,
            requestDurationMs,
            success: true
        })

        // Save to database
        const { error: updateError } = await supabase
            .from('page_index')
            .update({
                meta_recommendation: recommendations.meta,
                schema_recommendation: {
                    schemas: recommendations.schemas,
                    overall_reasoning: recommendations.overall_reasoning
                },
                recommendation_generated_at: new Date().toISOString()
            })
            .eq('id', pageId)

        if (updateError) {
            return res.status(500).json({ error: `Failed to save: ${updateError.message}` })
        }

        res.json({
            success: true,
            recommendations,
            provider,
            model: selectedModel,
            tokens: { input: inputTokens, output: outputTokens },
            message: 'Recommendations generated successfully'
        })

    } catch (error) {
        console.error('Generate error:', error)
        res.status(500).json({ error: error.message })
    }
})

// ============================================
// Unified Schema Generator API
// Uses batch-generate-schemas logic for single page
// ============================================

// Helper: Extract page fields using LLM (for procedures)
async function extractProcedureFieldsWithLLM(page) {
    if (!openai) return { bodyLocation: null, procedureType: null, howPerformed: null, preparation: null, followup: null }

    const content = `
Title: ${page.title || ''}
Description: ${page.meta_tags?.description || ''}
Content: ${(page.main_content || '').substring(0, 3000)}
    `.trim()

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

CRITICAL: Only include information that is explicitly stated on the page. Return null for any field where the page does not provide that information.`

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens: 350,
            response_format: { type: 'json_object' }
        })

        const result = JSON.parse(response.choices[0].message.content)
        const normalize = (val) => val === 'null' || val === null || val === '' ? null : val

        return {
            bodyLocation: normalize(result.bodyLocation),
            procedureType: normalize(result.procedureType),
            howPerformed: normalize(result.howPerformed),
            preparation: normalize(result.preparation),
            followup: normalize(result.followup),
            tokens: { input: response.usage?.prompt_tokens || 0, output: response.usage?.completion_tokens || 0 }
        }
    } catch (error) {
        console.error('LLM extraction error:', error.message)
        return { bodyLocation: null, procedureType: null, howPerformed: null, preparation: null, followup: null, tokens: { input: 0, output: 0 } }
    }
}

// Helper: Extract team member fields using LLM
async function extractTeamMemberFieldsWithLLM(page) {
    if (!openai) return { name: null, jobTitle: null, credentials: null, isPhysician: false, specialties: [], education: null, tokens: { input: 0, output: 0 } }

    const content = `
Title: ${page.title || ''}
Description: ${page.meta_tags?.description || ''}
Content: ${(page.main_content || '').substring(0, 2000)}
    `.trim()

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

Return null for any field not explicitly mentioned on the page.`

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens: 300,
            response_format: { type: 'json_object' }
        })

        const result = JSON.parse(response.choices[0].message.content)
        const normalize = (val) => val === 'null' || val === null || val === '' ? null : val

        return {
            name: normalize(result.name),
            jobTitle: normalize(result.jobTitle),
            credentials: normalize(result.credentials),
            isPhysician: result.isPhysician === true,
            specialties: Array.isArray(result.specialties) ? result.specialties.filter(s => s) : [],
            education: normalize(result.education),
            tokens: { input: response.usage?.prompt_tokens || 0, output: response.usage?.completion_tokens || 0 }
        }
    } catch (error) {
        console.error('Team member extraction error:', error.message)
        return { name: null, jobTitle: null, credentials: null, isPhysician: false, specialties: [], education: null, tokens: { input: 0, output: 0 } }
    }
}

// POST /api/generate-schema - Unified schema generator using batch logic
app.post('/api/generate-schema', async (req, res) => {
    try {
        const { pageId, includeMedium = false } = req.body

        if (!pageId) {
            return res.status(400).json({ error: 'pageId is required' })
        }

        // 1. Fetch page data
        const { data: page, error: pageError } = await supabase
            .from('page_index')
            .select('id, site_id, path, url, title, meta_tags, headings, main_content, html_content, page_type')
            .eq('id', pageId)
            .single()

        if (pageError || !page) {
            return res.status(404).json({ error: 'Page not found' })
        }

        if (!page.page_type) {
            return res.status(400).json({ error: 'Page not classified. Run classifier first.' })
        }

        // 2. Fetch schema config from schema_org table
        const { data: schemaConfig, error: configError } = await supabase
            .from('schema_org')
            .select('*')
            .eq('page_type', page.page_type)
            .single()

        if (configError || !schemaConfig) {
            return res.status(400).json({ error: `No schema config found for page type: ${page.page_type}` })
        }

        // Check tier - skip LOW, optionally skip MEDIUM
        if (schemaConfig.tier === 'LOW') {
            // Save as skipped
            await supabase
                .from('page_index')
                .update({
                    schema_status: 'skipped',
                    schema_errors: [{ type: 'skipped', message: schemaConfig.reason }],
                    schema_generated_at: new Date().toISOString()
                })
                .eq('id', pageId)

            return res.json({
                success: true,
                skipped: true,
                reason: `LOW tier - ${schemaConfig.reason}`,
                pageType: page.page_type
            })
        }

        if (schemaConfig.tier === 'MEDIUM' && !includeMedium) {
            await supabase
                .from('page_index')
                .update({
                    schema_status: 'skipped',
                    schema_errors: [{ type: 'skipped', message: 'MEDIUM tier - use includeMedium to generate' }],
                    schema_generated_at: new Date().toISOString()
                })
                .eq('id', pageId)

            return res.json({
                success: true,
                skipped: true,
                reason: 'MEDIUM tier - enable includeMedium to generate',
                pageType: page.page_type
            })
        }

        // 3. Fetch site data for provider info
        const { data: site } = await supabase
            .from('site_index')
            .select('url, site_profile, account_id')
            .eq('id', page.site_id)
            .single()

        const siteUrl = site?.url || ''
        const siteProfile = site?.site_profile || {}
        const pageUrl = page.url || `${siteUrl}${page.path}`

        // Track tokens for AI usage
        let totalInputTokens = 0
        let totalOutputTokens = 0

        // 4. Generate schema based on page type
        const schemas = []
        const startTime = Date.now()

        switch (page.page_type) {
            case 'PROCEDURE': {
                const title = page.title?.split('|')[0]?.trim() || 'Treatment'
                const desc = page.meta_tags?.description || ''

                // Extract fields with LLM
                const extracted = await extractProcedureFieldsWithLLM(page)
                totalInputTokens += extracted.tokens?.input || 0
                totalOutputTokens += extracted.tokens?.output || 0

                const procedureSchema = {
                    "@type": "MedicalProcedure",
                    "@id": `${pageUrl}#procedure`,
                    "name": title,
                    "url": pageUrl,
                    "mainEntityOfPage": pageUrl,
                    "description": desc,
                    "image": page.meta_tags?.['og:image'] || siteProfile?.image_url || undefined,
                    "provider": siteProfile?.business_name ? {
                        "@type": "MedicalBusiness",
                        "@id": `${siteUrl}/#organization`,
                        "name": siteProfile.business_name,
                        "url": siteUrl,
                        "telephone": siteProfile.phone
                    } : undefined
                }

                // Add extracted fields if present
                if (extracted.procedureType) procedureSchema.procedureType = extracted.procedureType
                if (extracted.bodyLocation) procedureSchema.bodyLocation = extracted.bodyLocation
                if (extracted.preparation) procedureSchema.preparation = extracted.preparation
                if (extracted.howPerformed) procedureSchema.howPerformed = extracted.howPerformed
                if (extracted.followup) procedureSchema.followup = extracted.followup

                // Remove undefined values
                Object.keys(procedureSchema).forEach(key => {
                    if (procedureSchema[key] === undefined) delete procedureSchema[key]
                })

                schemas.push(procedureSchema)
                break
            }

            case 'RESOURCE': {
                const title = page.title?.split('|')[0]?.trim() || ''
                const desc = page.meta_tags?.description || ''

                schemas.push({
                    "@type": "BlogPosting",
                    "headline": title,
                    "description": desc,
                    "url": pageUrl,
                    "datePublished": page.meta_tags?.['article:published_time'] || new Date().toISOString(),
                    "dateModified": page.meta_tags?.['article:modified_time'] || new Date().toISOString(),
                    "author": siteProfile?.owner?.name ? {
                        "@type": "Person",
                        "name": siteProfile.owner.name,
                        "@id": `${siteUrl}/#physician`
                    } : undefined,
                    "publisher": siteProfile?.business_name ? {
                        "@type": "Organization",
                        "@id": `${siteUrl}/#organization`
                    } : undefined
                })
                break
            }

            case 'GALLERY': {
                const title = page.title?.split('|')[0]?.split('-')[0]?.trim() || 'Gallery'
                schemas.push({
                    "@type": "ImageGallery",
                    "name": `${title} Before & After Gallery`,
                    "description": `Before and after photos for ${title}.`,
                    "url": pageUrl
                })
                break
            }

            case 'TEAM_MEMBER': {
                const extracted = await extractTeamMemberFieldsWithLLM(page)
                totalInputTokens += extracted.tokens?.input || 0
                totalOutputTokens += extracted.tokens?.output || 0

                const title = page.title?.split('|')[0]?.split('-')[0]?.trim() || ''
                const desc = page.meta_tags?.description || ''

                const personSchema = {
                    "@type": extracted.isPhysician ? "Physician" : "Person",
                    "@id": `${pageUrl}#person`,
                    "name": extracted.name || title,
                    "url": pageUrl,
                    "description": desc,
                    "image": page.meta_tags?.['og:image'] || undefined,
                    "worksFor": siteProfile?.business_name ? {
                        "@type": "MedicalBusiness",
                        "@id": `${siteUrl}/#organization`,
                        "name": siteProfile.business_name
                    } : undefined
                }

                if (extracted.jobTitle) personSchema.jobTitle = extracted.jobTitle
                if (extracted.credentials) personSchema.honorificSuffix = extracted.credentials
                if (extracted.specialties?.length > 0) personSchema.knowsAbout = extracted.specialties
                if (extracted.education) personSchema.alumniOf = { "@type": "EducationalOrganization", "name": extracted.education }

                Object.keys(personSchema).forEach(key => {
                    if (personSchema[key] === undefined) delete personSchema[key]
                })

                schemas.push(personSchema)
                break
            }

            case 'HOMEPAGE':
            case 'CONTACT':
            case 'LOCATION': {
                // LocalBusiness schema
                const addr = siteProfile?.address
                if (addr?.street && addr?.city) {
                    schemas.push({
                        "@type": siteProfile?.business_type || "MedicalBusiness",
                        "@id": `${siteUrl}#localbusiness`,
                        "name": siteProfile.business_name,
                        "url": siteUrl,
                        "telephone": siteProfile.phone,
                        "address": {
                            "@type": "PostalAddress",
                            "streetAddress": addr.street,
                            "addressLocality": addr.city,
                            "addressRegion": addr.state,
                            "postalCode": addr.zip,
                            "addressCountry": addr.country || "US"
                        }
                    })
                } else {
                    return res.json({
                        success: true,
                        skipped: true,
                        reason: 'Missing required business address in site_profile',
                        pageType: page.page_type
                    })
                }
                break
            }

            default:
                return res.json({
                    success: true,
                    skipped: true,
                    reason: `Schema generation not implemented for ${page.page_type}`,
                    pageType: page.page_type
                })
        }

        // 5. Wrap in @graph structure
        const wrappedSchema = schemas.length > 0 ? {
            "@context": "https://schema.org",
            "@graph": schemas
        } : null

        // 6. Save to recommended_schema column
        const requestDurationMs = Date.now() - startTime

        const { error: updateError } = await supabase
            .from('page_index')
            .update({
                recommended_schema: wrappedSchema,
                schema_status: 'validated',
                schema_errors: null,
                schema_generated_at: new Date().toISOString()
            })
            .eq('id', pageId)

        if (updateError) {
            return res.status(500).json({ error: `Failed to save schema: ${updateError.message}` })
        }

        // Log AI usage if tokens were used
        if (totalInputTokens > 0 || totalOutputTokens > 0) {
            await logAIUsage({
                action: 'generate_schema',
                pageId,
                pageUrl,
                provider: 'openai',
                model: 'gpt-4o-mini',
                inputTokens: totalInputTokens,
                outputTokens: totalOutputTokens,
                requestDurationMs,
                success: true
            })
        }

        res.json({
            success: true,
            skipped: false,
            schema: wrappedSchema,
            pageType: page.page_type,
            schemaType: schemaConfig.schema_type,
            tokens: { input: totalInputTokens, output: totalOutputTokens },
            message: 'Schema generated successfully'
        })

    } catch (error) {
        console.error('Generate schema error:', error)
        res.status(500).json({ error: error.message })
    }
})

// ============================================
// POST /api/generate-schema-v2 - Template-based schema generation with LLM
// Uses schema_templates table and prompts for flexible schema generation
// ============================================
app.post('/api/generate-schema-v2', async (req, res) => {
    try {
        const { pageId, includeMedium = false, useTemplates = true } = req.body

        if (!pageId) {
            return res.status(400).json({ error: 'pageId is required' })
        }

        const startTime = Date.now()

        // 1. Fetch page data
        const { data: page, error: pageError } = await supabase
            .from('page_index')
            .select('id, site_id, path, url, title, meta_tags, headings, main_content, html_content, page_type')
            .eq('id', pageId)
            .single()

        if (pageError || !page) {
            return res.status(404).json({ error: 'Page not found' })
        }

        if (!page.page_type) {
            return res.status(400).json({ error: 'Page not classified. Run classifier first.' })
        }

        // 2. Fetch schema config from schema_org table
        const { data: schemaConfig, error: configError } = await supabase
            .from('schema_org')
            .select('*')
            .eq('page_type', page.page_type)
            .single()

        if (configError || !schemaConfig) {
            return res.status(400).json({ error: `No schema config found for page type: ${page.page_type}` })
        }

        // Check tier
        if (schemaConfig.tier === 'LOW') {
            await supabase
                .from('page_index')
                .update({
                    schema_status: 'skipped',
                    schema_errors: [{ type: 'skipped', message: schemaConfig.reason || 'LOW tier' }],
                    schema_generated_at: new Date().toISOString()
                })
                .eq('id', pageId)

            return res.json({
                success: true,
                skipped: true,
                reason: `LOW tier - ${schemaConfig.reason || 'Not prioritized'}`,
                pageType: page.page_type
            })
        }

        if (schemaConfig.tier === 'MEDIUM' && !includeMedium) {
            await supabase
                .from('page_index')
                .update({
                    schema_status: 'skipped',
                    schema_errors: [{ type: 'skipped', message: 'MEDIUM tier - use includeMedium to generate' }],
                    schema_generated_at: new Date().toISOString()
                })
                .eq('id', pageId)

            return res.json({
                success: true,
                skipped: true,
                reason: 'MEDIUM tier - enable includeMedium to generate',
                pageType: page.page_type
            })
        }

        // 3. Fetch site data for provider info
        const { data: site } = await supabase
            .from('site_index')
            .select('url, site_profile, account_id')
            .eq('id', page.site_id)
            .single()

        const siteUrl = site?.url || ''
        const siteProfile = site?.site_profile || {}
        const pageUrl = page.url || `${siteUrl}${page.path}`

        // 4. Fetch templates for the linked schemas
        const linkedSchemas = schemaConfig.linked_schemas || []
        const allSchemaTypes = [schemaConfig.schema_type, ...linkedSchemas]

        const { data: templates } = await supabase
            .from('schema_templates')
            .select('*')
            .in('schema_type', allSchemaTypes)

        const templateMap = {}
        templates?.forEach(t => {
            templateMap[t.schema_type] = t
        })

        // 5. Fetch the generation prompt
        const { data: promptData } = await supabase
            .from('prompts')
            .select('system_prompt, user_prompt_template, default_model')
            .eq('name', 'Schema: Full JSON-LD Generation')
            .single()

        // Prepare content preview (first 3000 chars of main content for better context)
        const contentPreview = (page.main_content || page.html_content || '').substring(0, 3000)

        // 6. Build the prompt with comprehensive skill rules
        const systemPrompt = promptData?.system_prompt || `You are an expert at generating JSON-LD schema markup for healthcare/medical websites.

CRITICAL RULES:
1. LocalBusiness/Organization schema goes on HOMEPAGE ONLY - not on every page
2. Each page type has specific required schemas - follow the requirements strictly
3. Use @graph format with @id references to link entities on the same page
4. For cross-page references, include essential info inline (not just @id)
5. NEVER use placeholders like [EXTRACT], [TODO], or empty strings - omit fields if data unavailable
6. Only include FAQ schema if the page has visible FAQ content
7. Schema must accurately reflect visible page content

VALIDATION REQUIREMENTS:
- All required properties must be present
- FAQ answers must be > 50 characters
- Descriptions > 30 characters
- URLs must be fully qualified (https://)
- Dates in ISO 8601 format
- Phone numbers include area code

Return ONLY valid JSON, no markdown or explanation.`

        // Build page type specific requirements
        const pageTypeRequirements = {
            'HOMEPAGE': 'Required: LocalBusiness (with address, phone, hours, geo), Organization. Optional: WebSite with SearchAction, AggregateRating.',
            'PROCEDURE': 'Required: MedicalProcedure (name, url, description, provider, bodyLocation, howPerformed). Optional: FAQPage if FAQ content exists. NO LocalBusiness on procedure pages.',
            'TEAM_MEMBER': 'Required: Person or Physician (name, jobTitle, image, worksFor, knowsAbout, credentials). Board certifications go in memberOf.',
            'RESOURCE': 'Required: BlogPosting or Article (headline, datePublished, author with full details, publisher).',
            'GALLERY': 'Required: ImageGallery or CollectionPage (name, description). Optional: ImageObject for each image.',
            'CONTACT': 'Required: ContactPage with mainEntity referencing Organization. Include BreadcrumbList.',
            'LOCATION': 'Required: LocalBusiness for that specific location with full address, geo, and hours.',
            'ABOUT': 'Required: AboutPage or ProfilePage. If showing multiple people, use Organization. If single person, use Person/Physician.',
            'CONDITION': 'Required: MedicalCondition with name, description. Optional: FAQPage if content exists.',
            'CATEGORY': 'Required: CollectionPage with ItemList of linked items.',
            'GENERIC': 'Minimal schema - BreadcrumbList only unless page has specific rich content.'
        }

        const requirements = pageTypeRequirements[page.page_type] || pageTypeRequirements['GENERIC']

        const userPrompt = `Generate JSON-LD schema markup for this ${page.page_type} page.

PAGE URL: ${pageUrl}
SITE URL: ${siteUrl}

PAGE TYPE REQUIREMENTS:
${requirements}

PAGE DATA:
Title: ${page.title || 'N/A'}
Meta Description: ${page.meta_tags?.description || 'N/A'}
Headings: ${JSON.stringify(page.headings || {})}
Content Preview:
${contentPreview}

SITE PROFILE (use for provider/organization info):
Business Name: ${siteProfile?.business_name || 'Unknown'}
Phone: ${siteProfile?.phone || 'N/A'}
Business Type: ${siteProfile?.business_type || 'MedicalBusiness'}
Address: ${JSON.stringify(siteProfile?.address || {}, null, 2)}
Geo: ${JSON.stringify(siteProfile?.geo || {})}
Hours: ${JSON.stringify(siteProfile?.hours || [])}
Owner: ${JSON.stringify(siteProfile?.owner || {})}
Social Media: ${JSON.stringify(siteProfile?.social_media || [])}
Rating: ${JSON.stringify(siteProfile?.rating || {})}

PRIMARY SCHEMA TYPE: ${schemaConfig.schema_type}
ADDITIONAL SCHEMAS TO INCLUDE: ${linkedSchemas.join(', ') || 'None'}

TEMPLATE FIELD REFERENCE:
${allSchemaTypes.map(type => {
            const t = templateMap[type]
            if (!t) return `- ${type}: (no template available)`
            return `- ${type}:
  Required fields: ${t.required_fields?.join(', ') || 'none'}
  Optional fields: ${t.optional_fields?.join(', ') || 'none'}
  Nesting rules: ${JSON.stringify(t.nesting_rules || {})}`
        }).join('\n')}

INSTRUCTIONS:
1. Generate a complete @graph array based on the page type requirements above
2. Include the primary ${schemaConfig.schema_type} schema with all applicable fields from the page content
3. Add linked schemas: ${linkedSchemas.join(', ') || 'none'}
4. Use @id format: "${pageUrl}#[schema-type-lowercase]" (e.g., "${pageUrl}#procedure")
5. For MedicalProcedure: extract bodyLocation, howPerformed, preparation, followup from content if mentioned
6. For provider/performedBy: include full inline details from site profile
7. Omit any field where data is not available - do NOT use placeholders

Return ONLY valid JSON:
{
  "@context": "https://schema.org",
  "@graph": [...]
}`

        // 7. Call LLM
        let totalInputTokens = 0
        let totalOutputTokens = 0
        let generatedSchema = null
        const model = promptData?.default_model || 'gpt-4o-mini'

        try {
            const completion = await openai.chat.completions.create({
                model: model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.3
            })

            totalInputTokens = completion.usage?.prompt_tokens || 0
            totalOutputTokens = completion.usage?.completion_tokens || 0

            const content = completion.choices[0]?.message?.content
            if (content) {
                generatedSchema = JSON.parse(content)
            }
        } catch (llmError) {
            console.error('LLM error in schema generation:', llmError.message)
            return res.status(500).json({
                error: 'LLM generation failed',
                details: llmError.message
            })
        }

        // Validate the schema structure
        if (!generatedSchema || !generatedSchema['@graph']) {
            return res.status(500).json({
                error: 'Invalid schema structure - missing @graph',
                generated: generatedSchema
            })
        }

        // 8. Validate schema based on skill rules
        const validationErrors = []
        const graph = generatedSchema['@graph'] || []

        // Check for placeholder text
        const jsonStr = JSON.stringify(generatedSchema)
        if (/\[EXTRACT|\[TODO|\[PHONE|\[ADDRESS|\[NAME/i.test(jsonStr)) {
            validationErrors.push('Schema contains placeholder text - should be omitted or filled')
        }

        // Validate each schema in graph
        graph.forEach((schema, idx) => {
            const schemaType = schema['@type']

            // Check for empty strings
            Object.entries(schema).forEach(([key, value]) => {
                if (value === '' || value === 'N/A' || value === 'Unknown') {
                    validationErrors.push(`${schemaType}: Empty or placeholder value for '${key}'`)
                }
            })

            // FAQ specific validation
            if (schemaType === 'FAQPage' && schema.mainEntity) {
                schema.mainEntity.forEach((q, i) => {
                    const answerText = q.acceptedAnswer?.text || ''
                    if (answerText.length < 50) {
                        validationErrors.push(`FAQ answer ${i + 1} is too short (${answerText.length} chars, need 50+)`)
                    }
                })
            }

            // MedicalProcedure: check for required fields
            if (schemaType === 'MedicalProcedure') {
                if (!schema.name) validationErrors.push('MedicalProcedure: missing required field "name"')
                if (!schema.url) validationErrors.push('MedicalProcedure: missing required field "url"')
                if (!schema.description && !schema.howPerformed) {
                    validationErrors.push('MedicalProcedure: should have description or howPerformed')
                }
            }

            // LocalBusiness: check it's only on homepage
            if ((schemaType === 'LocalBusiness' || schemaType.includes('Business')) && page.page_type !== 'HOMEPAGE' && page.page_type !== 'LOCATION' && page.page_type !== 'CONTACT') {
                validationErrors.push(`LocalBusiness schema should only be on HOMEPAGE/LOCATION/CONTACT pages, not ${page.page_type}`)
            }

            // BlogPosting/Article: check required fields
            if (schemaType === 'BlogPosting' || schemaType === 'Article') {
                if (!schema.headline) validationErrors.push(`${schemaType}: missing required field "headline"`)
                if (!schema.datePublished) validationErrors.push(`${schemaType}: missing required field "datePublished"`)
                if (!schema.author) validationErrors.push(`${schemaType}: missing required field "author"`)
            }
        })

        // Determine final status
        const schemaStatus = validationErrors.length === 0 ? 'validated' : 'generated'

        // 9. Save to database
        const requestDurationMs = Date.now() - startTime

        const { error: updateError } = await supabase
            .from('page_index')
            .update({
                recommended_schema: generatedSchema,
                schema_status: schemaStatus,
                schema_errors: validationErrors.length > 0 ? validationErrors : null,
                schema_generated_at: new Date().toISOString()
            })
            .eq('id', pageId)

        if (updateError) {
            return res.status(500).json({ error: `Failed to save schema: ${updateError.message}` })
        }

        // Log AI usage
        await logAIUsage({
            action: 'generate_schema_v2',
            pageId,
            pageUrl,
            provider: 'openai',
            model: model,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            requestDurationMs,
            success: true
        })

        res.json({
            success: true,
            skipped: false,
            schema: generatedSchema,
            pageType: page.page_type,
            schemaType: schemaConfig.schema_type,
            linkedSchemas: linkedSchemas,
            tokens: { input: totalInputTokens, output: totalOutputTokens },
            model: model,
            durationMs: requestDurationMs,
            validation: {
                status: schemaStatus,
                errors: validationErrors.length > 0 ? validationErrors : null,
                passedRules: validationErrors.length === 0
            },
            message: validationErrors.length === 0
                ? 'Schema generated and validated successfully'
                : `Schema generated with ${validationErrors.length} validation warning(s)`
        })

    } catch (error) {
        console.error('Generate schema v2 error:', error)
        res.status(500).json({ error: error.message })
    }
})

// ============================================
// Link Plan API Endpoints
// ============================================

// GET /api/link-plan - List link plans with optional filters
app.get('/api/link-plan', async (req, res) => {
    try {
        const { account_id, status, quarter, year } = req.query

        let query = supabase
            .from('link_plan')
            .select(`
                *,
                accounts!inner(id, account_name, website_url)
            `)
            .order('target_month', { ascending: true })

        if (account_id) {
            query = query.eq('account_id', account_id)
        }

        if (status) {
            query = query.eq('status', status)
        }

        // Filter by quarter (e.g., Q1 = months 1-3)
        if (quarter && year) {
            const q = parseInt(quarter)
            const y = parseInt(year)
            const startMonth = (q - 1) * 3 + 1
            const endMonth = q * 3
            const startDate = `${y}-${String(startMonth).padStart(2, '0')}-01`
            const endDate = `${y}-${String(endMonth).padStart(2, '0')}-01`
            query = query.gte('target_month', startDate).lte('target_month', endDate)
        }

        const { data, error } = await query

        if (error) {
            return res.status(500).json({ error: error.message })
        }

        res.json(data)
    } catch (error) {
        console.error('Link plan list error:', error)
        res.status(500).json({ error: error.message })
    }
})

// POST /api/link-plan - Create new link plan
app.post('/api/link-plan', async (req, res) => {
    try {
        const {
            account_id,
            target_month,
            type,
            publisher,
            publisher_da,
            destination_url,
            destination_page_id,
            anchor_text,
            status,
            notes
        } = req.body

        if (!account_id || !target_month) {
            return res.status(400).json({ error: 'account_id and target_month are required' })
        }

        const { data, error } = await supabase
            .from('link_plan')
            .insert({
                account_id,
                target_month,
                type: type || 'Content Placement - Standard',
                publisher,
                publisher_da,
                destination_url,
                destination_page_id,
                anchor_text,
                status: status || 'planned',
                notes
            })
            .select()
            .single()

        if (error) {
            return res.status(500).json({ error: error.message })
        }

        res.json(data)
    } catch (error) {
        console.error('Link plan create error:', error)
        res.status(500).json({ error: error.message })
    }
})

// PUT /api/link-plan/:id - Update link plan
app.put('/api/link-plan/:id', async (req, res) => {
    try {
        const { id } = req.params
        const updates = req.body

        // Add updated_at timestamp
        updates.updated_at = new Date().toISOString()

        const { data, error } = await supabase
            .from('link_plan')
            .update(updates)
            .eq('id', id)
            .select()
            .single()

        if (error) {
            return res.status(500).json({ error: error.message })
        }

        res.json(data)
    } catch (error) {
        console.error('Link plan update error:', error)
        res.status(500).json({ error: error.message })
    }
})

// DELETE /api/link-plan/:id - Delete link plan
app.delete('/api/link-plan/:id', async (req, res) => {
    try {
        const { id } = req.params

        const { error } = await supabase
            .from('link_plan')
            .delete()
            .eq('id', id)

        if (error) {
            return res.status(500).json({ error: error.message })
        }

        res.json({ success: true })
    } catch (error) {
        console.error('Link plan delete error:', error)
        res.status(500).json({ error: error.message })
    }
})

// ============================================
// Admin API Endpoints
// ============================================

// GET /api/admin/users - List all users with roles and accounts
app.get('/api/admin/users', async (req, res) => {
    try {
        // Get users from auth.users via RPC
        const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers()

        if (authError) {
            return res.status(500).json({ error: authError.message })
        }

        // Get user roles
        const { data: userRoles, error: rolesError } = await supabase
            .from('user_roles')
            .select('user_id, roles(id, name, description)')

        if (rolesError) {
            return res.status(500).json({ error: rolesError.message })
        }

        // Get user accounts
        const { data: userAccounts, error: accountsError } = await supabase
            .from('user_accounts')
            .select('user_id, account_id, accounts(id, account_name)')

        if (accountsError) {
            return res.status(500).json({ error: accountsError.message })
        }

        // Combine data
        const users = authUsers.users.map(user => ({
            id: user.id,
            email: user.email,
            created_at: user.created_at,
            role: userRoles.find(r => r.user_id === user.id)?.roles || null,
            accounts: userAccounts.filter(a => a.user_id === user.id).map(a => a.accounts)
        }))

        res.json(users)
    } catch (error) {
        console.error('List users error:', error)
        res.status(500).json({ error: error.message })
    }
})

// POST /api/admin/users - Create OR invite a new user
// If password is provided, create user directly. Otherwise, send invite email.
app.post('/api/admin/users', async (req, res) => {
    try {
        const { email, password, role_id, account_ids } = req.body

        if (!email) {
            return res.status(400).json({ error: 'email is required' })
        }

        let authData, authError

        if (password) {
            // Create user directly with password (no email sent)
            const result = await supabase.auth.admin.createUser({
                email,
                password,
                email_confirm: true
            })
            authData = result.data
            authError = result.error
        } else {
            // Invite user via email
            const appUrl = process.env.APP_URL || 'https://pulse.deangarland.com'
            const result = await supabase.auth.admin.inviteUserByEmail(email, {
                redirectTo: `${appUrl}/login`
            })
            authData = result.data
            authError = result.error
        }

        if (authError) {
            return res.status(500).json({ error: authError.message })
        }

        const userId = authData.user.id

        // Assign role if provided
        if (role_id) {
            const { error: roleError } = await supabase
                .from('user_roles')
                .insert({ user_id: userId, role_id })

            if (roleError) {
                console.error('Role assignment error:', roleError)
            }
        }

        // Assign accounts if provided (not needed for super_admin/admin)
        if (account_ids && account_ids.length > 0) {
            const accountInserts = account_ids.map(account_id => ({
                user_id: userId,
                account_id
            }))

            const { error: accountError } = await supabase
                .from('user_accounts')
                .insert(accountInserts)

            if (accountError) {
                console.error('Account assignment error:', accountError)
            }
        }

        res.json({
            success: true,
            user: authData.user,
            message: 'Invite sent successfully'
        })
    } catch (error) {
        console.error('Invite user error:', error)
        res.status(500).json({ error: error.message })
    }
})

// DELETE /api/admin/users/:id - Delete a user
app.delete('/api/admin/users/:id', async (req, res) => {
    try {
        const { id } = req.params

        // Delete from user_accounts first (foreign key constraint)
        await supabase.from('user_accounts').delete().eq('user_id', id)

        // Delete from user_roles
        await supabase.from('user_roles').delete().eq('user_id', id)

        // Delete from user_permission_overrides
        await supabase.from('user_permission_overrides').delete().eq('user_id', id)

        // Delete from Supabase Auth
        const { error: authError } = await supabase.auth.admin.deleteUser(id)

        if (authError) {
            return res.status(500).json({ error: authError.message })
        }

        res.json({ success: true, message: 'User deleted successfully' })
    } catch (error) {
        console.error('Delete user error:', error)
        res.status(500).json({ error: error.message })
    }
})

// GET /api/admin/roles - List all roles with permissions
app.get('/api/admin/roles', async (req, res) => {
    try {
        const { data: roles, error: rolesError } = await supabase
            .from('roles')
            .select('*')
            .order('name')

        if (rolesError) {
            return res.status(500).json({ error: rolesError.message })
        }

        // Get role_permissions mapping
        const { data: rolePermissions, error: rpError } = await supabase
            .from('role_permissions')
            .select('role_id, permission_id, permissions(id, name, description)')

        if (rpError) {
            return res.status(500).json({ error: rpError.message })
        }

        // Combine data
        const rolesWithPermissions = roles.map(role => ({
            ...role,
            permissions: rolePermissions
                .filter(rp => rp.role_id === role.id)
                .map(rp => rp.permissions)
        }))

        res.json(rolesWithPermissions)
    } catch (error) {
        console.error('List roles error:', error)
        res.status(500).json({ error: error.message })
    }
})

// PUT /api/admin/roles/:id/permissions - Update role permissions
app.put('/api/admin/roles/:id/permissions', async (req, res) => {
    try {
        const { id } = req.params
        const { permission_ids } = req.body

        if (!Array.isArray(permission_ids)) {
            return res.status(400).json({ error: 'permission_ids must be an array' })
        }

        // Delete existing permissions
        const { error: deleteError } = await supabase
            .from('role_permissions')
            .delete()
            .eq('role_id', id)

        if (deleteError) {
            return res.status(500).json({ error: deleteError.message })
        }

        // Insert new permissions
        if (permission_ids.length > 0) {
            const inserts = permission_ids.map(permission_id => ({
                role_id: id,
                permission_id
            }))

            const { error: insertError } = await supabase
                .from('role_permissions')
                .insert(inserts)

            if (insertError) {
                return res.status(500).json({ error: insertError.message })
            }
        }

        res.json({ success: true, message: 'Role permissions updated' })
    } catch (error) {
        console.error('Update role permissions error:', error)
        res.status(500).json({ error: error.message })
    }
})

// GET /api/admin/permissions - List all permissions
app.get('/api/admin/permissions', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('permissions')
            .select('*')
            .order('name')

        if (error) {
            return res.status(500).json({ error: error.message })
        }

        res.json(data)
    } catch (error) {
        console.error('List permissions error:', error)
        res.status(500).json({ error: error.message })
    }
})

// GET /api/admin/users/:id/permissions - Get user permission overrides
app.get('/api/admin/users/:id/permissions', async (req, res) => {
    try {
        const { id } = req.params

        const { data, error } = await supabase
            .from('user_permission_overrides')
            .select('*, permissions(id, name, description)')
            .eq('user_id', id)

        if (error) {
            return res.status(500).json({ error: error.message })
        }

        res.json(data)
    } catch (error) {
        console.error('Get user permissions error:', error)
        res.status(500).json({ error: error.message })
    }
})

// PUT /api/admin/users/:id/permissions - Update user permission overrides
app.put('/api/admin/users/:id/permissions', async (req, res) => {
    try {
        const { id } = req.params
        const { overrides } = req.body

        if (!Array.isArray(overrides)) {
            return res.status(400).json({ error: 'overrides must be an array' })
        }

        // Delete existing overrides for this user (global only, not account-specific)
        const { error: deleteError } = await supabase
            .from('user_permission_overrides')
            .delete()
            .eq('user_id', id)
            .is('account_id', null)

        if (deleteError) {
            return res.status(500).json({ error: deleteError.message })
        }

        // Insert new overrides
        if (overrides.length > 0) {
            const inserts = overrides.map(o => ({
                user_id: id,
                permission_id: o.permission_id,
                granted: o.granted,
                account_id: null
            }))

            const { error: insertError } = await supabase
                .from('user_permission_overrides')
                .insert(inserts)

            if (insertError) {
                return res.status(500).json({ error: insertError.message })
            }
        }

        res.json({ success: true, message: 'User permissions updated' })
    } catch (error) {
        console.error('Update user permissions error:', error)
        res.status(500).json({ error: error.message })
    }
})

// GET /api/admin/accounts - List all accounts for assignment
app.get('/api/admin/accounts', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('accounts')
            .select('id, account_name')
            .order('account_name')

        if (error) {
            return res.status(500).json({ error: error.message })
        }

        res.json(data)
    } catch (error) {
        console.error('List accounts error:', error)
        res.status(500).json({ error: error.message })
    }
})

// ============================================================
// SITE INDEX API (for crawling management)
// ============================================================

// GET /api/sites - List all crawled sites with account info
app.get('/api/sites', async (req, res) => {
    try {
        const { account_id, status } = req.query

        let query = supabase
            .from('site_index')
            .select(`
                *,
                accounts(id, account_name)
            `)
            .order('created_at', { ascending: false })

        if (account_id) {
            query = query.eq('account_id', account_id)
        }

        if (status) {
            query = query.eq('crawl_status', status)
        }

        const { data, error } = await query

        if (error) {
            return res.status(500).json({ error: error.message })
        }

        res.json(data)
    } catch (error) {
        console.error('List sites error:', error)
        res.status(500).json({ error: error.message })
    }
})

// POST /api/sites - Create a new site for crawling
app.post('/api/sites', async (req, res) => {
    try {
        const { url, account_id, page_limit = 200, exclude_paths = [], run_classifier = true } = req.body

        if (!url) {
            return res.status(400).json({ error: 'URL is required' })
        }

        // Parse domain from URL
        let domain
        try {
            domain = new URL(url).hostname
        } catch (e) {
            return res.status(400).json({ error: 'Invalid URL format' })
        }

        // Check if site with this domain already exists
        const { data: existing } = await supabase
            .from('site_index')
            .select('id, domain, crawl_status')
            .eq('domain', domain)
            .single()

        let siteData
        if (existing) {
            // Re-crawl existing site (pages will be upserted, preserving user-generated content)
            const { data, error } = await supabase
                .from('site_index')
                .update({
                    url,
                    account_id: account_id || null,
                    crawl_status: 'in_progress',
                    page_limit,
                    exclude_paths,
                    pages_crawled: 0,
                    updated_at: new Date().toISOString()
                })
                .eq('id', existing.id)
                .select(`*, accounts(id, account_name)`)
                .single()

            if (error) {
                return res.status(500).json({ error: error.message })
            }
            siteData = { ...data, updated: true }
        } else {
            // Create new site
            const { data, error } = await supabase
                .from('site_index')
                .insert({
                    url,
                    domain,
                    account_id: account_id || null,
                    crawl_status: 'in_progress',
                    page_limit,
                    exclude_paths,
                    pages_crawled: 0
                })
                .select(`*, accounts(id, account_name)`)
                .single()

            if (error) {
                return res.status(500).json({ error: error.message })
            }
            siteData = data
        }

        // Run crawler in-process (fire and forget)
        // Import dynamically to avoid circular dependencies
        import('./crawl-site.js').then(({ runCrawl }) => {
            runCrawl(siteData.id, page_limit, exclude_paths, run_classifier)
                .then(() => console.log(`✅ Crawl complete for ${domain}`))
                .catch(err => console.error(`❌ Crawl failed for ${domain}:`, err.message))
        }).catch(err => {
            console.error(`❌ Failed to import crawler:`, err)
        })

        console.log(`🕷️ Started crawler for site ${siteData.id} (${domain})`)

        res.status(existing ? 200 : 201).json(siteData)
    } catch (error) {
        console.error('Create site error:', error)
        res.status(500).json({ error: error.message })
    }
})

// DEBUG: Check DB Connection
app.get('/api/debug-db', async (req, res) => {
    try {
        const dbUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
        // Optional: Test Write
        let writeResult = null;
        if (req.query.action === 'test_write') {
            const testDomain = `test-write-${Date.now()}.com`
            const { data, error } = await supabase
                .from('site_index')
                .upsert({
                    domain: testDomain,
                    url: `https://${testDomain}`,
                    crawl_status: 'pending'
                })
                .select()
                .single()

            writeResult = error ? { success: false, error: error.message } : { success: true, site: data }
        }

        // Optional: Find Site
        let findResult = null;
        if (req.query.action === 'find_site' && req.query.query) {
            const { data, error } = await supabase
                .from('site_index')
                .select('*')
                .ilike('domain', `%${req.query.query}%`)
            findResult = { data, error: error?.message }
        }

        // Optional: Simulate Create
        let simulation = null;
        if (req.query.action === 'simulate_create' && req.query.url) {
            const result = { logs: [], success: false, data: null, error: null };
            try {
                result.logs.push(`Parsing URL: ${req.query.url}`);
                const domain = new URL(req.query.url).hostname;
                result.logs.push(`Domain: ${domain}`);

                const { data: existing, error: existError } = await supabase
                    .from('site_index')
                    .select('id, domain')
                    .eq('domain', domain)
                    .single();

                result.logs.push(`Check Existing: ${existError ? 'Error/Not Found' : 'Found ' + (existing?.id || 'null')}`);

                if (existing) {
                    result.logs.push('Path: UPDATE');
                    const { data, error } = await supabase
                        .from('site_index')
                        .update({ crawl_status: 'in_progress', updated_at: new Date().toISOString() })
                        .eq('id', existing.id)
                        .select()
                        .single();
                    result.data = data;
                    result.error = error?.message;
                } else {
                    result.logs.push('Path: INSERT');
                    const { data, error } = await supabase
                        .from('site_index')
                        .insert({
                            url: req.query.url,
                            domain: domain,
                            crawl_status: 'in_progress',
                            pages_crawled: 0
                        })
                        .select()
                        .single();
                    result.data = data;
                    result.error = error?.message;
                }
                result.success = !result.error;
            } catch (e) {
                result.error = e.message;
                result.logs.push(`Exception: ${e.message}`);
            }
            simulation = result;
        }

        // Optional: Test Crawl (synchronous for debugging)
        let crawlTest = null;
        if (req.query.action === 'test_crawl' && req.query.site_id) {
            try {
                const { runCrawl } = await import('./crawl-site.js');
                crawlTest = { importing: 'success' };
                await runCrawl(req.query.site_id, 3, []);
                crawlTest.result = 'completed';
            } catch (err) {
                crawlTest = { error: err.message, stack: err.stack };
            }
        }

        const { data: sites, error } = await supabase
            .from('site_index')
            .select('id, domain, created_at')
            .order('created_at', { ascending: false })
            .limit(5)

        res.json({
            connected_url: dbUrl ? dbUrl.replace(/https:\/\/([^.]+)\..*/, 'https://$1.supabase.co') : 'MISSING',
            sites_found: sites?.length || 0,
            recent_sites: sites || [],
            write_test: writeResult,
            find_result: findResult,
            simulation: simulation,
            crawl_test: crawlTest,
            error: error?.message || null,
            env_vars: {
                HAS_SUPABASE_URL: !!process.env.SUPABASE_URL,
                HAS_VITE_URL: !!process.env.VITE_SUPABASE_URL,
                HAS_SERVICE_KEY: !!(process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_SERVICE_KEY)
            }
        })
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

// GET /api/sites/:id/status - Real-time crawl progress
app.get('/api/sites/:id/status', async (req, res) => {
    try {
        const { id } = req.params

        const { data: site, error } = await supabase
            .from('site_index')
            .select('id, domain, crawl_status, pages_crawled, page_limit, current_url, updated_at')
            .eq('id', id)
            .single()

        if (error || !site) {
            return res.status(404).json({ error: 'Site not found' })
        }

        const percentComplete = site.page_limit > 0
            ? Math.round((site.pages_crawled / site.page_limit) * 100)
            : 0

        res.json({
            id: site.id,
            domain: site.domain,
            status: site.crawl_status,
            pages_crawled: site.pages_crawled,
            page_limit: site.page_limit,
            current_url: site.current_url,
            percent_complete: percentComplete,
            updated_at: site.updated_at
        })
    } catch (error) {
        console.error('Site status error:', error)
        res.status(500).json({ error: error.message })
    }
})

// PUT /api/sites/:id - Update site (e.g., link to account, update status)
app.put('/api/sites/:id', async (req, res) => {
    try {
        const { id } = req.params
        const { account_id, crawl_status } = req.body

        const updates = { updated_at: new Date().toISOString() }
        if (account_id !== undefined) updates.account_id = account_id || null
        if (crawl_status) updates.crawl_status = crawl_status

        const { data, error } = await supabase
            .from('site_index')
            .update(updates)
            .eq('id', id)
            .select(`*, accounts(id, account_name)`)
            .single()

        if (error) {
            return res.status(500).json({ error: error.message })
        }

        res.json(data)
    } catch (error) {
        console.error('Update site error:', error)
        res.status(500).json({ error: error.message })
    }
})

// DELETE /api/sites/:id - Delete a site and its pages
app.delete('/api/sites/:id', async (req, res) => {
    try {
        const { id } = req.params

        // Delete related data first (pages, resources, analyses)
        await supabase.from('page_index').delete().eq('site_id', id)
        await supabase.from('crawl_resources').delete().eq('site_id', id)

        const { error } = await supabase
            .from('site_index')
            .delete()
            .eq('id', id)

        if (error) {
            return res.status(500).json({ error: error.message })
        }

        res.json({ success: true })
    } catch (error) {
        console.error('Delete site error:', error)
        res.status(500).json({ error: error.message })
    }
})

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'dist')))

// SPA fallback - serve index.html for all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

const PORT = process.env.PORT || 8080
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
    console.log(`API available at /api/generate-recommendations`)
})
