// The sky: a slow living glow behind a page (styles in app/globals.css, .rg-aurora).
// Put it first inside a page root that has no background, and wrap the content in .rg-lit.
// `soft` is the quieter version for pages people read all day (the app).
export function Aurora({ soft = false }: { soft?: boolean }) {
  return (
    <div className={soft ? "rg-aurora is-soft" : "rg-aurora"} aria-hidden>
      <span className="a" />
      <span className="b" />
      <span className="c" />
      <span className="d" />
      <span className="e" />
      <span className="f" />
    </div>
  );
}
