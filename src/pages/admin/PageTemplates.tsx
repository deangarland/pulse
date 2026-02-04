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
import { DataTable, type ColumnDef } from "@/components/DataTable"
import { Save, Loader2, FileText, Edit2, LayoutTemplate, CheckCircle2 } from "lucide-react"
import { toast } from "sonner"

interface PageSection {
    id: string
    name: string
    required: boolean
    description: string
    example_elements?: string[]
}

interface PageContentTemplate {
    id: string
    page_type: string
    name: string
    description: string | null
    sections: PageSection[]
    section_analysis_prompt: string | null
    rewrite_prompt: string | null
    updated_at: string
}

export default function PageTemplates() {
    const queryClient = useQueryClient()
    const [editingTemplate, setEditingTemplate] = useState<PageContentTemplate | null>(null)
    const [editForm, setEditForm] = useState({
        sections: [] as PageSection[],
        section_analysis_prompt: "",
        rewrite_prompt: ""
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

    // Update template mutation
    const updateMutation = useMutation({
        mutationFn: async ({ id, sections, section_analysis_prompt, rewrite_prompt }: {
            id: string,
            sections: PageSection[],
            section_analysis_prompt: string,
            rewrite_prompt: string
        }) => {
            const { error } = await supabase
                .from('page_content_templates')
                .update({
                    sections,
                    section_analysis_prompt,
                    rewrite_prompt,
                    updated_at: new Date().toISOString()
                })
                .eq('id', id)

            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['page-content-templates'] })
            toast.success('Template saved successfully')
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
            section_analysis_prompt: template.section_analysis_prompt || "",
            rewrite_prompt: template.rewrite_prompt || ""
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
            section_analysis_prompt: editForm.section_analysis_prompt,
            rewrite_prompt: editForm.rewrite_prompt
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
            label: 'Template Name',
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
                    <h1 className="text-2xl font-bold tracking-tight">Page Templates</h1>
                    <p className="text-muted-foreground">
                        Define expected content sections for each page type. Used by AI to analyze and enhance page content.
                    </p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                        <FileText className="h-5 w-5" />
                        Content Templates ({templates?.length || 0})
                    </CardTitle>
                    <CardDescription>
                        Each template defines the sections that should exist on a page type (e.g., Hero, Benefits, FAQ, CTA)
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <DataTable
                        columns={columns}
                        data={templates || []}
                        loading={isLoading}
                        storageKey="page_templates_table"
                        rowActions={rowActions}
                        emptyMessage="No templates found. Run database migrations to create default templates."
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
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-6 py-4">
                        {/* Description (read-only) */}
                        {editingTemplate?.description && (
                            <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
                                {editingTemplate.description}
                            </div>
                        )}

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

                        {/* Section Analysis Prompt */}
                        <div className="space-y-2">
                            <Label>Section Analysis Prompt</Label>
                            <Textarea
                                value={editForm.section_analysis_prompt}
                                onChange={(e) => setEditForm(prev => ({ ...prev, section_analysis_prompt: e.target.value }))}
                                className="min-h-[100px] font-mono text-sm"
                                placeholder="Prompt for AI to identify sections in existing content..."
                            />
                            <p className="text-xs text-muted-foreground">
                                This prompt tells the AI how to identify each section in the page's existing content.
                            </p>
                        </div>

                        {/* Rewrite Prompt */}
                        <div className="space-y-2">
                            <Label>Rewrite Prompt</Label>
                            <Textarea
                                value={editForm.rewrite_prompt}
                                onChange={(e) => setEditForm(prev => ({ ...prev, rewrite_prompt: e.target.value }))}
                                className="min-h-[100px] font-mono text-sm"
                                placeholder="Prompt for AI to rewrite individual sections..."
                            />
                            <p className="text-xs text-muted-foreground">
                                This prompt guides the AI when rewriting section content for enhancement.
                            </p>
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
