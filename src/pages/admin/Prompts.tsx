import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog"
import { DataTable, type ColumnDef } from "@/components/DataTable"
import { Save, Loader2, MessageSquare, HelpCircle, Edit2, Copy, Check } from "lucide-react"
import { toast } from "sonner"
import { ModelSelector } from "@/components/ModelSelector"

interface Prompt {
    id: string
    name: string
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
            user_prompt_template: string | null,
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
            user_prompt_template: editForm.user_prompt_template || null,
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

    // Table columns
    const columns: ColumnDef<Prompt>[] = [
        {
            accessorKey: 'name',
            header: 'Prompt Name',
            cell: ({ row }) => (
                <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    <div>
                        <div className="font-medium">{row.original.name}</div>
                        {row.original.description && (
                            <div className="text-xs text-muted-foreground truncate max-w-xs">
                                {row.original.description}
                            </div>
                        )}
                    </div>
                </div>
            ),
            size: 300
        },
        {
            accessorKey: 'default_model',
            header: 'Default Model',
            cell: ({ row }) => (
                <span className="text-xs font-mono bg-muted px-2 py-1 rounded">
                    {row.original.default_model || 'gpt-4o'}
                </span>
            ),
            size: 120
        },
        {
            accessorKey: 'system_prompt',
            header: 'System Prompt',
            cell: ({ row }) => (
                <div className="flex items-center gap-2 max-w-md">
                    <span className="text-xs text-muted-foreground truncate">
                        {row.original.system_prompt.substring(0, 80)}...
                    </span>
                    <CopyButton text={row.original.system_prompt} />
                </div>
            ),
            size: 300
        },
        {
            accessorKey: 'user_prompt_template',
            header: 'User Template',
            cell: ({ row }) => (
                <span className={`text-xs ${row.original.user_prompt_template ? 'text-green-600' : 'text-muted-foreground'}`}>
                    {row.original.user_prompt_template ? '✓ Set' : '—'}
                </span>
            ),
            size: 100
        },
        {
            accessorKey: 'updated_at',
            header: 'Updated',
            cell: ({ row }) => (
                <span className="text-xs text-muted-foreground">
                    {formatDate(row.original.updated_at)}
                </span>
            ),
            size: 100
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
                <Dialog>
                    <Button variant="outline" size="sm" className="gap-2" asChild>
                        <label>
                            <HelpCircle className="h-4 w-4" />
                            How to choose a model
                        </label>
                    </Button>
                </Dialog>
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
                        </div>

                        {/* User Prompt Template */}
                        <div className="space-y-2">
                            <Label>User Prompt Template (optional)</Label>
                            <p className="text-xs text-muted-foreground">
                                Use {`{{variable}}`} placeholders for dynamic content (e.g., {`{{title}}`}, {`{{content}}`}, {`{{pageUrl}}`})
                            </p>
                            <Textarea
                                value={editForm.user_prompt_template}
                                onChange={(e) => setEditForm(prev => ({ ...prev, user_prompt_template: e.target.value }))}
                                className="min-h-[150px] font-mono text-sm"
                                placeholder="Enter the user prompt template with {{variables}}..."
                            />
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
