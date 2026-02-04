import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"

export interface ComboboxOption {
    value: string
    label: string
    sublabel?: string
}

interface SearchableComboboxProps {
    options: ComboboxOption[]
    value: string
    onValueChange: (value: string) => void
    placeholder?: string
    searchPlaceholder?: string
    emptyText?: string
    className?: string
    disabled?: boolean
    icon?: React.ReactNode
}

export function SearchableCombobox({
    options,
    value,
    onValueChange,
    placeholder = "Select...",
    searchPlaceholder = "Search...",
    emptyText = "No results found.",
    className,
    disabled = false,
    icon
}: SearchableComboboxProps) {
    const [open, setOpen] = React.useState(false)

    const selectedOption = options.find(opt => opt.value === value)

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className={cn("justify-between", className)}
                    disabled={disabled}
                >
                    <div className="flex items-center gap-2 truncate">
                        {icon}
                        <span className="truncate">
                            {selectedOption ? selectedOption.label : placeholder}
                        </span>
                    </div>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command loop>
                    <CommandInput placeholder={searchPlaceholder} />
                    <CommandList className="max-h-[300px]">
                        <CommandEmpty>{emptyText}</CommandEmpty>
                        <CommandGroup>
                            {options.map((option) => (
                                <CommandItem
                                    key={option.value}
                                    value={option.label}
                                    keywords={option.sublabel ? [option.sublabel] : undefined}
                                    onSelect={() => {
                                        // Ensure value changes before closing popover
                                        onValueChange(option.value)
                                        // Use setTimeout to ensure state update completes
                                        setTimeout(() => setOpen(false), 0)
                                    }}
                                    className="cursor-pointer"
                                >
                                    <Check
                                        className={cn(
                                            "mr-2 h-4 w-4",
                                            value === option.value ? "opacity-100" : "opacity-0"
                                        )}
                                    />
                                    <div className="flex flex-col">
                                        <span>{option.label}</span>
                                        {option.sublabel && (
                                            <span className="text-xs text-muted-foreground">{option.sublabel}</span>
                                        )}
                                    </div>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}
