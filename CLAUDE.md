# Roam

## Deploy

- Vercel projesi `roam-roehampton`, GitHub reposu `UzunHQ/roam`'a bağlı: `main`'e push edilen her commit otomatik olarak production'a (https://roam-roehampton.vercel.app) deploy edilir.
- Deploy'u `git push` ile yap. `vercel --prod` gibi CLI deploy'ları kullanma; canlı site her zaman `origin/main` ile aynı olmalı.
- Her iş bitince: `npx tsc --noEmit` ve `npm run build` geçsin, sonra commit + push et. İş yerelde commit'siz ya da push'suz bırakılmaz.
- Push'tan sonra Vercel deploy'unun READY olduğunu (`npx vercel ls roam-roehampton`) ve canlı sitenin yeni build'i sunduğunu kontrol et.
