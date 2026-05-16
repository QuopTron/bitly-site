# Deploy Bitly Site to Cloudflare Pages

## 1. Create a GitHub repository (if you don't have one)
```bash
# In the project root (e:/Pablo/proyectos/bitly-site)
git init
git add .
git commit -m "Initial commit"
# Replace <USERNAME> with your GitHub username
git remote add origin https://github.com/<USERNAME>/bitly-site.git
git branch -M main
git push -u origin main
```

## 2. Create a Cloudflare Pages project
1. Log in to Cloudflare and go to **Pages → Create a project**.
2. Connect the project to the GitHub repository you just created.
3. Choose the **main** branch as the production branch.

## 3. Configure the build settings
- **Build command:** `pnpm install && pnpm run build`
- **Build output directory:** `dist`
- **Environment variables:** none required for a static site.

## 4. Adjust Vite configuration (optional)
Cloudflare Pages serves the site from the root, so the default Vite `base` of `/` works fine. If you added a custom `base` earlier, make sure it is set to `/`:
```ts
// vite.config.ts
export default defineConfig({
  base: "/",
  plugins: [
    tailwindcss(),
    tanstackStart(),
    react(),
    viteTsconfigPaths(),
  ],
});
```

## 5. Deploy
After saving the settings, Cloudflare Pages will automatically run the build and publish the site at:
```
https://<PROJECT_NAME>.pages.dev
```
Replace `<PROJECT_NAME>` with the name you gave the Pages project.

## 6. Custom domain (optional)
If you have a custom domain, add it in **Pages → Custom domains** and follow Cloudflare's DNS verification steps.

## 7. Updating the site
Whenever you make changes, just commit and push to the `main` branch:
```bash
git add .
git commit -m "Update site"
git push
```
Cloudflare Pages will rebuild and redeploy automatically.
