import { api } from "@/lib/api"
import type { DirectoryView } from "../../../shared/system"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
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
  const [browsing, setBrowsing] = useState(false)
  const [listing, setListing] = useState<DirectoryView>()
  async function browse(directory?: string) {
    setChoosing(true)
    setError(undefined)
    try {
      setListing(
        await api<DirectoryView>(
          `/api/system/directories${directory ? `?directory=${encodeURIComponent(directory)}` : ""}`
        )
      )
    } catch (error) {
      setError(error as Error)
    } finally {
      setChoosing(false)
    }
  }
  async function choose() {
    if (!desktop) {
      setBrowsing(true)
      await browse(value || undefined)
      return
    }
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
        {
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
        }
      </InputGroup>
      {!browsing && <Failure error={error} />}
      <Dialog open={browsing} onOpenChange={setBrowsing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>选择服务器目录</DialogTitle>
            <DialogDescription>
              任务和 Skill 在执行主机上读取此路径。
            </DialogDescription>
          </DialogHeader>
          <Failure error={error} />
          <p className="text-sm break-all">
            {listing?.directory ?? "允许访问的根目录"}
          </p>
          <div
            className="flex max-h-80 flex-col gap-2 overflow-y-auto"
            aria-busy={choosing}
          >
            <Button
              type="button"
              variant="outline"
              disabled={choosing}
              onClick={() => void browse()}
            >
              根目录
            </Button>
            {listing?.parent && (
              <Button
                type="button"
                variant="outline"
                disabled={choosing}
                onClick={() => void browse(listing.parent!)}
              >
                上一级
              </Button>
            )}
            {listing?.entries.map((entry) => (
              <Button
                type="button"
                variant="ghost"
                className="justify-start"
                key={entry.path + entry.name}
                disabled={choosing}
                onClick={() => void browse(entry.path)}
              >
                <FolderOpen data-icon="inline-start" />
                {entry.name}
              </Button>
            ))}
            {listing?.truncated && (
              <p className="text-sm text-muted-foreground">
                目录过多，仅显示前 500 项；可直接输入完整路径。
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setBrowsing(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={choosing || !listing?.directory}
              onClick={() => {
                onValueChange(listing!.directory!)
                setBrowsing(false)
              }}
            >
              使用此目录
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
