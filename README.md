# Lettuce Stream 🎥

A modern, responsive landing page for Lettuce Stream - a SaaS platform that enables streamers to broadcast to multiple platforms (YouTube, Twitch, Kick) simultaneously.

## Features ✨

- **Modern Responsive Design**: Clean, professional interface with a soft yellow theme
- **Split-Screen Authentication**: Stripe-inspired sign-up/sign-in pages with information panels
- **Three Pricing Tiers**: 
  - Starter ($19/mo)
  - Pro ($29/mo) - Most Popular
  - Enterprise ($99/mo)
- **Firebase Integration**: Authentication and Firestore database
- **Stripe Payment Gateway**: Integrated payment processing
- **Mobile-Friendly**: Fully responsive design that works on all devices
- **Smooth Animations**: Professional UI transitions and effects

## Tech Stack 🛠️

- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Authentication**: Firebase Auth (Email/Password + Google Sign-In)
- **Database**: Firebase Firestore
- **Payments**: Stripe
- **Fonts**: Inter (Google Fonts)
- **Icons**: Custom SVG icons

## Project Structure 📁

```
lettuce-stream/
├── index.html          # Main landing page
├── signup.html         # Sign-up page
├── signin.html         # Sign-in page
├── trial-welcome.html  # Post-signup welcome screen
├── dashboard.html      # Streaming dashboard experience
├── plans.html          # Plans comparison page
├── styles.css          # Main styles for landing page
├── auth.css            # Styles for authentication pages
├── app.js              # Main JavaScript for landing page
├── auth.js             # Authentication logic
├── firebase-config.js  # Firebase configuration
└── README.md           # This file
```

## Getting Started 🚀

### Prerequisites

- A modern web browser
- Firebase account
- Stripe account

### Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project (or select an existing one)
3. Enable Authentication:
   - Go to Authentication > Sign-in method
   - Enable "Email/Password" provider
   - Enable "Google" provider
4. Create a Firestore Database:
   - Go to Firestore Database
   - Create database in production mode
   - Start with default security rules
5. Get your Firebase configuration:
   - Go to Project Settings
   - Scroll down to "Your apps"
   - Copy the Firebase SDK configuration
6. Update `firebase-config.js` with your Firebase credentials:

```javascript
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID",
    measurementId: "YOUR_MEASUREMENT_ID"
};
```

### Stripe Setup

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/)
2. Get your publishable key from the Developers section
3. Update `auth.js` with your Stripe publishable key:

```javascript
const stripe = Stripe('pk_test_YOUR_PUBLISHABLE_KEY');
```

4. Set up a backend server to handle Stripe checkout sessions (required for production)

### Local Development

1. Clone the repository:
```bash
git clone https://github.com/seanblatter/lettuce-stream.git
cd lettuce-stream
```

2. Update the Firebase and Stripe configuration files as described above

3. Serve the files using a local web server:

```bash
# Using Python 3
python -m http.server 8000

# Using Node.js (http-server)
npx http-server -p 8000

# Using PHP
php -S localhost:8000
```

4. Open your browser and navigate to `http://localhost:8000`

## Deployment 🌐

### Option 1: Firebase Hosting

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login to Firebase
firebase login

# Initialize Firebase in your project
firebase init

# Deploy
firebase deploy
```

### Option 2: Netlify

1. Push your code to GitHub
2. Go to [Netlify](https://www.netlify.com/)
3. Click "New site from Git"
4. Select your repository
5. Deploy!

### Option 3: Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel
```

## Firestore Security Rules 🔒

Update your Firestore security rules to protect user data:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## Stripe Backend Integration 💳

For production use, you'll need to set up a backend to create Stripe Checkout sessions. Here's a basic example using Node.js:

```javascript
// server.js
const stripe = require('stripe')('sk_test_YOUR_SECRET_KEY');
const express = require('express');
const app = express();

app.post('/api/create-checkout-session', async (req, res) => {
  const { userId, plan } = req.body;
  
  const prices = {
    starter: 'price_STARTER_PRICE_ID',
    pro: 'price_PRO_PRICE_ID',
    enterprise: 'price_ENTERPRISE_PRICE_ID'
  };
  
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price: prices[plan],
      quantity: 1,
    }],
    mode: 'subscription',
    success_url: 'https://yoursite.com/dashboard.html?success=true',
    cancel_url: 'https://yoursite.com/signup.html?canceled=true',
  });
  
  res.json({ id: session.id });
});

app.listen(3000);
```

### Multistream OAuth Setup

Lettuce Stream can link directly to YouTube and Twitch so your studio sessions restream everywhere at once. Because OAuth flows require server-side secrets, create environment variables before deploying your API endpoints (or Vercel functions):

| Provider | Required Variables |
| --- | --- |
| Shared | `FIREBASE_SERVICE_ACCOUNT_KEY` (stringified service account JSON), `OAUTH_STATE_SECRET` (random 32+ character string), `APP_BASE_URL` (e.g. `https://app.lettucestream.com`), `OAUTH_REDIRECT_PATH` (default `/dashboard.html`) |
| YouTube | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI` (e.g. `https://app.lettucestream.com/api/oauth/youtube-callback`), optional `YOUTUBE_SCOPES` (space/comma separated) |
| Twitch | `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_REDIRECT_URI` (e.g. `https://app.lettucestream.com/api/oauth/twitch-callback`), optional `TWITCH_SCOPES` |

> **Tip:** You can generate `FIREBASE_SERVICE_ACCOUNT_KEY` in the Firebase Console (Project Settings → Service accounts → Generate new private key). Store the entire JSON string in the environment variable so the backend API can verify Firebase ID tokens and persist channel secrets.

After deploying, update your Firestore security rules to deny access to the `channelSecrets` collection (the repo already includes this rule). OAuth tokens live there and are only readable via the server-side Admin SDK.

### Live Relay & Streaming Pipeline

Browser media APIs cannot push directly to YouTube’s RTMP ingest servers, so Lettuce Stream relies on a lightweight relay that converts your in-browser `MediaRecorder` chunks into an RTMP feed via `ffmpeg`.

1. **Deploy the relay**
  - `cd relay && npm install && node server.js`
  - or host it on Render/Fly/Heroku; any Node host with outbound RTMP and `ffmpeg` support works.
  - The relay uses WebSockets on `PORT` (default `8080`). Make sure the process can reach `rtmp(s)://a.rtmp.youtube.com`.
2. **Expose the relay URL**
  - Set `STREAM_RELAY_URL=wss://your-relay-host.example.com` in Vercel.
  - Redeploy so `/api/runtime-config` surfaces the URL to the studio.
3. **Grant YouTube access once**
  - After a user completes OAuth, their refresh token is stored in Firestore’s locked `channelSecrets` collection.
4. **Going live from the studio**
  - Clicking Go Live now hits `/api/youtube/start-broadcast`, which creates a fresh broadcast + stream via the YouTube Live Streaming API and returns the RTMP ingest address.
  - The browser opens a WebSocket to the relay, streams encoded chunks, and the relay pipes them to YouTube via `ffmpeg`.
  - When the stream stabilizes, the app transitions the broadcast to the `live` lifecycle; ending the stream transitions it to `complete`.

If the relay URL is missing or the YouTube connection is not linked, the Go Live control stays disabled and the UI explains what to fix.

## Customization 🎨

### Colors

Update the CSS variables in `styles.css` and `auth.css`:

```css
:root {
    --primary-yellow: #F5D547;
    --yellow-light: #FFF9E6;
    --yellow-dark: #E5C537;
    --text-primary: #2D3748;
    --text-secondary: #4A5568;
    /* ... */
}
```

### Pricing Plans

Edit the pricing section in `index.html` and update the plan details in `signup.html`.

### Features

Modify the features section in `index.html` to highlight your platform's unique capabilities.

## Browser Support 🌍

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Contributing 🤝

Contributions are welcome! Please feel free to submit a Pull Request.

## License 📄

This project is open source and available under the [MIT License](LICENSE).

## Support 💬

For questions or issues, please open an issue on GitHub or contact support@lettucestream.com

## Acknowledgments 🙏

- Design inspired by modern SaaS platforms like Stripe
- Icons created with SVG
- Fonts from Google Fonts (Inter)

---

Built with ❤️ for streamers everywhere