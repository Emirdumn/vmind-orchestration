import { OwnerReview } from "@/data/cars";
import { Quote } from "lucide-react";

interface OwnerReviewsProps {
  reviews: OwnerReview[];
}

export function OwnerReviews({ reviews }: OwnerReviewsProps) {
  return (
    <div className="bg-card rounded-3xl p-8 ring-1 ring-foreground/5 shadow-soft">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Sahiplerin Sesi</h3>
          <p className="text-xl font-semibold mt-1">Kullanıcı Deneyimleri</p>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-brand bg-brand-soft px-3 py-1.5 rounded-full">
          Forum & Telegram
        </span>
      </div>

      <div className="space-y-5">
        {reviews.map((review, i) => (
          <article key={i} className="group relative pl-5 border-l-2 border-brand/20 hover:border-brand transition-colors">
            <Quote className="absolute -left-2 -top-1 size-4 text-brand bg-card" />
            <p className="text-sm italic font-light text-foreground/80 leading-relaxed">
              "{review.text}"
            </p>
            <div className="mt-3 flex items-center gap-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              <span className="text-foreground">{review.name}</span>
              <span className="size-1 rounded-full bg-muted-foreground/30" />
              <span>{review.yearsOwned} yıl deneyim</span>
              <span className="size-1 rounded-full bg-muted-foreground/30" />
              <span className="text-brand">{review.source}</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
