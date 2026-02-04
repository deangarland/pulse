import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAccountStore } from '@/lib/account-store'
import { DataTable, type ColumnDef } from "@/components/DataTable"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Plus, Loader2, Link2, MoreHorizontal, Pencil, Trash2, ExternalLink, X } from "lucide-react"
import { toast } from "sonner"

interface LinkPlanEntry {
    id: string
    account_id: string
    target_month: string
    type: string
    publisher: string | null
    publisher_da: number | null
    page_authority: number | null
    destination_url: string | null
    destination_page_id: string | null
    anchor_text: string | null
    status: 'planned' | 'pitched' | 'approved' | 'live'
    notes: string | null
    live_link: string | null
    source_url: string | null
    published_date: string | null
    link_type: 'dofollow' | 'nofollow' | null
    created_at: string
    updated_at: string
    accounts?: {
        id: string
        account_name: string
        website_url: string | null
    }
}

const STATUS_OPTIONS = [
    { value: 'planned', label: 'Planned', color: 'bg-gray-100 text-gray-800' },
    { value: 'pitched', label: 'Pitched', color: 'bg-yellow-100 text-yellow-800' },
    { value: 'approved', label: 'Approved', color: 'bg-blue-100 text-blue-800' },
    { value: 'live', label: 'Live', color: 'bg-green-100 text-green-800' },
]

const QUARTERS = [
    { value: '1', label: 'Q1 (Jan-Mar)' },
    { value: '2', label: 'Q2 (Apr-Jun)' },
    { value: '3', label: 'Q3 (Jul-Sep)' },
    { value: '4', label: 'Q4 (Oct-Dec)' },
]

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
]

function getStatusStyle(status: string) {
    return STATUS_OPTIONS.find(s => s.value === status)?.color || 'bg-gray-100 text-gray-800'
}

function formatMonth(dateStr: string) {
    if (!dateStr) return '-'
    const date = new Date(dateStr)
    // Use UTC methods to avoid timezone shifting the date to previous month
    return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

function formatDate(dateStr: string | null) {
    if (!dateStr) return '-'
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

export default function LinkPlan() {
    const queryClient = useQueryClient()
    const { selectedAccountId: globalAccountId } = useAccountStore()

    const [selectedAccount, setSelectedAccount] = useState<string>('')
    const [selectedQuarter, setSelectedQuarter] = useState<string>('')
    const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString())
    const [selectedStatus, setSelectedStatus] = useState<string>('')
    const [isAddOpen, setIsAddOpen] = useState(false)
    const [editingEntry, setEditingEntry] = useState<LinkPlanEntry | null>(null)

    // Form state
    const [formData, setFormData] = useState({
        target_month: '',
        type: 'Content Placement - Standard',
        publisher: '',
        publisher_da: '',
        page_authority: '',
        destination_url: '',
        anchor_text: '',
        status: 'planned',
        notes: '',
        live_link: '',
        source_url: '',
        link_type: 'dofollow'
    })

    // Sync with global account selector - null means "All Customers"
    useEffect(() => {
        setSelectedAccount(globalAccountId || '')
    }, [globalAccountId])

    // Fetch link plans
    const { data: linkPlans, isLoading, refetch } = useQuery({
        queryKey: ['link-plans', selectedAccount, selectedQuarter, selectedYear, selectedStatus],
        queryFn: async () => {
            const apiUrl = import.meta.env.VITE_API_URL || ''
            const params = new URLSearchParams()
            if (selectedAccount) params.append('account_id', selectedAccount)
            if (selectedQuarter && selectedQuarter !== '__all__') params.append('quarter', selectedQuarter)
            if (selectedYear) params.append('year', selectedYear)
            if (selectedStatus && selectedStatus !== '__all__') params.append('status', selectedStatus)

            const response = await fetch(`${apiUrl}/api/link-plan?${params}`)
            if (!response.ok) throw new Error('Failed to fetch link plans')
            return response.json() as Promise<LinkPlanEntry[]>
        }
        // Always fetch - show all data when All Customers selected
    })

    // Create mutation
    const createMutation = useMutation({
        mutationFn: async (data: typeof formData) => {
            const apiUrl = import.meta.env.VITE_API_URL || ''
            const response = await fetch(`${apiUrl}/api/link-plan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    account_id: selectedAccount,
                    target_month: data.target_month,
                    type: data.type,
                    publisher: data.publisher || null,
                    publisher_da: data.publisher_da ? parseInt(data.publisher_da) : null,
                    page_authority: data.page_authority ? parseInt(data.page_authority) : null,
                    destination_url: data.destination_url || null,
                    anchor_text: data.anchor_text || null,
                    status: data.status,
                    notes: data.notes || null,
                    source_url: data.source_url || null,
                    link_type: data.link_type || 'dofollow'
                })
            })
            if (!response.ok) {
                const err = await response.json()
                throw new Error(err.error || 'Failed to create link plan')
            }
            return response.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['link-plans'] })
            setIsAddOpen(false)
            resetForm()
            toast.success('Link plan created')
        },
        onError: (error) => {
            toast.error(`Failed to create: ${error.message}`)
        }
    })

    // Update mutation
    const updateMutation = useMutation({
        mutationFn: async ({ id, data }: { id: string, data: typeof formData }) => {
            const apiUrl = import.meta.env.VITE_API_URL || ''
            const response = await fetch(`${apiUrl}/api/link-plan/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...data,
                    publisher_da: data.publisher_da ? parseInt(data.publisher_da as string) : null,
                    page_authority: data.page_authority ? parseInt(data.page_authority as string) : null
                })
            })
            if (!response.ok) throw new Error('Failed to update link plan')
            return response.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['link-plans'] })
            setEditingEntry(null)
            resetForm()
            toast.success('Link plan updated')
        },
        onError: (error) => {
            toast.error(`Failed to update: ${error.message}`)
        }
    })

    // Delete mutation
    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const apiUrl = import.meta.env.VITE_API_URL || ''
            const response = await fetch(`${apiUrl}/api/link-plan/${id}`, {
                method: 'DELETE'
            })
            if (!response.ok) throw new Error('Failed to delete link plan')
            return response.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['link-plans'] })
            toast.success('Link plan deleted')
        },
        onError: (error) => {
            toast.error(`Failed to delete: ${error.message}`)
        }
    })

    // Quick status update
    const quickStatusMutation = useMutation({
        mutationFn: async ({ id, status }: { id: string, status: string }) => {
            const apiUrl = import.meta.env.VITE_API_URL || ''
            const response = await fetch(`${apiUrl}/api/link-plan/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            })
            if (!response.ok) throw new Error('Failed to update status')
            return response.json()
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['link-plans'] })
            toast.success('Status updated')
        }
    })

    // Inline cell update handler
    const handleCellUpdate = async (rowId: string, key: string, value: any) => {
        const apiUrl = import.meta.env.VITE_API_URL || ''
        const response = await fetch(`${apiUrl}/api/link-plan/${rowId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [key]: value })
        })
        if (!response.ok) {
            const err = await response.json().catch(() => ({}))
            toast.error(err.error || 'Failed to update')
            throw new Error('Failed to update')
        }
        queryClient.invalidateQueries({ queryKey: ['link-plans'] })
        toast.success('Updated')
    }

    function resetForm() {
        setFormData({
            target_month: '',
            type: 'Content Placement - Standard',
            publisher: '',
            publisher_da: '',
            page_authority: '',
            destination_url: '',
            anchor_text: '',
            status: 'planned',
            notes: '',
            live_link: '',
            source_url: '',
            link_type: 'dofollow'
        })
    }

    function handleEdit(entry: LinkPlanEntry) {
        setFormData({
            target_month: entry.target_month,
            type: entry.type || 'Content Placement - Standard',
            publisher: entry.publisher || '',
            publisher_da: entry.publisher_da?.toString() || '',
            page_authority: entry.page_authority?.toString() || '',
            destination_url: entry.destination_url || '',
            anchor_text: entry.anchor_text || '',
            status: entry.status,
            notes: entry.notes || '',
            live_link: entry.live_link || '',
            source_url: entry.source_url || '',
            link_type: entry.link_type || 'dofollow'
        })
        setEditingEntry(entry)
    }

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!formData.target_month) {
            toast.error('Target month is required')
            return
        }
        if (editingEntry) {
            updateMutation.mutate({ id: editingEntry.id, data: formData })
        } else {
            createMutation.mutate(formData)
        }
    }

    function clearFilters() {
        setSelectedQuarter('')
        setSelectedStatus('')
    }

    const hasFilters = selectedQuarter || selectedStatus

    // Generate year options
    const currentYear = new Date().getFullYear()
    const yearOptions = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2]

    // Define columns for DataTable
    const columns: ColumnDef[] = [
        {
            key: 'account_name',
            label: 'Account',
            defaultVisible: !selectedAccount, // Show by default when viewing All Customers
            defaultWidth: 140,
            sortable: true,
            render: (_value, row) => row.accounts?.account_name || '-'
        },
        {
            key: 'target_month',
            label: 'Month',
            defaultVisible: true,
            defaultWidth: 120,
            sortable: true,
            render: (value) => <span className="font-medium">{formatMonth(value)}</span>
        },
        {
            key: 'status',
            label: 'Status',
            defaultVisible: true,
            defaultWidth: 100,
            sortable: true,
            render: (value, row) => (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Badge className={`cursor-pointer ${getStatusStyle(value)}`}>
                            {value}
                        </Badge>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                        {STATUS_OPTIONS.map(s => (
                            <DropdownMenuItem
                                key={s.value}
                                onClick={() => quickStatusMutation.mutate({ id: row.id, status: s.value })}
                            >
                                <Badge className={`mr-2 ${s.color}`}>{s.label}</Badge>
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            )
        },
        {
            key: 'publisher',
            label: 'Publisher',
            defaultVisible: true,
            defaultWidth: 150,
            sortable: true,
            editable: { type: 'text', placeholder: 'TBD' }
        },
        {
            key: 'publisher_da',
            label: 'DA',
            defaultVisible: true,
            defaultWidth: 60,
            sortable: true,
            editable: { type: 'number', placeholder: '0-100' }
        },
        {
            key: 'page_authority',
            label: 'PA',
            defaultVisible: true,
            defaultWidth: 60,
            sortable: true,
            editable: { type: 'number', placeholder: '0-100' }
        },
        {
            key: 'destination_url',
            label: 'Destination URL',
            defaultVisible: true,
            defaultWidth: 200,
            sortable: false,
            render: (value) => {
                if (!value) return <span className="text-muted-foreground">-</span>
                try {
                    return (
                        <a
                            href={value}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline flex items-center gap-1 text-xs"
                        >
                            {new URL(value).pathname}
                            <ExternalLink className="h-3 w-3" />
                        </a>
                    )
                } catch {
                    return value
                }
            }
        },
        {
            key: 'anchor_text',
            label: 'Anchor',
            defaultVisible: true,
            defaultWidth: 150,
            sortable: true,
            editable: { type: 'text', placeholder: 'Anchor text' }
        },
        {
            key: 'link_type',
            label: 'Type',
            defaultVisible: true,
            defaultWidth: 90,
            sortable: true,
            render: (value) => {
                if (!value) return '-'
                return (
                    <Badge variant={value === 'dofollow' ? 'default' : 'secondary'} className="text-xs">
                        {value}
                    </Badge>
                )
            }
        },
        {
            key: 'source_url',
            label: 'Live Link',
            defaultVisible: true,
            defaultWidth: 180,
            sortable: false,
            render: (value) => {
                if (!value) return <span className="text-muted-foreground">-</span>
                try {
                    const url = new URL(value)
                    return (
                        <a
                            href={value}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline flex items-center gap-1 text-xs"
                            title={value}
                        >
                            {url.hostname.replace('www.', '')}
                            <ExternalLink className="h-3 w-3" />
                        </a>
                    )
                } catch {
                    return value
                }
            }
        },
        {
            key: 'published_date',
            label: 'Published',
            defaultVisible: false,
            defaultWidth: 100,
            sortable: true,
            render: (value) => formatDate(value)
        },
        {
            key: 'notes',
            label: 'Notes',
            defaultVisible: false,
            defaultWidth: 150,
            sortable: false,
            render: (value) => value ? (
                <span className="text-xs truncate max-w-[150px] block" title={value}>
                    {value}
                </span>
            ) : '-'
        }
    ]

    // Row actions for DataTable
    const rowActions = (row: LinkPlanEntry) => (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                    <MoreHorizontal className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleEdit(row)}>
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                    className="text-red-600"
                    onClick={() => deleteMutation.mutate(row.id)}
                >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )

    // Filter toolbar for DataTable - account is controlled by global CustomerSelector
    const filterToolbar = (
        <div className="flex gap-3 flex-wrap items-end">
            <div className="w-[130px]">
                <Select value={selectedQuarter} onValueChange={setSelectedQuarter}>
                    <SelectTrigger className="h-9">
                        <SelectValue placeholder="All quarters" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="__all__">All quarters</SelectItem>
                        {QUARTERS.map(q => (
                            <SelectItem key={q.value} value={q.value}>{q.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <div className="w-[90px]">
                <Select value={selectedYear} onValueChange={setSelectedYear}>
                    <SelectTrigger className="h-9">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {yearOptions.map(y => (
                            <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <div className="w-[120px]">
                <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                    <SelectTrigger className="h-9">
                        <SelectValue placeholder="All statuses" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="__all__">All statuses</SelectItem>
                        {STATUS_OPTIONS.map(s => (
                            <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            {hasFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9">
                    <X className="h-4 w-4 mr-1" />
                    Clear
                </Button>
            )}
        </div>
    )

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex justify-between items-start">
                <div>
                    <h1 className="text-2xl font-bold">Link Plan</h1>
                    <p className="text-muted-foreground">Plan and track link building campaigns by quarter</p>
                </div>
                <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="h-4 w-4 mr-2" />
                            Add Link
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-lg">
                        <DialogHeader>
                            <DialogTitle>Add Link Plan</DialogTitle>
                        </DialogHeader>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>Target Month *</Label>
                                    <Input
                                        type="month"
                                        value={formData.target_month ? formData.target_month.substring(0, 7) : ''}
                                        onChange={e => setFormData(f => ({ ...f, target_month: e.target.value + '-01' }))}
                                        required
                                    />
                                </div>
                                <div>
                                    <Label>Status</Label>
                                    <Select value={formData.status} onValueChange={v => setFormData(f => ({ ...f, status: v }))}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {STATUS_OPTIONS.map(s => (
                                                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div>
                                <Label>Destination URL</Label>
                                <Input
                                    placeholder="https://example.com/page"
                                    value={formData.destination_url}
                                    onChange={e => setFormData(f => ({ ...f, destination_url: e.target.value }))}
                                />
                            </div>
                            <div>
                                <Label>Anchor Text</Label>
                                <Input
                                    placeholder="Target keyword or phrase"
                                    value={formData.anchor_text}
                                    onChange={e => setFormData(f => ({ ...f, anchor_text: e.target.value }))}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>Publisher</Label>
                                    <Input
                                        placeholder="publisher.com"
                                        value={formData.publisher}
                                        onChange={e => setFormData(f => ({ ...f, publisher: e.target.value }))}
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <Label>DA</Label>
                                        <Input
                                            type="number"
                                            placeholder="0-100"
                                            value={formData.publisher_da}
                                            onChange={e => setFormData(f => ({ ...f, publisher_da: e.target.value }))}
                                        />
                                    </div>
                                    <div>
                                        <Label>PA</Label>
                                        <Input
                                            type="number"
                                            placeholder="0-100"
                                            value={formData.page_authority}
                                            onChange={e => setFormData(f => ({ ...f, page_authority: e.target.value }))}
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>Live Link URL</Label>
                                    <Input
                                        placeholder="https://publisher.com/article"
                                        value={formData.source_url}
                                        onChange={e => setFormData(f => ({ ...f, source_url: e.target.value }))}
                                    />
                                </div>
                                <div>
                                    <Label>Link Type</Label>
                                    <Select value={formData.link_type} onValueChange={v => setFormData(f => ({ ...f, link_type: v }))}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="dofollow">Dofollow</SelectItem>
                                            <SelectItem value="nofollow">Nofollow</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div>
                                <Label>Notes</Label>
                                <Textarea
                                    placeholder="Additional notes..."
                                    value={formData.notes}
                                    onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))}
                                />
                            </div>
                            <div className="flex justify-end gap-2">
                                <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>
                                    Cancel
                                </Button>
                                <Button type="submit" disabled={createMutation.isPending}>
                                    {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                    Create
                                </Button>
                            </div>
                        </form>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Data Table */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Link2 className="h-5 w-5" />
                        Link Plans
                        {linkPlans && <Badge variant="secondary">{linkPlans.length}</Badge>}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <DataTable
                        data={linkPlans || []}
                        columns={columns}
                        loading={isLoading}
                        storageKey="pulse_link_plan"
                        emptyMessage="No link plans found."
                        rowActions={rowActions}
                        toolbar={filterToolbar}
                        onRefresh={() => refetch()}
                        defaultSort={{ key: 'target_month', direction: 'desc' }}
                        enableInlineEdit={true}
                        onCellUpdate={handleCellUpdate}
                    />
                </CardContent>
            </Card>

            {/* Edit Dialog */}
            <Dialog open={!!editingEntry} onOpenChange={open => !open && setEditingEntry(null)}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Edit Link Plan</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label>Target Month</Label>
                                <Input
                                    type="month"
                                    value={formData.target_month?.substring(0, 7)}
                                    onChange={e => setFormData(f => ({ ...f, target_month: e.target.value + '-01' }))}
                                />
                            </div>
                            <div>
                                <Label>Status</Label>
                                <Select value={formData.status} onValueChange={v => setFormData(f => ({ ...f, status: v }))}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {STATUS_OPTIONS.map(s => (
                                            <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div>
                            <Label>Destination URL</Label>
                            <Input
                                value={formData.destination_url}
                                onChange={e => setFormData(f => ({ ...f, destination_url: e.target.value }))}
                            />
                        </div>
                        <div>
                            <Label>Anchor Text</Label>
                            <Input
                                value={formData.anchor_text}
                                onChange={e => setFormData(f => ({ ...f, anchor_text: e.target.value }))}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label>Publisher</Label>
                                <Input
                                    value={formData.publisher}
                                    onChange={e => setFormData(f => ({ ...f, publisher: e.target.value }))}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <Label>DA</Label>
                                    <Input
                                        type="number"
                                        value={formData.publisher_da}
                                        onChange={e => setFormData(f => ({ ...f, publisher_da: e.target.value }))}
                                    />
                                </div>
                                <div>
                                    <Label>PA</Label>
                                    <Input
                                        type="number"
                                        value={formData.page_authority}
                                        onChange={e => setFormData(f => ({ ...f, page_authority: e.target.value }))}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label>Live Link URL</Label>
                                <Input
                                    value={formData.source_url}
                                    onChange={e => setFormData(f => ({ ...f, source_url: e.target.value }))}
                                />
                            </div>
                            <div>
                                <Label>Link Type</Label>
                                <Select value={formData.link_type} onValueChange={v => setFormData(f => ({ ...f, link_type: v }))}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="dofollow">Dofollow</SelectItem>
                                        <SelectItem value="nofollow">Nofollow</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div>
                            <Label>Notes</Label>
                            <Textarea
                                value={formData.notes}
                                onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))}
                            />
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button type="button" variant="outline" onClick={() => setEditingEntry(null)}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={updateMutation.isPending}>
                                {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                Save Changes
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}
