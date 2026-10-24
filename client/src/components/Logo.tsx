export function Logo({ className, light = true }: { className?: string; light?: boolean }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M8 27V14a8 8 0 0 1 16 0v13z" fill={light ? '#e9f4f1' : '#101614'} />
      <path d="M8 20.5c3-2 5 1 8-1s5-2 8-0.5M8 24c3-2 5 1 8-1s5-2 8-0.5" stroke={light ? '#16807a' : '#7fd1c7'} strokeWidth="1.5" fill="none" />
    </svg>
  );
}
