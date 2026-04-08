import {Pencil} from "lucide-react"
import {useEffect, useRef, useState} from "react"

const EditableTitle = ({
    value,
    onSave,
    disabled = false,
    className = "",
}: {
    value: string
    onSave: (newValue: string) => void
    disabled?: boolean
    className?: string
}) => {
    const [isEditing, setIsEditing] = useState(false)
    const [editValue, setEditValue] = useState(value)
    const pendingValueRef = useRef<string | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    // Clear pending value when the save completes (disabled transitions to false)
    // Handles both success (value matches) and failure (reverts to original value)
    useEffect(() => {
        if (!disabled) {
            pendingValueRef.current = null
        }
    }, [disabled])

    // Focus and select text when entering edit mode
    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus()
            inputRef.current.select()
        }
    }, [isEditing])

    const displayValue = pendingValueRef.current ?? value

    const handleSave = () => {
        const trimmed = editValue.trim()

        if (!trimmed || trimmed === displayValue) {
            setEditValue(displayValue)
            setIsEditing(false)
            return
        }

        pendingValueRef.current = trimmed
        onSave(trimmed)
        setIsEditing(false)
    }

    if (isEditing) {
        return (
            <input
                ref={inputRef}
                type="text"
                className={`${className} bg-transparent border-b-2 border-primary outline-none w-full`}
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onKeyDown={e => {
                    if (e.key === "Enter") {
                        e.preventDefault()
                        handleSave()
                    }
                    if (e.key === "Escape") {
                        setEditValue(displayValue)
                        setIsEditing(false)
                    }
                }}
                onBlur={handleSave}
                disabled={disabled}
            />
        )
    }

    return (
        <button
            type="button"
            className={`${className} group inline-flex items-center gap-2 cursor-pointer hover:opacity-70 transition-opacity text-left border-b-2 border-transparent`}
            onClick={() => {
                if (disabled) return
                setEditValue(displayValue)
                setIsEditing(true)
            }}
        >
            {displayValue}
            <Pencil className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        </button>
    )
}

export {EditableTitle}
