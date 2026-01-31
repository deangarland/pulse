import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAccountStore } from '@/lib/account-store'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { ExternalLink, FileText, AlertCircle, RefreshCw, Settings2, ChevronLeft, ChevronRight, RotateCcw, Search, Download, X, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageEditSheet } from "@/components/PageEditSheet"
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

// Storage key for persisting column widths
const COLUMN_WIDTHS_KEY = 'pulse_page_index_column_widths'

// All available columns from page_index table with default widths
const ALL_COLUMNS = [
    { key: 'url', label: 'URL', defaultVisible: true, defaultWidth: 220 },
    { key: 'title', label: 'Title', defaultVisible: true, defaultWidth: 250 },
    { key: 'page_type', label: 'Type', defaultVisible: true, defaultWidth: 100 },
    { key: 'status_code', label: 'Status', defaultVisible: true, defaultWidth: 70 },
    { key: 'path', label: 'Path', defaultVisible: true, defaultWidth: 180 },
    { key: 'crawled_at', label: 'Crawled', defaultVisible: true, defaultWidth: 100 },
    { key: 'content_type', label: 'Content Type', defaultVisible: false, defaultWidth: 120 },
]

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

// Get default column widths
function getDefaultColumnWidths(): Record<string, number> {
    return ALL_COLUMNS.reduce((acc, col) => {
        acc[col.key] = col.defaultWidth
        return acc
    }, {} as Record<string, number>)
}

// Load column widths from localStorage
function loadColumnWidths(): Record<string, number> {
    try {
        const stored = localStorage.getItem(COLUMN_WIDTHS_KEY)
        if (stored) {
            return { ...getDefaultColumnWidths(), ...JSON.parse(stored) }
        }
    } catch (e) {
        console.error('Failed to load column widths:', e)
    }
    return getDefaultColumnWidths()
}

// Save column widths to localStorage
function saveColumnWidths(widths: Record<string, number>) {
    try {
        localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(widths))
    } catch (e) {
        console.error('Failed to save column widths:', e)
    }
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
                // Escape quotes and wrap in quotes if contains comma or quote
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
    link.click()
    URL.revokeObjectURL(url)
}

// Filter state type
interface Filters {
    search: string
    pageType: string
    statusCode: string
}

export default function PageIndex() {
    const [searchParams, setSearchParams] = useSearchParams()
    const { selectedAccountId } = useAccountStore()

    // Initialize from URL params
    const [page, setPage] = useState(() => parseInt(searchParams.get('page') || '0'))
    const [filters, setFilters] = useState<Filters>({
        search: searchParams.get('q') || '',
        pageType: searchParams.get('type') || '',
        statusCode: searchParams.get('status') || ''
    })
    const [searchInput, setSearchInput] = useState(searchParams.get('q') || '')
    const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
        new Set(ALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.key))
    )
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(loadColumnWidths)
    const columnWidthsRef = useRef<Record<string, number>>(columnWidths)
    const [exporting, setExporting] = useState(false)

    // Sync URL with filter state (preserve existing cid from CustomerSelector)
    useEffect(() => {
        const params = new URLSearchParams(searchParams)
        // Update filter params
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

    const handleEditPage = (page: any) => {
        setEditingPage(page)
        setEditSheetOpen(true)
    }

    // Keep ref in sync with state for access in event handlers
    useEffect(() => {
        columnWidthsRef.current = columnWidths
    }, [columnWidths])

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

    // Resize state
    const [resizing, setResizing] = useState<{ key: string; startX: number; startWidth: number } | null>(null)
    const tableRef = useRef<HTMLTableElement>(null)

    // Build Supabase query with filters
    const buildQuery = (baseQuery: any) => {
        let query = baseQuery

        // Filter by selected account
        if (selectedAccountId) {
            query = query.eq('account_id', selectedAccountId)
        }

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

    const { data, isLoading, error, refetch } = useQuery({
        queryKey: ['pages', page, filters.search, filters.pageType, filters.statusCode, selectedAccountId],
        queryFn: async () => {
            const from = page * PAGE_SIZE
            const to = from + PAGE_SIZE - 1

            // Build count query
            let countQuery = supabase
                .from('page_index')
                .select('*', { count: 'exact', head: true })
            countQuery = buildQuery(countQuery)
            const { count } = await countQuery

            // Build data query
            let dataQuery = supabase
                .from('page_index')
                .select('*')
            dataQuery = buildQuery(dataQuery)
            const { data, error } = await dataQuery
                .range(from, to)
                .order('crawled_at', { ascending: false })

            if (error) throw error
            return { pages: data, total: count || 0 }
        }
    })

    const totalPages = Math.ceil((data?.total || 0) / PAGE_SIZE)

    // Export all or filtered data
    const handleExport = async (exportAll: boolean) => {
        setExporting(true)
        try {
            let query = supabase
                .from('page_index')
                .select('*')

            if (!exportAll) {
                query = buildQuery(query)
            }

            const { data: exportData, error } = await query
                .order('crawled_at', { ascending: false })
                .limit(10000) // Limit to 10k rows

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

    // Handle mouse move during resize
    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!resizing) return

        const diff = e.clientX - resizing.startX
        const newWidth = Math.max(50, resizing.startWidth + diff) // Minimum 50px

        setColumnWidths(prev => ({
            ...prev,
            [resizing.key]: newWidth
        }))
    }, [resizing])

    // Handle mouse up to end resize
    const handleMouseUp = useCallback(() => {
        if (resizing) {
            // Save current columnWidths to localStorage using ref
            saveColumnWidths(columnWidthsRef.current)
        }
        setResizing(null)
    }, [resizing])

    // Add/remove global mouse listeners for resize
    useEffect(() => {
        if (resizing) {
            document.addEventListener('mousemove', handleMouseMove)
            document.addEventListener('mouseup', handleMouseUp)
            document.body.style.cursor = 'col-resize'
            document.body.style.userSelect = 'none'
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
        }
    }, [resizing, handleMouseMove, handleMouseUp])

    // Start resize
    const startResize = (key: string, e: React.MouseEvent) => {
        e.preventDefault()
        setResizing({
            key,
            startX: e.clientX,
            startWidth: columnWidths[key] || 100
        })
    }

    // Reset column widths
    const resetColumnWidths = () => {
        const defaults = getDefaultColumnWidths()
        setColumnWidths(defaults)
        saveColumnWidths(defaults)
    }

    const toggleColumn = (key: string) => {
        setVisibleColumns(prev => {
            const next = new Set(prev)
            if (next.has(key)) {
                next.delete(key)
            } else {
                next.add(key)
            }
            return next
        })
    }

    const renderCellValue = (page: any, columnKey: string) => {
        const value = page[columnKey]

        switch (columnKey) {
            case 'url':
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

            case 'page_type':
                return (
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${getPageTypeStyle(value)}`}>
                        {value || 'Unknown'}
                    </span>
                )

            case 'status_code':
                const statusColor = value === 200 ? 'text-green-600' : value >= 400 ? 'text-red-600' : 'text-yellow-600'
                return <span className={`font-mono text-xs ${statusColor}`}>{value}</span>

            case 'crawled_at':
                return value ? (
                    <span className="text-xs text-muted-foreground tabular-nums">
                        {new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                    </span>
                ) : <span className="text-xs text-muted-foreground">—</span>

            default:
                return value ? (
                    <span className="text-xs truncate block">{String(value)}</span>
                ) : <span className="text-xs text-muted-foreground">—</span>
        }
    }

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
                        <div className="flex items-center gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={resetColumnWidths}
                                title="Reset column widths"
                            >
                                <RotateCcw className="h-4 w-4" />
                            </Button>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="sm">
                                        <Settings2 className="h-4 w-4 mr-2" />
                                        Columns
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-48">
                                    <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    {ALL_COLUMNS.map((col) => (
                                        <DropdownMenuCheckboxItem
                                            key={col.key}
                                            checked={visibleColumns.has(col.key)}
                                            onCheckedChange={() => toggleColumn(col.key)}
                                        >
                                            {col.label}
                                        </DropdownMenuCheckboxItem>
                                    ))}
                                </DropdownMenuContent>
                            </DropdownMenu>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="sm" disabled={exporting}>
                                        <Download className="h-4 w-4 mr-2" />
                                        Export
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuLabel>Export Options</DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="w-full justify-start"
                                        onClick={() => handleExport(true)}
                                    >
                                        Export All Data
                                    </Button>
                                    {hasFilters && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="w-full justify-start"
                                            onClick={() => handleExport(false)}
                                        >
                                            Export Filtered Only
                                        </Button>
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                            <Button variant="outline" size="sm" onClick={() => refetch()}>
                                <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                                Refresh
                            </Button>
                        </div>
                    </div>

                    {/* Filter Bar */}
                    <div className="flex items-center gap-3 mt-4">
                        <div className="relative flex-1 max-w-sm flex gap-2">
                            <div className="relative flex-1">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search URL or title..."
                                    value={searchInput}
                                    onChange={(e) => setSearchInput(e.target.value)}
                                    onKeyDown={handleSearchKeyDown}
                                    className="pl-8 h-9"
                                />
                            </div>
                            <Button
                                variant="secondary"
                                size="sm"
                                className="h-9"
                                onClick={handleSearch}
                            >
                                Search
                            </Button>
                        </div>
                        <Select
                            value={filters.pageType}
                            onValueChange={(v) => setFilters(f => ({ ...f, pageType: v === 'all' ? '' : v }))}
                        >
                            <SelectTrigger className="w-[150px] h-9">
                                <SelectValue placeholder="Page Type" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Types</SelectItem>
                                {PAGE_TYPES.map((type) => (
                                    <SelectItem key={type} value={type}>{type}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Select
                            value={filters.statusCode}
                            onValueChange={(v) => setFilters(f => ({ ...f, statusCode: v === 'all' ? '' : v }))}
                        >
                            <SelectTrigger className="w-[120px] h-9">
                                <SelectValue placeholder="Status" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Status</SelectItem>
                                <SelectItem value="200">200 OK</SelectItem>
                                <SelectItem value="301">301 Redirect</SelectItem>
                                <SelectItem value="302">302 Redirect</SelectItem>
                                <SelectItem value="404">404 Not Found</SelectItem>
                                <SelectItem value="500">500 Error</SelectItem>
                            </SelectContent>
                        </Select>
                        {hasFilters && (
                            <Button variant="ghost" size="sm" onClick={clearFilters}>
                                <X className="h-4 w-4 mr-1" />
                                Clear
                            </Button>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-x-auto">
                        <Table ref={tableRef} style={{ tableLayout: 'fixed' }}>
                            <TableHeader>
                                <TableRow className="bg-muted/50">
                                    {ALL_COLUMNS.filter(c => visibleColumns.has(c.key)).map((col) => (
                                        <TableHead
                                            key={col.key}
                                            className="font-semibold text-xs whitespace-nowrap relative group"
                                            style={{ width: columnWidths[col.key] || col.defaultWidth }}
                                        >
                                            <div className="pr-2">{col.label}</div>
                                            {/* Resize handle */}
                                            <div
                                                className="absolute top-0 right-0 w-1 h-full cursor-col-resize bg-transparent hover:bg-blue-500 active:bg-blue-600 transition-colors"
                                                onMouseDown={(e) => startResize(col.key, e)}
                                                style={{
                                                    opacity: resizing?.key === col.key ? 1 : 0,
                                                }}
                                            />
                                            {/* Visible resize indicator on hover */}
                                            <div
                                                className="absolute top-0 right-0 w-[3px] h-full cursor-col-resize opacity-0 group-hover:opacity-100 bg-border hover:bg-blue-500 transition-all"
                                                onMouseDown={(e) => startResize(col.key, e)}
                                            />
                                        </TableHead>
                                    ))}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {data?.pages?.length === 0 ? (
                                    <TableRow>
                                        <TableCell
                                            colSpan={visibleColumns.size}
                                            className="text-center py-8 text-muted-foreground"
                                        >
                                            No pages match your filters
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    data?.pages?.map((page) => (
                                        <TableRow key={page.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => handleEditPage(page)}>
                                            {ALL_COLUMNS.filter(c => visibleColumns.has(c.key)).map((col) => (
                                                <TableCell
                                                    key={col.key}
                                                    className="py-2 overflow-hidden"
                                                    style={{ width: columnWidths[col.key] || col.defaultWidth }}
                                                >
                                                    {renderCellValue(page, col.key)}
                                                </TableCell>
                                            ))}
                                            <TableCell className="py-2 w-[40px]">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-7 w-7"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        handleEditPage(page)
                                                    }}
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Pagination */}
                    <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/30">
                        <div className="text-xs text-muted-foreground">
                            Showing {data?.pages?.length ? page * PAGE_SIZE + 1 : 0}–{Math.min((page + 1) * PAGE_SIZE, data?.total || 0)} of {data?.total.toLocaleString()}
                        </div>
                        <div className="flex items-center gap-1">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPage(p => Math.max(0, p - 1))}
                                disabled={page === 0}
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <div className="px-3 py-1 text-xs font-medium">
                                Page {page + 1} of {totalPages || 1}
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                                disabled={page >= totalPages - 1}
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card >

            {/* Edit Sheet */}
            < PageEditSheet
                page={editingPage}
                open={editSheetOpen}
                onOpenChange={setEditSheetOpen}
            />
        </>
    )
}
