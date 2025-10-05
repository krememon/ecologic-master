Here’s the **README snippet** you can give your Agent to include alongside the feature update. It explains setup, key requirements, and troubleshooting for Google Places and the new centered stepper layout. You can paste this into `/docs/JobWizard.md` or at the top of the file comments.

---

# 🧭 EcoLogic Job Wizard — Setup & Troubleshooting Notes

### ✅ Overview

This version introduces three key updates:

1. **Centered Stepper (1-2-3)** — visually aligned and labeled across the modal header.
2. **Google Places Autocomplete** — powers the “Location” input in Step 1 using the Maps JavaScript + Places APIs.
3. **Dev Shortcuts** — lightweight text buttons on Step 1 to jump directly to Step 2 or Step 3 for QA or demo purposes.

---

### ⚙️ Environment Setup

To enable the Google Maps/Places integration, make sure your project has:

```bash
# .env or Replit Secrets
VITE_GOOGLE_MAPS_KEY=YOUR_KEY_HERE
```

**Google Cloud Console Setup:**

1. Go to [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials).
2. Create or reuse an API key.
3. Enable these APIs:

   * **Maps JavaScript API**
   * **Places API**
4. Attach a **billing account** (required for Places).
5. Under **Application Restrictions**, select **HTTP referrers** and add:

   * `http://localhost:*/*`
   * `https://*.replit.dev/*`
   * *(Add your production domain if applicable)*
6. Click **Save**, then restart your Vite/Replit preview after adding the key.

---

### 🧩 Autocomplete Integration Notes

* Uses `@react-google-maps/api` with `libraries=['places']`.
* Field behavior:

  * Displays address suggestions while typing.
  * On selection, populates the field with the formatted address.
  * Gracefully degrades to a plain text field if API fails or key is invalid.
* No breaking dependency on a live Google connection — modal remains usable offline.

---

### 🎨 Stepper Alignment

* The 1-2-3 progress dots are now centered beneath “Create New Job.”
* Active step = filled primary color.
* Completed steps = muted background.
* Upcoming steps = outlined border.
* A small caption under the stepper shows the current step label (“Job Details”, “Client”, “Schedule”).

---

### 🧪 QA Shortcuts

* On Step 1, developer text buttons allow jumping straight to Step 2 or Step 3.
* These bypass validation for faster testing but do **not** affect normal “Next” logic.
* Disable or hide in production builds if desired.

---

### 🚨 Common Google Maps Errors

| Error Code                    | Cause                  | Fix                                  |
| ----------------------------- | ---------------------- | ------------------------------------ |
| **InvalidKeyMapError**        | Typo or wrong project  | Verify key string & project ID       |
| **RefererNotAllowedMapError** | Missing allowed domain | Add localhost & replit.dev referrers |
| **ApiNotActivatedMapError**   | Missing API enablement | Enable Maps JS API + Places API      |
| **BillingNotEnabledMapError** | Billing disabled       | Attach billing to project            |

---

### 🧠 Testing Checklist

* [ ] Stepper perfectly centered with labels visible.
* [ ] “Go to Client” and “Go to Schedule” shortcuts appear on Step 1 only.
* [ ] Normal “Next” still requires valid fields.
* [ ] Location autocomplete populates correctly.
* [ ] If API key missing, plain input fallback appears without console errors.
* [ ] No duplicate script or loader errors after reopening the modal.

---

Would you like me to now generate the **follow-up Agent prompt** that implements this README (so it auto-adds the markdown file and links it to the component update commit)?
