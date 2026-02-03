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
            'claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'
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
        const { url, account_id, page_limit = 200, exclude_paths = [] } = req.body

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
            // Update existing site to re-crawl
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
            runCrawl(siteData.id, page_limit, exclude_paths)
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
