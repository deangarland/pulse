import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { supabase } from "@/lib/supabase"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { DollarSign, Zap, Clock, TrendingUp, Download, Bot } from "lucide-react"

interface UsageLog {
    id: string
    created_at: string
    action: string
    page_url: string | null
    provider: string
    model: string
    input_tokens: number
    output_tokens: number
    total_tokens: number
    input_cost_cents: number
    output_cost_cents: number
    total_cost_cents: number
    request_duration_ms: number | null
    success: boolean
    error_message: string | null
}

// Provider colors
const providerColors: Record<string, string> = {
    openai: 'text-green-600 bg-green-50',
    anthropic: 'text-orange-600 bg-orange-50',
    gemini: 'text-blue-600 bg-blue-50',
}

function formatCost(cents: number): string {
    return `$${(cents / 100).toFixed(4)}`
}

function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleString()
}

function formatDuration(ms: number | null): string {
    if (!ms) return '-'
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
}

export default function TokenCostLog() {
    const [timeRange, setTimeRange] = useState<'today' | 'week' | 'month' | 'all'>('week')
    const [providerFilter, setProviderFilter] = useState<string>('all')

    // Calculate date filter
    const startDate = useMemo(() => {
        const now = new Date()
        switch (timeRange) {
            case 'today':
                return new Date(now.setHours(0, 0, 0, 0)).toISOString()
            case 'week':
                return new Date(now.setDate(now.getDate() - 7)).toISOString()
            case 'month':
                return new Date(now.setMonth(now.getMonth() - 1)).toISOString()
            default:
                return null
        }
    }, [timeRange])

    // Fetch usage logs
    const { data: logs, isLoading } = useQuery({
        queryKey: ['ai-usage-logs', timeRange, providerFilter],
        queryFn: async () => {
            let query = supabase
                .from('ai_usage_logs')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(500)

            if (startDate) {
                query = query.gte('created_at', startDate)
            }
            if (providerFilter !== 'all') {
                query = query.eq('provider', providerFilter)
            }

            const { data, error } = await query
            if (error) throw error
            return data as UsageLog[]
        }
    })

    // Calculate summary stats
    const stats = useMemo(() => {
        if (!logs) return null

        const totalCost = logs.reduce((sum, log) => sum + log.total_cost_cents, 0)
        const totalInputCost = logs.reduce((sum, log) => sum + log.input_cost_cents, 0)
        const totalOutputCost = logs.reduce((sum, log) => sum + log.output_cost_cents, 0)
        const totalInputTokens = logs.reduce((sum, log) => sum + log.input_tokens, 0)
        const totalOutputTokens = logs.reduce((sum, log) => sum + log.output_tokens, 0)
        const avgDuration = logs.filter(l => l.request_duration_ms).length > 0
            ? logs.reduce((sum, l) => sum + (l.request_duration_ms || 0), 0) / logs.filter(l => l.request_duration_ms).length
            : 0
        const successRate = logs.length > 0
            ? (logs.filter(l => l.success).length / logs.length) * 100
            : 100

        // Cost by provider with input/output breakdown
        const byProvider = logs.reduce((acc, log) => {
            if (!acc[log.provider]) {
                acc[log.provider] = { input: 0, output: 0, total: 0 }
            }
            acc[log.provider].input += log.input_cost_cents
            acc[log.provider].output += log.output_cost_cents
            acc[log.provider].total += log.total_cost_cents
            return acc
        }, {} as Record<string, { input: number; output: number; total: number }>)

        return {
            totalCost, totalInputCost, totalOutputCost,
            totalInputTokens, totalOutputTokens,
            avgDuration, successRate, byProvider, count: logs.length
        }
    }, [logs])

    // Export to CSV
    const handleExport = () => {
        if (!logs) return

        const headers = ['Date', 'Action', 'Provider', 'Model', 'Page URL', 'Input Tokens', 'Output Tokens', 'Total Tokens', 'Input Cost', 'Output Cost', 'Total Cost', 'Duration', 'Success', 'Error']
        const rows = logs.map(log => [
            formatDate(log.created_at),
            log.action,
            log.provider,
            log.model,
            log.page_url || '',
            log.input_tokens,
            log.output_tokens,
            log.total_tokens,
            formatCost(log.input_cost_cents),
            formatCost(log.output_cost_cents),
            formatCost(log.total_cost_cents),
            formatDuration(log.request_duration_ms),
            log.success ? 'Yes' : 'No',
            log.error_message || ''
        ])

        const csv = [headers, ...rows].map(row => row.join(',')).join('\n')
        const blob = new Blob([csv], { type: 'text/csv' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `ai-usage-${timeRange}-${new Date().toISOString().split('T')[0]}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    if (isLoading) {
        return (
            <div className="space-y-6">
                <Skeleton className="h-8 w-48" />
                <div className="grid grid-cols-4 gap-4">
                    {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
                </div>
                <Skeleton className="h-96" />
            </div>
        )
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">AI Token Usage</h1>
                    <p className="text-muted-foreground">Track costs and token usage across all AI providers</p>
                </div>
                <div className="flex items-center gap-3">
                    <Select value={providerFilter} onValueChange={setProviderFilter}>
                        <SelectTrigger className="w-[140px]">
                            <SelectValue placeholder="Provider" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Providers</SelectItem>
                            <SelectItem value="openai">OpenAI</SelectItem>
                            <SelectItem value="anthropic">Anthropic</SelectItem>
                            <SelectItem value="gemini">Gemini</SelectItem>
                        </SelectContent>
                    </Select>
                    <Select value={timeRange} onValueChange={(v: 'today' | 'week' | 'month' | 'all') => setTimeRange(v)}>
                        <SelectTrigger className="w-[120px]">
                            <SelectValue placeholder="Time range" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="today">Today</SelectItem>
                            <SelectItem value="week">Last 7 days</SelectItem>
                            <SelectItem value="month">Last 30 days</SelectItem>
                            <SelectItem value="all">All time</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" onClick={handleExport} disabled={!logs?.length}>
                        <Download className="h-4 w-4 mr-2" />
                        Export CSV
                    </Button>
                </div>
            </div>

            {/* Stats Cards */}
            {stats && (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                    <Card>
                        <CardHeader className="pb-2">
                            <CardDescription>Input Tokens</CardDescription>
                            <CardTitle className="text-xl flex items-center gap-2">
                                <Zap className="h-4 w-4 text-blue-600" />
                                {stats.totalInputTokens.toLocaleString()}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-xs text-muted-foreground">{formatCost(stats.totalInputCost)}</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="pb-2">
                            <CardDescription>Output Tokens</CardDescription>
                            <CardTitle className="text-xl flex items-center gap-2">
                                <Zap className="h-4 w-4 text-yellow-600" />
                                {stats.totalOutputTokens.toLocaleString()}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-xs text-muted-foreground">{formatCost(stats.totalOutputCost)}</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="pb-2">
                            <CardDescription>Total Cost</CardDescription>
                            <CardTitle className="text-xl flex items-center gap-2">
                                <DollarSign className="h-4 w-4 text-green-600" />
                                {formatCost(stats.totalCost)}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-xs text-muted-foreground">{stats.count} requests</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="pb-2">
                            <CardDescription>Avg Duration</CardDescription>
                            <CardTitle className="text-xl flex items-center gap-2">
                                <Clock className="h-4 w-4 text-purple-600" />
                                {formatDuration(stats.avgDuration)}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-xs text-muted-foreground">Per request</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="pb-2">
                            <CardDescription>Success Rate</CardDescription>
                            <CardTitle className="text-xl flex items-center gap-2">
                                <TrendingUp className="h-4 w-4 text-emerald-600" />
                                {stats.successRate.toFixed(1)}%
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-xs text-muted-foreground">Successful</p>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Cost by Provider */}
            {stats && Object.keys(stats.byProvider).length > 0 && (
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">Cost by Provider</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {Object.entries(stats.byProvider).map(([provider, costs]) => (
                                <div key={provider} className="border rounded-lg p-3">
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className={`px-2 py-1 rounded text-xs font-medium capitalize ${providerColors[provider] || 'bg-gray-100'}`}>
                                            {provider}
                                        </span>
                                        <span className="font-semibold ml-auto">{formatCost(costs.total)}</span>
                                    </div>
                                    <div className="flex justify-between text-xs text-muted-foreground">
                                        <span>Input: {formatCost(costs.input)}</span>
                                        <span>Output: {formatCost(costs.output)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Usage Log Table */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Recent Usage</CardTitle>
                </CardHeader>
                <CardContent>
                    {logs?.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                            <Bot className="h-12 w-12 mx-auto mb-4 opacity-50" />
                            <p>No AI usage logs yet. Generate some recommendations to see data here.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b">
                                        <th className="text-left py-2 px-2">Time</th>
                                        <th className="text-left py-2 px-2">Action</th>
                                        <th className="text-left py-2 px-2">Provider</th>
                                        <th className="text-left py-2 px-2">Model</th>
                                        <th className="text-right py-2 px-2">Tokens</th>
                                        <th className="text-right py-2 px-2">Cost</th>
                                        <th className="text-right py-2 px-2">Duration</th>
                                        <th className="text-center py-2 px-2">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logs?.map((log) => (
                                        <tr key={log.id} className="border-b border-dashed hover:bg-muted/50">
                                            <td className="py-2 px-2 text-xs text-muted-foreground whitespace-nowrap">
                                                {formatDate(log.created_at)}
                                            </td>
                                            <td className="py-2 px-2 font-medium">
                                                {log.action.replace(/_/g, ' ')}
                                            </td>
                                            <td className="py-2 px-2">
                                                <span className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${providerColors[log.provider] || 'bg-gray-100'}`}>
                                                    {log.provider}
                                                </span>
                                            </td>
                                            <td className="py-2 px-2 text-xs font-mono">
                                                {log.model.split('-').slice(0, 3).join('-')}
                                            </td>
                                            <td className="py-2 px-2 text-right">
                                                <span className="text-xs text-muted-foreground">
                                                    {log.input_tokens.toLocaleString()} + {log.output_tokens.toLocaleString()}
                                                </span>
                                            </td>
                                            <td className="py-2 px-2 text-right font-medium">
                                                {formatCost(log.total_cost_cents)}
                                            </td>
                                            <td className="py-2 px-2 text-right text-muted-foreground">
                                                {formatDuration(log.request_duration_ms)}
                                            </td>
                                            <td className="py-2 px-2 text-center">
                                                {log.success ? (
                                                    <span className="inline-block w-2 h-2 rounded-full bg-green-500" title="Success" />
                                                ) : (
                                                    <span className="inline-block w-2 h-2 rounded-full bg-red-500" title={log.error_message || 'Failed'} />
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
