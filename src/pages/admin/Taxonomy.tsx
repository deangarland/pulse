import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import {
    Star,
    Pencil,
    Plus,
    Trash2,
    RefreshCw,
    Check,
    X
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
    columns,
    icon: Icon
}: {
    tableName: string
    columns: string[]
    icon: any
}) {
    const queryClient = useQueryClient()
    const [editingId, setEditingId] = useState<string | null>(null)
    const [addingNew, setAddingNew] = useState(false)

    // Fetch data
    const { data, isLoading, refetch } = useQuery({
        queryKey: ['taxonomy', tableName],
        queryFn: async () => {
            const { data, error } = await supabase
                .from(tableName)
                .select('*')
                .order('name')

            if (error) throw error
            return data || []
        }
    })

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

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Icon className="h-4 w-4" />
                    {data?.length || 0} items
                </div>
                <div className="flex gap-2">
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
                            {columns.map((col) => (
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
                                columns={columns}
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
                                    columns={columns}
                                    onSave={(data) => handleSave(item.id, data)}
                                    onCancel={() => setEditingId(null)}
                                />
                            ) : (
                                <TableRow key={item.id}>
                                    {columns.map((col) => (
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
                                <TableCell colSpan={columns.length + 1} className="text-center py-8 text-muted-foreground">
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
                    Manage schema.org mappings and page type classifications
                </p>
            </div>

            <Card>
                <Tabs defaultValue="schema_org" className="w-full">
                    <CardHeader className="pb-0">
                        <TabsList>
                            <TabsTrigger value="schema_org" className="flex items-center gap-2">
                                <Star className="h-4 w-4" />
                                Schema.org Mappings
                            </TabsTrigger>
                        </TabsList>
                    </CardHeader>
                    <CardContent className="pt-6">
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
