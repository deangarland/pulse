import { create } from 'zustand'
import { supabase } from './supabase'
import type { User, Session } from '@supabase/supabase-js'

interface AuthState {
    user: User | null
    session: Session | null
    loading: boolean
    initialized: boolean
    setUser: (user: User | null) => void
    setSession: (session: Session | null) => void
    setLoading: (loading: boolean) => void
    setInitialized: (initialized: boolean) => void
    signIn: (email: string, password: string) => Promise<{ error: Error | null }>
    signOut: () => Promise<void>
    initialize: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
    user: null,
    session: null,
    loading: true,
    initialized: false,

    setUser: (user) => set({ user }),
    setSession: (session) => set({ session }),
    setLoading: (loading) => set({ loading }),
    setInitialized: (initialized) => set({ initialized }),

    signIn: async (email: string, password: string) => {
        set({ loading: true })
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        })
        if (error) {
            set({ loading: false })
            return { error }
        }
        set({ user: data.user, session: data.session, loading: false })
        return { error: null }
    },

    signOut: async () => {
        await supabase.auth.signOut()
        set({ user: null, session: null })
    },

    initialize: async () => {
        if (get().initialized) return

        const { data: { session } } = await supabase.auth.getSession()
        set({
            user: session?.user || null,
            session,
            loading: false,
            initialized: true
        })

        // Listen for auth changes
        supabase.auth.onAuthStateChange((_event, session) => {
            set({
                user: session?.user || null,
                session
            })
        })
    }
}))
