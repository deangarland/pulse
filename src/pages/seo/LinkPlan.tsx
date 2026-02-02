import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAccountStore } from '@/lib/account-store'
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
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Plus, Loader2, Link2, MoreHorizontal, Pencil, Trash2, ExternalLink } from "lucide-react"
import { toast } from "sonner"

interface LinkPlanEntry {
    id: string
    account_id: string
    target_month: string
    type: string
    publisher: string | null
    publisher_da: number | null
    destination_url: string | null
    destination_page_id: string | null
    anchor_text: string | null
    status: 'planned' | 'pitched' | 'approved' | 'live'
    notes: string | null
    live_link: string | null
    created_at: string
    updated_at: string
    accounts?: {
        id: string
        account_name: string
        website_url: string | null
    }
}

interface Account {
    id: string
    account_name: string
    website_url: string | null
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
    const date = new Date(dateStr)
    return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

export default function LinkPlan() {
    const queryClient = useQueryClient()
    const { selectedAccountId: globalAccountId } = useAccountStore()

    const [selectedAccount, setSelectedAccount] = useState<string>('')
    const [selectedQuarter, setSelectedQuarter] = useState<string>('')
    const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString())
    const [isAddOpen, setIsAddOpen] = useState(false)
    const [editingEntry, setEditingEntry] = useState<LinkPlanEntry | null>(null)

    // Form state
    const [formData, setFormData] = useState({
        target_month: '',
        type: 'Content Placement - Standard',
        publisher: '',
        publisher_da: '',
        destination_url: '',
        anchor_text: '',
        status: 'planned',
        notes: '',
        live_link: ''
    })

    // Fetch accounts
    const { data: accounts } = useQuery({
        queryKey: ['accounts-list'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('accounts')
                .select('id, account_name, website_url')
                .order('account_name')
            if (error) throw error
            return data as Account[]
        }
    })

    // Set selected account from global context (useAccountStore has the UUID)
    // Sync whenever the global store changes
    useEffect(() => {
        if (globalAccountId) {
            setSelectedAccount(globalAccountId)
        }
    }, [globalAccountId])

    // Fetch link plans
    const { data: linkPlans, isLoading } = useQuery({
        queryKey: ['link-plans', selectedAccount, selectedQuarter, selectedYear],
        queryFn: async () => {
            const apiUrl = import.meta.env.VITE_API_URL || ''
            const params = new URLSearchParams()
            if (selectedAccount) params.append('account_id', selectedAccount)
            if (selectedQuarter) params.append('quarter', selectedQuarter)
            if (selectedYear) params.append('year', selectedYear)

            const response = await fetch(`${apiUrl}/api/link-plan?${params}`)
            if (!response.ok) throw new Error('Failed to fetch link plans')
            return response.json() as Promise<LinkPlanEntry[]>
        },
        enabled: !!selectedAccount
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
                    destination_url: data.destination_url || null,
                    anchor_text: data.anchor_text || null,
                    status: data.status,
                    notes: data.notes || null
                })
            })
            if (!response.ok) throw new Error('Failed to create link plan')
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
        mutationFn: async ({ id, data }: { id: string, data: Partial<typeof formData> }) => {
            const apiUrl = import.meta.env.VITE_API_URL || ''
            const response = await fetch(`${apiUrl}/api/link-plan/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...data,
                    publisher_da: data.publisher_da ? parseInt(data.publisher_da as string) : null
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

    function resetForm() {
        setFormData({
            target_month: '',
            type: 'Content Placement - Standard',
            publisher: '',
            publisher_da: '',
            destination_url: '',
            anchor_text: '',
            status: 'planned',
            notes: '',
            live_link: ''
        })
    }

    function handleEdit(entry: LinkPlanEntry) {
        setFormData({
            target_month: entry.target_month,
            type: entry.type || 'Content Placement - Standard',
            publisher: entry.publisher || '',
            publisher_da: entry.publisher_da?.toString() || '',
            destination_url: entry.destination_url || '',
            anchor_text: entry.anchor_text || '',
            status: entry.status,
            notes: entry.notes || '',
            live_link: entry.live_link || ''
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

    // Generate year options (current year -1 to +2)
    const currentYear = new Date().getFullYear()
    const yearOptions = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2]

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Link Plan</h1>
                    <p className="text-muted-foreground">
                        Plan and track link building campaigns by quarter
                    </p>
                </div>
                <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                    <DialogTrigger asChild>
                        <Button disabled={!selectedAccount}>
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
                                    value={formData.destination_url}
                                    onChange={e => setFormData(f => ({ ...f, destination_url: e.target.value }))}
                                    placeholder="https://example.com/page"
                                />
                            </div>
                            <div>
                                <Label>Anchor Text</Label>
                                <Input
                                    value={formData.anchor_text}
                                    onChange={e => setFormData(f => ({ ...f, anchor_text: e.target.value }))}
                                    placeholder="Target keyword or phrase"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <Label>Publisher</Label>
                                    <Input
                                        value={formData.publisher}
                                        onChange={e => setFormData(f => ({ ...f, publisher: e.target.value }))}
                                        placeholder="publisher.com"
                                    />
                                </div>
                                <div>
                                    <Label>Publisher DA</Label>
                                    <Input
                                        type="number"
                                        value={formData.publisher_da}
                                        onChange={e => setFormData(f => ({ ...f, publisher_da: e.target.value }))}
                                        placeholder="0-100"
                                        min={0}
                                        max={100}
                                    />
                                </div>
                            </div>
                            <div>
                                <Label>Notes</Label>
                                <Textarea
                                    value={formData.notes}
                                    onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))}
                                    rows={2}
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

            {/* Filters */}
            <Card>
                <CardContent className="pt-6">
                    <div className="flex gap-4 flex-wrap">
                        <div className="w-[200px]">
                            <Label className="text-xs text-muted-foreground">Account</Label>
                            <Select value={selectedAccount} onValueChange={setSelectedAccount}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select account..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {accounts?.map(a => (
                                        <SelectItem key={a.id} value={a.id}>{a.account_name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="w-[150px]">
                            <Label className="text-xs text-muted-foreground">Quarter</Label>
                            <Select value={selectedQuarter} onValueChange={setSelectedQuarter}>
                                <SelectTrigger>
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
                        <div className="w-[100px]">
                            <Label className="text-xs text-muted-foreground">Year</Label>
                            <Select value={selectedYear} onValueChange={setSelectedYear}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {yearOptions.map(y => (
                                        <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardContent>
            </Card>

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
                    {!selectedAccount ? (
                        <div className="text-center py-12 text-muted-foreground">
                            <Link2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>Select an account to view link plans</p>
                        </div>
                    ) : isLoading ? (
                        <div className="flex justify-center py-12">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : !linkPlans?.length ? (
                        <div className="text-center py-12 text-muted-foreground">
                            <Link2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>No link plans yet. Click "Add Link" to get started.</p>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[120px]">Month</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Publisher</TableHead>
                                    <TableHead className="w-[60px]">DA</TableHead>
                                    <TableHead>Destination URL</TableHead>
                                    <TableHead>Anchor</TableHead>
                                    <TableHead className="w-[50px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {linkPlans.map(entry => (
                                    <TableRow key={entry.id}>
                                        <TableCell className="font-medium">
                                            {formatMonth(entry.target_month)}
                                        </TableCell>
                                        <TableCell>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Badge
                                                        className={`cursor-pointer ${getStatusStyle(entry.status)}`}
                                                    >
                                                        {entry.status}
                                                    </Badge>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent>
                                                    {STATUS_OPTIONS.map(s => (
                                                        <DropdownMenuItem
                                                            key={s.value}
                                                            onClick={() => quickStatusMutation.mutate({ id: entry.id, status: s.value })}
                                                        >
                                                            <Badge className={`mr-2 ${s.color}`}>{s.label}</Badge>
                                                        </DropdownMenuItem>
                                                    ))}
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                        <TableCell>
                                            {entry.publisher || <span className="text-muted-foreground">TBD</span>}
                                        </TableCell>
                                        <TableCell>
                                            {entry.publisher_da || '-'}
                                        </TableCell>
                                        <TableCell className="max-w-[200px] truncate">
                                            {entry.destination_url ? (
                                                <a
                                                    href={entry.destination_url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-blue-600 hover:underline flex items-center gap-1"
                                                >
                                                    {new URL(entry.destination_url).pathname}
                                                    <ExternalLink className="h-3 w-3" />
                                                </a>
                                            ) : (
                                                <span className="text-muted-foreground">-</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="max-w-[150px] truncate">
                                            {entry.anchor_text || '-'}
                                        </TableCell>
                                        <TableCell>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="sm">
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => handleEdit(entry)}>
                                                        <Pencil className="h-4 w-4 mr-2" />
                                                        Edit
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        className="text-red-600"
                                                        onClick={() => deleteMutation.mutate(entry.id)}
                                                    >
                                                        <Trash2 className="h-4 w-4 mr-2" />
                                                        Delete
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
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
                            <div>
                                <Label>Publisher DA</Label>
                                <Input
                                    type="number"
                                    value={formData.publisher_da}
                                    onChange={e => setFormData(f => ({ ...f, publisher_da: e.target.value }))}
                                    min={0}
                                    max={100}
                                />
                            </div>
                        </div>
                        {formData.status === 'live' && (
                            <div>
                                <Label>Live Link</Label>
                                <Input
                                    value={formData.live_link}
                                    onChange={e => setFormData(f => ({ ...f, live_link: e.target.value }))}
                                    placeholder="https://publisher.com/article"
                                />
                            </div>
                        )}
                        <div>
                            <Label>Notes</Label>
                            <Textarea
                                value={formData.notes}
                                onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))}
                                rows={2}
                            />
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button type="button" variant="outline" onClick={() => setEditingEntry(null)}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={updateMutation.isPending}>
                                {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                                Save
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}
