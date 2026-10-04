-- Steg 1b (ordern "Schemalagt biljettsläpp" 2026-10-03) - verifieringsfråga
-- för Nicklas. Rent läsande (SELECT), ändrar ingen data. Kör i SQL Editor.
--
-- Syfte: innan 1b-fixen (starts_at skickades/tolkades fel i vissa fall,
-- se steg 1-rapporten) kan enstaka event ha fått fel klockslag sparat.
-- Den här frågan visar varje events starts_at BÅDE i UTC (som det ligger
-- lagrat) och omräknat till Europe/Stockholm, så att det går att se för
-- ögat om något ser fel ut (t.ex. en föreställning som "borde" vara kl.
-- 19:00 men visar något annat i Stockholm-kolumnen).
--
-- Ingen rad behöver nödvändigtvis vara fel - det här är en kontroll, inte
-- ett bevis på att något gick snett.
select
  id,
  slug,
  title,
  status,
  starts_at as starts_at_utc,
  starts_at at time zone 'Europe/Stockholm' as starts_at_stockholm,
  sales_open_at as sales_open_at_utc,
  sales_open_at at time zone 'Europe/Stockholm' as sales_open_at_stockholm
from events
where starts_at is not null
order by starts_at;
