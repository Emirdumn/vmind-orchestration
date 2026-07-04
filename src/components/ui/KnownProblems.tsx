import { useState } from "react";
import { ChevronDown, ExternalLink, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import problemsData from "@/data/car_problems.json";

type Locale = "tr" | "en";
type Category =
  | "engine"
  | "transmission"
  | "safety"
  | "electrical"
  | "interior"
  | "emissions"
  | "body"
  | "other";

interface Problem {
  title: string;
  description: string;
  category: Category;
  source_url: string;
}

interface ModelProblems {
  model: string;
  brand?: string;
  source: string;
  problems: Problem[];
}

const DATA = problemsData as unknown as Record<string, ModelProblems>;

interface KnownProblemsProps {
  brand: string;
  model: string;
  locale?: Locale;
  defaultOpen?: boolean;
  className?: string;
}

const CATEGORY_META: Record<
  Category,
  { icon: string; badge: string; label: { tr: string; en: string } }
> = {
  engine: {
    icon: "⚙️",
    badge:
      "bg-red-500/15 text-red-600 dark:text-red-400 ring-1 ring-red-500/20",
    label: { tr: "Motor", en: "Engine" },
  },
  safety: {
    icon: "🛡️",
    badge:
      "bg-orange-500/15 text-orange-600 dark:text-orange-400 ring-1 ring-orange-500/20",
    label: { tr: "Güvenlik", en: "Safety" },
  },
  electrical: {
    icon: "⚡",
    badge:
      "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 ring-1 ring-yellow-500/20",
    label: { tr: "Elektrik", en: "Electrical" },
  },
  transmission: {
    icon: "🔧",
    badge:
      "bg-purple-500/15 text-purple-600 dark:text-purple-400 ring-1 ring-purple-500/20",
    label: { tr: "Şanzıman", en: "Transmission" },
  },
  interior: {
    icon: "🪟",
    badge:
      "bg-blue-500/15 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500/20",
    label: { tr: "İç Mekan", en: "Interior" },
  },
  emissions: {
    icon: "💨",
    badge:
      "bg-green-500/15 text-green-700 dark:text-green-400 ring-1 ring-green-500/20",
    label: { tr: "Emisyon", en: "Emissions" },
  },
  body: {
    icon: "🎨",
    badge:
      "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300 ring-1 ring-zinc-500/20",
    label: { tr: "Kaporta", en: "Body" },
  },
  other: {
    icon: "⚠️",
    badge:
      "bg-slate-500/15 text-slate-700 dark:text-slate-300 ring-1 ring-slate-500/20",
    label: { tr: "Diğer", en: "Other" },
  },
};

const T = {
  title: { tr: "Bilinen Sorunlar", en: "Known Issues" },
  count: { tr: "Bilinen Sorun", en: "Known Issues" },
  source: { tr: "Kaynak", en: "Source" },
  learnMore: { tr: "Detay", en: "Learn more" },
  disclaimer: {
    tr: "ABD piyasası verileri, Türkiye'de farklılık gösterebilir",
    en: "Data from US market reports, may vary",
  },
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function lookupKey(brand: string, model: string): string | null {
  const b = normalize(brand);
  const m = normalize(model);

  const candidates: string[] = [];

  // VW models stored with bare model key
  if (b === "volkswagen" || b === "vw") {
    candidates.push(m);
  }
  // brand_model pattern
  candidates.push(`${b}_${m}`);
  // model only (in case it's unique)
  candidates.push(m);

  // Some specific aliases
  const aliases: Record<string, string> = {
    "honda_hrv": "honda_hr_v",
    "honda_hr_v": "honda_hr_v",
    "toyota_chr": "toyota_c_hr",
    "toyota_c_hr": "toyota_c_hr",
    "toyota_corolla_hb": "toyota_corolla_hatchback",
    "toyota_corolla_hatchback": "toyota_corolla_hatchback",
  };

  for (const c of candidates) {
    if (aliases[c] && DATA[aliases[c]]) return aliases[c];
    if (DATA[c]) return c;
  }
  return null;
}

export function KnownProblems({
  brand,
  model,
  locale = "tr",
  defaultOpen = false,
  className,
}: KnownProblemsProps) {
  const [open, setOpen] = useState(defaultOpen);
  const key = lookupKey(brand, model);
  if (!key) return null;
  const data = DATA[key];
  if (!data || !data.problems?.length) return null;

  const count = data.problems.length;

  return (
    <section
      className={cn(
        "bg-card rounded-3xl ring-1 ring-foreground/5 shadow-soft overflow-hidden",
        className
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-4 px-6 md:px-8 py-5 text-left hover:bg-secondary/40 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-10 rounded-2xl bg-orange-500/15 text-orange-600 dark:text-orange-400 flex items-center justify-center shrink-0">
            <AlertTriangle className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              {data.model}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <h3 className="text-lg md:text-xl font-semibold tracking-tight truncate">
                {T.title[locale]}
              </h3>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-600 dark:text-orange-400 text-[11px] font-bold tabular-nums">
                {count} {T.count[locale]}
              </span>
            </div>
          </div>
        </div>
        <ChevronDown
          className={cn(
            "size-5 text-muted-foreground shrink-0 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="px-6 md:px-8 pb-6 pt-2 animate-fade-in">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.problems.map((p, i) => {
              const meta = CATEGORY_META[p.category] ?? CATEGORY_META.other;
              return (
                <article
                  key={i}
                  className="rounded-2xl bg-surface-soft p-4 ring-1 ring-foreground/5 hover:ring-foreground/10 transition-all flex flex-col gap-2"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                        meta.badge
                      )}
                    >
                      <span aria-hidden>{meta.icon}</span>
                      {meta.label[locale]}
                    </span>
                  </div>
                  <h4 className="font-semibold text-sm text-foreground leading-snug">
                    {p.title}
                  </h4>
                  <p
                    className="text-xs text-muted-foreground leading-relaxed overflow-hidden"
                    style={{
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                    }}
                  >
                    {p.description}
                  </p>
                  <a
                    href={p.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand hover:gap-1.5 transition-all mt-auto"
                  >
                    {T.learnMore[locale]}
                    <ExternalLink className="size-3" />
                  </a>
                </article>
              );
            })}
          </div>

          <div className="mt-5 pt-4 border-t border-border flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <a
              href={`https://${data.source}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
            >
              {T.source[locale]}: <span className="font-semibold">{data.source}</span>
              <ExternalLink className="size-3" />
            </a>
            <span className="italic">{T.disclaimer[locale]}</span>
          </div>
        </div>
      )}
    </section>
  );
}

export default KnownProblems;
