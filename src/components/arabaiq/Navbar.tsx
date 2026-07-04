export function Navbar() {
  return (
    <nav className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <a href="/" className="flex items-center gap-2.5">
          <div className="size-9 bg-primary rounded-xl flex items-center justify-center shadow-soft">
            <div className="size-4 border-[2.5px] border-brand rounded-full" />
          </div>
          <span className="font-semibold tracking-tight text-lg text-foreground">ArabaiQ</span>
        </a>
        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-muted-foreground">
          <a href="#" className="hover:text-foreground transition-colors">Değerleme</a>
          <a href="#" className="hover:text-foreground transition-colors">Güvenilirlik</a>
          <a href="#" className="hover:text-foreground transition-colors">Ortak Sorunlar</a>
          <a href="#" className="hover:text-foreground transition-colors">Karşılaştır</a>
        </div>
        <button className="px-5 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-full text-xs font-semibold tracking-wide transition-all">
          Giriş Yap
        </button>
      </div>
    </nav>
  );
}
