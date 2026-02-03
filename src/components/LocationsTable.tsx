import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { DataTable, type ColumnDef } from "@/components/DataTable"
import { LocationEditSheet } from '@/components/LocationEditSheet'
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { Trash2, Star, Pencil } from "lucide-react"

// Column definitions
const COLUMNS: ColumnDef[] = [
    { key: 'location_name', label: 'Location', defaultVisible: true, defaultWidth: 180 },
    { key: 'city', label: 'City', defaultVisible: true, defaultWidth: 120 },
    { key: 'state', label: 'State', defaultVisible: true, defaultWidth: 70 },
    { key: 'phone_number', label: 'Phone', defaultVisible: true, defaultWidth: 130 },
    {
        key: 'page_id',
        label: 'Linked Page',
        defaultVisible: true,
        defaultWidth: 140,
        render: (v) => v
            ? <span className="text-xs text-green-600">Linked</span>
            : <span className="text-xs text-orange-500">Not linked</span>
    },
    { key: 'street', label: 'Street', defaultVisible: false, defaultWidth: 200 },
    { key: 'postal', label: 'Postal', defaultVisible: false, defaultWidth: 80 },
    { key: 'hours', label: 'Hours', defaultVisible: false, defaultWidth: 150 },
    {
        key: 'is_primary', label: 'Primary', defaultVisible: true, defaultWidth: 70,
        render: (v) => v ? <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" /> : null
    },
]

interface Location {
    id: string
    location_name: string
    street: string | null
    city: string | null
    state: string | null
    postal: string | null
    phone_number: string | null
    hours: string | null
    page_id: string | null
    is_primary: boolean
    account_id?: string
}

interface LocationsTableProps {
    accountId?: string // Optional - if provided, filters by this account
}

export function LocationsTable({ accountId }: LocationsTableProps) {
    const queryClient = useQueryClient()

    // Separate state for data and open - matches PageIndex pattern
    const [editingLocation, setEditingLocation] = useState<Location | null>(null)
    const [editSheetOpen, setEditSheetOpen] = useState(false)

    const handleEditLocation = (location: Location) => {
        setEditingLocation(location)
        setEditSheetOpen(true)
    }

    // Fetch locations - filtered by account if provided
    const { data: locations = [], isLoading, refetch } = useQuery({
        queryKey: ['taxonomy', 'locations_procedures', accountId || 'all'],
        queryFn: async () => {
            let query = supabase
                .from('locations_procedures')
                .select('*')
                .order('location_name')

            // Filter by account if provided
            if (accountId) {
                query = query.eq('account_id', accountId)
            }

            const { data, error } = await query
            if (error) throw error
            return (data || []) as Location[]
        }
    })

    // Delete mutation
    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase.from('locations_procedures').delete().eq('id', id)
            if (error) throw error
        },
        onSuccess: () => {
            toast.success('Deleted successfully')
            queryClient.invalidateQueries({ queryKey: ['taxonomy', 'locations_procedures'] })
        },
        onError: (err: Error) => toast.error(`Delete failed: ${err.message}`)
    })

    const handleDelete = (row: Location) => {
        if (confirm('Delete this location?')) {
            deleteMutation.mutate(row.id)
        }
    }

    return (
        <>
            <DataTable
                data={locations}
                columns={COLUMNS}
                loading={isLoading}
                storageKey="taxonomy_locations_procedures"
                emptyMessage="No locations yet"
                onRefresh={() => refetch()}
                toolbar={
                    <span className="text-sm text-muted-foreground">
                        {locations.length} locations
                    </span>
                }
                rowActions={(row) => (
                    <div className="flex gap-1">
                        <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => handleEditLocation(row)}
                            title="Edit location"
                        >
                            <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-red-600 hover:text-red-700"
                            onClick={() => handleDelete(row)}
                        >
                            <Trash2 className="h-4 w-4" />
                        </Button>
                    </div>
                )}
            />

            <LocationEditSheet
                location={editingLocation}
                open={editSheetOpen}
                onOpenChange={setEditSheetOpen}
            />
        </>
    )
}

