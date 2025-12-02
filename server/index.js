// server/index.js - SPRgame Server (Sekai Card Battle)
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

// Load events data
let EVENTS = [];
try {
  EVENTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'events.json'), 'utf8'));
} catch (err) {
  console.error('Failed to load events.json:', err);
}

// Load utils and managers
const { 
  CardDeck,
  drawCards, 
  drawGodGacha, 
  drawReviveGacha, 
  getRandomEvent, 
  getRandomCompetition,
  calculateScore,
  shuffle
} = require('./utils');
const SkillManager = require('./skillManager');
const RoomManager = require('./roomManager');
const GameStateManager = require('./gameManager');

// Initialize managers AFTER loading EVENTS
const roomManager = new RoomManager(EVENTS);
const rooms = roomManager.rooms;

// ==================== EXPRESS ROUTES ====================
console.log('[DEBUG] Setting up express static files...');
app.use(express.static(path.join(__dirname, '../client')));
app.use(express.static(path.join(__dirname, '../')));
app.use('/assets', express.static(path.join(__dirname, '../client/assets')));
console.log('[DEBUG] Static files configured');

app.get('/', (req, res) => {
  console.log('[DEBUG] GET / requested');
  const filePath = path.join(__dirname, '../client/pages/game.html');
  console.log('[DEBUG] Sending:', filePath);
  res.sendFile(filePath);
});

app.get('/locales/:lang.json', (req, res) => {
  const lang = req.params.lang;
  if (lang !== 'th' && lang !== 'en') {
    return res.status(404).json({ error: 'Language not found' });
  }
  res.sendFile(path.join(__dirname, `../locales/${lang}.json`));
});

app.get('/debug/rooms', (req, res) => {
  const out = {};
  for (const [code, room] of roomManager.rooms.entries()) {
    out[code] = {
      code: room.code,
      started: room.started,
      turn: room.turn,
      phase: room.phase,
      players: room.players.map(p => ({
        id: p.id,
        name: p.name,
        ready: p.ready,
        heart: p.heart,
        handCount: (p.hand || []).length,
        skillCooldown: p.skillCooldown
      }))
    };
  }
  res.json(out);
});

app.get('/debug/test-image/:id', (req, res) => {
  const cardId = String(req.params.id).padStart(3, '0');
  const imagePath = path.join(__dirname, `../client/assets/images/cards/${cardId}.png`);
  console.log(`[DEBUG] Image request: /debug/test-image/${cardId}`);
  res.sendFile(imagePath, (err) => {
    if (err) {
      console.error(`[DEBUG] Failed to send image:`, err.message);
      res.status(404).json({ error: 'Image not found', path: imagePath });
    }
  });
});

// ==================== SOCKET.IO ====================
io.on('connection', (socket) => {
  console.log('[Connection] Player joined:', socket.id);

  // ==================== LOBBY ====================
  socket.on('createRoom', ({ name }) => {
    // ✅ Validate name length
    if (!name || name.trim().length === 0) {
      socket.emit('error', '⚠️ กรุณาใส่ชื่อด้วย!');
      return;
    }
    if (name.trim().length > 10) {
      socket.emit('error', '⚠️ ชื่อต้องไม่เกิน 10 ตัวอักษร!');
      return;
    }
    
    const { code, playerId } = roomManager.createRoom(name);
    const room = roomManager.getRoom(code);
    const player = room.players[0];
    
    player.id = socket.id;
    socket.join(code);
    socket.emit('roomCreated', { code, playerId, name: name.trim() });
    console.log(`[Room Created] Code: ${code}, Host: ${name.trim()}, playerId: ${playerId}`);
  });

  socket.on('joinRoom', ({ code, name, fromGameplay, playerId }) => {
    // ✅ Validate name length
    if (!name || name.trim().length === 0) {
      socket.emit('error', '⚠️ กรุณาใส่ชื่อด้วย!');
      return;
    }
    if (name.trim().length > 10) {
      socket.emit('error', '⚠️ ชื่อต้องไม่เกิน 10 ตัวอักษร!');
      return;
    }
    
    const result = roomManager.joinRoom(code, name, playerId);
    
    if (result.error) {
      socket.emit('error', result.error);
      console.warn(`[joinRoom] Error: ${result.error}`);
      return;
    }

    const { room, player, isRejoin } = result;
    
    if (isRejoin) {
      player.id = socket.id;
      socket.join(code);
      
      if (room.started) {
        socket.emit('gameStarted', { turn: room.turn, players: getPlayersInfo(room) });
        socket.emit('newTurn', {
          turn: room.turn,
          event: room.event ? room.event.name : null,
          competition: room.competition || null,
          hand: player.hand,
          players: getPlayersInfo(room)
        });
      } else {
        broadcastLobbyUpdate(code);
      }
      return;
    }

    player.id = socket.id;
    socket.join(code);
    socket.emit('joined', { code, name: name.trim(), playerId: player.playerId });
    console.log(`✅ ${name.trim()} joined room ${code} (playerId: ${player.playerId})`);
    broadcastLobbyUpdate(code);
  });

  // allow rejoin for gameplay page (when client reloads / navigates)
  socket.on('rejoinRoom', ({ code, name, playerId }) => {
    const room = rooms.get(code);
    if (!room) {
      socket.emit('error', 'ไม่พบห้องนี้ (rejoin)');
      return;
    }
    // find existing player by playerId (more reliable than name)
    let player = playerId ? room.players.find(p => p.playerId === playerId) : null;
    if (!player) {
      // fallback to name
      player = room.players.find(p => p.name === name);
    }
    if (!player) {
      socket.emit('error', 'ไม่พบผู้เล่นนี้ในห้อง (rejoin)');
      return;
    }

    // update player's socket id and join socket.io room
    player.id = socket.id;
    socket.join(code);
    console.log(`[rejoinRoom] ${player.name} rejoined room ${code} with socket ${socket.id}`);

    // send current gameStarted and current turn data to this socket
    socket.emit('gameStarted', { turn: room.turn, players: getPlayersInfo(room) });

    // send per-player newTurn (hand etc.) to this socket
    socket.emit('newTurn', {
      turn: room.turn,
      event: room.event ? room.event.name : null,
      competition: room.competition,
      hand: player.hand,
      players: getPlayersInfo(room),
      actionCooldown: player.actionCooldown
    });
  });

  socket.on('toggleReady', ({ code }) => {
    const room = roomManager.getRoom(code);
    if (!room) {
      console.warn('[toggleReady] Room not found:', code);
      return;
    }
    
    const player = roomManager.toggleReady(code, socket.id);
    if (!player) {
      console.warn('[toggleReady] Player not found');
      return;
    }
    
    console.log(`[toggleReady] ${player.name} is now ${player.ready ? 'READY' : 'NOT READY'}`);
    broadcastLobbyUpdate(code);
    
    if (roomManager.isAllReady(code)) {
      console.log(`🎮 Starting game in room ${code}`);
      startGame(code);
    }
  });

  // ==================== START GAME EVENT ====================
  socket.on('startGame', (roomCode) => {
    console.log('[startGame event] Client requested start for room:', roomCode);
    startGame(roomCode);
  });

  // ==================== เริ่มเกม ====================
  const startGame = (code) => {
    const room = roomManager.getRoom(code);
    if (!room) {
      console.error('[startGame] Room not found');
      return;
    }
    
    console.log(`🔄 Resetting room ${code} before starting new game`);
    GameStateManager.startGame(room);

    console.log(`🎮 Game ${code} started!`);
    
    // ส่ง initialHandDraw ให้แต่ละผู้เล่น
    room.players.forEach(p => {
      const playerSocket = io.sockets.sockets.get(p.id);
      if (playerSocket) {
        console.log(`📤 Sending initialHandDraw to ${p.name} with ${p.hand.length} cards`);
        playerSocket.emit('initialHandDraw', {
          turn: room.turn,
          cards: p.hand,
          players: getPlayersInfo(room)
        });
      } else {
        console.warn(`⚠️ Socket not found for player ${p.name} (${p.id})`);
      }
    });
    
    // เริ่มเฟส event slot หลังจาก 6 วิ
    setTimeout(() => {
      startEventSlot(code);
    }, 6000);
  };

  // ==================== เฟสสุ่มอีเวนต์ (Slot Machine) ====================
  const startEventSlot = (code) => {
    const room = rooms.get(code);
    if (!room) return;

    room.phase = 'eventSlot';
    console.log(`🎰 [Event Slot] Starting event slot phase...`);

    // ✅ สุ่มอีเวนต์ก่อนส่งไป client
    room.event = getNextEvent(room);
    console.log(`🎲 Event selected: ${room.event.name}`);

    // ส่งสัญญาณให้ client เริ่มหมุนสล็อต 5 วิ และส่ง event ที่สุ่มได้ไปด้วย
    io.to(code).emit('eventSlotStart', {
      duration: 5000,
      finalEvent: room.event // ✅ ส่งผลลัพธ์จริงไปด้วย
    });

    // รอ 5 วิ แล้วส่งผลลัพธ์
    setTimeout(() => {
      io.to(code).emit('eventSlotResult', {
        event: room.event
      });

      console.log(`🎲 Event: ${room.event.name} (${room.usedEvents}/${room.eventPool.length})`);

      // รอ 1 วิ แล้วเริ่มสุ่มการแข่ง
      setTimeout(() => {
        startCompetitionSlot(code);
      }, 1000);
    }, 5000);
  };

  // ==================== เฟสสุ่มการแข่ง (Slot Machine) ====================
  const startCompetitionSlot = (code) => {
    const room = rooms.get(code);
    if (!room) return;

    // ✅ ตรวจสอบอีเวนต์ "รายการปริศนา" (special_battle) - ข้ามสลอตแข่งขัน
    if (room.event.effect === 'special_battle') {
      console.log(`❓ [Event] รายการปริศนา - ไม่มีสลอตแข่งขัน`);
      room.competition = 'รายการปริศนา'; // กำหนดการแข่งขันเป็นรายการปริศนา
      
      // ส่งผลลัพธ์ไปเลยไม่ต้องหมุนสลอต
      io.to(code).emit('competitionSlotResult', {
        competition: room.competition,
        skipSlot: true // บอก client ให้ข้ามสลอต
      });

      console.log(`📍 เทิร์น ${room.turn}: ${room.event.name} - ${room.competition}`);

      // ✅ ตรวจสอบ Event "ของขวัญจาก Mikudayo" (draw_3)
      if (room.event.effect === 'draw_3') {
        startMikudayoDrawPhase(code);
      } else {
        setTimeout(() => {
          startPlayCardPhase(code);
        }, 1000);
      }
      return;
    }

    room.phase = 'competitionSlot';
    console.log(`🎰 [Competition Slot] Starting competition slot phase...`);

    // ✅ สุ่มการแข่งขันก่อนส่งไป client
    room.competition = getRandomCompetition();
    console.log(`📍 Competition selected: ${room.competition}`);

    // ส่งสัญญาณให้ client เริ่มหมุนสล็อต 3 วิ และส่ง competition ที่สุ่มได้ไปด้วย
    io.to(code).emit('competitionSlotStart', {
      duration: 3000,
      finalCompetition: room.competition // ✅ ส่งผลลัพธ์จริงไปด้วย
    });

    // รอ 3 วิ แล้วส่งผลลัพธ์
    setTimeout(() => {
      io.to(code).emit('competitionSlotResult', {
        competition: room.competition,
        skipSlot: false
      });

      console.log(`📍 เทิร์น ${room.turn}: ${room.event.name} - ${room.competition}`);

      // ✅ ตรวจสอบ Event "ของขวัญจาก Mikudayo" (draw_3)
      if (room.event.effect === 'draw_3') {
        startMikudayoDrawPhase(code);
      } else {
        // Event ปกติ - เริ่มเฟสเลือกการ์ดทันที
        setTimeout(() => {
          startPlayCardPhase(code);
        }, 1000);
      }
    }, 3000);
  };

  // ==================== เฟสจั่วการ์ด Mikudayo ====================
  const startMikudayoDrawPhase = (code) => {
    const room = rooms.get(code);
    if (!room) return;

    console.log(`🎁 [Event] ของขวัญจาก Mikudayo - เริ่มเฟสจั่วการ์ด`);
    room.phase = 'mikudayoDraw';
    
    // รอ 1 วิ แล้วจั่วการ์ด
    setTimeout(() => {
      room.players.forEach(p => {
        if (p.heart > 0 && p.hand.length > 0) { // เฉพาะคนที่ยังเล่นอยู่
          const newCards = room.deck.drawCards(3);
          p.hand.push(...newCards);
          
          io.to(p.id).emit('drawCards', {
            cards: newCards,
            count: 3,
            reason: 'mikudayo'
          });
          
          console.log(`🎁 ${p.name}: จั่ว 3 ใบจาก Mikudayo`);
        }
      });
      
      // รอให้ animation จั่วเสร็จ (0.55s × 3 = 1.65s) + เวลาให้เห็น hands card (1s) = 2.65s → ใช้ 3s
      setTimeout(() => {
        startPlayCardPhase(code);
      }, 3000);
    }, 1000);
  };

  // ==================== เฟสเลือกการ์ด ====================
  const startPlayCardPhase = (code) => {
    const room = rooms.get(code);
    if (!room) return;

    room.phase = 'playCard';
    
    // ส่งข้อมูลเทิร์นให้ผู้เล่น
    startNewTurn(code);
  };

  // ==================== ส่งข้อมูลเทิร์น ====================
  const startNewTurn = (code) => {
    const room = rooms.get(code);
    if (!room || !room.started) return;

    // NOTE: divine card check moved to resolveTurn (BEFORE gameOver check)
    // ไม่ check ที่นี่เพราะกลัว gameOver จะถูกประกาศก่อน

    room.phase = 'playCard';
    // ❌ ไม่ต้องสุ่มใหม่ที่นี่ เพราะสุ่มไว้ใน startEventSlot และ startCompetitionSlot แล้ว
    // room.event = getNextEvent(room);
    // room.competition = getRandomCompetition();
    
    // รีเซ็ตสถานะของผู้เล่น
    room.players.forEach(p => { 
      p.playedCard = null; 
      p.action = null;  // ✅ Reset action สำหรับเทิร์นใหม่
      p.hasDecided = false;
      
      // ลดคูลดาวน์ action (ปุ่ม action 2)
      if (p.actionCooldown > 0) {
        p.actionCooldown--;
        console.log(`🔄 ${p.name} CD: ${p.actionCooldown + 1} → ${p.actionCooldown}`);
      }
    });

    // ✅ Auto-skip logic: Set timeout to auto-skip disconnected players after 30 seconds
    setTimeout(() => {
      const room = rooms.get(code);
      if (!room || room.phase !== 'playCard') return;
      
      // Auto-skip all disconnected players that haven't decided yet
      let skippedAny = false;
      room.players.forEach(p => {
        if (p.isDisconnected && !p.hasDecided) {
          console.log(`🤖 [AUTO-SKIP TIMEOUT] ${p.name} did not respond, auto-skipping playCard`);
          p.playedCard = null;
          p.hasDecided = true;
          skippedAny = true;
        }
      });
      
      if (skippedAny) {
        // Check if all players have now decided
        const allDecided = room.players.every(p => p.hasDecided === true);
        if (allDecided) {
          startEventSlot(code);
        }
      }
    }, 30000);

    // ==================== PHASE: Apply Event Effects at Start of Turn ====================
    // heal_1 - ผู้เล่นฟื้นฟูพลังใจ 1 หน่วย
    if (room.event.effect === 'heal_1') {
      console.log(`💚 [Event START] heal_1: All players heal 1 heart`);
      room.players.forEach(p => {
        const oldHeart = p.heart;
        p.heart = Math.min(6, p.heart + 1);
        console.log(`💚 ${p.name} healed: ${oldHeart} → ${p.heart}`);
      });
    }

    // draw_3 - ผู้เล่นสุ่มกาชาคนละ 3 ใบ (จั่วไปแล้วใน startMikudayoDrawPhase)
    if (room.event.effect === 'draw_3') {
      console.log(`🎁 [Event START] draw_3: Already drew cards in Mikudayo phase`);
      // ❌ ไม่ต้องจั่วที่นี่ เพราะจั่วไปแล้วในเฟสจั่วการ์ดแยกต่างหาก
    }

    // shrimp_curse - ค่าพลังใจของผู้เล่น -1 ตอนเริ่มเทิร์น
    if (room.event.effect === 'shrimp_curse') {
      console.log(`🦐 [Event START] shrimp_curse: All players lose 1 heart at start`);
      room.players.forEach(p => {
        p.heart = Math.max(0, p.heart - 1);
        console.log(`🦐 ${p.name} cursed: heart → ${p.heart}`);
      });
      
      // ✅ ตรวจสอบว่ามีคนตายจากกุ้งหรือไม่
      const alivePlayers = room.players.filter(p => p.heart > 0 && p.hand.length > 0);
      
      // ถ้ามีผู้เล่นเหลือ 1 คน → ชนะ
      if (alivePlayers.length === 1) {
        const winner = alivePlayers[0];
        console.log(`🏆 [GAME OVER - SHRIMP] ${winner.name} ชนะเกม! (คนอื่นตายจากกุ้ง)`);
        io.to(code).emit('gameOver', {
          winnerName: winner.name,
          reason: 'shrimp_curse',
          players: getPlayersInfo(room)
        });
        return; // ✅ หยุดเกมทันที
      }
      
      // ถ้าทุกคนตาย → เสมอ
      if (alivePlayers.length === 0) {
        console.log(`🤝 [GAME OVER - SHRIMP] เสมอ! ทุกคนตายจากกุ้งพร้อมกัน`);
        io.to(code).emit('gameOver', {
          isDraw: true,
          reason: 'shrimp_curse',
          players: getPlayersInfo(room)
        });
        return; // ✅ หยุดเกมทันที
      }
      
      // ✅ Auto-skip ผู้เล่นที่ตายจากกุ้ง (ให้เกมดำเนินต่อได้)
      room.players.forEach(p => {
        if (p.heart === 0) {
          p.playedCard = null;
          p.hasDecided = true;
          p.chosenAction = null;
          p.hasChosenAction = true;
          console.log(`⚰️ ${p.name} auto-skipped (died from shrimp)`);
        }
      });
    }

    console.log(`📍 เทิร์น ${room.turn}: ${room.event.name} - ${room.competition}`);
    
    // ✅ Auto-skip ผู้เล่นที่ตายแล้ว (heart = 0) ให้เกมดำเนินต่อได้
    room.players.forEach(p => {
      if (p.heart === 0 || p.hand.length === 0) {
        p.playedCard = null;
        p.hasDecided = true;
        p.chosenAction = null;
        p.hasChosenAction = true;
        console.log(`⚰️ ${p.name} auto-skipped (eliminated: heart=${p.heart}, cards=${p.hand.length})`);
      }
    });
    
    // ✅ Log deck status
    const deckStatus = room.deck.deckCount();
    console.log(`📦 Deck Status: ${deckStatus.available} available, ${deckStatus.used} used`);
    
    // ✅ Debug: log hand data ก่อนส่ง
    room.players.forEach(p => {
      if (p.hand && p.hand.length > 0) {
        console.log(`🎴 ${p.name} hand: [${p.hand.map(c => c.id).join(', ')}] (ไม่ซ้ำ: ${new Set(p.hand.map(c => c.id)).size}/${p.hand.length})`);
      }
    });
    
    // ส่งข้อมูลเทิร์นให้ทุกคน (ส่งไปยัง socket id ปัจจุบันของแต่ละผู้เล่น)
    room.players.forEach(p => {
      io.to(p.id).emit('newTurn', {
        turn: room.turn,
        // ❌ ไม่ส่ง event/competition ที่นี่ เพราะ client จะได้จาก eventSlotResult/competitionSlotResult แล้ว
        // event: room.event.name,
        // competition: room.competition,
        hand: p.hand,
        players: getPlayersInfo(room),
        actionCooldown: p.actionCooldown,
        lastTurnActionResults: room.lastTurnActionResults || [],  // ✅ ส่ง per-turn scores
        isMikudayo: room.event.effect === 'draw_3'  // ✅ ส่ง flag สำหรับ Mikudayo
      });
    });
  };

  // optional: client can explicitly request updated turn (if needed)
  socket.on('requestNewTurn', (roomCode) => {
    const room = rooms.get(roomCode);
    if (!room) {
      console.warn('[requestNewTurn] ไม่พบห้อง:', roomCode);
      return;
    }
    const player = room.players.find(p => p.id === socket.id);
    if (!player) {
      console.warn('[requestNewTurn] ไม่พบผู้เล่น:', socket.id);
      return;
    }
    console.log('[requestNewTurn] sending hand to', player.name);
    socket.emit('newTurn', {
      turn: room.turn,
      event: room.event ? room.event.name : null,
      competition: room.competition,
      hand: player.hand,
      players: getPlayersInfo(room),
      actionCooldown: player.actionCooldown
    });
  });

  // ==================== เลือกการ์ด ====================
  socket.on('playCard', ({ roomCode, card, skipTurn }) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit('error', 'ไม่พบห้องนี้');
      return;
    }
    if (room.phase !== 'playCard') {
      socket.emit('error', 'ไม่ได้อยู่ในเฟสเลือกการ์ด');
      return;
    }
    
    const player = room.players.find(p => p.id === socket.id);
    if (!player) {
      socket.emit('error', 'ไม่พบผู้เล่น');
      return;
    }

    // ✅ Auto-skip disconnected players
    if (player.isDisconnected) {
      console.log(`🤖 [AUTO-SKIP] ${player.name} is disconnected, auto-skipping playCard`);
      player.playedCard = null;
      player.hasDecided = true;
      // Check if all players have decided
      const allDecided = room.players.every(p => p.hasDecided);
      if (allDecided) {
        startEventSlot(roomCode);
      }
      return;
    }
    
    // ✅ ป้องกันผู้เล่นที่พลังใจ = 0 จากการเล่นต่อ (ให้ดูอย่างเดียว)
    if (player.heart === 0) {
      console.log(`⚠️ ${player.name} is eliminated (heart = 0), cannot play card`);
      socket.emit('error', 'คุณแพ้แล้ว สามารถดูเกมได้อย่างเดียว');
      return;
    }

    // ✅ Validate card ownership if not skipping
    if (!skipTurn && card) {
      const hasCard = player.hand.some(c => c.id === card.id);
      if (!hasCard) {
        socket.emit('error', 'คุณไม่มีการ์ดใบนี้!');
        console.warn(`⚠️ ${player.name} tried to play card they don't own`);
        return;
      }
    }

    if (skipTurn) {
      // ผู้เล่นข้ามเทิร์น
      player.playedCard = null;
      player.hasDecided = true;
    } else {
      // ผู้เล่นลงการ์ด
      player.playedCard = card;
      player.hand = player.hand.filter(c => c.id !== card.id);
      player.hasDecided = true;
    }

    // ตรวจว่าทุกคนตัดสินใจแล้วไหม (ลง หรือ ข้าม)
    const allDecided = room.players.every(p => p.hasDecided === true);
    
    if (allDecided) {
      const playersWhoSkipped = room.players.filter(p => p.hasDecided && p.playedCard === null);
      
      // ✅ ตรวจสอบว่ามีผู้เล่นที่ยังเล่นได้ (มีการ์ด และ มีหัวใจ)
      const alivePlayers = room.players.filter(p => p.heart > 0 && p.hand.length > 0);
      
      // ✅ ถ้าเหลือคนเล่นได้ <= 1 คน ให้จบเกม
      if (alivePlayers.length <= 1) {
        console.log(`🎉 เหลือผู้เล่นที่เล่นได้ ${alivePlayers.length} คน - เกมจบ!`);
        setTimeout(() => {
          io.to(roomCode).emit('turnResult', {
            actionResults: [],
            winnerName: alivePlayers[0]?.name || 'ไม่มีผู้ชนะ',
            winnerScore: 0,
            gameOver: true,
            winnerNameFinal: alivePlayers[0]?.name || 'ไม่มีผู้ชนะ',
            players: getPlayersInfo(room),
            skillEffects: [],
            revealedCards: {}
          });
          // ❌ ไม่เรียก resetRoom - ให้ startGame รีเซ็ตเองตอนกด Start ใหม่
        }, 1000);
        return;
      }
      
      // ✅ เช็คว่าทุกคนที่ยังเล่นได้ลงการ์ดครบหรือยัง (ไม่นับคนแพ้)
      const playersWhoPlayed = alivePlayers.filter(p => p.hasDecided && p.playedCard !== null);
      const allAliveDecided = playersWhoPlayed.length === alivePlayers.length;
      
      if (!allAliveDecided) {
        console.log(`⏳ รอผู้เล่นที่เหลือ: ${playersWhoPlayed.length}/${alivePlayers.length}`);
        return;
      }
      
      console.log(`✅ ทุกคนที่เล่นได้ลงการ์ดครบแล้ว (${playersWhoPlayed.length} คน)`);
      
      // ถ้ามีคนเล่นแค่คนเดียว ให้คนที่ข้ามเสียพลังใจ 1
      if (playersWhoPlayed.length === 1 && playersWhoSkipped.length > 0) {
        playersWhoSkipped.forEach(p => {
          if (p.heart > 0 && p.hand.length > 0) { // เฉพาะคนที่ยังเล่นได้
            p.heart = Math.max(0, p.heart - 1);
            console.log(`❌ ${p.name} ข้ามเทิร์น เสียพลังใจ 1 (เหลือ ${p.heart})`);
          }
        });
      }
      
      // ส่งข้อมูลให้ทุกคน
      const playedCardsData = {};
      room.players.forEach(p => {
        if (p.playedCard) {
          playedCardsData[p.name] = p.playedCard;
        }
      });
      
      io.to(roomCode).emit('allPlayedCards', {
        playedCards: playedCardsData,
        event: room.event // ✅ ส่ง event data เพื่อให้ client ตรวจสอบอีเวนต์โหนเซไก
      });
      
      setTimeout(() => {
        room.phase = 'action';
        io.to(roomCode).emit('actionPhaseStart', {
          competition: room.competition,
          event: room.event.name,
          players: getPlayersInfo(room)
        });
      }, 2000);
    }
  });

  // ==================== เลือก Action ====================
  socket.on('chooseAction', ({ roomCode, action }) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit('error', 'ไม่พบห้องนี้');
      return;
    }
    
    console.log(`[chooseAction] Room phase: '${room.phase}', Player action: ${action}`);
    
    // ✅ อนุญาตรับ action ในทั้ง playCard และ action phase
    if (room.phase !== 'playCard' && room.phase !== 'action') {
      console.warn(`⚠️ chooseAction called but phase is '${room.phase}'`);
      socket.emit('error', `ไม่ได้อยู่ในเฟสที่ถูกต้อง (ปัจจุบัน: ${room.phase})`);
      return;
    }
    
    const player = room.players.find(p => p.id === socket.id);
    if (!player) {
      socket.emit('error', 'ไม่พบผู้เล่น');
      return;
    }

    // ✅ Auto-skip disconnected players
    if (player.isDisconnected) {
      console.log(`🤖 [AUTO-SKIP] ${player.name} is disconnected, auto-choosing action 3 (compete)`);
      player.action = "3"; // Default action: compete
      // Check if all players with cards have chosen action
      const playersWithCards = room.players.filter(p => p.playedCard !== null);
      const allChoseAction = playersWithCards.every(p => p.action);
      if (allChoseAction) {
        resolveTurn(roomCode);
      }
      return;
    }
    
    // ✅ ป้องกันผู้เล่นที่พลังใจ = 0 จากการเลือก action (ให้ดูอย่างเดียว)
    if (player.heart === 0) {
      console.log(`⚠️ ${player.name} is eliminated (heart = 0), cannot choose action`);
      socket.emit('error', 'คุณแพ้แล้ว สามารถดูเกมได้อย่างเดียว');
      return;
    }
    
    if (player.playedCard === null) {
      socket.emit('error', 'ต้องลงการ์ดก่อน');
      return;
    }

    // ✅ ตรวจสอบคูลดาวน์สำหรับ action 2 (สกิล)
    // แม้ว่า CD > 0 ก็ยังส่งข้อความเตือนแต่ให้ส่ง action ไปได้ (ยืดเพิ่ม CD)
    if (action === "2" && player.actionCooldown > 0) {
      console.warn(`⚠️ ${player.name} tried to use action 2 but CD is ${player.actionCooldown} - extending CD by 3`);
      socket.emit('warning', `⚠️ สกิลกำลังติด CD ${player.actionCooldown} เทิร์น! แต่ยืดเพิ่มอีก 3 เทิร์น`);
    }

    player.action = action;
    console.log(`✅ ${player.name} เลือก action ${action}`);

    // ตรวจว่าทุกคนที่ลงการ์ดเลือก action แล้วไหม
    const playersWithCards = room.players.filter(p => p.playedCard !== null);
    const allChoseAction = playersWithCards.every(p => p.action);
    
    console.log(`[chooseAction] Players with cards: ${playersWithCards.length}, All chose action: ${allChoseAction}`);
    
    if (allChoseAction) {
      console.log(`[chooseAction] All players chose action, resolving turn...`);
      resolveTurn(roomCode);
    }
  });

  // Auto resolve เมื่อครบ 30 วิ
  socket.on('actionTimeout', (roomCode) => {
    const room = rooms.get(roomCode);
    if (room && room.phase === 'action') {
      console.log(`⏱️ Action phase timeout for room ${roomCode}`);
      const playersWithCards = room.players.filter(p => p.playedCard !== null);
      playersWithCards.forEach(p => { 
        if (!p.action) {
          p.action = "3"; // ตั้งต้นแข่งตรง ๆ
          console.log(`⚙️ ${p.name} auto-select action 3`);
        }
      });
      resolveTurn(roomCode);
    } else {
      console.warn(`⚠️ actionTimeout called but phase is '${room?.phase}' not 'action'`);
    }
  });

  // ==================== Helper: Reset Room ====================
  const getNextEvent = (room) => {
    return GameStateManager.getNextEvent(room);
  };

  const resetRoom = (code) => {
    roomManager.resetRoom(code);
  };

  // ==================== จบเทิร์น + คำนวณผล ====================
  const resolveTurn = (code) => {
    const room = rooms.get(code);
    if (!room) return;
    
    room.phase = 'resolve';

    const playersWithCards = room.players.filter(p => p.playedCard !== null);
    console.log(`[RESOLVE START] playersWithCards: ${playersWithCards.length}/${room.players.length}`);
    playersWithCards.forEach(p => console.log(`  - ${p.name}: playedCard=${p.playedCard.id}`));
    
    let scores = {};
    let winner = null;
    let maxScore = -1;
    const actionResults = [];
    const skillEffects = []; // Track all skill effects

    // Initialize skill-related game state
    room.protectedPlayers = room.protectedPlayers || {};
    room.skillBlockActive = room.skillBlockActive || {};

    // กรณีไม่มีใครลงการ์ดเลย (ทุกคนข้าม) -> ส่งผลลัพธ์ปลอดภัยแล้วเริ่มเทิร์นต่อไป
    if (playersWithCards.length === 0) {
      console.log(`🔷 เทิร์น ${room.turn}: ไม่มีใครลงการ์ด`);
      io.to(code).emit('turnResult', {
        actionResults: [],
        winnerName: null,
        winnerScore: 0,
        gameOver: false,
        winnerNameFinal: null,
        players: getPlayersInfo(room),
        skillEffects: []
      });
      // next turn
      room.turn++;
      setTimeout(() => startNewTurn(code), 3000);
      return;
    }

    // ==================== PHASE 1: Process Skill Effects (Action 2) ====================
    playersWithCards.forEach(p => {
      if (p.action === "2" && p.playedCard) {
        // Check if skill is blocked by hidden_skill
        if (SkillManager.isSkillBlocked(room, p.id)) {
          console.log(`🚫 ${p.name} skill blocked by hidden_skill!`);
          skillEffects.push({
            player: p.name,
            skill: p.playedCard.skill,
            blocked: true,
            effects: ['Skill blocked by Hidden Skill']
          });
          return; // Skip skill activation
        }

        // Activate skill
        const skillResult = SkillManager.activateSkill(
          p.playedCard.skill,
          p,
          p.playedCard,
          playersWithCards,
          room,
          io,
          getNextEvent
        );

        // Handle special skills - เก็บ flag ไว้จะจั่วทีหลัง
        if (p.playedCard.skill === 'gacha god') {
          // ✅ ไม่จั่วที่นี่ - รอจนไปหลังประกาศผล
          p.needsGachaGod = true;
          console.log(`🎰 ${p.name} will draw 2 cards from Gacha God later`);
        }

        skillEffects.push({
          player: p.name,
          skill: p.playedCard.skill,
          blocked: false,
          effects: skillResult.effects,
          modifiers: skillResult.statModifiers
        });

        console.log(`✨ ${p.name} used ${p.playedCard.skill}: ${skillResult.effects.join(', ')}`);
      }
    });

    // ==================== PHASE 2: Calculate Scores with Stat Modifiers ====================
    console.log(`[PHASE 2] Processing ${playersWithCards.length} players with cards`);
    const statModifiers = {}; // Collect all stat modifiers from skills
    skillEffects.forEach(se => {
      if (se.modifiers) {
        Object.assign(statModifiers, se.modifiers);
      }
    });

    playersWithCards.forEach(p => {
      let card = p.playedCard;
      
      // ✅ Apply skill stat modifiers to card stats before scoring
      if (statModifiers[p.id]) {
        const mods = statModifiers[p.id];
        if (mods.vocal) card.vocal = Math.max(1, card.vocal + mods.vocal);
        if (mods.dance) card.dance = Math.max(1, card.dance + mods.dance);
        if (mods.visual) card.visual = Math.max(1, card.visual + mods.visual);
        console.log(`  📊 Stat modifiers applied: V${mods.vocal || 0}, D${mods.dance || 0}, Vi${mods.visual || 0}`);
      }
      
      let score = calculateScore(card, room.competition, room.event);
      let actualScore = score;
      let action = p.action;
      
      console.log(`[SCORE CALC] 🎴 ${p.name} (Card: ${card.name})`);
      console.log(`  Game Mode: ${room.competition}, Event: ${room.event.name}`);
      console.log(`  Action: ${action === "1" ? "Gacha(-5)" : action === "2" ? "Skill" : action === "3" ? "Compete" : action === "4" ? "Flee" : "Unknown"}`);
      console.log(`  Base Score: ${score}`);
      
      // Action 1: สุ่มกาชา - ลด 5 แต้ม
      if (action === "1") {
        p.hand.push(room.deck.drawCard());
        actualScore = Math.max(0, score - 5); // ลด 5 แต้ม
        console.log(`  → Action 1 applied: ${score} - 5 = ${actualScore}`);
      }
      // Action 2: ใช้สกิล - score already adjusted by skill modifiers
      else if (action === "2") {
        if (p.actionCooldown > 0) {
          // ปุ่ม action 2 ติดคูลดาวน์ -> ให้คะแนนปกติ แต่ยืด CD เพิ่ม 2 เทิร์น
          actualScore = score;
          p.actionCooldown += 3; // ✅ ยืด CD ไป 3 เทิร์นเพิ่ม
          console.log(`  ⚠️ Action 2 on cooldown (${p.actionCooldown - 3} turns) → Extend by 3 = ${p.actionCooldown}`);
        } else {
          // ✅ Score is already updated with modifiers applied to card stats
          actualScore = score;
          p.actionCooldown = 3; // ติดคูลดาวน์ 3 เทิร์น
          console.log(`  ✨ Action 2 used: ${score} (with stat modifiers), CD set = 3`);
        }
      }
      // Action 4: ถอยหนี
      else if (action === "4") {
        actualScore = 0;
        // เก็บการ์ดเดิมกลับไว้ในมือ
        if (p.playedCard) {
          p.hand.push(p.playedCard);
        }
        // เสียพลังใจ 1
        p.heart = Math.max(0, p.heart - 1);
        console.log(`  🎴 Action 4 (Flee): Score = 0, Heart lost: ${p.heart + 1} → ${p.heart}`);
      }
      // Action 3 หรืออื่น ๆ
      else {
        actualScore = score;
        console.log(`  ⚔️ Action 3 (Compete): Score = ${actualScore}`);
      }
      
      console.log(`  ✅ Final Score: ${actualScore}\n`);

      scores[p.id] = actualScore;
      if (actualScore > maxScore) {
        maxScore = actualScore;
        winner = p;
      }
      
      // ✅ เพิ่มคะแนนไปยังคะแนนรวม
      p.totalScore = (p.totalScore || 0) + actualScore;
      
      console.log(`[ACTION RESULT] ${p.name}: actualScore=${actualScore}, totalScore=${p.totalScore}`);
      const resultObj = {
        id: p.id,
        name: p.name,
        action: action,
        score: actualScore,
        baseScore: score
      };
      console.log(`[PUSH AR] Pushing:`, JSON.stringify(resultObj));
      actionResults.push(resultObj);
    });

    // ✅ เพิ่มผู้เล่นที่ข้ามเทิร์นลงใน actionResults ด้วย
    const playersWhoSkipped = room.players.filter(p => p.hasDecided && p.playedCard === null);
    console.log(`[SKIPPED] Found ${playersWhoSkipped.length} players who skipped`);
    playersWhoSkipped.forEach(p => {
      // ผู้เล่นที่ข้ามจะได้ 0 คะแนน
      console.log(`[SKIPPED RESULT] ${p.name}: score=0`);
      actionResults.push({
        id: p.id,
        name: p.name,
        action: null,
        score: 0,
        baseScore: 0
      });
    });

    // ==================== PHASE 3: Apply Heart Loss / Shield Effects ====================
    // ✅ หาว่ามีกี่คนที่ได้คะแนนสูงสุด
    const winnersWithMaxScore = playersWithCards.filter(p => scores[p.id] === maxScore);
    
    console.log(`[TURN RESULT] maxScore=${maxScore}, winners=${winnersWithMaxScore.length}, totalPlayers=${playersWithCards.length}`);
    
    // ✅ ถ้าทุกคนได้คะแนนเท่ากัน → ไม่มีใครเสีย
    if (winnersWithMaxScore.length === playersWithCards.length) {
      console.log(`[TURN RESULT] 🤝 All players tied! No one loses heart`);
    } else {
      // ถ้าบางคนแต้มต่างกว่า → เฉพาะคนที่ไม่ได้ maxScore เสีย
      playersWithCards.forEach(p => {
        if (scores[p.id] < maxScore) {
          // Check if protected by leek_shield
          if (!room.protectedPlayers[p.id]) {
            if (p.action !== "4") {
              p.heart = Math.max(0, p.heart - 1);
              console.log(`🔻 ${p.name} แพ้เทิร์น (${scores[p.id]} < ${maxScore}) เสียพลังใจ 1 (เหลือ ${p.heart})`);
            }
          } else {
            console.log(`🛡️ ${p.name} protected by Leek Shield!`);
          }
        }
      });
    }

    // ==================== PHASE 4: Return Cards & Prepare for New Draw ====================
    // ✅ เก็บข้อมูลการ์ดก่อนล้างเพื่อส่งไปแสดงผล (เฉพาะ Action ที่ไม่ใช่ 4/flee)
    const playedCardsForDisplay = playersWithCards
      .filter(p => p.action !== "4") // ❌ Exclude flee (Action 4) - ไม่ต้องแสดง animation
      .map(p => ({
        playerId: p.id,
        playerName: p.name,
        card: { ...p.playedCard }, // Copy card data
        action: p.action
      }));

    // ✅ เก็บรายชื่อผู้เล่นที่ต้องจั่วการ์ดใหม่ (Action 1 หรือ Skill Gacha God)
    const playersToDraw = [];
    
    playersWithCards.forEach(p => {
      if (p.action !== "4") {
        // ส่งการ์ดที่ลงไปเข้ากอน (recycle)
        room.deck.returnCard(p.playedCard);
        
        // ✅ Action 1 (กาชา) - จั่ว 1 ใบ
        if (p.action === "1") {
          playersToDraw.push({ player: p, count: 1, reason: 'gacha' });
          console.log(`🎲 ${p.name}: Action 1 (กาชา) - จะจั่ว 1 ใบ`);
        }
        
        // ✅ Skill Gacha God - จั่ว 2 ใบ
        if (p.needsGachaGod) {
          playersToDraw.push({ player: p, count: 2, reason: 'gachaGod' });
          console.log(`🎰 ${p.name}: Gacha God - จะจั่ว 2 ใบ`);
          p.needsGachaGod = false;
        }
        
        p.playedCard = null;
        console.log(`♻️ ${p.name}: ส่งการ์ดเข้ากอน (กอนเหลือ: ${room.deck.deckCount().available})`);
      } else {
        // ✅ Action 4: ถอยหนี - เก็บการ์ดไว้ ไม่ส่งคืนกอง ไม่จั่วใหม่
        p.playedCard = null;
        console.log(`🏃 ${p.name}: ถอยหนี - เก็บการ์ดไว้`);
      }
      
      // รีเซ็ต hasDecided สำหรับเทิร์นถัดไป
      p.hasDecided = false;
    });

    // ✅ เก็บข้อมูลการจั่วไว้ส่งหลังประกาศผล
    room.playersToDraw = playersToDraw;

    // ==================== PHASE 5: Apply Event Effects ====================
    // special_battle - ไม่สุ่มการแข่งขัน แข่งรูปแบบพิเศษ ค่าพลังที่+กัน ไม่มีตัวคูณ
    if (room.event.effect === 'special_battle') {
      console.log(`⚔️ [Event] special_battle: Already applied in score calculation`);
    }

    // max_stat_zero - ค่าพลังที่เยอะที่สุดของการ์ด จะถูกลบไป
    if (room.event.effect === 'max_stat_zero') {
      console.log(`⚡ [Event] max_stat_zero: Already applied in score calculation`);
    }

    // stat_minus_2 - ลบค่าพลังทุกอย่างลงอย่างละ 2 หน่วย
    if (room.event.effect === 'stat_minus_2') {
      console.log(`📉 [Event] stat_minus_2: Already applied in score calculation`);
    }

    // reveal_cards - หงายการ์ด (หงายทันทีหลังเฟสเลือกการ์ด)
    let revealedCards = {};
    if (room.event.effect === 'reveal_cards') {
      console.log(`👁️ [Event] โหนเซไก - หงายการ์ดทันที`);
      // ✅ เก็บข้อมูลการ์ดที่หงายเพื่อส่งให้ client
      room.players.forEach(p => {
        if (p.selectedCard) {
          revealedCards[p.id] = p.selectedCard;
        }
      });
    }

    // hidden_skill - บล็อกสกิลของผู้เล่นอื่น
    if (room.event.effect === 'hidden_skill') {
      console.log(`🚫 [Event] hidden_skill: Already applied in skill activation`);
    }

    // group_buff, rarity_buff, type_buff - แบมัฟค่าพลัง
    if (room.event.effect === 'group_buff' || room.event.effect === 'rarity_buff' || room.event.effect === 'type_buff') {
      console.log(`✨ [Event] ${room.event.effect}: Already applied in score calculation`);
    }

    // sapphire_r - ให้ Kohane เพิ่มคะแนน
    if (room.event.effect === 'sapphire_r') {
      console.log(`💎 [Event] sapphire_r: Already applied in score calculation`);
    }

    // ==================== PHASE 6: CHECK DIVINE CARD BEFORE GAME OVER ====================
    // ✅ ตรวจสอบ divine card ชุบชีวิตก่อนประกาศแพ้
    // เงื่อนไข: heart ต้องเหลือ 1 เท่านั้น + มี leek shield protection
    room.players.forEach(p => {
      if (p.heart === 1 && room.divineCardActive && room.divineCardActive[p.id] && room.protectedPlayers && room.protectedPlayers[p.id]) {
        console.log(`✨ [Divine Card CHECK] ${p.name} can revive! (heart=1, leek shield active)`);
        const revivalCards = room.deck.drawCards(10);
        p.hand.push(...revivalCards);
        console.log(`✨ [Divine Card ACTIVATED] ${p.name} revived! Drew 10 cards (leek shield keeps heart at 1)`);
        delete room.divineCardActive[p.id];
        // leek shield จะเก็บ heart ไว้ที่ 1 ตามไป
      }
    });

    // Clear temporary skill effects for next turn (AFTER divine card check)
    SkillManager.clearTemporaryEffects(room);

    // ✅ ตรวจสอบสถานะเกม: ผู้ชนะ, ผู้แพ้, การเสมอ (AFTER divine card check)
    const alivePlayers = room.players.filter(p => p.heart > 0 && p.hand.length > 0);
    const deadPlayers = room.players.filter(p => p.heart <= 0 || p.hand.length === 0);
    
    let gameOver = false;
    let finalWinner = null;
    let isDraw = false;
    let drawPlayers = [];
    
    // กรณี 1: เหลือคนเดียว = ญชนะ
    if (alivePlayers.length === 1) {
      gameOver = true;
      finalWinner = alivePlayers[0];
      console.log(`🏆 [GAME OVER] ${finalWinner.name} ชนะเกม!`);
    }
    // กรณี 2: ไม่มีคนเหลือเลย = เสมอทั้งหมด
    else if (alivePlayers.length === 0) {
      gameOver = true;
      isDraw = true;
      drawPlayers = room.players.map(p => p.name);
      console.log(`🤝 [GAME OVER] เสมอ! ผู้เล่น: ${drawPlayers.join(', ')}`);
    }
    // กรณี 3: ตรวจสอบว่ามีคนแพ้ใหม่ในเทิร์นนี้ (พร้อมกัน)
    const newlyDeadPlayers = deadPlayers.filter(p => {
      // เช็คว่าแพ้ในเทิร์นนี้ (ไม่มี flag isDead ก่อนหน้านี้)
      return !p.isDead;
    });
    
    if (newlyDeadPlayers.length > 0) {
      newlyDeadPlayers.forEach(p => {
        p.isDead = true;
        console.log(`❌ ${p.name} แพ้เกม! (การ์ด: ${p.hand.length}, หัวใจ: ${p.heart})`);
      });
      
      // ถ้าแพ้พร้อศกัน > 1 คน และเหลือคนเดียว = คนที่แพ้พร้อมกันเสมอ
      if (newlyDeadPlayers.length > 1 && alivePlayers.length === 0) {
        gameOver = true;
        isDraw = true;
        drawPlayers = newlyDeadPlayers.map(p => p.name);
        console.log(`🤝 [SIMULTANEOUS DEATH] เสมอ! ${drawPlayers.join(', ')} แพ้พร้อมกัน`);
      }
      // ถ้าแพ้พร้อมกัน > 1 คน และเหลือ 1 คน = คนเหลือชนะ
      else if (newlyDeadPlayers.length > 1 && alivePlayers.length === 1) {
        gameOver = true;
        finalWinner = alivePlayers[0];
        console.log(`🏆 [GAME OVER] ${finalWinner.name} ชนะเกม! (ผู้อื่นแพ้พร้อมกัน)`);
      }
    }

    console.log(`🏆 เทิร์น ${room.turn}: ${winner ? winner.name : 'ไม่มีผู้ชนะ'} ชนะ (${maxScore} pt)`);
    console.log(`[FINAL AR] actionResults length: ${actionResults.length}`);
    console.log(`[FINAL AR] Full actionResults:`, JSON.stringify(actionResults, null, 2));
    console.log(`[FINAL AR] getPlayersInfo:`, JSON.stringify(getPlayersInfo(room), null, 2));
    
    // ✅ Verify actionResults before emit
    console.log(`[EMIT CHECK] About to emit turnResult with:`);
    console.log(`  - actionResults: ${actionResults.length} items`);
    if (actionResults.length > 0) {
      console.log(`  - First item:`, actionResults[0]);
      console.log(`  - Last item:`, actionResults[actionResults.length - 1]);
    }
    
    console.log(`[EMIT] Emitting to room "${code}"`);
    const roomClients = io.sockets.adapter.rooms.get(code);
    console.log(`[EMIT] Connected clients in room:`, roomClients ? Array.from(roomClients) : []);
    console.log(`[EMIT] Room has ${roomClients ? roomClients.size : 0} connected clients`);

    const turnResultData = {
      actionResults,
      winnerName: winner ? winner.name : null,
      winnerScore: maxScore,
      gameOver: gameOver,
      winnerNameFinal: finalWinner?.name || null,
      isDraw: isDraw,
      drawPlayers: drawPlayers,
      players: getPlayersInfo(room),
      skillEffects: skillEffects,
      revealedCards: revealedCards
    };

    // ✅ เฟสหงายการ์ด + แสดงสกิลเอฟเฟค
    console.log(`🎴 [Reveal Phase] Revealing all played cards...`);
    
    // ✅ ถ้าเป็นอีเวนต์ reveal_cards ไม่ต้องหงาย (หงายไปแล้ว)
    if (room.event.effect !== 'reveal_cards') {
      io.to(code).emit('revealCardsPhase', {
        playedCards: playedCardsForDisplay,
        skillEffects: skillEffects  // ✅ ส่งสกิลเอฟเฟคไปแสดงหลังหงายการ์ด
      });
      console.log(`🎴 [Reveal Phase] Revealing all played cards...`);
    } else {
      console.log(`👁️ [Skip Reveal Phase] โหนเซไก - หงายไปแล้วทันทีหลังเลือกการ์ด`);
      // ส่งสกิลเอฟเฟคแยก สำหรับโหนเซไก
      io.to(code).emit('showSkillEffectsOnly', {
        skillEffects: skillEffects
      });
    }

    // ✅ คำนวณ timeout แบบ dynamic (กลับเป็นแบบเก่า)
    // ถ้าไม่มี skill effects → รอ 3 วิ (แค่หงายการ์ด)
    // ถ้ามี skill effects → รอ 8 วิ (3 วิหงาย + 5 วิแสดงสกิล)
    const hasSkillEffects = skillEffects && skillEffects.length > 0;
    const revealDelay = hasSkillEffects ? 8000 : 3000;
    
    if (hasSkillEffects) {
      console.log(`⏱️ [Reveal Delay] ✨ With skill effects - waiting 8000ms`);
    } else {
      console.log(`⏱️ [Reveal Delay] ⊘ No skill effects - waiting 3000ms for card reveal`);
    }
    console.log(`🎯 [DEBUG] skillEffects count: ${skillEffects ? skillEffects.length : 0}`);

    // รอแล้วแสดงผลลัพธ์ (หรือทันทีถ้าไม่มี skill)
    setTimeout(() => {
      console.log(`⏰ [EMIT RESULT] Sending turnResult now!`);
      // Emit turnResult
      io.to(code).emit('turnResult', turnResultData);
      
      // ✅ บันทึก actionResults เพื่อให้ newTurn ส่งต่อไปให้ client
      room.lastTurnActionResults = actionResults;
      
      console.log(`[EMIT] turnResult emitted successfully`);

      // ตรวจสอบว่าใครเสียการ์ดหมดหรือแพ้
      room.players.forEach(p => {
        if (p.hand.length === 0 || p.heart <= 0) {
          console.log(`❌ ${p.name} แพ้เกม! (การ์ด: ${p.hand.length}, หัวใจ: ${p.heart})`);
        }
      });

      // ✅ หลังแสดงผล: รอให้ client แสดง result สรุปเสร็จ แล้วค่อยส่ง returnCards
      // revealDelay = เวลาหงายการ์ด + แสดงสกิล, +2000ms = เวลา result display
      const resultDisplayDelay = revealDelay + 2000;
      setTimeout(() => {
        // 1. คืนการ์ดกลับกอง (ทุกคนเห็น) - เฉพาะที่ไม่ใช่ Action 4
        io.to(code).emit('returnCards', {
          playedCards: playedCardsForDisplay
        });

        // 2. รอให้ animation คืนการ์ดเสร็จ (0.7s × จำนวนคน)
        setTimeout(() => {
          // 3. จั่วการ์ดใหม่ (เฉพาะคนที่มี Action 1 หรือ Skill)
          if (room.playersToDraw && room.playersToDraw.length > 0) {
            room.playersToDraw.forEach(({ player, count, reason }) => {
              const newCards = room.deck.drawCards(count);
              player.hand.push(...newCards);
              
              const playerSocket = io.sockets.sockets.get(player.id);
              if (playerSocket) {
                // ✅ ส่ง event ตามประเภทการจั่ว
                if (reason === 'gachaGod') {
                  playerSocket.emit('gachaGodDraw', { cards: newCards });
                  console.log(`🎰 ${player.name} drew ${count} cards from Gacha God`);
                } else {
                  playerSocket.emit('drawCards', { cards: newCards, count: count, reason: reason });
                  console.log(`🎴 ${player.name}: จั่ว ${count} ใบ (${reason})`);
                }
              }
            });
          }

          // 4. รอให้ animation จั่วเสร็จ แล้วเริ่มเทิร์นใหม่
          const drawDelay = room.playersToDraw ? room.playersToDraw.reduce((max, p) => Math.max(max, p.count), 0) * 700 : 0;
          
          setTimeout(() => {
            if (!gameOver) {
              room.turn++;
              room.playersToDraw = []; // เคลียร์
              
              // เริ่มเทิร์นใหม่ (รอ 3 วิ)
              setTimeout(() => {
                startEventSlot(code);
              }, 3000);
            } else {
              // เกมจบ
              if (isDraw) {
                console.log(`🤝 เกมเสมอ! ผู้เล่น: ${drawPlayers.join(', ')}`);
              } else {
                console.log(`🎉 ${finalWinner.name} เป็นผู้ชนะเกม!`);
              }
              // ❌ ไม่เรียก resetRoom - ให้ startGame รีเซ็ตเองตอนกด Start ใหม่
            }
          }, drawDelay);
        }, playedCardsForDisplay.length * 700);
      }, resultDisplayDelay); // ✅ รอ result display + reveal delay
    }, revealDelay); // ✅ รอตามเวลาที่ server กำหนด
  };

  // ==================== Disconnect ====================
  socket.on('requestTurnResult', ({ room }) => {
    // Client requested turn result because didn't receive it
    // This shouldn't happen normally, but send data again just in case
    const gameRoom = rooms.get(room);
    if (!gameRoom) return;
    
    console.log(`[requestTurnResult] Client ${socket.id} requested turn result for room ${room}`);
    // Emit to this specific client
    socket.emit('turnResultFallback', {
      actionResults: [],
      winnerName: 'N/A',
      winnerScore: 0,
      gameOver: false,
      winnerNameFinal: null,
      players: getPlayersInfo(gameRoom),
      skillEffects: [],
      revealedCards: {}
    });
  });

  socket.on('disconnect', () => {
    console.log('👋 Player disconnected:', socket.id);
    
    // Remove player from room using manager
    const { code, room, removedPlayer } = roomManager.removePlayer(socket.id);
    
    if (!removedPlayer) return;
    
    console.log(`[disconnect] ${removedPlayer.name} left room ${code}`);
    
    if (!room) {
      console.log(`[disconnect] Room is empty, deleted`);
      return;
    }

    if (!room.started) {
      broadcastLobbyUpdate(code);
    } else {
      console.log(`[disconnect] Game in progress, ${room.players.length} players remain`);
      io.to(code).emit('playerLeft', { player: removedPlayer.name, remainingPlayers: room.players.length });
      
      // ✅ Mark disconnected player for auto-skip (แต่ยังอยู่ในห้อง)
      removedPlayer.isDisconnected = true;
      console.log(`[disconnect] ${removedPlayer.name} marked as disconnected, auto-skip enabled`);
      
      // ตรวจสอบว่าเกมจะต่อเนื่องได้ไหม
      const alivePlayers = room.players.filter(p => p.heart > 0 && p.hand.length > 0);
      console.log(`[disconnect] Alive players: ${alivePlayers.length} (${alivePlayers.map(p => p.name).join(', ')})`);
      
      // ✅ ถ้าเหลือเพียง 1 คนที่มีชีวิต → ประกาศผลทันที
      if (alivePlayers.length === 1) {
        console.log(`[disconnect] Only 1 player alive, ending game immediately`);
        setTimeout(() => {
          const winner = alivePlayers[0];
          io.to(code).emit('turnResult', {
            actionResults: [],
            winnerName: winner.name,
            winnerScore: 0,
            gameOver: true,
            winnerNameFinal: winner.name,
            players: getPlayersInfo(room),
            skillEffects: [],
            revealedCards: {}
          });
          setTimeout(() => {
            roomManager.resetRoom(code);
          }, 3000);
        }, 500);
      }
      // ✅ ถ้ายังมี 2+ คนที่มีชีวิต → เกมต่อ + auto-skip disconnected player
      else if (alivePlayers.length >= 2) {
        console.log(`[disconnect] Still ${alivePlayers.length} alive players, game continues with auto-skip`);
        // Game will auto-skip disconnected player in playCard and chooseAction logic
      }
      // ✅ ถ้าไม่มีใครเหลือ → เสมอ
      else if (alivePlayers.length === 0) {
        console.log(`[disconnect] No players alive, draw game`);
        setTimeout(() => {
          io.to(code).emit('turnResult', {
            actionResults: [],
            winnerName: 'Draw',
            winnerScore: 0,
            gameOver: true,
            winnerNameFinal: 'Draw',
            players: getPlayersInfo(room),
            skillEffects: [],
            revealedCards: {}
          });
          setTimeout(() => {
            roomManager.resetRoom(code);
          }, 3000);
        }, 500);
      }
    }
  });
});

// ==================== Helper Functions ====================
function broadcastLobbyUpdate(code) {
  const room = roomManager.getRoom(code);
  if (!room) return;
  
  const roomClients = io.sockets.adapter.rooms.get(code);
  console.log(`[broadcastLobbyUpdate] code=${code}, connectedClients=${roomClients ? roomClients.size : 0}`);
  
  io.to(code).emit('updateLobby', {
    players: room.players.map(p => ({ 
      id: p.id, 
      name: p.name, 
      ready: p.ready 
    }))
  });
}

function getPlayersInfo(room) {
  return room.players.map(p => ({
    id: p.id,
    name: p.name,
    heart: p.heart,
    handCount: p.hand.length,
    skillCooldown: p.skillCooldown
  }));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎮 SPRGame Sekai เปิดเซิร์ฟแล้ว! http://localhost:${PORT}`);
  console.log(`📍 http://localhost:${PORT}\n`);
});