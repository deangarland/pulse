import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuCheckboxItem
} from "@/components/ui/dropdown-menu"
import { toast } from "sonner"
import {
    Star,
    Pencil,
    Plus,
    Trash2,
    RefreshCw,
    Check,
    X,
    Settings2
} from "lucide-react"

// Editable row component
function EditableRow({
    item,
    columns,
    onSave,
    onCancel
}: {
    item: any
    columns: string[]
    onSave: (data: any) => void
    onCancel: () => void
    isNew?: boolean
}) {
    const [editData, setEditData] = useState(item)

    return (
        <TableRow>
            {columns.map((col) => (
                <TableCell key={col}>
                    {col === 'primary' ? (
                        <input
                            type="checkbox"
                            checked={editData[col] || false}
                            onChange={(e) => setEditData({ ...editData, [col]: e.target.checked })}
                            className="h-4 w-4"
                        />
                    ) : (
                        <Input
                            value={editData[col] || ''}
                            onChange={(e) => setEditData({ ...editData, [col]: e.target.value })}
                            className="h-8"
                        />
                    )}
                </TableCell>
            ))}
            <TableCell className="flex gap-1">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onSave(editData)}>
                    <Check className="h-4 w-4 text-green-600" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onCancel}>
                    <X className="h-4 w-4 text-red-600" />
                </Button>
            </TableCell>
        </TableRow>
    )
}

// Generic table component
function TaxonomyTable({
    tableName,
    columns: defaultColumns,
    icon: Icon
}: {
    tableName: string
    columns: string[]
    icon: any
}) {
    const queryClient = useQueryClient()
    const [editingId, setEditingId] = useState<string | null>(null)
    const [addingNew, setAddingNew] = useState(false)
    const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(defaultColumns))

    // Fetch data
    const { data, isLoading, refetch } = useQuery({
        queryKey: ['taxonomy', tableName],
        queryFn: async () => {
            const { data, error } = await supabase
                .from(tableName)
                .select('*')
                .order(defaultColumns[0] || 'id')

            if (error) throw error
            return data || []
        }
    })

    // Get all available columns from data (excluding technical ones)
    const allColumns = data && data.length > 0
        ? Object.keys(data[0]).filter(k => !['id', 'created_at', 'updated_at'].includes(k))
        : defaultColumns

    const toggleColumn = (col: string) => {
        setVisibleColumns(prev => {
            const next = new Set(prev)
            if (next.has(col)) next.delete(col)
            else next.add(col)
            return next
        })
    }

    // Update mutation
    const updateMutation = useMutation({
        mutationFn: async ({ id, data }: { id: string; data: any }) => {
            const { error } = await supabase
                .from(tableName)
                .update(data)
                .eq('id', id)

            if (error) throw error
        },
        onSuccess: () => {
            toast.success('Updated successfully')
            queryClient.invalidateQueries({ queryKey: ['taxonomy', tableName] })
            setEditingId(null)
        },
        onError: (err) => toast.error(`Update failed: ${err.message}`)
    })

    // Insert mutation
    const insertMutation = useMutation({
        mutationFn: async (data: any) => {
            const { error } = await supabase
                .from(tableName)
                .insert(data)

            if (error) throw error
        },
        onSuccess: () => {
            toast.success('Added successfully')
            queryClient.invalidateQueries({ queryKey: ['taxonomy', tableName] })
            setAddingNew(false)
        },
        onError: (err) => toast.error(`Add failed: ${err.message}`)
    })

    // Delete mutation
    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase
                .from(tableName)
                .delete()
                .eq('id', id)

            if (error) throw error
        },
        onSuccess: () => {
            toast.success('Deleted successfully')
            queryClient.invalidateQueries({ queryKey: ['taxonomy', tableName] })
        },
        onError: (err) => toast.error(`Delete failed: ${err.message}`)
    })

    const handleSave = (id: string, data: any) => {
        const { id: _, created_at, ...updateData } = data
        updateMutation.mutate({ id, data: updateData })
    }

    const handleAdd = (data: any) => {
        const { id, created_at, ...insertData } = data
        insertMutation.mutate(insertData)
    }

    if (isLoading) {
        return (
            <div className="space-y-2">
                {[1, 2, 3].map(i => (
                    <Skeleton key={i} className="h-10 w-full" />
                ))}
            </div>
        )
    }

    // Columns to display (only visible ones, filtering from all available)
    const displayColumns = allColumns.filter(col => visibleColumns.has(col))

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Icon className="h-4 w-4" />
                    {data?.length || 0} items
                </div>
                <div className="flex gap-2">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm">
                                <Settings2 className="h-4 w-4 mr-1" />
                                Columns
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48 max-h-80 overflow-auto">
                            <DropdownMenuLabel>Toggle Columns</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {allColumns.map((col) => (
                                <DropdownMenuCheckboxItem
                                    key={col}
                                    checked={visibleColumns.has(col)}
                                    onCheckedChange={() => toggleColumn(col)}
                                >
                                    {col.replace(/_/g, ' ')}
                                </DropdownMenuCheckboxItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <Button variant="outline" size="sm" onClick={() => refetch()}>
                        <RefreshCw className="h-4 w-4 mr-1" />
                        Refresh
                    </Button>
                    <Button size="sm" onClick={() => setAddingNew(true)} disabled={addingNew}>
                        <Plus className="h-4 w-4 mr-1" />
                        Add New
                    </Button>
                </div>
            </div>

            <div className="border rounded-lg overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow>
                            {displayColumns.map((col: string) => (
                                <TableHead key={col} className="capitalize">
                                    {col.replace('_', ' ')}
                                </TableHead>
                            ))}
                            <TableHead className="w-[100px]">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {addingNew && (
                            <EditableRow
                                item={{}}
                                columns={displayColumns}
                                onSave={handleAdd}
                                onCancel={() => setAddingNew(false)}
                                isNew
                            />
                        )}
                        {data?.map((item: any) => (
                            editingId === item.id ? (
                                <EditableRow
                                    key={item.id}
                                    item={item}
                                    columns={displayColumns}
                                    onSave={(data) => handleSave(item.id, data)}
                                    onCancel={() => setEditingId(null)}
                                />
                            ) : (
                                <TableRow key={item.id}>
                                    {displayColumns.map((col: string) => (
                                        <TableCell key={col}>
                                            {col === 'primary' ? (
                                                item[col] ? <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" /> : null
                                            ) : (
                                                <span className="truncate max-w-[200px] block">
                                                    {item[col] || '-'}
                                                </span>
                                            )}
                                        </TableCell>
                                    ))}
                                    <TableCell className="flex gap-1">
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-7 w-7"
                                            onClick={() => setEditingId(item.id)}
                                        >
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            className="h-7 w-7 text-red-600 hover:text-red-700"
                                            onClick={() => {
                                                if (confirm('Delete this item?')) {
                                                    deleteMutation.mutate(item.id)
                                                }
                                            }}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            )
                        ))}
                        {!data?.length && !addingNew && (
                            <TableRow>
                                <TableCell colSpan={displayColumns.length + 1} className="text-center py-8 text-muted-foreground">
                                    No items yet
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    )
}

export default function Taxonomy() {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Taxonomy</h1>
                <p className="text-muted-foreground">
                    Manage locations, procedures, categories, and schema mappings
                </p>
            </div>

            <Card>
                <Tabs defaultValue="locations" className="w-full">
                    <CardHeader className="pb-0">
                        <TabsList className="flex-wrap h-auto gap-1">
                            <TabsTrigger value="locations">Locations</TabsTrigger>
                            <TabsTrigger value="procedures">Procedures</TabsTrigger>
                            <TabsTrigger value="categories">Categories</TabsTrigger>
                            <TabsTrigger value="body_areas">Body Areas</TabsTrigger>
                            <TabsTrigger value="conditions">Conditions</TabsTrigger>
                            <TabsTrigger value="schema_org">Schema.org</TabsTrigger>
                        </TabsList>
                    </CardHeader>
                    <CardContent className="pt-6">
                        <TabsContent value="locations" className="mt-0">
                            <TaxonomyTable
                                tableName="locations_procedures"
                                columns={['location_name', 'city', 'state', 'phone_number', 'is_primary']}
                                icon={Star}
                            />
                        </TabsContent>
                        <TabsContent value="procedures" className="mt-0">
                            <TaxonomyTable
                                tableName="procedures"
                                columns={['procedure_name', 'procedure_type', 'short_description', 'active']}
                                icon={Star}
                            />
                        </TabsContent>
                        <TabsContent value="categories" className="mt-0">
                            <TaxonomyTable
                                tableName="categories"
                                columns={['category', 'type', 'description', 'active']}
                                icon={Star}
                            />
                        </TabsContent>
                        <TabsContent value="body_areas" className="mt-0">
                            <TaxonomyTable
                                tableName="body_areas"
                                columns={['body_area']}
                                icon={Star}
                            />
                        </TabsContent>
                        <TabsContent value="conditions" className="mt-0">
                            <TaxonomyTable
                                tableName="conditions"
                                columns={['condition', 'description']}
                                icon={Star}
                            />
                        </TabsContent>
                        <TabsContent value="schema_org" className="mt-0">
                            <TaxonomyTable
                                tableName="schema_org"
                                columns={['page_type', 'schema_type', 'tier', 'auto_generate', 'reason']}
                                icon={Star}
                            />
                        </TabsContent>
                    </CardContent>
                </Tabs>
            </Card>
        </div>
    )
}
