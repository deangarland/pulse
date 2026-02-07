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
    // Walk backward to find where footer starts
    for (let i = lines.length - 1; i > firstHeadingIdx; i--) {
        const trimmed = lines[i].trim()
        if (!trimmed) continue
        if (footerPatterns.some(p => p.test(trimmed))) {
            lastContentIdx = i - 1
        } else {
            break
        }
    }

    // Filter lines between first heading and last content
    const cleaned = lines.slice(firstHeadingIdx, lastContentIdx + 1)
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

    return cleaned
}

// Fetch prompt from database by type (no caching to ensure fresh updates)
async function getPrompt(promptType) {
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

        return data
    } catch (err) {
        console.log(`Error fetching prompt: ${err.message}`)
        return null
    }
}

// Fetch prompt by ID (used when page type has a linked prompt)
async function getPromptById(promptId) {
    try {
        const { data, error } = await getSupabase()
            .from('prompts')
            .select('system_prompt, default_model, user_prompt_template, prompt_type')
            .eq('id', promptId)
            .single()

        if (error || !data) {
            console.log(`Prompt ID "${promptId}" not found in DB`)
            return null
        }

        return data
    } catch (err) {
        console.log(`Error fetching prompt by ID: ${err.message}`)
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

// Get provider from model name
function getProviderForModel(modelName) {
    if (OPENAI_MODELS.includes(modelName)) return 'openai'
    if (ANTHROPIC_MODELS.includes(modelName)) return 'anthropic'
    if (GEMINI_MODELS.includes(modelName)) return 'gemini'
    return 'openai' // default fallback
}

// Strip markdown code blocks from AI responses (Claude wraps JSON in ```json ... ```)
function stripMarkdownCodeBlock(content) {
    if (!content) return content
    // Remove ```json or ``` from start and ``` from end
    return content
        .replace(/^```(?:json)?\s*\n?/i, '')
        .replace(/\n?```\s*$/i, '')
        .trim()
}

// Unified AI call function supporting multiple providers
async function callAI({ model, systemPrompt, userPrompt, temperature = 0.7, jsonMode = false }) {
    const provider = getProviderForModel(model)
    const startTime = Date.now()
    let content, inputTokens = 0, outputTokens = 0

    if (provider === 'openai') {
        if (!openai) throw new Error('OpenAI API key not configured')
        const response = await openai.chat.completions.create({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature,
            ...(jsonMode && { response_format: { type: 'json_object' } })
        })
        content = response.choices[0]?.message?.content
        inputTokens = response.usage?.prompt_tokens || 0
        outputTokens = response.usage?.completion_tokens || 0
    } else if (provider === 'anthropic') {
        if (!anthropic) throw new Error('Anthropic API key not configured')
        const response = await anthropic.messages.create({
            model,
            max_tokens: 8000,
            system: systemPrompt,
            messages: [
                { role: 'user', content: userPrompt + (jsonMode ? '\n\nRespond with valid JSON only.' : '') }
            ]
        })
        content = response.content[0]?.text
        inputTokens = response.usage?.input_tokens || 0
        outputTokens = response.usage?.output_tokens || 0
    } else if (provider === 'gemini') {
        if (!genAI) throw new Error('Gemini API key not configured')
        const geminiModel = genAI.getGenerativeModel({ model })
        const result = await geminiModel.generateContent({
            contents: [
                { role: 'user', parts: [{ text: systemPrompt + '\n\n' + userPrompt }] }
            ],
            generationConfig: {
                temperature,
                maxOutputTokens: 8000,
                ...(jsonMode && { responseMimeType: 'application/json' })
            }
        })
        content = result.response.text()
        const usageMetadata = result.response.usageMetadata
        inputTokens = usageMetadata?.promptTokenCount || 0
        outputTokens = usageMetadata?.candidatesTokenCount || 0
    }

    return {
        content,
        provider,
        inputTokens,
        outputTokens,
        durationMs: Date.now() - startTime
    }
}
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

    // Fetch prompt from database
    const promptData = await getPrompt('schema_procedure_extraction')
    const userPromptTemplate = promptData?.user_prompt_template || ''
    const selectedModel = promptData?.default_model || 'gpt-4o-mini'

    // Substitute variables
    const prompt = userPromptTemplate.replace(/\{\{content\}\}/g, content)

    if (!prompt) {
        console.error('Schema: Procedure Field Extraction prompt not found in database')
        return { bodyLocation: null, procedureType: null, howPerformed: null, preparation: null, followup: null, tokens: { input: 0, output: 0 } }
    }

    try {
        const response = await openai.chat.completions.create({
            model: selectedModel,
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

    // Fetch prompt from database
    const promptData = await getPrompt('schema_team_extraction')
    const userPromptTemplate = promptData?.user_prompt_template || ''
    const selectedModel = promptData?.default_model || 'gpt-4o-mini'

    // Substitute variables
    const prompt = userPromptTemplate.replace(/\{\{content\}\}/g, content)

    if (!prompt) {
        console.error('Schema: Team Member Extraction prompt not found in database')
        return { name: null, jobTitle: null, credentials: null, isPhysician: false, specialties: [], education: null, tokens: { input: 0, output: 0 } }
    }

    try {
        const response = await openai.chat.completions.create({
            model: selectedModel,
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

        // Run crawler in-process using Firecrawl (fire and forget)
        import('./firecrawl-service.js').then(({ crawlSite }) => {
            crawlSite(siteData.id, siteData.url, {
                limit: page_limit,
                exclude: exclude_paths,
                runClassifier: run_classifier
            })
                .then(() => console.log(`✅ Firecrawl complete for ${domain}`))
                .catch(err => console.error(`❌ Firecrawl failed for ${domain}:`, err.message))
        }).catch(err => {
            console.error(`❌ Failed to import Firecrawl service:`, err)
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

// POST /api/pages/:id/recrawl - Re-crawl a single page with Playwright
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

        console.log(`🔄 Re-crawling page with Firecrawl: ${page.url}`)

        // Import and use Firecrawl service
        const { scrapePage, parseFirecrawlResponse } = await import('./firecrawl-service.js')

        // Fetch using Firecrawl
        const result = await scrapePage(page.url, { onlyMainContent: true })

        if (!result.markdown) {
            return res.status(500).json({
                error: 'Firecrawl returned empty content'
            })
        }

        // Extract headings from markdown
        const headings = []
        const headingMatches = result.markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)
        for (const match of headingMatches) {
            headings.push({ level: match[1].length, text: match[2].trim() })
        }

        // Update the page in database
        const { error: updateError } = await getSupabase()
            .from('page_index')
            .update({
                title: result.metadata?.title || null,
                html_content: result.rawHtml,        // Full HTML
                cleaned_html: result.html,           // Cleaned HTML (main content)
                main_content: cleanMarkdown(result.markdown),       // LLM-ready markdown (cleaned)
                headings: headings,
                meta_tags: {
                    description: result.metadata?.description || '',
                    keywords: result.metadata?.keywords || '',
                    ogTitle: result.metadata?.ogTitle || '',
                    ogDescription: result.metadata?.ogDescription || '',
                    ogImage: result.metadata?.ogImage || '',
                },
                links_internal: result.links?.filter(l => {
                    try { return new URL(l, page.url).hostname === new URL(page.url).hostname } catch { return false }
                }).map(l => { try { return new URL(l, page.url).pathname } catch { return l } }) || [],
                links_external: result.links?.filter(l => {
                    try { return new URL(l, page.url).hostname !== new URL(page.url).hostname } catch { return true }
                }) || [],
                crawled_at: new Date().toISOString()
            })
            .eq('id', id)

        if (updateError) {
            return res.status(500).json({ error: updateError.message })
        }

        console.log(`✅ Re-crawled with Firecrawl: ${page.url}`)
        res.json({ success: true, message: 'Page re-crawled successfully with Firecrawl' })
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


// POST /api/enhance-page - One-shot page analysis and enhancement
// Replaces the multi-step analyze + enhance-section flow with a single AI call
app.post('/api/enhance-page', async (req, res) => {
    try {
        const { pageId, model } = req.body

        if (!pageId) {
            return res.status(400).json({ error: 'pageId is required' })
        }

        console.log(`\n🚀 ONE-SHOT PAGE ENHANCEMENT: Starting for page ${pageId}`)
        const startTime = Date.now()

        // Get page content
        const { data: page, error: pageError } = await getSupabase()
            .from('page_index')
            .select('id, url, title, page_type, cleaned_html, site_id')
            .eq('id', pageId)
            .single()

        if (pageError || !page) {
            return res.status(404).json({ error: 'Page not found' })
        }

        if (!page.page_type) {
            return res.status(400).json({ error: 'Page must have page_type set. Classify the page first.' })
        }

        if (!page.cleaned_html || page.cleaned_html.length < 100) {
            return res.status(400).json({ error: 'Page has no content. Recrawl the page first.' })
        }

        // Get template for this page type (includes enhancement_guidance)
        const { data: template, error: templateError } = await getSupabase()
            .from('page_content_templates')
            .select('*')
            .eq('page_type', page.page_type)
            .single()

        if (templateError || !template) {
            return res.status(404).json({ error: `No template found for page type: ${page.page_type}` })
        }

        // Get site info for business name
        const { data: site } = await getSupabase()
            .from('site_index')
            .select('domain, name')
            .eq('id', page.site_id)
            .single()

        // Extract business name and location from page data
        const businessName = site?.name || page.title?.split(/[-|–]/)[0]?.trim() || 'this business'
        const locationMatch = page.url?.match(/(?:saint[-\s]?johns|st[-\s]?augustine|jacksonville|florida|fl)/i)
        const location = locationMatch ? locationMatch[0] : ''

        // Build sections lists
        const requiredSections = (template.sections || [])
            .filter(s => s.required)
            .map(s => `- ${s.id}: "${s.name}" - ${s.description}`)
            .join('\n')

        const optionalSections = (template.sections || [])
            .filter(s => !s.required)
            .map(s => `- ${s.id}: "${s.name}" - ${s.description}`)
            .join('\n')

        // Fetch prompt linked to this page type (or fall back to page_enhancement)
        let promptData = null
        if (template.enhancement_prompt_id) {
            promptData = await getPromptById(template.enhancement_prompt_id)
            console.log(`   🔗 Using linked prompt (ID: ${template.enhancement_prompt_id})`)
        }
        if (!promptData) {
            promptData = await getPrompt('page_enhancement')
            console.log(`   📋 Using default page_enhancement prompt`)
        }
        if (!promptData) {
            return res.status(500).json({
                error: 'No enhancement prompt found. Link one via Admin > Page Types, or create a page_enhancement prompt.'
            })
        }

        const systemPrompt = promptData.system_prompt
        const userPromptTemplate = promptData.user_prompt_template
        const selectedModel = model || promptData.default_model || 'gpt-4o'

        // Build user prompt with all substitutions
        const userPrompt = userPromptTemplate
            .replace(/\{\{page_title\}\}/g, page.title || 'Untitled')
            .replace(/\{\{page_url\}\}/g, page.url || '')
            .replace(/\{\{page_type\}\}/g, page.page_type.toUpperCase())
            .replace(/\{\{business_name\}\}/g, businessName)
            .replace(/\{\{location\}\}/g, location)
            .replace(/\{\{enhancement_guidance\}\}/g, template.enhancement_guidance || 'No specific guidance for this page type.')
            .replace(/\{\{required_sections\}\}/g, requiredSections || 'None specified')
            .replace(/\{\{optional_sections\}\}/g, optionalSections || 'None specified')
            .replace(/\{\{cleaned_html\}\}/g, page.cleaned_html.substring(0, 50000)) // Cap at 50K chars

        console.log(`   📝 Prompt built: ${userPrompt.length} chars user prompt`)
        console.log(`   🤖 Calling ${selectedModel}...`)

        // Call AI
        const aiResult = await callAI({
            model: selectedModel,
            systemPrompt,
            userPrompt,
            temperature: 0.4,
            jsonMode: true
        })

        if (!aiResult.content) {
            return res.status(500).json({ error: 'No response from AI' })
        }

        console.log(`   ✅ AI responded in ${aiResult.durationMs}ms (${aiResult.inputTokens} in, ${aiResult.outputTokens} out)`)

        // Log AI usage
        await logAIUsage({
            action: 'page_enhancement',
            pageId,
            pageUrl: page.url,
            provider: aiResult.provider,
            model: selectedModel,
            inputTokens: aiResult.inputTokens,
            outputTokens: aiResult.outputTokens,
            requestDurationMs: aiResult.durationMs,
            success: true
        })

        // Parse response
        let enhancement
        try {
            enhancement = JSON.parse(stripMarkdownCodeBlock(aiResult.content))
        } catch (e) {
            console.error('Failed to parse AI response:', aiResult.content.substring(0, 500))
            return res.status(500).json({ error: 'Failed to parse AI response', raw: aiResult.content.substring(0, 1000) })
        }

        // Build enhanced_content structure for database
        const enhancedContent = {
            // Summary info
            summary: enhancement.summary || enhancement.page_summary || {},
            overall_assessment: enhancement.summary?.key_improvements?.join('. ') || '',
            analyzed_at: new Date().toISOString(),

            // Section data - convert array to object keyed by section_id
            sections: {},
            section_analysis: enhancement.sections || [],

            // Additional insights
            missing_sections: enhancement.missing_sections || [],
            linking_opportunities: enhancement.linking_opportunities || enhancement.internal_linking_opportunities || []
        }

        // Convert sections array to object format expected by UI
        if (enhancement.sections && Array.isArray(enhancement.sections)) {
            for (const section of enhancement.sections) {
                enhancedContent.sections[section.section_id] = {
                    section_name: section.section_name,
                    original: section.original_html,
                    enhanced: section.enhanced_html,
                    changes: section.changes || section.changes_made || [],
                    keywords_preserved: section.keywords_preserved || [],
                    template_match: section.matched !== false,
                    enhanced_at: new Date().toISOString()
                }
            }
        }

        // Save to database
        await getSupabase()
            .from('page_index')
            .update({
                enhanced_content: enhancedContent,
                content_analyzed_at: new Date().toISOString()
            })
            .eq('id', pageId)

        const totalTime = Date.now() - startTime
        console.log(`   🎉 Page enhancement complete in ${totalTime}ms`)

        res.json({
            success: true,
            pageId,
            enhancement,
            tokens: { input: aiResult.inputTokens, output: aiResult.outputTokens },
            durationMs: totalTime
        })

    } catch (error) {
        console.error('Page enhancement error:', error)
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
