import type { CSSProperties } from 'react'
import { FrostField } from './FrostField'
import { GlazeCeiling } from './GlazeCeiling'

const WEEDMAPS = 'https://weedmaps.com/deliveries/frost-12'

export function Info() {
  return (
    <main className="info">
      <FrostField />
      <GlazeCeiling />

      <a className="info-back" href="#/" aria-label="Back to the melt">
        ↶
      </a>

      <div className="info-inner">
        <h1 className="info-title rise" style={{ '--r': 0 } as CSSProperties}>
          The Best Cannabis delivery platform is on the way
        </h1>

        <p className="info-sub rise" style={{ '--r': 1 } as CSSProperties}>
          Stay in touch while we melt it
        </p>

        <div className="info-actions rise" style={{ '--r': 2 } as CSSProperties}>
          <a className="info-phone" href="tel:+14248444444">
            (424) 844-4444
          </a>
          <a className="info-cta" href={WEEDMAPS} target="_blank" rel="noopener noreferrer">
            Order now
          </a>
        </div>

        <p className="info-listing rise" style={{ '--r': 3 } as CSSProperties}>
          Frost Menu, Reviews, Deals — Weed Delivery in North Hollywood, California
        </p>
      </div>

      <p className="info-license rise" style={{ '--r': 4 } as CSSProperties}>
        License Number: C9-0000707-LIC
      </p>
    </main>
  )
}
