/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // "standalone" produit un dossier .next/standalone auto-suffisant
  // (trace uniquement les node_modules réellement utilisés) — image
  // Docker de production nettement plus légère qu'une copie complète
  // de node_modules. Sans impact sur `next dev`/le développement local.
  output: 'standalone',
};

module.exports = nextConfig;
