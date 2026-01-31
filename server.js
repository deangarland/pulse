import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

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

// OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
})

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
    res.json({ status: 'ok', openai: !!process.env.OPENAI_API_KEY })
})

app.post('/api/generate-recommendations', async (req, res) => {
    try {
        const { pageId } = req.body

        if (!pageId) {
            return res.status(400).json({ error: 'pageId is required' })
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

        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.7,
            max_tokens: 4000
        })

        const content = response.choices[0]?.message?.content
        if (!content) {
            return res.status(500).json({ error: 'No response from OpenAI' })
        }

        const recommendations = JSON.parse(content)

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
            message: 'Recommendations generated successfully'
        })

    } catch (error) {
        console.error('Generate error:', error)
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
