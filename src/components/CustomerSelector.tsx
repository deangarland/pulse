import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
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
    account_name: string
}

export function CustomerSelector() {
    const [accounts, setAccounts] = useState<Account[]>([])
    const [selectedAccount, setSelectedAccount] = useState<string>('')
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        async function fetchAccounts() {
            const { data, error } = await supabase
                .from('accounts')
                .select('id, account_name')
                .order('account_name')

            if (error) {
                console.error('Error fetching accounts:', error)
                return
            }

            setAccounts(data || [])
            setLoading(false)
        }

        fetchAccounts()
    }, [])

    const handleChange = (value: string) => {
        setSelectedAccount(value)
        // For now, just store in localStorage - could be lifted to context later
        if (value === 'all') {
            localStorage.removeItem('selectedAccountId')
        } else {
            localStorage.setItem('selectedAccountId', value)
        }
        // Trigger page refresh to apply filter (or use context/state management)
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
            <Select value={selectedAccount} onValueChange={handleChange}>
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
