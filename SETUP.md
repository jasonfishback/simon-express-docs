# Simon Express — Document Submission App
## Production Setup Guide

---

## What You Need
- A free account at [resend.com](https://resend.com) (email sending)
- A free account at [vercel.com](https://vercel.com) (hosting)
- [Node.js](https://nodejs.org) installed on your computer (v18+)
- The simon-express logo saved as `public/logo.png`

---

## STEP 1 — Set Up Resend (Email Service)

1. Go to **resend.com** and create a free account
2. Once logged in, click **"API Keys"** in the left sidebar
3. Click **"Create API Key"** — name it `simon-express-docs`
4. **Copy the key** — it starts with `re_` — you only see it once!
5. (Optional but recommended) Click **"Domains"** and add `simonexpress.com`
   - Follow their DNS instructions (add 2-3 records to your domain registrar)
   - This lets emails come FROM `docs@simonexpress.com` instead of a generic address
   - If you skip this, use `onboarding@resend.dev` as the FROM address for testing

---

## STEP 2 — Set Up the Project on Your Computer

```bash
# 1. Open Terminal and go to this folder
cd simon-express-docs

# 2. Install dependencies
npm install

# 3. Copy the environment file
cp .env.local.example .env.local

# 4. Edit .env.local with your actual values:
#    RESEND_API_KEY=re_your_actual_key_here
#    FROM_EMAIL=docs@simonexpress.com      (or onboarding@resend.dev if not verified)
#    TO_EMAIL=billing@simonexpress.com

# 5. Add your logo
#    Copy your Simon Express logo PNG to:  public/logo.png

# 6. Run locally to test
npm run dev
# Open http://localhost:3000 in your browser
```

---

## STEP 3 — Deploy to Vercel (Free Hosting)

```bash
# 1. Install Vercel CLI
npm install -g vercel

# 2. Deploy (run from inside the simon-express-docs folder)
vercel

# Follow the prompts:
#   - Link to existing project? No
#   - Project name: simon-express-docs
#   - Directory: ./  (just press Enter)
#   - Override settings? No
```

3. After deploy, go to **vercel.com/dashboard**
4. Click your project → **Settings** → **Environment Variables**
5. Add these three variables:
   - `RESEND_API_KEY` = your key from Step 1
   - `FROM_EMAIL` = `docs@simonexpress.com`
   - `TO_EMAIL` = `billing@simonexpress.com`
6. Go to **Deployments** and click **Redeploy** (so it picks up the env vars)

Your app will be live at: `https://simon-express-docs.vercel.app`

---

## STEP 4 — Give Drivers Access

### Option A: Share the link
Just send drivers the Vercel URL. Works in any mobile browser.

### Option B: Add to Phone Home Screen (Recommended)
On iPhone:
1. Open the URL in Safari
2. Tap the Share button (box with arrow)
3. Scroll down and tap "Add to Home Screen"
4. Name it "SE Docs" and tap Add

On Android:
1. Open the URL in Chrome
2. Tap the three dots menu
3. Tap "Add to Home Screen"

The app will appear as an icon on their phone, just like a real app.

### Option C: Custom Domain
In Vercel → Settings → Domains, add `docs.simonexpress.com`
Then add a CNAME record at your domain registrar pointing to Vercel.

---

## How It Works (for billing team)

When a driver submits:
1. Their photos are converted to PDF on their phone
2. Documents are grouped: BOLs together, Lumper receipts together, etc.
3. An email lands in billing@simonexpress.com with:
   - Driver name, load number, notes in the email body
   - PDFs attached (Bill_of_Lading.pdf, Lumper_Receipt.pdf, etc.)

---

## Troubleshooting

**"Send failed" error on submission:**
- Check that RESEND_API_KEY is set correctly in Vercel environment variables
- Make sure you redeployed after adding environment variables
- Check Resend dashboard → Logs for error details

**Emails going to spam:**
- Verify your domain in Resend (Step 1, optional step)
- This ensures emails come from @simonexpress.com, not a generic address

**Logo not showing:**
- Make sure the file is named exactly `logo.png` and placed in the `public/` folder
- Redeploy after adding it

---

## Monthly Costs
- Resend free tier: 3,000 emails/month (plenty for most fleets)
- Vercel free tier: unlimited hobby projects
- **Total: $0/month** unless you exceed 3,000 submissions

If you need more: Resend Pro is $20/month for 50,000 emails.
