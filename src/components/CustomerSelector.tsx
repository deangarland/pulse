import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAccountStore } from '@/lib/account-store'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Building2 } from "lucide-react"

interface Account {
    id: string
    hs_account_id: string  // Short ID for URLs
    account_name: string
}

export function CustomerSelector() {
    const [searchParams, setSearchParams] = useSearchParams()
    const [accounts, setAccounts] = useState<Account[]>([])
    const [loading, setLoading] = useState(true)
    const { selectedAccountId, setSelectedAccount } = useAccountStore()

    // Initialize from URL cid param (using short hs_account_id)
    const urlCid = searchParams.get('cid')

    useEffect(() => {
        async function fetchAccounts() {
            const { data, error } = await supabase
                .from('accounts')
                .select('id, hs_account_id, account_name')
                .order('account_name')

            if (error) {
                console.error('Error fetching accounts:', error)
                return
            }

            setAccounts(data || [])
            setLoading(false)

            // If URL has cid (short hs_account_id), find and set the account
            if (urlCid && data) {
                const account = data.find(a => a.hs_account_id === urlCid)
                if (account) {
                    // Store the UUID internally, display short ID in URL
                    setSelectedAccount(account.id, account.account_name)
                }
            }
        }

        fetchAccounts()
    }, [urlCid, setSelectedAccount])

    // Sync selected account to URL using short hs_account_id
    useEffect(() => {
        if (accounts.length === 0) return

        const params = new URLSearchParams(searchParams)
        if (selectedAccountId) {
            // Find the short hs_account_id for the selected UUID
            const account = accounts.find(a => a.id === selectedAccountId)
            if (account?.hs_account_id) {
                params.set('cid', account.hs_account_id)
            }
        } else {
            params.delete('cid')
        }
        setSearchParams(params, { replace: true })
    }, [selectedAccountId, accounts, setSearchParams])

    const handleChange = (value: string) => {
        if (value === 'all') {
            setSelectedAccount(null, null)
        } else {
            const account = accounts.find(a => a.id === value)
            setSelectedAccount(value, account?.account_name || null)
        }
        // Trigger page refresh to apply filter
        window.dispatchEvent(new CustomEvent('accountChanged', { detail: value }))
    }

    if (loading) {
        return (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Building2 className="h-4 w-4" />
                <span>Loading...</span>
            </div>
        )
    }

    return (
        <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <Select value={selectedAccountId || 'all'} onValueChange={handleChange}>
                <SelectTrigger className="w-[200px] h-8 text-sm">
                    <SelectValue placeholder="All Customers" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Customers</SelectItem>
                    {accounts.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                            {account.account_name}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    )
}
