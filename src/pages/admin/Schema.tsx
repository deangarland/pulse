import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DataTable, type ColumnDef } from "@/components/DataTable"
import { toast } from "sonner"
import {
    Sparkles,
    Settings2,
    Star,
    Play,
    Loader2,
    CheckCircle,
    XCircle,
    AlertCircle
} from "lucide-react"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

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

    // Update tier mutation
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
            // For now, just simulate
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
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="text-base">Page Type Mappings</CardTitle>
                            <CardDescription>Configure which schemas apply to each page type</CardDescription>
                        </div>
                        <Button variant="outline" size="sm">
                            <Settings2 className="h-4 w-4 mr-2" />
                            Edit Fields
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <DataTable
                        columns={schemaColumns}
                        data={schemaConfigs}
                        loading={isLoading}
                        storageKey="schema_org_config"
                        rowActions={(row: SchemaConfig) => (
                            <div className="flex items-center gap-2">
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
        </div>
    )
}
