import { BookOpenCheck } from 'lucide-react'
import { Link } from 'react-router'
import { chartProfileNavigation } from '@/lib/trader/journalNavigation'
import { ChromeIcon } from '@/lib/trading/glyphs'
import { cn } from '@/lib/utils'
import { Tip } from './Tip'
import { TB_BTN } from './toolbarStyles'

/** Preserve the terminal's existing back-link position and compact controls. */
export function ChartProfileNavigation({
  params,
  returnHref,
  returnLabel,
}: {
  params: URLSearchParams
  returnHref?: string
  returnLabel?: string
}) {
  const navigation = chartProfileNavigation(params)
  return (
    <>
      <Tip
        tip={{
          title: returnLabel ?? navigation.backLabel,
          sub: navigation.returningToJournal
            ? 'Return to your journal view'
            : 'Return to the selected chart context',
        }}
      >
        <Link
          to={returnHref ?? navigation.backHref}
          aria-label={
            returnLabel
              ? `Back to ${returnLabel}`
              : navigation.profileId
                ? `Back to ${navigation.backLabel}`
                : 'Workspace'
          }
          className={cn(TB_BTN, 'ml-1 gap-1')}
        >
          <ChromeIcon id="chevron-left" size={14} className="opacity-70" />
          <span className="hidden max-w-40 truncate md:inline">
            {returnLabel ?? navigation.backLabel}
          </span>
        </Link>
      </Tip>
      {navigation.journalHref && !navigation.returningToJournal && (
        <Tip tip={{ title: 'Journal', sub: `Review ${navigation.name}` }}>
          <Link
            to={navigation.journalHref}
            aria-label={`Open ${navigation.name} journal`}
            className={cn(TB_BTN, 'px-2')}
          >
            <BookOpenCheck className="h-4 w-4" />
          </Link>
        </Tip>
      )}
    </>
  )
}
