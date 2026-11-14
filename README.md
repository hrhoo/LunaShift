<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/7c6d8f09-0b5d-416c-aadb-1281d3c3084e

## Run Locally

### Clone the project

```sh
git clone --branch luna-shift-react https://github.com/hrhoo/LunaShift.git
cd LunaShift
```

The 3D models are included as regular Git files. Git LFS is not required.
Keep new assets below GitHub's 100 MiB per-file limit.

### Install and run

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
