"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Activity,
  FileText,
  FolderGit2,
  History,
  Inbox,
  Network,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"

type NavItem = {
  href: string
  label: string
  icon: LucideIcon
}

const primaryNav: NavItem[] = [
  { href: "/repos", label: "Repos", icon: FolderGit2 },
  { href: "/queue", label: "Queue", icon: Inbox },
  { href: "/control", label: "Control", icon: Activity },
]

const secondaryNav: NavItem[] = [
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/config", label: "Config", icon: Settings },
]

const floNav: NavItem[] = [
  { href: "/swarm", label: "Swarm", icon: Network },
  { href: "/sessions", label: "Sessions", icon: History },
  { href: "/capabilities", label: "Capabilities", icon: Sparkles },
]

export const NAV_ITEMS: NavItem[] = [...primaryNav, ...secondaryNav, ...floNav]

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/"
  return pathname === href || pathname.startsWith(`${href}/`)
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem
  active: boolean
  onNavigate?: () => void
}) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      data-active={active || undefined}
      className={cn(
        "group/nav flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors",
        "hover:bg-muted hover:text-foreground",
        "focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        "data-[active]:bg-muted data-[active]:text-foreground data-[active]:font-medium"
      )}
    >
      <Icon className="size-4 shrink-0 opacity-70 group-data-[active]/nav:opacity-100" />
      <span className="truncate">{item.label}</span>
    </Link>
  )
}

function NavSection({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[]
  pathname: string
  onNavigate?: () => void
}) {
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => (
        <li key={item.href}>
          <NavLink
            item={item}
            active={isActive(pathname, item.href)}
            onNavigate={onNavigate}
          />
        </li>
      ))}
    </ul>
  )
}

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center px-5">
        <Link
          href="/"
          onClick={onNavigate}
          className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-foreground/80 transition-colors hover:text-foreground"
        >
          myflo
        </Link>
      </div>

      <Separator />

      <ScrollArea className="flex-1">
        <nav aria-label="Primary" className="flex flex-col gap-4 px-3 py-4">
          <NavSection
            items={primaryNav}
            pathname={pathname}
            onNavigate={onNavigate}
          />

          <Separator />

          <NavSection
            items={secondaryNav}
            pathname={pathname}
            onNavigate={onNavigate}
          />

          <Separator />

          <div className="flex flex-col gap-2">
            <p className="px-2.5 font-mono text-[0.6rem] uppercase tracking-[0.22em] text-muted-foreground/70">
              flo
            </p>
            <NavSection
              items={floNav}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          </div>
        </nav>
      </ScrollArea>

      <div className="px-5 pb-4 pt-2">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground/70">
          localhost only
        </p>
      </div>
    </div>
  )
}

export function getActiveNavLabel(pathname: string): string {
  const match = NAV_ITEMS.find((item) => isActive(pathname, item.href))
  return match?.label ?? "Overview"
}
