# Nexus Suite Website

## Deploy on Railway

1. Create a **New Project** on Railway
2. Choose **Deploy from local directory** or connect a GitHub repo that contains **only this folder**
3. Root directory must contain:
   - `index.html`
   - `server.js`
   - `package.json`
   - `nexus-suite.zip`
4. Railway will run `npm start` → `node server.js`
5. Open the generated `*.up.railway.app` URL

### Important
- Do **not** deploy the Python Nexus Suite app as the website
- The website root must be this folder (the one with `index.html` + `server.js`)
- Download button serves `nexus-suite.zip` directly

## Local test

```bash
node server.js
```

Then open http://localhost:3000
