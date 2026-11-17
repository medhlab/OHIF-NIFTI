"""Build auditable Medical Imaging Studio finding-ingestion payloads.

The Studio API deliberately keeps the standardized ReX finding text separate from
the verbatim report evidence.  This module resolves and validates that evidence
locally so an LLM can never invent offsets or source text accepted by the pipeline.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Literal


ReportSection = Literal["findings", "impressions"]
REPORT_SECTIONS: tuple[ReportSection, ...] = ("findings", "impressions")
CONTRACT_VERSION = "medical-imaging-studio.agent-findings/v1"
SENTENCE_END = re.compile(r"(?:[.!?;]+[\"')\]]*|\n+)(?=\s|$)")
TOKEN = re.compile(r"[a-z0-9]+")
ABBREVIATIONS = (
    "e.g.", "i.e.", "dr.", "mr.", "mrs.", "vs.", "etc.",
    "cm.", "mm.", "ml.", "sec.", "min.", "no.",
)
STOP_WORDS = frozenset({
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have",
    "in", "is", "it", "of", "on", "or", "that", "the", "there", "to", "was", "were",
    "with",
})
NEGATION_TOKENS = frozenset({"no", "not", "without", "absent", "absence", "negative", "free"})
LATERALITY_TOKENS = frozenset({"left", "right", "bilateral"})
LOCATION_TOKENS = frozenset({"upper", "middle", "lower", "apical", "basal", "base", "lobe"})
TOKEN_ALIASES = {
    "both": "bilateral",
    "bases": "base",
    "pulmonary": "lung",
    "lungs": "lung",
    "nodules": "nodule",
    "masses": "mass",
    "opacities": "opacity",
    "effusions": "effusion",
    "fibrotic": "fibrosis",
    "honeycombing": "honeycomb",
    "appearances": "appearance",
}


@dataclass(frozen=True)
class SentenceSpan:
    section: ReportSection
    index: int
    start: int
    end: int
    text: str


@dataclass(frozen=True)
class AlignmentResult:
    status: str
    span: dict[str, object] | None = None
    score: float | None = None
    margin: float | None = None
    runner_up: dict[str, object] | None = None


def _trimmed_span(text: str, start: int, end: int) -> tuple[int, int] | None:
    while start < end and text[start].isspace():
        start += 1
    while end > start and text[end - 1].isspace():
        end -= 1
    return (start, end) if end > start else None


def split_sentences(text: str, section: ReportSection = "findings") -> list[SentenceSpan]:
    """Split report text while retaining exact, end-exclusive source offsets."""
    spans: list[SentenceSpan] = []
    start = 0
    for boundary in SENTENCE_END.finditer(text):
        end = boundary.end()
        candidate = text[start:end].rstrip()
        if candidate.casefold().endswith(ABBREVIATIONS) and "\n" not in boundary.group(0):
            # A unit abbreviation may also terminate a sentence. Do not absorb
            # the following observation into "... 9 mm. In the neighborhood...".
            unit_at_sentence_end = (candidate.casefold().endswith(("cm.", "mm.", "ml."))
                                    and re.match(r"\s+[A-Z]", text[end:]) is not None)
            if not unit_at_sentence_end:
                continue
        trimmed = _trimmed_span(text, start, end)
        if trimmed:
            left, right = trimmed
            spans.append(SentenceSpan(section, len(spans), left, right, text[left:right]))
        start = end
    trimmed = _trimmed_span(text, start, len(text))
    if trimmed:
        left, right = trimmed
        spans.append(SentenceSpan(section, len(spans), left, right, text[left:right]))
    return spans


def _normalized_tokens(text: str) -> list[str]:
    normalized = unicodedata.normalize("NFKC", text).casefold().replace("ground-glass", "groundglass")
    tokens: list[str] = []
    for token in TOKEN.findall(normalized):
        token = TOKEN_ALIASES.get(token, token)
        if token not in STOP_WORDS:
            tokens.append(token)
    return tokens


def normalize_text(text: str) -> str:
    return " ".join(_normalized_tokens(text))


def sentence_similarity(left_text: str, right_text: str) -> float:
    left_tokens = _normalized_tokens(left_text)
    right_tokens = _normalized_tokens(right_text)
    left = " ".join(left_tokens)
    right = " ".join(right_tokens)
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    overlap = sum((Counter(left_tokens) & Counter(right_tokens)).values())
    precision = overlap / len(left_tokens)
    recall = overlap / len(right_tokens)
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    containment = overlap / min(len(left_tokens), len(right_tokens))
    sequence = SequenceMatcher(None, left, right, autojunk=False).ratio()
    score = 0.5 * f1 + 0.3 * sequence + 0.2 * containment
    if left in right or right in left:
        score = max(score, 0.9 * containment)
    if len(left_tokens) >= 3 and set(left_tokens).issubset(set(right_tokens)):
        score = max(score, 0.84)

    left_set = set(left_tokens)
    right_set = set(right_tokens)
    if bool(left_set & NEGATION_TOKENS) != bool(right_set & NEGATION_TOKENS):
        score -= 0.24
    left_laterality = left_set & LATERALITY_TOKENS
    right_laterality = right_set & LATERALITY_TOKENS
    if left_laterality and right_laterality and left_laterality != right_laterality:
        score -= 0.22
    left_location = left_set & LOCATION_TOKENS
    right_location = right_set & LOCATION_TOKENS
    if left_location and right_location and not left_location.issubset(right_location):
        score -= 0.08
    return round(max(0.0, min(score, 1.0)), 6)


def _exact_occurrences(query: str, reports: dict[str, str], section_hint: str | None) -> list[SentenceSpan]:
    occurrences: list[SentenceSpan] = []
    sections = (section_hint,) if section_hint in REPORT_SECTIONS else REPORT_SECTIONS
    for section in sections:
        report_text = reports.get(section, "")
        start = 0
        while query and (match_start := report_text.find(query, start)) >= 0:
            end = match_start + len(query)
            occurrences.append(SentenceSpan(section, -1, match_start, end, report_text[match_start:end]))
            start = end
    return occurrences


def _span_payload(span: SentenceSpan, method: str, confidence: float) -> dict[str, object]:
    return {
        "reportSection": span.section,
        "start": span.start,
        "end": span.end,
        "text": span.text,
        "alignmentMethod": method,
        "confidence": round(confidence, 6),
    }


def align_report_evidence(
    finding_text: str,
    reports: dict[str, str],
    *,
    source_text_hint: str = "",
    source_section_hint: str = "",
    min_score: float = 0.82,
    min_margin: float = 0.10,
) -> AlignmentResult:
    """Resolve one standardized finding to verbatim report evidence.

    Model-provided source text is only a search hint.  The returned text and offsets
    are always copied from the local Findings/Impressions strings.
    """
    section_hint = source_section_hint.casefold().strip()
    if section_hint == "impression":
        section_hint = "impressions"
    if section_hint not in REPORT_SECTIONS:
        section_hint = ""

    query = source_text_hint.strip() or finding_text.strip()
    if not query:
        return AlignmentResult("invalid")

    exact = _exact_occurrences(query, reports, section_hint or None)
    if len(exact) == 1:
        return AlignmentResult("accepted_exact", _span_payload(exact[0], "exact", 1.0), 1.0, 1.0)
    if len(exact) > 1:
        return AlignmentResult("ambiguous_exact")

    # A rewritten source hint can be worse than the standardized finding. Try both,
    # then retain the most discriminative match.
    queries = [query]
    if source_text_hint.strip() and finding_text.strip() != source_text_hint.strip():
        queries.append(finding_text.strip())
    candidate_sections = (section_hint,) if section_hint else REPORT_SECTIONS
    sentences = [
        sentence
        for section in candidate_sections
        for sentence in split_sentences(reports.get(section, ""), section)
    ]
    ranked: list[tuple[float, SentenceSpan, str]] = sorted(
        (
            (sentence_similarity(candidate_query, sentence.text), sentence, candidate_query)
            for candidate_query in queries
            for sentence in sentences
        ),
        key=lambda item: (-item[0], item[1].section != "findings", item[1].start),
    )
    if not ranked:
        return AlignmentResult("no_candidate")

    best_score, best_span, best_query = ranked[0]
    # Multiple queries may nominate the same source sentence; the runner-up must be
    # a genuinely different source span or it would create a false zero margin.
    runner = next(
        (item for item in ranked[1:] if (item[1].section, item[1].start, item[1].end) !=
         (best_span.section, best_span.start, best_span.end)),
        None,
    )
    runner_score = runner[0] if runner else 0.0
    margin = round(best_score - runner_score, 6)
    runner_payload = None if runner is None else {
        "reportSection": runner[1].section,
        "start": runner[1].start,
        "end": runner[1].end,
        "text": runner[1].text,
        "score": runner[0],
    }
    if best_score < min_score:
        return AlignmentResult("low_confidence", score=best_score, margin=margin, runner_up=runner_payload)
    if margin < min_margin:
        return AlignmentResult("ambiguous", score=best_score, margin=margin, runner_up=runner_payload)
    method = "normalized" if normalize_text(best_query) == normalize_text(best_span.text) else "semantic"
    return AlignmentResult(
        f"accepted_{method}",
        _span_payload(best_span, method, best_score),
        best_score,
        margin,
        runner_payload,
    )


def stable_source_finding_id(volume_name: str, category_code: str, span: dict[str, object]) -> str:
    """Return a reorder-resistant API identity derived from source evidence."""
    stem = volume_name.removesuffix(".nii.gz")
    identity = "|".join((
        stem,
        category_code,
        str(span["reportSection"]),
        str(span["start"]),
        str(span["end"]),
        str(span["text"]),
    ))
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16]
    return f"{stem}-{category_code}-{digest}"


def validate_source_span(span: dict[str, object], reports: dict[str, str]) -> None:
    """Raise when a span would be rejected by the Studio service."""
    section = span.get("reportSection")
    start = span.get("start")
    end = span.get("end")
    text = span.get("text")
    if section not in REPORT_SECTIONS or not isinstance(start, int) or not isinstance(end, int):
        raise ValueError("Malformed sourceReportSpan.")
    report_text = reports.get(str(section), "")
    if start < 0 or end <= start or end > len(report_text) or report_text[start:end] != text:
        raise ValueError("sourceReportSpan is not a verbatim slice of its report section.")
