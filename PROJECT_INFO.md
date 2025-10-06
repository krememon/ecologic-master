# EcoLogic Project Overview

## 🔧 Tech Stack
- React + Vite + TailwindCSS + ShadCN UI
- Hosted on Replit (React template)
- Uses Stripe for payments and Google Maps API for location

## 🌐 Deployment
- Replit URL: https://8ba406dd-3601-4e6d-b203-72607ec69813-00-23v869p3ury5l.picard.replit.dev

## ⚙️ Environment Variables
- VITE_GOOGLE_MAPS_API_KEY = [hidden]
- STRIPE_PUBLIC_KEY = [hidden]
- STRIPE_SECRET_KEY = [hidden]

## 📁 Important Files
- src/pages/jobs/CreateJob.tsx
- src/features/jobs/JobForm.tsx
- src/features/clients/ClientForm.tsx
- src/components/LocationInput.tsx
- src/lib/mapsLoader.ts
- src/layouts/AppLayout.tsx

## 🧱 Current Setup
- Google Places Autocomplete ✅ (working)
- Job Form Wizard ✅
- Client Form ✅
- Stripe test mode (planned)

## ⚠️ Known Issues / Tasks
- [ ] Replace duplicate header “Create New Job” (fixed ✅)
- [ ] Add mobile optimization for form spacing
- [ ] Polish design of step indicators

## 💾 Last Stable Commit
- Commit message: `chore: lock stable build (Google Places working, job header fixed)`
- Working date: October 6, 2025
