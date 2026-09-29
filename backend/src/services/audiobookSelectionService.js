/** Resolve a narration selection in document order, never request/UI order. */
export function selectNarrationChapterIds(manifest, requested) {
    const chapters = manifest?.chapters || [];
    if (requested !== undefined && requested !== null && !Array.isArray(requested)) {
        throw new Error('chapterIds must be an array');
    }
    if (Array.isArray(requested) && requested.length > 500)
        throw new Error('chapterIds cannot exceed 500 entries');
    if (Array.isArray(requested) && requested.some((id) => typeof id !== 'string' || !id.trim()))
        throw new Error('chapterIds must contain nonempty strings');
    const selected = !requested?.length
        ? chapters.filter((chapter) => chapter.narratable !== false && String(chapter.narrationText || chapter.text || '').trim().length > 1).map((chapter) => String(chapter.id))
        : [...new Set(requested.map((id) => typeof id === 'string' ? id.trim() : '').filter(Boolean))];
    if (!selected.length)
        throw new Error('chapterIds are required');
    if (selected.length > 500)
        throw new Error('chapterIds cannot exceed 500 entries');
    const ids = new Set(selected);
    const known = new Set(chapters.map((chapter) => String(chapter.id)));
    if (selected.some((id) => !known.has(id)))
        throw new Error('chapterIds contains a chapter that is not in this book');
    const ordered = chapters.filter((chapter) => ids.has(String(chapter.id)));
    if (ordered.some((chapter) => chapter.narratable === false))
        throw new Error('chapterIds contains a structural divider with no narration');
    if (ordered.some((chapter) => String(chapter.narrationText || chapter.text || '').trim().length < 2))
        throw new Error('A selected chapter has no extractable narration text');
    return ordered.map((chapter) => String(chapter.id));
}
