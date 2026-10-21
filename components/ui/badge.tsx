import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex h-5 w-fit items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-md border px-2 py-0 text-xs font-medium shrink-0 [&>svg]:size-3 [&>svg]:pointer-events-none transition-colors",
  {
    variants: {
      variant: {
        default: "border-[var(--color-border)] bg-[var(--color-bg-muted)] text-[var(--color-text-secondary)] [a&]:hover:bg-[var(--color-bg-muted-hover)]",
        secondary:
          "border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] shadow-button-raised [a&]:hover:bg-[var(--color-bg-muted)]",
        destructive:
          "bg-[var(--color-negative)] text-white [a&]:hover:opacity-90",
        outline:
          "border-[var(--color-border)] text-[var(--color-text-secondary)] [a&]:hover:bg-[var(--color-bg-muted)] [a&]:hover:text-[var(--color-text)]",
        ghost: "[a&]:hover:bg-[var(--color-bg-muted)] [a&]:hover:text-[var(--color-text)]",
        link: "text-[var(--color-brand)] underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
