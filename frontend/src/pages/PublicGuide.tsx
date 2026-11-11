import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { findPublicGuide, publicGuides } from '@/config/publicPages'
import { Brand, OpenWorkspace, ProductPreview } from '@/pages/Home'

export default function PublicGuide() {
  const { slug = '' } = useParams()
  const guide = findPublicGuide(slug)

  return (
    <div className="product-home">
      <a href="#guide-main" className="product-home-skip">
        Skip to content
      </a>
      <header className="product-home-header">
        <div className="product-home-wrap product-guide-nav">
          <Brand />
          <OpenWorkspace compact />
        </div>
      </header>
      <main id="guide-main" tabIndex={-1}>
        {guide ? (
          <article className="product-home-wrap product-guide">
            <Link to="/" reloadDocument className="product-home-text-link product-guide-back">
              <ArrowLeft aria-hidden="true" /> Back to Chartly
            </Link>
            <h1>{guide.heading}</h1>
            <p className="product-guide-summary">{guide.summary}</p>
            <ProductPreview
              src={guide.image}
              title={guide.imageCaption}
              detail="Sample data"
              width={guide.imageWidth}
              height={guide.imageHeight}
              description={guide.imageAlt}
              priority
            />
            <div className="product-guide-content">
              {guide.sections.map((section) => (
                <section key={section.heading}>
                  <h2>{section.heading}</h2>
                  <p>{section.text}</p>
                  {section.steps && (
                    <ol>
                      {section.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  )}
                </section>
              ))}
              {guide.sources && (
                <ul className="product-guide-sources" aria-label="TradingView documentation">
                  {guide.sources.map((source) => (
                    <li key={source.url}>
                      <a href={source.url}>{source.label}</a>
                    </li>
                  ))}
                </ul>
              )}
              <OpenWorkspace />
            </div>
            <nav aria-label="Related Chartly guides" className="product-home-guide-index">
              <h2>Related guides</h2>
              <ul>
                {Object.entries(publicGuides)
                  .filter(([id]) => id !== slug)
                  .map(([id, related]) => (
                    <li key={id}>
                      <Link to={`/guides/${id}`} reloadDocument>
                        {related.label} <ArrowRight aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
              </ul>
            </nav>
          </article>
        ) : (
          <div className="product-home-wrap product-home-section">
            <h1>Guide unavailable</h1>
            <Link to="/" reloadDocument className="product-home-text-link">
              Back to Chartly
            </Link>
          </div>
        )}
      </main>
    </div>
  )
}
