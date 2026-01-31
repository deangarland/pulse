import { create } from 'zustand'

interface AccountState {
    selectedAccountId: string | null
    selectedAccountName: string | null
    setSelectedAccount: (id: string | null, name: string | null) => void
}

export const useAccountStore = create<AccountState>((set) => ({
    selectedAccountId: localStorage.getItem('selectedAccountId'),
    selectedAccountName: localStorage.getItem('selectedAccountName'),
    setSelectedAccount: (id, name) => {
        if (id && name) {
            localStorage.setItem('selectedAccountId', id)
            localStorage.setItem('selectedAccountName', name)
        } else {
            localStorage.removeItem('selectedAccountId')
            localStorage.removeItem('selectedAccountName')
        }
        set({ selectedAccountId: id, selectedAccountName: name })
    }
}))
