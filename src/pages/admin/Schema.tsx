import { useState } from 'react'
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
    X,
    Plus,
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

interface SchemaConfig {
    id: string
    page_type: string
    schema_type: string
    tier: 'HIGH' | 'MEDIUM' | 'LOW'
    auto_generate: boolean
    reason: string
    required_fields: string[] | null
    optional_fields: string[] | null
    linked_schemas: string[] | null
}

// Available schema types for linking
const AVAILABLE_SCHEMAS = [
    'Organization', 'LocalBusiness', 'MedicalBusiness', 'MedicalClinic',
    'WebPage', 'WebSite', 'Article', 'BlogPosting', 'FAQPage',
    'Service', 'MedicalProcedure', 'Product', 'Offer',
    'Person', 'Physician', 'Review', 'AggregateRating',
    'BreadcrumbList', 'ContactPoint', 'PostalAddress', 'GeoCoordinates',
    'ImageObject', 'VideoObject', 'HowTo', 'MedicalCondition'
]

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
    config,
    open,
    onOpenChange,
    onSave
}: {
    config: SchemaConfig | null
    open: boolean
    onOpenChange: (open: boolean) => void
    onSave: (data: Partial<SchemaConfig>) => void
}) {
    const [formData, setFormData] = useState<Partial<SchemaConfig>>({})
    const [newLinkedSchema, setNewLinkedSchema] = useState('')

    // Reset form when config changes
    useState(() => {
        if (config) {
            setFormData({
                schema_type: config.schema_type,
                tier: config.tier,
                reason: config.reason,
                linked_schemas: config.linked_schemas || [],
                required_fields: config.required_fields || [],
                optional_fields: config.optional_fields || [],
            })
        }
    })

    const linkedSchemas = formData.linked_schemas || config?.linked_schemas || []
    const requiredFields = formData.required_fields || config?.required_fields || []
    const optionalFields = formData.optional_fields || config?.optional_fields || []

    const addLinkedSchema = (schema: string) => {
        if (schema && !linkedSchemas.includes(schema)) {
            setFormData(prev => ({
                ...prev,
                linked_schemas: [...linkedSchemas, schema]
            }))
        }
        setNewLinkedSchema('')
    }

    const removeLinkedSchema = (schema: string) => {
        setFormData(prev => ({
            ...prev,
            linked_schemas: linkedSchemas.filter(s => s !== schema)
        }))
    }

    const handleSave = () => {
        onSave(formData)
        onOpenChange(false)
    }

    if (!config) return null

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Edit Schema Config: {config.page_type}</DialogTitle>
                    <DialogDescription>
                        Configure schema type, linked schemas, and field requirements
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    {/* Schema Type */}
                    <div className="space-y-2">
                        <Label>Schema Type</Label>
                        <Select
                            value={formData.schema_type || config.schema_type}
                            onValueChange={(v) => setFormData(prev => ({ ...prev, schema_type: v }))}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {AVAILABLE_SCHEMAS.map(s => (
                                    <SelectItem key={s} value={s}>{s}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Tier */}
                    <div className="space-y-2">
                        <Label>Priority Tier</Label>
                        <Select
                            value={formData.tier || config.tier}
                            onValueChange={(v) => setFormData(prev => ({ ...prev, tier: v as 'HIGH' | 'MEDIUM' | 'LOW' }))}
                        >
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

                    {/* Reason */}
                    <div className="space-y-2">
                        <Label>Reason / Notes</Label>
                        <Textarea
                            value={formData.reason !== undefined ? formData.reason : config.reason}
                            onChange={(e) => setFormData(prev => ({ ...prev, reason: e.target.value }))}
                            placeholder="Why this schema is used for this page type..."
                            rows={2}
                        />
                    </div>

                    {/* Linked Schemas */}
                    <div className="space-y-2">
                        <Label>Linked Schemas</Label>
                        <p className="text-xs text-muted-foreground">
                            Additional schemas to include when generating for this page type
                        </p>
                        <div className="flex flex-wrap gap-2 min-h-[40px] p-2 border rounded-md bg-muted/30">
                            {linkedSchemas.length === 0 && (
                                <span className="text-sm text-muted-foreground">No linked schemas</span>
                            )}
                            {linkedSchemas.map((schema) => (
                                <Badge key={schema} variant="secondary" className="gap-1">
                                    {schema}
                                    <button
                                        onClick={() => removeLinkedSchema(schema)}
                                        className="ml-1 hover:text-destructive"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </Badge>
                            ))}
                        </div>
                        <div className="flex gap-2">
                            <Select value={newLinkedSchema} onValueChange={setNewLinkedSchema}>
                                <SelectTrigger className="flex-1">
                                    <SelectValue placeholder="Select schema to add..." />
                                </SelectTrigger>
                                <SelectContent className="max-h-60 overflow-y-auto">
                                    {AVAILABLE_SCHEMAS
                                        .filter(s => !linkedSchemas.includes(s))
                                        .map(s => (
                                            <SelectItem key={s} value={s}>{s}</SelectItem>
                                        ))
                                    }
                                </SelectContent>
                            </Select>
                            <Button
                                variant="outline"
                                onClick={() => addLinkedSchema(newLinkedSchema)}
                                disabled={!newLinkedSchema}
                            >
                                <Plus className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>

                    {/* Required Fields (display only for now) */}
                    <div className="space-y-2">
                        <Label>Required Fields</Label>
                        <div className="flex flex-wrap gap-1 p-2 border rounded-md bg-muted/30 min-h-[40px]">
                            {requiredFields.length === 0 ? (
                                <span className="text-sm text-muted-foreground">None specified</span>
                            ) : (
                                requiredFields.map((f) => (
                                    <Badge key={f} variant="outline" className="text-xs">{f}</Badge>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Optional Fields (display only for now) */}
                    <div className="space-y-2">
                        <Label>Optional Fields</Label>
                        <div className="flex flex-wrap gap-1 p-2 border rounded-md bg-muted/30 min-h-[40px]">
                            {optionalFields.length === 0 ? (
                                <span className="text-sm text-muted-foreground">None specified</span>
                            ) : (
                                optionalFields.map((f) => (
                                    <Badge key={f} variant="outline" className="text-xs">{f}</Badge>
                                ))
                            )}
                        </div>
                    </div>
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
        render: (v) => <TierBadge tier={v} />
    },
    {
        key: 'auto_generate', label: 'Auto', defaultVisible: true, defaultWidth: 70,
        render: (v) => v ? <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" /> : <span className="text-muted-foreground">—</span>
    },
    { key: 'reason', label: 'Reason', defaultVisible: true, defaultWidth: 280 },
    {
        key: 'linked_schemas', label: 'Linked Schemas', defaultVisible: true, defaultWidth: 180,
        render: (v) => Array.isArray(v) && v.length > 0 ? (
            <div className="flex flex-wrap gap-1">
                {v.map((s, i) => (
                    <Badge key={i} variant="outline" className="text-xs">{s}</Badge>
                ))}
            </div>
        ) : <span className="text-muted-foreground">—</span>
    },
]

export default function Schema() {
    const queryClient = useQueryClient()
    const [editingConfig, setEditingConfig] = useState<SchemaConfig | null>(null)

    // Fetch schema configs
    const { data: schemaConfigs = [], isLoading } = useQuery({
        queryKey: ['schema_org'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('schema_org')
                .select('*')
                .order('page_type')
            if (error) throw error
            return data as SchemaConfig[]
        }
    })

    // Update config mutation
    const updateConfigMutation = useMutation({
        mutationFn: async ({ pageType, updates }: { pageType: string; updates: Partial<SchemaConfig> }) => {
            const { error } = await supabase
                .from('schema_org')
                .update({
                    ...updates,
                    auto_generate: updates.tier === 'HIGH'
                })
                .eq('page_type', pageType)
            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['schema_org'] })
            toast.success('Schema config updated')
        },
        onError: (error: Error) => {
            toast.error('Failed to update', { description: error.message })
        }
    })

    // Update tier mutation (for inline tier dropdown)
    const updateTierMutation = useMutation({
        mutationFn: async ({ pageType, tier }: { pageType: string; tier: string }) => {
            const { error } = await supabase
                .from('schema_org')
                .update({ tier, auto_generate: tier === 'HIGH' })
                .eq('page_type', pageType)
            if (error) throw error
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['schema_org'] })
            toast.success('Tier updated')
        },
        onError: (error: Error) => {
            toast.error('Failed to update tier', { description: error.message })
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

    const handleSaveConfig = (updates: Partial<SchemaConfig>) => {
        if (editingConfig) {
            updateConfigMutation.mutate({
                pageType: editingConfig.page_type,
                updates
            })
        }
    }

    // Stats
    const stats = {
        high: schemaConfigs.filter(s => s.tier === 'HIGH').length,
        medium: schemaConfigs.filter(s => s.tier === 'MEDIUM').length,
        low: schemaConfigs.filter(s => s.tier === 'LOW').length,
        total: schemaConfigs.length
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Schema Configuration</h1>
                <p className="text-muted-foreground">
                    Manage page type to schema mappings and generation settings
                </p>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-4 gap-4">
                <Card>
                    <CardContent className="pt-4">
                        <div className="text-2xl font-bold text-green-600">{stats.high}</div>
                        <div className="text-xs text-muted-foreground">HIGH Priority (Auto)</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-4">
                        <div className="text-2xl font-bold text-yellow-600">{stats.medium}</div>
                        <div className="text-xs text-muted-foreground">MEDIUM Priority</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-4">
                        <div className="text-2xl font-bold text-gray-600">{stats.low}</div>
                        <div className="text-xs text-muted-foreground">LOW Priority (Skip)</div>
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

            {/* Schema Config Table */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Page Type Mappings</CardTitle>
                    <CardDescription>Click the edit button on any row to configure linked schemas and fields</CardDescription>
                </CardHeader>
                <CardContent>
                    <DataTable
                        columns={schemaColumns}
                        data={schemaConfigs}
                        loading={isLoading}
                        storageKey="schema_org_config"
                        rowActions={(row: SchemaConfig) => (
                            <div className="flex items-center gap-2">
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7"
                                    onClick={() => setEditingConfig(row)}
                                >
                                    <Pencil className="h-4 w-4" />
                                </Button>
                                <Select
                                    value={row.tier}
                                    onValueChange={(tier) => updateTierMutation.mutate({
                                        pageType: row.page_type,
                                        tier
                                    })}
                                >
                                    <SelectTrigger className="h-7 w-24">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="HIGH">HIGH</SelectItem>
                                        <SelectItem value="MEDIUM">MEDIUM</SelectItem>
                                        <SelectItem value="LOW">LOW</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                    />
                </CardContent>
            </Card>

            {/* Edit Modal */}
            <SchemaEditModal
                config={editingConfig}
                open={!!editingConfig}
                onOpenChange={(open) => !open && setEditingConfig(null)}
                onSave={handleSaveConfig}
            />
        </div>
    )
}
