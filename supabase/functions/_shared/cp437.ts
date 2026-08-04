// Minimal CP437-kodare (IBM PC/DOS-teckentabellen) för SIE4-filer.
//
// SIE4-standarden kräver CP437, inte UTF-8/Latin-1/Windows-1252. Vi
// implementerar bara ASCII (0-127, identiskt i alla dessa kodningar) plus
// de svenska tecken som faktiskt kan förekomma i denna export (företagsnamn,
// kontonamn, momstexter) - inte en fullständig CP437-tabell. Tecken utanför
// denna lilla uppsättning ersätts med "?" hellre än att producera en trasig
// fil.
const SWEDISH_TO_CP437: Record<string, number> = {
  é: 0x82,
  ü: 0x81,
  è: 0x8a,
  É: 0x90,
  ä: 0x84,
  Ä: 0x8e,
  å: 0x86,
  Å: 0x8f,
  ö: 0x94,
  Ö: 0x99,
}

/** Kodar en sträng till CP437-bytes, för SIE4-filens teckenkodningskrav. */
export function encodeCp437(input: string): Uint8Array {
  // NFC-normalisering INNAN vi itererar tecken för tecken. Utan detta steg
  // mappas bara EN sammansatt karaktär korrekt ("ö" som en enda kodpunkt,
  // U+00F6) - kommer texten istället in i "uppdelad" (NFD) form, t.ex. "o"
  // (U+006F) + en separat kombinerande trema (U+0308), matchar den lösa "o"
  // ASCII-grenen (< 128) och trema-tecknet hamnar som "?" via fallbacken.
  // Källor till NFD-text är svåra att utesluta helt (klipp-och-klistra från
  // PDF:er, vissa tangentbords-/OS-kombinationer) så normalisering görs
  // alltid, inte bara "vid behov".
  const normalized = input.normalize('NFC')
  const bytes: number[] = []
  for (const ch of normalized) {
    const code = ch.codePointAt(0) ?? 0x3f
    if (code < 128) {
      bytes.push(code)
      continue
    }
    const mapped = SWEDISH_TO_CP437[ch]
    bytes.push(mapped ?? 0x3f) // "?" som fallback för okodbara tecken
  }
  return new Uint8Array(bytes)
}
