import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" href="/" aria-label="MCQPath home">
          <span className="brand-mark">M</span>
          <span>mcq<span className="brand-accent">path</span><small>Pakistan test preparation</small></span>
        </Link>
        <nav className="main-nav" aria-label="Main navigation">
          <Link href="/subjects">Subjects</Link>
          <Link href="/past-papers">Past papers</Link>
          <Link href="/#practice">Practice tests</Link>
          <Link href="/account">My account</Link>
        </nav>
        <Link className="header-cta" href="/subjects">Start practising <span aria-hidden>↗</span></Link>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <Link className="brand footer-brand" href="/">
          <span className="brand-mark">M</span>
          <span>mcq<span className="brand-accent">path</span><small>Learn a little. Improve every day.</small></span>
        </Link>
        <p>Independent study resource. Always verify official exam details with the relevant testing body.</p>
        <span>© 2026 MCQPath</span>
      </div>
    </footer>
  );
}
