export function Spinner({ className = '' }: { className?: string }) {
  return (
    <div className={`inline-block w-6 h-6 border-2 border-[var(--color-border)] border-t-[var(--color-accent)] rounded-full animate-spin ${className}`} />
  )
}
