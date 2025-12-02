# 🎮 SPRgame - Project Sekai Card Battle (Fanmade)

A real-time multiplayer card battle game inspired by **Project Sekai: Colorful Stage!** Players compete using strategy and luck in exciting card battles with friends.

## 🚀 Quick Start

### Local Development
```bash
# Install dependencies
npm install

# Start server
npm start
```

Server runs at: **http://localhost:3000**

### Play Online
Visit: **[SPRgame on Railway.app](https://sprgame.railway.app)** (coming soon)

### How to Play
1. **Create Room** - Enter your name, get a 6-digit room code
2. **Share Code** - Send code to friends
3. **Join Room** - Friends enter code to join
4. **Ready Up** - Everyone clicks "พร้อมแล้ว!" when ready
5. **Battle** - Select cards and actions to win!

## 🌍 Languages Supported

- 🇹🇭 **Thai (ไทย)**
- 🇬🇧 **English**
- 🇯🇵 **日本語 (Japanese)**

Language preference saves automatically via localStorage

## 📋 Game Overview

### Objective
- Be the last player with **HP > 0** to win!
- Each player starts with **10 HP**
- Battles happen in real-time across multiple rounds

### Each Round
1. **Random Event & Competition Type** - Vocal, Dance, or Visual
2. **Select Card** (30 seconds) - Choose from your hand
3. **Choose Action** (30 seconds) - Gacha/Skill/Compete/Flee
4. **Results Announced** - Highest score wins, others lose 1 HP

### Card Stats
Cards have 3 base stats:
- **Vocal** 🎤
- **Dance** 💃
- **Visual** ✨

Scoring changes based on competition type.

### Skills
Special abilities on select cards:
- Gacha God - Draw extra cards
- Shield Onion - Block damage
- Stat boosters - Temporarily increase stats
- And more! Each skill has unique effects

## 🎨 Features

✅ **Real-time Multiplayer** (Socket.io)
✅ **Elegant UI** - Glassmorphic design with animations
✅ **Multi-language** - Thai/English/Japanese
✅ **Side Menu System** - Home/About/Game Info
✅ **Room-based Lobbies** - 2-5 players per game
✅ **Skill Cooldown System** - Strategic depth
✅ **Responsive Design** - Works on mobile & desktop

## 📁 Project Structure

```
sprgame/
├── server/
│   ├── index.js              # Main server & Socket.io logic
│   ├── gameManager.js        # Game state management
│   ├── roomManager.js        # Room & player management
│   ├── skillManager.js       # Skill system logic
│   ├── utils.js              # Card utilities
│   └── data/
│       ├── cards.json        # Card database
│       └── events.json       # Event definitions
├── client/
│   ├── pages/
│   │   ├── index.html        # Home page
│   │   ├── lobby.html        # Room lobby
│   │   └── game.html         # Battle interface
│   ├── assets/
│   │   ├── style.css         # Main styles
│   │   ├── gameplay.css      # Game styles
│   │   ├── home-redesign.css # Home page styles
│   │   ├── images/           # Game assets
│   │   └── sounds/           # Audio effects
├── locales/
│   ├── th.json               # Thai translations
│   ├── en.json               # English translations
│   └── ja.json               # Japanese translations
├── package.json              # Dependencies
└── README.md                 # This file
```

## 🛠 Tech Stack

- **Backend**: Node.js + Express.js
- **Networking**: Socket.io (real-time communication)
- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Styling**: CSS Grid, Flexbox, Animations
- **Data**: JSON (cards, events, translations)

## 📦 Dependencies

```json
{
  "express": "^4.19.2",
  "socket.io": "^4.7.5",
  "uuid": "^13.0.0"
}
```

## 🎮 Commands

```bash
# Method 1: Using npm (Recommended)
npm start

# Method 2: Using Node directly
node server/index.js
```

Both start the server at: **http://localhost:3000**

## 🎯 Menu System

**Top-left hamburger menu (☰):**
- 🏠 **Home** - Return to home page
- ℹ️ **About** - Project info & links
- 🎮 **Game Info** - Project Sekai info

Menu is **only visible in lobby** phase for clean gameplay.

## 🔗 Contact & Links

Creator: **SAP_bibi37**
- 📺 YouTube: [@SAP_bibi37](https://www.youtube.com/@SAP_bibi37)
- 📧 Email: SapphireR.spr@gmail.com

## 📖 Game Rules Summary

1. Players take turns selecting cards and actions
2. Each card is revealed simultaneously
3. Highest score wins the round (no HP loss)
4. Other players lose 1 HP
5. Dead players become spectators
6. Last player standing wins!

**Win Conditions:**
- ✅ Be the last player with HP > 0
- ✅ Other players eliminated (HP = 0)

## ⚙️ Troubleshooting

**Port already in use:**
```bash
# Windows PowerShell
Get-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess | Stop-Process
# Or change port
$env:PORT=3001; npm start
```

**Browser issues:**
- Clear cache: Ctrl+Shift+Delete
- Check console: F12 → Console tab
- Check network: F12 → Network tab (Socket.io connections)
- Refresh: Ctrl+R

**Socket.io not connecting:**
- Verify server is running
- Check firewall settings
- Disable browser extensions
- Try incognito mode

## 🚀 Deployment

### Railway.app (Recommended)
1. Push code to GitHub
2. Connect Railway to GitHub repo
3. Auto-deploy on push
4. Get public URL instantly

### Environment Variables
- `PORT` - Server port (default: 3000)
- Auto-configured by Railway

## 📝 License

Fan-made project for **Project Sekai: Colorful Stage!** fans.
Made with ❤️ for the Sekai community.

## 🎵 Credits

- **Game Design**: Inspired by Project Sekai gameplay
- **Characters & IP**: SEGA × Colorful Palette
- **Technology**: Node.js, Express, Socket.io
- **UI/UX**: Custom CSS with glassmorphic design

---

**Version**: 1.0.0 ✅
**Status**: Playable & Stable
**Last Updated**: December 2024

**Enjoy the game! 🎮✨**
