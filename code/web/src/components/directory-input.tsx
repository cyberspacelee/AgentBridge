import { useState, type ComponentProps } from "react"
import { FolderOpen } from "lucide-react"
import { desktop } from "@/lib/desktop"
import { Failure, IconButton } from "@/components/workspace-ui"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"

export function DirectoryInput({
  value,
  onValueChange,
  disabled,
  ...props
}: Omit<ComponentProps<typeof InputGroupInput>, "value" | "onChange"> & {
  value: string
  onValueChange: (path: string) => void
}) {
  const [choosing, setChoosing] = useState(false)
  const [error, setError] = useState<Error>()
  async function choose() {
    setChoosing(true)
    setError(undefined)
    try {
      const path = await desktop?.selectDirectory()
      if (path) onValueChange(path)
    } catch (error) {
      setError(error as Error)
    } finally {
      setChoosing(false)
    }
  }
  return (
    <>
      <InputGroup>
        <InputGroupInput
          {...props}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          disabled={disabled || choosing}
        />
        {desktop && (
          <InputGroupAddon align="inline-end">
            <IconButton
              type="button"
              label="选择目录"
              disabled={disabled || choosing}
              onClick={() => void choose()}
            >
              <FolderOpen />
            </IconButton>
          </InputGroupAddon>
        )}
      </InputGroup>
      <Failure error={error} />
    </>
  )
}
