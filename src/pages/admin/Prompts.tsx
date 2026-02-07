import { useState, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { DataTable, type ColumnDef } from "@/components/DataTable"
import { Save, Loader2, MessageSquare, Edit2, Copy, Check, Search, Tags, X, Plus, Trash2 } from "lucide-react"
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

interface PromptType {
    id: string
    name: string
    label: string
    description: string | null
}

export default function Prompts() {
    const queryClient = useQueryClient()
    const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null)
    const [editForm, setEditForm] = useState({
        system_prompt: "",
        user_prompt_template: "",
        default_model: "gpt-4o-mini"
    })
    const [searchQuery, setSearchQuery] = useState("")
    const [filterType, setFilterType] = useState<string>("all")
    const [typesManagerOpen, setTypesManagerOpen] = useState(false)
    const [newTypeName, setNewTypeName] = useState("")
    const [newTypeLabel, setNewTypeLabel] = useState("")

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

    // Fetch prompt types
    const { data: promptTypes } = useQuery({
        queryKey: ['prompt-types'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('prompt_types')
                .select('*')
                .order('label')

            if (error) throw error
            return data as PromptType[]
        }
    })

    // Derive unique types from prompts (for filter dropdown, includes types not in prompt_types table yet)
    const allTypes = useMemo(() => {
        if (!prompts) return []
        const typeSet = new Set<string>()
        prompts.forEach(p => {
            if (p.prompt_type) typeSet.add(p.prompt_type)
        })
        return Array.from(typeSet).sort()
    }, [prompts])

    // Filter + search prompts
    const filteredPrompts = useMemo(() => {
        if (!prompts) return []
        return prompts.filter(p => {
            // Type filter
            if (filterType !== "all" && p.prompt_type !== filterType) return false
            // Search filter
            if (searchQuery) {
                const q = searchQuery.toLowerCase()
                return (
                    p.name.toLowerCase().includes(q) ||
                    (p.description || "").toLowerCase().includes(q) ||
                    (p.prompt_type || "").toLowerCase().includes(q) ||
                    p.system_prompt.toLowerCase().includes(q)
                )
            }
            return true
        })
    }, [prompts, filterType, searchQuery])

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

    // Add prompt type mutation
    const addTypeMutation = useMutation({
        mutationFn: async ({ name, label }: { name: string, label: string }) => {
            const { error } = await supabase
                .from('prompt_types')
                .insert({ name, label })

            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['prompt-types'] })
            setNewTypeName("")
            setNewTypeLabel("")
            toast.success('Prompt type added')
        },
        onError: (error) => {
            toast.error(`Failed to add type: ${error.message}`)
        }
    })

    // Delete prompt type mutation
    const deleteTypeMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase
                .from('prompt_types')
                .delete()
                .eq('id', id)

            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['prompt-types'] })
            toast.success('Prompt type removed')
        },
        onError: (error) => {
            toast.error(`Failed to remove type: ${error.message}`)
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

    // Get label for a prompt type
    const getTypeLabel = (typeName: string | null) => {
        if (!typeName) return null
        const pt = promptTypes?.find(t => t.name === typeName)
        return pt?.label || typeName
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

    const addNewType = () => {
        if (!newTypeName.trim()) return
        addTypeMutation.mutate({
            name: newTypeName.trim().toLowerCase().replace(/\s+/g, '_'),
            label: newTypeLabel.trim() || newTypeName.trim()
        })
    }

    // Table columns
    const columns: ColumnDef[] = [
        {
            key: 'name',
            label: 'Prompt Name',
            defaultWidth: 280,
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
            label: 'Type',
            defaultWidth: 160,
            render: (value: string | null) => {
                const label = getTypeLabel(value)
                return label ? (
                    <Badge variant="secondary" className="text-xs font-mono">
                        {label}
                    </Badge>
                ) : (
                    <span className="text-xs text-muted-foreground italic">unset</span>
                )
            }
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
                    <h1 className="text-2xl font-bold tracking-tight">Prompt Library</h1>
                    <p className="text-muted-foreground">
                        Manage system prompts, user templates, and default AI models for all workflows.
                    </p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-base flex items-center gap-2">
                                <MessageSquare className="h-5 w-5" />
                                All Prompts ({filteredPrompts.length}{filteredPrompts.length !== prompts?.length ? ` of ${prompts?.length}` : ''})
                            </CardTitle>
                            <CardDescription>
                                Click Edit to modify system prompts, user templates, and default models.
                            </CardDescription>
                        </div>

                        {/* Types Manager Button */}
                        <Popover open={typesManagerOpen} onOpenChange={setTypesManagerOpen}>
                            <PopoverTrigger asChild>
                                <Button variant="outline" size="sm" className="gap-1.5">
                                    <Tags className="h-4 w-4" />
                                    Manage Types
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-80" align="end">
                                <div className="space-y-4">
                                    <div>
                                        <h4 className="font-semibold text-sm">Prompt Types</h4>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Organize prompts into types for filtering.
                                        </p>
                                    </div>

                                    {/* Existing types */}
                                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                        {promptTypes?.map(pt => {
                                            const count = prompts?.filter(p => p.prompt_type === pt.name).length || 0
                                            return (
                                                <div key={pt.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50 group">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <Badge variant="secondary" className="text-xs font-mono shrink-0">
                                                            {pt.label}
                                                        </Badge>
                                                        <span className="text-xs text-muted-foreground">
                                                            {count} prompt{count !== 1 ? 's' : ''}
                                                        </span>
                                                    </div>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                                                        onClick={() => deleteTypeMutation.mutate(pt.id)}
                                                        disabled={count > 0}
                                                        title={count > 0 ? "Can't delete — prompts use this type" : "Delete type"}
                                                    >
                                                        <Trash2 className="h-3 w-3" />
                                                    </Button>
                                                </div>
                                            )
                                        })}
                                        {(!promptTypes || promptTypes.length === 0) && (
                                            <p className="text-xs text-muted-foreground text-center py-3">
                                                No types defined yet.
                                            </p>
                                        )}
                                    </div>

                                    {/* Add new type */}
                                    <div className="border-t pt-3 space-y-2">
                                        <div className="flex gap-2">
                                            <Input
                                                placeholder="Label (e.g. Enhancement)"
                                                value={newTypeLabel}
                                                onChange={e => {
                                                    setNewTypeLabel(e.target.value)
                                                    setNewTypeName(e.target.value.toLowerCase().replace(/\s+/g, '_'))
                                                }}
                                                className="h-8 text-sm"
                                                onKeyDown={e => e.key === 'Enter' && addNewType()}
                                            />
                                            <Button
                                                size="sm"
                                                className="h-8 shrink-0"
                                                onClick={addNewType}
                                                disabled={!newTypeLabel.trim() || addTypeMutation.isPending}
                                            >
                                                <Plus className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                        {newTypeName && (
                                            <p className="text-xs text-muted-foreground">
                                                Key: <code className="bg-muted px-1 py-0.5 rounded">{newTypeName}</code>
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </PopoverContent>
                        </Popover>
                    </div>
                </CardHeader>

                {/* Search + Filter Bar */}
                <div className="px-6 pb-4 flex items-center gap-3">
                    <div className="relative flex-1 max-w-sm">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search prompts..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 h-9"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery("")}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>
                    <Select value={filterType} onValueChange={setFilterType}>
                        <SelectTrigger className="w-[200px] h-9">
                            <SelectValue placeholder="All Types" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Types</SelectItem>
                            {allTypes.map(type => (
                                <SelectItem key={type} value={type}>
                                    {getTypeLabel(type)} ({prompts?.filter(p => p.prompt_type === type).length})
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {(searchQuery || filterType !== "all") && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setSearchQuery(""); setFilterType("all") }}
                            className="h-9 text-xs"
                        >
                            Clear filters
                        </Button>
                    )}
                </div>

                <CardContent>
                    <DataTable
                        columns={columns}
                        data={filteredPrompts}
                        loading={isLoading}
                        storageKey="prompts_table"
                        rowActions={rowActions}
                        emptyMessage={
                            searchQuery || filterType !== "all"
                                ? "No prompts match your filters."
                                : "No prompts found. Run database migrations to create default prompts."
                        }
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
                            {editingPrompt?.prompt_type && (
                                <Badge variant="secondary" className="font-mono ml-2">
                                    {getTypeLabel(editingPrompt.prompt_type)}
                                </Badge>
                            )}
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
