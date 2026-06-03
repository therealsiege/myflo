"use client"

import * as React from "react"
import { Loader2Icon, OctagonXIcon, SquareIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export interface SiegeKillControlsProps {
  disabled: boolean
  killingGraceful: boolean
  killingForce: boolean
  onKill: (force: boolean) => Promise<{ ok: boolean }>
}

export function SiegeKillControls({
  disabled,
  killingGraceful,
  killingForce,
  onKill,
}: SiegeKillControlsProps) {
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const anyKilling = killingGraceful || killingForce

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || anyKilling}
        onClick={() => {
          void onKill(false)
        }}
      >
        {killingGraceful ? (
          <Loader2Icon data-icon="inline-start" className="animate-spin" />
        ) : (
          <SquareIcon data-icon="inline-start" />
        )}
        Kill
      </Button>

      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={disabled || anyKilling}
        onClick={() => setConfirmOpen(true)}
      >
        {killingForce ? (
          <Loader2Icon data-icon="inline-start" className="animate-spin" />
        ) : (
          <OctagonXIcon data-icon="inline-start" />
        )}
        Force kill
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Force kill siege?</DialogTitle>
            <DialogDescription>
              Sends <span className="font-mono">SIGKILL</span> to every active
              siege process. In-flight items will not finish or clean up.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false)
                void onKill(true)
              }}
            >
              Force kill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
