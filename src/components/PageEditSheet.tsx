import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
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
import { toast } from "sonner"
import { Loader2, ExternalLink } from "lucide-react"

interface Page {
    id: string
    url: string
    title: string | null
    page_type: string | null
    status_code: number | null
    path: string | null
    meta_description: string | null
    h1: string | null
    content_summary: string | null
}

interface PageEditSheetProps {
    page: Page | null
    open: boolean
    onOpenChange: (open: boolean) => void
}

const PAGE_TYPES = [
    'HOMEPAGE', 'PROCEDURE', 'RESOURCE', 'ABOUT', 'CONTACT',
    'LOCATION', 'TEAM_MEMBER', 'GALLERY', 'CONDITION', 'GENERIC'
]

export function PageEditSheet({ page, open, onOpenChange }: PageEditSheetProps) {
    const queryClient = useQueryClient()

    // Form state
    const [formData, setFormData] = useState({
        title: '',
        page_type: '',
        meta_description: '',
        h1: '',
        content_summary: ''
    })

    // Update form when page changes
    useEffect(() => {
        if (page) {
            setFormData({
                title: page.title || '',
                page_type: page.page_type || '',
                meta_description: page.meta_description || '',
                h1: page.h1 || '',
                content_summary: page.content_summary || ''
            })
        }
    }, [page])

    // Mutation to update page
    const updateMutation = useMutation({
        mutationFn: async (data: typeof formData) => {
            if (!page) throw new Error('No page selected')

            const { error } = await supabase
                .from('page_index')
                .update({
                    title: data.title || null,
                    page_type: data.page_type || null,
                    meta_description: data.meta_description || null,
                    h1: data.h1 || null,
                    content_summary: data.content_summary || null,
                    updated_at: new Date().toISOString()
                })
                .eq('id', page.id)

            if (error) throw error
        },
        onSuccess: () => {
            toast.success('Page updated successfully')
            queryClient.invalidateQueries({ queryKey: ['pages'] })
            onOpenChange(false)
        },
        onError: (error) => {
            toast.error(`Failed to update page: ${error.message}`)
        }
    })

    const handleSave = () => {
        updateMutation.mutate(formData)
    }

    const handleChange = (field: keyof typeof formData, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }))
    }

    if (!page) return null

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-[500px] sm:max-w-[500px] overflow-y-auto">
                <SheetHeader>
                    <SheetTitle>Edit Page</SheetTitle>
                    <SheetDescription className="flex items-center gap-2">
                        <a
                            href={page.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline flex items-center gap-1 truncate max-w-[350px]"
                        >
                            {page.path || page.url}
                            <ExternalLink className="h-3 w-3 flex-shrink-0" />
                        </a>
                    </SheetDescription>
                </SheetHeader>

                <div className="grid gap-4 py-6">
                    {/* Title */}
                    <div className="grid gap-2">
                        <Label htmlFor="title">Page Title</Label>
                        <Input
                            id="title"
                            value={formData.title}
                            onChange={(e) => handleChange('title', e.target.value)}
                            placeholder="Enter page title..."
                        />
                    </div>

                    {/* Page Type */}
                    <div className="grid gap-2">
                        <Label htmlFor="page_type">Page Type</Label>
                        <Select
                            value={formData.page_type}
                            onValueChange={(value) => handleChange('page_type', value)}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select type..." />
                            </SelectTrigger>
                            <SelectContent>
                                {PAGE_TYPES.map((type) => (
                                    <SelectItem key={type} value={type}>
                                        {type}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* H1 */}
                    <div className="grid gap-2">
                        <Label htmlFor="h1">H1 Heading</Label>
                        <Input
                            id="h1"
                            value={formData.h1}
                            onChange={(e) => handleChange('h1', e.target.value)}
                            placeholder="Main heading..."
                        />
                    </div>

                    {/* Meta Description */}
                    <div className="grid gap-2">
                        <Label htmlFor="meta_description">Meta Description</Label>
                        <Textarea
                            id="meta_description"
                            value={formData.meta_description}
                            onChange={(e) => handleChange('meta_description', e.target.value)}
                            placeholder="Page meta description..."
                            rows={3}
                        />
                    </div>

                    {/* Content Summary */}
                    <div className="grid gap-2">
                        <Label htmlFor="content_summary">Content Summary</Label>
                        <Textarea
                            id="content_summary"
                            value={formData.content_summary}
                            onChange={(e) => handleChange('content_summary', e.target.value)}
                            placeholder="Brief summary of page content..."
                            rows={4}
                        />
                    </div>

                    {/* Read-only info */}
                    <div className="grid gap-2 pt-2 border-t">
                        <Label className="text-muted-foreground text-xs">Status Code</Label>
                        <p className="text-sm">{page.status_code || 'N/A'}</p>
                    </div>
                </div>

                <SheetFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSave}
                        disabled={updateMutation.isPending}
                    >
                        {updateMutation.isPending && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        Save Changes
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    )
}
