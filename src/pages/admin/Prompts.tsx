import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog"
import { DataTable, type ColumnDef } from "@/components/DataTable"
import { Save, Loader2, MessageSquare, Edit2, Copy, Check } from "lucide-react"
import { toast } from "sonner"
import { ModelSelector } from "@/components/ModelSelector"

interface Prompt {
    id: string
    name: string
    prompt_type: string | null
    description: string | null
    system_prompt: string
    user_prompt_template: string | null
    default_model: string | null
    updated_at: string
}

export default function Prompts() {
    const queryClient = useQueryClient()
    const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null)
    const [editForm, setEditForm] = useState({
        system_prompt: "",
        user_prompt_template: "",
        default_model: "gpt-4o-mini"
    })

    // Fetch prompts
    const { data: prompts, isLoading } = useQuery({
        queryKey: ['prompts'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('prompts')
                .select('*')
                .order('name')

            if (error) throw error
            return data as Prompt[]
        }
    })

    // Update prompt mutation
    const updateMutation = useMutation({
        mutationFn: async ({ id, system_prompt, user_prompt_template, default_model }: {
            id: string,
            system_prompt: string,
            user_prompt_template: string,
            default_model: string
        }) => {
            const { error } = await supabase
                .from('prompts')
                .update({
                    system_prompt,
                    user_prompt_template: user_prompt_template || null,
                    default_model,
                    updated_at: new Date().toISOString()
                })
                .eq('id', id)

            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['prompts'] })
            toast.success('Prompt saved successfully')
            setEditingPrompt(null)
        },
        onError: (error) => {
            toast.error(`Failed to save: ${error.message}`)
        }
    })

    const openEditModal = (prompt: Prompt) => {
        setEditingPrompt(prompt)
        setEditForm({
            system_prompt: prompt.system_prompt,
            user_prompt_template: prompt.user_prompt_template || "",
            default_model: prompt.default_model || "gpt-4o-mini"
        })
    }

    const closeEditModal = () => {
        setEditingPrompt(null)
    }

    const savePrompt = () => {
        if (!editingPrompt) return
        updateMutation.mutate({
            id: editingPrompt.id,
            system_prompt: editForm.system_prompt,
            user_prompt_template: editForm.user_prompt_template,
            default_model: editForm.default_model
        })
    }

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString()
    }

    // Copy prompt to clipboard
    const CopyButton = ({ text }: { text: string }) => {
        const [copied, setCopied] = useState(false)
        const handleCopy = async () => {
            await navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        }
        return (
            <button onClick={handleCopy} className="p-1 hover:bg-muted rounded">
                {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
            </button>
        )
    }

    // Table columns using DataTable's ColumnDef format
    const columns: ColumnDef[] = [
        {
            key: 'name',
            label: 'Prompt Name',
            defaultWidth: 300,
            render: (_value: string, row: Prompt) => (
                <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-muted-foreground flex-shrink-0" />
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
            key: 'prompt_type',
            label: 'Type ID',
            defaultWidth: 160,
            render: (value: string | null) => (
                <span className="text-xs font-mono bg-blue-50 text-blue-700 px-2 py-1 rounded">
                    {value || 'unset'}
                </span>
            )
        },
        {
            key: 'default_model',
            label: 'Default Model',
            defaultWidth: 130,
            render: (value: string | null) => (
                <span className="text-xs font-mono bg-muted px-2 py-1 rounded">
                    {value || 'gpt-4o'}
                </span>
            )
        },
        {
            key: 'system_prompt',
            label: 'System Prompt',
            defaultWidth: 300,
            render: (value: string, row: Prompt) => (
                <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground truncate">
                        {value.substring(0, 80)}...
                    </span>
                    <CopyButton text={row.system_prompt} />
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
    const rowActions = (row: Prompt) => (
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
                    <h1 className="text-2xl font-bold tracking-tight">AI Prompts</h1>
                    <p className="text-muted-foreground">
                        Manage system prompts and default AI models for content generation
                    </p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                        <MessageSquare className="h-5 w-5" />
                        All Prompts ({prompts?.length || 0})
                    </CardTitle>
                    <CardDescription>
                        Click Edit to modify system prompts, user templates, and default models
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <DataTable
                        columns={columns}
                        data={prompts || []}
                        loading={isLoading}
                        storageKey="prompts_table"
                        rowActions={rowActions}
                        emptyMessage="No prompts found. Run database migrations to create default prompts."
                    />
                </CardContent>
            </Card>

            {/* Edit Modal */}
            <Dialog open={!!editingPrompt} onOpenChange={(open) => !open && closeEditModal()}>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <MessageSquare className="h-5 w-5" />
                            Edit: {editingPrompt?.name}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-6 py-4">
                        {/* Description (read-only) */}
                        {editingPrompt?.description && (
                            <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
                                {editingPrompt.description}
                            </div>
                        )}

                        {/* Default Model */}
                        <div className="space-y-2">
                            <Label>Default Model</Label>
                            <ModelSelector
                                value={editForm.default_model}
                                onChange={(model) => setEditForm(prev => ({ ...prev, default_model: model }))}
                            />
                        </div>

                        {/* System Prompt */}
                        <div className="space-y-2">
                            <Label>System Prompt</Label>
                            <Textarea
                                value={editForm.system_prompt}
                                onChange={(e) => setEditForm(prev => ({ ...prev, system_prompt: e.target.value }))}
                                className="min-h-[200px] font-mono text-sm"
                                placeholder="Enter the system prompt..."
                            />
                            <p className="text-xs text-muted-foreground">
                                The system prompt sets the AI's role and behavior rules.
                            </p>
                        </div>

                        {/* User Prompt Template */}
                        <div className="space-y-2">
                            <Label>User Prompt Template <span className="text-muted-foreground font-normal">(optional)</span></Label>
                            <Textarea
                                value={editForm.user_prompt_template}
                                onChange={(e) => setEditForm(prev => ({ ...prev, user_prompt_template: e.target.value }))}
                                className="min-h-[150px] font-mono text-sm"
                                placeholder="Enter the user prompt template with {{placeholders}}..."
                            />
                            <p className="text-xs text-muted-foreground">
                                Use {`{{variable}}`} placeholders for dynamic content (e.g., {`{{page_title}}`}, {`{{section_name}}`}, {`{{original_content}}`}).
                                This template is filled in with actual data at runtime.
                            </p>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={closeEditModal} disabled={updateMutation.isPending}>
                            Cancel
                        </Button>
                        <Button onClick={savePrompt} disabled={updateMutation.isPending}>
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
