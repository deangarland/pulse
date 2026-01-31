import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/lib/auth-store'
import { Loader2 } from 'lucide-react'
import { useEffect } from 'react'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const { user, loading, initialized, initialize } = useAuthStore()

    useEffect(() => {
        initialize()
    }, [initialize])

    if (!initialized || loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-muted-foreground">Loading...</p>
                </div>
            </div>
        )
    }

    if (!user) {
        return <Navigate to="/login" replace />
    }

    return <>{children}</>
}
