import { useState, useCallback, useMemo, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { SearchableCombobox } from "@/components/ui/searchable-combobox"
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs"
import { Sparkles, Download, ChevronDown, ChevronRight, Copy, Check, AlertCircle, FileCode, FileText, Tag, Loader2, Wand2, RefreshCw, Pencil } from "lucide-react"
import { toast } from "sonner"
import { ModelSelector } from "@/components/ModelSelector"
import { PageEditSheet } from "@/components/PageEditSheet"

interface StructuredContentItem {
    type: 'heading' | 'paragraph'
    level?: 'h1' | 'h2' | 'h3' | 'h4'
    text: string
}

interface Page {
    id: string
    url: string
    title: string
    page_type: string
    meta_tags: { title?: string; description?: string }
    headings: { h1?: string[]; h2?: string[]; h3?: string[]; h4?: string[] } | null
    main_content: string | null
    cleaned_html: string | null
    structured_content: StructuredContentItem[] | null
    schema_markup: any[]
    meta_recommendation: {
        title?: { recommended: string; reasoning: string }
        description?: { recommended: string; reasoning: string }
    } | null
    schema_recommendation: {
        schemas: Array<{
            type: string
            priority: string
            reasoning: string
            json_ld: object
        }>
        overall_reasoning: string
    } | null
    // New unified schema column (from batch generator)
    recommended_schema: {
        '@context': string
        '@graph': any[]
    } | null
    schema_status: string | null
    schema_generated_at: string | null
    recommendation_generated_at: string | null
}

// Syntax highlighted JSON display
function JsonPreview({ data, className = '' }: { data: object; className?: string }) {
    const [copied, setCopied] = useState(false)
    const json = JSON.stringify(data, null, 2)

    const handleCopy = async () => {
        await navigator.clipboard.writeText(json)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <div className={`relative group ${className}`}>
            <pre className="bg-slate-950 text-slate-50 p-4 rounded-lg text-xs overflow-x-auto max-h-[300px] overflow-y-auto">
                <code>{json}</code>
            </pre>
            <Button
                size="sm"
                variant="ghost"
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={handleCopy}
            >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
        </div>
    )
}

// Collapsible reasoning section
function ReasoningSection({ reasoning, label = "Why" }: { reasoning: string; label?: string }) {
    const [open, setOpen] = useState(false)

    return (
        <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 cursor-pointer">
                {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <span>{label}</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 text-xs text-muted-foreground bg-blue-50 p-3 rounded-md border border-blue-100">
                {reasoning}
            </CollapsibleContent>
        </Collapsible>
    )
}

// Clean HTML Content Renderer - renders cleaned_html with proper formatting
function CleanHtmlContent({ html, wordCount }: { html: string; wordCount?: number }) {
    const containerRef = useCallback((node: HTMLDivElement | null) => {
        if (!node) return

        // Process the HTML content after mounting
        const processContent = () => {
            // Add badges to headings
            node.querySelectorAll('h1, h2, h3, h4').forEach(heading => {
                const level = heading.tagName.toLowerCase()
                const badge = document.createElement('span')
                badge.className = `inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold uppercase mr-2 ${level === 'h1' ? 'bg-blue-500 text-white' :
                    level === 'h2' ? 'bg-green-500 text-white' :
                        level === 'h3' ? 'bg-purple-500 text-white' :
                            'bg-orange-500 text-white'
                    }`
                badge.textContent = level.toUpperCase()
                heading.insertBefore(badge, heading.firstChild)
                const headingClasses = (
                    level === 'h1' ? 'text-xl font-bold mt-4' :
                        level === 'h2' ? 'text-lg font-semibold mt-4' :
                            level === 'h3' ? 'text-base font-medium mt-3' :
                                'text-sm font-medium mt-2'
                ).split(' ')
                heading.classList.add(...headingClasses)
            })

            // Style paragraphs
            node.querySelectorAll('p').forEach(p => {
                p.classList.add('text-sm', 'leading-relaxed', 'my-2')
            })

            // Style bullet lists
            node.querySelectorAll('ul, ol').forEach(list => {
                list.classList.add('my-3', 'ml-4')
                if (list.tagName === 'UL') {
                    list.classList.add('list-disc')
                } else {
                    list.classList.add('list-decimal')
                }
            })
            node.querySelectorAll('li').forEach(li => {
                li.classList.add('text-sm', 'leading-relaxed', 'my-1', 'ml-4')
            })

            // Replace images with placeholders showing alt text
            node.querySelectorAll('img').forEach(img => {
                const alt = img.getAttribute('alt') || 'Image'
                const src = img.getAttribute('src') || ''
                const placeholder = document.createElement('div')
                placeholder.className = 'my-3 p-4 bg-slate-100 border-2 border-dashed border-slate-300 rounded-lg flex flex-col items-center justify-center min-h-[100px]'
                placeholder.innerHTML = `
                    <div class="text-slate-400 mb-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                    </div>
                    <div class="text-xs font-medium text-slate-600 text-center px-2">${alt}</div>
                    ${src ? `<div class="text-xs text-slate-400 truncate max-w-[200px] mt-1">${src.split('/').pop()}</div>` : ''}
                `
                img.replaceWith(placeholder)
            })

            // Detect and style FAQ sections
            node.querySelectorAll('[itemtype*="FAQPage"], .faq, [class*="faq"], [id*="faq"]').forEach(faq => {
                const faqBadge = document.createElement('div')
                faqBadge.className = 'inline-flex items-center px-2 py-1 bg-amber-100 text-amber-800 rounded text-xs font-bold mb-2'
                faqBadge.textContent = '📋 FAQ SECTION'
                faq.insertBefore(faqBadge, faq.firstChild)
            })

            // Also detect FAQ by looking for question patterns
            node.querySelectorAll('details, [class*="accordion"]').forEach(accordion => {
                accordion.classList.add('my-2', 'p-2', 'bg-slate-50', 'rounded', 'border')
            })
        }

        processContent()
    }, [])

    // Sanitize and prepare HTML
    const sanitizedHtml = useMemo(() => {
        // Simple sanitization - remove script/style tags, keep structure
        return html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
            .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
    }, [html])

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between text-sm text-muted-foreground mb-3">
                <span>Page content (from cleaned HTML)</span>
                {wordCount && <span>{wordCount} words</span>}
            </div>
            <div
                ref={containerRef}
                className="bg-muted/30 p-6 rounded-md max-h-[600px] overflow-y-auto"
                dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
            />
        </div>
    )
}

// Schema Component Card for carousel
function SchemaComponentCard({
    schema,
    isExpanded,
    onToggle
}: {
    schema: any
    isExpanded: boolean
    onToggle: () => void
}) {
    const schemaType = schema['@type'] || 'Unknown'
    const [copied, setCopied] = useState(false)

    const handleCopy = async (e: React.MouseEvent) => {
        e.stopPropagation()
        await navigator.clipboard.writeText(JSON.stringify(schema, null, 2))
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    // Get icon/color based on schema type
    const getSchemaStyle = (type: string) => {
        const styles: Record<string, { bg: string; border: string; text: string }> = {
            'MedicalProcedure': { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700' },
            'MedicalBusiness': { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700' },
            'Physician': { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700' },
            'Person': { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700' },
            'Organization': { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700' },
            'LocalBusiness': { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700' },
            'PostalAddress': { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-700' },
            'BreadcrumbList': { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700' },
            'BlogPosting': { bg: 'bg-pink-50', border: 'border-pink-200', text: 'text-pink-700' },
            'FAQPage': { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700' },
        }
        return styles[type] || { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-700' }
    }

    const style = getSchemaStyle(schemaType)

    return (
        <div
            className={`flex-shrink-0 w-64 border rounded-lg ${style.border} ${style.bg} cursor-pointer transition-all hover:shadow-md ${isExpanded ? 'ring-2 ring-primary' : ''}`}
            onClick={onToggle}
        >
            <div className="p-3">
                <div className="flex items-center justify-between mb-2">
                    <span className={`font-medium text-sm ${style.text}`}>{schemaType}</span>
                    <button
                        onClick={handleCopy}
                        className="p-1 hover:bg-white/50 rounded"
                    >
                        {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3 text-gray-500" />}
                    </button>
                </div>

                {/* Key fields preview */}
                <div className="space-y-1 text-xs text-gray-600">
                    {schema.name && (
                        <div className="truncate">
                            <span className="text-gray-400">name:</span> {schema.name}
                        </div>
                    )}
                    {schema.url && (
                        <div className="truncate">
                            <span className="text-gray-400">url:</span> {schema.url}
                        </div>
                    )}
                    {schema['@id'] && (
                        <div className="truncate">
                            <span className="text-gray-400">@id:</span> {schema['@id']}
                        </div>
                    )}
                </div>

                {/* Field count */}
                <div className="mt-2 text-xs text-gray-400">
                    {Object.keys(schema).filter(k => !k.startsWith('@') || k === '@type').length} fields
                </div>
            </div>

            {/* Expanded view */}
            {isExpanded && (
                <div className="border-t p-3 bg-white rounded-b-lg">
                    <pre className="text-xs overflow-x-auto max-h-48 overflow-y-auto bg-slate-950 text-slate-50 p-2 rounded">
                        <code>{JSON.stringify(schema, null, 2)}</code>
                    </pre>
                </div>
            )}
        </div>
    )
}

// Schema Carousel Component
function SchemaCarousel({ schemas }: { schemas: any[] }) {
    const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

    if (!schemas || schemas.length === 0) {
        return (
            <div className="text-sm text-muted-foreground italic py-4">
                No schema components to display
            </div>
        )
    }

    return (
        <div className="relative">
            <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
                {schemas.map((schema, i) => (
                    <SchemaComponentCard
                        key={i}
                        schema={schema}
                        isExpanded={expandedIndex === i}
                        onToggle={() => setExpandedIndex(expandedIndex === i ? null : i)}
                    />
                ))}
            </div>

            {/* Scroll indicators */}
            {schemas.length > 3 && (
                <div className="absolute right-0 top-0 bottom-4 w-8 bg-gradient-to-l from-white to-transparent pointer-events-none" />
            )}
        </div>
    )
}

// Character count display with color coding
// Red: over max | Green: within 10% of max | Black: under
function CharacterCount({ text, maxLength }: { text: string | null; maxLength: number }) {
    if (!text) return null

    const length = text.length
    const idealMin = Math.floor(maxLength * 0.9) // 10% below max

    let colorClass = 'text-slate-600' // Default: under
    if (length > maxLength) {
        colorClass = 'text-red-600 font-medium' // Over limit
    } else if (length >= idealMin) {
        colorClass = 'text-green-600 font-medium' // Within 10% - ideal
    }

    return (
        <span className={`text-xs ${colorClass}`}>
            ({length}/{maxLength})
        </span>
    )
}

// Before/After comparison row with copy button
function ComparisonRow({
    label,
    before,
    after,
    reasoning,
    icon: Icon,
    maxLength
}: {
    label: string
    before: string | null
    after: string | null
    reasoning?: string
    icon?: React.ComponentType<{ className?: string }>
    maxLength?: number
}) {
    const IconComponent = Icon || Tag
    const hasChange = before !== after
    const [copied, setCopied] = useState(false)

    const copyToClipboard = () => {
        if (after) {
            navigator.clipboard.writeText(after)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        }
    }

    return (
        <div className="grid grid-cols-2 gap-4 py-4 border-b border-border/50 last:border-0">
            {/* Before */}
            <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <IconComponent className="h-3.5 w-3.5" />
                    {label}
                    {maxLength && <CharacterCount text={before} maxLength={maxLength} />}
                </div>
                <div className="text-sm">
                    {before || <span className="text-muted-foreground italic">Not set</span>}
                </div>
            </div>

            {/* After */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        {hasChange && <span className="text-green-600">✓ Optimized</span>}
                        {maxLength && after && <CharacterCount text={after} maxLength={maxLength} />}
                    </div>
                    {after && (
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={copyToClipboard}>
                            {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
                        </Button>
                    )}
                </div>
                <div className={`text-sm ${hasChange ? 'text-green-700 font-medium' : ''}`}>
                    {after || <span className="text-muted-foreground italic">No recommendation</span>}
                </div>
                {reasoning && <ReasoningSection reasoning={reasoning} label="Why this change?" />}
            </div>
        </div>
    )
}

// Page types for filter
const PAGE_TYPES = [
    'HOMEPAGE', 'PROCEDURE', 'RESOURCE', 'ABOUT', 'CONTACT',
    'LOCATION', 'TEAM_MEMBER', 'GALLERY', 'CONDITION', 'GENERIC'
]

export default function PageContent() {
    const [searchParams, setSearchParams] = useSearchParams()
    const [activeTab, setActiveTab] = useState('content')
    const [selectedSite, setSelectedSite] = useState<string>('')
    const [selectedPage, setSelectedPage] = useState<string>(searchParams.get('pid') || '')
    const [pageTypeFilter, setPageTypeFilter] = useState<string>('')
    const [selectedModel, setSelectedModel] = useState<string>('gpt-4o')

    // Sync selected page to URL for shareability
    const handlePageSelect = useCallback((pageId: string) => {
        setSelectedPage(pageId)
        if (pageId) {
            searchParams.set('pid', pageId)
        } else {
            searchParams.delete('pid')
        }
        setSearchParams(searchParams, { replace: true })
    }, [searchParams, setSearchParams])

    // Listen for global account changes
    useEffect(() => {
        // Load initial account from localStorage
        const savedAccountId = localStorage.getItem('selectedAccountId')
        if (savedAccountId) {
            fetchSiteForAccount(savedAccountId)
        }

        // Listen for changes
        const handleAccountChange = (e: CustomEvent) => {
            const accountId = e.detail
            if (accountId && accountId !== 'all') {
                fetchSiteForAccount(accountId)
            } else {
                setSelectedSite('')
                setSelectedPage('')
            }
        }

        window.addEventListener('accountChanged', handleAccountChange as EventListener)
        return () => window.removeEventListener('accountChanged', handleAccountChange as EventListener)
    }, [])

    // Fetch site for selected account
    const fetchSiteForAccount = async (accountId: string) => {
        const { data, error } = await supabase
            .from('site_index')
            .select('id')
            .eq('account_id', accountId)
            .limit(1)
            .single()

        if (!error && data) {
            setSelectedSite(data.id)
            setSelectedPage('')
        }
    }

    // Fetch pages for selected site (exclude 301 redirects)
    const { data: pages, isLoading: pagesLoading } = useQuery({
        queryKey: ['site-pages', selectedSite],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('page_index')
                .select('id, url, title, page_type, status_code')
                .eq('site_id', selectedSite)
                .neq('status_code', 301)
                .order('url')
            if (error) throw error
            return data as { id: string; url: string; title: string; page_type: string; status_code: number }[]
        },
        enabled: !!selectedSite
    })

    // Page type options for filter
    const pageTypeOptions = useMemo(() => [
        { value: '', label: 'All Types' },
        ...PAGE_TYPES.map(type => ({ value: type, label: type }))
    ], [])

    // Convert pages to combobox options (filtered by page type)
    const pageOptions = useMemo(() => {
        let filtered = pages || []
        if (pageTypeFilter) {
            filtered = filtered.filter(p => p.page_type === pageTypeFilter)
        }
        return filtered.map(p => ({
            value: p.id,
            label: new URL(p.url).pathname,
            sublabel: p.page_type || undefined
        }))
    }, [pages, pageTypeFilter])

    // Fetch selected page details
    const { data: page, isLoading: pageLoading, refetch: refetchPage } = useQuery({
        queryKey: ['page-detail', selectedPage],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('page_index')
                .select('*')
                .eq('id', selectedPage)
                .single()
            if (error) throw error
            return data as Page
        },
        enabled: !!selectedPage
    })

    // Fetch default model from prompts table
    const { data: promptSettings } = useQuery({
        queryKey: ['prompt-default-model'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('prompts')
                .select('default_model')
                .eq('name', 'Meta Recommendations')
                .single()
            if (error) return { default_model: 'gpt-4o' }
            return data
        }
    })

    // Update selected model when prompt settings load
    useEffect(() => {
        if (promptSettings?.default_model) {
            setSelectedModel(promptSettings.default_model)
        }
    }, [promptSettings])

    // Generate schema mutation (uses v2 template-based endpoint)
    const generateSchemaMutation = useMutation({
        mutationFn: async ({ pageId }: { pageId: string }) => {
            const apiUrl = import.meta.env.VITE_API_URL || ''
            const response = await fetch(`${apiUrl}/api/generate-schema-v2`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageId, includeMedium: true })
            })

            if (!response.ok) {
                const error = await response.json()
                throw new Error(error.error || 'Failed to generate schema')
            }

            return response.json()
        },
        onSuccess: (data) => {
            if (data.skipped) {
                toast.info('Schema generation skipped', {
                    description: data.reason
                })
            } else {
                toast.success('Schema generated!', {
                    description: `Generated ${data.schemaType} schema${data.linkedSchemas?.length ? ` + ${data.linkedSchemas.length} linked` : ''}`
                })
            }
            refetchPage()
        },
        onError: (error: Error) => {
            toast.error('Generation failed', {
                description: error.message
            })
        }
    })

    // Generate meta recommendations mutation (existing API for meta tags)
    const generateMutation = useMutation({
        mutationFn: async ({ pageId, model }: { pageId: string; model: string }) => {
            const apiUrl = import.meta.env.VITE_API_URL || ''
            const response = await fetch(`${apiUrl}/api/generate-recommendations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageId, model })
            })

            if (!response.ok) {
                const error = await response.json()
                throw new Error(error.error || 'Failed to generate recommendations')
            }

            return response.json()
        },
        onSuccess: (data) => {
            toast.success('Recommendations generated!', {
                description: data?.recommendations?.overall_reasoning?.slice(0, 100) + '...'
            })
            refetchPage()
        },
        onError: (error: Error) => {
            toast.error('Generation failed', {
                description: error.message
            })
        }
    })

    // Re-crawl single page mutation
    const recrawlMutation = useMutation({
        mutationFn: async (pageId: string) => {
            const apiUrl = import.meta.env.VITE_API_URL || ''
            const response = await fetch(`${apiUrl}/api/pages/${pageId}/recrawl`, {
                method: 'POST'
            })
            if (!response.ok) {
                const error = await response.json()
                throw new Error(error.error || 'Failed to re-crawl page')
            }
            return response.json()
        },
        onSuccess: () => {
            toast.success('Page re-crawled!')
            refetchPage()
        },
        onError: (error: Error) => {
            toast.error('Re-crawl failed', { description: error.message })
        }
    })

    // State for edit sheet
    const [editSheetOpen, setEditSheetOpen] = useState(false)

    // Export functions
    const exportAsMarkdown = useCallback(() => {
        if (!page) return

        const meta = page.meta_recommendation
        const schema = page.schema_recommendation

        const md = `# Meta & Schema Implementation: ${page.url}

## Meta Tags

### Title Tag
**Current:** ${page.meta_tags?.title || 'Not set'}
**Recommended:** ${meta?.title?.recommended || 'No recommendation'}
**Why:** ${meta?.title?.reasoning || 'N/A'}

### Meta Description
**Current:** ${page.meta_tags?.description || 'Not set'}
**Recommended:** ${meta?.description?.recommended || 'No recommendation'}
**Why:** ${meta?.description?.reasoning || 'N/A'}

## Schema Markup

${schema?.schemas?.map(s => `### ${s.type} (${s.priority} priority)
**Why:** ${s.reasoning}

\`\`\`json
${JSON.stringify(s.json_ld, null, 2)}
\`\`\`
`).join('\n') || 'No schema recommendations'}

## Overall Strategy
${schema?.overall_reasoning || 'N/A'}
`

        const blob = new Blob([md], { type: 'text/markdown' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `meta-schema-${new URL(page.url).pathname.replace(/\//g, '-')}.md`
        a.click()
        URL.revokeObjectURL(url)
        toast.success('Exported as Markdown')
    }, [page])

    const exportAsJson = useCallback(() => {
        if (!page) return

        const data = {
            url: page.url,
            page_type: page.page_type,
            generated_at: page.recommendation_generated_at,
            meta: {
                title: {
                    before: page.meta_tags?.title,
                    after: page.meta_recommendation?.title?.recommended,
                    reasoning: page.meta_recommendation?.title?.reasoning
                },
                description: {
                    before: page.meta_tags?.description,
                    after: page.meta_recommendation?.description?.recommended,
                    reasoning: page.meta_recommendation?.description?.reasoning
                }
            },
            schemas: page.schema_recommendation?.schemas || [],
            overall_reasoning: page.schema_recommendation?.overall_reasoning
        }

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `meta-schema-${new URL(page.url).pathname.replace(/\//g, '-')}.json`
        a.click()
        URL.revokeObjectURL(url)
        toast.success('Exported as JSON')
    }, [page])

    return (
        <div className="space-y-6">
            {/* Header with filters */}
            <Card>
                <CardHeader className="pb-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                <FileCode className="h-5 w-5" />
                                Page Content
                            </CardTitle>
                            <CardDescription>
                                Analyze and enhance page content, meta tags, and schema markup
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={!page?.meta_recommendation}
                                onClick={exportAsMarkdown}
                            >
                                <Download className="h-4 w-4 mr-2" />
                                Export MD
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={!page?.meta_recommendation}
                                onClick={exportAsJson}
                            >
                                <Download className="h-4 w-4 mr-2" />
                                Export JSON
                            </Button>
                        </div>
                    </div>

                    {/* Filters */}
                    <div className="flex items-center gap-4 mt-4 flex-wrap">

                        <SearchableCombobox
                            options={pageTypeOptions}
                            value={pageTypeFilter}
                            onValueChange={v => { setPageTypeFilter(v); setSelectedPage('') }}
                            placeholder="All page types"
                            searchPlaceholder="Filter by type..."
                            emptyText="No types found."
                            className="w-[160px]"
                        />

                        <SearchableCombobox
                            options={pageOptions}
                            value={selectedPage}
                            onValueChange={handlePageSelect}
                            placeholder={pagesLoading ? "Loading..." : "Select page..."}
                            searchPlaceholder="Search pages..."
                            emptyText="No pages found."
                            className="w-[350px]"
                            disabled={!selectedSite}
                        />

                        {/* Page Actions Separator */}
                        <div className="w-px h-8 bg-border" />

                        {/* Re-crawl Button */}
                        <Button
                            onClick={() => page && recrawlMutation.mutate(page.id)}
                            disabled={!selectedPage || recrawlMutation.isPending}
                            variant="outline"
                            size="sm"
                            title="Re-crawl this page"
                            aria-label="Re-crawl this page"
                        >
                            {recrawlMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <RefreshCw className="h-4 w-4" />
                            )}
                        </Button>

                        {/* Edit Page Button */}
                        <Button
                            onClick={() => setEditSheetOpen(true)}
                            disabled={!selectedPage}
                            variant="outline"
                            size="sm"
                            title="Edit page details"
                            aria-label="Edit page details"
                        >
                            <Pencil className="h-4 w-4" />
                        </Button>
                    </div>
                </CardHeader>
            </Card>

            {/* Content */}
            {!selectedPage ? (
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                        <FileCode className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>Select a site and page to view meta & schema analysis</p>
                    </CardContent>
                </Card>
            ) : pageLoading ? (
                <Card>
                    <CardContent className="py-6 space-y-4">
                        <Skeleton className="h-8 w-1/3" />
                        <Skeleton className="h-24 w-full" />
                        <Skeleton className="h-24 w-full" />
                    </CardContent>
                </Card>
            ) : page ? (
                <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="content" className="flex items-center gap-2">
                            <FileText className="h-4 w-4" />
                            Content
                        </TabsTrigger>
                        <TabsTrigger value="meta" className="flex items-center gap-2">
                            <Tag className="h-4 w-4" />
                            Meta
                        </TabsTrigger>
                        <TabsTrigger value="schema" className="flex items-center gap-2">
                            <FileCode className="h-4 w-4" />
                            Schema
                        </TabsTrigger>
                    </TabsList>

                    {/* Content Tab - Original vs Enhanced */}
                    <TabsContent value="content" className="space-y-4">
                        <Card>
                            <CardHeader className="pb-3">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <CardTitle className="text-base">Page Content</CardTitle>
                                        <CardDescription>
                                            Compare original and AI-enhanced content
                                        </CardDescription>
                                    </div>
                                    <Button
                                        variant="default"
                                        disabled
                                        className="gap-2"
                                    >
                                        <Wand2 className="h-4 w-4" />
                                        Generate Content
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <Tabs defaultValue="original" className="w-full">
                                    <TabsList className="grid w-full grid-cols-2 mb-4">
                                        <TabsTrigger value="original">Original</TabsTrigger>
                                        <TabsTrigger value="enhanced">Enhanced</TabsTrigger>
                                    </TabsList>

                                    {/* Original Content - prioritize cleaned_html */}
                                    <TabsContent value="original" className="space-y-4">
                                        {page.cleaned_html ? (
                                            <CleanHtmlContent
                                                html={page.cleaned_html}
                                                wordCount={page.main_content?.split(/\s+/).length || 0}
                                            />
                                        ) : (
                                            <>
                                                <div className="flex items-center justify-between text-sm text-muted-foreground mb-3">
                                                    <span>Page content preview</span>
                                                    <span>{page.main_content ? `${page.main_content.split(/\s+/).length} words` : '0 words'}</span>
                                                </div>
                                                <div className="bg-muted/30 p-6 rounded-md max-h-[600px] overflow-y-auto">
                                                    <article className="space-y-4">
                                                        {/* Primary H1 */}
                                                        {page.headings?.h1?.[0] && (
                                                            <h1 className="text-xl font-bold pb-3 border-b">
                                                                <span className="inline-flex items-center px-2 py-0.5 bg-blue-500 text-white rounded text-xs font-bold uppercase mr-2">
                                                                    H1
                                                                </span>
                                                                {page.headings.h1[0]}
                                                            </h1>
                                                        )}
                                                        {/* Fallback content display */}
                                                        <div className="text-sm leading-relaxed text-foreground/90 whitespace-pre-line">
                                                            {page.main_content?.substring(0, 5000) || 'No content extracted'}
                                                            {(page.main_content?.length ?? 0) > 5000 && (
                                                                <span className="text-muted-foreground"> [truncated...]</span>
                                                            )}
                                                        </div>
                                                        {/* H2 headings list */}
                                                        {page.headings?.h2 && page.headings.h2.length > 0 && (
                                                            <div className="mt-6 pt-4 border-t space-y-2">
                                                                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                                                                    Page Sections ({page.headings.h2.length})
                                                                </div>
                                                                {page.headings.h2.map((h, i) => (
                                                                    <div key={i} className="text-sm">
                                                                        <span className="inline-flex items-center px-1.5 py-0.5 bg-green-500 text-white rounded text-xs font-bold mr-2">
                                                                            H2
                                                                        </span>
                                                                        {h}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </article>
                                                </div>
                                            </>
                                        )}
                                    </TabsContent>

                                    {/* Enhanced Content (Tiptap Editor) */}
                                    <TabsContent value="enhanced" className="space-y-4">
                                        <div className="text-sm text-muted-foreground mb-3 p-4 bg-amber-50 border border-amber-200 rounded-md">
                                            <p className="font-medium text-amber-800">No enhanced content yet</p>
                                            <p className="text-amber-700 mt-1">Click "Generate Content" to create an AI-enhanced version of this page's content.</p>
                                        </div>

                                        {/* Tiptap Editor Placeholder - will be enabled after generation */}
                                        <div className="border rounded-md p-4 bg-muted/20 min-h-[300px] text-muted-foreground italic flex items-center justify-center">
                                            Enhanced content will appear here after generation
                                        </div>
                                    </TabsContent>
                                </Tabs>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* Meta Tab */}
                    <TabsContent value="meta" className="space-y-4">
                        <Card>
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <CardTitle className="text-base">Meta Tags</CardTitle>
                                        {page.recommendation_generated_at && (
                                            <span className="text-xs text-muted-foreground">
                                                Generated {new Date(page.recommendation_generated_at).toLocaleDateString()}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <ModelSelector
                                            value={selectedModel}
                                            onChange={setSelectedModel}
                                            disabled={generateMutation.isPending}
                                        />
                                        <Button
                                            onClick={() => page && generateMutation.mutate({ pageId: page.id, model: selectedModel })}
                                            disabled={generateMutation.isPending}
                                            className="gap-2"
                                        >
                                            {generateMutation.isPending ? (
                                                <>
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                    Generating...
                                                </>
                                            ) : (
                                                <>
                                                    <Tag className="h-4 w-4" />
                                                    Generate Meta
                                                </>
                                            )}
                                        </Button>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4 text-xs font-medium text-muted-foreground border-b pb-2 mt-4">
                                    <div>BEFORE (Current)</div>
                                    <div>AFTER (Recommended)</div>
                                </div>
                            </CardHeader>
                            <CardContent className="pt-0">
                                <ComparisonRow
                                    label="Title Tag"
                                    before={page.meta_tags?.title || page.title}
                                    after={page.meta_recommendation?.title?.recommended || null}
                                    reasoning={page.meta_recommendation?.title?.reasoning}
                                    maxLength={60}
                                />
                                <ComparisonRow
                                    label="Meta Description"
                                    before={page.meta_tags?.description || null}
                                    after={page.meta_recommendation?.description?.recommended || null}
                                    reasoning={page.meta_recommendation?.description?.reasoning}
                                    maxLength={160}
                                />
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* Schema Tab - existing schema comparison */}
                    <TabsContent value="schema" className="space-y-4">
                        <Card>
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <CardTitle className="text-base">Schema Markup</CardTitle>
                                        {page.schema_status && (
                                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${page.schema_status === 'validated' ? 'bg-green-100 text-green-800' :
                                                page.schema_status === 'skipped' ? 'bg-gray-100 text-gray-600' :
                                                    'bg-yellow-100 text-yellow-800'
                                                }`}>
                                                {page.schema_status}
                                                {page.schema_generated_at && (
                                                    <span className="ml-1 text-xs opacity-70">
                                                        • {new Date(page.schema_generated_at).toLocaleDateString()}
                                                    </span>
                                                )}
                                            </span>
                                        )}
                                    </div>
                                    <Button
                                        onClick={() => page && generateSchemaMutation.mutate({ pageId: page.id })}
                                        disabled={generateSchemaMutation.isPending}
                                        className="gap-2"
                                    >
                                        {generateSchemaMutation.isPending ? (
                                            <>
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                Generating...
                                            </>
                                        ) : (
                                            <>
                                                <Sparkles className="h-4 w-4" />
                                                Generate Schema
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                {/* Side-by-side Schema Panels */}
                                <div className="grid grid-cols-2 gap-4">
                                    {/* Existing Schema */}
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                                            <div className="w-2 h-2 rounded-full bg-gray-400" />
                                            EXISTING SCHEMA
                                        </div>
                                        <div className="border rounded-lg bg-gray-50">
                                            {page.schema_markup?.length > 0 ? (
                                                <div>
                                                    <div className="p-3 border-b bg-gray-100/50 flex flex-wrap gap-1">
                                                        {page.schema_markup.map((schema, i) => (
                                                            <span key={i} className="inline-flex items-center rounded-full border px-2 py-0.5 bg-gray-200 text-gray-700 text-xs">
                                                                {schema.type || schema['@type'] || 'Unknown'}
                                                            </span>
                                                        ))}
                                                    </div>
                                                    <JsonPreview data={page.schema_markup} className="rounded-t-none" />
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2 p-4 text-sm text-amber-600">
                                                    <AlertCircle className="h-4 w-4" />
                                                    No schema markup found
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Recommended Schema */}
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                                            <div className="w-2 h-2 rounded-full bg-green-500" />
                                            RECOMMENDED SCHEMA
                                        </div>
                                        <div className="border rounded-lg bg-green-50 border-green-200">
                                            {(() => {
                                                const batchSchema = page.recommended_schema;
                                                const legacySchemas = page.schema_recommendation?.schemas;

                                                if (batchSchema && batchSchema['@graph']?.length > 0) {
                                                    return (
                                                        <div>
                                                            <div className="p-3 border-b border-green-200 bg-green-100/50 flex flex-wrap gap-1">
                                                                {batchSchema['@graph'].map((schema: any, i: number) => (
                                                                    <span key={i} className="inline-flex items-center rounded-full border px-2 py-0.5 bg-green-200 text-green-800 border-green-300 text-xs font-medium">
                                                                        {schema['@type']}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                            <JsonPreview data={batchSchema} className="rounded-t-none" />
                                                        </div>
                                                    );
                                                }

                                                if (legacySchemas && legacySchemas.length > 0) {
                                                    const combinedSchema = legacySchemas.length === 1
                                                        ? legacySchemas[0].json_ld
                                                        : { "@context": "https://schema.org", "@graph": legacySchemas.map(s => s.json_ld) };
                                                    return (
                                                        <div>
                                                            <div className="p-3 border-b border-green-200 bg-green-100/50 flex flex-wrap gap-1">
                                                                {legacySchemas.map((schema, i) => (
                                                                    <span key={i} className="inline-flex items-center rounded-full border px-2 py-0.5 bg-green-200 text-green-800 border-green-300 text-xs font-medium">
                                                                        {schema.type}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                            <JsonPreview data={combinedSchema} className="rounded-t-none" />
                                                        </div>
                                                    );
                                                }

                                                return (
                                                    <div className="p-4 text-sm text-muted-foreground italic">
                                                        No recommendations yet - click Generate Schema
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    </div>
                                </div>

                                {/* Schema Components Carousel */}
                                {(() => {
                                    const batchSchema = page.recommended_schema;
                                    const legacySchemas = page.schema_recommendation?.schemas;

                                    const schemas = batchSchema?.['@graph'] ||
                                        (legacySchemas?.map(s => s.json_ld) || []);

                                    if (schemas.length === 0) return null;

                                    return (
                                        <div className="border-t pt-4">
                                            <div className="flex items-center justify-between mb-3">
                                                <div className="text-sm font-medium text-muted-foreground">
                                                    Schema Components ({schemas.length})
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                    ← Scroll to see all • Click to expand →
                                                </div>
                                            </div>
                                            <SchemaCarousel schemas={schemas} />
                                        </div>
                                    );
                                })()}

                                {/* Overall Strategy */}
                                {page.schema_recommendation?.overall_reasoning && (
                                    <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
                                        <div className="text-xs font-medium text-blue-800 mb-1">Overall SEO Strategy</div>
                                        <div className="text-sm text-blue-700">
                                            {page.schema_recommendation.overall_reasoning}
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                </Tabs >
            ) : null
            }

            {/* Edit Page Sheet */}
            <PageEditSheet
                page={page ? {
                    id: page.id,
                    url: page.url,
                    title: page.title || null,
                    page_type: page.page_type || null,
                    status_code: null,
                    path: new URL(page.url).pathname,
                    meta_description: page.meta_tags?.description || null,
                    h1: page.headings?.h1?.[0] || null,
                    content_summary: null
                } : null}
                open={editSheetOpen}
                onOpenChange={(open) => {
                    setEditSheetOpen(open)
                    if (!open) refetchPage() // Refresh data when sheet closes
                }}
            />
        </div >
    )
}
