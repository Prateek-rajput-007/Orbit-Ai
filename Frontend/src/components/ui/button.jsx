import { cva } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-accent text-night hover:bg-accent-dark",
        outline: "border border-white/10 bg-white/5 text-ink-soft hover:bg-white/10 hover:text-ink",
        secondary: "bg-accent-soft text-accent-ink hover:bg-accent-pale",
        ghost: "text-muted hover:bg-white/5 hover:text-ink",
        destructive: "bg-red-500/10 text-red-300 hover:bg-red-500/20",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-3",
        xs: "h-6 px-2 text-xs",
        sm: "h-8 px-2.5 text-xs",
        lg: "h-10 px-4",
        icon: "size-8",
        "icon-xs": "size-6",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
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

export { Button }
