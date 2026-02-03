import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DataTable, type ColumnDef } from "@/components/DataTable"
import { toast } from "sonner"
import {
    Sparkles,
    Star,
    Play,
    Loader2,
    CheckCircle,
    XCircle,
    AlertCircle,
    Pencil,
    Save
} from "lucide-react"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog"

// Maps to schema_templates table
interface SchemaTemplate {
    id: string
    schema_type: string
    page_type: string | null
    tier: 'HIGH' | 'MEDIUM' | 'LOW'
    tier_reason: string | null
    required_fields: string[] | null
    data_sources: Record<string, unknown> | null
}

// Tier badge component
function TierBadge({ tier }: { tier: string }) {
    const variants: Record<string, { class: string; icon: React.ReactNode }> = {
        HIGH: { class: 'bg-green-100 text-green-800 border-green-200', icon: <CheckCircle className="h-3 w-3" /> },
        MEDIUM: { class: 'bg-yellow-100 text-yellow-800 border-yellow-200', icon: <AlertCircle className="h-3 w-3" /> },
        LOW: { class: 'bg-gray-100 text-gray-600 border-gray-200', icon: <XCircle className="h-3 w-3" /> },
    }
    const v = variants[tier] || variants.LOW
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${v.class}`}>
            {v.icon} {tier}
        </span>
    )
}

// Edit Modal Component
function SchemaEditModal({
    template,
    open,
    onOpenChange,
    onSave
}: {
    template: SchemaTemplate | null
    open: boolean
    onOpenChange: (open: boolean) => void
    onSave: (data: Partial<SchemaTemplate>) => void
}) {
    const [tier, setTier] = useState<'HIGH' | 'MEDIUM' | 'LOW'>('LOW')
    const [tierReason, setTierReason] = useState('')
    const [modifiedDataSources, setModifiedDataSources] = useState<Record<string, unknown> | null>(null)

    // Reset form when template changes
    useEffect(() => {
        if (template) {
            setTier(template.tier)
            setTierReason(template.tier_reason || '')
            setModifiedDataSources(template.data_sources ? { ...template.data_sources } : null)
        }
    }, [template])

    const toggleFieldRequired = (fieldName: string) => {
        if (!modifiedDataSources) return
        const fieldConfig = modifiedDataSources[fieldName] as Record<string, unknown>
        setModifiedDataSources({
            ...modifiedDataSources,
            [fieldName]: {
                ...fieldConfig,
                required: !fieldConfig.required
            }
        })
    }

    const handleSave = () => {
        onSave({
            tier,
            tier_reason: tierReason,
            data_sources: modifiedDataSources
        })
        onOpenChange(false)
    }

    if (!template) return null

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>Edit: {template.page_type}</DialogTitle>
                    <DialogDescription>
                        Schema type: {template.schema_type}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {/* Tier */}
                    <div className="space-y-2">
                        <Label>Priority Tier</Label>
                        <Select value={tier} onValueChange={(v) => setTier(v as typeof tier)}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="HIGH">HIGH - Auto-generate</SelectItem>
                                <SelectItem value="MEDIUM">MEDIUM - Manual trigger</SelectItem>
                                <SelectItem value="LOW">LOW - Skip</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Tier Reason */}
                    <div className="space-y-2">
                        <Label>Reason / Notes</Label>
                        <Textarea
                            value={tierReason}
                            onChange={(e) => setTierReason(e.target.value)}
                            placeholder="Why this tier assignment..."
                            rows={3}
                        />
                    </div>

                    {/* Schema Fields with descriptions */}
                    {modifiedDataSources && Object.keys(modifiedDataSources).length > 0 && (
                        <div className="space-y-2">
                            <Label>Schema Fields <span className="text-xs text-muted-foreground font-normal">(click badge to toggle required)</span></Label>
                            <div className="border rounded-md overflow-hidden max-h-64 overflow-y-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-muted/50 sticky top-0">
                                        <tr>
                                            <th className="text-left px-3 py-2 font-medium">Field</th>
                                            <th className="text-left px-3 py-2 font-medium w-20">Required</th>
                                            <th className="text-left px-3 py-2 font-medium">Source</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {Object.entries(modifiedDataSources as Record<string, {
                                            source?: string;
                                            required?: boolean;
                                            description?: string;
                                            table?: string;
                                            column?: string;
                                        }>).map(([field, config]) => (
                                            <tr key={field} className="hover:bg-muted/30">
                                                <td className="px-3 py-2">
                                                    <div className="flex flex-col">
                                                        <code className="text-xs bg-muted px-1 rounded w-fit">{field}</code>
                                                        <span className="text-xs text-muted-foreground">{config.description?.slice(0, 50)}{(config.description?.length || 0) > 50 ? '...' : ''}</span>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-2">
                                                    <button
                                                        onClick={() => toggleFieldRequired(field)}
                                                        className="transition-all"
                                                    >
                                                        {config.required ? (
                                                            <Badge variant="destructive" className="text-[10px] px-2 py-0.5 cursor-pointer hover:bg-red-700">req</Badge>
                                                        ) : (
                                                            <Badge variant="outline" className="text-[10px] px-2 py-0.5 cursor-pointer hover:bg-muted text-muted-foreground">opt</Badge>
                                                        )}
                                                    </button>
                                                </td>
                                                <td className="px-3 py-2">
                                                    <Badge
                                                        variant="outline"
                                                        className={`text-[10px] ${config.source === 'llm' ? 'bg-purple-50 border-purple-200 text-purple-700' :
                                                            config.source === 'site' ? 'bg-blue-50 border-blue-200 text-blue-700' :
                                                                config.source === 'location' ? 'bg-green-50 border-green-200 text-green-700' :
                                                                    'bg-gray-50 border-gray-200 text-gray-700'
                                                            }`}
                                                    >
                                                        {config.source === 'llm' ? '🤖 AI' :
                                                            config.source === 'site' ? '🏢 Site' :
                                                                config.source === 'location' ? '📍 Loc' :
                                                                    config.source === 'page' ? '📄 Page' : config.source}
                                                    </Badge>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave}>
                        <Save className="h-4 w-4 mr-2" />
                        Save Changes
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// Schema table columns
const schemaColumns: ColumnDef[] = [
    { key: 'page_type', label: 'Page Type', defaultVisible: true, defaultWidth: 140 },
    { key: 'schema_type', label: 'Schema Type', defaultVisible: true, defaultWidth: 160 },
    {
        key: 'tier', label: 'Tier', defaultVisible: true, defaultWidth: 100,
        render: (v) => <TierBadge tier={v as string} />
    },
    {
        key: 'auto', label: 'Auto', defaultVisible: true, defaultWidth: 70,
        render: (_v, row) => (row as SchemaTemplate).tier === 'HIGH'
            ? <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
            : <span className="text-muted-foreground">—</span>
    },
    { key: 'tier_reason', label: 'Reason', defaultVisible: true, defaultWidth: 280 },
    {
        key: 'required_fields', label: 'Required Fields', defaultVisible: true, defaultWidth: 180,
        render: (v) => {
            const fields = v as string[] | null
            return fields && fields.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                    {fields.slice(0, 3).map((f: string, i: number) => (
                        <Badge key={i} variant="outline" className="text-xs">{f}</Badge>
                    ))}
                    {fields.length > 3 && <Badge variant="outline" className="text-xs">+{fields.length - 3}</Badge>}
                </div>
            ) : <span className="text-muted-foreground">—</span>
        }
    },
]

export default function Schema() {
    const queryClient = useQueryClient()
    const [editingTemplate, setEditingTemplate] = useState<SchemaTemplate | null>(null)

    // Fetch schema templates (with page_type set)
    const { data: templates = [], isLoading } = useQuery({
        queryKey: ['schema_templates'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('schema_templates')
                .select('id, schema_type, page_type, tier, tier_reason, required_fields, data_sources')
                .not('page_type', 'is', null)
                .order('page_type')
            if (error) throw error
            return data as SchemaTemplate[]
        }
    })

    // Update template mutation
    const updateMutation = useMutation({
        mutationFn: async ({ id, updates }: { id: string; updates: Partial<SchemaTemplate> }) => {
            const { error } = await supabase
                .from('schema_templates')
                .update(updates)
                .eq('id', id)
            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['schema_templates'] })
            toast.success('Template updated')
        },
        onError: (error: Error) => {
            toast.error('Failed to update', { description: error.message })
        }
    })

    const bulkGenerateMutation = useMutation({
        mutationFn: async (_options: { tier: 'HIGH' | 'MEDIUM' | 'ALL' }) => {
            // TODO: Call bulk generation endpoint
            await new Promise(resolve => setTimeout(resolve, 2000))
            return { generated: 10 }
        },
        onSuccess: (data) => {
            toast.success('Bulk generation complete', {
                description: `Generated schemas for ${data.generated} pages`
            })
        },
        onError: (error: Error) => {
            toast.error('Bulk generation failed', { description: error.message })
        }
    })

    const handleSave = (updates: Partial<SchemaTemplate>) => {
        if (editingTemplate) {
            updateMutation.mutate({ id: editingTemplate.id, updates })
        }
    }

    // Stats
    const stats = {
        high: templates.filter(s => s.tier === 'HIGH').length,
        medium: templates.filter(s => s.tier === 'MEDIUM').length,
        low: templates.filter(s => s.tier === 'LOW').length,
        total: templates.length
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Schema Templates</h1>
                <p className="text-muted-foreground">
                    Manage page type to schema mappings and generation tiers
                </p>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-4 gap-4">
                <Card>
                    <CardContent className="pt-4">
                        <div className="text-2xl font-bold text-green-600">{stats.high}</div>
                        <div className="text-xs text-muted-foreground">HIGH (Auto-generate)</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-4">
                        <div className="text-2xl font-bold text-yellow-600">{stats.medium}</div>
                        <div className="text-xs text-muted-foreground">MEDIUM (On request)</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-4">
                        <div className="text-2xl font-bold text-gray-600">{stats.low}</div>
                        <div className="text-xs text-muted-foreground">LOW (Skip)</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-4">
                        <div className="text-2xl font-bold">{stats.total}</div>
                        <div className="text-xs text-muted-foreground">Total Page Types</div>
                    </CardContent>
                </Card>
            </div>

            {/* Actions Bar */}
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-base">Bulk Generation</CardTitle>
                            <CardDescription>Generate schemas for multiple pages at once</CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                onClick={() => bulkGenerateMutation.mutate({ tier: 'HIGH' })}
                                disabled={bulkGenerateMutation.isPending}
                            >
                                {bulkGenerateMutation.isPending ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                ) : (
                                    <Play className="h-4 w-4 mr-2" />
                                )}
                                Generate HIGH Only
                            </Button>
                            <Button
                                onClick={() => bulkGenerateMutation.mutate({ tier: 'ALL' })}
                                disabled={bulkGenerateMutation.isPending}
                            >
                                {bulkGenerateMutation.isPending ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                ) : (
                                    <Sparkles className="h-4 w-4 mr-2" />
                                )}
                                Generate All Eligible
                            </Button>
                        </div>
                    </div>
                </CardHeader>
            </Card>

            {/* Schema Template Table */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Page Type Mappings</CardTitle>
                    <CardDescription>Maps page classifier types to schema.org types with generation priorities</CardDescription>
                </CardHeader>
                <CardContent>
                    <DataTable
                        columns={schemaColumns}
                        data={templates}
                        loading={isLoading}
                        storageKey="schema_templates_config"
                        rowActions={(row: SchemaTemplate) => (
                            <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                onClick={() => setEditingTemplate(row)}
                            >
                                <Pencil className="h-4 w-4" />
                            </Button>
                        )}
                    />
                </CardContent>
            </Card>

            {/* Edit Modal */}
            <SchemaEditModal
                template={editingTemplate}
                open={!!editingTemplate}
                onOpenChange={(open) => !open && setEditingTemplate(null)}
                onSave={handleSave}
            />
        </div>
    )
}
