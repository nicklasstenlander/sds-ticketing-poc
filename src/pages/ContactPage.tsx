import { Layout } from '../components/Layout'

// /kontakt. Uppgifterna är hämtade ur köpvillkoren (src/content/terms/sds.ts,
// punkt 1) så att sajten säger samma sak överallt - ändras de där, ändra här.
const EMAIL = 'info@sollentunadansochscenskola.se'

export function ContactPage() {
  return (
    <Layout
      dark
      termsSlug="sds"
      hero={
        <>
          <h1 className="page-title">Kontakt</h1>
          <p className="page-lede">Frågor om din biljett eller ditt köp? Hör av dig.</p>
        </>
      }
    >
      <div className="prose-page">
        <p className="prose-lead">
          Skriv till oss på{' '}
          <a className="link-accent" href={`mailto:${EMAIL}`}>
            {EMAIL}
          </a>
          .
        </p>
        <p>
          Berätta gärna vilken föreställning det gäller och vilken e-postadress du köpte med, så hittar vi ditt köp
          snabbare. Har du inte fått något bekräftelsemejl inom några minuter: titta i skräpposten först.
        </p>
        <h2>Vem säljer biljetterna</h2>
        <p>
          Biljetterna säljs av Moon Movements AB, som driver Sollentuna Dans &amp; Scenskola.
        </p>
        <dl className="contact-facts">
          <div>
            <dt>Organisationsnummer</dt>
            <dd>559317-1936</dd>
          </div>
          <div>
            <dt>Adress</dt>
            <dd>Grekfararvägen 7</dd>
          </div>
          <div>
            <dt>E-post</dt>
            <dd>
              <a className="link-accent" href={`mailto:${EMAIL}`}>
                {EMAIL}
              </a>
            </dd>
          </div>
        </dl>
      </div>
    </Layout>
  )
}
