import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetFooter,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Loader2 } from "lucide-react"

// Field definition types
export type FieldType = 'text' | 'textarea' | 'select' | 'page-picker' | 'location-picker' | 'readonly' | 'boolean'

export interface FieldDef {
    key: string
    label: string
    type: FieldType
    options?: { value: string, label: string }[]  // for select
    pageTypeFilter?: string  // for page-picker (e.g., 'LOCATION')
    placeholder?: string
    required?: boolean
}

export interface EditSheetProps {
    title: string
    description?: React.ReactNode
    fields: FieldDef[]
    data: Record<string, any> | null
    open: boolean
    onOpenChange: (open: boolean) => void
    onSave: (data: Record<string, any>) => void
    saving?: boolean
}

// Page picker hook
function usePages(pageTypeFilter?: string) {
    return useQuery({
        queryKey: ['pages-for-picker', pageTypeFilter],
        queryFn: async () => {
            let query = supabase
                .from('page_index')
                .select('id, path, title, page_type')
                .order('path')

            if (pageTypeFilter) {
                query = query.eq('page_type', pageTypeFilter)
            }

            const { data, error } = await query.limit(500)
            if (error) throw error
            return data || []
        },
        staleTime: 60000, // Cache for 1 minute
    })
}

// Location picker hook
function useLocations(enabled: boolean = true) {
    return useQuery({
        queryKey: ['locations-for-picker'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('locations_procedures')
                .select('id, location_name, city, state')
                .order('location_name')
            if (error) throw error
            return data || []
        },
        staleTime: 60000,
        enabled,
    })
}

export function EditSheet({
    title,
    description,
    fields,
    data,
    open,
    onOpenChange,
    onSave,
    saving = false
}: EditSheetProps) {
    // Form state
    const [formData, setFormData] = useState<Record<string, any>>({})

    // Fetch pages and locations for pickers (only when needed)
    const hasPagePicker = fields.some(f => f.type === 'page-picker')
    const hasLocationPicker = fields.some(f => f.type === 'location-picker')
    const pageTypeFilter = fields.find(f => f.type === 'page-picker')?.pageTypeFilter

    const { data: pages = [] } = usePages(hasPagePicker ? pageTypeFilter : undefined)
    const { data: locations = [] } = useLocations(hasLocationPicker)

    // Update form when data changes
    useEffect(() => {
        if (data) {
            const initialData: Record<string, any> = {}
            fields.forEach(field => {
                initialData[field.key] = data[field.key] ?? ''
            })
            setFormData(initialData)
        } else {
            // Reset form
            const emptyData: Record<string, any> = {}
            fields.forEach(field => {
                emptyData[field.key] = ''
            })
            setFormData(emptyData)
        }
    }, [data, fields])

    const handleChange = (key: string, value: any) => {
        setFormData(prev => ({ ...prev, [key]: value }))
    }

    const handleSave = () => {
        onSave(formData)
    }

    const renderField = (field: FieldDef) => {
        const value = formData[field.key] ?? ''

        switch (field.type) {
            case 'text':
                return (
                    <Input
                        id={field.key}
                        value={value}
                        onChange={(e) => handleChange(field.key, e.target.value)}
                        placeholder={field.placeholder}
                    />
                )

            case 'textarea':
                return (
                    <Textarea
                        id={field.key}
                        value={value}
                        onChange={(e) => handleChange(field.key, e.target.value)}
                        placeholder={field.placeholder}
                        rows={3}
                    />
                )

            case 'select':
                return (
                    <Select value={value} onValueChange={(v) => handleChange(field.key, v)}>
                        <SelectTrigger>
                            <SelectValue placeholder={field.placeholder || 'Select...'} />
                        </SelectTrigger>
                        <SelectContent>
                            {field.options?.map(opt => (
                                <SelectItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )

            case 'boolean':
                return (
                    <Select
                        value={value === true ? 'true' : value === false ? 'false' : ''}
                        onValueChange={(v) => handleChange(field.key, v === 'true')}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder="Select..." />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="true">Yes</SelectItem>
                            <SelectItem value="false">No</SelectItem>
                        </SelectContent>
                    </Select>
                )

            case 'page-picker':
                return (
                    <Select
                        value={value || '__none__'}
                        onValueChange={(v) => handleChange(field.key, v === '__none__' ? null : v)}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder="Select a page..." />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__none__">None</SelectItem>
                            {pages.map((page: any) => (
                                <SelectItem key={page.id} value={page.id}>
                                    {page.path || page.title}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )

            case 'location-picker':
                return (
                    <Select
                        value={value || '__none__'}
                        onValueChange={(v) => handleChange(field.key, v === '__none__' ? null : v)}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder="Select a location..." />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__none__">None</SelectItem>
                            {locations.map((loc: any) => (
                                <SelectItem key={loc.id} value={loc.id}>
                                    {loc.location_name} ({loc.city}, {loc.state})
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )

            case 'readonly':
                return (
                    <p className="text-sm text-muted-foreground py-2">
                        {value || 'N/A'}
                    </p>
                )

            default:
                return null
        }
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-[500px] sm:max-w-[500px] overflow-y-auto">
                <SheetHeader>
                    <SheetTitle>{title}</SheetTitle>
                    {description && (
                        <SheetDescription>{description}</SheetDescription>
                    )}
                </SheetHeader>

                {data ? (
                    <>
                        <div className="grid gap-4 py-6">
                            {fields.map(field => (
                                <div key={field.key} className="grid gap-2">
                                    <Label htmlFor={field.key}>
                                        {field.label}
                                        {field.required && <span className="text-red-500 ml-1">*</span>}
                                    </Label>
                                    {renderField(field)}
                                </div>
                            ))}
                        </div>

                        <SheetFooter>
                            <Button variant="outline" onClick={() => onOpenChange(false)}>
                                Cancel
                            </Button>
                            <Button onClick={handleSave} disabled={saving}>
                                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Save Changes
                            </Button>
                        </SheetFooter>
                    </>
                ) : (
                    <div className="py-6 text-muted-foreground">Loading...</div>
                )}
            </SheetContent>
        </Sheet>
    )
}
