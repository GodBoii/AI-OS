export default function StarMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="50" cy="50" r="29" stroke="currentColor" strokeWidth="1" />
      <path
        d="M50 2C48 38 38 48 2 50C38 52 48 62 50 98C52 62 62 52 98 50C62 48 52 38 50 2Z"
        fill="currentColor"
      />
    </svg>
  );
}
