import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { generateSchemaForPageById } from './batch-generate-schemas.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(cors())
app.use(express.json())

// Lazy-initialized Supabase client
let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
        const supabaseKey = process.env.VITE_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;
        if (!supabaseUrl || !supabaseKey) {
            throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
        }
        _supabase = createClient(supabaseUrl, supabaseKey);
    }
    return _supabase;
}

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
    // OpenAI - GPT-5
    'gpt-5': { input: 500, output: 1500 },
    'gpt-5-mini': { input: 75, output: 300 },
    // OpenAI - Reasoning
    'o3-mini': { input: 110, output: 440 },
    'o1': { input: 1500, output: 6000 },
    'o1-mini': { input: 300, output: 1200 },
    // OpenAI - GPT-4.5/4o
    'gpt-4.5-preview': { input: 250, output: 1000 },
    'gpt-4o': { input: 250, output: 1000 },
    'gpt-4o-mini': { input: 15, output: 60 },
    // OpenAI - GPT-4/3.5
    'gpt-4-turbo': { input: 1000, output: 3000 },
    'gpt-4': { input: 3000, output: 6000 },
    'gpt-3.5-turbo': { input: 50, output: 150 },
    // Anthropic Claude 4 (correct model IDs)
    'claude-opus-4-20250514': { input: 1500, output: 7500 },
    'claude-sonnet-4-20250514': { input: 300, output: 1500 },
    'claude-3-5-haiku-20241022': { input: 80, output: 400 },
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

        console.log(`📊 AI Usage: ${action} | ${model} | ${inputTokens}+${outputTokens} tokens | $${((inputCostCents + outputCostCents) / 100).toFixed(4)}`)
    } catch (error) {
        console.error('Failed to log AI usage:', error.message)
    }
}

// Fallback prompt (only used if DB prompt not found)
const FALLBACK_META_PROMPT = `You are Meta Tag AI for healthcare/medical aesthetics websites.

CORE RULES:
1. Maximize qualified clicks with accurate, compelling metadata matching search intent.
2. For healthcare pages: Use conservative language. No promises, guarantees, or amplified results claims.
3. Lean into what you discover from the page copy. Existing titles and meta data are signals, not direction.

META CONSTRAINTS:
- Title: 55-65 chars, include primary keyword and secondary keyword(s) if possible + brand naturally (if you have room)
- Description: 140-160 chars, clear value prop + CTA, no hype

---

PAGE DATA:
URL: {{url}}
Page Type: {{page_type}}
Current Title: {{current_title}}
Current Meta Description: {{current_description}}
Headings: {{headings}}

Content Summary:
{{content_summary}}

---

Respond with this exact JSON format:
{
  "meta": {
    "title": {
      "recommended": "Your optimized title tag (55-65 chars)",
      "reasoning": "Why this title is better"
    },
    "description": {
      "recommended": "Your optimized meta description (140-160 chars)",
      "reasoning": "Why this description is better"
    }
  }
}`

// Prompt cache to avoid repeated DB fetches
const promptCache = {}

// Fetch prompt from database by type (with caching)
async function getPrompt(promptType) {
    if (promptCache[promptType]) {
        return promptCache[promptType]
    }

    try {
        const { data, error } = await getSupabase()
            .from('prompts')
            .select('system_prompt, default_model, user_prompt_template')
            .eq('prompt_type', promptType)
            .single()

        if (error || !data) {
            console.log(`Prompt type "${promptType}" not found in DB`)
            return null
        }

        promptCache[promptType] = data
        return data
    } catch (err) {
        console.log(`Error fetching prompt: ${err.message}`)
        return null
    }
}

// Build prompt by replacing placeholders with page data
function buildMetaPrompt(promptTemplate, page) {
    const headings = page.headings || {}
    const headingsText = [
        ...(headings.h1 || []).map(h => `H1: ${h}`),
        ...(headings.h2 || []).map(h => `H2: ${h}`),
        ...(headings.h3 || []).slice(0, 5).map(h => `H3: ${h}`)
    ].join('\n') || 'No headings found'

    const metaTags = page.meta_tags || {}

    const contentSummary = (page.main_content || '')
        .substring(0, 2000)
        .replace(/\s+/g, ' ')
        .trim() || 'No content extracted'

    return promptTemplate
        .replace('{{url}}', page.url || '')
        .replace('{{page_type}}', page.page_type || 'Unknown')
        .replace('{{current_title}}', metaTags.title || page.title || 'None')
        .replace('{{current_description}}', metaTags.description || 'None')
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

        // Model mappings by provider (synced with src/lib/models.ts)
        const OPENAI_MODELS = [
            'gpt-5', 'gpt-5-mini',
            'o3-mini', 'o1', 'o1-mini',
            'gpt-4.5-preview',
            'gpt-4o', 'gpt-4o-mini',
            'gpt-4-turbo', 'gpt-4',
            'gpt-3.5-turbo'
        ]
        const ANTHROPIC_MODELS = [
            'claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'
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
        const { data: page, error: fetchError } = await getSupabase()
            .from('page_index')
            .select('*')
            .eq('id', pageId)
            .single()

        if (fetchError) {
            return res.status(404).json({ error: `Page not found: ${fetchError.message}` })
        }

        // Fetch prompt from database (includes template with placeholders)
        const promptData = await getPrompt('meta_recommendations')
        const promptTemplate = promptData?.system_prompt || FALLBACK_META_PROMPT

        // Build the prompt with page data
        const prompt = buildMetaPrompt(promptTemplate, page)
        let content

        // Track timing and tokens
        const startTime = Date.now()
        let inputTokens = 0
        let outputTokens = 0

        // For single-prompt flow, we send the prompt as user message
        if (provider === 'openai') {
            const response = await openai.chat.completions.create({
                model: selectedModel,
                messages: [
                    { role: 'user', content: prompt + '\n\nRespond with valid JSON only.' }
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
                contents: [{ role: 'user', parts: [{ text: prompt + '\n\nRespond with valid JSON only.' }] }],
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
        const { error: updateError } = await getSupabase()
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
        const { data: page, error: pageError } = await getSupabase()
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
        const { data: schemaConfig, error: configError } = await getSupabase()
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
            await getSupabase()
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
            await getSupabase()
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
        const { data: site } = await getSupabase()
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

        const { error: updateError } = await getSupabase()
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
// ============================================
// Schema Generator API (uses batch-generate-schemas.js as canonical source)
// ============================================
app.post('/api/generate-schema-v2', async (req, res) => {
    try {
        const { pageId, includeMedium = false } = req.body

        if (!pageId) {
            return res.status(400).json({ error: 'pageId is required' })
        }

        // Use the canonical schema generator
        const result = await generateSchemaForPageById(pageId, { includeMedium })

        if (!result.success) {
            return res.status(400).json({ error: result.error })
        }

        if (result.skipped) {
            return res.json({
                success: true,
                skipped: true,
                reason: result.reason,
                pageType: result.pageType
            })
        }

        res.json({
            success: true,
            skipped: false,
            schema: result.schema,
            pageType: result.pageType,
            validation: result.validation
        })

    } catch (error) {
        console.error('Schema generation error:', error)
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

        let query = getSupabase()
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

        const { data, error } = await getSupabase()
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

        const { data, error } = await getSupabase()
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

        const { error } = await getSupabase()
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
        const { data: authUsers, error: authError } = await getSupabase().auth.admin.listUsers()

        if (authError) {
            return res.status(500).json({ error: authError.message })
        }

        // Get user roles
        const { data: userRoles, error: rolesError } = await getSupabase()
            .from('user_roles')
            .select('user_id, roles(id, name, description)')

        if (rolesError) {
            return res.status(500).json({ error: rolesError.message })
        }

        // Get user accounts
        const { data: userAccounts, error: accountsError } = await getSupabase()
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
            const result = await getSupabase().auth.admin.createUser({
                email,
                password,
                email_confirm: true
            })
            authData = result.data
            authError = result.error
        } else {
            // Invite user via email
            const appUrl = process.env.APP_URL || 'https://pulse.deangarland.com'
            const result = await getSupabase().auth.admin.inviteUserByEmail(email, {
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
            const { error: roleError } = await getSupabase()
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

            const { error: accountError } = await getSupabase()
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
        await getSupabase().from('user_accounts').delete().eq('user_id', id)

        // Delete from user_roles
        await getSupabase().from('user_roles').delete().eq('user_id', id)

        // Delete from user_permission_overrides
        await getSupabase().from('user_permission_overrides').delete().eq('user_id', id)

        // Delete from Supabase Auth
        const { error: authError } = await getSupabase().auth.admin.deleteUser(id)

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
        const { data: roles, error: rolesError } = await getSupabase()
            .from('roles')
            .select('*')
            .order('name')

        if (rolesError) {
            return res.status(500).json({ error: rolesError.message })
        }

        // Get role_permissions mapping
        const { data: rolePermissions, error: rpError } = await getSupabase()
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
        const { error: deleteError } = await getSupabase()
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

            const { error: insertError } = await getSupabase()
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
        const { data, error } = await getSupabase()
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

        const { data, error } = await getSupabase()
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
        const { error: deleteError } = await getSupabase()
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

            const { error: insertError } = await getSupabase()
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
        const { data, error } = await getSupabase()
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

        let query = getSupabase()
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
        const { data: existing } = await getSupabase()
            .from('site_index')
            .select('id, domain, crawl_status')
            .eq('domain', domain)
            .single()

        let siteData
        if (existing) {
            // Re-crawl existing site (pages will be upserted, preserving user-generated content)
            const { data, error } = await getSupabase()
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
            const { data, error } = await getSupabase()
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
            const { data, error } = await getSupabase()
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
            const { data, error } = await getSupabase()
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

                const { data: existing, error: existError } = await getSupabase()
                    .from('site_index')
                    .select('id, domain')
                    .eq('domain', domain)
                    .single();

                result.logs.push(`Check Existing: ${existError ? 'Error/Not Found' : 'Found ' + (existing?.id || 'null')}`);

                if (existing) {
                    result.logs.push('Path: UPDATE');
                    const { data, error } = await getSupabase()
                        .from('site_index')
                        .update({ crawl_status: 'in_progress', updated_at: new Date().toISOString() })
                        .eq('id', existing.id)
                        .select()
                        .single();
                    result.data = data;
                    result.error = error?.message;
                } else {
                    result.logs.push('Path: INSERT');
                    const { data, error } = await getSupabase()
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

        const { data: sites, error } = await getSupabase()
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

        const { data: site, error } = await getSupabase()
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

        const { data, error } = await getSupabase()
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
        await getSupabase().from('page_index').delete().eq('site_id', id)
        await getSupabase().from('crawl_resources').delete().eq('site_id', id)

        const { error } = await getSupabase()
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

// ============================================================
// PAGE-LEVEL ACTIONS
// ============================================================

// POST /api/pages/:id/recrawl - Re-crawl a single page
app.post('/api/pages/:id/recrawl', async (req, res) => {
    try {
        const { id } = req.params

        // Get page info
        const { data: page, error: pageError } = await getSupabase()
            .from('page_index')
            .select('url, site_id')
            .eq('id', id)
            .single()

        if (pageError || !page) {
            return res.status(404).json({ error: 'Page not found' })
        }

        console.log(`🔄 Re-crawling page: ${page.url}`)

        // Fetch the page
        const response = await fetch(page.url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PulseCrawler/1.0)' },
            timeout: 30000
        })

        if (!response.ok) {
            return res.status(response.status).json({ error: `Failed to fetch: ${response.status}` })
        }

        const html = await response.text()

        // Import and use the parsing/cleaning functions from crawl-site.js
        const { parsePage, cleanHtml } = await import('./crawl-site.js')

        const parsed = parsePage(html, page.url)
        const cleanedHtml = cleanHtml(html)

        // Update the page in database
        const { error: updateError } = await getSupabase()
            .from('page_index')
            .update({
                title: parsed.title,
                html_content: html,
                cleaned_html: cleanedHtml,
                main_content: parsed.main_content || null,
                headings: parsed.headings || null,
                meta_tags: { description: parsed.meta_description } || null,
                links_internal: parsed.internal_links || null,
                links_external: parsed.external_links || null,
                crawled_at: new Date().toISOString()
            })
            .eq('id', id)

        if (updateError) {
            return res.status(500).json({ error: updateError.message })
        }

        console.log(`✅ Re-crawled: ${page.url}`)
        res.json({ success: true, message: 'Page re-crawled successfully' })
    } catch (error) {
        console.error('Re-crawl page error:', error)
        res.status(500).json({ error: error.message })
    }
})

// POST /api/pages/:id/classify - Re-classify a single page
app.post('/api/pages/:id/classify', async (req, res) => {
    try {
        const { id } = req.params

        // Get page info
        const { data: page, error: pageError } = await getSupabase()
            .from('page_index')
            .select('url, title, site_id, main_content, headings')
            .eq('id', id)
            .single()

        if (pageError || !page) {
            return res.status(404).json({ error: 'Page not found' })
        }

        console.log(`🏷️ Classifying page: ${page.url}`)

        // Import classifier
        const { classifySinglePage } = await import('./classify-pages.js')

        const result = await classifySinglePage(id, page)

        if (!result.success) {
            return res.status(500).json({ error: result.error || 'Classification failed' })
        }

        console.log(`✅ Classified as: ${result.page_type}`)
        res.json({ success: true, page_type: result.page_type })
    } catch (error) {
        console.error('Classify page error:', error)
        res.status(500).json({ error: error.message })
    }
})


// ============================================
// PHASE 3: AI Content Enhancement APIs
// ============================================

// POST /api/analyze-content - Analyze page content against template
app.post('/api/analyze-content', async (req, res) => {
    try {
        const { pageId, pageType, model } = req.body

        if (!pageId) {
            return res.status(400).json({ error: 'pageId is required' })
        }

        // Get page content
        const { data: page, error: pageError } = await getSupabase()
            .from('page_index')
            .select('id, url, title, page_type, cleaned_html, headings, main_content')
            .eq('id', pageId)
            .single()

        if (pageError || !page) {
            return res.status(404).json({ error: 'Page not found' })
        }

        // Determine page type (use provided or page's type)
        const effectivePageType = pageType || page.page_type

        if (!effectivePageType) {
            return res.status(400).json({ error: 'Page type is required (either provide pageType or ensure page has page_type set)' })
        }

        // Get template for this page type
        const { data: template, error: templateError } = await getSupabase()
            .from('page_content_templates')
            .select('*')
            .eq('page_type', effectivePageType)
            .single()

        if (templateError || !template) {
            return res.status(404).json({ error: `No template found for page type: ${effectivePageType}` })
        }

        // Build analysis prompt
        const sectionsList = template.sections.map(s =>
            `- ${s.id}: "${s.name}" (${s.required ? 'required' : 'optional'}) - ${s.description}`
        ).join('\n')

        const analysisPrompt = `Analyze this webpage content and identify which expected sections are present or missing.

EXPECTED SECTIONS FOR ${effectivePageType.toUpperCase()} PAGE:
${sectionsList}

PAGE CONTENT:
Title: ${page.title || 'No title'}
URL: ${page.url}
Headings: ${JSON.stringify(page.headings || {})}

HTML Content:
${(page.cleaned_html || page.main_content || '').substring(0, 15000)}

IMPORTANT: For each section, determine if it should be enhanced:
- Required sections should ALWAYS be enhanced
- Optional sections should ALSO be enhanced IF they exist in the original content
- This means: if the original page has FAQs, testimonials, pricing, or any other optional content, it MUST be preserved and enhanced

For each expected section, determine:
1. Is it present? (found: true/false)
2. If found, what heading or location identifies it?
3. A brief summary of the content (if found)
4. Should it be enhanced? (should_enhance: true if required OR if found in original)
5. If missing and required, provide a recommendation

Respond in this exact JSON format:
{
    "sections": [
        {
            "section_id": "hero",
            "section_name": "Hero Section",
            "required": true,
            "found": true,
            "should_enhance": true,
            "location": "First H1: 'Botox Treatments'",
            "content_summary": "Hero with title and tagline about Botox treatments",
            "quality_score": 8,
            "recommendation": null
        },
        {
            "section_id": "faq",
            "section_name": "FAQ Section",
            "required": false,
            "found": true,
            "should_enhance": true,
            "location": "H2: 'Frequently Asked Questions'",
            "content_summary": "5 Q&A pairs about the procedure",
            "quality_score": 7,
            "recommendation": "Could add more questions about recovery time"
        }
    ],
    "missing_sections": ["pricing"],
    "overall_score": 75,
    "summary": "Page has 6 of 10 expected sections. Missing pricing section that could improve SEO."
}`


        // Use OpenAI for analysis
        if (!openai) {
            return res.status(400).json({ error: 'OpenAI API key not configured' })
        }

        // Fetch prompt from database
        const promptData = await getPrompt('content_analysis')
        const systemPrompt = promptData?.system_prompt || template.section_analysis_prompt || 'You are a content analyst. Analyze webpage structure and identify sections.'
        const selectedModel = model || promptData?.default_model || 'gpt-4o'

        const startTime = Date.now()
        const response = await openai.chat.completions.create({
            model: selectedModel,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: analysisPrompt }
            ],
            temperature: 0.3,
            response_format: { type: 'json_object' }
        })

        const content = response.choices[0]?.message?.content
        const inputTokens = response.usage?.prompt_tokens || 0
        const outputTokens = response.usage?.completion_tokens || 0
        const requestDurationMs = Date.now() - startTime

        if (!content) {
            return res.status(500).json({ error: 'No response from AI' })
        }

        // Log AI usage
        await logAIUsage({
            action: 'content_analysis',
            pageId,
            pageUrl: page.url,
            provider: 'openai',
            model: selectedModel,
            inputTokens,
            outputTokens,
            requestDurationMs,
            success: true
        })

        // Parse response
        let analysis
        try {
            analysis = JSON.parse(content)
        } catch (e) {
            return res.status(500).json({ error: 'Failed to parse AI response', raw: content })
        }

        // Save analysis to database
        try {
            const { data: existingPage } = await getSupabase()
                .from('page_index')
                .select('enhanced_content')
                .eq('id', pageId)
                .single()

            const existingContent = existingPage?.enhanced_content || { sections: {} }

            // Merge analysis results with existing content
            existingContent.overall_score = analysis.overall_score
            existingContent.analysis_summary = analysis.summary
            existingContent.missing_sections = analysis.missing_sections
            existingContent.analyzed_at = new Date().toISOString()

            // Store section analysis (not sections content yet)
            existingContent.section_analysis = analysis.sections

            await getSupabase()
                .from('page_index')
                .update({
                    enhanced_content: existingContent,
                    content_analyzed_at: new Date().toISOString()
                })
                .eq('id', pageId)

            console.log(`✅ Saved content analysis for page ${pageId}`)
        } catch (saveError) {
            console.error('Failed to save analysis:', saveError)
        }

        res.json({
            success: true,
            pageType: effectivePageType,
            template: {
                name: template.name,
                sections: template.sections
            },
            analysis,
            tokens: { input: inputTokens, output: outputTokens },
            durationMs: requestDurationMs
        })

    } catch (error) {
        console.error('Content analysis error:', error)
        res.status(500).json({ error: error.message })
    }
})

// GET /api/pages/:id/enhanced-content - Fetch stored enhanced content
app.get('/api/pages/:id/enhanced-content', async (req, res) => {
    try {
        const { id } = req.params

        const { data: page, error } = await getSupabase()
            .from('page_index')
            .select('id, url, title, page_type, enhanced_content, content_analyzed_at')
            .eq('id', id)
            .single()

        if (error || !page) {
            return res.status(404).json({ error: 'Page not found' })
        }

        res.json({
            success: true,
            pageId: page.id,
            pageUrl: page.url,
            pageType: page.page_type,
            enhancedContent: page.enhanced_content || { sections: {} },
            analyzedAt: page.content_analyzed_at
        })
    } catch (error) {
        console.error('Get enhanced content error:', error)
        res.status(500).json({ error: error.message })
    }
})

// PUT /api/pages/:id/enhanced-content - Save edited enhanced content
app.put('/api/pages/:id/enhanced-content', async (req, res) => {
    try {
        const { id } = req.params
        const { sectionId, content } = req.body

        if (!sectionId || !content) {
            return res.status(400).json({ error: 'sectionId and content are required' })
        }

        // Get existing enhanced_content
        const { data: page, error: fetchError } = await getSupabase()
            .from('page_index')
            .select('enhanced_content')
            .eq('id', id)
            .single()

        if (fetchError || !page) {
            return res.status(404).json({ error: 'Page not found' })
        }

        const existingContent = page.enhanced_content || { sections: {} }

        // Update the specific section's enhanced content
        if (!existingContent.sections[sectionId]) {
            existingContent.sections[sectionId] = {}
        }
        existingContent.sections[sectionId].enhanced = content
        existingContent.sections[sectionId].edited_at = new Date().toISOString()
        existingContent.sections[sectionId].user_edited = true

        // Save to database
        const { error: updateError } = await getSupabase()
            .from('page_index')
            .update({ enhanced_content: existingContent })
            .eq('id', id)

        if (updateError) {
            return res.status(500).json({ error: updateError.message })
        }

        console.log(`✅ Saved user edit for section ${sectionId} on page ${id}`)
        res.json({ success: true, sectionId, updatedAt: new Date().toISOString() })
    } catch (error) {
        console.error('Save enhanced content error:', error)
        res.status(500).json({ error: error.message })
    }
})

// POST /api/enhance-section - Rewrite a specific section
app.post('/api/enhance-section', async (req, res) => {
    try {
        const { pageId, sectionId, sectionContent, model } = req.body

        if (!pageId || !sectionId) {
            return res.status(400).json({ error: 'pageId and sectionId are required' })
        }

        // Get page info including enhanced_content which has the section analysis
        const { data: page, error: pageError } = await getSupabase()
            .from('page_index')
            .select('id, url, title, page_type, cleaned_html, main_content, enhanced_content')
            .eq('id', pageId)
            .single()

        if (pageError || !page) {
            return res.status(404).json({ error: 'Page not found' })
        }

        if (!page.page_type) {
            return res.status(400).json({ error: 'Page must have page_type set' })
        }

        // Get template
        const { data: template, error: templateError } = await getSupabase()
            .from('page_content_templates')
            .select('*')
            .eq('page_type', page.page_type)
            .single()

        if (templateError || !template) {
            return res.status(404).json({ error: `No template found for page type: ${page.page_type}` })
        }

        // Find the section definition
        const sectionDef = template.sections.find(s => s.id === sectionId)
        if (!sectionDef) {
            return res.status(404).json({ error: `Section '${sectionId}' not found in template` })
        }

        // Get the section analysis to find where the section is located
        const sectionAnalysis = page.enhanced_content?.section_analysis?.find(s => s.section_id === sectionId)

        // Get already-enhanced sections to avoid redundancy
        const existingSections = page.enhanced_content?.sections || {}
        const alreadyEnhancedList = Object.entries(existingSections)
            .filter(([id, data]) => id !== sectionId && data?.enhanced)
            .map(([id, data]) => {
                // Extract a summary of what's in each section (first 200 chars, strip HTML)
                const text = (data.enhanced || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
                return `- ${id}: ${text.substring(0, 200)}...`
            })
            .join('\n')

        const hasEnhancedSections = alreadyEnhancedList.length > 0
        const enhancedFAQ = Object.keys(existingSections).some(id => id.toLowerCase().includes('faq'))
        const enhancedHero = Object.keys(existingSections).includes('hero')
        const enhancedCTA = Object.keys(existingSections).some(id => id.toLowerCase().includes('cta'))

        // Try to extract the actual section content from the page HTML
        let actualSectionContent = sectionContent || ''
        const cleanedHtml = page.cleaned_html || page.main_content || ''

        if (sectionAnalysis?.found && sectionAnalysis?.location && cleanedHtml) {
            // Extract location hint (e.g., "H2: 'Frequently Asked Questions'" or "H2: 'FAQ'")
            const locationHint = sectionAnalysis.location

            // Try to find the section content in the HTML
            // Look for heading that matches the location and extract content after it
            const headingMatch = locationHint.match(/H[1-6]:\s*['"]?([^'"]+)['"]?/i)
            if (headingMatch) {
                const headingText = headingMatch[1].toLowerCase().trim()

                // Find the heading in the HTML and extract content until the next major heading
                const htmlLower = cleanedHtml.toLowerCase()
                const headingIndex = htmlLower.indexOf(headingText)

                if (headingIndex !== -1) {
                    // Extract up to 5000 characters from this section
                    const sectionStart = Math.max(0, headingIndex - 50) // Include some context before heading

                    // Find the next H1 or H2 after this section (end of section)
                    const remainingHtml = cleanedHtml.substring(headingIndex + headingText.length)
                    const nextHeadingMatch = remainingHtml.match(/<h[12][^>]*>/i)
                    const sectionEnd = nextHeadingMatch
                        ? headingIndex + headingText.length + nextHeadingMatch.index
                        : Math.min(headingIndex + 5000, cleanedHtml.length)

                    actualSectionContent = cleanedHtml.substring(sectionStart, sectionEnd).trim()
                    console.log(`📋 Extracted ${actualSectionContent.length} chars for section ${sectionId}`)
                }
            }
        }

        // Build enhancement prompt with the ACTUAL section content and anti-redundancy context
        const enhancePrompt = `You are an expert content writer for ${page.page_type.toLowerCase()} pages.

SECTION TO ENHANCE: ${sectionDef.name}
Section Purpose: ${sectionDef.description}

PAGE CONTEXT:
Title: ${page.title || 'Untitled'}
URL: ${page.url}

${hasEnhancedSections ? `ALREADY ENHANCED SECTIONS (DO NOT REPEAT THIS CONTENT):
${alreadyEnhancedList}
` : ''}
ANTI-REDUNDANCY RULES (CRITICAL - MUST FOLLOW):
1. Do NOT start with an intro like "At [Business Name]..." or "Welcome to..." - that belongs in the Hero section ONLY
2. Do NOT repeat information already covered in other sections listed above
3. Do NOT add FAQ items to this section${enhancedFAQ ? ' - there is already an FAQ section enhanced' : ' unless this IS the FAQ section'}
4. Do NOT add a call-to-action${enhancedCTA ? ' - there is already a CTA section enhanced' : ' unless this IS the CTA section'}
5. Focus ONLY on this section's unique purpose: ${sectionDef.description}
6. The business/brand name should appear at MOST once in this section (preferably zero for non-hero sections)
7. Each section should have DISTINCT content - no overlapping phrases or repeated selling points

${actualSectionContent ? `ORIGINAL SECTION CONTENT (from the actual page):
${actualSectionContent}` : `The section is MISSING. Generate new content for it based on the page context.`}

${template.rewrite_prompt || 'Rewrite this section to be more engaging, SEO-friendly, and persuasive while maintaining the same factual information.'}

CONTENT PRESERVATION REQUIREMENTS (MUST FOLLOW):
1. PRESERVE EXACT ORIGINAL QUESTIONS - If enhancing FAQs, keep the EXACT same questions from the original. Do NOT replace them with generic questions.
2. Your enhanced content MUST be AT LEAST as thorough and comprehensive as the original
3. If the original includes FAQs, you MUST include the same number of FAQ items with the SAME questions (enhanced answers are OK)
4. If the original includes testimonials, statistics, pricing, or any other specific content elements, you MUST preserve and enhance them
5. Do NOT remove, simplify, or replace content - ENHANCE and IMPROVE it while keeping all the original elements
6. If original has 6 questions about "needle size", "cost", "pain level" - your version must have those SAME 6 questions

IMPORTANT: Your enhanced_content MUST be properly formatted HTML, not plain text. Use these HTML tags:
- <h1> for main titles
- <h2> for section headings  
- <h3> for sub-headings or individual FAQ questions
- <p> for paragraphs and FAQ answers
- <strong> for emphasis
- <ul>/<li> for lists
- For FAQs specifically, use <h3> for questions and <p> for answers, OR preserve the original <details>/<summary> structure if present

Example enhanced FAQ format:
"<h2>Frequently Asked Questions</h2><h3>What is the Cost of Aquagold Treatment?</h3><p>The Aquagold treatment typically costs $XXX per session...</p><h3>Is Aquagold Facial Painful?</h3><p>Most patients experience minimal discomfort...</p>"


Respond in this JSON format:
{
    "section_id": "${sectionId}",
    "section_name": "${sectionDef.name}",
    "original_content": "The original content if provided",
    "enhanced_content": "Your improved HTML content with proper tags like <h2>, <p>, <ul>, etc.",
    "is_new_section": ${!actualSectionContent},
    "implementation_notes": "Clear instructions on where and how to implement this content",
    "changes_made": ["List of specific improvements made"],
    "reasoning": "Explanation of why these changes improve the content"

}`

        // Fetch prompt from database
        const promptData = await getPrompt('section_enhancement')
        const systemPrompt = promptData?.system_prompt || 'You are an expert content writer who creates engaging, SEO-optimized content for websites.'
        const selectedModel = model || promptData?.default_model || 'gpt-4o'

        if (!openai) {
            return res.status(400).json({ error: 'OpenAI API key not configured' })
        }

        const startTime = Date.now()
        const response = await openai.chat.completions.create({
            model: selectedModel,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: enhancePrompt }
            ],
            temperature: 0.7,
            response_format: { type: 'json_object' }
        })

        const content = response.choices[0]?.message?.content
        const inputTokens = response.usage?.prompt_tokens || 0
        const outputTokens = response.usage?.completion_tokens || 0
        const requestDurationMs = Date.now() - startTime

        if (!content) {
            return res.status(500).json({ error: 'No response from AI' })
        }

        // Log AI usage
        await logAIUsage({
            action: 'section_enhancement',
            pageId,
            pageUrl: page.url,
            provider: 'openai',
            model: selectedModel,
            inputTokens,
            outputTokens,
            requestDurationMs,
            success: true
        })

        // Parse response
        let enhancement
        try {
            enhancement = JSON.parse(content)
        } catch (e) {
            return res.status(500).json({ error: 'Failed to parse AI response', raw: content })
        }

        // Save enhanced content to database
        try {
            // Get existing enhanced_content or initialize
            const { data: existingPage } = await getSupabase()
                .from('page_index')
                .select('enhanced_content')
                .eq('id', pageId)
                .single()

            const existingContent = existingPage?.enhanced_content || { sections: {} }

            // Update the specific section
            existingContent.sections[sectionId] = {
                original: sectionContent || null,
                enhanced: enhancement.enhanced_content,
                reasoning: enhancement.reasoning,
                changes: enhancement.changes_made || [],
                heading_level: sectionDef.heading_level || null,
                is_new_section: enhancement.is_new_section || false,
                enhanced_at: new Date().toISOString()
            }

            // Update page with enhanced content
            await getSupabase()
                .from('page_index')
                .update({
                    enhanced_content: existingContent,
                    content_analyzed_at: new Date().toISOString()
                })
                .eq('id', pageId)

            console.log(`✅ Saved enhanced content for section ${sectionId} on page ${pageId}`)
        } catch (saveError) {
            console.error('Failed to save enhanced content:', saveError)
            // Continue - still return the enhancement even if save fails
        }

        res.json({
            success: true,
            enhancement,
            tokens: { input: inputTokens, output: outputTokens },
            durationMs: requestDurationMs
        })

    } catch (error) {
        console.error('Section enhancement error:', error)
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
