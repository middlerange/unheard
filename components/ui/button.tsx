import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border text-sm font-medium transition-colors select-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]",
  {
    variants: {
      variant: {
        default: "border-[var(--color-accent)] bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] active:bg-[var(--color-accent-hover)]",
        destructive:
          "border-[var(--color-negative)] bg-[var(--color-negative)] text-white hover:opacity-95",
        outline:
          "border-[var(--color-border-opaque)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted-hover)] hover:text-[var(--color-text)]",
        secondary:
          "border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] enabled:hover:bg-[var(--color-bg-muted-hover)] enabled:hover:text-[var(--color-text)] enabled:active:text-[var(--color-text)] enabled:data-[active=true]:text-[var(--color-text)] data-[state=on]:bg-[var(--color-bg-muted)] data-[state=on]:text-[var(--color-text)] focus-visible:text-[var(--color-text)]",
        ghost:
          "border-transparent bg-transparent text-[var(--color-text-muted)] shadow-none hover:border-transparent hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text)] active:bg-[var(--color-bg-muted-hover)]",
        link: "text-[var(--color-brand)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 px-3 has-[>svg]:px-2.5",
        lg: "h-10 px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
