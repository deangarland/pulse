import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { EditSheet, type FieldDef } from '@/components/EditSheet'
import { toast } from 'sonner'

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
}

interface LocationEditSheetProps {
    location: Location | null
    open: boolean
    onOpenChange: (open: boolean) => void
}

// Field definitions for location editing
const LOCATION_FIELDS: FieldDef[] = [
    { key: 'location_name', label: 'Location Name', type: 'text', required: true },
    { key: 'street', label: 'Street Address', type: 'text' },
    { key: 'city', label: 'City', type: 'text', required: true },
    { key: 'state', label: 'State', type: 'text', required: true },
    { key: 'postal', label: 'Postal Code', type: 'text' },
    { key: 'phone_number', label: 'Phone Number', type: 'text' },
    { key: 'hours', label: 'Hours', type: 'textarea', placeholder: 'Mon 9am-5pm\nTue 9am-5pm...' },
    { key: 'page_id', label: 'Linked Page', type: 'page-picker', pageTypeFilter: 'LOCATION' },
    { key: 'is_primary', label: 'Primary Location', type: 'boolean' },
]

export function LocationEditSheet({ location, open, onOpenChange }: LocationEditSheetProps) {
    const queryClient = useQueryClient()

    const updateMutation = useMutation({
        mutationFn: async (data: Record<string, any>) => {
            if (!location) throw new Error('No location selected')

            const { error } = await supabase
                .from('locations_procedures')
                .update({
                    location_name: data.location_name || null,
                    street: data.street || null,
                    city: data.city || null,
                    state: data.state || null,
                    postal: data.postal || null,
                    phone_number: data.phone_number || null,
                    hours: data.hours || null,
                    page_id: data.page_id || null,
                    is_primary: data.is_primary ?? false,
                })
                .eq('id', location.id)

            if (error) throw error
        },
        onSuccess: () => {
            toast.success('Location updated successfully')
            queryClient.invalidateQueries({ queryKey: ['taxonomy', 'locations_procedures'] })
            onOpenChange(false)
        },
        onError: (error) => {
            toast.error(`Failed to update: ${error.message}`)
        }
    })

    const handleSave = (data: Record<string, any>) => {
        updateMutation.mutate(data)
    }

    return (
        <EditSheet
            title="Edit Location"
            description={location?.location_name}
            fields={LOCATION_FIELDS}
            data={location}
            open={open}
            onOpenChange={onOpenChange}
            onSave={handleSave}
            saving={updateMutation.isPending}
        />
    )
}
