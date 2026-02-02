import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Save, Edit2, X, Loader2, MessageSquare } from "lucide-react"
import { toast } from "sonner"
import { ModelSelector } from "@/components/ModelSelector"

interface Prompt {
    id: string
    name: string
    description: string
    system_prompt: string
    default_model: string
    updated_at: string
}

export default function Prompts() {
    const queryClient = useQueryClient()
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editedPrompt, setEditedPrompt] = useState("")

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

    // Update prompt text mutation
    const updateMutation = useMutation({
        mutationFn: async ({ id, system_prompt }: { id: string, system_prompt: string }) => {
            const { error } = await supabase
                .from('prompts')
                .update({
                    system_prompt,
                    updated_at: new Date().toISOString()
                })
                .eq('id', id)

            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['prompts'] })
            toast.success('Prompt saved successfully')
            setEditingId(null)
            setEditedPrompt("")
        },
        onError: (error) => {
            toast.error(`Failed to save: ${error.message}`)
        }
    })

    // Update model mutation (separate for quick model changes)
    const updateModelMutation = useMutation({
        mutationFn: async ({ id, default_model }: { id: string, default_model: string }) => {
            const { error } = await supabase
                .from('prompts')
                .update({
                    default_model,
                    updated_at: new Date().toISOString()
                })
                .eq('id', id)

            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['prompts'] })
            toast.success('Default model updated')
        },
        onError: (error) => {
            toast.error(`Failed to update model: ${error.message}`)
        }
    })

    const startEditing = (prompt: Prompt) => {
        setEditingId(prompt.id)
        setEditedPrompt(prompt.system_prompt)
    }

    const cancelEditing = () => {
        setEditingId(null)
        setEditedPrompt("")
    }

    const savePrompt = (id: string) => {
        updateMutation.mutate({ id, system_prompt: editedPrompt })
    }

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleString()
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">AI Prompts</h1>
                <p className="text-muted-foreground">
                    Manage system prompts and default AI models for content generation
                </p>
            </div>

            {prompts?.length === 0 && (
                <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                        <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>No prompts found. Run the database migration to create default prompts.</p>
                    </CardContent>
                </Card>
            )}

            {prompts?.map((prompt) => (
                <Card key={prompt.id}>
                    <CardHeader>
                        <div className="flex items-start justify-between">
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                    <MessageSquare className="h-5 w-5" />
                                    {prompt.name}
                                </CardTitle>
                                <CardDescription className="mt-1">
                                    {prompt.description}
                                </CardDescription>
                                <div className="mt-2 flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground">Default Model:</span>
                                    <ModelSelector
                                        value={prompt.default_model || 'gpt-4o'}
                                        onChange={(model) => updateModelMutation.mutate({ id: prompt.id, default_model: model })}
                                        disabled={updateModelMutation.isPending}
                                    />
                                </div>
                            </div>
                            <div className="flex gap-2">
                                {editingId === prompt.id ? (
                                    <>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={cancelEditing}
                                            disabled={updateMutation.isPending}
                                        >
                                            <X className="h-4 w-4 mr-1" />
                                            Cancel
                                        </Button>
                                        <Button
                                            size="sm"
                                            onClick={() => savePrompt(prompt.id)}
                                            disabled={updateMutation.isPending}
                                        >
                                            {updateMutation.isPending ? (
                                                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                            ) : (
                                                <Save className="h-4 w-4 mr-1" />
                                            )}
                                            Save
                                        </Button>
                                    </>
                                ) : (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => startEditing(prompt)}
                                    >
                                        <Edit2 className="h-4 w-4 mr-1" />
                                        Edit
                                    </Button>
                                )}
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {editingId === prompt.id ? (
                            <Textarea
                                value={editedPrompt}
                                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEditedPrompt(e.target.value)}
                                className="min-h-[300px] font-mono text-sm"
                                placeholder="Enter your system prompt..."
                            />
                        ) : (
                            <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm whitespace-pre-wrap">
                                {prompt.system_prompt}
                            </div>
                        )}
                        <p className="text-xs text-muted-foreground mt-3">
                            Last updated: {formatDate(prompt.updated_at)}
                        </p>
                    </CardContent>
                </Card>
            ))}
        </div>
    )
}
