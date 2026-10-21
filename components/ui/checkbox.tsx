"use client"

import * as React from "react"
import { CheckIcon } from "@/components/icons"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 rounded-[4px] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-bg)] transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:border-[var(--color-text)] data-[state=checked]:bg-[var(--color-text)] data-[state=checked]:text-[var(--color-bg)]",
        "focus-visible:border-[var(--color-text-muted)] focus-visible:ring-2 focus-visible:ring-[var(--color-border-subtle)]",
        "aria-invalid:border-destructive",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
