import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Settings2, Download, RefreshCw, ChevronLeft, ChevronRight, RotateCcw, ArrowUpDown, ArrowUp, ArrowDown, GripVertical } from "lucide-react"

// Editable cell configuration
export interface EditableConfig {
    type: 'text' | 'number' | 'select' | 'date'
    options?: { value: string; label: string }[]  // For select type
    placeholder?: string
}

// Column definition
export interface ColumnDef {
    key: string
    label: string
    defaultVisible?: boolean
    defaultWidth?: number
    minWidth?: number
    sortable?: boolean
    render?: (value: any, row: any) => React.ReactNode
    editable?: EditableConfig  // Opt-in inline editing per column
}

// Sort state
export interface SortState {
    key: string
    direction: 'asc' | 'desc'
}

// DataTable props
interface DataTableProps {
    data: any[]
    columns: ColumnDef[]
    loading?: boolean
    storageKey?: string
    emptyMessage?: string
    pageSize?: number
    totalCount?: number
    page?: number
    onPageChange?: (page: number) => void
    onRefresh?: () => void
    onExport?: (all: boolean) => void
    rowActions?: (row: any) => React.ReactNode
    onRowClick?: (row: any) => void
    toolbar?: React.ReactNode
    defaultSort?: SortState
    onSortChange?: (sort: SortState | null) => void
    serverSideSort?: boolean
    // Inline editing (opt-in)
    enableInlineEdit?: boolean
    onCellUpdate?: (rowId: string, key: string, value: any) => Promise<void>
}

// Helper functions
function getDefaultColumnWidths(columns: ColumnDef[]): Record<string, number> {
    return columns.reduce((acc, col) => {
        acc[col.key] = col.defaultWidth || 150
        return acc
    }, {} as Record<string, number>)
}

function loadColumnWidths(storageKey: string, columns: ColumnDef[]): Record<string, number> {
    try {
        const stored = localStorage.getItem(storageKey)
        if (stored) {
            return { ...getDefaultColumnWidths(columns), ...JSON.parse(stored) }
        }
    } catch (e) {
        console.error('Failed to load column widths:', e)
    }
    return getDefaultColumnWidths(columns)
}

function saveColumnWidths(storageKey: string, widths: Record<string, number>) {
    try {
        localStorage.setItem(storageKey, JSON.stringify(widths))
    } catch (e) {
        console.error('Failed to save column widths:', e)
    }
}

function loadColumnOrder(storageKey: string, columns: ColumnDef[]): string[] {
    try {
        const stored = localStorage.getItem(storageKey)
        if (stored) {
            const order = JSON.parse(stored)
            // Validate stored order contains valid keys and add any missing columns
            const validKeys = new Set(columns.map(c => c.key))
            const filtered = order.filter((k: string) => validKeys.has(k))
            const missing = columns.filter(c => !filtered.includes(c.key)).map(c => c.key)
            return [...filtered, ...missing]
        }
    } catch (e) {
        console.error('Failed to load column order:', e)
    }
    return columns.map(c => c.key)
}

function saveColumnOrder(storageKey: string, order: string[]) {
    try {
        localStorage.setItem(storageKey, JSON.stringify(order))
    } catch (e) {
        console.error('Failed to save column order:', e)
    }
}

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

// Compare function for sorting
function compareValues(a: any, b: any, direction: 'asc' | 'desc'): number {
    // Handle nulls
    if (a === null || a === undefined) return direction === 'asc' ? 1 : -1
    if (b === null || b === undefined) return direction === 'asc' ? -1 : 1

    // Handle dates
    if (typeof a === 'string' && typeof b === 'string') {
        const dateA = Date.parse(a)
        const dateB = Date.parse(b)
        if (!isNaN(dateA) && !isNaN(dateB)) {
            return direction === 'asc' ? dateA - dateB : dateB - dateA
        }
    }

    // Handle numbers
    if (typeof a === 'number' && typeof b === 'number') {
        return direction === 'asc' ? a - b : b - a
    }

    // Handle strings
    const strA = String(a).toLowerCase()
    const strB = String(b).toLowerCase()
    if (direction === 'asc') {
        return strA.localeCompare(strB)
    }
    return strB.localeCompare(strA)
}

// EditableCell component for inline editing
interface EditableCellProps {
    value: any
    rowId: string
    columnKey: string
    config: EditableConfig
    onUpdate: (rowId: string, key: string, value: any) => Promise<void>
    width: number
}

function EditableCell({ value, rowId, columnKey, config, onUpdate, width }: EditableCellProps) {
    const [isEditing, setIsEditing] = useState(false)
    const [editValue, setEditValue] = useState(value ?? '')
    const [isSaving, setIsSaving] = useState(false)
    const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null)

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus()
            if (inputRef.current instanceof HTMLInputElement) {
                inputRef.current.select()
            }
        }
    }, [isEditing])

    const handleSave = async () => {
        if (editValue === value || (editValue === '' && value === null)) {
            setIsEditing(false)
            return
        }
        setIsSaving(true)
        try {
            const newValue = config.type === 'number'
                ? (editValue === '' ? null : Number(editValue))
                : editValue || null
            await onUpdate(rowId, columnKey, newValue)
            setIsEditing(false)
        } catch (e) {
            // Keep editing on error
            console.error('Failed to save:', e)
        } finally {
            setIsSaving(false)
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            handleSave()
        } else if (e.key === 'Escape') {
            setEditValue(value ?? '')
            setIsEditing(false)
        }
    }

    if (!isEditing) {
        return (
            <div
                className="truncate cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1 min-h-[24px] flex items-center"
                style={{ maxWidth: width }}
                onClick={(e) => {
                    e.stopPropagation()
                    setIsEditing(true)
                }}
                title="Click to edit"
            >
                {value ?? <span className="text-muted-foreground italic">{config.placeholder || 'Click to edit'}</span>}
            </div>
        )
    }

    if (config.type === 'select' && config.options) {
        return (
            <select
                ref={inputRef as React.RefObject<HTMLSelectElement>}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={handleSave}
                onKeyDown={handleKeyDown}
                disabled={isSaving}
                className="w-full h-7 px-2 text-sm border rounded bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                style={{ maxWidth: width }}
            >
                <option value="">-</option>
                {config.options.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
        )
    }

    return (
        <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type={config.type === 'number' ? 'number' : config.type === 'date' ? 'date' : 'text'}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            disabled={isSaving}
            placeholder={config.placeholder}
            className="w-full h-7 px-2 text-sm border rounded bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            style={{ maxWidth: width }}
        />
    )
}

export function DataTable({
    data,
    columns,
    loading = false,
    storageKey = 'datatable_columns',
    emptyMessage = 'No data',
    pageSize = 25,
    totalCount,
    page = 0,
    onPageChange,
    onRefresh,
    onExport,
    rowActions,
    onRowClick,
    toolbar,
    defaultSort,
    onSortChange,
    serverSideSort = false,
    enableInlineEdit = false,
    onCellUpdate
}: DataTableProps) {
    // Sort state
    const [sort, setSort] = useState<SortState | null>(defaultSort || null)

    // Visible columns state
    const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
        new Set(columns.filter(c => c.defaultVisible !== false).map(c => c.key))
    )

    // Column widths state
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(
        () => loadColumnWidths(storageKey + '_widths', columns)
    )
    const columnWidthsRef = useRef<Record<string, number>>(columnWidths)

    // Column order state (for drag reordering)
    const [columnOrder, setColumnOrder] = useState<string[]>(
        () => loadColumnOrder(storageKey + '_order', columns)
    )
    const [draggedColumn, setDraggedColumn] = useState<string | null>(null)
    const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)

    // Resize state
    const [resizingColumn, setResizingColumn] = useState<string | null>(null)
    const startXRef = useRef<number>(0)
    const startWidthRef = useRef<number>(0)

    // Update ref when state changes
    useEffect(() => {
        columnWidthsRef.current = columnWidths
    }, [columnWidths])

    // Handle sort click
    const handleSort = (colKey: string) => {
        const column = columns.find(c => c.key === colKey)
        if (!column?.sortable) return

        let newSort: SortState | null
        if (sort?.key === colKey) {
            if (sort.direction === 'asc') {
                newSort = { key: colKey, direction: 'desc' }
            } else {
                newSort = null // Clear sort on third click
            }
        } else {
            newSort = { key: colKey, direction: 'asc' }
        }

        setSort(newSort)
        onSortChange?.(newSort)
    }

    // Sort icon component
    const SortIcon = ({ colKey }: { colKey: string }) => {
        const column = columns.find(c => c.key === colKey)
        if (!column?.sortable) return null

        if (sort?.key !== colKey) {
            return <ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />
        }
        return sort.direction === 'asc'
            ? <ArrowUp className="h-3 w-3 ml-1 text-primary" />
            : <ArrowDown className="h-3 w-3 ml-1 text-primary" />
    }

    // Client-side sorted data (if not using server-side sorting)
    const sortedData = useMemo(() => {
        if (serverSideSort || !sort) return data
        return [...data].sort((a, b) => compareValues(a[sort.key], b[sort.key], sort.direction))
    }, [data, sort, serverSideSort])

    // Toggle column visibility
    const toggleColumn = (key: string) => {
        setVisibleColumns(prev => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }

    // Reset column widths
    const resetColumnWidths = () => {
        const defaults = getDefaultColumnWidths(columns)
        setColumnWidths(defaults)
        saveColumnWidths(storageKey + '_widths', defaults)
    }

    // Column resize handlers
    const handleResizeStart = useCallback((e: React.MouseEvent, colKey: string) => {
        e.preventDefault()
        e.stopPropagation()
        setResizingColumn(colKey)
        startXRef.current = e.clientX
        startWidthRef.current = columnWidthsRef.current[colKey] || 150
    }, [])

    const handleResizeMove = useCallback((e: MouseEvent) => {
        if (!resizingColumn) return
        const delta = e.clientX - startXRef.current
        const col = columns.find(c => c.key === resizingColumn)
        const minWidth = col?.minWidth || 50
        const newWidth = Math.max(minWidth, startWidthRef.current + delta)
        setColumnWidths(prev => ({ ...prev, [resizingColumn]: newWidth }))
    }, [resizingColumn, columns])

    const handleResizeEnd = useCallback(() => {
        if (resizingColumn) {
            saveColumnWidths(storageKey + '_widths', columnWidthsRef.current)
            setResizingColumn(null)
        }
    }, [resizingColumn, storageKey])

    // Add/remove event listeners for resize
    useEffect(() => {
        if (resizingColumn) {
            window.addEventListener('mousemove', handleResizeMove)
            window.addEventListener('mouseup', handleResizeEnd)
            return () => {
                window.removeEventListener('mousemove', handleResizeMove)
                window.removeEventListener('mouseup', handleResizeEnd)
            }
        }
    }, [resizingColumn, handleResizeMove, handleResizeEnd])

    // Drag handlers for column reordering
    const handleDragStart = (e: React.DragEvent, colKey: string) => {
        setDraggedColumn(colKey)
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', colKey)
    }

    const handleDragOver = (e: React.DragEvent, colKey: string) => {
        e.preventDefault()
        if (draggedColumn && draggedColumn !== colKey) {
            setDragOverColumn(colKey)
        }
    }

    const handleDragLeave = () => {
        setDragOverColumn(null)
    }

    const handleDrop = (e: React.DragEvent, targetKey: string) => {
        e.preventDefault()
        if (!draggedColumn || draggedColumn === targetKey) return

        const newOrder = [...columnOrder]
        const draggedIdx = newOrder.indexOf(draggedColumn)
        const targetIdx = newOrder.indexOf(targetKey)

        if (draggedIdx !== -1 && targetIdx !== -1) {
            newOrder.splice(draggedIdx, 1)
            newOrder.splice(targetIdx, 0, draggedColumn)
            setColumnOrder(newOrder)
            saveColumnOrder(storageKey + '_order', newOrder)
        }

        setDraggedColumn(null)
        setDragOverColumn(null)
    }

    const handleDragEnd = () => {
        setDraggedColumn(null)
        setDragOverColumn(null)
    }

    // Filter to visible columns, sorted by column order
    const displayColumns = useMemo(() => {
        const visibleCols = columns.filter(c => visibleColumns.has(c.key))
        return visibleCols.sort((a, b) => {
            const aIdx = columnOrder.indexOf(a.key)
            const bIdx = columnOrder.indexOf(b.key)
            return aIdx - bIdx
        })
    }, [columns, visibleColumns, columnOrder])

    // Calculate pagination
    const totalPages = totalCount ? Math.ceil(totalCount / pageSize) : 1
    const showPagination = onPageChange && totalCount !== undefined

    // Default export handler
    const handleExport = (all: boolean) => {
        if (onExport) {
            onExport(all)
        } else {
            const filename = `export_${new Date().toISOString().split('T')[0]}.csv`
            exportToCSV(sortedData, filename)
        }
    }

    return (
        <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2 flex-1">
                    {toolbar}
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        size="icon"
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
                        <DropdownMenuContent align="end" className="w-48 max-h-80 overflow-auto">
                            <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {columns.map((col) => (
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
                    {onExport !== undefined && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm">
                                    <Download className="h-4 w-4 mr-2" />
                                    Export
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => handleExport(true)}>
                                    Export All
                                </Button>
                                <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => handleExport(false)}>
                                    Export Page
                                </Button>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                    {onRefresh && (
                        <Button variant="outline" size="sm" onClick={onRefresh}>
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Refresh
                        </Button>
                    )}
                </div>
            </div>

            {/* Table */}
            <div className="border rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                    <Table style={{ tableLayout: 'fixed', width: displayColumns.reduce((sum, col) => sum + (columnWidths[col.key] || 150), 0) + (rowActions ? 100 : 0) }}>
                        <TableHeader>
                            <TableRow>
                                {displayColumns.map((col) => (
                                    <TableHead
                                        key={col.key}
                                        style={{ width: columnWidths[col.key] || 150, position: 'relative' }}
                                        className={`${col.sortable ? 'cursor-pointer select-none hover:bg-muted/50' : ''} ${dragOverColumn === col.key ? 'bg-primary/10 border-l-2 border-primary' : ''}`}
                                        onClick={() => col.sortable && handleSort(col.key)}
                                        draggable
                                        onDragStart={(e) => handleDragStart(e, col.key)}
                                        onDragOver={(e) => handleDragOver(e, col.key)}
                                        onDragLeave={handleDragLeave}
                                        onDrop={(e) => handleDrop(e, col.key)}
                                        onDragEnd={handleDragEnd}
                                    >
                                        <div className="flex items-center">
                                            <GripVertical className="h-3 w-3 mr-1 opacity-30 cursor-grab" />
                                            {col.label}
                                            <SortIcon colKey={col.key} />
                                        </div>
                                        <div
                                            className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-primary/50"
                                            onMouseDown={(e) => handleResizeStart(e, col.key)}
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                    </TableHead>
                                ))}
                                {rowActions && <TableHead style={{ width: 100 }}>Actions</TableHead>}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <TableRow key={i}>
                                        {displayColumns.map((col) => (
                                            <TableCell key={col.key}>
                                                <Skeleton className="h-5 w-full" />
                                            </TableCell>
                                        ))}
                                        {rowActions && <TableCell><Skeleton className="h-5 w-16" /></TableCell>}
                                    </TableRow>
                                ))
                            ) : sortedData.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={displayColumns.length + (rowActions ? 1 : 0)} className="text-center py-8 text-muted-foreground">
                                        {emptyMessage}
                                    </TableCell>
                                </TableRow>
                            ) : (
                                sortedData.map((row, idx) => (
                                    <TableRow
                                        key={row.id || idx}
                                        className={onRowClick ? 'cursor-pointer hover:bg-muted/50' : ''}
                                        onClick={() => onRowClick?.(row)}
                                    >
                                        {displayColumns.map((col) => (
                                            <TableCell key={col.key} style={{ width: columnWidths[col.key] || 150 }}>
                                                {enableInlineEdit && col.editable && onCellUpdate ? (
                                                    <EditableCell
                                                        value={row[col.key]}
                                                        rowId={row.id}
                                                        columnKey={col.key}
                                                        config={col.editable}
                                                        onUpdate={onCellUpdate}
                                                        width={columnWidths[col.key] || 150}
                                                    />
                                                ) : (
                                                    <div className="truncate" style={{ maxWidth: columnWidths[col.key] || 150 }}>
                                                        {col.render ? col.render(row[col.key], row) : (row[col.key] ?? '-')}
                                                    </div>
                                                )}
                                            </TableCell>
                                        ))}
                                        {rowActions && (
                                            <TableCell onClick={(e) => e.stopPropagation()}>
                                                {rowActions(row)}
                                            </TableCell>
                                        )}
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </div>

            {/* Pagination */}
            {showPagination && (
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>
                        Showing {page * pageSize + 1} - {Math.min((page + 1) * pageSize, totalCount || 0)} of {totalCount} items
                    </span>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onPageChange?.(page - 1)}
                            disabled={page === 0}
                        >
                            <ChevronLeft className="h-4 w-4 mr-1" />
                            Previous
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onPageChange?.(page + 1)}
                            disabled={page >= totalPages - 1}
                        >
                            Next
                            <ChevronRight className="h-4 w-4 ml-1" />
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}

