type StudyGlyphProps = {
  kind: 'notebook' | 'podcast' | 'audiobook' | 'agent';
  className?: string;
};

/** Decorative artwork shown alongside a visible feature or notebook name. */
export default function StudyGlyph({ kind, className }: StudyGlyphProps) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}study-glyphs/${kind}.webp`}
      alt=""
      width={40}
      height={40}
      draggable={false}
      className={`shrink-0 rounded-md object-contain dark:bg-stone-100 ${className ?? ''}`}
    />
  );
}
