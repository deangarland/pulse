import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAccountStore } from '@/lib/account-store'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { ExternalLink, FileText, AlertCircle, Search, X, Pencil, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageEditSheet } from "@/components/PageEditSheet"
import { AddWebsiteModal } from "@/components/AddWebsiteModal"
import { CrawlProgress } from "@/components/CrawlProgress"
import { DataTable, type ColumnDef } from "@/components/DataTable"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

// Page types for filter dropdown
const PAGE_TYPES = [
    'HOMEPAGE', 'PROCEDURE', 'RESOURCE', 'ABOUT', 'CONTACT',
    'LOCATION', 'TEAM_MEMBER', 'GALLERY', 'CONDITION', 'GENERIC'
]

// Page type color mapping
const pageTypeColors: Record<string, string> = {
    HOMEPAGE: 'bg-blue-100 text-blue-800 border-blue-200',
    PROCEDURE: 'bg-green-100 text-green-800 border-green-200',
    RESOURCE: 'bg-purple-100 text-purple-800 border-purple-200',
    ABOUT: 'bg-orange-100 text-orange-800 border-orange-200',
    CONTACT: 'bg-pink-100 text-pink-800 border-pink-200',
    LOCATION: 'bg-cyan-100 text-cyan-800 border-cyan-200',
    TEAM_MEMBER: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    GALLERY: 'bg-amber-100 text-amber-800 border-amber-200',
    CONDITION: 'bg-red-100 text-red-800 border-red-200',
    GENERIC: 'bg-gray-100 text-gray-800 border-gray-200',
}

function getPageTypeStyle(type: string | null) {
    if (!type) return 'bg-gray-100 text-gray-600 border-gray-200'
    return pageTypeColors[type] || 'bg-gray-100 text-gray-600 border-gray-200'
}

const PAGE_SIZE = 25

// Filter state type
interface Filters {
    search: string
    pageType: string
    statusCode: string
}

// Export data as CSV
function exportToCSV(data: any[], filename: string) {
    if (!data.length) return

    const headers = Object.keys(data[0])
    const csvContent = [
        headers.join(','),
        ...data.map(row =>
            headers.map(h => {
                const val = row[h]
                if (val === null || val === undefined) return ''
                const str = String(val)
                if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                    return `"${str.replace(/"/g, '""')}"`
                }
                return str
            }).join(',')
        )
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
}

export default function PageIndex() {
    const [searchParams, setSearchParams] = useSearchParams()

    // Initialize from URL params
    const [page, setPage] = useState(() => parseInt(searchParams.get('page') || '0'))
    const [filters, setFilters] = useState<Filters>({
        search: searchParams.get('q') || '',
        pageType: searchParams.get('type') || '',
        statusCode: searchParams.get('status') || ''
    })
    const [searchInput, setSearchInput] = useState(searchParams.get('q') || '')
    const [exporting, setExporting] = useState(false)

    // Sync URL with filter state
    useEffect(() => {
        const params = new URLSearchParams(searchParams)
        if (filters.search) params.set('q', filters.search)
        else params.delete('q')
        if (filters.pageType) params.set('type', filters.pageType)
        else params.delete('type')
        if (filters.statusCode) params.set('status', filters.statusCode)
        else params.delete('status')
        if (page > 0) params.set('page', page.toString())
        else params.delete('page')
        setSearchParams(params, { replace: true })
    }, [filters, page])

    // Edit sheet state
    const [editingPage, setEditingPage] = useState<any>(null)
    const [editSheetOpen, setEditSheetOpen] = useState(false)

    // Add website modal state
    const [addWebsiteOpen, setAddWebsiteOpen] = useState(false)
    const [crawlingSiteId, setCrawlingSiteId] = useState<string | null>(null)

    const handleEditPage = (pageData: any) => {
        setEditingPage(pageData)
        setEditSheetOpen(true)
    }

    // Handle search on Enter or button click
    const handleSearch = () => {
        setFilters(f => ({ ...f, search: searchInput }))
        setPage(0)
    }

    const handleSearchKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSearch()
        }
    }

    // Reset page when filters change
    useEffect(() => {
        setPage(0)
    }, [filters.pageType, filters.statusCode])

    // Build Supabase query with filters
    const buildQuery = (baseQuery: any) => {
        let query = baseQuery

        if (filters.search) {
            query = query.or(`url.ilike.%${filters.search}%,title.ilike.%${filters.search}%`)
        }
        if (filters.pageType) {
            query = query.eq('page_type', filters.pageType)
        }
        if (filters.statusCode) {
            query = query.eq('status_code', parseInt(filters.statusCode))
        }

        return query
    }

    // Get selected account UUID from store
    const { selectedAccountId } = useAccountStore()

    const { data, isLoading, error, refetch } = useQuery({
        queryKey: ['pages', page, filters.search, filters.pageType, filters.statusCode, selectedAccountId],
        queryFn: async () => {
            const from = page * PAGE_SIZE
            const to = from + PAGE_SIZE - 1

            // If account is selected, first get site_ids for that account
            let siteIds: string[] | null = null
            if (selectedAccountId) {
                const { data: sites } = await supabase
                    .from('site_index')
                    .select('id')
                    .eq('account_id', selectedAccountId)
                siteIds = sites?.map(s => s.id) || []

                if (siteIds.length === 0) {
                    return { pages: [], total: 0 }
                }
            }

            // Build count query
            let countQuery = supabase
                .from('page_index')
                .select('*', { count: 'exact', head: true })
            if (siteIds) {
                countQuery = countQuery.in('site_id', siteIds)
            }
            countQuery = buildQuery(countQuery)
            const { count } = await countQuery

            // Build data query
            let dataQuery = supabase
                .from('page_index')
                .select('*')
            if (siteIds) {
                dataQuery = dataQuery.in('site_id', siteIds)
            }
            dataQuery = buildQuery(dataQuery)
            const { data, error } = await dataQuery
                .range(from, to)
                .order('crawled_at', { ascending: false })

            if (error) throw error
            return { pages: data, total: count || 0 }
        }
    })

    // Export all or filtered data
    const handleExport = async (exportAll: boolean) => {
        setExporting(true)
        try {
            let siteIds: string[] | null = null
            if (selectedAccountId) {
                const { data: sites } = await supabase
                    .from('site_index')
                    .select('id')
                    .eq('account_id', selectedAccountId)
                siteIds = sites?.map(s => s.id) || []
            }

            let query = supabase
                .from('page_index')
                .select('*')

            if (siteIds && siteIds.length > 0) {
                query = query.in('site_id', siteIds)
            }

            if (!exportAll) {
                query = buildQuery(query)
            }

            const { data: exportData, error } = await query
                .order('crawled_at', { ascending: false })
                .limit(10000)

            if (error) throw error

            const timestamp = new Date().toISOString().split('T')[0]
            const filename = exportAll
                ? `page_index_all_${timestamp}.csv`
                : `page_index_filtered_${timestamp}.csv`

            exportToCSV(exportData || [], filename)
        } catch (e) {
            console.error('Export failed:', e)
        } finally {
            setExporting(false)
        }
    }

    // Clear all filters
    const clearFilters = () => {
        setFilters({ search: '', pageType: '', statusCode: '' })
        setSearchInput('')
    }

    const hasFilters = filters.search || filters.pageType || filters.statusCode

    // Column definitions with render functions
    const columns: ColumnDef[] = useMemo(() => [
        {
            key: 'url',
            label: 'URL',
            defaultVisible: true,
            defaultWidth: 220,
            sortable: true,
            render: (value: string) => {
                try {
                    const pathname = new URL(value).pathname
                    return (
                        <a
                            href={value}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline font-mono text-xs"
                            title={value}
                        >
                            <span className="truncate">{pathname || '/'}</span>
                            <ExternalLink className="h-3 w-3 flex-shrink-0 opacity-50" />
                        </a>
                    )
                } catch {
                    return <span className="text-xs truncate">{value}</span>
                }
            }
        },
        {
            key: 'title',
            label: 'Title',
            defaultVisible: true,
            defaultWidth: 250,
            sortable: true,
            render: (value: string) => value
                ? <span className="text-xs truncate block">{value}</span>
                : <span className="text-xs text-muted-foreground">—</span>
        },
        {
            key: 'page_type',
            label: 'Type',
            defaultVisible: true,
            defaultWidth: 100,
            sortable: true,
            render: (value: string) => (
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${getPageTypeStyle(value)}`}>
                    {value || 'Unknown'}
                </span>
            )
        },
        {
            key: 'status_code',
            label: 'Status',
            defaultVisible: true,
            defaultWidth: 70,
            sortable: true,
            render: (value: number) => {
                const statusColor = value === 200 ? 'text-green-600' : value >= 400 ? 'text-red-600' : 'text-yellow-600'
                return <span className={`font-mono text-xs ${statusColor}`}>{value}</span>
            }
        },
        {
            key: 'path',
            label: 'Path',
            defaultVisible: true,
            defaultWidth: 180,
            sortable: true,
            render: (value: string) => value
                ? <span className="text-xs truncate block font-mono">{value}</span>
                : <span className="text-xs text-muted-foreground">—</span>
        },
        {
            key: 'crawled_at',
            label: 'Crawled',
            defaultVisible: true,
            defaultWidth: 100,
            sortable: true,
            render: (value: string) => value ? (
                <span className="text-xs text-muted-foreground tabular-nums">
                    {new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                </span>
            ) : <span className="text-xs text-muted-foreground">—</span>
        },
        {
            key: 'content_type',
            label: 'Content Type',
            defaultVisible: false,
            defaultWidth: 120,
            sortable: true,
            render: (value: string) => value
                ? <span className="text-xs truncate block">{value}</span>
                : <span className="text-xs text-muted-foreground">—</span>
        },
    ], [])

    // Toolbar content for filters
    const toolbar = (
        <div className="flex items-center gap-2 flex-wrap">
            {/* Search */}
            <div className="flex items-center gap-1">
                <Input
                    placeholder="Search URL or title..."
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    className="h-8 w-[200px]"
                />
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleSearch}>
                    <Search className="h-4 w-4" />
                </Button>
            </div>

            {/* Page Type Filter */}
            <Select value={filters.pageType || 'all'} onValueChange={(val) => setFilters(f => ({ ...f, pageType: val === 'all' ? '' : val }))}>
                <SelectTrigger className="h-8 w-[140px]">
                    <SelectValue placeholder="Page Type" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {PAGE_TYPES.map(type => (
                        <SelectItem key={type} value={type}>{type}</SelectItem>
                    ))}
                </SelectContent>
            </Select>

            {/* Status Filter */}
            <Select value={filters.statusCode || 'all'} onValueChange={(val) => setFilters(f => ({ ...f, statusCode: val === 'all' ? '' : val }))}>
                <SelectTrigger className="h-8 w-[100px]">
                    <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="200">200</SelectItem>
                    <SelectItem value="301">301</SelectItem>
                    <SelectItem value="302">302</SelectItem>
                    <SelectItem value="404">404</SelectItem>
                    <SelectItem value="500">500</SelectItem>
                </SelectContent>
            </Select>

            {/* Clear Filters */}
            {hasFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8">
                    <X className="h-4 w-4 mr-1" />
                    Clear
                </Button>
            )}

            {/* Add Website Button */}
            <Button
                variant="default"
                size="sm"
                onClick={() => setAddWebsiteOpen(true)}
                className="h-8"
            >
                <Plus className="h-4 w-4 mr-1" />
                Add Website
            </Button>
        </div>
    )

    if (isLoading && !data) {
        return (
            <Card>
                <CardContent className="pt-6 space-y-3">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                        <div key={i} className="flex items-center gap-4">
                            <Skeleton className="h-4 w-[180px]" />
                            <Skeleton className="h-4 w-[150px]" />
                            <Skeleton className="h-5 w-[70px] rounded-full" />
                            <Skeleton className="h-4 w-[50px]" />
                            <Skeleton className="h-4 w-[50px]" />
                            <Skeleton className="h-4 w-[80px]" />
                        </div>
                    ))}
                </CardContent>
            </Card>
        )
    }

    if (error) {
        return (
            <Card className="border-red-200 bg-red-50">
                <CardContent className="pt-6 flex items-center gap-3 text-red-700">
                    <AlertCircle className="h-5 w-5" />
                    <span>Error loading pages: {(error as Error).message}</span>
                </CardContent>
            </Card>
        )
    }

    return (
        <>
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex flex-row items-center justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2 text-lg">
                                <FileText className="h-5 w-5" />
                                Page Index
                            </CardTitle>
                            <CardDescription>
                                {data?.total.toLocaleString()} pages {hasFilters ? '(filtered)' : 'indexed'}
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <DataTable
                        data={data?.pages || []}
                        columns={columns}
                        loading={isLoading}
                        storageKey="pulse_page_index"
                        emptyMessage="No pages match your filters"
                        pageSize={PAGE_SIZE}
                        totalCount={data?.total}
                        page={page}
                        onPageChange={setPage}
                        onRefresh={refetch}
                        onExport={handleExport}
                        toolbar={toolbar}
                        rowActions={(row) => (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    handleEditPage(row)
                                }}
                            >
                                <Pencil className="h-4 w-4" />
                            </Button>
                        )}
                    />
                </CardContent>
            </Card>

            {/* Edit Sheet */}
            <PageEditSheet
                page={editingPage}
                open={editSheetOpen}
                onOpenChange={setEditSheetOpen}
            />

            {/* Add Website Modal */}
            <AddWebsiteModal
                open={addWebsiteOpen}
                onOpenChange={(open) => {
                    setAddWebsiteOpen(open)
                    if (!open) setCrawlingSiteId(null)
                }}
                onSuccess={(siteId) => {
                    setCrawlingSiteId(siteId)
                }}
            />

            {/* Crawl Progress Banner */}
            {crawlingSiteId && (
                <div className="fixed bottom-4 right-4 w-96 z-50 shadow-lg rounded-lg border bg-background">
                    <CrawlProgress
                        siteId={crawlingSiteId}
                        onComplete={() => {
                            refetch()
                            setTimeout(() => setCrawlingSiteId(null), 5000)
                        }}
                    />
                </div>
            )}
        </>
    )
}
