export type SearchEntry = { title: string; url: string; text: string; section: string; headings: string };

/** Prefer explicit topics over incidental body references; never hide matching guides behind a cutoff. */
export function searchDocs(index: SearchEntry[], query: string) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return index.slice(0, 10);
  return index
    .filter((entry) =>
      terms.every((term) => `${entry.title} ${entry.headings} ${entry.text}`.toLowerCase().includes(term)),
    )
    .map((entry) => ({
      entry,
      score: terms.reduce(
        (score, term) =>
          score +
          (entry.title.toLowerCase().includes(term) ? 10 : 0) +
          (entry.headings.toLowerCase().includes(term) ? 5 : 0),
        0,
      ),
    }))
    .sort((a, b) => b.score - a.score)
    .map(({ entry }) => entry);
}
