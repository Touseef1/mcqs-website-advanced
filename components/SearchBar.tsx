export function SearchBar({ compact = false }: { compact?: boolean }) {
  return (
    <form className={compact ? "search-form search-compact" : "search-form"} action="/search">
      <label className="sr-only" htmlFor={compact ? "site-search-small" : "site-search"}>Search MCQs, subjects, or papers</label>
      <span className="search-icon" aria-hidden>⌕</span>
      <input
        id={compact ? "site-search-small" : "site-search"}
        type="search"
        name="q"
        placeholder="Search subjects, topics, or questions…"
        minLength={2}
      />
      <button type="submit">{compact ? "Search" : "Search MCQs"}</button>
    </form>
  );
}
