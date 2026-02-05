// Centralized AI Model Configuration
// Used by both frontend (ModelSelector) and backend (server.js)
// Update this file when models change - all selectors will update automatically

export interface Model {
    value: string           // API model ID (exact string sent to provider)
    label: string           // Human-readable display name
    provider: 'openai' | 'gemini' | 'claude'
    description?: string    // Short description for tooltips
}

export interface ModelPricing {
    input: number   // Cost per 1M input tokens (in cents)
    output: number  // Cost per 1M output tokens (in cents)
}

// ============================================
// AI Models - All available models
// ============================================
export const AI_MODELS: Model[] = [
    // ----------------------------------------
    // OpenAI - GPT-5 Series (Latest, Feb 2026)
    // ----------------------------------------
    { value: 'gpt-5', label: 'GPT-5', provider: 'openai', description: 'Most capable model' },
    { value: 'gpt-5-mini', label: 'GPT-5 Mini', provider: 'openai', description: 'Fast & affordable GPT-5' },

    // ----------------------------------------
    // OpenAI - Reasoning Models (o-series)
    // ----------------------------------------
    { value: 'o3-mini', label: 'o3-mini', provider: 'openai', description: 'Latest reasoning, fast' },
    { value: 'o1', label: 'o1', provider: 'openai', description: 'Advanced reasoning' },
    { value: 'o1-mini', label: 'o1-mini', provider: 'openai', description: 'Fast reasoning' },

    // ----------------------------------------
    // OpenAI - GPT-4.5 Preview
    // ----------------------------------------
    { value: 'gpt-4.5-preview', label: 'GPT-4.5 Preview', provider: 'openai', description: 'Latest preview' },

    // ----------------------------------------
    // OpenAI - GPT-4o Family
    // ----------------------------------------
    { value: 'gpt-4o', label: 'GPT-4o', provider: 'openai', description: 'Flagship multimodal' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai', description: 'Fast & affordable' },

    // ----------------------------------------
    // OpenAI - GPT-4 Turbo & Base
    // ----------------------------------------
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo', provider: 'openai', description: 'High capability' },
    { value: 'gpt-4', label: 'GPT-4', provider: 'openai', description: 'Original GPT-4' },

    // ----------------------------------------
    // OpenAI - GPT-3.5
    // ----------------------------------------
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo', provider: 'openai', description: 'Fast & cheap' },

    // ----------------------------------------
    // Claude (Anthropic) - Claude 4 Series
    // Model IDs: claude-{tier}-{version}-{date}
    // ----------------------------------------
    { value: 'claude-opus-4-20250514', label: 'Claude Opus 4', provider: 'claude', description: 'Peak intelligence' },
    { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', provider: 'claude', description: 'Balanced, best for agents' },
    { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku', provider: 'claude', description: 'Fast & cheap' },

    // ----------------------------------------
    // Gemini (Google) - 2.5 Series
    // ----------------------------------------
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'gemini', description: 'Best quality, reasoning' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'gemini', description: 'Fast, multimodal' },
    { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', provider: 'gemini', description: 'Cheapest option' },
]

// ============================================
// Model Pricing (per 1M tokens, in cents)
// ============================================
export const MODEL_PRICING: Record<string, ModelPricing> = {
    // OpenAI - GPT-5
    'gpt-5': { input: 500, output: 1500 },
    'gpt-5-mini': { input: 75, output: 300 },

    // OpenAI - Reasoning
    'o3-mini': { input: 110, output: 440 },
    'o1': { input: 1500, output: 6000 },
    'o1-mini': { input: 300, output: 1200 },

    // OpenAI - GPT-4.5/4o
    'gpt-4.5-preview': { input: 250, output: 1000 },
    'gpt-4o': { input: 250, output: 1000 },
    'gpt-4o-mini': { input: 15, output: 60 },

    // OpenAI - GPT-4/3.5
    'gpt-4-turbo': { input: 1000, output: 3000 },
    'gpt-4': { input: 3000, output: 6000 },
    'gpt-3.5-turbo': { input: 50, output: 150 },

    // Anthropic Claude 4
    'claude-opus-4-20250514': { input: 1500, output: 7500 },
    'claude-sonnet-4-20250514': { input: 300, output: 1500 },
    'claude-3-5-haiku-20241022': { input: 80, output: 400 },

    // Google Gemini 2.5
    'gemini-2.5-pro': { input: 125, output: 1000 },
    'gemini-2.5-flash': { input: 15, output: 60 },
    'gemini-2.5-flash-lite': { input: 7.5, output: 30 },
}

// ============================================
// Helper: Get models by provider
// ============================================
export function getModelsByProvider(provider: 'openai' | 'gemini' | 'claude'): Model[] {
    return AI_MODELS.filter(m => m.provider === provider)
}

// ============================================
// Helper: Get all model IDs for a provider
// ============================================
export function getModelIds(provider: 'openai' | 'gemini' | 'claude'): string[] {
    return getModelsByProvider(provider).map(m => m.value)
}

// ============================================
// Provider colors for UI
// ============================================
export const providerColors: Record<string, string> = {
    openai: 'text-green-600',
    gemini: 'text-blue-600',
    claude: 'text-orange-600',
}

// Default model (used when no selection made)
export const DEFAULT_MODEL = 'gpt-4o'
