import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Loader2, Globe, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'

interface AddWebsiteModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSuccess?: () => void
}

interface Account {
    id: string
    account_name: string
}

export function AddWebsiteModal({ open, onOpenChange, onSuccess }: AddWebsiteModalProps) {
    const [url, setUrl] = useState('')
    const [accountId, setAccountId] = useState<string>('')
    const [error, setError] = useState('')
    const queryClient = useQueryClient()
    const apiUrl = import.meta.env.VITE_API_URL || ''

    // Fetch accounts for dropdown
    const { data: accounts } = useQuery<Account[]>({
        queryKey: ['accounts-list'],
        queryFn: async () => {
            const response = await fetch(`${apiUrl}/api/admin/accounts`)
            if (!response.ok) throw new Error('Failed to fetch accounts')
            return response.json()
        }
    })

    // Create site mutation
    const createSite = useMutation({
        mutationFn: async () => {
            const response = await fetch(`${apiUrl}/api/sites`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url,
                    account_id: accountId || null
                })
            })
            if (!response.ok) {
                const data = await response.json()
                throw new Error(data.error || 'Failed to create site')
            }
            return response.json()
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['sites'] })
            queryClient.invalidateQueries({ queryKey: ['page-index'] })
            toast.success(
                data.updated
                    ? `Site ${data.domain} queued for re-crawl`
                    : `Site ${data.domain} created and queued for crawling`
            )
            onOpenChange(false)
            setUrl('')
            setAccountId('')
            setError('')
            onSuccess?.()
        },
        onError: (err: Error) => {
            setError(err.message)
        }
    })

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        setError('')

        // Validate URL
        try {
            new URL(url.startsWith('http') ? url : `https://${url}`)
        } catch {
            setError('Please enter a valid URL')
            return
        }

        createSite.mutate()
    }

    const normalizedUrl = url.startsWith('http') ? url : url ? `https://${url}` : ''

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Globe className="h-5 w-5" />
                        Add Website for Crawling
                    </DialogTitle>
                    <DialogDescription>
                        Enter a website URL to crawl and index all pages.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="url">Website URL</Label>
                        <Input
                            id="url"
                            type="text"
                            placeholder="https://example.com"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            autoFocus
                        />
                        {url && !url.startsWith('http') && (
                            <p className="text-xs text-muted-foreground">
                                Will be crawled as: {normalizedUrl}
                            </p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="account">Link to Account (Optional)</Label>
                        <Select value={accountId || 'none'} onValueChange={(val) => setAccountId(val === 'none' ? '' : val)}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select an account..." />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">No account</SelectItem>
                                {accounts?.map(account => (
                                    <SelectItem key={account.id} value={account.id}>
                                        {account.account_name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                            Link this site to a client account for filtering
                        </p>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-md">
                            <AlertCircle className="h-4 w-4" />
                            {error}
                        </div>
                    )}

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={!url || createSite.isPending}
                        >
                            {createSite.isPending && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            Add Website
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
