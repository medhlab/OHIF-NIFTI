"""Narrow repair for a model-capitalized clause; never fuzzy text matching."""

def initial_capitalization_span(text, quote):
    if not isinstance(quote, str):
        return None
    quote = quote.strip()
    if not quote or not ('A' <= quote[0] <= 'Z'):
        return None
    restored = quote[0].lower() + quote[1:]
    # All remaining characters (including punctuation/spacing) must be exact.
    # Do not select among multiple case variants or repeated clauses.
    hits = []
    for variant in (quote, restored):
        cursor = 0
        while (start := text.find(variant, cursor)) >= 0:
            hits.append((start, start + len(variant)))
            cursor = start + 1
    if len(hits) != 1 or text[hits[0][0]:hits[0][1]] != restored:
        return None
    return hits[0]
