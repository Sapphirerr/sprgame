# 🎮 SPRgame - Sekai Card Battle

A real-time multiplayer card battle game based on Project Sekai characters. Players compete using unique cards with stats and special skills in a 2-5 player match.

## Quick Start

### 1. Install & Run
```bash
cd SPRgame
npm install
npm start
```

The server will start at: **http://localhost:3000**

### 2. Create/Join Room
- **Create Room**: Enter your name, click "สร้างห้องใหม่"
- **Join Room**: Enter the 6-character room code and click "เข้าร่วมเลย!"

### 3. Wait for Players
- Share the room code with friends
- Everyone clicks "พร้อมแล้ว!" (Ready)
- Game starts automatically when 2+ players are ready

## Game Rules

### Objective
Last player with HP > 0 wins!

### Each Turn
1. **Event & Competition Announced** (Random)
   - 19 different events with special effects
   - 3 competition types: Vocal, Dance, or Visual

2. **Select Card** (30 seconds)
   - Choose 1 card from your hand to battle
   - Or skip turn (costs 1 HP if only 1 player plays)

3. **Choose Action** (30 seconds)
   - **Action 1**: Draw nerfed card (0 points)
   - **Action 2**: Use skill (2-turn cooldown)
   - **Action 3**: Normal battle (standard)
   - **Action 4**: Retreat/dodge (keep card, lose 1 HP)

4. **Battle Results**
   - Highest score wins (no HP loss)
   - Others lose 1 HP
   - Draw 1 new card

### Scoring
Your score depends on the competition:
- **Vocal**: Vocal×2 + Dance×1.5 + Visual×1
- **Dance**: Dance×2 + Visual×1.5 + Vocal×1
- **Visual**: Visual×2 + Vocal×1.5 + Dance×1

### Card Skills
- **Gacha God** (10 cards): Draw 3 bonus cards
- **Don't Lose** (6 cards): Recover 2 HP
- **Shield Onion** (6 cards): Immune to HP loss this turn
- **Mic/Boots/Makeup** (9 each): +5 to that stat
- **SapphireR** (1 card): +10 to all stats
- **Plus more!**

## Game Features

✅ **78 Unique Cards** (26 characters × 3 variants)
✅ **19 Events** (Buffs, debuffs, special effects)
✅ **Real-time Multiplayer** (2-5 players)
✅ **Skill Cooldown System** (Strategic gameplay)
✅ **Beautiful UI** (Thai language, Kanit font)
✅ **Socket.io Networking** (Smooth synchronization)

## File Structure

```
├── server/
│   ├── index.js (Main server & game logic)
│   ├── utils.js (Card/event utilities)
│   └── data/
│       ├── cards.json (78 cards)
│       └── events.json (19 events)
├── client/
│   ├── pages/
│   │   ├── index.html (Main menu)
│   │   ├── createRoom.html
│   │   ├── joinRoom.html
│   │   ├── lobby.html (Waiting room)
│   │   └── gameplay.html (Battle)
│   └── css/ (Bootstrap files)
└── package.json
```

## Requirements

- **Node.js** 14+ 
- **npm** or yarn
- **Browser**: Chrome, Firefox, Edge, Safari

## Dependencies

```json
{
  "express": "^4.19.2",
  "socket.io": "^4.7.5",
  "uuid": "^13.0.0"
}
```

## Game Commands

### Server
```bash
npm start      # Start server
npm run dev    # Development mode (auto-reload)
```

### Client
Open in browser: http://localhost:3000

## Tips & Tricks

### Card Management
- Watch the competition type (Vocal/Dance/Visual)
- Play cards that match the competition
- Save rare cards for favorable events

### Actions
- **Gacha (Action 1)**: Use when desperate for cards
- **Skill (Action 2)**: Best for high-stat card skills
- **Normal (Action 3)**: Standard, always safe
- **Retreat (Action 4)**: Keep good cards, sacrifice HP

### Strategy
- Track other players' HP
- Remember event buffs/debuffs
- Build up card variety
- Use skills at critical moments
- Don't waste strong cards

## Troubleshooting

### Port Already in Use
```bash
# On Windows PowerShell:
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Or change port:
PORT=3001 npm start
```

### Can't Connect
- Check server is running (terminal shows "🎮 SPRGame Sekai เปิดเซิร์ฟแล้ว!")
- Clear browser cache (Ctrl+Shift+Del)
- Disable browser extensions
- Check firewall settings

### Socket.io Issues
- F12 → Console tab → Check for errors
- F12 → Network tab → Check Socket.io connections
- Refresh page (Ctrl+R)

## Game Balance

### Card Power Distribution
- **Normal Rarity**: 40-45 total stats
- **Limit Rarity**: 42-47 total stats
- **Fes Rarity**: 44-50 total stats (gets Festival bonus)

### Skill Distribution
- 47/78 cards have active skills
- 31/78 cards have no special skill
- Skills provide strategic variety, not raw power

### Event Balance
- 8 basic events (mostly neutral)
- 11 specialized events (help different card types)
- 19-turn cycle ensures variety

## Future Updates

- [ ] Card artwork and animations
- [ ] Chat system for in-game communication
- [ ] Statistics and leaderboards
- [ ] Trading between players
- [ ] Different game modes
- [ ] Mobile-optimized UI

## License

This project is created for educational purposes.

## Credits

- **Game Framework**: Node.js + Socket.io + Express
- **Characters**: Project Sekai Colorful Stage!
- **Language**: Thai (Thai language support)
- **Font**: Google Fonts (Kanit)

## Support

For issues, check:
1. **Browser Console** (F12 → Console)
2. **Server Terminal** (npm start output)
3. **GAME_RULES.md** (detailed rules)
4. **IMPLEMENTATION.md** (technical details)

---

**Version**: 1.0.0 Beta ✅
**Status**: Playable & Stable
**Last Updated**: November 2024

Enjoy the game! 🎮✨

**Team**: Made with ❤️ for Sekai fans
