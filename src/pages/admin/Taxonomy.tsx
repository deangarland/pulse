import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { DataTable, type ColumnDef } from "@/components/DataTable"
import { toast } from "sonner"
import { Trash2 } from "lucide-react"

// Table configurations
const TABLE_CONFIGS: Record<string, { columns: ColumnDef[], orderBy: string }> = {
    procedures: {
        orderBy: 'procedure_name',
        columns: [
            { key: 'procedure_name', label: 'Procedure', defaultVisible: true, defaultWidth: 200 },
            { key: 'procedure_type', label: 'Type', defaultVisible: true, defaultWidth: 120 },
            { key: 'short_description', label: 'Short Desc', defaultVisible: true, defaultWidth: 250 },
            { key: 'description', label: 'Description', defaultVisible: false, defaultWidth: 300 },
            {
                key: 'active', label: 'Active', defaultVisible: true, defaultWidth: 70,
                render: (v) => v ? 'Yes' : 'No'
            },
            { key: 'tags', label: 'Tags', defaultVisible: false, defaultWidth: 150 },
        ]
    },
    categories: {
        orderBy: 'category',
        columns: [
            { key: 'category', label: 'Category', defaultVisible: true, defaultWidth: 200 },
            { key: 'type', label: 'Type', defaultVisible: true, defaultWidth: 120 },
            { key: 'description', label: 'Description', defaultVisible: true, defaultWidth: 250 },
            { key: 'long_description', label: 'Long Desc', defaultVisible: false, defaultWidth: 300 },
            {
                key: 'active', label: 'Active', defaultVisible: true, defaultWidth: 70,
                render: (v) => v ? 'Yes' : 'No'
            },
        ]
    },
    body_areas: {
        orderBy: 'body_area',
        columns: [
            { key: 'body_area', label: 'Body Area', defaultVisible: true, defaultWidth: 250 },
        ]
    },
    conditions: {
        orderBy: 'condition',
        columns: [
            { key: 'condition', label: 'Condition', defaultVisible: true, defaultWidth: 200 },
            { key: 'slug', label: 'Slug', defaultVisible: true, defaultWidth: 150 },
            { key: 'description', label: 'Description', defaultVisible: true, defaultWidth: 300 },
        ]
    }
}

// Taxonomy table wrapper with CRUD
function TaxonomyTableWithCRUD({ tableName }: { tableName: string }) {
    const queryClient = useQueryClient()
    const config = TABLE_CONFIGS[tableName]

    // Fetch data
    const { data = [], isLoading, refetch } = useQuery({
        queryKey: ['taxonomy', tableName],
        queryFn: async () => {
            const { data, error } = await supabase
                .from(tableName)
                .select('*')
                .order(config.orderBy)
            if (error) throw error
            return data || []
        }
    })

    // Delete mutation
    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase.from(tableName).delete().eq('id', id)
            if (error) throw error
        },
        onSuccess: () => {
            toast.success('Deleted successfully')
            queryClient.invalidateQueries({ queryKey: ['taxonomy', tableName] })
        },
        onError: (err: Error) => toast.error(`Delete failed: ${err.message}`)
    })

    const handleDelete = (row: any) => {
        if (confirm('Delete this item?')) {
            deleteMutation.mutate(row.id)
        }
    }

    return (
        <DataTable
            data={data}
            columns={config.columns}
            loading={isLoading}
            storageKey={`taxonomy_${tableName}`}
            emptyMessage="No items yet"
            onRefresh={() => refetch()}
            toolbar={
                <span className="text-sm text-muted-foreground">
                    {data.length} items
                </span>
            }
            rowActions={(row) => (
                <div className="flex gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-red-600 hover:text-red-700" onClick={() => handleDelete(row)}>
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            )}
        />
    )
}

// Main component
export default function Taxonomy() {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Taxonomy</h1>
                <p className="text-muted-foreground">
                    Manage procedures, categories, body areas, and conditions
                </p>
            </div>

            <Card>
                <Tabs defaultValue="procedures" className="w-full">
                    <CardHeader className="pb-0">
                        <TabsList className="flex-wrap h-auto gap-1">
                            <TabsTrigger value="procedures">Procedures</TabsTrigger>
                            <TabsTrigger value="categories">Categories</TabsTrigger>
                            <TabsTrigger value="body_areas">Body Areas</TabsTrigger>
                            <TabsTrigger value="conditions">Conditions</TabsTrigger>
                        </TabsList>
                    </CardHeader>
                    <CardContent className="pt-6">
                        <TabsContent value="procedures" className="mt-0">
                            <TaxonomyTableWithCRUD tableName="procedures" />
                        </TabsContent>
                        <TabsContent value="categories" className="mt-0">
                            <TaxonomyTableWithCRUD tableName="categories" />
                        </TabsContent>
                        <TabsContent value="body_areas" className="mt-0">
                            <TaxonomyTableWithCRUD tableName="body_areas" />
                        </TabsContent>
                        <TabsContent value="conditions" className="mt-0">
                            <TaxonomyTableWithCRUD tableName="conditions" />
                        </TabsContent>
                    </CardContent>
                </Tabs>
            </Card>
        </div>
    )
}

