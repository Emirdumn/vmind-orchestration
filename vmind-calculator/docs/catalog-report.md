# Katalog Raporu (FAZ 0.C)

> OTOMATIK URETILDI — `npm run snapshot:catalog`. Elle duzenlemeyin.
> Snapshot: `2026-07-29T14:01:39.584Z`

- Urun sayisi: **44**
- Instance tipi (flavor): **24**
- Volume type: **2**
- Katalogda gecen para birimleri: `TL`, `USD`, `EUR`

## GATE 1 — 9 servis kodunun urun eslesmesi

| Servis kodu | `product.service` | Urun sayisi | Ornek kodlar |
|---|---|---:|---|
| `compute` | COMPUTE | 28 | `5afc50cd-3f8`, `4d3c3930-42c`, `73dee111-ff3` |
| `storage` | VOLUME | 5 | `VL-001`, `VL-002`, `BC-001` |
| `data-transfer` | NETWORK | 2 | `FIP-001`, `NETW-OUT-001` |
| `floating-ip` | NETWORK | 2 | `FIP-001`, `NETW-OUT-001` |
| `load-balancer` | LOAD_BALANCER | 2 | `LB-001`, `LB-002` |
| `kubernetes` | COMPUTE | 28 | `5afc50cd-3f8`, `4d3c3930-42c`, `73dee111-ff3` |
| `object-storage` | OBJECT_STORAGE | 1 | `OBS-001` |
| `router` | NETWORK | 2 | `FIP-001`, `NETW-OUT-001` |
| `backup` | VOLUME | 5 | `VL-001`, `VL-002`, `BC-001` |

## GATE 2 — Secili para biriminde fiyati OLMAYAN urunler

Bu urunler, o para birimi secildiginde platformun hesaplayicisini cokertir
(`priceObj.price` -> TypeError). Ajan bu para birimlerini kullanmamalidir.

| Para birimi | Fiyati eksik urun | Sonuc |
|---|---|---|
| `TL` | — | **KULLANILABILIR** |
| `USD` | — | **KULLANILABILIR** |
| `EUR` | `LB-001`, `VL-001`, `FIP-001`, `NETW-OUT-001`, `VL-002`, `LB-002` | **KULLANILAMAZ** |

## GATE 3 — Paylasim linki formati

Uretim bundle'indaki `PrintView` bileseninden birebir:

```js
const shareUrl = `${appConfig.calculatorUrl}/my-estimate/${input.data.id}`;
```

Ornek: `https://calculator.portvmind.com/my-estimate/<estimateId>`

`estimateId`, `POST /billing/estimateplan` govdesindeki `key` alanidir.
Link tarayici acmadan uretilebilir.

## Secilemeyen compute urunleri

Fiyat katalogunda var, ancak `compute/flavors` listesinde YOK.
Arayuzden secilemezler; ajan da onermemelidir.

| Urun | Kod |
|---|---|
| ex_gpu.h100s.xlarge | `952e1619-0112-48bf-9657-7f28929d1abc` |
| ex_gpu.h100m.4xlarge | `e26bfd82-772d-46ed-848a-8b1d44a2ad0e` |
| ex_gpu.h100m.3xlarge | `8b2dc1c9-ee56-4c88-9177-72cbbd716b13` |
| ex_gpu.h100m.2xlarge | `fed8f5d6-303d-4421-9cc8-1baaba3f7bfc` |

## Fiyatlandirma birimi dagilimi

`pricingUnit` "HOUR" DEGILSE aylik tutar x720 ile carpilmaz (`fiyat x miktar` olarak kalir).

| `pricingUnit` | Adet | Aylik carpani | Urunler |
|---|---:|---|---|
| `HOUR` | 37 | `x720` | `LB-001`, `VL-001`, `FIP-001`, `VL-002`, `5afc50cd-3f8`, `4d3c3930-42c` … (+31) |
| `GB` | 1 | **yok** | `NETW-OUT-001` |
| `UNIT` | 6 | **yok** | `pvExpress-Ba`, `pvExpress-Sm`, `pvExpress-Me`, `pvExpress-La`, `pvExpress-2x`, `pvExpress-4x` |

## Tum urunler

| `product.service` | `productCode` | Ad | Fiyatlar |
|---|---|---|---|
| LOAD_BALANCER | `LB-001` | App Loadbalancer 2C2GB | TL 2.1753/HOUR<br>USD 0.04944/HOUR |
| VOLUME | `VL-001` | Volume-GB | TL 0.00656944/HOUR<br>USD 0.00015278/HOUR |
| NETWORK | `FIP-001` | FloatingIp | TL 0.16250001/HOUR<br>USD 0.00416667/HOUR |
| NETWORK | `NETW-OUT-001` | NETW-OUT-001 | TL 1.8954/GB<br>USD 0.0486/GB |
| VOLUME | `VL-002` | Snapshot-GB | TL 0.00656944/HOUR<br>USD 0.00015278/HOUR |
| VPS | `pvExpress-Basic` | pvExpress Basic | TL 412/UNIT<br>USD 10.05/UNIT<br>EUR 8.86/UNIT |
| VPS | `pvExpress-Small` | pvExpress Small | TL 781/UNIT<br>USD 19.05/UNIT<br>EUR 16.78/UNIT |
| VPS | `pvExpress-Medium` | pvExpress Medium | TL 1264/UNIT<br>USD 30.83/UNIT<br>EUR 27.16/UNIT |
| VPS | `pvExpress-Large` | pvExpress Large | TL 1894/UNIT<br>USD 46.2/UNIT<br>EUR 40.71/UNIT |
| VPS | `pvExpress-2xLarge` | pvExpress 2xLarge | TL 3788/UNIT<br>USD 92.4/UNIT<br>EUR 81.41/UNIT |
| VPS | `pvExpress-4xLarge` | pvExpress 4xLarge | TL 7577/UNIT<br>USD 184.8/UNIT<br>EUR 162.83/UNIT |
| COMPUTE | `5afc50cd-3f80-47c5-8596-bb303dfa5e17` | g1.nano | TL 0.2191/HOUR<br>USD 0.0053/HOUR<br>EUR 0.00466981/HOUR |
| COMPUTE | `4d3c3930-42c7-48f4-ac0b-01c624c4d3a6` | g1.micro | TL 0.3174/HOUR<br>USD 0.0077/HOUR<br>EUR 0.00678444/HOUR |
| COMPUTE | `73dee111-ff30-4837-b3c1-9284c422485e` | g1.small | TL 0.5141/HOUR<br>USD 0.0125/HOUR<br>EUR 0.0110137/HOUR |
| COMPUTE | `fd9ee6ed-a56d-483e-98c9-1a05d634ffcb` | g1.medium | TL 1.0282/HOUR<br>USD 0.0251/HOUR<br>EUR 0.0221155/HOUR |
| COMPUTE | `d3072fd4-9a17-4d03-9f86-149c84bf8006` | g1.large | TL 1.815/HOUR<br>USD 0.0443/HOUR<br>EUR 0.03903254/HOUR |
| COMPUTE | `27214b9a-5f54-43e6-9d2c-aba341a7d41a` | g1.xlarge | TL 3.63/HOUR<br>USD 0.0885/HOUR<br>EUR 0.07797697/HOUR |
| COMPUTE | `90f729ed-7dee-43bc-9c42-ed8f8baaf06d` | g1.2xlarge | TL 7.26/HOUR<br>USD 0.1771/HOUR<br>EUR 0.15604204/HOUR |
| COMPUTE | `f1cbc38a-1bb0-424c-9c49-f2edd3766042` | g1.4xlarge | TL 14.52/HOUR<br>USD 0.3541/HOUR<br>EUR 0.31199598/HOUR |
| COMPUTE | `a5bb79dc-3453-493d-8e85-3092c3316f24` | gpu.t4s.xlarge | TL 5.445/HOUR<br>USD 0.1328/HOUR<br>EUR 0.15604204/HOUR |
| LOAD_BALANCER | `LB-002` | Net Loadbalancer 2C2GB | TL 0.301938/HOUR<br>USD 0.007742/HOUR |
| COMPUTE | `5138c6bf-9b23-4b0d-811d-fe4ae0ad040f` | gpu.t4s.2xlarge | TL 10.89/HOUR<br>USD 0.2656/HOUR<br>EUR 0.23264743/HOUR |
| COMPUTE | `a29c3a9a-34ee-4a53-9fad-25ff016e479f` | gpu.t4m.xlarge | TL 10.89/HOUR<br>USD 0.2656/HOUR<br>EUR 0.23264743/HOUR |
| COMPUTE | `82625601-a21e-4bfc-956d-151db2d4a750` | gpu.t4m.2xlarge | TL 21.78/HOUR<br>USD 0.5312/HOUR<br>EUR 0.46529486/HOUR |
| OBJECT_STORAGE | `OBS-001` | Object Storage Standart | TL 0.00116586/HOUR<br>USD 0.00002778/HOUR<br>EUR 0.00002401/HOUR |
| VOLUME | `BC-001` | Backup Volume | TL 0.00116586/HOUR<br>USD 0.00002778/HOUR<br>EUR 0.00002401/HOUR |
| COMPUTE | `952e1619-0112-48bf-9657-7f28929d1abc` | ex_gpu.h100s.xlarge | TL 195.835024/HOUR<br>USD 4.51/HOUR<br>EUR 3.7702199/HOUR |
| COMPUTE | `e26bfd82-772d-46ed-848a-8b1d44a2ad0e` | ex_gpu.h100m.4xlarge | TL 564.4912/HOUR<br>USD 13/HOUR<br>EUR 10.86759615/HOUR |
| COMPUTE | `8b2dc1c9-ee56-4c88-9177-72cbbd716b13` | ex_gpu.h100m.3xlarge | TL 423.3684/HOUR<br>USD 9.75/HOUR<br>EUR 8.15069712/HOUR |
| COMPUTE | `fed8f5d6-303d-4421-9cc8-1baaba3f7bfc` | ex_gpu.h100m.2xlarge | TL 392.104272/HOUR<br>USD 9.03/HOUR<br>EUR 7.54879948/HOUR |
| COMPUTE | `488ae8fc-1dce-424b-bcbc-fc6fec164753` | gpu.h100s.xlarge | TL 195.835024/HOUR<br>USD 4.51/HOUR<br>EUR 3.7702199/HOUR |
| COMPUTE | `af867917-29a8-490a-af7d-22068ca7a300` | gpu.h100m.2xlarge | TL 392.104272/HOUR<br>USD 9.03/HOUR<br>EUR 7.54879948/HOUR |
| COMPUTE | `e9c91c90-b7bf-4357-af10-782f454bf85f` | gpu.h100m.3xlarge | TL 423.3684/HOUR<br>USD 9.75/HOUR<br>EUR 8.15069712/HOUR |
| COMPUTE | `deda8bdd-b9ff-4973-bbac-1b771dafde15` | gpu.h100m.4xlarge | TL 564.4912/HOUR<br>USD 13/HOUR<br>EUR 10.86759615/HOUR |
| COMPUTE | `9236d7c3-1247-4ebb-9d9e-57f3c6a9db0c` | m1.large | TL 2.87690458/HOUR<br>USD 0.064634/HOUR<br>EUR 0.05599367/HOUR |
| COMPUTE | `473854dc-3e9d-42e8-a0d2-758dcb98e4e9` | m1.xlarge | TL 5.75380917/HOUR<br>USD 0.129268/HOUR<br>EUR 0.11198735/HOUR |
| COMPUTE | `25483aa9-972c-43f4-b7bb-85744cbe2152` | m1.2xlarge | TL 11.50761834/HOUR<br>USD 0.258536/HOUR<br>EUR 0.2239747/HOUR |
| COMPUTE | `afad1d49-746d-4237-9827-488b44a1c1cb` | m1.4xlarge | TL 23.01523667/HOUR<br>USD 0.517072/HOUR<br>EUR 0.44794939/HOUR |
| COMPUTE | `2db059da-36c8-461d-80b2-a258b3acae67` | m1.8xlarge | TL 46.03047334/HOUR<br>USD 1.034144/HOUR<br>EUR 0.89589879/HOUR |
| COMPUTE | `88d645e5-11c8-49e7-91c0-0a69033319f1` | m1.12xlarge | TL 83.62484265/HOUR<br>USD 1.842176/HOUR<br>EUR 1.56835495/HOUR |
| COMPUTE | `beffb26e-0d1f-4c90-8945-12044064789e` | g1.8xlarge | TL 32.66621916/HOUR<br>USD 0.708352/HOUR<br>EUR 0.61299081/HOUR |
| COMPUTE | `d638d95a-ea08-4ef7-8116-3b031850c53a` | g1.16xlarge | TL 65.33243832/HOUR<br>USD 1.416704/HOUR<br>EUR 1.22598163/HOUR |
| VOLUME | `bd0bbcfb-c178-4d21-b661-1b67c43b8c60` | PortvMind-Standard-HDD | TL 0.00349758/HOUR<br>USD 0.00007517/HOUR<br>EUR 0.00006596/HOUR |
| VOLUME | `096439fe-26d6-4bd0-bdf0-11e40f73753e` | PortvMind-Premium-SSD | TL 0.00656944/HOUR<br>USD 0.00015278/HOUR<br>EUR 0.0001239/HOUR |

## Instance tipleri

| Ad | vCPU | RAM (GB) | GPU | vRAM (GB) | Aile |
|---|---:|---:|---:|---:|---|
| g1.16xlarge | 64 | 256 | 0 | 0 | General Purpose |
| g1.2xlarge | 8 | 32 | 0 | 0 | General Purpose |
| g1.4xlarge | 16 | 64 | 0 | 0 | General Purpose |
| g1.8xlarge | 32 | 128 | 0 | 0 | General Purpose |
| g1.large | 2 | 8 | 0 | 0 | General Purpose |
| g1.medium | 2 | 4 | 0 | 0 | General Purpose |
| g1.micro | 1 | 1 | 0 | 0 | General Purpose |
| g1.nano | 1 | 0.5 | 0 | 0 | General Purpose |
| g1.small | 1 | 2 | 0 | 0 | General Purpose |
| g1.xlarge | 4 | 16 | 0 | 0 | General Purpose |
| gpu.h100m.2xlarge | 52 | 992 | 2 | 160 | GPU |
| gpu.h100m.3xlarge | 78 | 1488 | 3 | 240 | GPU |
| gpu.h100m.4xlarge | 104 | 1984 | 4 | 320 | GPU |
| gpu.h100s.xlarge | 26 | 496 | 1 | 80 | GPU |
| gpu.t4m.2xlarge | 8 | 32 | 2 | 2 | GPU |
| gpu.t4m.xlarge | 4 | 16 | 2 | 2 | GPU |
| gpu.t4s.2xlarge | 8 | 32 | 1 | 1 | GPU |
| gpu.t4s.xlarge | 4 | 16 | 1 | 1 | GPU |
| m1.12xlarge | 48 | 256 | 0 | 0 | High Memory Purpose |
| m1.2xlarge | 8 | 32 | 0 | 0 | High Memory Purpose |
| m1.4xlarge | 16 | 64 | 0 | 0 | High Memory Purpose |
| m1.8xlarge | 32 | 128 | 0 | 0 | High Memory Purpose |
| m1.large | 2 | 8 | 0 | 0 | High Memory Purpose |
| m1.xlarge | 4 | 16 | 0 | 0 | High Memory Purpose |

## Volume type'lar

| Ad | `productCode` (= `id`) |
|---|---|
| PortvMind-Standard-HDD | `bd0bbcfb-c178-4d21-b661-1b67c43b8c60` |
| PortvMind-Premium-SSD | `096439fe-26d6-4bd0-bdf0-11e40f73753e` |
