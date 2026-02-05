import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Bot } from "lucide-react"
import { AI_MODELS, providerColors, DEFAULT_MODEL, type Model } from "@/lib/models"

// Re-export for backwards compatibility
export type { Model }
export { AI_MODELS }

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
    const selectedModel = AI_MODELS.find(m => m.value === value) || AI_MODELS.find(m => m.value === DEFAULT_MODEL) || AI_MODELS[0]

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
    const modelInfo = AI_MODELS.find(m => m.value === model) || AI_MODELS.find(m => m.value === DEFAULT_MODEL) || AI_MODELS[0]

    return (
        <div className={`inline-flex items-center gap-1 text-xs font-medium ${providerColors[modelInfo.provider]}`}>
            <Bot className="h-3 w-3" />
            <span>{modelInfo.label}</span>
        </div>
    )
}
