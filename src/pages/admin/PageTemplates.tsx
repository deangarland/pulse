import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { DataTable, type ColumnDef } from "@/components/DataTable"
import { Save, Loader2, FileText, Edit2, LayoutTemplate, CheckCircle2, Zap } from "lucide-react"
import { toast } from "sonner"

interface PageSection {
    id: string
    name: string
    required: boolean
    description: string
    example_elements?: string[]
}

interface Prompt {
    id: string
    name: string
    prompt_type: string
    description: string | null
}

interface PageContentTemplate {
    id: string
    page_type: string
    name: string
    description: string | null
    sections: PageSection[]
    enhancement_prompt_id: string | null
    enhancement_guidance: string | null
    updated_at: string
}

export default function PageTemplates() {
    const queryClient = useQueryClient()
    const [editingTemplate, setEditingTemplate] = useState<PageContentTemplate | null>(null)
    const [editForm, setEditForm] = useState({
        sections: [] as PageSection[],
        enhancement_prompt_id: "" as string,
        enhancement_guidance: "" as string
    })

    // Fetch templates
    const { data: templates, isLoading } = useQuery({
        queryKey: ['page-content-templates'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('page_content_templates')
                .select('*')
                .order('page_type')

            if (error) throw error
            return data as PageContentTemplate[]
        }
    })

    // Fetch available prompts for dropdown
    const { data: prompts } = useQuery({
        queryKey: ['prompts-list'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('prompts')
                .select('id, name, prompt_type, description')
                .order('name')

            if (error) throw error
            return data as Prompt[]
        }
    })

    // Update template mutation
    const updateMutation = useMutation({
        mutationFn: async ({ id, sections, enhancement_prompt_id, enhancement_guidance }: {
            id: string,
            sections: PageSection[],
            enhancement_prompt_id: string | null,
            enhancement_guidance: string | null
        }) => {
            const { error } = await supabase
                .from('page_content_templates')
                .update({
                    sections,
                    enhancement_prompt_id: enhancement_prompt_id || null,
                    enhancement_guidance: enhancement_guidance || null,
                    updated_at: new Date().toISOString()
                })
                .eq('id', id)

            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['page-content-templates'] })
            toast.success('Page type saved successfully')
            setEditingTemplate(null)
        },
        onError: (error) => {
            toast.error(`Failed to save: ${error.message}`)
        }
    })

    const openEditModal = (template: PageContentTemplate) => {
        setEditingTemplate(template)
        setEditForm({
            sections: template.sections || [],
            enhancement_prompt_id: template.enhancement_prompt_id || "",
            enhancement_guidance: template.enhancement_guidance || ""
        })
    }

    const closeEditModal = () => {
        setEditingTemplate(null)
    }

    const saveTemplate = () => {
        if (!editingTemplate) return
        updateMutation.mutate({
            id: editingTemplate.id,
            sections: editForm.sections,
            enhancement_prompt_id: editForm.enhancement_prompt_id || null,
            enhancement_guidance: editForm.enhancement_guidance || null
        })
    }

    const toggleSectionRequired = (sectionId: string) => {
        setEditForm(prev => ({
            ...prev,
            sections: prev.sections.map(s =>
                s.id === sectionId ? { ...s, required: !s.required } : s
            )
        }))
    }

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString()
    }

    // Get prompt name by ID
    const getPromptName = (promptId: string | null) => {
        if (!promptId || !prompts) return null
        const prompt = prompts.find(p => p.id === promptId)
        return prompt?.name || null
    }

    // Table columns
    const columns: ColumnDef[] = [
        {
            key: 'page_type',
            label: 'Page Type',
            defaultWidth: 150,
            render: (value: string) => (
                <Badge variant="outline" className="font-mono">
                    {value}
                </Badge>
            )
        },
        {
            key: 'name',
            label: 'Name',
            defaultWidth: 200,
            render: (_value: string, row: PageContentTemplate) => (
                <div className="flex items-center gap-2">
                    <LayoutTemplate className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0">
                        <div className="font-medium truncate">{row.name}</div>
                        {row.description && (
                            <div className="text-xs text-muted-foreground truncate">
                                {row.description}
                            </div>
                        )}
                    </div>
                </div>
            )
        },
        {
            key: 'sections',
            label: 'Sections',
            defaultWidth: 250,
            render: (value: PageSection[]) => (
                <div className="flex flex-wrap gap-1">
                    {value.slice(0, 4).map((section) => (
                        <Badge
                            key={section.id}
                            variant={section.required ? "default" : "secondary"}
                            className="text-xs"
                        >
                            {section.name}
                        </Badge>
                    ))}
                    {value.length > 4 && (
                        <Badge variant="outline" className="text-xs">
                            +{value.length - 4} more
                        </Badge>
                    )}
                </div>
            )
        },
        {
            key: 'enhancement_prompt_id',
            label: 'Prompt',
            defaultWidth: 160,
            render: (value: string | null) => {
                const name = getPromptName(value)
                return name ? (
                    <Badge variant="secondary" className="text-xs gap-1">
                        <Zap className="h-3 w-3" />
                        {name}
                    </Badge>
                ) : (
                    <span className="text-xs text-muted-foreground italic">None linked</span>
                )
            }
        },
        {
            key: 'updated_at',
            label: 'Updated',
            defaultWidth: 100,
            render: (value: string) => (
                <span className="text-xs text-muted-foreground">
                    {formatDate(value)}
                </span>
            )
        }
    ]

    // Row actions
    const rowActions = (row: PageContentTemplate) => (
        <Button
            variant="ghost"
            size="sm"
            onClick={() => openEditModal(row)}
        >
            <Edit2 className="h-4 w-4 mr-1" />
            Edit
        </Button>
    )

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Page Types</h1>
                    <p className="text-muted-foreground">
                        Define content sections, enhancement prompts, and SEO guidance for each page type.
                    </p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                        <FileText className="h-5 w-5" />
                        Page Types ({templates?.length || 0})
                    </CardTitle>
                    <CardDescription>
                        Each page type defines the expected sections, linked AI prompt, and page-specific SEO guidance.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <DataTable
                        columns={columns}
                        data={templates || []}
                        loading={isLoading}
                        storageKey="page_templates_table"
                        rowActions={rowActions}
                        emptyMessage="No page types found. Run database migrations to create defaults."
                    />
                </CardContent>
            </Card>

            {/* Edit Modal */}
            <Dialog open={!!editingTemplate} onOpenChange={(open) => !open && closeEditModal()}>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <LayoutTemplate className="h-5 w-5" />
                            Edit: {editingTemplate?.name}
                            <Badge variant="outline" className="font-mono ml-2">
                                {editingTemplate?.page_type}
                            </Badge>
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-6 py-4">
                        {/* Description (read-only) */}
                        {editingTemplate?.description && (
                            <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
                                {editingTemplate.description}
                            </div>
                        )}

                        {/* Enhancement Prompt Dropdown */}
                        <div className="space-y-2">
                            <Label className="text-base font-semibold flex items-center gap-2">
                                <Zap className="h-4 w-4" />
                                Enhancement Prompt
                            </Label>
                            <p className="text-sm text-muted-foreground">
                                Select which prompt from the Prompts library to use when enhancing pages of this type.
                            </p>
                            <Select
                                value={editForm.enhancement_prompt_id}
                                onValueChange={(value) => setEditForm(prev => ({ ...prev, enhancement_prompt_id: value }))}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select a prompt..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {prompts?.map((prompt) => (
                                        <SelectItem key={prompt.id} value={prompt.id}>
                                            <div className="flex flex-col">
                                                <span>{prompt.name}</span>
                                                <span className="text-xs text-muted-foreground">{prompt.prompt_type}</span>
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Enhancement Guidance */}
                        <div className="space-y-2">
                            <Label className="text-base font-semibold">Enhancement Guidance</Label>
                            <p className="text-sm text-muted-foreground">
                                Page-type-specific SEO strategy injected into the prompt as <code className="text-xs bg-muted px-1 py-0.5 rounded">{'{{enhancement_guidance}}'}</code>.
                                Focus on what makes this page type unique — don't repeat universal rules.
                            </p>
                            <Textarea
                                value={editForm.enhancement_guidance}
                                onChange={(e) => setEditForm(prev => ({ ...prev, enhancement_guidance: e.target.value }))}
                                className="min-h-[160px] font-mono text-sm"
                                placeholder="Page-type-specific SEO priorities, keyword strategy, and formatting guidance..."
                            />
                        </div>

                        {/* Sections */}
                        <div className="space-y-4">
                            <Label className="text-base font-semibold">Expected Sections</Label>
                            <p className="text-sm text-muted-foreground">
                                Toggle required/optional status for each section. Required sections will be flagged if missing.
                            </p>
                            <div className="grid gap-3">
                                {editForm.sections.map((section) => (
                                    <div
                                        key={section.id}
                                        className="flex items-start gap-3 p-3 border rounded-lg bg-muted/30"
                                    >
                                        <button
                                            type="button"
                                            onClick={() => toggleSectionRequired(section.id)}
                                            className={`mt-0.5 flex-shrink-0 p-1 rounded-full transition-colors ${section.required
                                                ? 'bg-green-100 text-green-600'
                                                : 'bg-gray-100 text-gray-400'
                                                }`}
                                        >
                                            <CheckCircle2 className="h-4 w-4" />
                                        </button>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium">{section.name}</span>
                                                <Badge variant={section.required ? "default" : "secondary"} className="text-xs">
                                                    {section.required ? "Required" : "Optional"}
                                                </Badge>
                                            </div>
                                            <p className="text-sm text-muted-foreground mt-1">
                                                {section.description}
                                            </p>
                                            {section.example_elements && section.example_elements.length > 0 && (
                                                <div className="flex flex-wrap gap-1 mt-2">
                                                    {section.example_elements.map((el, i) => (
                                                        <Badge key={i} variant="outline" className="text-xs font-mono">
                                                            {el}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={closeEditModal} disabled={updateMutation.isPending}>
                            Cancel
                        </Button>
                        <Button onClick={saveTemplate} disabled={updateMutation.isPending}>
                            {updateMutation.isPending ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Saving...
                                </>
                            ) : (
                                <>
                                    <Save className="h-4 w-4 mr-2" />
                                    Save Changes
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
