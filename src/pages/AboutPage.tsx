import { Layout } from '../components/Layout'

const FEATURES = [
  {
    title: 'Välj och betala på någon minut.',
    text: 'Välj föreställning och biljettyper, lägg flera biljetter i samma köp och betala tryggt med kort. Priset du ser är priset du betalar.',
  },
  {
    title: 'Biljetten kommer direkt i din inkorg.',
    text: 'Direkt efter betalningen får du ett bekräftelsemejl med din biljett och en personlig QR-kod. Visa den på mobilen, ingen utskrift behövs.',
  },
  {
    title: 'Snabb incheckning.',
    text: 'I entrén skannar vi QR-koden med Rideaus egen skannerapp, så att kön rör sig och varje biljett bara kan användas en gång.',
  },
  {
    title: 'Rättvist för alla platser.',
    text: 'Platserna i salongen delas mellan alla biljettyper, och även gratisbiljetter för de minsta räknas mot kapaciteten, så att det aldrig säljs fler biljetter än det finns platser.',
  },
]

// /om - "Om Rideau". Texten är Nicklas egen (utkast 2026-10-16).
export function AboutPage() {
  return (
    <Layout
      dark
      termsSlug="sds"
      hero={
        <>
          <h1 className="page-title">Om Rideau</h1>
          <p className="page-lede">Biljetter till scenen, utan krångel.</p>
        </>
      }
    >
      <div className="prose-page">
        <p className="prose-lead">
          Rideau är biljettsystemet bakom Sollentuna Dans &amp; Scenskolas föreställningar. Namnet kommer från franskans
          ord för ridå, den som går upp när det är dags.
        </p>
        <p>
          Vi byggde Rideau för att köpet av en biljett ska vara lika enkelt som att komma till föreställningen:
        </p>
        <ul className="feature-list">
          {FEATURES.map((f) => (
            <li key={f.title}>
              <strong>{f.title}</strong>
              <span>{f.text}</span>
            </li>
          ))}
        </ul>
        <h2>Trygghet</h2>
        <p>
          Betalningen hanteras av Stripe, och vi sparar inga kortuppgifter. Dina uppgifter använder vi bara för att
          skicka din biljett och hantera ditt köp.
        </p>
      </div>
    </Layout>
  )
}
