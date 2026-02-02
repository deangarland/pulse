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
            'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022',
            'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'
        ]
        const GEMINI_MODELS = [
            'gemini-2.5-pro-preview-05-06', 'gemini-2.5-flash-preview-05-20',
            'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'
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
        }

        if (!content) {
            return res.status(500).json({ error: `No response from ${provider}` })
        }

        // Parse JSON - handle potential markdown wrapping
        let jsonContent = content.trim()
        if (jsonContent.startsWith('```')) {
            jsonContent = jsonContent.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
        }
        const recommendations = JSON.parse(jsonContent)

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
            message: 'Recommendations generated successfully'
        })

    } catch (error) {
        console.error('Generate error:', error)
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
