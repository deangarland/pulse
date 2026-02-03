import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Bot } from "lucide-react"

export interface Model {
    value: string
    label: string
    provider: 'openai' | 'gemini' | 'claude'
    description?: string
}

export const AI_MODELS: Model[] = [
    // OpenAI - Latest reasoning models
    { value: 'o3-mini', label: 'o3-mini', provider: 'openai', description: 'Latest reasoning, fast' },
    { value: 'o1', label: 'o1', provider: 'openai', description: 'Advanced reasoning' },
    { value: 'o1-mini', label: 'o1-mini', provider: 'openai', description: 'Fast reasoning' },

    // OpenAI - GPT-4.5 Preview
    { value: 'gpt-4.5-preview', label: 'GPT-4.5 Preview', provider: 'openai', description: 'Latest preview' },

    // OpenAI - GPT-4o family
    { value: 'gpt-4o', label: 'GPT-4o', provider: 'openai', description: 'Flagship model' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai', description: 'Fast & affordable' },

    // OpenAI - GPT-4 Turbo
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo', provider: 'openai', description: 'High capability' },
    { value: 'gpt-4-turbo-preview', label: 'GPT-4 Turbo Preview', provider: 'openai', description: 'Latest turbo preview' },

    // OpenAI - GPT-4 base
    { value: 'gpt-4', label: 'GPT-4', provider: 'openai', description: 'Original GPT-4' },

    // OpenAI - GPT-3.5
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo', provider: 'openai', description: 'Fast & cheap' },

    // Claude (Anthropic) - 4.5 series (Feb 2026)
    { value: 'claude-opus-4-5', label: 'Claude 4.5 Opus', provider: 'claude', description: 'Peak intelligence' },
    { value: 'claude-sonnet-4-5', label: 'Claude 4.5 Sonnet', provider: 'claude', description: 'Balanced, agents' },
    { value: 'claude-haiku-4-5', label: 'Claude 4.5 Haiku', provider: 'claude', description: 'Fast & cheap' },

    // Gemini (Google) - 2.5 series (Feb 2026)
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'gemini', description: 'Best quality, reasoning' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'gemini', description: 'Fast, multimodal' },
    { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', provider: 'gemini', description: 'Cheapest option' },
]

// Provider colors for visual distinction
const providerColors: Record<string, string> = {
    openai: 'text-green-600',
    gemini: 'text-blue-600',
    claude: 'text-orange-600',
}

interface ModelSelectorProps {
    value: string
    onChange: (model: string) => void
    disabled?: boolean
    className?: string
    showDescription?: boolean
}

export function ModelSelector({
    value,
    onChange,
    disabled = false,
    className = '',
    showDescription = false
}: ModelSelectorProps) {
    const selectedModel = AI_MODELS.find(m => m.value === value) || AI_MODELS[0]

    return (
        <Select value={value} onValueChange={onChange} disabled={disabled}>
            <SelectTrigger className={`w-[180px] ${className}`}>
                <div className="flex items-center gap-2">
                    <Bot className={`h-4 w-4 ${providerColors[selectedModel.provider]}`} />
                    <SelectValue placeholder="Select model" />
                </div>
            </SelectTrigger>
            <SelectContent>
                {AI_MODELS.map((model) => (
                    <SelectItem key={model.value} value={model.value}>
                        <div className="flex items-center gap-2">
                            <Bot className={`h-4 w-4 ${providerColors[model.provider]}`} />
                            <span>{model.label}</span>
                            {showDescription && model.description && (
                                <span className="text-xs text-muted-foreground ml-1">
                                    - {model.description}
                                </span>
                            )}
                        </div>
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}

// Compact version for inline use
export function ModelBadge({ model }: { model: string }) {
    const modelInfo = AI_MODELS.find(m => m.value === model) || AI_MODELS[0]

    return (
        <div className={`inline-flex items-center gap-1 text-xs font-medium ${providerColors[modelInfo.provider]}`}>
            <Bot className="h-3 w-3" />
            <span>{modelInfo.label}</span>
        </div>
    )
}
