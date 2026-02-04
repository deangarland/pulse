import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Heading from '@tiptap/extension-heading'
import { Button } from "@/components/ui/button"
import {
    Bold,
    Italic,
    List,
    ListOrdered,
    Heading1,
    Heading2,
    Heading3,
    Heading4,
    Undo,
    Redo,
    Copy
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useCallback, useEffect } from 'react'

interface RichTextEditorProps {
    content: string
    onChange?: (html: string) => void
    editable?: boolean
    className?: string
    placeholder?: string
}

export function RichTextEditor({
    content,
    onChange,
    editable = true,
    className,
    placeholder = "Start writing..."
}: RichTextEditorProps) {
    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: false, // Use custom heading config
            }),
            Heading.configure({
                levels: [1, 2, 3, 4],
            }),
        ],
        content,
        editable,
        onUpdate: ({ editor }) => {
            onChange?.(editor.getHTML())
        },
        editorProps: {
            attributes: {
                class: 'prose prose-sm max-w-none focus:outline-none min-h-[100px] px-4 py-3',
            },
        },
    })

    // Update content when prop changes
    useEffect(() => {
        if (editor && content !== editor.getHTML()) {
            editor.commands.setContent(content)
        }
    }, [content, editor])

    const copyToClipboard = useCallback(() => {
        if (editor) {
            navigator.clipboard.writeText(editor.getHTML())
        }
    }, [editor])

    if (!editor) {
        return null
    }

    const ToolbarButton = ({
        isActive = false,
        onClick,
        children,
        title
    }: {
        isActive?: boolean
        onClick: () => void
        children: React.ReactNode
        title?: string
    }) => (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClick}
            className={cn(
                "h-8 w-8 p-0",
                isActive && "bg-muted"
            )}
            title={title}
        >
            {children}
        </Button>
    )

    return (
        <div className={cn("border rounded-md bg-background", className)}>
            {/* Toolbar */}
            {editable && (
                <div className="flex flex-wrap items-center gap-0.5 p-1 border-b bg-muted/30">
                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleBold().run()}
                        isActive={editor.isActive('bold')}
                        title="Bold"
                    >
                        <Bold className="h-4 w-4" />
                    </ToolbarButton>

                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleItalic().run()}
                        isActive={editor.isActive('italic')}
                        title="Italic"
                    >
                        <Italic className="h-4 w-4" />
                    </ToolbarButton>

                    <div className="w-px h-6 bg-border mx-1" />

                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
                        isActive={editor.isActive('heading', { level: 1 })}
                        title="Heading 1"
                    >
                        <Heading1 className="h-4 w-4" />
                    </ToolbarButton>

                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                        isActive={editor.isActive('heading', { level: 2 })}
                        title="Heading 2"
                    >
                        <Heading2 className="h-4 w-4" />
                    </ToolbarButton>

                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                        isActive={editor.isActive('heading', { level: 3 })}
                        title="Heading 3"
                    >
                        <Heading3 className="h-4 w-4" />
                    </ToolbarButton>

                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
                        isActive={editor.isActive('heading', { level: 4 })}
                        title="Heading 4"
                    >
                        <Heading4 className="h-4 w-4" />
                    </ToolbarButton>

                    <div className="w-px h-6 bg-border mx-1" />

                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleBulletList().run()}
                        isActive={editor.isActive('bulletList')}
                        title="Bullet List"
                    >
                        <List className="h-4 w-4" />
                    </ToolbarButton>

                    <ToolbarButton
                        onClick={() => editor.chain().focus().toggleOrderedList().run()}
                        isActive={editor.isActive('orderedList')}
                        title="Numbered List"
                    >
                        <ListOrdered className="h-4 w-4" />
                    </ToolbarButton>

                    <div className="w-px h-6 bg-border mx-1" />

                    <ToolbarButton
                        onClick={() => editor.chain().focus().undo().run()}
                        title="Undo"
                    >
                        <Undo className="h-4 w-4" />
                    </ToolbarButton>

                    <ToolbarButton
                        onClick={() => editor.chain().focus().redo().run()}
                        title="Redo"
                    >
                        <Redo className="h-4 w-4" />
                    </ToolbarButton>

                    <div className="flex-1" />

                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={copyToClipboard}
                        className="h-8 px-2 gap-1"
                        title="Copy HTML"
                    >
                        <Copy className="h-3.5 w-3.5" />
                        <span className="text-xs">Copy HTML</span>
                    </Button>
                </div>
            )}

            {/* Editor Content */}
            <EditorContent editor={editor} />

            {/* Placeholder when empty */}
            {editor.isEmpty && (
                <div className="absolute top-[45px] left-4 text-muted-foreground pointer-events-none">
                    {placeholder}
                </div>
            )}
        </div>
    )
}

// Read-only preview version
export function RichTextPreview({ content, className }: { content: string, className?: string }) {
    return (
        <RichTextEditor
            content={content}
            editable={false}
            className={className}
        />
    )
}
