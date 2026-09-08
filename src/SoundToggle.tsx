export function SoundToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`sound${on ? ' on' : ''}`}
      onClick={onToggle}
      aria-pressed={on}
      aria-label={on ? 'Mute melting sound' : 'Unmute melting sound'}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          d="M4 9.5h3.2L12 5.5v13L7.2 14.5H4z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        {on ? (
          <>
            <path d="M15.4 9.2a4 4 0 0 1 0 5.6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            <path d="M18 6.8a7.6 7.6 0 0 1 0 10.4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </>
        ) : (
          <path d="M16 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        )}
      </svg>
    </button>
  )
}
