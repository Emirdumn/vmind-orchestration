export function Footer() {
  return (
    <footer className="border-t border-border bg-card mt-16">
      <div className="max-w-7xl mx-auto px-6 py-12 flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="flex items-center gap-2.5">
          <div className="size-7 bg-primary rounded-lg flex items-center justify-center">
            <div className="size-3 border-2 border-brand rounded-full" />
          </div>
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-foreground">ArabaiQ Intelligence</span>
        </div>
        <div className="flex flex-wrap justify-center gap-x-8 gap-y-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
          <a href="#" className="hover:text-foreground transition-colors">Veri Kaynağı</a>
          <a href="#" className="hover:text-foreground transition-colors">Metodoloji</a>
          <a href="#" className="hover:text-foreground transition-colors">İş Ortağı Ol</a>
          <a href="#" className="hover:text-foreground transition-colors">Gizlilik</a>
        </div>
        <p className="text-[10px] font-mono text-muted-foreground">© 2025 ArabaiQ</p>
      </div>
    </footer>
  );
}
