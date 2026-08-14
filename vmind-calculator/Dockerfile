# VMind Teklif Ajanı — tek konteyner: Node API + derlenmiş React arayüzü
#
# ## Neden `tsx`, neden derlenmiş JS değil
#
# Kök `tsconfig.json` `moduleResolution: "Bundler"` ve `noEmit: true` kullanıyor.
# Node ESM'e temiz derlemek için modül çözümünü değiştirmek gerekirdi — bu,
# 632 testle doğrulanmış bir sistemin import davranışını kaydırma riski demek.
# Konteyner `npm run web` ile BİREBİR aynı yolu çalıştırıyor; bedeli ~40 MB
# imaj ve ~1 sn açılış. Doğrulanmış davranışı korumak buna değer.
#
# ## Sırlar
#
# Anahtarlar imaja GİRMEZ (bkz. .dockerignore). Çalışma zamanında ortam
# değişkeni veya secret dosyası olarak verilir. `ARG` ile anahtar geçirmeyin:
# build argümanları imaj geçmişinde görünür.

# --------------------------------------------------------------------------
# 1) Arayüzü derle
# --------------------------------------------------------------------------
FROM node:24-alpine AS web-build
WORKDIR /build

# Önce yalnızca manifest: bağımlılık katmanı kaynak değişince yeniden kurulmasın.
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY web/tsconfig.json web/vite.config.ts web/index.html ./
COPY web/src ./src
RUN npm run build

# --------------------------------------------------------------------------
# 2) Çalışma zamanı bağımlılıkları
# --------------------------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /build

COPY package.json package-lock.json ./
# Üretim bağımlılıkları + yalnızca `tsx`. vitest/typescript gibi test araçları
# imaja girmez; `--no-save` package.json'u kirletmez.
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm install --no-save --no-audit --no-fund tsx@4.19.2

# --------------------------------------------------------------------------
# 3) Çalışma imajı
# --------------------------------------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app

# Konteyner içinde varsayılan 127.0.0.1 DIŞARIDAN ERİŞİLEMEZ olurdu —
# yayın arayüzüne bağlanmak zorunlu. Dışarı açılmayı compose/port yönetir.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    BUDGET_FILE=/app/var/budget.json

COPY --from=deps  /build/node_modules ./node_modules
COPY --from=web-build /build/dist ./web/dist

COPY package.json ./
COPY src ./src
COPY rules ./rules
COPY fixtures/catalog ./fixtures/catalog

# Harcama defterinin yazılabilir olması ŞART: yazılamazsa defter tutulmaz ve
# her yeniden başlatma günlük kotayı yeniden açardı.
RUN mkdir -p /app/var && chown -R node:node /app/var

# Kök olarak çalışmaz.
USER node
EXPOSE 8080

# Kimlik gerektirmeyen liveness ucu; 200 sürecin ayakta olduğunu gösterir.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node_modules/.bin/tsx", "src/web/main.ts"]
