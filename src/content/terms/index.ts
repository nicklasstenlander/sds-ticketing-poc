// Register över köpvillkorstexter per arrangörsslug (ordern "Köpvillkor
// som egen sida i Rideau" 2026-10-07, punkt 1). Ren filbaserad lösning -
// INGEN databasstyrning ännu (medvetet, se ordertexten) - en ny arrangör
// får egna villkor genom en ny fil här, importerad och tillagd nedan.
import * as sds from './sds'

export interface TermsContent {
  DRAFT: boolean
  VERSION: number
  LAST_UPDATED: string
  TITLE: string
  BODY: string
}

export const TERMS_BY_SLUG: Record<string, TermsContent> = {
  sds,
}
