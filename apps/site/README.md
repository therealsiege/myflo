# myflo.dev landing page

Single static HTML file. Tailwind via CDN. No build step.

## Preview locally

```bash
cd apps/site && python3 -m http.server 8080
# open http://localhost:8080
```

## Deploy

### Vercel (recommended)

```bash
npm i -g vercel
cd apps/site && vercel --prod
# then point myflo.dev's DNS at Vercel via the dashboard
```

`vercel.json` enables clean URLs.

### Netlify

```bash
cd apps/site && netlify deploy --prod --dir .
```

### GitHub Pages

Push `apps/site/` to a `gh-pages` branch, or use the `actions/deploy-pages` workflow.

## What to update

- `og:url` in the `<head>` if the canonical URL changes.
- Version string at the bottom-right of the footer when shipping new versions.
- Feature cards in the "what you get" section as the CLI surface grows.
