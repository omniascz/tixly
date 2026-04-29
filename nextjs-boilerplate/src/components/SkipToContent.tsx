/**
 * Skip-to-content link pro screen reader / keyboard users.
 * První tab focus → vidí link → Enter skočí na #main-content.
 */

export function SkipToContent({ targetId = 'main-content' }: { targetId?: string }) {
  return (
    <a href={`#${targetId}`} className="skip-to-content">
      Přeskočit na obsah
    </a>
  );
}
