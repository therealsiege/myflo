"use client"

import { useState } from "react"
import { usePathname } from "next/navigation"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { Menu, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { AppSidebar, getActiveNavLabel } from "@/components/app-sidebar"

const SIDEBAR_WIDTH = "w-[220px]"

function StatusPill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-2.5 py-1 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted-foreground">
      <span
        aria-hidden
        className="size-1.5 rounded-full bg-muted-foreground/50"
      />
      siege: idle
    </span>
  )
}

function TopBar({
  title,
  onOpenMenu,
}: {
  title: string
  onOpenMenu: () => void
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-sm supports-backdrop-filter:bg-background/70 md:px-6">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Open navigation"
        onClick={onOpenMenu}
        className="md:hidden"
      >
        <Menu />
      </Button>
      <h1 className="text-sm font-medium tracking-tight text-foreground">
        {title}
      </h1>
      <div className="ml-auto flex items-center gap-2">
        <StatusPill />
      </div>
    </header>
  )
}

function MobileNav({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className={cn(
            "fixed inset-0 z-40 bg-background/60 supports-backdrop-filter:backdrop-blur-sm",
            "duration-150 data-open:animate-in data-open:fade-in-0",
            "data-closed:animate-out data-closed:fade-out-0"
          )}
        />
        <DialogPrimitive.Popup
          aria-label="Navigation"
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex w-[260px] max-w-[80vw] flex-col border-r border-border bg-sidebar outline-none",
            "duration-200 data-open:animate-in data-open:slide-in-from-left",
            "data-closed:animate-out data-closed:slide-out-to-left"
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            Navigation
          </DialogPrimitive.Title>
          <DialogPrimitive.Close
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute right-2 top-2.5"
              />
            }
          >
            <X />
            <span className="sr-only">Close navigation</span>
          </DialogPrimitive.Close>
          <AppSidebar onNavigate={() => onOpenChange(false)} />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  const title = getActiveNavLabel(pathname)

  return (
    <div className="flex min-h-svh w-full bg-background">
      <aside
        className={cn(
          "hidden border-r border-border md:flex md:flex-col",
          SIDEBAR_WIDTH
        )}
      >
        <AppSidebar />
      </aside>

      <MobileNav open={mobileOpen} onOpenChange={setMobileOpen} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={title} onOpenMenu={() => setMobileOpen(true)} />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  )
}
